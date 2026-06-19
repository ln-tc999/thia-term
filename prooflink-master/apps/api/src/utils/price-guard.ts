// ---------------------------------------------------------------------------
// Price Guard — defensive price conversion layer for Travel Rule thresholds.
//
// Hardcoded reference prices for now. Structure supports swapping in a real
// oracle (e.g. Chainlink, Pyth) later — just replace getAssetPriceUsd().
// ---------------------------------------------------------------------------

import { logger } from "./logger.js";

/** Hardcoded reference prices (USD). Update when adding new assets. */
export const REFERENCE_PRICES_USD: Record<string, number> = {
  USDC: 1.0,
  USDT: 1.0,
  EURC: 1.08,
  DAI: 1.0,
  ETH: 3500,
  BTC: 87000,
};

/** Maximum allowed deviation from reference price (5%). */
const PRICE_DEVIATION_THRESHOLD = 0.05;

/**
 * Returns the current USD price for a known asset.
 * Falls back to 0 for unknown assets (forces Travel Rule to apply as a
 * safety measure — unknown price means we can't confirm the amount is
 * below threshold).
 */
export function getAssetPriceUsd(asset: string): number {
  const normalized = asset.toUpperCase();
  const price = REFERENCE_PRICES_USD[normalized];
  if (price === undefined) {
    logger.warn("price-guard: unknown asset, returning 0 — Travel Rule will apply conservatively", { asset });
    return 0;
  }
  return price;
}

/**
 * Convert a token amount to its USD equivalent.
 * Returns Infinity for unknown assets so threshold checks fail-safe
 * (i.e. Travel Rule applies when we can't determine the value).
 */
export function convertToUsd(amount: string, asset: string): number {
  const numericAmount = Number(amount);
  if (!Number.isFinite(numericAmount) || numericAmount < 0) {
    logger.warn("price-guard: invalid amount, returning Infinity — Travel Rule will apply conservatively", { amount, asset });
    return Infinity;
  }

  const price = getAssetPriceUsd(asset);
  if (price === 0) {
    // Unknown asset — fail-safe to Infinity so Travel Rule applies
    return Infinity;
  }

  return numericAmount * price;
}

/**
 * Check whether a reported price is within +-5% of the hardcoded reference.
 * Intended for future oracle integration — validates oracle-returned prices
 * against known reference to detect manipulation.
 *
 * Returns true if price is reasonable, false if it deviates beyond threshold.
 * Unknown assets always return false (conservative).
 */
export function validatePriceReasonable(asset: string, priceUsd: number): boolean {
  const normalized = asset.toUpperCase();
  const reference = REFERENCE_PRICES_USD[normalized];

  if (reference === undefined) {
    logger.warn("price-guard: cannot validate price for unknown asset", { asset, priceUsd });
    return false;
  }

  if (!Number.isFinite(priceUsd) || priceUsd <= 0) {
    logger.warn("price-guard: invalid price supplied for validation", { asset, priceUsd });
    return false;
  }

  const deviation = Math.abs(priceUsd - reference) / reference;
  if (deviation > PRICE_DEVIATION_THRESHOLD) {
    logger.warn(
      "price-guard: price deviates beyond acceptable threshold — possible manipulation",
      { asset, priceUsd, reference, deviationPct: (deviation * 100).toFixed(2) },
    );
    return false;
  }

  return true;
}

/** US Travel Rule threshold in USD. */
export const TRAVEL_RULE_THRESHOLD_USD = 3000;
