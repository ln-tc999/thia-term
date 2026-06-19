// ---------------------------------------------------------------------------
// @prooflink/x402-compliance — barrel exports
// ---------------------------------------------------------------------------

// Main class and factory
export { ProofLinkX402Compliance } from "./middleware.js";
export type { ProofLinkComplianceServices } from "./middleware.js";

// Factory function
export { createProofLinkCompliance } from "./factory.js";

// Types
export type {
  // Config
  ProofLinkConfig,
  CompliancePolicy,
  NotabeneConfig,
  RedisConfig,
  EASConfig,
  InvoicingConfig,
  Logger,

  // Enhanced config types
  WebhookConfig,
  RetryPolicy,
  MetricsCollector,
  RouteCompliancePolicy,
  RateLimitTier,

  // x402 compatible types
  PaymentPayload,
  PaymentPayloadInner,
  PaymentRequirements,
  VerifyResponse,
  SettleResponse,
  VerifyContext,
  SettleContext,
  SettleResultContext,
  X402ResourceServer,
  ResourceServerExtension,
  BeforeHookResult,
  HookAbort,

  // Compliance types
  ProofLinkReceipt,
  ComplianceCheckEntry,
  PendingDecision,
  ScreeningResult,
  AmlScoreResult,
  TravelRuleTransmitRequest,
  TravelRuleTransmitResult,
  KYACredential,
  KYAVerificationResult,

  // Events
  ComplianceEvent,
  ComplianceEventType,
  ComplianceEventHandler,

  // Chain types
  ChainFamily,
  ChainInfo,

  // Adapter types
  AdapterRequest,
  AdapterResponse,
  AdapterNextFunction,
  ComplianceAdapterOptions,
} from "./types.js";

// Address extraction and multi-chain support
export {
  extractSenderAddress,
  registerAddressExtractor,
  getChainInfo,
  detectChainFamily,
  getEvmChainId,
  buildCaip2,
  listKnownChains,
  validateAddress,
  validateAddressForNetwork,
  normalizeAddress,
} from "./address.js";

// ProofLink receipt generation
export {
  ProofLinkReceiptBuilder,
  InMemoryReceiptStore,
  type ReceiptBuilderOptions,
  type ReceiptStore,
} from "./receipt.js";

// Rate limiting
export { RateLimiter, type RateLimitResult } from "./rate-limiter.js";

// Compliance event logging
export {
  ComplianceLogger,
  ConsoleJsonTransport,
  BufferedTransport,
  type ComplianceLogEntry,
  type ComplianceLoggerOptions,
  type LogTransport,
} from "./logger.js";

// Hooks (for standalone use)
export { createBeforeVerifyHook, payloadKey } from "./hooks/before-verify.js";
export type { SanctionsScreener, AmlScorer, KYAVerifier, KYARegistry } from "./hooks/before-verify.js";

export { createBeforeSettleHook } from "./hooks/before-settle.js";
export type { TravelRuleService, PriceConverter } from "./hooks/before-settle.js";

export { createAfterSettleHook } from "./hooks/after-settle.js";
export type { ProofLinkService, InvoiceService } from "./hooks/after-settle.js";

// Extension
export { createProofLinkExtension } from "./extension.js";

// Testing utilities
export {
  // Fixtures
  TEST_ADDRESSES,
  createTestPaymentPayload,
  createTestPaymentRequirements,
  createTestSettleResponse,
  createTestVerifyContext,
  createTestSettleContext,
  createTestSettleResultContext,
  createTestConfig,
  createTestPolicy,
  // Mocks
  MockSanctionsScreener,
  MockAmlScorer,
  MockKYAVerifier,
  MockKYARegistry,
  MockTravelRuleService,
  MockPriceConverter,
  MockProofLinkService,
  MockInvoiceService,
  MockResourceServer,
  // Helpers
  EventCollector,
} from "./testing.js";
