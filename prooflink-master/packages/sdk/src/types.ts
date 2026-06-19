import type {
  ComplianceCheckType,
  TravelRuleData,
} from "@prooflink/shared/types";
import type {
  InvoiceCurrency,
  InvoiceLineItem,
  InvoiceParty,
  InvoiceState,
} from "@prooflink/shared/types";
import type {
  AgentType,
  DelegationScope,
} from "@prooflink/shared/types";
import type {
  SupportedChain,
  SupportedToken,
} from "@prooflink/shared/types";

// ---------------------------------------------------------------------------
// Re-exports from @prooflink/shared for consumer convenience
// ---------------------------------------------------------------------------

export type {
  // compliance
  AMLRiskFactor,
  AMLRiskScore,
  CheckPerformed,
  ComplianceCheckResult,
  ComplianceCheckType,
  ComplianceDecision,
  ComplianceDecisionStatus,
  CompliancePolicy,
  ComplianceReceipt,
  IVMS101Person,
  ProofLinkReceipt,
  SanctionsCheckResult,
  SanctionsList,
  SanctionsMatchDetail,
  TravelRuleData,
  TravelRuleStatus,
  // identity
  AgentIdentity,
  AgentType,
  DelegationScope,
  KYACredential,
  KYACredentialSubject,
  KYAVerificationResult,
  // invoice
  AgentInvoice,
  ComplianceStamp,
  InvoiceCurrency,
  InvoiceLineItem,
  InvoiceParty,
  InvoiceState,
  PaymentProof,
  ServiceCategory,
  // protocol
  ComplianceRequest,
  PaymentIntent,
  PaymentProtocol,
  SettlementResult,
  SettlementStatus,
  SupportedChain,
  SupportedToken,
} from "@prooflink/shared/types";

// ---------------------------------------------------------------------------
// Pagination
// ---------------------------------------------------------------------------

/** Parameters for paginated list endpoints. */
export interface PaginationParams {
  /** 1-based page number. */
  page?: number;
  /** Items per page (max 100). */
  limit?: number;
}

/** Envelope returned by every paginated list endpoint. */
export interface PaginatedResponse<T> {
  items: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

// ---------------------------------------------------------------------------
// Compliance
// ---------------------------------------------------------------------------

/** Parameters for {@link ProofLinkClient.checkCompliance}. */
export interface ComplianceCheckParams {
  sender: {
    address: string;
    chain: string;
    agentDID?: string;
  };
  receiver: {
    address: string;
    chain: string;
    agentDID?: string;
  };
  amount: string;
  asset: string;
  protocol?: string;
}

/** Parameters for {@link ProofLinkClient.screenAddress}. */
export interface ScreenAddressParams {
  address: string;
  chain: string;
  entityName?: string;
}

/** Parameters for {@link ProofLinkClient.calculateRiskScore}. */
export interface TransactionContext {
  senderAddress: string;
  receiverAddress: string;
  amount: string;
  asset: SupportedToken;
  chain: SupportedChain;
  /** Additional context for the risk model. */
  metadata?: Record<string, unknown>;
}

/** Result shape for travel rule check. */
export interface TravelRuleResult {
  status: "NOT_REQUIRED" | "TRANSMITTED" | "PENDING" | "FAILED" | "ACK_RECEIVED";
  originator: string;
  beneficiary: string;
  amountUsd: number;
  transmittedAt?: string;
  provider: string;
}

/** Parameters for {@link ProofLinkClient.getComplianceHistory}. */
export interface ComplianceHistoryParams extends PaginationParams {
  /** Filter by status. */
  status?: "APPROVED" | "REJECTED" | "ESCALATED";
  /** ISO-8601 lower bound. */
  from?: string;
  /** ISO-8601 upper bound. */
  to?: string;
}

// ---------------------------------------------------------------------------
// Invoices
// ---------------------------------------------------------------------------

/** Parameters for {@link ProofLinkClient.createInvoice}. */
export interface CreateInvoiceParams {
  seller: {
    agentId?: string;
    walletAddress: string;
    legalName?: string;
  };
  buyer: {
    agentId?: string;
    walletAddress: string;
    legalName?: string;
  };
  lineItems: Array<{
    description: string;
    quantity: number;
    unit?: string;
    unitPrice: number;
    total: number;
    serviceCategory?: string;
  }>;
  currency: InvoiceCurrency;
  totalAmount: number;
  paymentProtocol?: "x402" | "mpp" | "ap2" | "acp" | "direct";
  dueDate?: string;
}

/** Parameters for {@link ProofLinkClient.listInvoices}. */
export interface ListInvoicesParams extends PaginationParams {
  /** Filter by invoice state. */
  state?: InvoiceState;
  /** Filter by currency. */
  currency?: InvoiceCurrency;
  /** Filter by seller wallet address (partial match). */
  seller?: string;
  /** Filter by buyer wallet address (partial match). */
  buyer?: string;
  /** ISO-8601 lower bound. */
  from?: string;
  /** ISO-8601 upper bound. */
  to?: string;
}

// ---------------------------------------------------------------------------
// Identity / KYA
// ---------------------------------------------------------------------------

/** Parameters for {@link ProofLinkClient.registerAgent}. */
export interface AgentRegistration {
  agentDid: string;
  agentType: AgentType;
  controllingEntity: {
    name: string;
    lei?: string;
    did?: string;
    kybVerified: boolean;
  };
  walletAddress: string;
  delegationScope: {
    maxTransactionValue: number;
    dailyLimit?: number;
    allowedCounterparties?: string[];
    blockedJurisdictions?: string[];
    allowedChains?: string[];
    allowedCurrencies?: string[];
    expiresAt: string;
  };
  erc8004RegistryAddress?: string;
  erc8004TokenId?: string;
}

/** Parameters for {@link ProofLinkClient.issueKYA}. */
export interface IssueKYAParams {
  agentId: string;
  agentType: AgentType;
  controllingEntity: {
    name: string;
    lei?: string;
    did?: string;
    kybVerified: boolean;
  };
  delegationScope: DelegationScope;
  walletAddress: string;
  erc8004RegistryAddress?: string;
  erc8004TokenId?: string;
  validationEvidence?: string;
}

// ---------------------------------------------------------------------------
// SDK configuration
// ---------------------------------------------------------------------------

/** Configuration for the ProofLink client. */
export interface ProofLinkClientConfig {
  /** Your ProofLink API key. */
  apiKey: string;
  /** Override the default API base URL (default: https://api.prooflink.io/v1). */
  baseUrl?: string;
  /** Request timeout in milliseconds (default: 30_000). */
  timeout?: number;
  /** Maximum number of automatic retries for transient errors (default: 3). */
  maxRetries?: number;
}
