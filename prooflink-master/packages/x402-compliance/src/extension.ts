import type {
  ProofLinkConfig,
  ResourceServerExtension,
  PaymentPayload,
  PaymentRequirements,
} from "./types.js";
import { payloadKey } from "./hooks/before-verify.js";

// ---------------------------------------------------------------------------
// ProofLink ResourceServerExtension
// ---------------------------------------------------------------------------

export interface ProofLinkExtensionDeps {
  config: ProofLinkConfig;
  settledProofLinks: Map<string, { hash: string; timestamp: number }>;
}

/**
 * Creates the ProofLink x402 ResourceServerExtension.
 *
 * - `enrichPaymentRequiredResponse()` — adds compliance policy info to 402 response headers
 * - `enrichSettlementResponse()` — adds ProofLink receipt hash to settlement response
 */
export function createProofLinkExtension(deps: ProofLinkExtensionDeps): ResourceServerExtension {
  const { config, settledProofLinks } = deps;

  return {
    key: "prooflink",

    async enrichPaymentRequiredResponse(
      _declaration: Record<string, unknown>,
      _context: { requirements: PaymentRequirements },
    ): Promise<Record<string, unknown>> {
      return {
        complianceRequired: true,
        provider: "prooflink",
        version: "0.1.0",
        sanctionsLists: config.policy.sanctionsLists,
        travelRuleThresholdUsd: config.policy.travelRuleThresholdUsd,
        maxRiskScore: config.policy.maxRiskScore,
      };
    },

    async enrichSettlementResponse(
      _declaration: Record<string, unknown>,
      context: { paymentPayload: PaymentPayload; requirements: PaymentRequirements },
    ): Promise<Record<string, unknown>> {
      const key = payloadKey(context.paymentPayload);
      const entry = settledProofLinks.get(key);

      // Cleanup after consumption — one-time read
      if (entry) {
        settledProofLinks.delete(key);
      }

      return {
        complianceVerified: true,
        provider: "prooflink",
        proofLinkHash: entry?.hash ?? null,
      };
    },
  };
}
