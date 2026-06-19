import { z } from "zod";

// ---------------------------------------------------------------------------
// Branded types
// ---------------------------------------------------------------------------

export type ReceiptId = string & { readonly __brand: "ReceiptId" };
export type TxHash = string & { readonly __brand: "TxHash" };

// ---------------------------------------------------------------------------
// Sanctions Check
// ---------------------------------------------------------------------------

export const SanctionsList = z.enum([
  "OFAC_SDN",
  /** OFAC Consolidated (non-SDN) list — covers arms-embargo countries etc. */
  "OFAC_CONS",
  "EU_CONSOLIDATED",
  "UN_CONSOLIDATED",
  "HMT",
]);
export type SanctionsList = z.infer<typeof SanctionsList>;

export const SanctionsMatchDetail = z.object({
  list: SanctionsList,
  entryId: z.string(),
  name: z.string(),
  matchConfidence: z.number().min(0).max(1),
});
export type SanctionsMatchDetail = z.infer<typeof SanctionsMatchDetail>;

export const SanctionsCheckResult = z.object({
  matched: z.boolean(),
  listsChecked: z.array(SanctionsList),
  matchDetails: z.array(SanctionsMatchDetail),
  riskScore: z.number().int().min(0).max(100),
  screenedAt: z.string().datetime(),
  provider: z.enum([
    "chainalysis_free",
    "chainalysis_kyt",
    "trm",
    "chainaware",
    "ofac_sdn_offline",
    "multi_provider",
    "custom",
  ]),
});
export type SanctionsCheckResult = z.infer<typeof SanctionsCheckResult>;

// ---------------------------------------------------------------------------
// AML Risk Scoring
// ---------------------------------------------------------------------------

export const AMLRiskFactor = z.enum([
  "velocity_anomaly",
  "destination_risk",
  "amount_anomaly",
  "indirect_exposure",
  "new_wallet",
  "mixer_interaction",
  "darknet_exposure",
  "structuring",
  "time_of_day_anomaly",
  "cross_chain_correlation",
]);
export type AMLRiskFactor = z.infer<typeof AMLRiskFactor>;

export const AMLRiskScore = z.object({
  score: z.number().int().min(0).max(100),
  factors: z.array(
    z.object({
      factor: AMLRiskFactor,
      weight: z.number().min(0).max(1),
      detail: z.string(),
    }),
  ),
  threshold: z.number().int().min(0).max(100),
  exceeds: z.boolean(),
  evaluatedAt: z.string().datetime(),
});
export type AMLRiskScore = z.infer<typeof AMLRiskScore>;

// ---------------------------------------------------------------------------
// Travel Rule (IVMS101)
// ---------------------------------------------------------------------------

export const IVMS101Person = z.object({
  name: z.string().optional(),
  walletAddress: z.string(),
  physicalAddress: z.string().optional(),
  nationalId: z.string().optional(),
  accountNumber: z.string().optional(),
  agentId: z.string().optional(),
  vaspDid: z.string().optional(),
});
export type IVMS101Person = z.infer<typeof IVMS101Person>;

export const TravelRuleData = z.object({
  originator: IVMS101Person,
  beneficiary: IVMS101Person,
  amountUsd: z.number().positive(),
  /** Native asset amount (before USD conversion). Used for IVMS101 message. */
  nativeAmount: z.string().optional(),
  asset: z.string(),
  chain: z.string(),
  direction: z.enum(["outgoing", "incoming"]),
  preTransaction: z.boolean().default(false),
  txHash: z.string().optional(),
});
export type TravelRuleData = z.infer<typeof TravelRuleData>;

export const TravelRuleStatus = z.enum([
  "NOT_REQUIRED",
  "REQUIRED_PENDING",
  "TRANSMITTED",
  "PENDING",
  "FAILED",
  "ACK_RECEIVED",
]);
export type TravelRuleStatus = z.infer<typeof TravelRuleStatus>;

// ---------------------------------------------------------------------------
// Compliance Check Types
// ---------------------------------------------------------------------------

export const ComplianceCheckType = z.enum([
  "SANCTIONS_SCREENING",
  "KYA_VERIFICATION",
  "TRAVEL_RULE",
  "AML_MONITORING",
  "INVOICE_VALIDATION",
  "JURISDICTIONAL_RULES",
]);
export type ComplianceCheckType = z.infer<typeof ComplianceCheckType>;

export const ComplianceCheckResult = z.enum(["PASSED", "FAILED", "SKIPPED"]);
export type ComplianceCheckResult = z.infer<typeof ComplianceCheckResult>;

export const CheckPerformed = z.object({
  checkType: ComplianceCheckType,
  result: ComplianceCheckResult,
  performedAt: z.string().datetime(),
  provider: z.string(),
  detail: z.string().optional(),
});
export type CheckPerformed = z.infer<typeof CheckPerformed>;

// ---------------------------------------------------------------------------
// Compliance Receipt
// ---------------------------------------------------------------------------

export const ComplianceReceipt = z.object({
  receiptId: z.string(),
  txHash: z.string().optional(),
  checksPerformed: z.array(CheckPerformed),
  overallStatus: z.enum(["APPROVED", "REJECTED", "ESCALATED"]),
  riskScore: z.number().int().min(0).max(100),
  travelRuleStatus: TravelRuleStatus,
  easAttestationUid: z.string().optional(),
  ipfsCid: z.string().optional(),
  signature: z.string(),
  timestamp: z.string().datetime(),
  ttl: z.number().int().positive().default(300),
  proofLinkVersion: z.string().default("1.0.0"),
});
export type ComplianceReceipt = z.infer<typeof ComplianceReceipt>;

// ---------------------------------------------------------------------------
// Compliance Decision (top-level pipeline output)
// ---------------------------------------------------------------------------

export const ComplianceDecisionStatus = z.enum([
  "APPROVED",
  "REJECTED",
  "ESCALATED",
]);
export type ComplianceDecisionStatus = z.infer<typeof ComplianceDecisionStatus>;

export const ComplianceDecision = z.object({
  status: ComplianceDecisionStatus,
  riskScore: z.number().int().min(0).max(100),
  receiptId: z.string(),
  receiptHash: z.string(),
  checks: z.array(CheckPerformed),
  travelRuleStatus: TravelRuleStatus,
  /** Set when status is REJECTED or ESCALATED. */
  blockReason: z.string().optional(),
  timestamp: z.string().datetime(),
  ttl: z.number().int().positive().default(300),
});
export type ComplianceDecision = z.infer<typeof ComplianceDecision>;

// ---------------------------------------------------------------------------
// ProofLink Receipt (full compliance + settlement evidence record)
// Shared between @prooflink/x402-compliance, @prooflink/core, and apps/api.
// ---------------------------------------------------------------------------

export const ProofLinkReceipt = z.object({
  version: z.literal(1),
  transactionHash: z.string().optional(),
  network: z.string(), // CAIP-2 chain ID
  sender: z.string(),
  receiver: z.string(),
  amount: z.string(), // decimal string
  asset: z.string(), // token symbol or contract address
  complianceDecision: ComplianceDecision,
  invoiceId: z.string().optional(),
  /** Ethereum Attestation Service UID after on-chain attestation. */
  attestationUid: z.string().optional(),
  /** IPFS CID of the full compliance report. */
  ipfsCid: z.string().optional(),
  createdAt: z.string().datetime(),
});
export type ProofLinkReceipt = z.infer<typeof ProofLinkReceipt>;

// ---------------------------------------------------------------------------
// Compliance Policy (used by @prooflink/x402-compliance config)
// ---------------------------------------------------------------------------

export const CompliancePolicy = z.object({
  /** Sanctions lists to screen against. */
  sanctionsLists: z.array(SanctionsList),
  /** Maximum AML risk score (0-100) before rejection. */
  maxRiskScore: z.number().int().min(0).max(100),
  /** Travel Rule threshold in USD. */
  travelRuleThresholdUsd: z.number().nonnegative(),
  /** ISO 3166-1 alpha-2 codes for jurisdictions requiring enhanced due diligence. */
  eddJurisdictions: z.array(z.string()).optional(),
  /** Wallet addresses that bypass compliance checks (known treasury addresses etc). */
  allowlist: z.array(z.string()).optional(),
  /** Wallet addresses that are always blocked regardless of screening results. */
  blocklist: z.array(z.string()).optional(),
  /**
   * When true, payments proceed if the screening API is unreachable.
   * Default: false (fail-closed — zero-risk tolerance).
   */
  failOpen: z.boolean().default(false),
});
export type CompliancePolicy = z.infer<typeof CompliancePolicy>;
