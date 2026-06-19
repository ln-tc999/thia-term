import { z } from "zod";
import { SanctionsList, SanctionsMatchDetail } from "./compliance.js";

// ---------------------------------------------------------------------------
// MCP Tool: check_sanctions
// ---------------------------------------------------------------------------

export const CheckSanctionsInput = z.object({
  address: z.string().optional(),
  entityName: z.string().optional(),
  chain: z
    .enum(["ethereum", "base", "solana", "polygon", "arbitrum"])
    .optional(),
  includeIndirect: z.boolean().default(false),
}).refine(
  (d) => d.address !== undefined || d.entityName !== undefined,
  { message: "Either address or entityName must be provided" },
);
export type CheckSanctionsInput = z.infer<typeof CheckSanctionsInput>;

export const CheckSanctionsOutput = z.object({
  cleared: z.boolean(),
  riskScore: z.number().int().min(0).max(100),
  matches: z.array(SanctionsMatchDetail),
  listsChecked: z.array(SanctionsList),
  screenedAt: z.string().datetime(),
  receiptId: z.string(),
});
export type CheckSanctionsOutput = z.infer<typeof CheckSanctionsOutput>;

// ---------------------------------------------------------------------------
// MCP Tool: verify_kya
// ---------------------------------------------------------------------------

export const VerifyKYAInput = z.object({
  agentId: z.string(),
  agentWallet: z.string().optional(),
  operatorDid: z.string().optional(),
  checkSpendingLimits: z.boolean().default(true),
});
export type VerifyKYAInput = z.infer<typeof VerifyKYAInput>;

export const VerifyKYAOutput = z.object({
  verified: z.boolean(),
  trustScore: z.number().int().min(0).max(100),
  agentMetadata: z.object({
    name: z.string().optional(),
    type: z.enum(["autonomous", "semi-autonomous", "human-supervised"]),
    operator: z.string().optional(),
    registeredAt: z.string().datetime().optional(),
    x402Support: z.boolean().optional(),
  }),
  operatorStatus: z
    .object({
      sanctionsCleared: z.boolean(),
      kycVerified: z.boolean(),
    })
    .optional(),
  spendingLimits: z
    .object({
      perTransactionUsd: z.number().nonnegative(),
      dailyUsd: z.number().nonnegative(),
      allowedChains: z.array(z.string()),
      allowedCurrencies: z.array(z.string()),
    })
    .optional(),
  validationEvidence: z.string().optional(),
  receiptId: z.string(),
});
export type VerifyKYAOutput = z.infer<typeof VerifyKYAOutput>;

// ---------------------------------------------------------------------------
// MCP Tool: submit_travel_rule
// ---------------------------------------------------------------------------

export const SubmitTravelRuleInput = z.object({
  transaction: z.object({
    txHash: z.string().optional(),
    amountUsd: z.number().positive(),
    asset: z.string(),
    chain: z.string(),
    direction: z.enum(["outgoing", "incoming"]),
  }),
  originator: z.object({
    name: z.string().optional(),
    address: z.string().optional(),
    walletAddress: z.string(),
    accountNumber: z.string().optional(),
    nationalId: z.string().optional(),
    agentId: z.string().optional(),
    vaspDid: z.string().optional(),
  }),
  beneficiary: z.object({
    name: z.string().optional(),
    walletAddress: z.string(),
    agentId: z.string().optional(),
    vaspDid: z.string().optional(),
  }),
  preTransaction: z.boolean().default(false),
});
export type SubmitTravelRuleInput = z.infer<typeof SubmitTravelRuleInput>;

export const SubmitTravelRuleOutput = z.object({
  submitted: z.boolean(),
  travelRuleId: z.string(),
  counterpartyVaspAcknowledged: z.boolean().optional(),
  thresholdExceeded: z.boolean(),
  jurisdictionsCovered: z.array(z.string()),
  receiptId: z.string(),
});
export type SubmitTravelRuleOutput = z.infer<typeof SubmitTravelRuleOutput>;

// ---------------------------------------------------------------------------
// MCP Tool: get_compliance_receipt
// ---------------------------------------------------------------------------

export const GetComplianceReceiptInput = z.object({
  txHash: z.string().optional(),
  receiptId: z.string().optional(),
  includeRawEvidence: z.boolean().default(false),
}).refine(
  (d) => d.txHash !== undefined || d.receiptId !== undefined,
  { message: "Either txHash or receiptId must be provided" },
);
export type GetComplianceReceiptInput = z.infer<typeof GetComplianceReceiptInput>;

// ---------------------------------------------------------------------------
// MCP Tool: pay_with_compliance
// ---------------------------------------------------------------------------

export const PayWithComplianceInput = z.object({
  recipient: z.object({
    walletAddress: z.string(),
    agentId: z.string().optional(),
    legalName: z.string().optional(),
  }),
  amount: z.object({
    value: z.number().positive(),
    currency: z.enum(["USDC", "USDT"]),
  }),
  chain: z.enum(["base", "ethereum", "solana", "polygon"]).default("base"),
  paymentProtocol: z.enum(["x402", "direct"]).default("x402"),
  memo: z.string().max(256).optional(),
  invoiceId: z.string().optional(),
  requireKya: z.boolean().default(false),
  dryRun: z.boolean().default(false),
});
export type PayWithComplianceInput = z.infer<typeof PayWithComplianceInput>;

export const PayWithComplianceOutput = z.object({
  status: z.enum([
    "COMPLETED",
    "BLOCKED",
    "PENDING_REVIEW",
    "DRY_RUN_PASSED",
    "DRY_RUN_BLOCKED",
    "FAILED",
  ]),
  txHash: z.string().optional(),
  complianceSummary: z.object({
    sanctionsCleared: z.boolean(),
    kyaVerified: z.boolean(),
    travelRuleSubmitted: z.boolean(),
    travelRuleRequired: z.boolean(),
  }),
  blockReason: z.string().optional(),
  receiptId: z.string(),
  easAttestationUid: z.string().optional(),
});
export type PayWithComplianceOutput = z.infer<typeof PayWithComplianceOutput>;

// ---------------------------------------------------------------------------
// Generic MCP error envelope (isError: true responses)
// ---------------------------------------------------------------------------

export const MCPToolError = z.object({
  code: z.string(),
  message: z.string(),
  details: z.record(z.string(), z.unknown()).optional(),
});
export type MCPToolError = z.infer<typeof MCPToolError>;
