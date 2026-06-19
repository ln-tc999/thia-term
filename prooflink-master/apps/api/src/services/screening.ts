import {
  SanctionsScreener,
  ChainalysisProvider,
  TRMLabsProvider,
  loadConfig,
  OFAC_SDN_ETH_ADDRESSES,
} from "@prooflink/core";
import type { SanctionsCheckResult } from "@prooflink/shared";
import { logger } from "../utils/logger.js";

// ---------------------------------------------------------------------------
// Singleton screener — lazy-initialized so tests can mock before first use
// ---------------------------------------------------------------------------

let _screener: SanctionsScreener | null = null;

/**
 * Returns a singleton SanctionsScreener configured from environment variables.
 *
 * Provider chain (in priority order):
 *  1. Chainalysis (if CHAINALYSIS_API_KEY is set)
 *  2. TRM Labs   (if TRM_LABS_API_KEY is set)
 *
 * The screener's built-in offline OFAC SDN fallback always applies when all
 * providers are down — controlled by `failOpen` in ProofLinkConfig.
 */
export function getScreener(): SanctionsScreener {
  if (_screener) return _screener;

  const isProduction = process.env.NODE_ENV === "production";
  const config = loadConfig({ failOpen: !isProduction });
  const providers = [];

  if (process.env.CHAINALYSIS_API_KEY) {
    providers.push(
      new ChainalysisProvider(
        config.chainalysisBaseUrl,
        process.env.CHAINALYSIS_API_KEY,
      ),
    );
  }

  if (process.env.TRM_LABS_API_KEY) {
    providers.push(
      new TRMLabsProvider(process.env.TRM_LABS_API_KEY),
    );
  }

  // If no API keys are configured, the screener's default ChainalysisProvider
  // (keyless / free tier) will be used. With failOpen: true, it falls back to
  // the offline OFAC SDN list on any provider failure.
  const opts = providers.length > 0 ? { providers } : undefined;
  _screener = new SanctionsScreener(config, opts);

  return _screener;
}

/**
 * Reset the singleton (for tests).
 */
export function resetScreener(): void {
  _screener = null;
}

/**
 * Convenience wrapper: screen a single address and return the full result.
 *
 * On any unexpected error the function falls back to the offline OFAC SDN set
 * so callers never get an unhandled rejection from screening.
 */
export async function screenAddress(
  address: string,
  chain: string,
): Promise<SanctionsCheckResult> {
  try {
    return await getScreener().screenAddress(address, chain);
  } catch (error) {
    // Last-resort fallback: offline OFAC SDN set — should rarely happen since
    // the screener itself handles failOpen, but guards against init errors etc.
    logger.warn("Screener error — falling back to offline OFAC list", {
      address,
      chain,
      error: error instanceof Error ? error.message : String(error),
    });

    const matched = OFAC_SDN_ETH_ADDRESSES.has(address.toLowerCase());
    return {
      matched,
      listsChecked: ["OFAC_SDN"],
      matchDetails: matched
        ? [{
            list: "OFAC_SDN",
            entryId: `offline-${address.slice(0, 10)}`,
            name: "OFAC SDN Designated Address",
            matchConfidence: 1.0,
          }]
        : [],
      riskScore: matched ? 100 : 0,
      screenedAt: new Date().toISOString(),
      provider: "ofac_sdn_offline",
    };
  }
}
