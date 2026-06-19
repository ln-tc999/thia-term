import { createHash } from "node:crypto";
import type {
  AMLRiskScore,
  CheckPerformed,
  ComplianceDecision,
  ComplianceDecisionStatus,
  ComplianceReceipt,
  SanctionsCheckResult,
  TravelRuleData,
  TravelRuleStatus,
} from "@prooflink/shared";
import { AMLScorer, type ScoringRule, type TransactionContext } from "../aml/scorer.js";
import { LRUCache } from "../cache.js";
import type { ProofLinkConfig } from "../config.js";
import {
  type ProofLinkEvents,
  type ProofLinkEventListener,
  type ProofLinkEventName,
  TypedEventEmitter,
} from "../events/emitter.js";
import {
  KYAVerifier,
  type KYAVerificationResult,
  type VerifiableCredential,
} from "../identity/kya-verifier.js";
import {
  type ProofLinkPlugin,
  type PluginContext,
  type PluginDecisionContext,
  PluginManager,
} from "../plugins/index.js";
import { ReceiptIssuer, generateReceiptId } from "../receipts/issuer.js";
import { SanctionsScreener, type SanctionsProvider } from "../sanctions/screener.js";
import { ComplianceMetrics, type MetricReporter } from "../telemetry/metrics.js";
import {
  TravelRuleChecker,
  type TravelRuleProvider,
  type TravelRuleResult,
} from "../travel-rule/checker.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Full compliance request sent to the ProofLink engine. */
export interface ComplianceRequest {
  /** Sender wallet address or Agent DID */
  sender: string;
  /** Receiver wallet address or Agent DID */
  receiver: string;
  /** Transaction amount in USD equivalent */
  amountUsd: number;
  /** Asset identifier (e.g., "USDC", "EURC") */
  asset: string;
  /** CAIP-2 chain identifier (e.g., "eip155:1", "eip155:8453") */
  chain: string;
  /** Payment protocol used */
  protocol?: "x402" | "mpp" | "ap2" | "acp" | "direct";
  /** Sender jurisdiction (ISO 3166-1 alpha-2) */
  senderJurisdiction?: string;
  /** Receiver jurisdiction (ISO 3166-1 alpha-2) */
  receiverJurisdiction?: string;
  /** Optional KYA credential for agent verification */
  kyaCredential?: VerifiableCredential;
  /** Optional transaction context for AML scoring enrichment */
  transactionContext?: Partial<TransactionContext>;
  /** Optional transaction hash (for post-settlement receipts) */
  txHash?: string;
}

export type { ProofLinkEvents };

// ---------------------------------------------------------------------------
// Batch processing
// ---------------------------------------------------------------------------

const BATCH_MAX_SIZE = 100;
const BATCH_CONCURRENCY_LIMIT = 20;

// ---------------------------------------------------------------------------
// ProofLinkEngine
// ---------------------------------------------------------------------------

/**
 * ProofLink compliance decision engine.
 *
 * Orchestrates the full compliance pipeline:
 * 1. Identity resolution (KYA credential verification + ERC-8004 lookup)
 * 2. Parallel sanctions screening on sender and receiver (<100ms target)
 * 3. AML risk scoring (<50ms target)
 * 4. Travel Rule check (if amount exceeds jurisdiction threshold)
 * 5. Jurisdictional rules (GENIUS Act, MiCA thresholds)
 * 6. Compliance receipt issuance
 *
 * Features:
 * - Typed EventEmitter for decision, sanctions_match, escalation, error events
 * - Batch compliance checking with concurrency control
 * - In-memory telemetry/metrics with external reporter support
 * - Plugin system with lifecycle hooks
 *
 * Total pipeline target: <500ms
 */
export class ProofLinkEngine {
  private readonly config: ProofLinkConfig;
  private readonly sanctionsScreener: SanctionsScreener;
  private readonly amlScorer: AMLScorer;
  private readonly travelRuleChecker: TravelRuleChecker;
  private readonly kyaVerifier: KYAVerifier;
  private readonly receiptIssuer: ReceiptIssuer;
  private readonly metrics: ComplianceMetrics;
  private readonly pluginManager: PluginManager;
  private readonly events: TypedEventEmitter<ProofLinkEvents>;

  constructor(
    config: ProofLinkConfig,
    options?: {
      travelRuleProvider?: TravelRuleProvider;
      trustedIssuers?: string[];
      sanctionsProviders?: SanctionsProvider[];
      sanctionsAggregate?: boolean;
      amlRules?: ScoringRule[];
    },
  ) {
    this.events = new TypedEventEmitter<ProofLinkEvents>();
    this.config = config;
    this.sanctionsScreener = new SanctionsScreener(config, {
      providers: options?.sanctionsProviders,
      aggregate: options?.sanctionsAggregate,
    });
    this.amlScorer = new AMLScorer(config, options?.amlRules);
    this.travelRuleChecker = new TravelRuleChecker(
      config,
      options?.travelRuleProvider,
    );
    this.kyaVerifier = new KYAVerifier(config, options?.trustedIssuers);
    this.receiptIssuer = new ReceiptIssuer(config);
    this.metrics = new ComplianceMetrics();
    this.pluginManager = new PluginManager();
  }

  // -------------------------------------------------------------------------
  // Plugin management
  // -------------------------------------------------------------------------

  /**
   * Register a plugin to extend engine behavior.
   */
  async registerPlugin(plugin: ProofLinkPlugin): Promise<void> {
    await this.pluginManager.registerPlugin(plugin);
  }

  /**
   * Unregister a plugin by name.
   */
  async unregisterPlugin(name: string): Promise<boolean> {
    return this.pluginManager.unregisterPlugin(name);
  }

  /**
   * Get all registered plugins.
   */
  getPlugins(): ReadonlyArray<ProofLinkPlugin> {
    return this.pluginManager.getPlugins();
  }

  // -------------------------------------------------------------------------
  // Event subscription (type-safe)
  // -------------------------------------------------------------------------

  /**
   * Register a listener for a typed ProofLink event.
   */
  on<K extends ProofLinkEventName>(
    event: K,
    listener: ProofLinkEventListener<K>,
  ): this {
    this.events.on(event, listener);
    return this;
  }

  /**
   * Register a one-time listener for a typed ProofLink event.
   */
  once<K extends ProofLinkEventName>(
    event: K,
    listener: ProofLinkEventListener<K>,
  ): this {
    this.events.once(event, listener);
    return this;
  }

  /**
   * Remove a listener for a typed ProofLink event.
   */
  off<K extends ProofLinkEventName>(
    event: K,
    listener: ProofLinkEventListener<K>,
  ): this {
    this.events.off(event, listener);
    return this;
  }

  // -------------------------------------------------------------------------
  // Metrics
  // -------------------------------------------------------------------------

  /**
   * Add an external metric reporter (StatsD, Prometheus, etc.).
   */
  addMetricReporter(reporter: MetricReporter): void {
    this.metrics.addReporter(reporter);
  }

  /**
   * Get current telemetry metrics snapshot.
   */
  getMetrics() {
    return this.metrics.getMetrics();
  }

  // -------------------------------------------------------------------------
  // Single compliance check
  // -------------------------------------------------------------------------

  /**
   * Execute the full compliance pipeline.
   *
   * @param request - Full compliance request with sender, receiver, amount, etc.
   * @returns Compliance decision with status, risk score, checks, and receipt
   */
  async checkCompliance(request: ComplianceRequest): Promise<ComplianceDecision> {
    const start = Date.now();
    const checks: CheckPerformed[] = [];
    let overallStatus: ComplianceDecisionStatus = "APPROVED";
    let travelRuleStatus: TravelRuleStatus = "NOT_REQUIRED";

    // Plugin: beforeCheck
    const pluginCtx: PluginContext = {
      request,
      metadata: {},
    };
    try {
      await this.pluginManager.executeBeforeCheck(pluginCtx);
    } catch (error) {
      this.emitError(error, "plugin:beforeCheck");
    }

    // ─── Step 0: Allowlist / Blocklist (instant) ────────────────────────
    const senderLower = request.sender.toLowerCase();
    const receiverLower = request.receiver.toLowerCase();
    const allowlistLower = this.config.allowlist.map((a) => a.toLowerCase());
    const blocklistLower = this.config.blocklist.map((a) => a.toLowerCase());

    const senderAllowlisted = allowlistLower.includes(senderLower);
    const receiverAllowlisted = allowlistLower.includes(receiverLower);

    if (
      blocklistLower.includes(senderLower) ||
      blocklistLower.includes(receiverLower)
    ) {
      checks.push({
        checkType: "SANCTIONS_SCREENING",
        result: "FAILED",
        performedAt: new Date().toISOString(),
        provider: "blocklist",
        detail: "Address is on the blocklist",
      });
      const decision = this.buildDecision(
        "REJECTED",
        100,
        checks,
        travelRuleStatus,
        start,
        request,
      );
      await this.postDecision(decision, request, pluginCtx, start);
      return decision;
    }

    // ─── Step 1: Identity Resolution (KYA) ──────────────────────────────
    let kyaResult: KYAVerificationResult | undefined;
    if (request.kyaCredential) {
      try {
        kyaResult = await this.kyaVerifier.verifyCredential(
          request.kyaCredential,
          request.amountUsd,
          request.senderJurisdiction,
        );

        checks.push({
          checkType: "KYA_VERIFICATION",
          result: kyaResult.verified ? "PASSED" : "FAILED",
          performedAt: new Date().toISOString(),
          provider: "prooflink_kya",
          detail: kyaResult.verified
            ? `Agent ${kyaResult.agentDid} verified`
            : `KYA failed: ${kyaResult.errors.join("; ")}`,
        });

        if (!kyaResult.verified) {
          overallStatus = "REJECTED";
          const decision = this.buildDecision(
            overallStatus,
            100,
            checks,
            travelRuleStatus,
            start,
            request,
          );
          await this.postDecision(decision, request, pluginCtx, start);
          return decision;
        }
      } catch (error) {
        checks.push({
          checkType: "KYA_VERIFICATION",
          result: this.config.failOpen ? "SKIPPED" : "FAILED",
          performedAt: new Date().toISOString(),
          provider: "prooflink_kya",
          detail: `KYA error: ${error instanceof Error ? error.message : String(error)}`,
        });
        if (!this.config.failOpen) {
          const decision = this.buildDecision("REJECTED", 100, checks, travelRuleStatus, start, request);
          await this.postDecision(decision, request, pluginCtx, start);
          return decision;
        }
      }
    }

    // ─── Step 2: Parallel Sanctions Screening (<100ms) ──────────────────
    const [senderScreen, receiverScreen] = await Promise.all([
      this.screenAddress(request.sender, request.chain),
      this.screenAddress(request.receiver, request.chain),
    ]);

    checks.push(
      this.buildSanctionsCheck(request.sender, senderScreen, "sender"),
      this.buildSanctionsCheck(request.receiver, receiverScreen, "receiver"),
    );

    if (senderScreen.matched) {
      this.events.emit("sanctions:match", {
        address: request.sender,
        result: senderScreen,
      });
    } else {
      this.events.emit("sanctions:clean", { address: request.sender });
    }
    if (receiverScreen.matched) {
      this.events.emit("sanctions:match", {
        address: request.receiver,
        result: receiverScreen,
      });
    } else {
      this.events.emit("sanctions:clean", { address: request.receiver });
    }

    if (senderScreen.matched || receiverScreen.matched) {
      const decision = this.buildDecision("REJECTED", 100, checks, travelRuleStatus, start, request);
      await this.postDecision(decision, request, pluginCtx, start);
      return decision;
    }

    // ─── Allowlist fast-path: sanctions passed, skip AML & travel rule ──
    if (senderAllowlisted || receiverAllowlisted) {
      const allowlistedAddr = senderAllowlisted ? request.sender : request.receiver;
      checks.push({
        checkType: "AML_MONITORING",
        result: "SKIPPED",
        performedAt: new Date().toISOString(),
        provider: "allowlist",
        detail: `${allowlistedAddr} is on the allowlist — AML risk scoring skipped`,
      });
      checks.push({
        checkType: "TRAVEL_RULE",
        result: "SKIPPED",
        performedAt: new Date().toISOString(),
        provider: "allowlist",
        detail: `${allowlistedAddr} is on the allowlist — travel rule check skipped`,
      });
      const decision = this.buildDecision("APPROVED", 0, checks, "NOT_REQUIRED", start, request);
      await this.postDecision(decision, request, pluginCtx, start);
      return decision;
    }

    // ─── Step 3: AML Risk Scoring (<50ms) ───────────────────────────────
    const txContext: TransactionContext = {
      senderAddress: request.sender,
      receiverAddress: request.receiver,
      amountUsd: request.amountUsd,
      chain: request.chain,
      asset: request.asset,
      ...request.transactionContext,
    };

    const amlScore = this.amlScorer.calculateRiskScore(txContext);

    checks.push({
      checkType: "AML_MONITORING",
      result: amlScore.exceeds ? "FAILED" : "PASSED",
      performedAt: amlScore.evaluatedAt,
      provider: "prooflink_aml",
      detail: `Score ${amlScore.score}/${amlScore.threshold} — ${amlScore.factors.map((f) => `${f.factor}: ${f.detail}`).join("; ")}`,
    });

    if (amlScore.exceeds) {
      this.events.emit("aml:high_risk", { context: txContext, score: amlScore });
      const decision = this.buildDecision("REJECTED", amlScore.score, checks, travelRuleStatus, start, request);
      await this.postDecision(decision, request, pluginCtx, start);
      return decision;
    }

    if (amlScore.score > this.config.escalationThreshold) {
      this.events.emit("aml:high_risk", { context: txContext, score: amlScore });
      overallStatus = "ESCALATED";
    }

    // Plugin: afterCheck
    try {
      await this.pluginManager.executeAfterCheck(pluginCtx);
    } catch (error) {
      this.emitError(error, "plugin:afterCheck");
    }

    // ─── Step 4: Travel Rule Check (if amount > threshold) ──────────────
    const travelRuleResult = await this.performTravelRuleCheck(request);

    if (travelRuleResult) {
      travelRuleStatus = travelRuleResult.status;

      if (travelRuleResult.required) {
        this.events.emit("travel_rule:required", {
          amount: request.amountUsd,
          jurisdiction: travelRuleResult.triggeringJurisdiction ?? "UNKNOWN",
        });
      }

      checks.push({
        checkType: "TRAVEL_RULE",
        result:
          travelRuleResult.status === "FAILED" ? "FAILED" : "PASSED",
        performedAt: new Date().toISOString(),
        provider: travelRuleResult.referenceId
          ? `notabene:${travelRuleResult.referenceId}`
          : "prooflink_travel_rule",
        detail: travelRuleResult.required
          ? `Required by ${travelRuleResult.triggeringJurisdiction} (threshold $${travelRuleResult.thresholdUsd}): ${travelRuleResult.status}`
          : `Not required (below $${travelRuleResult.thresholdUsd} threshold)`,
      });

      if (travelRuleResult.status === "FAILED" && !this.config.failOpen) {
        const decision = this.buildDecision("REJECTED", amlScore.score, checks, travelRuleStatus, start, request);
        await this.postDecision(decision, request, pluginCtx, start);
        return decision;
      }
    }

    // ─── Step 5: Jurisdictional Rules ───────────────────────────────────
    const jurisdictionCheck = this.checkJurisdictionalRules(request);
    checks.push(jurisdictionCheck);

    if (jurisdictionCheck.result === "FAILED") {
      const decision = this.buildDecision("REJECTED", amlScore.score, checks, travelRuleStatus, start, request);
      await this.postDecision(decision, request, pluginCtx, start);
      return decision;
    }

    // ─── Build final decision ───────────────────────────────────────────
    const decision = this.buildDecision(
      overallStatus,
      amlScore.score,
      checks,
      travelRuleStatus,
      start,
      request,
    );

    await this.postDecision(decision, request, pluginCtx, start);
    return decision;
  }

  // -------------------------------------------------------------------------
  // Batch compliance checking
  // -------------------------------------------------------------------------

  /**
   * Check compliance for multiple requests in parallel with concurrency control.
   *
   * - Maximum 100 requests per batch
   * - Processes up to 20 requests concurrently
   * - Shared address caching across requests (via the underlying LRU cache)
   *
   * @param requests - Array of compliance requests (max 100)
   * @returns Array of compliance decisions in the same order as requests
   */
  async checkComplianceBatch(
    requests: ComplianceRequest[],
  ): Promise<ComplianceDecision[]> {
    if (requests.length === 0) return [];
    if (requests.length > BATCH_MAX_SIZE) {
      throw new Error(
        `Batch size ${requests.length} exceeds maximum of ${BATCH_MAX_SIZE}`,
      );
    }

    // Pre-warm cache for shared addresses
    const uniqueAddresses = new Map<string, string>(); // address -> chain
    for (const req of requests) {
      const sKey = `${req.sender.toLowerCase()}:${req.chain}`;
      const rKey = `${req.receiver.toLowerCase()}:${req.chain}`;
      if (!uniqueAddresses.has(sKey)) {
        uniqueAddresses.set(sKey, req.chain);
      }
      if (!uniqueAddresses.has(rKey)) {
        uniqueAddresses.set(rKey, req.chain);
      }
    }

    // Pre-screen unique addresses to warm the cache
    const screeningEntries = Array.from(uniqueAddresses.entries()).map(
      ([key, chain]) => ({
        address: key.split(":")[0]!,
        chain,
      }),
    );

    // Screen in batches of concurrency limit
    for (let i = 0; i < screeningEntries.length; i += BATCH_CONCURRENCY_LIMIT) {
      const batch = screeningEntries.slice(i, i + BATCH_CONCURRENCY_LIMIT);
      await Promise.allSettled(
        batch.map((entry) =>
          this.screenAddress(entry.address, entry.chain).catch((error) => {
            this.emitError(error, `batch:prescreen:${entry.address}`);
          }),
        ),
      );
    }

    // Process compliance checks with concurrency control
    const results: ComplianceDecision[] = new Array(requests.length);
    const queue = requests.map((req, idx) => ({ req, idx }));

    const processItem = async () => {
      while (queue.length > 0) {
        const item = queue.shift();
        if (!item) break;

        try {
          results[item.idx] = await this.checkCompliance(item.req);
        } catch (error) {
          this.emitError(error, `batch:check:${item.idx}`);
          // Produce a rejected decision on unrecoverable errors
          results[item.idx] = this.buildDecision(
            "REJECTED",
            100,
            [
              {
                checkType: "AML_MONITORING",
                result: "FAILED",
                performedAt: new Date().toISOString(),
                provider: "prooflink_batch",
                detail: `Batch processing error: ${error instanceof Error ? error.message : String(error)}`,
              },
            ],
            "NOT_REQUIRED",
            Date.now(),
            item.req,
          );
        }
      }
    };

    const workers = Array.from(
      { length: Math.min(BATCH_CONCURRENCY_LIMIT, requests.length) },
      () => processItem(),
    );

    await Promise.all(workers);
    return results;
  }

  // -------------------------------------------------------------------------
  // Convenience methods
  // -------------------------------------------------------------------------

  /**
   * Screen a single address against sanctions lists.
   */
  async screenAddress(
    address: string,
    chain: string,
  ): Promise<SanctionsCheckResult> {
    return this.sanctionsScreener.screenAddress(address, chain);
  }

  /**
   * Calculate AML risk score for a transaction.
   */
  async calculateRiskScore(tx: TransactionContext): Promise<AMLRiskScore> {
    return this.amlScorer.calculateRiskScore(tx);
  }

  /**
   * Check Travel Rule requirements for transaction data.
   */
  async checkTravelRule(data: TravelRuleData): Promise<TravelRuleResult> {
    return this.travelRuleChecker.checkTravelRule(data);
  }

  /**
   * Issue a compliance receipt for a given decision.
   */
  async issueReceipt(
    decision: ComplianceDecision,
    request: ComplianceRequest,
  ): Promise<ComplianceReceipt> {
    return this.receiptIssuer.issueReceipt(decision, {
      senderAddress: request.sender,
      receiverAddress: request.receiver,
      amountUsd: request.amountUsd,
      chain: request.chain,
      txHash: request.txHash,
    });
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private async postDecision(
    decision: ComplianceDecision,
    request: ComplianceRequest,
    pluginCtx: PluginContext,
    startMs: number,
  ): Promise<void> {
    const latencyMs = Date.now() - startMs;
    this.metrics.recordDecision(decision.status, latencyMs);

    // Plugin: beforeDecision
    const decisionCtx: PluginDecisionContext = {
      ...pluginCtx,
      decision,
    };
    try {
      await this.pluginManager.executeBeforeDecision(decisionCtx);
    } catch (error) {
      this.emitError(error, "plugin:beforeDecision");
    }

    // Emit typed events
    this.events.emit("compliance:decision", { request, decision });

    if (decision.status === "APPROVED") {
      this.events.emit("compliance:approved", { request, decision });
    } else if (decision.status === "REJECTED") {
      const failedChecks = decision.checks
        .filter((c) => c.result === "FAILED")
        .map((c) => c.detail)
        .join("; ");
      this.events.emit("compliance:rejected", {
        request,
        decision,
        reason: failedChecks || "Unknown rejection reason",
      });
    } else if (decision.status === "ESCALATED") {
      this.events.emit("compliance:escalated", { request, decision });
    }

    // Plugin: afterDecision
    try {
      await this.pluginManager.executeAfterDecision(decisionCtx);
    } catch (error) {
      this.emitError(error, "plugin:afterDecision");
    }
  }

  private emitError(error: unknown, source: string): void {
    const err =
      error instanceof Error ? error : new Error(String(error));
    this.events.emit("error", { source, error: err });
  }

  private async performTravelRuleCheck(
    request: ComplianceRequest,
  ): Promise<TravelRuleResult | null> {
    // Collect all known jurisdictions and use the most restrictive (lowest) threshold
    const jurisdictions: string[] = [];
    if (request.senderJurisdiction) jurisdictions.push(request.senderJurisdiction);
    if (request.receiverJurisdiction) jurisdictions.push(request.receiverJurisdiction);
    if (jurisdictions.length === 0) jurisdictions.push("US");

    let lowestThreshold = Infinity;
    let triggeringJurisdiction = jurisdictions[0]!;
    for (const jur of jurisdictions) {
      const t = this.travelRuleChecker.getThresholdForJurisdiction(jur);
      if (t < lowestThreshold) {
        lowestThreshold = t;
        triggeringJurisdiction = jur;
      }
    }
    const threshold = lowestThreshold;

    if (request.amountUsd < threshold) {
      return {
        required: false,
        status: "NOT_REQUIRED",
        triggeringJurisdiction,
        thresholdUsd: threshold,
        latencyMs: 0,
      };
    }

    const travelRuleData: TravelRuleData = {
      originator: {
        walletAddress: request.sender,
      },
      beneficiary: {
        walletAddress: request.receiver,
      },
      amountUsd: request.amountUsd,
      asset: request.asset,
      chain: request.chain,
      direction: "outgoing",
      preTransaction: true,
    };

    return this.travelRuleChecker.checkTravelRule(travelRuleData);
  }

  private checkJurisdictionalRules(request: ComplianceRequest): CheckPerformed {
    const now = new Date().toISOString();
    const errors: string[] = [];

    if (request.senderJurisdiction) {
      if (
        this.config.restrictedJurisdictions.includes(
          request.senderJurisdiction,
        )
      ) {
        errors.push(
          `Sender jurisdiction ${request.senderJurisdiction} is restricted`,
        );
      }
    }

    if (request.receiverJurisdiction) {
      if (
        this.config.restrictedJurisdictions.includes(
          request.receiverJurisdiction,
        )
      ) {
        errors.push(
          `Receiver jurisdiction ${request.receiverJurisdiction} is restricted`,
        );
      }
    }

    // MiCA: For EU jurisdictions, check that stablecoin is MiCA-authorized
    const euJurisdictions = [
      "DE", "FR", "IT", "ES", "NL", "BE", "AT", "IE", "PT", "FI",
      "GR", "LU", "SK", "SI", "EE", "LV", "LT", "CY", "MT", "HR",
    ];

    const isEUTransaction =
      (request.senderJurisdiction &&
        euJurisdictions.includes(request.senderJurisdiction)) ||
      (request.receiverJurisdiction &&
        euJurisdictions.includes(request.receiverJurisdiction));

    if (isEUTransaction && request.asset === "USDT") {
      errors.push(
        "USDT is not MiCA-authorized as an EMT in the EU as of 2026",
      );
    }

    return {
      checkType: "JURISDICTIONAL_RULES",
      result: errors.length === 0 ? "PASSED" : "FAILED",
      performedAt: now,
      provider: "prooflink_jurisdiction",
      detail:
        errors.length === 0
          ? "All jurisdictional rules passed"
          : errors.join("; "),
    };
  }

  private buildSanctionsCheck(
    address: string,
    result: SanctionsCheckResult,
    role: string,
  ): CheckPerformed {
    return {
      checkType: "SANCTIONS_SCREENING",
      result: result.matched ? "FAILED" : "PASSED",
      performedAt: result.screenedAt,
      provider: result.provider,
      detail: result.matched
        ? `${role} ${address} matched: ${result.matchDetails.map((m) => m.name).join(", ")}`
        : `${role} ${address} clean`,
    };
  }

  private buildDecision(
    status: ComplianceDecisionStatus,
    riskScore: number,
    checks: CheckPerformed[],
    travelRuleStatus: TravelRuleStatus,
    startMs: number,
    request?: ComplianceRequest,
  ): ComplianceDecision {
    const now = new Date().toISOString();
    const receiptId = request
      ? generateReceiptId({
          senderAddress: request.sender,
          receiverAddress: request.receiver,
          amountUsd: request.amountUsd,
          chain: request.chain,
          timestamp: now,
        })
      : `pl-${Date.now().toString(16)}-${Math.random().toString(36).slice(2, 8)}`;
    const receiptData = JSON.stringify({ receiptId, status, riskScore, checks, travelRuleStatus });
    const receiptHash = `0x${createHash("sha256").update(receiptData).digest("hex")}`;

    // Derive blockReason from the last failing check when status is REJECTED/ESCALATED
    let blockReason: string | undefined;
    if (status === "REJECTED" || status === "ESCALATED") {
      const failedCheck = [...checks].reverse().find((c) => c.result === "FAILED");
      if (failedCheck) {
        blockReason = failedCheck.detail ?? `${failedCheck.checkType} failed`;
      }
    }

    return {
      status,
      riskScore,
      receiptId,
      receiptHash,
      checks,
      travelRuleStatus,
      blockReason,
      timestamp: now,
      ttl: 300,
    };
  }
}
