import { z } from "zod";
import { PaymentProtocol } from "./protocol.js";

// ---------------------------------------------------------------------------
// Invoice State
// ---------------------------------------------------------------------------

export const InvoiceState = z.enum([
  "DRAFT",
  "ISSUED",
  "PAID",
  "SETTLED",
  "DISPUTED",
  "CANCELLED",
]);
export type InvoiceState = z.infer<typeof InvoiceState>;

// ---------------------------------------------------------------------------
// Service Category
// ---------------------------------------------------------------------------

export const ServiceCategory = z.enum([
  "compute",
  "data",
  "api_call",
  "content_generation",
  "analysis",
  "transaction_fee",
  "other",
]);
export type ServiceCategory = z.infer<typeof ServiceCategory>;

// ---------------------------------------------------------------------------
// Invoice Line Item
// ---------------------------------------------------------------------------

export const InvoiceLineItem = z.object({
  description: z.string(),
  quantity: z.number().positive(),
  unit: z.string().default("unit"),
  unitPrice: z.number().nonnegative(),
  total: z.number().nonnegative(),
  serviceCategory: ServiceCategory.optional(),
});
export type InvoiceLineItem = z.infer<typeof InvoiceLineItem>;

// ---------------------------------------------------------------------------
// Invoice Party
// ---------------------------------------------------------------------------

export const InvoiceParty = z.object({
  agentId: z.string().optional(),
  walletAddress: z.string(),
  legalName: z.string().optional(),
  taxId: z.string().optional(),
});
export type InvoiceParty = z.infer<typeof InvoiceParty>;

// ---------------------------------------------------------------------------
// Payment Proof
// ---------------------------------------------------------------------------

export const PaymentProof = z.object({
  /** Uses the same uppercase enum values as PaymentProtocol ("X402", "MPP", etc). */
  protocol: PaymentProtocol,
  txHash: z.string(),
  chain: z.string(),
  facilitator: z.string().optional(),
  settledAt: z.string().datetime(),
});
export type PaymentProof = z.infer<typeof PaymentProof>;

// ---------------------------------------------------------------------------
// Compliance Stamp (embedded in invoice)
// ---------------------------------------------------------------------------

export const ComplianceStamp = z.object({
  proofLinkReceiptId: z.string(),
  sanctionsCleared: z.boolean(),
  travelRuleTransmitted: z.boolean(),
  amlRiskScore: z.number().int().min(0).max(100).optional(),
  easAttestationUid: z.string().optional(),
});
export type ComplianceStamp = z.infer<typeof ComplianceStamp>;

// ---------------------------------------------------------------------------
// Agent Invoice (JSON-LD compatible)
// ---------------------------------------------------------------------------

export const InvoiceCurrency = z.enum(["USDC", "USDT", "USD", "EUR", "GBP", "EURC"]);
export type InvoiceCurrency = z.infer<typeof InvoiceCurrency>;

export const AgentInvoice = z.object({
  "@context": z.array(z.string()).default([
    "https://schema.org",
    "https://prooflink.io/invoices/v1",
  ]),
  "@type": z.string().default("Invoice"),
  invoiceId: z.string(),
  state: InvoiceState,
  seller: InvoiceParty,
  buyer: InvoiceParty,
  lineItems: z.array(InvoiceLineItem).min(1),
  currency: InvoiceCurrency,
  totalAmount: z.number().nonnegative(),
  paymentProtocol: PaymentProtocol.optional(),
  workProof: z.string().optional(), // URI or hash (ERC-8183 evaluator attestation, IPFS CID)
  dueDate: z.string().datetime().optional(),
  anchoredOnChain: z.boolean().default(false),
  paymentProof: PaymentProof.optional(),
  complianceStamp: ComplianceStamp.optional(),
  invoiceUrl: z.string().url().optional(), // IPFS/Arweave URI
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type AgentInvoice = z.infer<typeof AgentInvoice>;
