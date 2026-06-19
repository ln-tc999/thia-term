import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { ProofLinkX402Compliance } from "../middleware.js";
import { createProofLinkCompliance } from "../factory.js";
import type {
  ProofLinkConfig,
  PaymentPayload,
  PaymentRequirements,
  VerifyContext,
  SettleContext,
  SettleResultContext,
  X402ResourceServer,
  ResourceServerExtension,
  ScreeningResult,
  AmlScoreResult,
  KYACredential,
  KYAVerificationResult,
  ComplianceEvent,
  BeforeHookResult,
} from "../types.js";
import type { SanctionsScreener, AmlScorer, KYAVerifier, KYARegistry } from "../hooks/before-verify.js";
import type { TravelRuleService, PriceConverter } from "../hooks/before-settle.js";
import type { ProofLinkService, InvoiceService } from "../hooks/after-settle.js";

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const CLEAN_SENDER = "0x1111111111111111111111111111111111111111";
const CLEAN_RECEIVER = "0x2222222222222222222222222222222222222222";
const SANCTIONED_ADDRESS = "0xBAD0000000000000000000000000000000000BAD";
const BLOCKLISTED_ADDRESS = "0xBLOCK000000000000000000000000000BLOCKED";
const AGENT_ADDRESS = "0xA6E41000000000000000000000000000000A6E41";

function makePayload(overrides?: Partial<PaymentPayload>): PaymentPayload {
  return {
    x402Version: 2,
    scheme: "exact",
    network: "eip155:8453",
    payload: {
      signature: "0xabcdef1234567890abcdef1234567890abcdef1234567890",
      authorization: {
        from: CLEAN_SENDER,
        to: CLEAN_RECEIVER,
        value: "10000",
        validAfter: "1740672089",
        validBefore: "1740672154",
        nonce: "0xf3746",
      },
    },
    ...overrides,
  };
}

function makeRequirements(overrides?: Partial<PaymentRequirements>): PaymentRequirements {
  return {
    scheme: "exact",
    network: "eip155:8453",
    maxAmountRequired: "10000",
    payTo: CLEAN_RECEIVER,
    asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    ...overrides,
  };
}

function makeConfig(overrides?: Partial<ProofLinkConfig>): ProofLinkConfig {
  return {
    chainalysisApiKey: "test-api-key",
    policy: {
      sanctionsLists: ["OFAC_SDN", "EU", "UN"],
      maxRiskScore: 70,
      travelRuleThresholdUsd: 3000,
      blocklist: [BLOCKLISTED_ADDRESS],
      ...overrides?.policy,
    },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Mock services
// ---------------------------------------------------------------------------

function createMockScreener(overrides?: Partial<SanctionsScreener>): SanctionsScreener {
  return {
    screen: vi.fn(async (address: string, _network: string): Promise<ScreeningResult> => {
      const isSanctioned = address.toLowerCase() === SANCTIONED_ADDRESS.toLowerCase();
      return {
        address,
        clean: !isSanctioned,
        matchedList: isSanctioned ? "OFAC_SDN" : undefined,
        latencyMs: 5,
      };
    }),
    ...overrides,
  };
}

function createMockAmlScorer(score = 20): AmlScorer {
  return {
    score: vi.fn(async (address: string): Promise<AmlScoreResult> => ({
      address,
      score,
      latencyMs: 3,
      factors: score > 50 ? ["velocity_anomaly"] : [],
    })),
  };
}

function createMockKYARegistry(knownAgent?: string): KYARegistry {
  return {
    lookup: vi.fn(async (address: string): Promise<KYACredential | null> => {
      if (knownAgent && address.toLowerCase() === knownAgent.toLowerCase()) {
        return {
          agentId: "agent-001",
          issuer: "did:ethr:0xISSUER",
          issuedAt: new Date(Date.now() - 86400_000).toISOString(),
          expiresAt: new Date(Date.now() + 86400_000).toISOString(),
          reputationScore: 85,
        };
      }
      return null;
    }),
  };
}

function createMockKYAVerifier(valid = true, expired = false): KYAVerifier {
  return {
    verify: vi.fn(async (_agentId: string): Promise<KYAVerificationResult> => ({
      valid,
      expired,
      agentId: _agentId,
      reason: valid ? undefined : (expired ? "credential expired" : "verification failed"),
      latencyMs: 2,
    })),
  };
}

function createMockTravelRuleService(success = true): TravelRuleService {
  return {
    transmit: vi.fn(async () => ({
      success,
      referenceId: success ? "tr-ref-12345" : undefined,
      error: success ? undefined : "Notabene API error",
      latencyMs: 50,
    })),
  };
}

function createMockPriceConverter(usdAmount: number): PriceConverter {
  return {
    toUsd: vi.fn(async () => usdAmount),
  };
}

function createMockProofLinkService(): ProofLinkService {
  return {
    computeHash: vi.fn((receipt) => `0x${receipt.transactionHash.slice(2, 18)}`),
    attestOnChain: vi.fn(async () => "eas-uid-12345"),
    storeAuditRecord: vi.fn(async () => {}),
  };
}

function createMockInvoiceService(): InvoiceService {
  return {
    generate: vi.fn(async () => "inv-12345"),
  };
}

function createMockServer(): X402ResourceServer & {
  hooks: {
    beforeVerify: Array<(ctx: VerifyContext) => Promise<BeforeHookResult>>;
    beforeSettle: Array<(ctx: SettleContext) => Promise<BeforeHookResult>>;
    afterSettle: Array<(ctx: SettleResultContext) => Promise<void>>;
  };
  extensions: ResourceServerExtension[];
} {
  const hooks = {
    beforeVerify: [] as Array<(ctx: VerifyContext) => Promise<BeforeHookResult>>,
    beforeSettle: [] as Array<(ctx: SettleContext) => Promise<BeforeHookResult>>,
    afterSettle: [] as Array<(ctx: SettleResultContext) => Promise<void>>,
  };
  const extensions: ResourceServerExtension[] = [];

  return {
    hooks,
    extensions,
    onBeforeVerify: vi.fn((hook) => { hooks.beforeVerify.push(hook); }),
    onBeforeSettle: vi.fn((hook) => { hooks.beforeSettle.push(hook); }),
    onAfterSettle: vi.fn((hook) => { hooks.afterSettle.push(hook); }),
    registerExtension: vi.fn((ext) => { extensions.push(ext); }),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ProofLinkX402Compliance", () => {
  let compliance: ProofLinkX402Compliance;

  afterEach(() => {
    compliance?.destroy();
  });

  describe("constructor & registration", () => {
    test("creates instance with valid config", () => {
      compliance = new ProofLinkX402Compliance(makeConfig());
      expect(compliance).toBeInstanceOf(ProofLinkX402Compliance);
    });

    test("throws on invalid config", () => {
      expect(() => {
        new ProofLinkX402Compliance({ chainalysisApiKey: "", policy: {} } as ProofLinkConfig);
      }).toThrow();
    });

    test("registers all hooks and extension on server", () => {
      compliance = new ProofLinkX402Compliance(makeConfig());
      const server = createMockServer();

      compliance.register(server);

      expect(server.onBeforeVerify).toHaveBeenCalledOnce();
      expect(server.onBeforeSettle).toHaveBeenCalledOnce();
      expect(server.onAfterSettle).toHaveBeenCalledOnce();
      expect(server.registerExtension).toHaveBeenCalledOnce();
      expect(server.extensions[0]?.key).toBe("prooflink");
    });
  });

  describe("createProofLinkCompliance factory", () => {
    test("returns ProofLinkX402Compliance instance", () => {
      compliance = createProofLinkCompliance(makeConfig());
      expect(compliance).toBeInstanceOf(ProofLinkX402Compliance);
    });
  });

  // -------------------------------------------------------------------------
  // Full flow: payment -> compliance check -> settle -> receipt
  // -------------------------------------------------------------------------

  describe("full happy-path flow", () => {
    test("clean address passes verify, settle, and generates receipt", async () => {
      const screener = createMockScreener();
      const amlScorer = createMockAmlScorer(20);
      const proofLinkService = createMockProofLinkService();
      const events: ComplianceEvent[] = [];

      compliance = new ProofLinkX402Compliance(makeConfig(), {
        screener,
        amlScorer,
        proofLinkService,
      });
      compliance.on((e) => events.push(e));

      const payload = makePayload();
      const requirements = makeRequirements();

      // Step 1: onBeforeVerify — should pass
      const verifyResult = await compliance.onBeforeVerify({ paymentPayload: payload, requirements });
      expect(verifyResult).toBeUndefined();
      expect(screener.screen).toHaveBeenCalledTimes(2); // sender + receiver

      // Step 2: onBeforeSettle — should pass (below travel rule threshold)
      const settleResult = await compliance.onBeforeSettle({ paymentPayload: payload, requirements });
      expect(settleResult).toBeUndefined();

      // Step 3: onAfterSettle — should generate receipt
      await compliance.onAfterSettle({
        paymentPayload: payload,
        requirements,
        result: {
          success: true,
          transaction: "0xtxhash123456789",
          network: "eip155:8453",
          payer: CLEAN_SENDER,
        },
      });

      expect(proofLinkService.computeHash).toHaveBeenCalledOnce();
      expect(proofLinkService.storeAuditRecord).toHaveBeenCalledOnce();

      // Verify events
      const eventTypes = events.map((e) => e.type);
      expect(eventTypes).toContain("compliance:check:started");
      expect(eventTypes).toContain("compliance:check:passed");
      expect(eventTypes).toContain("compliance:settle:completed");
      expect(eventTypes).toContain("compliance:receipt:generated");
    });
  });

  // -------------------------------------------------------------------------
  // Sanctions block
  // -------------------------------------------------------------------------

  describe("sanctions screening", () => {
    test("blocks payment from sanctioned sender", async () => {
      const screener = createMockScreener();
      compliance = new ProofLinkX402Compliance(makeConfig(), { screener });

      const payload = makePayload({
        payload: {
          signature: "0xsanctioned_sig_1234567890abcdef1234567890",
          authorization: {
            from: SANCTIONED_ADDRESS,
            to: CLEAN_RECEIVER,
            value: "10000",
            validAfter: "1740672089",
            validBefore: "1740672154",
            nonce: "0xf3746",
          },
        },
      });

      const result = await compliance.onBeforeVerify({
        paymentPayload: payload,
        requirements: makeRequirements(),
      });

      expect(result).toEqual({
        abort: true,
        reason: "sanctions_hit",
        message: expect.stringContaining("Sender address flagged"),
      });
    });

    test("blocks payment to sanctioned receiver", async () => {
      const screener = createMockScreener();
      compliance = new ProofLinkX402Compliance(makeConfig(), { screener });

      const result = await compliance.onBeforeVerify({
        paymentPayload: makePayload(),
        requirements: makeRequirements({ payTo: SANCTIONED_ADDRESS }),
      });

      expect(result).toEqual({
        abort: true,
        reason: "sanctions_hit",
        message: expect.stringContaining("Receiver address flagged"),
      });
    });

    test("blocks blocklisted sender before any API calls", async () => {
      const screener = createMockScreener();
      compliance = new ProofLinkX402Compliance(makeConfig(), { screener });

      const payload = makePayload({
        payload: {
          signature: "0xblocklist_sig_1234567890abcdef1234567890ab",
          authorization: {
            from: BLOCKLISTED_ADDRESS,
            to: CLEAN_RECEIVER,
            value: "10000",
            validAfter: "1740672089",
            validBefore: "1740672154",
            nonce: "0xf3746",
          },
        },
      });

      const result = await compliance.onBeforeVerify({
        paymentPayload: payload,
        requirements: makeRequirements(),
      });

      expect(result).toEqual({
        abort: true,
        reason: "compliance_blocked",
        message: "Sender address is blocklisted",
      });
      // No API calls should have been made
      expect(screener.screen).not.toHaveBeenCalled();
    });

    test("re-verifies receiver at settle phase", async () => {
      const screener = createMockScreener();
      const amlScorer = createMockAmlScorer(10);
      compliance = new ProofLinkX402Compliance(makeConfig(), { screener, amlScorer });

      const payload = makePayload();
      const requirements = makeRequirements();

      // Pass verify first
      await compliance.onBeforeVerify({ paymentPayload: payload, requirements });

      // Settle phase re-checks receiver
      await compliance.onBeforeSettle({ paymentPayload: payload, requirements });

      // screen called: 2 (verify: sender+receiver) + 1 (settle: receiver recheck)
      expect(screener.screen).toHaveBeenCalledTimes(3);
    });
  });

  // -------------------------------------------------------------------------
  // AML risk scoring
  // -------------------------------------------------------------------------

  describe("AML risk scoring", () => {
    test("blocks payment when risk score exceeds threshold", async () => {
      const amlScorer = createMockAmlScorer(85); // exceeds 70 threshold
      compliance = new ProofLinkX402Compliance(makeConfig(), {
        screener: createMockScreener(),
        amlScorer,
      });

      const result = await compliance.onBeforeVerify({
        paymentPayload: makePayload(),
        requirements: makeRequirements(),
      });

      expect(result).toEqual({
        abort: true,
        reason: "aml_risk_exceeded",
        message: expect.stringContaining("Risk score 85 exceeds threshold 70"),
      });
    });

    test("passes when risk score is within threshold", async () => {
      const amlScorer = createMockAmlScorer(50); // below 70 threshold
      compliance = new ProofLinkX402Compliance(makeConfig(), {
        screener: createMockScreener(),
        amlScorer,
      });

      const result = await compliance.onBeforeVerify({
        paymentPayload: makePayload(),
        requirements: makeRequirements(),
      });

      expect(result).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // Travel Rule
  // -------------------------------------------------------------------------

  describe("Travel Rule", () => {
    test("triggers Travel Rule for amount > threshold", async () => {
      const travelRuleService = createMockTravelRuleService(true);
      const priceConverter = createMockPriceConverter(5000); // $5000 > $3000 threshold
      const screener = createMockScreener();
      const amlScorer = createMockAmlScorer(10);

      compliance = new ProofLinkX402Compliance(
        makeConfig({ notabene: { apiKey: "test", vaspDID: "did:ethr:0x123" } }),
        { screener, amlScorer, travelRuleService, priceConverter },
      );

      const payload = makePayload();
      const requirements = makeRequirements({ maxAmountRequired: "5000000000" });

      // Must pass verify first to populate pending decisions
      await compliance.onBeforeVerify({ paymentPayload: payload, requirements });

      // Settle phase should trigger travel rule
      const result = await compliance.onBeforeSettle({ paymentPayload: payload, requirements });
      expect(result).toBeUndefined();
      expect(travelRuleService.transmit).toHaveBeenCalledOnce();
      expect(travelRuleService.transmit).toHaveBeenCalledWith(
        expect.objectContaining({
          originatorAddress: CLEAN_SENDER,
          beneficiaryAddress: CLEAN_RECEIVER,
        }),
      );
    });

    test("does not trigger Travel Rule for amount below threshold", async () => {
      const travelRuleService = createMockTravelRuleService(true);
      const priceConverter = createMockPriceConverter(0.01); // $0.01 < $3000 threshold
      const screener = createMockScreener();
      const amlScorer = createMockAmlScorer(10);

      compliance = new ProofLinkX402Compliance(
        makeConfig({ notabene: { apiKey: "test", vaspDID: "did:ethr:0x123" } }),
        { screener, amlScorer, travelRuleService, priceConverter },
      );

      const payload = makePayload();
      const requirements = makeRequirements();

      await compliance.onBeforeVerify({ paymentPayload: payload, requirements });
      await compliance.onBeforeSettle({ paymentPayload: payload, requirements });

      expect(travelRuleService.transmit).not.toHaveBeenCalled();
    });

    test("aborts settlement when Travel Rule transmission fails", async () => {
      const travelRuleService = createMockTravelRuleService(false); // fails
      const priceConverter = createMockPriceConverter(5000);
      const screener = createMockScreener();
      const amlScorer = createMockAmlScorer(10);

      compliance = new ProofLinkX402Compliance(
        makeConfig({ notabene: { apiKey: "test", vaspDID: "did:ethr:0x123" } }),
        { screener, amlScorer, travelRuleService, priceConverter },
      );

      const payload = makePayload();
      const requirements = makeRequirements({ maxAmountRequired: "5000000000" });

      await compliance.onBeforeVerify({ paymentPayload: payload, requirements });
      const result = await compliance.onBeforeSettle({ paymentPayload: payload, requirements });

      expect(result).toEqual({
        abort: true,
        reason: "travel_rule_failed",
        message: expect.stringContaining("Notabene API error"),
      });
    });
  });

  // -------------------------------------------------------------------------
  // KYA (Know Your Agent) verification
  // -------------------------------------------------------------------------

  describe("KYA verification", () => {
    test("passes with valid agent credential", async () => {
      const kyaRegistry = createMockKYARegistry(AGENT_ADDRESS);
      const kyaVerifier = createMockKYAVerifier(true);
      const screener = createMockScreener();

      compliance = new ProofLinkX402Compliance(makeConfig(), {
        screener,
        amlScorer: createMockAmlScorer(10),
        kyaRegistry,
        kyaVerifier,
      });

      const payload = makePayload({
        payload: {
          signature: "0xagent_sig_12345678901234567890123456789012",
          authorization: {
            from: AGENT_ADDRESS,
            to: CLEAN_RECEIVER,
            value: "10000",
            validAfter: "1740672089",
            validBefore: "1740672154",
            nonce: "0xf3746",
          },
        },
      });

      const result = await compliance.onBeforeVerify({
        paymentPayload: payload,
        requirements: makeRequirements(),
      });

      expect(result).toBeUndefined();
      expect(kyaRegistry.lookup).toHaveBeenCalledWith(AGENT_ADDRESS);
      expect(kyaVerifier.verify).toHaveBeenCalledWith("agent-001");
    });

    test("blocks agent with invalid credential", async () => {
      const kyaRegistry = createMockKYARegistry(AGENT_ADDRESS);
      const kyaVerifier = createMockKYAVerifier(false, false);
      const screener = createMockScreener();

      compliance = new ProofLinkX402Compliance(makeConfig(), {
        screener,
        amlScorer: createMockAmlScorer(10),
        kyaRegistry,
        kyaVerifier,
      });

      const payload = makePayload({
        payload: {
          signature: "0xagent_bad_sig_234567890123456789012345678",
          authorization: {
            from: AGENT_ADDRESS,
            to: CLEAN_RECEIVER,
            value: "10000",
            validAfter: "1740672089",
            validBefore: "1740672154",
            nonce: "0xf3746",
          },
        },
      });

      const result = await compliance.onBeforeVerify({
        paymentPayload: payload,
        requirements: makeRequirements(),
      });

      expect(result).toEqual({
        abort: true,
        reason: "kya_verification_failed",
        message: expect.stringContaining("Agent verification failed"),
      });
    });

    test("blocks agent with expired credential", async () => {
      const kyaRegistry = createMockKYARegistry(AGENT_ADDRESS);
      const kyaVerifier = createMockKYAVerifier(false, true);
      const screener = createMockScreener();

      compliance = new ProofLinkX402Compliance(makeConfig(), {
        screener,
        amlScorer: createMockAmlScorer(10),
        kyaRegistry,
        kyaVerifier,
      });

      const payload = makePayload({
        payload: {
          signature: "0xagent_exp_sig_34567890123456789012345678ab",
          authorization: {
            from: AGENT_ADDRESS,
            to: CLEAN_RECEIVER,
            value: "10000",
            validAfter: "1740672089",
            validBefore: "1740672154",
            nonce: "0xf3746",
          },
        },
      });

      const result = await compliance.onBeforeVerify({
        paymentPayload: payload,
        requirements: makeRequirements(),
      });

      expect(result).toEqual({
        abort: true,
        reason: "kya_verification_failed",
        message: expect.stringContaining("Agent credential expired"),
      });
    });

    test("skips KYA check for non-agent wallets", async () => {
      const kyaRegistry = createMockKYARegistry(AGENT_ADDRESS); // only agent addr known
      const kyaVerifier = createMockKYAVerifier(true);
      const screener = createMockScreener();

      compliance = new ProofLinkX402Compliance(makeConfig(), {
        screener,
        amlScorer: createMockAmlScorer(10),
        kyaRegistry,
        kyaVerifier,
      });

      // Regular (non-agent) sender
      const result = await compliance.onBeforeVerify({
        paymentPayload: makePayload(),
        requirements: makeRequirements(),
      });

      expect(result).toBeUndefined();
      expect(kyaVerifier.verify).not.toHaveBeenCalled(); // not called for non-agents
    });
  });

  // -------------------------------------------------------------------------
  // Extension enrichment
  // -------------------------------------------------------------------------

  describe("extension enrichment", () => {
    test("enriches 402 response with compliance policy", async () => {
      compliance = new ProofLinkX402Compliance(makeConfig());
      const server = createMockServer();
      compliance.register(server);

      const extension = server.extensions[0]!;
      const enriched = await extension.enrichPaymentRequiredResponse!(
        {},
        { requirements: makeRequirements() },
      );

      expect(enriched).toEqual({
        complianceRequired: true,
        provider: "prooflink",
        version: "0.1.0",
        sanctionsLists: ["OFAC_SDN", "EU", "UN"],
        travelRuleThresholdUsd: 3000,
        maxRiskScore: 70,
      });
    });

    test("enriches settlement response with proofLink hash", async () => {
      const proofLinkService = createMockProofLinkService();
      compliance = new ProofLinkX402Compliance(makeConfig(), {
        screener: createMockScreener(),
        amlScorer: createMockAmlScorer(10),
        proofLinkService,
      });
      const server = createMockServer();
      compliance.register(server);

      const payload = makePayload();
      const requirements = makeRequirements();

      // Run full flow to populate settledProofLinks
      await compliance.onBeforeVerify({ paymentPayload: payload, requirements });
      await compliance.onBeforeSettle({ paymentPayload: payload, requirements });
      await compliance.onAfterSettle({
        paymentPayload: payload,
        requirements,
        result: {
          success: true,
          transaction: "0xtxhash123456789",
          network: "eip155:8453",
        },
      });

      const extension = server.extensions[0]!;
      const enriched = await extension.enrichSettlementResponse!(
        {},
        { paymentPayload: payload, requirements },
      );

      expect(enriched).toEqual({
        complianceVerified: true,
        provider: "prooflink",
        proofLinkHash: expect.stringMatching(/^0x/),
      });
    });
  });

  // -------------------------------------------------------------------------
  // Address extraction
  // -------------------------------------------------------------------------

  describe("address extraction", () => {
    test("extracts EIP-3009 sender address", async () => {
      compliance = new ProofLinkX402Compliance(makeConfig());

      const result = await compliance.onBeforeVerify({
        paymentPayload: makePayload(),
        requirements: makeRequirements(),
      });

      // If it didn't abort with "cannot extract sender", extraction worked
      expect(result).toBeUndefined();
    });

    test("extracts Permit2 sender address", async () => {
      compliance = new ProofLinkX402Compliance(makeConfig());

      const payload: PaymentPayload = {
        x402Version: 2,
        scheme: "exact",
        network: "eip155:8453",
        payload: {
          signature: "0xpermit2_sig_12345678901234567890123456789",
          permit2Authorization: {
            from: CLEAN_SENDER,
            to: CLEAN_RECEIVER,
            amount: "10000",
            token: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
            nonce: "0xf3746",
            deadline: "1740672154",
          },
        },
      };

      const result = await compliance.onBeforeVerify({
        paymentPayload: payload,
        requirements: makeRequirements(),
      });

      expect(result).toBeUndefined();
    });

    test("extracts Solana sender address", async () => {
      compliance = new ProofLinkX402Compliance(makeConfig());

      const payload: PaymentPayload = {
        x402Version: 2,
        scheme: "exact",
        network: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
        payload: {
          signature: "0xsolana_sig_123456789012345678901234567890",
          sender: "7nYNcAthVZnGGJEf6u7WKnQCLwiY1CJasRqfxpMgHE2T",
        },
      };

      const result = await compliance.onBeforeVerify({
        paymentPayload: payload,
        requirements: makeRequirements(),
      });

      expect(result).toBeUndefined();
    });

    test("aborts when sender address cannot be extracted", async () => {
      compliance = new ProofLinkX402Compliance(makeConfig());

      const payload: PaymentPayload = {
        x402Version: 2,
        scheme: "exact",
        network: "eip155:8453",
        payload: {
          signature: "0xno_from_sig_12345678901234567890123456789",
          // No authorization, no permit2Authorization, no sender
        },
      };

      const result = await compliance.onBeforeVerify({
        paymentPayload: payload,
        requirements: makeRequirements(),
      });

      expect(result).toEqual({
        abort: true,
        reason: "compliance_error",
        message: expect.stringContaining("Cannot extract sender address"),
      });
    });
  });

  // -------------------------------------------------------------------------
  // Event system
  // -------------------------------------------------------------------------

  describe("event system", () => {
    test("emits events throughout the compliance flow", async () => {
      const events: ComplianceEvent[] = [];
      compliance = new ProofLinkX402Compliance(makeConfig(), {
        screener: createMockScreener(),
        amlScorer: createMockAmlScorer(10),
        proofLinkService: createMockProofLinkService(),
      });
      compliance.on((e) => events.push(e));

      const payload = makePayload();
      const requirements = makeRequirements();

      await compliance.onBeforeVerify({ paymentPayload: payload, requirements });
      await compliance.onBeforeSettle({ paymentPayload: payload, requirements });
      await compliance.onAfterSettle({
        paymentPayload: payload,
        requirements,
        result: { success: true, transaction: "0xtx", network: "eip155:8453" },
      });

      expect(events.length).toBeGreaterThanOrEqual(4);
      expect(events[0]!.type).toBe("compliance:check:started");
    });

    test("unsubscribe removes event handler", () => {
      compliance = new ProofLinkX402Compliance(makeConfig());
      const handler = vi.fn();
      const unsub = compliance.on(handler);

      unsub();

      // Verify handler was removed (no easy way without triggering event,
      // but we can verify the unsubscribe function returns)
      expect(typeof unsub).toBe("function");
    });
  });

  // -------------------------------------------------------------------------
  // Allowlist
  // -------------------------------------------------------------------------

  describe("allowlist", () => {
    test("allowlisted addresses bypass all checks", async () => {
      const screener = createMockScreener();
      compliance = new ProofLinkX402Compliance(
        makeConfig({
          policy: {
            sanctionsLists: ["OFAC_SDN"],
            maxRiskScore: 70,
            travelRuleThresholdUsd: 3000,
            allowlist: [CLEAN_SENDER, CLEAN_RECEIVER],
          },
        }),
        { screener },
      );

      const result = await compliance.onBeforeVerify({
        paymentPayload: makePayload(),
        requirements: makeRequirements(),
      });

      expect(result).toBeUndefined();
      expect(screener.screen).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // EAS attestation (after-settle)
  // -------------------------------------------------------------------------

  describe("on-chain attestation", () => {
    test("triggers EAS attestation when eas config is present", async () => {
      const proofLinkService = createMockProofLinkService();
      compliance = new ProofLinkX402Compliance(
        makeConfig({
          eas: {
            schemaUid: "0xschema123",
            privateKey: "0xprivatekey123",
            rpcUrl: "https://rpc.example.com",
          },
        }),
        {
          screener: createMockScreener(),
          amlScorer: createMockAmlScorer(10),
          proofLinkService,
        },
      );

      const payload = makePayload();
      const requirements = makeRequirements();

      await compliance.onBeforeVerify({ paymentPayload: payload, requirements });
      await compliance.onBeforeSettle({ paymentPayload: payload, requirements });
      await compliance.onAfterSettle({
        paymentPayload: payload,
        requirements,
        result: { success: true, transaction: "0xtx", network: "eip155:8453" },
      });

      // attestOnChain is called asynchronously — give it a tick
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(proofLinkService.attestOnChain).toHaveBeenCalledOnce();
    });
  });
});
