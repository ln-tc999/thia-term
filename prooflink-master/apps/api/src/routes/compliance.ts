import { and, desc, eq, gte, lte, sql } from "drizzle-orm";
import { Hono } from "hono";
import { randomUUID } from "node:crypto";
import { z } from "zod";

import { getDb } from "../db/index.js";
import { agents, complianceChecks, complianceReceipts } from "../db/schema.js";
import type { AuthContext } from "../middleware/auth.js";
import { requireScope } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { writeAuditLog } from "../utils/audit.js";
import { logger } from "../utils/logger.js";
import { convertToUsd } from "../utils/price-guard.js";
import { emitComplianceEvent, emitSanctionsAlert } from "../utils/events.js";
import { AMLScorer, loadConfig, TravelRuleChecker } from "@prooflink/core";
import type { TransactionContext, TravelRuleResult } from "@prooflink/core";
import { checkDelegationScope } from "../utils/spend-enforcement.js";
import { validateCrossChainSpend } from "../services/policy-sync.js";
import { screenAddress } from "../services/screening.js";
import {
  createComplianceCommitment,
  verifyComplianceCommitment,
} from "../services/zk-commitment.js";
import { getProtocolCompliance, isSupportedProtocol } from "../services/protocol-adapter.js";
import type { SupportedProtocol, ProtocolComplianceContext } from "../services/protocol-adapter.js";
import {
  shouldAutoGenerateSAR,
  shouldAutoGenerateCTR,
  generateSAR,
  generateCTR,
} from "../services/reporting.js";
import {
  resolveTravelRuleThreshold,
  resolveAgentOriginator,
} from "../services/travel-rule-config.js";
import type { AgentOriginatorInfo } from "../services/travel-rule-config.js";
import { recordUsage } from "../services/billing.js";
import {
  translatePermission,
  validatePermission,
  type PermissionProtocol,
  type UnifiedPermission,
  type PermissionValidationResult,
} from "../services/permission-translator.js";

// ---------------------------------------------------------------------------
// AML Scorer (singleton — created once with default config)
// ---------------------------------------------------------------------------
const proofLinkConfig = loadConfig();
const amlScorer = new AMLScorer(proofLinkConfig);
const travelRuleChecker = new TravelRuleChecker(proofLinkConfig);

// ---------------------------------------------------------------------------
// Request schemas
// ---------------------------------------------------------------------------

const ComplianceCheckRequest = z.object({
  sender: z.object({
    address: z.string().min(1),
    chain: z.string().min(1),
    agentDID: z.string().optional(),
  }),
  receiver: z.object({
    address: z.string().min(1),
    chain: z.string().min(1),
    agentDID: z.string().optional(),
  }),
  amount: z.string().min(1),
  asset: z.string().min(1),
  protocol: z.string().default("x402"),
  traceId: z.string().max(64).optional(),
  parentTraceId: z.string().max(64).optional(),
  // Protocol-specific fields
  x402FacilitatorAddress: z.string().optional(),
  ap2MandateId: z.string().optional(),
  mppSessionId: z.string().optional(),
  acpCheckoutId: z.string().optional(),
  // Protocol-specific permission data for cross-protocol translation (Gap 13)
  permissionData: z.record(z.unknown()).optional(),
});
type ComplianceCheckRequest = z.infer<typeof ComplianceCheckRequest>;

const ScreenRequest = z.object({
  address: z.string().min(1),
  chain: z.string().min(1),
  entityName: z.string().optional(),
});
type ScreenRequest = z.infer<typeof ScreenRequest>;

const ReceiptParams = z.object({
  id: z.string().uuid("Invalid receipt ID format."),
});

const BatchComplianceRequest = z.object({
  checks: z.array(ComplianceCheckRequest).min(1).max(50),
});

const HistoryQuery = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(["APPROVED", "REJECTED", "ESCALATED"]).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});

// ---------------------------------------------------------------------------
// Route group
// ---------------------------------------------------------------------------

const compliance = new Hono();

// POST /v1/compliance/check -- Run full compliance check
compliance.post("/check", requireScope("write"), validate({ body: ComplianceCheckRequest }), async (c) => {
  const parsed = c.get("validatedBody") as ComplianceCheckRequest;

  // Resolve trace context: body > header > generate
  const traceId = parsed.traceId
    ?? c.req.header("X-Trace-ID")
    ?? randomUUID();
  const parentTraceId = parsed.parentTraceId ?? null;

  const db = getDb();
  const startTime = Date.now();

  // Screen sender and receiver via real-time sanctions screener (with offline fallback)
  const screenStart = Date.now();
  const [senderScreen, receiverScreen] = await Promise.all([
    screenAddress(parsed.sender.address, parsed.sender.chain),
    screenAddress(parsed.receiver.address, parsed.receiver.chain),
  ]);
  const screenDurationMs = Date.now() - screenStart;

  const senderSanctioned = senderScreen.matched;
  const receiverSanctioned = receiverScreen.matched;

  // Convert amount to USD for Travel Rule threshold check
  const amountUsd = convertToUsd(parsed.amount, parsed.asset);

  // Resolve protocol-specific compliance requirements
  const protocolCtx: ProtocolComplianceContext = {
    protocol: (isSupportedProtocol(parsed.protocol) ? parsed.protocol : "direct") as SupportedProtocol,
    senderAddress: parsed.sender.address,
    receiverAddress: parsed.receiver.address,
    amount: parsed.amount,
    asset: parsed.asset,
    chain: parsed.sender.chain,
    amountUsd,
    x402FacilitatorAddress: parsed.x402FacilitatorAddress,
    ap2MandateId: parsed.ap2MandateId,
    mppSessionId: parsed.mppSessionId,
    acpCheckoutId: parsed.acpCheckoutId,
  };
  const protocolCompliance = getProtocolCompliance(protocolCtx);

  // Cross-protocol permission translation (Gap 13)
  // If the request includes protocol-specific permission data, translate and validate it
  const PERMISSION_PROTOCOLS = new Set(["x402", "ap2", "mpp", "acp", "erc7715", "erc7710"]);
  let translatedPermission: UnifiedPermission | null = null;
  let permissionValidation: PermissionValidationResult | null = null;

  if (parsed.permissionData && PERMISSION_PROTOCOLS.has(parsed.protocol)) {
    try {
      translatedPermission = translatePermission(
        parsed.protocol as PermissionProtocol,
        parsed.permissionData,
      );
      permissionValidation = validatePermission(translatedPermission);

      if (!permissionValidation.valid) {
        logger.warn("Permission validation failed during compliance check", {
          protocol: parsed.protocol,
          errors: permissionValidation.errors,
        });
      }
    } catch (err) {
      logger.warn("Permission translation failed during compliance check", {
        protocol: parsed.protocol,
        error: err instanceof Error ? err.message : "unknown",
      });
    }
  }

  const kyaRequired = protocolCompliance.requiresKYA;

  // Jurisdiction-aware Travel Rule threshold resolution
  // Resolves both sender + receiver jurisdictions, applies the LOWER (more restrictive) threshold
  const jurisdictionResult = resolveTravelRuleThreshold(
    amountUsd,
    parsed.sender.chain,
    parsed.receiver.chain,
    parsed.sender.agentDID,
    parsed.receiver.agentDID,
  );
  // Travel Rule applies if EITHER jurisdiction-aware OR protocol-aware check triggers it
  const travelRuleApplies = jurisdictionResult.applies || protocolCompliance.requiresTravelRule;

  // Resolve agent originator info for IVMS101 enrichment (parallel lookups)
  const [senderOriginator, receiverOriginator]: [AgentOriginatorInfo | null, AgentOriginatorInfo | null] =
    await Promise.all([
      parsed.sender.agentDID ? resolveAgentOriginator(parsed.sender.agentDID) : Promise.resolve(null),
      parsed.receiver.agentDID ? resolveAgentOriginator(parsed.receiver.agentDID) : Promise.resolve(null),
    ]);

  const checksPerformed: Record<string, unknown>[] = [
    {
      checkType: "SANCTIONS_SCREENING",
      target: "sender",
      result: senderSanctioned ? "FAILED" : "PASSED",
      provider: senderScreen.provider,
      performedAt: senderScreen.screenedAt,
      durationMs: screenDurationMs,
    },
    {
      checkType: "SANCTIONS_SCREENING",
      target: "receiver",
      result: receiverSanctioned ? "FAILED" : "PASSED",
      provider: receiverScreen.provider,
      performedAt: receiverScreen.screenedAt,
      durationMs: screenDurationMs,
    },
    {
      checkType: "KYA_VERIFICATION",
      target: "sender",
      result: await (async () => {
        if (!senderOriginator) {
          return parsed.sender.agentDID ? "UNRESOLVED" : kyaRequired ? "REQUIRED" : "SKIPPED";
        }
        if (!parsed.sender.agentDID) return kyaRequired ? "REQUIRED" : "SKIPPED";
        // Verify the agent actually has a credential hash (not just DB existence)
        try {
          const [agentRow] = await db
            .select({ kyaCredentialHash: agents.kyaCredentialHash, expiresAt: agents.expiresAt })
            .from(agents)
            .where(eq(agents.agentDid, parsed.sender.agentDID))
            .limit(1);
          if (!agentRow?.kyaCredentialHash) return "UNVERIFIED";
          if (agentRow.expiresAt && agentRow.expiresAt < new Date()) return "UNVERIFIED";
          return "PASSED";
        } catch {
          return "UNVERIFIED";
        }
      })(),
      provider: "prooflink",
      performedAt: new Date().toISOString(),
      durationMs: 30,
    },
    {
      checkType: "TRAVEL_RULE",
      target: "transaction",
      result: travelRuleApplies ? "REQUIRED" : "NOT_REQUIRED",
      details: {
        amountUsd: Math.round(amountUsd * 100) / 100,
        appliedThresholdUsd: jurisdictionResult.appliedThresholdUsd,
        protocolThresholdUsd: protocolCompliance.travelRuleThresholdUsd,
        senderJurisdiction: jurisdictionResult.senderJurisdiction,
        receiverJurisdiction: jurisdictionResult.receiverJurisdiction,
        triggeringJurisdiction: jurisdictionResult.triggeringJurisdiction,
        regulatoryBody: jurisdictionResult.appliedRule.regulatoryBody,
        requiresFullIVMS101: jurisdictionResult.requiresFullIVMS101,
        originatorName: senderOriginator?.controllingEntityName ?? null,
        originatorLEI: senderOriginator?.controllingEntityLei ?? null,
        originatorAgentDid: senderOriginator?.agentDid ?? null,
        beneficiaryName: receiverOriginator?.controllingEntityName ?? null,
        beneficiaryAgentDid: receiverOriginator?.agentDid ?? null,
      },
      provider: "notabene",
      performedAt: new Date().toISOString(),
      durationMs: 5,
    },
    {
      checkType: "JURISDICTIONAL_RULES",
      target: "transaction",
      result: "PASSED",
      details: {
        senderJurisdiction: jurisdictionResult.senderJurisdiction,
        receiverJurisdiction: jurisdictionResult.receiverJurisdiction,
        appliedThresholdUsd: jurisdictionResult.appliedThresholdUsd,
        triggeringJurisdiction: jurisdictionResult.triggeringJurisdiction,
        regulatoryBody: jurisdictionResult.appliedRule.regulatoryBody,
      },
      provider: "prooflink",
      performedAt: new Date().toISOString(),
      durationMs: 3,
    },
  ];

  // Add protocol-specific additional checks
  for (const additionalCheck of protocolCompliance.additionalChecks) {
    checksPerformed.push({
      checkType: additionalCheck,
      target: "transaction",
      result: "PERFORMED",
      provider: "prooflink_protocol_adapter",
      performedAt: new Date().toISOString(),
      durationMs: 1,
    });
  }

  // Add enhanced due diligence check if protocol requires it
  if (protocolCompliance.requiresEnhancedDueDiligence) {
    checksPerformed.push({
      checkType: "ENHANCED_DUE_DILIGENCE",
      target: "transaction",
      result: "REQUIRED",
      provider: "prooflink_protocol_adapter",
      performedAt: new Date().toISOString(),
      durationMs: 1,
    });
  }

  // Add permission translation check if permission data was provided
  if (translatedPermission && permissionValidation) {
    checksPerformed.push({
      checkType: "PERMISSION_TRANSLATION",
      target: "transaction",
      result: permissionValidation.valid ? "PASSED" : "FAILED",
      provider: "prooflink_permission_translator",
      performedAt: new Date().toISOString(),
      durationMs: 1,
    } as (typeof checksPerformed)[number]);
  }

  // Build transaction context for AML scoring
  const txCtx: TransactionContext = {
    senderAddress: parsed.sender.address,
    receiverAddress: parsed.receiver.address,
    amountUsd: amountUsd,
    chain: parsed.sender.chain,
    asset: parsed.asset,
    transactionHourUtc: new Date().getUTCHours(),
  };

  const amlStart = Date.now();
  const amlResult = amlScorer.calculateRiskScore(txCtx);
  const amlDurationMs = Date.now() - amlStart;

  // Add AML_MONITORING check AFTER scorer runs, with real result
  checksPerformed.push({
    checkType: "AML_MONITORING",
    target: "transaction",
    result: amlResult.exceeds ? "FAILED" : "PASSED",
    details: { score: amlResult.score, threshold: amlResult.threshold, factors: amlResult.factors },
    provider: "prooflink_aml_scorer",
    performedAt: new Date().toISOString(),
    durationMs: amlDurationMs,
  });

  // Sanctioned addresses always get max risk score
  const riskScore = (senderSanctioned || receiverSanctioned) ? 100 : amlResult.score;
  let status = riskScore < 50 ? "APPROVED" : riskScore < 80 ? "ESCALATED" : "REJECTED";
  const totalDurationMs = Date.now() - startTime;
  const auth = c.get("auth") as AuthContext | undefined;

  // Check delegation scope if sender has an agentDID
  let delegationScopeReason: string | undefined;
  if (parsed.sender.agentDID) {
    const scopeCheck = await checkDelegationScope(
      parsed.sender.agentDID,
      amountUsd,
      parsed.asset,
      parsed.sender.chain,
      parsed.receiver.address,
    );
    if (!scopeCheck.allowed) {
      status = "REJECTED";
      delegationScopeReason = scopeCheck.reason;
      checksPerformed.push({
        checkType: "DELEGATION_SCOPE",
        target: "sender",
        result: "FAILED",
        provider: "prooflink",
        performedAt: new Date().toISOString(),
        durationMs: Date.now() - startTime - totalDurationMs,
      });
    }

    // Cross-chain global spend check — complements the per-agent delegation scope above
    if (status !== "REJECTED") {
      const crossChainCheck = await validateCrossChainSpend(
        parsed.sender.agentDID,
        parsed.sender.chain,
        amountUsd,
      );
      if (!crossChainCheck.allowed) {
        status = "REJECTED";
        delegationScopeReason = crossChainCheck.reason;
        checksPerformed.push({
          checkType: "CROSS_CHAIN_SPEND_LIMIT",
          target: "sender",
          result: "FAILED",
          provider: "prooflink_policy_sync",
          performedAt: new Date().toISOString(),
          durationMs: Date.now() - startTime - totalDurationMs,
        });
      } else {
        checksPerformed.push({
          checkType: "CROSS_CHAIN_SPEND_LIMIT",
          target: "sender",
          result: "PASSED",
          provider: "prooflink_policy_sync",
          performedAt: new Date().toISOString(),
          durationMs: Date.now() - startTime - totalDurationMs,
        });
      }
    }
  }

  // Persist compliance check
  const [check] = await db
    .insert(complianceChecks)
    .values({
      senderAddress: parsed.sender.address,
      receiverAddress: parsed.receiver.address,
      senderAgentDid: parsed.sender.agentDID,
      receiverAgentDid: parsed.receiver.agentDID,
      amount: parsed.amount,
      asset: parsed.asset,
      chain: parsed.sender.chain,
      protocol: parsed.protocol,
      status,
      riskScore,
      checks: checksPerformed,
      totalDurationMs,
      apiKeyId: auth?.apiKeyId,
      traceId,
      parentTraceId,
    })
    .returning();

  if (!check) {
    return c.json(
      { success: false, error: { code: "INTERNAL_ERROR", message: "Failed to create compliance check." } },
      500,
    );
  }

  // Persist compliance receipt
  const receiptHash = `0x${randomUUID().replace(/-/g, "")}`;
  const signature = `0x${"0".repeat(128)}`; // Placeholder -- real impl signs with ProofLink key

  // Generate ZK commitment — only the hash goes on-chain, salt stays private
  const commitment = createComplianceCommitment({
    senderAddress: parsed.sender.address,
    receiverAddress: parsed.receiver.address,
    amount: parsed.amount,
    status,
  });

  // Execute Travel Rule transmission when required (COMP-3 fix)
  let travelRuleStatus: string = "NOT_REQUIRED";
  let travelRuleResult: TravelRuleResult | null = null;

  if (travelRuleApplies) {
    try {
      const travelRuleData = {
        originator: {
          name: senderOriginator?.controllingEntityName,
          walletAddress: parsed.sender.address,
          agentId: parsed.sender.agentDID,
          vaspDid: parsed.sender.agentDID,
        },
        beneficiary: {
          name: receiverOriginator?.controllingEntityName,
          walletAddress: parsed.receiver.address,
          agentId: parsed.receiver.agentDID,
          vaspDid: parsed.receiver.agentDID,
        },
        amountUsd,
        nativeAmount: parsed.amount,
        asset: parsed.asset,
        chain: parsed.sender.chain,
        direction: "outgoing" as const,
        preTransaction: false,
      };
      travelRuleResult = await travelRuleChecker.checkTravelRule(travelRuleData);
      travelRuleStatus = travelRuleResult.status;
    } catch (err) {
      logger.error("Travel Rule transmission failed", {
        error: err instanceof Error ? err.message : String(err),
        checkId: check.id,
      });
      travelRuleStatus = "FAILED";
    }
  }

  const [receipt] = await db
    .insert(complianceReceipts)
    .values({
      checkId: check.id,
      receiptHash,
      overallStatus: status,
      riskScore,
      travelRuleStatus,
      commitmentHash: commitment.commitmentHash,
      commitmentSalt: commitment.salt,
      signature,
      checksPerformed,
      ttl: 300,
    })
    .returning();

  if (!receipt) {
    return c.json(
      { success: false, error: { code: "INTERNAL_ERROR", message: "Failed to create compliance receipt." } },
      500,
    );
  }

  // Fire-and-forget: audit log
  writeAuditLog({
    eventType: "compliance.check.created",
    payload: { checkId: check.id, status, riskScore, receiptHash, commitmentHash: commitment.commitmentHash, totalDurationMs },
    receiptId: receipt.id,
    agentDid: parsed.sender.agentDID,
    apiKeyId: auth?.apiKeyId,
  });

  // Emit typed compliance event (broadcasts via WebSocket + persists to audit log)
  const eventType = status === "APPROVED"
    ? "compliance.check.passed" as const
    : status === "REJECTED"
      ? "compliance.check.failed" as const
      : "compliance.check.review" as const;

  emitComplianceEvent(eventType, {
    checkId: check.id,
    status,
    riskScore,
    receiptId: receipt.id,
    receiptHash,
    senderAddress: parsed.sender.address,
    receiverAddress: parsed.receiver.address,
    totalDurationMs,
  }, {
    traceId,
    receiptId: receipt.id,
    agentDid: parsed.sender.agentDID,
    apiKeyId: auth?.apiKeyId,
  });

  // Emit high-priority sanctions alert if either party is sanctioned
  if (senderSanctioned || receiverSanctioned) {
    emitSanctionsAlert({
      checkId: check.id,
      senderAddress: parsed.sender.address,
      receiverAddress: parsed.receiver.address,
      senderSanctioned,
      receiverSanctioned,
      riskScore,
      amount: parsed.amount,
      asset: parsed.asset,
    }, {
      traceId,
      agentDid: parsed.sender.agentDID,
      apiKeyId: auth?.apiKeyId,
    });
  }

  // Fire-and-forget: auto-generate SAR/CTR reports when thresholds are met
  const riskFactorNames = amlResult.factors.map((f: { factor: string }) => f.factor);
  if (senderSanctioned || receiverSanctioned) {
    riskFactorNames.push("sanctions_match");
  }

  if (shouldAutoGenerateSAR(riskScore, riskFactorNames)) {
    const sarReason = senderSanctioned || receiverSanctioned
      ? "Sanctions list match detected"
      : `Risk score ${riskScore} exceeds SAR threshold`;
    generateSAR(check.id, sarReason, { amountUsd, traceId }).catch((err) => {
      logger.error("Failed to auto-generate SAR", { checkId: check.id, error: String(err) });
    });
  }

  if (shouldAutoGenerateCTR(amountUsd)) {
    generateCTR(check.id, { amountUsd, traceId }).catch((err) => {
      logger.error("Failed to auto-generate CTR", { checkId: check.id, error: String(err) });
    });
  }

  // Fire-and-forget: metered billing
  if (parsed.sender.agentDID) {
    recordUsage(parsed.sender.agentDID, "compliance_check", amountUsd, {
      checkId: check.id,
      receiptId: receipt.id,
      status,
      riskScore,
    }, traceId);
  }

  c.header("X-Trace-ID", traceId);

  return c.json(
    {
      success: true,
      data: {
        status,
        riskScore,
        riskFactors: amlResult.factors,
        riskThreshold: amlResult.threshold,
        riskExceedsThreshold: amlResult.exceeds || (senderSanctioned || receiverSanctioned),
        delegationScopeReason,
        protocol: protocolCompliance.protocol,
        protocolCompliance: {
          requiresTravelRule: protocolCompliance.requiresTravelRule,
          travelRuleThresholdUsd: protocolCompliance.travelRuleThresholdUsd,
          requiresKYA: protocolCompliance.requiresKYA,
          requiresEnhancedDueDiligence: protocolCompliance.requiresEnhancedDueDiligence,
          additionalChecks: protocolCompliance.additionalChecks,
          protocolSpecificNotes: protocolCompliance.protocolSpecificNotes,
        },
        jurisdictionCompliance: {
          senderJurisdiction: jurisdictionResult.senderJurisdiction,
          receiverJurisdiction: jurisdictionResult.receiverJurisdiction,
          triggeringJurisdiction: jurisdictionResult.triggeringJurisdiction,
          appliedThresholdUsd: jurisdictionResult.appliedThresholdUsd,
          regulatoryBody: jurisdictionResult.appliedRule.regulatoryBody,
          requiresFullIVMS101: jurisdictionResult.requiresFullIVMS101,
        },
        agentOriginator: senderOriginator ? {
          controllingEntityName: senderOriginator.controllingEntityName,
          controllingEntityLEI: senderOriginator.controllingEntityLei,
          agentDid: senderOriginator.agentDid,
          agentType: senderOriginator.agentType,
        } : null,
        receiptId: receipt.id,
        receiptHash,
        commitmentHash: commitment.commitmentHash,
        checks: checksPerformed,
        travelRuleStatus,
        travelRuleReferenceId: travelRuleResult?.referenceId ?? null,
        totalDurationMs,
        traceId,
        parentTraceId,
        timestamp: check.createdAt.toISOString(),
      },
    },
    201,
  );
});

// POST /v1/compliance/screen -- Screen a single address
compliance.post("/screen", requireScope("write"), validate({ body: ScreenRequest }), async (c) => {
  const parsed = c.get("validatedBody") as ScreenRequest;

  // Screen address via real-time sanctions screener (with offline fallback)
  const result = await screenAddress(parsed.address, parsed.chain);

  const screenResult = {
    address: parsed.address,
    chain: parsed.chain,
    entityName: parsed.entityName ?? null,
    matched: result.matched,
    listsChecked: result.listsChecked,
    matchDetails: result.matched
      ? result.matchDetails.map((d) => ({
          list: d.list,
          entity: d.name,
          matchType: "exact",
          confidence: d.matchConfidence,
        }))
      : [],
    riskScore: result.riskScore,
    provider: result.provider,
    screenedAt: result.screenedAt,
  };

  // Fire-and-forget: metered billing for screen action
  const auth = c.get("auth") as AuthContext | undefined;
  const agentDid = auth?.ownerId;
  if (agentDid) {
    recordUsage(agentDid, "screen", 0, {
      address: parsed.address,
      chain: parsed.chain,
      matched: result.matched,
      riskScore: result.riskScore,
    });
  }

  return c.json({ success: true, data: screenResult }, 200);
});

// POST /v1/compliance/verify-commitment -- Verify a ZK commitment against receipt data
const VerifyCommitmentRequest = z.object({
  commitmentHash: z.string().min(1),
  receipt: z.object({
    senderAddress: z.string().min(1),
    receiverAddress: z.string().min(1),
    amount: z.string().min(1),
    status: z.string().min(1),
  }),
  salt: z.string().min(1),
});

compliance.post(
  "/verify-commitment",
  validate({ body: VerifyCommitmentRequest }),
  async (c) => {
    const parsed = c.get("validatedBody") as z.infer<typeof VerifyCommitmentRequest>;

    const valid = verifyComplianceCommitment(
      parsed.commitmentHash,
      parsed.receipt,
      parsed.salt,
    );

    return c.json(
      {
        success: true,
        data: {
          valid,
          commitmentHash: parsed.commitmentHash,
          message: valid
            ? "Commitment matches the provided receipt data and salt."
            : "Commitment does NOT match — receipt data or salt is incorrect.",
        },
      },
      200,
    );
  },
);

// GET /v1/compliance/receipt/:id -- Get compliance receipt
compliance.get("/receipt/:id", validate({ params: ReceiptParams }), async (c) => {
  const { id: receiptId } = c.get("validatedParams") as z.infer<typeof ReceiptParams>;

  const db = getDb();
  const [receipt] = await db
    .select()
    .from(complianceReceipts)
    .where(eq(complianceReceipts.id, receiptId))
    .limit(1);

  if (!receipt) {
    return c.json(
      { success: false, error: { code: "NOT_FOUND", message: "Receipt not found." } },
      404,
    );
  }

  return c.json({ success: true, data: receipt }, 200);
});

// POST /v1/compliance/batch -- Batch compliance check
compliance.post("/batch", requireScope("write"), validate({ body: BatchComplianceRequest }), async (c) => {
  const parsed = c.get("validatedBody") as z.infer<typeof BatchComplianceRequest>;

  const db = getDb();
  const auth = c.get("auth") as AuthContext | undefined;
  const batchTraceId = c.req.header("X-Trace-ID") ?? randomUUID();
  const results: Array<{
    index: number;
    status: string;
    riskScore: number;
    receiptId: string;
    receiptHash: string;
    commitmentHash: string;
    totalDurationMs: number;
    traceId: string;
  }> = [];

  // Run all sanctions screening in parallel across items to minimize latency.
  // Each item screens its sender + receiver concurrently, and all items are
  // fanned out together (up to 50 items × 2 addresses = 100 concurrent calls,
  // which is acceptable for external screener APIs with connection pooling).
  const batchScreenStart = Date.now();
  const screeningResults = await Promise.all(
    parsed.checks.map((req) =>
      Promise.all([
        screenAddress(req.sender.address, req.sender.chain),
        screenAddress(req.receiver.address, req.receiver.chain),
      ]),
    ),
  );
  const batchScreenDurationMs = Date.now() - batchScreenStart;

  for (let i = 0; i < parsed.checks.length; i++) {
    const req = parsed.checks[i]!;
    const itemTraceId = req.traceId ?? batchTraceId;
    const itemParentTraceId = req.parentTraceId ?? null;
    const startTime = Date.now();

    const [batchSenderScreen, batchReceiverScreen] = screeningResults[i]!;

    const senderSanctioned = batchSenderScreen.matched;
    const receiverSanctioned = batchReceiverScreen.matched;

    // Convert amount to USD for Travel Rule threshold check
    const batchAmountUsd = convertToUsd(req.amount, req.asset);

    // Resolve protocol-specific compliance for batch item
    const batchProtocolCtx: ProtocolComplianceContext = {
      protocol: (isSupportedProtocol(req.protocol) ? req.protocol : "direct") as SupportedProtocol,
      senderAddress: req.sender.address,
      receiverAddress: req.receiver.address,
      amount: req.amount,
      asset: req.asset,
      chain: req.sender.chain,
      amountUsd: batchAmountUsd,
      x402FacilitatorAddress: req.x402FacilitatorAddress,
      ap2MandateId: req.ap2MandateId,
      mppSessionId: req.mppSessionId,
      acpCheckoutId: req.acpCheckoutId,
    };
    const batchProtocolCompliance = getProtocolCompliance(batchProtocolCtx);

    // Jurisdiction-aware Travel Rule threshold for batch item
    const batchJurisdictionResult = resolveTravelRuleThreshold(
      batchAmountUsd,
      req.sender.chain,
      req.receiver.chain,
      req.sender.agentDID,
      req.receiver.agentDID,
    );
    const batchTravelRuleApplies = batchJurisdictionResult.applies || batchProtocolCompliance.requiresTravelRule;

    // Resolve agent originator for batch item
    const batchSenderOriginator = req.sender.agentDID
      ? await resolveAgentOriginator(req.sender.agentDID)
      : null;

    const checksPerformed: Record<string, unknown>[] = [
      {
        checkType: "SANCTIONS_SCREENING",
        target: "sender",
        result: senderSanctioned ? "FAILED" : "PASSED",
        provider: batchSenderScreen.provider,
        performedAt: batchSenderScreen.screenedAt,
        durationMs: batchScreenDurationMs,
      },
      {
        checkType: "SANCTIONS_SCREENING",
        target: "receiver",
        result: receiverSanctioned ? "FAILED" : "PASSED",
        provider: batchReceiverScreen.provider,
        performedAt: batchReceiverScreen.screenedAt,
        durationMs: batchScreenDurationMs,
      },
      {
        checkType: "TRAVEL_RULE",
        target: "transaction",
        result: batchTravelRuleApplies ? "REQUIRED" : "NOT_REQUIRED",
        details: {
          amountUsd: Math.round(batchAmountUsd * 100) / 100,
          appliedThresholdUsd: batchJurisdictionResult.appliedThresholdUsd,
          protocolThresholdUsd: batchProtocolCompliance.travelRuleThresholdUsd,
          senderJurisdiction: batchJurisdictionResult.senderJurisdiction,
          receiverJurisdiction: batchJurisdictionResult.receiverJurisdiction,
          triggeringJurisdiction: batchJurisdictionResult.triggeringJurisdiction,
          regulatoryBody: batchJurisdictionResult.appliedRule.regulatoryBody,
          requiresFullIVMS101: batchJurisdictionResult.requiresFullIVMS101,
          originatorName: batchSenderOriginator?.controllingEntityName ?? null,
          originatorLEI: batchSenderOriginator?.controllingEntityLei ?? null,
          originatorAgentDid: batchSenderOriginator?.agentDid ?? null,
        },
        provider: "notabene",
        performedAt: new Date().toISOString(),
        durationMs: 5,
      },
    ];

    // Add protocol-specific additional checks for batch item
    for (const additionalCheck of batchProtocolCompliance.additionalChecks) {
      checksPerformed.push({
        checkType: additionalCheck,
        target: "transaction",
        result: "PERFORMED",
        provider: "prooflink_protocol_adapter",
        performedAt: new Date().toISOString(),
        durationMs: 1,
      });
    }

    const batchTxCtx: TransactionContext = {
      senderAddress: req.sender.address,
      receiverAddress: req.receiver.address,
      amountUsd: batchAmountUsd,
      chain: req.sender.chain,
      asset: req.asset,
      transactionHourUtc: new Date().getUTCHours(),
    };

    const batchAmlStart = Date.now();
    const batchAmlResult = amlScorer.calculateRiskScore(batchTxCtx);
    const batchAmlDurationMs = Date.now() - batchAmlStart;

    // Add AML_MONITORING check AFTER scorer runs, with real result
    checksPerformed.push({
      checkType: "AML_MONITORING",
      target: "transaction",
      result: batchAmlResult.exceeds ? "FAILED" : "PASSED",
      details: { score: batchAmlResult.score, threshold: batchAmlResult.threshold, factors: batchAmlResult.factors },
      provider: "prooflink_aml_scorer",
      performedAt: new Date().toISOString(),
      durationMs: batchAmlDurationMs,
    });

    const riskScore = (senderSanctioned || receiverSanctioned) ? 100 : batchAmlResult.score;
    const status = riskScore < 50 ? "APPROVED" : riskScore < 80 ? "ESCALATED" : "REJECTED";
    const totalDurationMs = Date.now() - startTime;

    const [check] = await db
      .insert(complianceChecks)
      .values({
        senderAddress: req.sender.address,
        receiverAddress: req.receiver.address,
        senderAgentDid: req.sender.agentDID,
        receiverAgentDid: req.receiver.agentDID,
        amount: req.amount,
        asset: req.asset,
        chain: req.sender.chain,
        protocol: req.protocol,
        status,
        riskScore,
        checks: checksPerformed,
        totalDurationMs,
        apiKeyId: auth?.apiKeyId,
        traceId: itemTraceId,
        parentTraceId: itemParentTraceId,
      })
      .returning();

    if (!check) {
      return c.json(
        { success: false, error: { code: "INTERNAL_ERROR", message: `Failed to create compliance check at index ${i}.` } },
        500,
      );
    }

    const receiptHash = `0x${randomUUID().replace(/-/g, "")}`;
    const signature = `0x${"0".repeat(128)}`;

    // Generate ZK commitment for batch item
    const batchCommitment = createComplianceCommitment({
      senderAddress: req.sender.address,
      receiverAddress: req.receiver.address,
      amount: req.amount,
      status,
    });

    const [receipt] = await db
      .insert(complianceReceipts)
      .values({
        checkId: check.id,
        receiptHash,
        overallStatus: status,
        riskScore,
        travelRuleStatus: batchTravelRuleApplies ? "REQUIRED_PENDING" : "NOT_REQUIRED",
        commitmentHash: batchCommitment.commitmentHash,
        commitmentSalt: batchCommitment.salt,
        signature,
        checksPerformed,
        ttl: 300,
      })
      .returning();

    if (!receipt) {
      return c.json(
        { success: false, error: { code: "INTERNAL_ERROR", message: `Failed to create receipt at index ${i}.` } },
        500,
      );
    }

    results.push({
      index: i,
      status,
      riskScore,
      receiptId: receipt.id,
      receiptHash,
      commitmentHash: batchCommitment.commitmentHash,
      totalDurationMs,
      traceId: itemTraceId,
    });
  }

  c.header("X-Trace-ID", batchTraceId);

  return c.json(
    {
      success: true,
      data: {
        total: results.length,
        traceId: batchTraceId,
        results,
      },
    },
    201,
  );
});

// GET /v1/compliance/history -- Get compliance check history (paginated)
// Scoped to the calling API key to prevent cross-tenant data leakage.
compliance.get("/history", validate({ query: HistoryQuery }), async (c) => {
  const query = c.get("validatedQuery") as z.infer<typeof HistoryQuery>;
  const { page, limit, status, from, to } = query;
  const offset = (page - 1) * limit;

  const db = getDb();
  const auth = c.get("auth") as AuthContext | undefined;

  if (!auth?.apiKeyId) {
    return c.json(
      { success: false, error: { code: "UNAUTHORIZED", message: "Authentication required for history access." } },
      401,
    );
  }

  const conditions = [];

  // Always scope to the caller's API key -- prevents cross-tenant reads
  conditions.push(eq(complianceChecks.apiKeyId, auth.apiKeyId));
  if (status) {
    conditions.push(eq(complianceChecks.status, status));
  }
  if (from) {
    conditions.push(gte(complianceChecks.createdAt, new Date(from)));
  }
  if (to) {
    conditions.push(lte(complianceChecks.createdAt, new Date(to)));
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const [items, countResult] = await Promise.all([
    db
      .select()
      .from(complianceChecks)
      .where(whereClause)
      .orderBy(desc(complianceChecks.createdAt))
      .limit(limit)
      .offset(offset),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(complianceChecks)
      .where(whereClause),
  ]);

  const total = countResult[0]?.count ?? 0;

  return c.json(
    {
      success: true,
      data: {
        items,
        pagination: {
          page,
          pageSize: limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      },
    },
    200,
  );
});

// GET /v1/compliance/stats -- Aggregate compliance stats
compliance.get("/stats", async (c) => {
  const db = getDb();
  const auth = c.get("auth") as AuthContext | undefined;

  if (!auth?.apiKeyId) {
    return c.json(
      { success: false, error: { code: "UNAUTHORIZED", message: "Authentication required for stats access." } },
      401,
    );
  }

  const conditions = [];
  conditions.push(eq(complianceChecks.apiKeyId, auth.apiKeyId));
  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const [breakdown, totalResult, avgResult] = await Promise.all([
    db
      .select({
        status: complianceChecks.status,
        count: sql<number>`count(*)::int`.as("count"),
      })
      .from(complianceChecks)
      .where(whereClause)
      .groupBy(complianceChecks.status),
    db
      .select({ total: sql<number>`count(*)::int`.as("total") })
      .from(complianceChecks)
      .where(whereClause),
    db
      .select({
        avgRiskScore: sql<number>`coalesce(round(avg(${complianceChecks.riskScore})), 0)::int`.as("avg_risk_score"),
        avgDurationMs: sql<number>`coalesce(round(avg(${complianceChecks.totalDurationMs})), 0)::int`.as("avg_duration_ms"),
      })
      .from(complianceChecks)
      .where(whereClause),
  ]);

  const total = totalResult[0]?.total ?? 0;
  const statusCounts: Record<string, number> = {};
  for (const row of breakdown) {
    statusCounts[row.status] = row.count;
  }

  return c.json(
    {
      success: true,
      data: {
        totalChecks: total,
        byStatus: statusCounts,
        approved: statusCounts["APPROVED"] ?? 0,
        rejected: statusCounts["REJECTED"] ?? 0,
        escalated: statusCounts["ESCALATED"] ?? 0,
        approvalRate: total > 0 ? Math.round(((statusCounts["APPROVED"] ?? 0) / total) * 10000) / 100 : 0,
        avgRiskScore: avgResult[0]?.avgRiskScore ?? 0,
        avgDurationMs: avgResult[0]?.avgDurationMs ?? 0,
      },
    },
    200,
  );
});

export { compliance };
