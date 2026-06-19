import type { ProofLinkConfig } from "./types.js";
import { ProofLinkX402Compliance, type ProofLinkComplianceServices } from "./middleware.js";

/**
 * Create a ProofLink x402 compliance instance.
 *
 * @example
 * ```ts
 * const compliance = createProofLinkCompliance({
 *   chainalysisApiKey: process.env.CHAINALYSIS_API_KEY!,
 *   policy: {
 *     sanctionsLists: ["OFAC_SDN", "EU", "UN"],
 *     maxRiskScore: 70,
 *     travelRuleThresholdUsd: 3000,
 *   },
 * });
 *
 * compliance.register(server);
 * ```
 */
export function createProofLinkCompliance(
  config: ProofLinkConfig,
  services?: ProofLinkComplianceServices,
): ProofLinkX402Compliance {
  return new ProofLinkX402Compliance(config, services);
}
