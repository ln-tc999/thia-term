// ---------------------------------------------------------------------------
// Jurisdiction-aware Travel Rule configuration
//
// Implements threshold-based routing per jurisdiction (FATF, EU TFR, BSA,
// JFSA, MAS, VARA) and agent originator resolution for IVMS101 compliance.
// ---------------------------------------------------------------------------

import { eq } from "drizzle-orm";
import { getDb } from "../db/index.js";
import { agents } from "../db/schema.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface JurisdictionRule {
  /** Threshold in USD equivalent. 0 = all transactions require Travel Rule. */
  threshold: number;
  /** Native currency for the threshold (informational). */
  currency: string;
  /** Whether full legal name is required for originator/beneficiary. */
  requiresFullName: boolean;
  /** Whether geographic address is required. */
  requiresAddress: boolean;
  /** Whether national ID / LEI is required. */
  requiresNationalId: boolean;
  /** Name of the regulatory body governing this jurisdiction. */
  regulatoryBody: string;
}

/** Resolved originator info from agent registry. */
export interface AgentOriginatorInfo {
  controllingEntityName: string;
  controllingEntityLei: string | null;
  agentDid: string;
  agentName: string | null;
  agentType: string;
}

/** Result of jurisdiction-aware threshold resolution. */
export interface TravelRuleThresholdResult {
  /** Whether Travel Rule applies to this transaction. */
  applies: boolean;
  /** USD threshold that was used (the lower of sender/receiver jurisdictions). */
  appliedThresholdUsd: number;
  /** Detected sender jurisdiction code. */
  senderJurisdiction: string;
  /** Detected receiver jurisdiction code. */
  receiverJurisdiction: string;
  /** The jurisdiction whose threshold was applied (most restrictive). */
  triggeringJurisdiction: string;
  /** Whether full IVMS101 originator data is required. */
  requiresFullIVMS101: boolean;
  /** The jurisdiction rule that was applied. */
  appliedRule: JurisdictionRule;
}

// ---------------------------------------------------------------------------
// Jurisdiction rules registry
// ---------------------------------------------------------------------------

/**
 * Jurisdiction-specific Travel Rule thresholds and data requirements.
 *
 * Thresholds are expressed in USD equivalent. For non-USD jurisdictions,
 * the original local-currency threshold is converted at a conservative
 * fixed rate that is periodically reviewed.
 *
 * Conversion rates used (conservative, rounded down to be more restrictive):
 * - EUR 1 = USD 1.08
 * - GBP 1 = USD 1.26
 * - JPY 1 = USD 0.0067
 * - SGD 1 = USD 0.74
 * - AED 1 = USD 0.27
 */
export const JURISDICTION_RULES: Record<string, JurisdictionRule> = {
  US: {
    threshold: 3000,
    currency: "USD",
    requiresFullName: true,
    requiresAddress: true,
    requiresNationalId: false,
    regulatoryBody: "FinCEN (BSA)",
  },
  EU: {
    // CASP-to-CASP: EUR 0 (all transactions). Self-hosted: EUR 1000.
    // We use 0 as the conservative default for CASP-to-CASP (agent-to-agent).
    threshold: 0,
    currency: "EUR",
    requiresFullName: true,
    requiresAddress: true,
    requiresNationalId: true,
    regulatoryBody: "EU TFR (Transfer of Funds Regulation)",
  },
  GB: {
    // GBP 1000 ~ USD 1260
    threshold: 1260,
    currency: "GBP",
    requiresFullName: true,
    requiresAddress: true,
    requiresNationalId: false,
    regulatoryBody: "FCA",
  },
  JP: {
    // JPY 0 — no de minimis threshold
    threshold: 0,
    currency: "JPY",
    requiresFullName: true,
    requiresAddress: true,
    requiresNationalId: true,
    regulatoryBody: "JFSA",
  },
  SG: {
    // SGD 1500 ~ USD 1110
    threshold: 1110,
    currency: "SGD",
    requiresFullName: true,
    requiresAddress: false,
    requiresNationalId: false,
    regulatoryBody: "MAS",
  },
  AE: {
    // AED 1000 ~ USD 270 (conservative: use 270)
    threshold: 270,
    currency: "AED",
    requiresFullName: true,
    requiresAddress: true,
    requiresNationalId: true,
    regulatoryBody: "VARA / CBUAE",
  },
};

/**
 * Default rule applied when jurisdiction cannot be determined.
 * Uses threshold 0 (most restrictive) to ensure compliance.
 */
export const DEFAULT_JURISDICTION_RULE: JurisdictionRule = {
  threshold: 0,
  currency: "USD",
  requiresFullName: true,
  requiresAddress: true,
  requiresNationalId: true,
  regulatoryBody: "UNKNOWN — applying maximum restriction",
};

// ---------------------------------------------------------------------------
// Chain-to-jurisdiction hinting
// ---------------------------------------------------------------------------

/**
 * Maps chain identifiers to likely jurisdictions as a heuristic hint.
 * This is NOT authoritative — actual jurisdiction should come from VASP DID
 * or KYA data. The chain hint is only used as a fallback.
 */
const CHAIN_JURISDICTION_HINTS: Record<string, string> = {
  // US-regulated or US-domiciled chains/L2s
  base: "US",
  ethereum: "US",
  "ethereum-mainnet": "US",
  optimism: "US",
  arbitrum: "US",
  // Multi-jurisdictional — no single hint
  polygon: "UNKNOWN",
  "polygon-pos": "UNKNOWN",
  avalanche: "UNKNOWN",
  solana: "UNKNOWN",
  // Asia-Pacific
  astar: "JP",
  // EU
  gnosis: "EU",
};

// ---------------------------------------------------------------------------
// Jurisdiction resolution
// ---------------------------------------------------------------------------

/** EU member state ISO codes mapped to the unified "EU" rule. */
const EU_MEMBER_CODES = new Set([
  "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR",
  "DE", "GR", "HU", "IE", "IT", "LV", "LT", "LU", "MT", "NL",
  "PL", "PT", "RO", "SK", "SI", "ES", "SE",
]);

/**
 * Resolve jurisdiction for a party based on available signals.
 * Priority: agentDID TLD -> chain hint -> UNKNOWN
 */
export function resolveJurisdiction(
  chain: string,
  agentDid?: string,
): string {
  // Try to extract country from DID (e.g., did:web:vasp.de -> DE, did:web:agent.jp -> JP)
  if (agentDid) {
    const didMatch = /\.([a-z]{2})$/i.exec(agentDid);
    if (didMatch?.[1]) {
      const code = didMatch[1].toUpperCase();
      // Map common EU country codes to EU rule set
      if (EU_MEMBER_CODES.has(code)) {
        return "EU";
      }
      if (code in JURISDICTION_RULES) {
        return code;
      }
    }
  }

  // Chain-based hint
  const chainNormalized = chain.toLowerCase().trim();
  const hint = CHAIN_JURISDICTION_HINTS[chainNormalized];
  if (hint && hint !== "UNKNOWN") {
    return hint;
  }

  return "UNKNOWN";
}

// ---------------------------------------------------------------------------
// Threshold resolution (conservative: use the LOWER threshold)
// ---------------------------------------------------------------------------

/**
 * Determine the applicable Travel Rule threshold by resolving both sender
 * and receiver jurisdictions and applying the more restrictive (lower) one.
 */
export function resolveTravelRuleThreshold(
  amountUsd: number,
  senderChain: string,
  receiverChain: string,
  senderAgentDid?: string,
  receiverAgentDid?: string,
): TravelRuleThresholdResult {
  const senderJurisdiction = resolveJurisdiction(senderChain, senderAgentDid);
  const receiverJurisdiction = resolveJurisdiction(receiverChain, receiverAgentDid);

  const senderRule = JURISDICTION_RULES[senderJurisdiction] ?? DEFAULT_JURISDICTION_RULE;
  const receiverRule = JURISDICTION_RULES[receiverJurisdiction] ?? DEFAULT_JURISDICTION_RULE;

  // Apply the LOWER threshold (more restrictive / conservative)
  let appliedRule: JurisdictionRule;
  let triggeringJurisdiction: string;

  if (senderRule.threshold <= receiverRule.threshold) {
    appliedRule = senderRule;
    triggeringJurisdiction = senderJurisdiction;
  } else {
    appliedRule = receiverRule;
    triggeringJurisdiction = receiverJurisdiction;
  }

  const applies = amountUsd >= appliedRule.threshold;

  // Full IVMS101 data is required if the rule mandates address + nationalId
  const requiresFullIVMS101 = applies && (appliedRule.requiresAddress || appliedRule.requiresNationalId);

  return {
    applies,
    appliedThresholdUsd: appliedRule.threshold,
    senderJurisdiction,
    receiverJurisdiction,
    triggeringJurisdiction,
    requiresFullIVMS101,
    appliedRule,
  };
}

// ---------------------------------------------------------------------------
// Agent originator resolution
// ---------------------------------------------------------------------------

/**
 * Look up an agent's controlling entity info from the agents table.
 * Returns null if the agent is not found or inactive.
 */
export async function resolveAgentOriginator(
  agentDid: string,
): Promise<AgentOriginatorInfo | null> {
  const db = getDb();

  const [agent] = await db
    .select({
      controllingEntityName: agents.controllingEntityName,
      controllingEntityLei: agents.controllingEntityLei,
      agentDid: agents.agentDid,
      name: agents.name,
      agentType: agents.agentType,
      isActive: agents.isActive,
    })
    .from(agents)
    .where(eq(agents.agentDid, agentDid))
    .limit(1);

  if (!agent || !agent.isActive) {
    return null;
  }

  return {
    controllingEntityName: agent.controllingEntityName,
    controllingEntityLei: agent.controllingEntityLei,
    agentDid: agent.agentDid,
    agentName: agent.name,
    agentType: agent.agentType,
  };
}
