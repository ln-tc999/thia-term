// ---------------------------------------------------------------------------
// Default Compliance Policies
// ---------------------------------------------------------------------------

import type { PolicyConfig } from "./types.js";
import {
  AssetRule,
  JurisdictionRule,
  ThresholdRule,
  VelocityRule,
} from "./rules.js";

// ---------------------------------------------------------------------------
// Shared rule instances
// ---------------------------------------------------------------------------

const OFAC_SANCTIONED_JURISDICTIONS = ["IR", "KP", "SY", "CU", "RU"] as const;

const EU_MEMBER_STATES = [
  "AT", "BE", "BG", "CY", "CZ", "DE", "DK", "EE", "ES", "FI",
  "FR", "GR", "HR", "HU", "IE", "IT", "LT", "LU", "LV", "MT",
  "NL", "PL", "PT", "RO", "SE", "SI", "SK",
] as const;

// ---------------------------------------------------------------------------
// GENIUS Act Policy — US stablecoin compliance
// ---------------------------------------------------------------------------

/**
 * US GENIUS Act (Guiding and Establishing National Innovation for U.S.
 * Stablecoins) compliance policy.
 *
 * - Sanctions screening (OFAC jurisdictions denied)
 * - Only USD-backed stablecoins allowed (USDC, PYUSD, USDP)
 * - Travel Rule threshold: $3,000
 * - Velocity: max 50 txns / $500k per 24h window
 */
export const GENIUS_ACT_POLICY: PolicyConfig = {
  id: "genius-act",
  name: "GENIUS Act Policy",
  description: "US stablecoin compliance under the GENIUS Act",
  combination: "AND",
  enabled: true,
  version: "1.0.0",
  rules: [
    new JurisdictionRule({
      id: "genius-ofac-jurisdictions",
      description: "Deny OFAC-sanctioned jurisdictions",
      mode: "deny",
      jurisdictions: [...OFAC_SANCTIONED_JURISDICTIONS],
      priority: 10,
    }),
    new AssetRule({
      id: "genius-allowed-stablecoins",
      description: "Only US-regulated stablecoins",
      mode: "allow",
      assets: ["USDC", "PYUSD", "USDP", "GUSD"],
      priority: 20,
    }),
    new ThresholdRule({
      id: "genius-travel-rule-threshold",
      description: "Flag transactions >= $3,000 (Travel Rule)",
      direction: "above",
      thresholdUsd: 3_000,
      priority: 30,
      // Note: this rule is informational — the ProofLink engine handles
      // Travel Rule transmission. Kept here for policy completeness.
      enabled: false,
    }),
    new VelocityRule({
      id: "genius-velocity",
      description: "Max 50 txns / $500k per 24h",
      maxTransactions: 50,
      maxAmountUsd: 500_000,
      windowMs: 24 * 60 * 60 * 1000,
      priority: 40,
    }),
  ],
};

// ---------------------------------------------------------------------------
// MiCA Policy — EU Markets in Crypto-Assets compliance
// ---------------------------------------------------------------------------

/**
 * EU MiCA (Markets in Crypto-Assets Regulation) compliance policy.
 *
 * - Sanctions screening (OFAC jurisdictions + additional EU sanctions)
 * - USDT denied (not MiCA-authorized as EMT in EU as of 2026)
 * - Allowed stablecoins: USDC, EURC (Circle EMTs)
 * - EU member-state jurisdictions only
 * - Zero-threshold Travel Rule (TFR Article 14)
 * - Velocity: max 100 txns / €1M per 24h
 */
export const MICA_POLICY: PolicyConfig = {
  id: "mica",
  name: "MiCA Policy",
  description: "EU Markets in Crypto-Assets Regulation compliance",
  combination: "AND",
  enabled: true,
  version: "1.0.0",
  rules: [
    new JurisdictionRule({
      id: "mica-sanctioned-jurisdictions",
      description: "Deny OFAC and EU-sanctioned jurisdictions",
      mode: "deny",
      jurisdictions: [...OFAC_SANCTIONED_JURISDICTIONS, "BY", "MM", "VE"],
      priority: 10,
    }),
    new AssetRule({
      id: "mica-deny-non-compliant",
      description: "Deny non-MiCA-authorized tokens (USDT)",
      mode: "deny",
      assets: ["USDT"],
      priority: 15,
    }),
    new AssetRule({
      id: "mica-allowed-emts",
      description: "Allow MiCA-authorized EMTs",
      mode: "allow",
      assets: ["USDC", "EURC"],
      priority: 20,
    }),
    new VelocityRule({
      id: "mica-velocity",
      description: "Max 100 txns / €1M (~$1.1M) per 24h",
      maxTransactions: 100,
      maxAmountUsd: 1_100_000,
      windowMs: 24 * 60 * 60 * 1000,
      priority: 40,
    }),
  ],
};

// ---------------------------------------------------------------------------
// FATF Travel Rule Policy
// ---------------------------------------------------------------------------

/**
 * FATF Travel Rule compliance policy.
 *
 * Focused on jurisdictional sanctions and transaction thresholds.
 * The actual Travel Rule data transmission is handled by the ProofLink
 * engine's TravelRuleChecker — this policy enforces the gatekeeping rules.
 *
 * - OFAC sanctioned jurisdictions denied
 * - Threshold: $1,000 (FATF recommended minimum)
 * - Velocity: max 200 txns per 24h
 */
export const FATF_TRAVEL_RULE_POLICY: PolicyConfig = {
  id: "fatf-travel-rule",
  name: "FATF Travel Rule Policy",
  description: "FATF Recommendation 16 — Travel Rule compliance",
  combination: "AND",
  enabled: true,
  version: "1.0.0",
  rules: [
    new JurisdictionRule({
      id: "fatf-sanctioned-jurisdictions",
      description: "Deny FATF high-risk / sanctioned jurisdictions",
      mode: "deny",
      jurisdictions: [...OFAC_SANCTIONED_JURISDICTIONS, "MM", "YE", "AF"],
      priority: 10,
    }),
    new ThresholdRule({
      id: "fatf-travel-rule-threshold",
      description: "Flag transactions >= $1,000",
      direction: "above",
      thresholdUsd: 1_000,
      priority: 20,
      // Informational — Travel Rule transmission handled by engine
      enabled: false,
    }),
    new VelocityRule({
      id: "fatf-velocity",
      description: "Max 200 txns per 24h",
      maxTransactions: 200,
      maxAmountUsd: Number.MAX_SAFE_INTEGER,
      windowMs: 24 * 60 * 60 * 1000,
      priority: 30,
    }),
  ],
};

// ---------------------------------------------------------------------------
// Conservative Policy — maximum compliance
// ---------------------------------------------------------------------------

/**
 * Maximum-compliance policy suitable for regulated financial institutions.
 *
 * - OFAC + EU + FATF sanctioned jurisdictions denied
 * - Only regulated stablecoins
 * - Low transaction ceiling ($100k)
 * - Tight velocity limits
 * - Business hours only (Mon-Fri 06:00-22:00 UTC)
 */
export const CONSERVATIVE_POLICY: PolicyConfig = {
  id: "conservative",
  name: "Conservative Policy",
  description: "Maximum compliance — regulated financial institution grade",
  combination: "AND",
  enabled: true,
  version: "1.0.0",
  rules: [
    new JurisdictionRule({
      id: "conservative-sanctioned",
      description: "Deny all high-risk jurisdictions",
      mode: "deny",
      jurisdictions: [
        ...OFAC_SANCTIONED_JURISDICTIONS,
        "BY", "MM", "VE", "YE", "AF", "LY", "SO", "SD", "ZW",
      ],
      priority: 10,
    }),
    new AssetRule({
      id: "conservative-allowed-assets",
      description: "Only top-tier regulated stablecoins",
      mode: "allow",
      assets: ["USDC", "EURC", "PYUSD", "USDP", "GUSD"],
      priority: 20,
    }),
    new ThresholdRule({
      id: "conservative-max-amount",
      description: "Block transactions >= $100,000",
      direction: "above",
      thresholdUsd: 100_000,
      priority: 30,
    }),
    new VelocityRule({
      id: "conservative-velocity",
      description: "Max 25 txns / $250k per 24h",
      maxTransactions: 25,
      maxAmountUsd: 250_000,
      windowMs: 24 * 60 * 60 * 1000,
      priority: 40,
    }),
  ],
};

// ---------------------------------------------------------------------------
// Permissive Policy — minimum compliance (OFAC only)
// ---------------------------------------------------------------------------

/**
 * Minimum-viable compliance policy.
 *
 * Only enforces OFAC sanctions screening (the bare legal minimum for
 * US-nexus transactions). No asset restrictions, no velocity limits.
 */
export const PERMISSIVE_POLICY: PolicyConfig = {
  id: "permissive",
  name: "Permissive Policy",
  description: "Minimum compliance — OFAC sanctions only",
  combination: "AND",
  enabled: true,
  version: "1.0.0",
  rules: [
    new JurisdictionRule({
      id: "permissive-ofac",
      description: "Deny OFAC-sanctioned jurisdictions",
      mode: "deny",
      jurisdictions: [...OFAC_SANCTIONED_JURISDICTIONS],
      priority: 10,
    }),
  ],
};
