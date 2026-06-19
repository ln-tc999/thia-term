// Client
export { ProofLinkClient } from "./client.js";

// Errors
export {
  ProofLinkError,
  ProofLinkAPIError,
  ProofLinkValidationError,
  ProofLinkTimeoutError,
  ProofLinkNetworkError,
} from "./errors.js";
export type { ApiErrorBody } from "./errors.js";

// HTTP transport (advanced usage)
export { HttpClient } from "./http.js";
export type { HttpClientConfig } from "./http.js";

// SDK-specific types
export type {
  AgentRegistration,
  ComplianceCheckParams,
  ComplianceHistoryParams,
  CreateInvoiceParams,
  ProofLinkClientConfig,
  IssueKYAParams,
  ListInvoicesParams,
  PaginatedResponse,
  PaginationParams,
  ScreenAddressParams,
  TransactionContext,
  TravelRuleResult,
} from "./types.js";

// Re-exported shared types
export type {
  AgentIdentity,
  AgentInvoice,
  AgentType,
  AMLRiskFactor,
  AMLRiskScore,
  CheckPerformed,
  ComplianceCheckResult,
  ComplianceCheckType,
  ComplianceDecision,
  ComplianceDecisionStatus,
  CompliancePolicy,
  ComplianceReceipt,
  ComplianceRequest,
  ComplianceStamp,
  DelegationScope,
  InvoiceCurrency,
  InvoiceLineItem,
  InvoiceParty,
  InvoiceState,
  IVMS101Person,
  KYACredential,
  KYACredentialSubject,
  KYAVerificationResult,
  PaymentIntent,
  PaymentProof,
  PaymentProtocol,
  ProofLinkReceipt,
  SanctionsCheckResult,
  SanctionsList,
  SanctionsMatchDetail,
  ServiceCategory,
  SettlementResult,
  SettlementStatus,
  SupportedChain,
  SupportedToken,
  TravelRuleData,
  TravelRuleStatus,
} from "./types.js";
