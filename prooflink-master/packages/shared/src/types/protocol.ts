import { z } from "zod";

// ---------------------------------------------------------------------------
// Branded types
// ---------------------------------------------------------------------------

export type Address = string & { readonly __brand: "Address" };
export type CAIP2ChainId = string & { readonly __brand: "CAIP2ChainId" };

// ---------------------------------------------------------------------------
// Payment Protocol
// ---------------------------------------------------------------------------

export const PaymentProtocol = z.enum([
  "X402",
  "MPP",
  "AP2",
  "ACP",
  "DIRECT",
]);
export type PaymentProtocol = z.infer<typeof PaymentProtocol>;

// ---------------------------------------------------------------------------
// Supported Chain
// ---------------------------------------------------------------------------

export const SupportedChain = z.enum([
  "ethereum",
  "base",
  "solana",
  "polygon",
  "arbitrum",
]);
export type SupportedChain = z.infer<typeof SupportedChain>;

// ---------------------------------------------------------------------------
// Supported Token
// ---------------------------------------------------------------------------

export const SupportedToken = z.enum(["USDC", "USDT", "EURC", "ETH", "SOL"]);
export type SupportedToken = z.infer<typeof SupportedToken>;

// ---------------------------------------------------------------------------
// Payment Intent (normalized across protocols)
// ---------------------------------------------------------------------------

export const PaymentIntent = z.object({
  sender: z.string(),
  receiver: z.string(),
  amount: z.string(), // decimal string to avoid floating point issues
  asset: SupportedToken,
  chain: SupportedChain,
  protocol: PaymentProtocol,
  protocolMetadata: z.record(z.string(), z.unknown()).optional(),
  jurisdiction: z
    .object({
      sender: z.string(), // ISO 3166-1 alpha-2
      receiver: z.string(),
    })
    .optional(),
  memo: z.string().max(256).optional(),
  invoiceId: z.string().optional(),
  requireKya: z.boolean().default(false),
  dryRun: z.boolean().default(false),
});
export type PaymentIntent = z.infer<typeof PaymentIntent>;

// ---------------------------------------------------------------------------
// Settlement Result
// ---------------------------------------------------------------------------

export const SettlementStatus = z.enum([
  "COMPLETED",
  "BLOCKED",
  "PENDING_REVIEW",
  "DRY_RUN_PASSED",
  "DRY_RUN_BLOCKED",
  "FAILED",
]);
export type SettlementStatus = z.infer<typeof SettlementStatus>;

export const SettlementResult = z.object({
  status: SettlementStatus,
  txHash: z.string().optional(),
  chain: SupportedChain,
  timestamp: z.string().datetime(),
  receiptId: z.string(),
  easAttestationUid: z.string().optional(),
  blockReason: z.string().optional(),
  complianceSummary: z.object({
    sanctionsCleared: z.boolean(),
    kyaVerified: z.boolean(),
    travelRuleSubmitted: z.boolean(),
    travelRuleRequired: z.boolean(),
  }),
});
export type SettlementResult = z.infer<typeof SettlementResult>;

// ---------------------------------------------------------------------------
// Compliance Request (ProofLink pipeline input)
// ---------------------------------------------------------------------------

export const ComplianceRequest = z.object({
  sender: z.string(), // WalletAddress | AgentDID
  receiver: z.string(),
  amount: z.string(),
  asset: SupportedToken,
  chain: SupportedChain,
  protocol: PaymentProtocol,
  protocolMetadata: z.record(z.string(), z.unknown()).optional(),
  jurisdiction: z
    .object({
      sender: z.string(),
      receiver: z.string(),
    })
    .optional(),
});
export type ComplianceRequest = z.infer<typeof ComplianceRequest>;
