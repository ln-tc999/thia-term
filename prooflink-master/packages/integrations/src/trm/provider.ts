// ---------------------------------------------------------------------------
// TRM Labs — SanctionsProvider implementation
// ---------------------------------------------------------------------------

import type { SanctionsCheckResult, SanctionsList } from "@prooflink/shared";
import { TRMClient, type TRMHttpClient } from "./client.js";
import type { TRMConfig } from "./types.js";

/**
 * Interface for sanctions screening providers.
 *
 * Defined here (not imported from core) to avoid hard dependency on
 * `@prooflink/core` — the integrations package should work standalone.
 */
export interface SanctionsProvider {
  screenAddress(
    address: string,
    chain: string,
  ): Promise<SanctionsCheckResult>;
}

/**
 * TRM Labs sanctions screening provider.
 *
 * Implements the `SanctionsProvider` interface, making it pluggable into
 * any compliance pipeline that accepts the shared `SanctionsCheckResult` type.
 *
 * Usage:
 * ```ts
 * import { TRMSanctionsProvider } from "@prooflink/integrations/trm";
 *
 * const provider = new TRMSanctionsProvider({
 *   apiKey: process.env.TRM_API_KEY!,
 * });
 * const result = await provider.screenAddress("0x...", "ethereum");
 * ```
 */
export class TRMSanctionsProvider implements SanctionsProvider {
  private readonly client: TRMClient;

  constructor(config: TRMConfig, http?: TRMHttpClient) {
    this.client = new TRMClient(config, http);
  }

  /**
   * Screen an address using TRM Labs and return a normalized
   * `SanctionsCheckResult` compatible with `@prooflink/shared`.
   */
  async screenAddress(
    address: string,
    chain: string,
  ): Promise<SanctionsCheckResult> {
    const result = await this.client.screenAddress(address, chain);

    const listsChecked: SanctionsList[] = [
      "OFAC_SDN",
      "EU_CONSOLIDATED",
      "UN_CONSOLIDATED",
    ];

    return {
      matched: result.isSanctioned,
      listsChecked,
      matchDetails: result.isSanctioned
        ? [
            {
              list: "OFAC_SDN" as SanctionsList,
              entryId: `trm-${address.slice(0, 10)}`,
              name: result.addressOwners[0]?.name ?? "TRM Sanctioned Entity",
              matchConfidence: result.riskScore / 100,
            },
          ]
        : [],
      riskScore: result.riskScore,
      screenedAt: result.screenedAt,
      provider: "trm" as const,
    };
  }
}
