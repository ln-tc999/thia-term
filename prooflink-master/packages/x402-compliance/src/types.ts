import { z } from "zod";
import type {
  ComplianceDecision,
  ComplianceReceipt,
  SanctionsList,
} from "@prooflink/shared/types";

// ---------------------------------------------------------------------------
// Re-exports from @prooflink/shared
// ---------------------------------------------------------------------------

export type {
  ComplianceDecision,
  ComplianceReceipt,
  SanctionsList,
  AMLRiskScore,
  TravelRuleData,
  TravelRuleStatus,
  CheckPerformed,
  ComplianceCheckType,
  ComplianceCheckResult,
} from "@prooflink/shared/types";

// ---------------------------------------------------------------------------
// x402 SDK compatible types (defined inline — no @x402/core dependency)
// ---------------------------------------------------------------------------

/** EIP-3009 authorization payload */
export interface EIP3009Authorization {
  from: string;
  to: string;
  value: string;
  validAfter: string;
  validBefore: string;
  nonce: string;
}

/** Permit2 authorization payload */
export interface Permit2Authorization {
  from: string;
  to: string;
  amount: string;
  token: string;
  nonce: string;
  deadline: string;
}

/** Inner payload of a PaymentPayload */
export interface PaymentPayloadInner {
  signature: string;
  authorization?: EIP3009Authorization;
  permit2Authorization?: Permit2Authorization;
  /** Solana sender pubkey */
  sender?: string;
  [key: string]: unknown;
}

/** x402 PaymentPayload — the signed payment the client submits */
export interface PaymentPayload {
  x402Version: number;
  scheme: string;
  network: string;
  payload: PaymentPayloadInner;
  resource?: string;
}

/** x402 PaymentRequirements — what the server demands */
export interface PaymentRequirements {
  scheme: string;
  network: string;
  maxAmountRequired: string;
  resource?: string;
  description?: string;
  payTo: string;
  asset: string;
  extra?: Record<string, unknown>;
}

/** x402 VerifyResponse from facilitator */
export interface VerifyResponse {
  isValid: boolean;
  invalidReason?: string;
  payer?: string;
  extensions?: Record<string, unknown>;
}

/** x402 SettleResponse from facilitator */
export interface SettleResponse {
  success: boolean;
  transaction: string;
  network: string;
  payer?: string;
  errorReason?: string;
  extensions?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// x402 Hook Contexts
// ---------------------------------------------------------------------------

export interface VerifyContext {
  paymentPayload: PaymentPayload;
  requirements: PaymentRequirements;
}

export interface SettleContext {
  paymentPayload: PaymentPayload;
  requirements: PaymentRequirements;
}

export interface SettleResultContext {
  paymentPayload: PaymentPayload;
  requirements: PaymentRequirements;
  result: SettleResponse;
}

// ---------------------------------------------------------------------------
// x402 Hook return types
// ---------------------------------------------------------------------------

export interface HookAbort {
  abort: true;
  reason: string;
  message?: string;
}

export type BeforeHookResult = void | HookAbort;
export type AfterHookResult = void;

// ---------------------------------------------------------------------------
// x402 ResourceServer & Extension interfaces
// ---------------------------------------------------------------------------

export type BeforeVerifyHook = (ctx: VerifyContext) => Promise<BeforeHookResult>;
export type BeforeSettleHook = (ctx: SettleContext) => Promise<BeforeHookResult>;
export type AfterSettleHook = (ctx: SettleResultContext) => Promise<AfterHookResult>;

export interface X402ResourceServer {
  onBeforeVerify(hook: BeforeVerifyHook): void;
  onBeforeSettle(hook: BeforeSettleHook): void;
  onAfterSettle(hook: AfterSettleHook): void;
  registerExtension(extension: ResourceServerExtension): void;
}

export interface ResourceServerExtension {
  key: string;
  enrichPaymentRequiredResponse?(
    declaration: Record<string, unknown>,
    context: { requirements: PaymentRequirements },
  ): Promise<Record<string, unknown>>;
  enrichSettlementResponse?(
    declaration: Record<string, unknown>,
    context: { paymentPayload: PaymentPayload; requirements: PaymentRequirements },
  ): Promise<Record<string, unknown>>;
}

// ---------------------------------------------------------------------------
// ProofLink Compliance Config
// ---------------------------------------------------------------------------

export const CompliancePolicySchema = z.object({
  sanctionsLists: z.array(z.enum(["OFAC_SDN", "OFAC_CONS", "UN", "EU", "HMT"])),
  maxRiskScore: z.number().int().min(0).max(100),
  travelRuleThresholdUsd: z.number().positive(),
  eddJurisdictions: z.array(z.string()).optional(),
  allowlist: z.array(z.string()).optional(),
  blocklist: z.array(z.string()).optional(),
});
export type CompliancePolicy = z.infer<typeof CompliancePolicySchema>;

export const NotabeneConfigSchema = z.object({
  apiKey: z.string().min(1),
  vaspDID: z.string().min(1),
  testnet: z.boolean().optional(),
});
export type NotabeneConfig = z.infer<typeof NotabeneConfigSchema>;

export const RedisConfigSchema = z.object({
  url: z.string().url(),
  cleanCacheTtlSeconds: z.number().int().positive().default(3600),
  flaggedCacheTtlSeconds: z.number().int().positive().default(300),
});
export type RedisConfig = z.infer<typeof RedisConfigSchema>;

export const EASConfigSchema = z.object({
  schemaUid: z.string().startsWith("0x"),
  privateKey: z.string().startsWith("0x"),
  rpcUrl: z.string().url(),
});
export type EASConfig = z.infer<typeof EASConfigSchema>;

export const InvoicingConfigSchema = z.object({
  enabled: z.boolean(),
  companyName: z.string().min(1),
  companyAddress: z.string().min(1),
  taxId: z.string().optional(),
  webhookUrl: z.string().url().optional(),
});
export type InvoicingConfig = z.infer<typeof InvoicingConfigSchema>;

export interface Logger {
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
  debug(message: string, ...args: unknown[]): void;
}

// ---------------------------------------------------------------------------
// Webhook configuration
// ---------------------------------------------------------------------------

export const WebhookConfigSchema = z.object({
  /** URL to POST compliance events to */
  url: z.string().url(),
  /** Secret for HMAC-SHA256 signing of webhook payloads */
  secret: z.string().min(16).optional(),
  /** Which event types to send (defaults to all) */
  events: z
    .array(
      z.enum([
        "compliance:check:started",
        "compliance:check:passed",
        "compliance:check:failed",
        "compliance:settle:completed",
        "compliance:receipt:generated",
        "compliance:receipt:attested",
      ]),
    )
    .optional(),
  /** Timeout in ms for webhook HTTP calls (default 5000) */
  timeoutMs: z.number().int().positive().default(5000),
});
export type WebhookConfig = z.infer<typeof WebhookConfigSchema>;

// ---------------------------------------------------------------------------
// Retry policy
// ---------------------------------------------------------------------------

export const RetryPolicySchema = z.object({
  /** Max number of retry attempts (default 3) */
  maxRetries: z.number().int().min(0).max(10).default(3),
  /** Initial delay in ms before first retry (default 200) */
  initialDelayMs: z.number().int().positive().default(200),
  /** Backoff multiplier (default 2) */
  backoffMultiplier: z.number().positive().default(2),
  /** Max delay cap in ms (default 5000) */
  maxDelayMs: z.number().int().positive().default(5000),
});
export type RetryPolicy = z.infer<typeof RetryPolicySchema>;

// ---------------------------------------------------------------------------
// Metrics collection interface
// ---------------------------------------------------------------------------

export interface MetricsCollector {
  /** Increment a counter */
  increment(metric: string, value?: number, tags?: Record<string, string>): void;
  /** Record a histogram/timing value */
  histogram(metric: string, value: number, tags?: Record<string, string>): void;
  /** Set a gauge value */
  gauge(metric: string, value: number, tags?: Record<string, string>): void;
}

// ---------------------------------------------------------------------------
// Route-level compliance policy overrides
// ---------------------------------------------------------------------------

export interface RouteCompliancePolicy {
  /** Route pattern (glob or exact match) */
  pattern: string;
  /** Override the default compliance policy for this route */
  policy?: Partial<CompliancePolicy>;
  /** Skip compliance entirely for this route */
  skipCompliance?: boolean;
  /** Custom rate limit tier for this route */
  rateLimitTier?: string;
}

export const RouteCompliancePolicySchema = z.object({
  pattern: z.string().min(1),
  policy: CompliancePolicySchema.partial().optional(),
  skipCompliance: z.boolean().optional(),
  rateLimitTier: z.string().optional(),
});

// ---------------------------------------------------------------------------
// Rate limit tier
// ---------------------------------------------------------------------------

export const RateLimitTierSchema = z.object({
  /** Maximum requests in the window */
  maxRequests: z.number().int().positive(),
  /** Window size in seconds */
  windowSeconds: z.number().int().positive(),
});
export type RateLimitTier = z.infer<typeof RateLimitTierSchema>;

// ---------------------------------------------------------------------------
// Enhanced ProofLink Config
// ---------------------------------------------------------------------------

export const ProofLinkConfigSchema = z.object({
  chainalysisApiKey: z.string().min(1),
  notabene: NotabeneConfigSchema.optional(),
  redis: RedisConfigSchema.optional(),
  policy: CompliancePolicySchema,
  eas: EASConfigSchema.optional(),
  invoicing: InvoicingConfigSchema.optional(),
  metricsPrefix: z.string().optional(),
  webhooks: z.array(WebhookConfigSchema).optional(),
  retryPolicy: RetryPolicySchema.optional(),
  routePolicies: z.array(RouteCompliancePolicySchema).optional(),
  rateLimitTiers: z.record(z.string(), RateLimitTierSchema).optional(),
});

/** Full configuration object — `logger` and `metrics` are not validated by zod */
export interface ProofLinkConfig extends z.infer<typeof ProofLinkConfigSchema> {
  logger?: Logger;
  metrics?: MetricsCollector;
}

// ---------------------------------------------------------------------------
// Screening service interfaces
// ---------------------------------------------------------------------------

export interface ScreeningResult {
  address: string;
  clean: boolean;
  matchedList?: string;
  latencyMs: number;
}

export interface AmlScoreResult {
  address: string;
  score: number;
  latencyMs: number;
  factors: string[];
}

export interface TravelRuleTransmitRequest {
  originatorAddress: string;
  beneficiaryAddress: string;
  amount: string;
  asset: string;
  network: string;
}

export interface TravelRuleTransmitResult {
  success: boolean;
  referenceId?: string;
  error?: string;
  latencyMs: number;
}

// ---------------------------------------------------------------------------
// ProofLink Receipt (x402-specific, extends shared ComplianceReceipt)
// ---------------------------------------------------------------------------

export interface ProofLinkReceipt {
  version: 1;
  transactionHash: string;
  network: string;
  sender: string;
  receiver: string;
  amount: string;
  asset: string;
  complianceChecks: ComplianceCheckEntry[];
  riskScore: number;
  proofLinkHash: string;
  travelRuleRef?: string;
  attestationUid?: string;
  invoiceId?: string;
  createdAt: string;
  /** Provider signature over the receipt (hex-encoded) */
  signature?: string;
}

export interface ComplianceCheckEntry {
  type: "sanctions" | "aml" | "travel_rule" | "jurisdiction" | "allowlist" | "blocklist" | "kya";
  target: string;
  result: "pass" | "fail" | "skip";
  detail?: string;
  latencyMs: number;
}

// ---------------------------------------------------------------------------
// Compliance event (for event emission)
// ---------------------------------------------------------------------------

export type ComplianceEventType =
  | "compliance:check:started"
  | "compliance:check:passed"
  | "compliance:check:failed"
  | "compliance:settle:completed"
  | "compliance:receipt:generated"
  | "compliance:receipt:attested";

export interface ComplianceEvent {
  type: ComplianceEventType;
  timestamp: number;
  payload: {
    sender?: string;
    receiver?: string;
    network?: string;
    amount?: string;
    riskScore?: number;
    reason?: string;
    proofLinkHash?: string;
    transactionHash?: string;
    [key: string]: unknown;
  };
}

export type ComplianceEventHandler = (event: ComplianceEvent) => void;

// ---------------------------------------------------------------------------
// Pending compliance decision (internal bookkeeping between hooks)
// ---------------------------------------------------------------------------

export interface PendingDecision {
  pass: boolean;
  riskScore: number;
  checks: ComplianceCheckEntry[];
  timestamp: number;
  latencyMs: number;
  travelRuleRef?: string;
}

// ---------------------------------------------------------------------------
// KYA (Know Your Agent) types
// ---------------------------------------------------------------------------

export interface KYACredential {
  agentId: string;
  issuer: string;
  issuedAt: string;
  expiresAt: string;
  validationRegistryAddress?: string;
  reputationScore?: number;
}

export interface KYAVerificationResult {
  valid: boolean;
  expired: boolean;
  agentId?: string;
  reason?: string;
  latencyMs: number;
}

// ---------------------------------------------------------------------------
// Chain info types (for multi-chain support)
// ---------------------------------------------------------------------------

export type ChainFamily = "evm" | "solana";

export interface ChainInfo {
  family: ChainFamily;
  /** CAIP-2 identifier, e.g. "eip155:1", "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp" */
  caip2: string;
  /** Human-readable name */
  name: string;
  /** Chain ID for EVM chains */
  chainId?: number;
}

// ---------------------------------------------------------------------------
// Adapter types (for Express/Hono/Fastify)
// ---------------------------------------------------------------------------

/** Generic HTTP request shape for adapter abstraction */
export interface AdapterRequest {
  method: string;
  url: string;
  path: string;
  headers: Record<string, string | string[] | undefined>;
  body?: unknown;
  /** IP address of the client */
  ip?: string;
}

/** Generic HTTP response shape for adapter abstraction */
export interface AdapterResponse {
  status(code: number): AdapterResponse;
  json(body: unknown): void;
  setHeader(name: string, value: string): void;
}

/** Generic next function for middleware chains */
export type AdapterNextFunction = () => Promise<void> | void;

/** Options for framework adapters */
export interface ComplianceAdapterOptions {
  /** The compliance instance to use */
  compliance: import("./middleware.js").ProofLinkX402Compliance;
  /** Extract payment payload from the request (framework-specific) */
  extractPayload?: (req: AdapterRequest) => PaymentPayload | null;
  /** Extract payment requirements from the request (framework-specific) */
  extractRequirements?: (req: AdapterRequest) => PaymentRequirements | null;
  /** Route patterns to apply compliance to (defaults to all) */
  routes?: string[];
  /** Logger override */
  logger?: Logger;
}
