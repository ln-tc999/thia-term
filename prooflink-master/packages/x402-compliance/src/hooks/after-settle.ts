import type {
  SettleResultContext,
  AfterHookResult,
  ProofLinkConfig,
  ProofLinkReceipt,
  PendingDecision,
  ComplianceEventHandler,
} from "../types.js";
import { extractSenderAddress } from "../address.js";
import { payloadKey } from "./before-verify.js";

// ---------------------------------------------------------------------------
// Service interfaces
// ---------------------------------------------------------------------------

export interface ProofLinkService {
  computeHash(receipt: ProofLinkReceipt): string;
  attestOnChain(receipt: ProofLinkReceipt): Promise<string | null>;
  storeAuditRecord(receipt: ProofLinkReceipt): Promise<void>;
}

export interface InvoiceService {
  generate(receipt: ProofLinkReceipt): Promise<string | null>;
}

// ---------------------------------------------------------------------------
// After-settle hook factory
// ---------------------------------------------------------------------------

export interface AfterSettleDeps {
  config: ProofLinkConfig;
  proofLinkService: ProofLinkService;
  invoiceService?: InvoiceService;
  pendingDecisions: Map<string, PendingDecision>;
  settledProofLinks: Map<string, { hash: string; timestamp: number }>;
  onEvent?: ComplianceEventHandler;
}

/**
 * Creates the onAfterSettle hook.
 *
 * Responsibilities:
 * 1. Generate ProofLink compliance receipt
 * 2. Emit compliance event
 * 3. Store audit log
 * 4. Optionally anchor receipt on-chain (async, non-blocking)
 */
export function createAfterSettleHook(deps: AfterSettleDeps) {
  const { config, proofLinkService, invoiceService, pendingDecisions, settledProofLinks, onEvent } =
    deps;

  return async function onAfterSettle(ctx: SettleResultContext): Promise<AfterHookResult> {
    const { paymentPayload, requirements, result } = ctx;
    const key = payloadKey(paymentPayload);
    const decision = pendingDecisions.get(key);

    if (!decision) {
      config.logger?.warn("No compliance decision found for settled payment — skipping receipt generation");
      return;
    }

    const sender = extractSenderAddress(paymentPayload) ?? "unknown";

    // -------------------------------------------------------------------
    // 1. Generate ProofLink compliance receipt
    // -------------------------------------------------------------------
    const receipt: ProofLinkReceipt = {
      version: 1,
      transactionHash: result.transaction,
      network: result.network,
      sender,
      receiver: requirements.payTo,
      amount: requirements.maxAmountRequired,
      asset: requirements.asset,
      complianceChecks: decision.checks,
      riskScore: decision.riskScore,
      proofLinkHash: "", // computed below
      travelRuleRef: decision.travelRuleRef,
      createdAt: new Date().toISOString(),
    };

    // Compute deterministic hash
    receipt.proofLinkHash = proofLinkService.computeHash(receipt);

    // -------------------------------------------------------------------
    // 2. Emit compliance event
    // -------------------------------------------------------------------
    onEvent?.({
      type: "compliance:settle:completed",
      timestamp: Date.now(),
      payload: {
        sender,
        receiver: requirements.payTo,
        network: result.network,
        amount: requirements.maxAmountRequired,
        transactionHash: result.transaction,
        proofLinkHash: receipt.proofLinkHash,
        riskScore: decision.riskScore,
      },
    });

    // -------------------------------------------------------------------
    // 3. Store audit log (async, non-blocking)
    // -------------------------------------------------------------------
    void proofLinkService.storeAuditRecord(receipt).catch((err: unknown) => {
      config.logger?.error("Audit record storage failed", err);
    });

    // -------------------------------------------------------------------
    // 4. Optionally anchor receipt on-chain via EAS (async, non-blocking)
    // -------------------------------------------------------------------
    if (config.eas) {
      void proofLinkService
        .attestOnChain(receipt)
        .then((uid) => {
          if (uid) {
            receipt.attestationUid = uid;
            onEvent?.({
              type: "compliance:receipt:attested",
              timestamp: Date.now(),
              payload: { proofLinkHash: receipt.proofLinkHash, transactionHash: result.transaction },
            });
          }
        })
        .catch((err: unknown) => {
          config.logger?.error("EAS attestation failed", err);
        });
    }

    // -------------------------------------------------------------------
    // 5. Generate invoice if configured (async, non-blocking)
    // -------------------------------------------------------------------
    if (invoiceService) {
      void invoiceService
        .generate(receipt)
        .then((invoiceId) => {
          if (invoiceId) {
            receipt.invoiceId = invoiceId;
          }
        })
        .catch((err: unknown) => {
          config.logger?.error("Invoice generation failed", err);
        });
    }

    // -------------------------------------------------------------------
    // 6. Store proofLink hash for extension enrichment, cleanup pending
    // -------------------------------------------------------------------
    settledProofLinks.set(key, { hash: receipt.proofLinkHash, timestamp: Date.now() });
    pendingDecisions.delete(key);

    onEvent?.({
      type: "compliance:receipt:generated",
      timestamp: Date.now(),
      payload: { proofLinkHash: receipt.proofLinkHash, transactionHash: result.transaction },
    });
  };
}
