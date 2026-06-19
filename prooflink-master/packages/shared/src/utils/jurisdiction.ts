import {
  SUPPORTED_JURISDICTIONS,
  TRAVEL_RULE_THRESHOLDS,
} from "../constants.js";

// ---------------------------------------------------------------------------
// EU/EEA checks
// ---------------------------------------------------------------------------

/** Check if a country code is an EU/EEA member state (MiCA applies). */
export function isEU(countryCode: string): boolean {
  return (SUPPORTED_JURISDICTIONS.EU_EEA as readonly string[]).includes(
    countryCode.toUpperCase(),
  );
}

// ---------------------------------------------------------------------------
// Restricted jurisdiction checks
// ---------------------------------------------------------------------------

/** Check if a country code is FATF-identified high-risk / restricted. */
export function isRestricted(countryCode: string): boolean {
  return (SUPPORTED_JURISDICTIONS.RESTRICTED as readonly string[]).includes(
    countryCode.toUpperCase(),
  );
}

/** Check if a country code is under enhanced monitoring. */
export function isEnhancedMonitoring(countryCode: string): boolean {
  return (SUPPORTED_JURISDICTIONS.ENHANCED_MONITORING as readonly string[]).includes(
    countryCode.toUpperCase(),
  );
}

/** Check if a country has full compliance support. */
export function isFullySupported(countryCode: string): boolean {
  return (SUPPORTED_JURISDICTIONS.FULL as readonly string[]).includes(
    countryCode.toUpperCase(),
  );
}

// ---------------------------------------------------------------------------
// Travel Rule thresholds
// ---------------------------------------------------------------------------

/** Get the travel rule threshold (USD) for a given jurisdiction. */
export function getTravelRuleThreshold(countryCode: string): number {
  const upper = countryCode.toUpperCase();

  // Direct match
  if (upper in TRAVEL_RULE_THRESHOLDS) {
    return TRAVEL_RULE_THRESHOLDS[upper as keyof typeof TRAVEL_RULE_THRESHOLDS];
  }

  // EU/EEA defaults to EU threshold
  if (isEU(upper)) {
    return TRAVEL_RULE_THRESHOLDS.EU;
  }

  return TRAVEL_RULE_THRESHOLDS.DEFAULT;
}

/** Alias for getTravelRuleThreshold. */
export const getThreshold = getTravelRuleThreshold;

// ---------------------------------------------------------------------------
// Transaction requires travel rule?
// ---------------------------------------------------------------------------

/** Check if a transaction amount triggers travel rule requirements for a jurisdiction. */
export function requiresTravelRule(
  amountUsd: number,
  countryCode: string,
): boolean {
  const threshold = getTravelRuleThreshold(countryCode);
  // threshold 0 means always required (e.g. Japan)
  return amountUsd >= threshold;
}

// ---------------------------------------------------------------------------
// Jurisdiction risk classification
// ---------------------------------------------------------------------------

export type JurisdictionRisk = "low" | "medium" | "high" | "prohibited";

/** Classify a jurisdiction's risk level. */
export function getJurisdictionRisk(countryCode: string): JurisdictionRisk {
  const upper = countryCode.toUpperCase();

  if (isRestricted(upper)) return "prohibited";
  if (isEnhancedMonitoring(upper)) return "high";
  if (isFullySupported(upper)) return "low";
  return "medium";
}
