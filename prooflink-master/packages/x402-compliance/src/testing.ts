import { createHash } from "node:crypto";
import type {
  PaymentPayload,
  PaymentRequirements,
  SettleResponse,
  VerifyContext,
  SettleContext,
  SettleResultContext,
  ComplianceCheckEntry,
  ProofLinkReceipt,
  ScreeningResult,
  AmlScoreResult,
  KYACredential,
  KYAVerificationResult,
  TravelRuleTransmitRequest,
  TravelRuleTransmitResult,
  ProofLinkConfig,
  CompliancePolicy,
  ComplianceEvent,
  X402ResourceServer,
  ResourceServerExtension,
  BeforeHookResult,
  AfterHookResult,
} from "./types.js";
import type { SanctionsScreener, AmlScorer, KYAVerifier, KYARegistry } from "./hooks/before-verify.js";
import type { TravelRuleService, PriceConverter } from "./hooks/before-settle.js";
import type { ProofLinkService, InvoiceService } from "./hooks/after-settle.js";

// ---------------------------------------------------------------------------
// Test addresses
// ---------------------------------------------------------------------------

/** Well-known test addresses for compliance testing */
export const TEST_ADDRESSES = {
  /** Clean EVM sender address */
  CLEAN_SENDER: "0x1234567890abcdef1234567890abcdef12345678",
  /** Clean EVM receiver address */
  CLEAN_RECEIVER: "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd",
  /** Sanctioned EVM address */
  SANCTIONED: "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
  /** High-risk EVM address */
  HIGH_RISK: "0xbaadbaadbaadbaadbaadbaadbaadbaadbaadbaa0",
  /** Solana clean sender */
  SOLANA_SENDER: "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM",
  /** Solana clean receiver */
  SOLANA_RECEIVER: "6Cust2JhvweKLs4HJhTEFrs3oBRkhCGKFTh2iPkGLBtj",
} as const;

// ---------------------------------------------------------------------------
// Fixture generators
// ---------------------------------------------------------------------------

/**
 * Generate a test PaymentPayload with sensible defaults.
 */
export function createTestPaymentPayload(
  overrides: Partial<PaymentPayload> & { fromAddress?: string } = {},
): PaymentPayload {
  const { fromAddress, ...rest } = overrides;
  return {
    x402Version: 1,
    scheme: "exact",
    network: "eip155:8453",
    payload: {
      signature: "0x" + "a".repeat(130),
      authorization: {
        from: fromAddress ?? TEST_ADDRESSES.CLEAN_SENDER,
        to: TEST_ADDRESSES.CLEAN_RECEIVER,
        value: "1000000",
        validAfter: "0",
        validBefore: String(Math.floor(Date.now() / 1000) + 3600),
        nonce: "0x" + "0".repeat(64),
      },
    },
    ...rest,
  };
}

/**
 * Generate a test PaymentRequirements with sensible defaults.
 */
export function createTestPaymentRequirements(
  overrides: Partial<PaymentRequirements> = {},
): PaymentRequirements {
  return {
    scheme: "exact",
    network: "eip155:8453",
    maxAmountRequired: "1000000",
    payTo: TEST_ADDRESSES.CLEAN_RECEIVER,
    asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", // USDC on Base
    description: "Test payment",
    ...overrides,
  };
}

/**
 * Generate a test SettleResponse.
 */
export function createTestSettleResponse(
  overrides: Partial<SettleResponse> = {},
): SettleResponse {
  return {
    success: true,
    transaction: "0x" + "f".repeat(64),
    network: "eip155:8453",
    payer: TEST_ADDRESSES.CLEAN_SENDER,
    ...overrides,
  };
}

/**
 * Generate a test VerifyContext.
 */
export function createTestVerifyContext(
  overrides: { payload?: Partial<PaymentPayload>; requirements?: Partial<PaymentRequirements> } = {},
): VerifyContext {
  return {
    paymentPayload: createTestPaymentPayload(overrides.payload),
    requirements: createTestPaymentRequirements(overrides.requirements),
  };
}

/**
 * Generate a test SettleContext.
 */
export function createTestSettleContext(
  overrides: { payload?: Partial<PaymentPayload>; requirements?: Partial<PaymentRequirements> } = {},
): SettleContext {
  return {
    paymentPayload: createTestPaymentPayload(overrides.payload),
    requirements: createTestPaymentRequirements(overrides.requirements),
  };
}

/**
 * Generate a test SettleResultContext.
 */
export function createTestSettleResultContext(
  overrides: {
    payload?: Partial<PaymentPayload>;
    requirements?: Partial<PaymentRequirements>;
    result?: Partial<SettleResponse>;
  } = {},
): SettleResultContext {
  return {
    paymentPayload: createTestPaymentPayload(overrides.payload),
    requirements: createTestPaymentRequirements(overrides.requirements),
    result: createTestSettleResponse(overrides.result),
  };
}

/**
 * Generate a minimal test ProofLinkConfig.
 */
export function createTestConfig(overrides: Partial<ProofLinkConfig> = {}): ProofLinkConfig {
  return {
    chainalysisApiKey: "test-api-key-" + "x".repeat(32),
    policy: createTestPolicy(overrides.policy),
    ...overrides,
  };
}

/**
 * Generate a test CompliancePolicy.
 */
export function createTestPolicy(overrides: Partial<CompliancePolicy> = {}): CompliancePolicy {
  return {
    sanctionsLists: ["OFAC_SDN"],
    maxRiskScore: 70,
    travelRuleThresholdUsd: 3000,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Mock services
// ---------------------------------------------------------------------------

/**
 * Mock sanctions screener that returns configurable results.
 */
export class MockSanctionsScreener implements SanctionsScreener {
  private readonly sanctionedAddresses: Set<string>;
  public screenCalls: Array<{ address: string; network: string }> = [];

  constructor(sanctionedAddresses: string[] = []) {
    this.sanctionedAddresses = new Set(sanctionedAddresses.map((a) => a.toLowerCase()));
  }

  async screen(address: string, network: string): Promise<ScreeningResult> {
    this.screenCalls.push({ address, network });
    const isSanctioned = this.sanctionedAddresses.has(address.toLowerCase());
    return {
      address,
      clean: !isSanctioned,
      matchedList: isSanctioned ? "OFAC_SDN" : undefined,
      latencyMs: 1,
    };
  }

  /** Add an address to the sanctioned set */
  sanction(address: string): void {
    this.sanctionedAddresses.add(address.toLowerCase());
  }

  /** Remove an address from the sanctioned set */
  unsanction(address: string): void {
    this.sanctionedAddresses.delete(address.toLowerCase());
  }

  /** Reset all state */
  reset(): void {
    this.sanctionedAddresses.clear();
    this.screenCalls = [];
  }
}

/**
 * Mock AML scorer that returns configurable risk scores.
 */
export class MockAmlScorer implements AmlScorer {
  private readonly scores = new Map<string, number>();
  public scoreCalls: Array<{ address: string; amount: string; network: string }> = [];
  public defaultScore: number;

  constructor(defaultScore = 0) {
    this.defaultScore = defaultScore;
  }

  async score(address: string, amount: string, network: string): Promise<AmlScoreResult> {
    this.scoreCalls.push({ address, amount, network });
    const score = this.scores.get(address.toLowerCase()) ?? this.defaultScore;
    return {
      address,
      score,
      latencyMs: 1,
      factors: score > 50 ? ["high_risk_counterparty"] : [],
    };
  }

  /** Set risk score for a specific address */
  setScore(address: string, score: number): void {
    this.scores.set(address.toLowerCase(), score);
  }

  /** Reset all state */
  reset(): void {
    this.scores.clear();
    this.scoreCalls = [];
  }
}

/**
 * Mock KYA verifier.
 */
export class MockKYAVerifier implements KYAVerifier {
  private readonly validAgents = new Set<string>();
  private readonly expiredAgents = new Set<string>();
  public verifyCalls: string[] = [];

  constructor(validAgents: string[] = []) {
    for (const a of validAgents) this.validAgents.add(a);
  }

  async verify(agentId: string): Promise<KYAVerificationResult> {
    this.verifyCalls.push(agentId);
    if (this.expiredAgents.has(agentId)) {
      return { valid: false, expired: true, agentId, latencyMs: 1 };
    }
    return {
      valid: this.validAgents.has(agentId),
      expired: false,
      agentId,
      reason: this.validAgents.has(agentId) ? undefined : "unknown_agent",
      latencyMs: 1,
    };
  }

  setValid(agentId: string): void {
    this.validAgents.add(agentId);
    this.expiredAgents.delete(agentId);
  }

  setExpired(agentId: string): void {
    this.expiredAgents.add(agentId);
    this.validAgents.delete(agentId);
  }

  reset(): void {
    this.validAgents.clear();
    this.expiredAgents.clear();
    this.verifyCalls = [];
  }
}

/**
 * Mock KYA registry.
 */
export class MockKYARegistry implements KYARegistry {
  private readonly credentials = new Map<string, KYACredential>();

  async lookup(address: string): Promise<KYACredential | null> {
    return this.credentials.get(address.toLowerCase()) ?? null;
  }

  register(address: string, credential: KYACredential): void {
    this.credentials.set(address.toLowerCase(), credential);
  }

  reset(): void {
    this.credentials.clear();
  }
}

/**
 * Mock travel rule service.
 */
export class MockTravelRuleService implements TravelRuleService {
  public transmitCalls: TravelRuleTransmitRequest[] = [];
  public shouldFail = false;

  async transmit(request: TravelRuleTransmitRequest): Promise<TravelRuleTransmitResult> {
    this.transmitCalls.push(request);
    if (this.shouldFail) {
      return { success: false, error: "mock_failure", latencyMs: 1 };
    }
    return {
      success: true,
      referenceId: "TR-" + Date.now().toString(36),
      latencyMs: 1,
    };
  }

  reset(): void {
    this.transmitCalls = [];
    this.shouldFail = false;
  }
}

/**
 * Mock price converter (assumes 6-decimal stablecoins = 1 USD).
 */
export class MockPriceConverter implements PriceConverter {
  public conversionRate: number;

  constructor(conversionRate = 1) {
    this.conversionRate = conversionRate;
  }

  async toUsd(amount: string, _asset: string, _network: string): Promise<number> {
    const raw = Number(amount);
    if (Number.isNaN(raw)) return 0;
    return (raw / 1_000_000) * this.conversionRate;
  }
}

/**
 * Mock ProofLink service.
 */
export class MockProofLinkService implements ProofLinkService {
  public storedReceipts: ProofLinkReceipt[] = [];
  public attestedReceipts: ProofLinkReceipt[] = [];

  computeHash(receipt: ProofLinkReceipt): string {
    const data = `${receipt.transactionHash}:${receipt.sender}:${receipt.receiver}:${receipt.amount}:${receipt.createdAt}`;
    return "0x" + createHash("sha256").update(data).digest("hex");
  }

  async attestOnChain(receipt: ProofLinkReceipt): Promise<string | null> {
    this.attestedReceipts.push(receipt);
    return "0x" + "e".repeat(64);
  }

  async storeAuditRecord(receipt: ProofLinkReceipt): Promise<void> {
    this.storedReceipts.push(receipt);
  }

  reset(): void {
    this.storedReceipts = [];
    this.attestedReceipts = [];
  }
}

/**
 * Mock invoice service.
 */
export class MockInvoiceService implements InvoiceService {
  public generatedInvoices: ProofLinkReceipt[] = [];

  async generate(receipt: ProofLinkReceipt): Promise<string | null> {
    this.generatedInvoices.push(receipt);
    return "INV-" + Date.now().toString(36);
  }

  reset(): void {
    this.generatedInvoices = [];
  }
}

// ---------------------------------------------------------------------------
// Event collector
// ---------------------------------------------------------------------------

/**
 * Collects compliance events for assertions in tests.
 */
export class EventCollector {
  public events: ComplianceEvent[] = [];

  handler(): (event: ComplianceEvent) => void {
    return (event) => this.events.push(event);
  }

  /** Get events of a specific type */
  ofType(type: string): ComplianceEvent[] {
    return this.events.filter((e) => e.type === type);
  }

  /** Check if any event of given type was emitted */
  hasEvent(type: string): boolean {
    return this.events.some((e) => e.type === type);
  }

  /** Get the last event */
  get last(): ComplianceEvent | undefined {
    return this.events[this.events.length - 1];
  }

  /** Reset collected events */
  reset(): void {
    this.events = [];
  }
}

// ---------------------------------------------------------------------------
// Mock x402 resource server
// ---------------------------------------------------------------------------

/**
 * Mock x402 resource server for testing compliance registration.
 */
export class MockResourceServer implements X402ResourceServer {
  public beforeVerifyHooks: Array<(ctx: VerifyContext) => Promise<BeforeHookResult>> = [];
  public beforeSettleHooks: Array<(ctx: SettleContext) => Promise<BeforeHookResult>> = [];
  public afterSettleHooks: Array<(ctx: SettleResultContext) => Promise<AfterHookResult>> = [];
  public extensions: ResourceServerExtension[] = [];

  onBeforeVerify(hook: (ctx: VerifyContext) => Promise<BeforeHookResult>): void {
    this.beforeVerifyHooks.push(hook);
  }

  onBeforeSettle(hook: (ctx: SettleContext) => Promise<BeforeHookResult>): void {
    this.beforeSettleHooks.push(hook);
  }

  onAfterSettle(hook: (ctx: SettleResultContext) => Promise<AfterHookResult>): void {
    this.afterSettleHooks.push(hook);
  }

  registerExtension(extension: ResourceServerExtension): void {
    this.extensions.push(extension);
  }

  /** Simulate a full verify -> settle -> afterSettle cycle */
  async simulatePayment(ctx: {
    payload?: Partial<PaymentPayload>;
    requirements?: Partial<PaymentRequirements>;
    settleResult?: Partial<SettleResponse>;
  } = {}): Promise<{
    verifyResult: BeforeHookResult;
    settleResult: BeforeHookResult;
    afterSettleResult: AfterHookResult;
  }> {
    const paymentPayload = createTestPaymentPayload(ctx.payload);
    const requirements = createTestPaymentRequirements(ctx.requirements);
    const settleResponse = createTestSettleResponse(ctx.settleResult);

    let verifyResult: BeforeHookResult;
    for (const hook of this.beforeVerifyHooks) {
      verifyResult = await hook({ paymentPayload, requirements });
      if (verifyResult && "abort" in verifyResult) {
        return { verifyResult, settleResult: undefined, afterSettleResult: undefined };
      }
    }

    let settleResult: BeforeHookResult;
    for (const hook of this.beforeSettleHooks) {
      settleResult = await hook({ paymentPayload, requirements });
      if (settleResult && "abort" in settleResult) {
        return { verifyResult: undefined, settleResult, afterSettleResult: undefined };
      }
    }

    let afterSettleResult: AfterHookResult;
    for (const hook of this.afterSettleHooks) {
      afterSettleResult = await hook({ paymentPayload, requirements, result: settleResponse });
    }

    return { verifyResult: undefined, settleResult: undefined, afterSettleResult };
  }

  reset(): void {
    this.beforeVerifyHooks = [];
    this.beforeSettleHooks = [];
    this.afterSettleHooks = [];
    this.extensions = [];
  }
}
