// ---------------------------------------------------------------------------
// Cross-Protocol Compliance Middleware
//
// Each payment protocol (x402, MPP, AP2, ACP, direct) has different trust
// models and data formats. This adapter determines which compliance checks
// are required based on protocol characteristics.
//
// All functions are pure — no side effects, no DB calls.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SupportedProtocol = "x402" | "mpp" | "ap2" | "acp" | "direct";

export interface ProtocolComplianceContext {
  protocol: SupportedProtocol;
  senderAddress: string;
  receiverAddress: string;
  amount: string;
  asset: string;
  chain: string;
  amountUsd: number;
  // Protocol-specific fields
  x402FacilitatorAddress?: string;
  ap2MandateId?: string;
  mppSessionId?: string;
  acpCheckoutId?: string;
}

export interface ProtocolComplianceResult {
  protocol: SupportedProtocol;
  requiresTravelRule: boolean;
  travelRuleThresholdUsd: number;
  requiresKYA: boolean;
  requiresEnhancedDueDiligence: boolean;
  additionalChecks: string[];
  protocolSpecificNotes: string[];
}

// ---------------------------------------------------------------------------
// Default Travel Rule threshold (FATF standard: $3000 for crypto)
// ---------------------------------------------------------------------------

const DEFAULT_TRAVEL_RULE_THRESHOLD_USD = 3000;

// ---------------------------------------------------------------------------
// Protocol-specific compliance resolvers
// ---------------------------------------------------------------------------

function resolveX402(ctx: ProtocolComplianceContext): ProtocolComplianceResult {
  // x402: HTTP 402-based micropayments. No built-in identity layer.
  // Facilitator address must also be screened since it routes payments.
  const additionalChecks: string[] = [];
  const notes: string[] = [];

  if (ctx.x402FacilitatorAddress) {
    additionalChecks.push("FACILITATOR_SANCTIONS_SCREENING");
    notes.push(`x402 facilitator address ${ctx.x402FacilitatorAddress} queued for screening`);
  }

  const requiresKYA = ctx.amountUsd > 1000;

  if (requiresKYA) {
    notes.push("x402 has no built-in identity — KYA required for amounts > $1000");
  }

  return {
    protocol: "x402",
    requiresTravelRule: ctx.amountUsd >= DEFAULT_TRAVEL_RULE_THRESHOLD_USD,
    travelRuleThresholdUsd: DEFAULT_TRAVEL_RULE_THRESHOLD_USD,
    requiresKYA,
    requiresEnhancedDueDiligence: ctx.amountUsd >= 10_000,
    additionalChecks,
    protocolSpecificNotes: notes,
  };
}

function resolveAp2(ctx: ProtocolComplianceContext): ProtocolComplianceResult {
  // AP2: Authorization mandates carry identity proof from the mandate issuer.
  // Lower risk since mandate provides authorization chain.
  const notes: string[] = [];
  const additionalChecks: string[] = [];

  const hasMandate = !!ctx.ap2MandateId;

  if (hasMandate) {
    notes.push(`AP2 mandate ${ctx.ap2MandateId} provides authorization proof — reduced risk profile`);
    additionalChecks.push("MANDATE_VALIDATION");
  } else {
    notes.push("AP2 transaction without mandate ID — elevated to standard risk profile");
  }

  // Mandates carry identity data, so Travel Rule threshold is higher (identity already available).
  // Without a mandate, fall back to the standard FATF threshold.
  const travelRuleThreshold = hasMandate ? 5000 : DEFAULT_TRAVEL_RULE_THRESHOLD_USD;

  return {
    protocol: "ap2",
    requiresTravelRule: ctx.amountUsd >= travelRuleThreshold,
    travelRuleThresholdUsd: travelRuleThreshold,
    requiresKYA: hasMandate ? false : ctx.amountUsd > 1000,
    requiresEnhancedDueDiligence: ctx.amountUsd >= 15_000,
    additionalChecks,
    protocolSpecificNotes: notes,
  };
}

function resolveMpp(ctx: ProtocolComplianceContext): ProtocolComplianceResult {
  // MPP: Session-based protocol. Authenticated sessions (e.g. via Stripe)
  // provide identity assurance, making KYA optional under $3000.
  const notes: string[] = [];
  const additionalChecks: string[] = [];

  const hasSession = !!ctx.mppSessionId;

  if (hasSession) {
    additionalChecks.push("SESSION_AUTHENTICATION_CHECK");
    notes.push(`MPP session ${ctx.mppSessionId} — session-based identity reduces KYA requirements`);
  } else {
    notes.push("MPP transaction without session — full compliance checks apply");
  }

  // Authenticated sessions via Stripe make KYA optional for amounts < $3000
  const requiresKYA = hasSession ? ctx.amountUsd >= 3000 : ctx.amountUsd > 1000;

  return {
    protocol: "mpp",
    requiresTravelRule: ctx.amountUsd >= DEFAULT_TRAVEL_RULE_THRESHOLD_USD,
    travelRuleThresholdUsd: DEFAULT_TRAVEL_RULE_THRESHOLD_USD,
    requiresKYA,
    requiresEnhancedDueDiligence: ctx.amountUsd >= 10_000,
    additionalChecks,
    protocolSpecificNotes: notes,
  };
}

function resolveAcp(ctx: ProtocolComplianceContext): ProtocolComplianceResult {
  // ACP: Checkout flow with merchant verification. Merchants are pre-verified,
  // reducing counterparty risk.
  const notes: string[] = [];
  const additionalChecks: string[] = [];

  const hasCheckout = !!ctx.acpCheckoutId;

  if (hasCheckout) {
    additionalChecks.push("MERCHANT_VERIFICATION_CHECK");
    notes.push(`ACP checkout ${ctx.acpCheckoutId} — merchant verification reduces counterparty risk`);
  } else {
    notes.push("ACP transaction without checkout ID — standard risk profile applied");
  }

  return {
    protocol: "acp",
    requiresTravelRule: ctx.amountUsd >= DEFAULT_TRAVEL_RULE_THRESHOLD_USD,
    travelRuleThresholdUsd: DEFAULT_TRAVEL_RULE_THRESHOLD_USD,
    requiresKYA: hasCheckout ? ctx.amountUsd >= 5000 : ctx.amountUsd > 1000,
    requiresEnhancedDueDiligence: ctx.amountUsd >= 10_000,
    additionalChecks,
    protocolSpecificNotes: notes,
  };
}

function resolveDirect(ctx: ProtocolComplianceContext): ProtocolComplianceResult {
  // Direct: No protocol-level trust. Highest risk — always require full
  // screening, KYA, and enhanced due diligence at lower thresholds.
  return {
    protocol: "direct",
    requiresTravelRule: ctx.amountUsd >= DEFAULT_TRAVEL_RULE_THRESHOLD_USD,
    travelRuleThresholdUsd: DEFAULT_TRAVEL_RULE_THRESHOLD_USD,
    requiresKYA: true,
    requiresEnhancedDueDiligence: ctx.amountUsd >= 5000,
    additionalChecks: ["FULL_COUNTERPARTY_SCREENING"],
    protocolSpecificNotes: [
      "Direct protocol has no trust layer — full compliance checks required",
    ],
  };
}

// ---------------------------------------------------------------------------
// Resolver dispatch
// ---------------------------------------------------------------------------

const RESOLVERS: Record<SupportedProtocol, (ctx: ProtocolComplianceContext) => ProtocolComplianceResult> = {
  x402: resolveX402,
  ap2: resolveAp2,
  mpp: resolveMpp,
  acp: resolveAcp,
  direct: resolveDirect,
};

/**
 * Determine protocol-specific compliance requirements.
 *
 * Defaults to the most restrictive rules (direct protocol) if the protocol
 * string is unrecognized.
 */
export function getProtocolCompliance(ctx: ProtocolComplianceContext): ProtocolComplianceResult {
  const resolver = RESOLVERS[ctx.protocol];

  if (!resolver) {
    // Unknown protocol — fall back to "direct" (most restrictive)
    return resolveDirect({ ...ctx, protocol: "direct" });
  }

  return resolver(ctx);
}

/**
 * Check whether a protocol string is a recognized supported protocol.
 */
export function isSupportedProtocol(protocol: string): protocol is SupportedProtocol {
  return protocol in RESOLVERS;
}

// Export individual resolvers for testing
export const _resolvers = {
  resolveX402,
  resolveAp2,
  resolveMpp,
  resolveAcp,
  resolveDirect,
} as const;
