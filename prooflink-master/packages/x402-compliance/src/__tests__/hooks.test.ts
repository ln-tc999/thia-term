import { describe, test, expect, vi, beforeEach } from "vitest";
import { createBeforeVerifyHook, payloadKey } from "../hooks/before-verify.js";
import { createBeforeSettleHook } from "../hooks/before-settle.js";
import { createAfterSettleHook } from "../hooks/after-settle.js";
import type {
  ProofLinkConfig,
  PaymentPayload,
  PaymentRequirements,
  PendingDecision,
  ScreeningResult,
  AmlScoreResult,
  KYACredential,
  KYAVerificationResult,
  ComplianceEvent,
} from "../types.js";
import type {
  SanctionsScreener,
  AmlScorer,
  KYAVerifier,
  KYARegistry,
} from "../hooks/before-verify.js";
import type { TravelRuleService, PriceConverter } from "../hooks/before-settle.js";
import type { ProofLinkService, InvoiceService } from "../hooks/after-settle.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CLEAN_SENDER = "0x1111111111111111111111111111111111111111";
const CLEAN_RECEIVER = "0x2222222222222222222222222222222222222222";
const SANCTIONED = "0xbaD0000000000000000000000000000000000bad";
const BLOCKLISTED = "0xBLOCK000000000000000000000000000000BLOCK";
const AGENT_ADDR = "0xA6E41000000000000000000000000000000A6E41";

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

function makePayload(
  from: string = CLEAN_SENDER,
  sig = "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",
): PaymentPayload {
  return {
    x402Version: 2,
    scheme: "exact",
    network: "eip155:8453",
    payload: {
      signature: sig,
      authorization: {
        from,
        to: CLEAN_RECEIVER,
        value: "10000",
        validAfter: "1740672089",
        validBefore: "1740672154",
        nonce: "0xf3746",
      },
    },
  };
}

function makeRequirements(
  payTo: string = CLEAN_RECEIVER,
  maxAmount = "10000",
): PaymentRequirements {
  return {
    scheme: "exact",
    network: "eip155:8453",
    maxAmountRequired: maxAmount,
    payTo,
    asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  };
}

function makeConfig(overrides?: Partial<ProofLinkConfig["policy"]>): ProofLinkConfig {
  return {
    chainalysisApiKey: "test-key",
    policy: {
      sanctionsLists: ["OFAC_SDN"],
      maxRiskScore: 70,
      travelRuleThresholdUsd: 3000,
      blocklist: [BLOCKLISTED],
      ...overrides,
    },
  };
}

function makePendingDecisions(): Map<string, PendingDecision> & { cleanup(): void } {
  const map = new Map<string, PendingDecision>() as Map<string, PendingDecision> & {
    cleanup(): void;
  };
  map.cleanup = () => {};
  return map;
}

function makeScreener(
  sanctionedAddresses: string[] = [SANCTIONED],
): SanctionsScreener {
  return {
    screen: vi.fn(async (address: string): Promise<ScreeningResult> => {
      const hit = sanctionedAddresses.some(
        (s) => s.toLowerCase() === address.toLowerCase(),
      );
      return {
        address,
        clean: !hit,
        matchedList: hit ? "OFAC_SDN" : undefined,
        latencyMs: 1,
      };
    }),
  };
}

function makeAmlScorer(score = 10): AmlScorer {
  return {
    score: vi.fn(async (address: string): Promise<AmlScoreResult> => ({
      address,
      score,
      latencyMs: 1,
      factors: score > 50 ? ["velocity"] : [],
    })),
  };
}

function makeKYARegistry(agentAddress: string | null = null): KYARegistry {
  return {
    lookup: vi.fn(async (address: string): Promise<KYACredential | null> => {
      if (agentAddress && address.toLowerCase() === agentAddress.toLowerCase()) {
        return {
          agentId: "agent-test-001",
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

function makeKYAVerifier(valid = true, expired = false): KYAVerifier {
  return {
    verify: vi.fn(async (agentId: string): Promise<KYAVerificationResult> => ({
      valid,
      expired,
      agentId,
      reason: valid ? undefined : expired ? "credential expired" : "invalid",
      latencyMs: 1,
    })),
  };
}

function makeTravelRuleService(success = true): TravelRuleService {
  return {
    transmit: vi.fn(async () => ({
      success,
      referenceId: success ? "tr-ref-001" : undefined,
      error: success ? undefined : "Notabene API error",
      latencyMs: 10,
    })),
  };
}

function makePriceConverter(usd: number): PriceConverter {
  return {
    toUsd: vi.fn(async () => usd),
  };
}

function makeProofLinkService(): ProofLinkService {
  return {
    computeHash: vi.fn((receipt) => `0x${receipt.transactionHash.slice(2, 18)}`),
    attestOnChain: vi.fn(async () => "eas-uid-test"),
    storeAuditRecord: vi.fn(async () => {}),
  };
}

function makeInvoiceService(): InvoiceService {
  return {
    generate: vi.fn(async () => "inv-test-001"),
  };
}

// ---------------------------------------------------------------------------
// before-verify hook tests
// ---------------------------------------------------------------------------

describe("createBeforeVerifyHook", () => {
  describe("allowlist short-circuit", () => {
    test("passes immediately when both sender and receiver are allowlisted", async () => {
      const screener = makeScreener();
      const amlScorer = makeAmlScorer();
      const pendingDecisions = makePendingDecisions();
      const config = makeConfig({
        allowlist: [CLEAN_SENDER, CLEAN_RECEIVER],
      });

      const hook = createBeforeVerifyHook({
        config,
        screener,
        amlScorer,
        pendingDecisions,
      });

      const result = await hook({
        paymentPayload: makePayload(),
        requirements: makeRequirements(),
      });

      expect(result).toBeUndefined();
      expect(screener.screen).not.toHaveBeenCalled();
      expect(amlScorer.score).not.toHaveBeenCalled();
      // Decision should be cached
      expect(pendingDecisions.size).toBe(1);
    });

    test("does not short-circuit when only sender is allowlisted", async () => {
      const screener = makeScreener();
      const amlScorer = makeAmlScorer(10);
      const pendingDecisions = makePendingDecisions();
      const config = makeConfig({
        allowlist: [CLEAN_SENDER], // receiver NOT in allowlist
      });

      const hook = createBeforeVerifyHook({
        config,
        screener,
        amlScorer,
        pendingDecisions,
      });

      await hook({ paymentPayload: makePayload(), requirements: makeRequirements() });

      // Falls through to screening because receiver is not allowlisted
      expect(screener.screen).toHaveBeenCalled();
    });
  });

  describe("blocklist check", () => {
    test("blocks sender on blocklist before any API calls", async () => {
      const screener = makeScreener();
      const amlScorer = makeAmlScorer();
      const pendingDecisions = makePendingDecisions();

      const hook = createBeforeVerifyHook({
        config: makeConfig(),
        screener,
        amlScorer,
        pendingDecisions,
      });

      const result = await hook({
        paymentPayload: makePayload(BLOCKLISTED),
        requirements: makeRequirements(),
      });

      expect(result).toEqual({
        abort: true,
        reason: "compliance_blocked",
        message: "Sender address is blocklisted",
      });
      expect(screener.screen).not.toHaveBeenCalled();
    });

    test("blocks receiver on blocklist before any API calls", async () => {
      const screener = makeScreener();
      const amlScorer = makeAmlScorer();
      const pendingDecisions = makePendingDecisions();

      const hook = createBeforeVerifyHook({
        config: makeConfig(),
        screener,
        amlScorer,
        pendingDecisions,
      });

      const result = await hook({
        paymentPayload: makePayload(CLEAN_SENDER),
        requirements: makeRequirements(BLOCKLISTED),
      });

      expect(result).toEqual({
        abort: true,
        reason: "compliance_blocked",
        message: "Receiver address is blocklisted",
      });
      expect(screener.screen).not.toHaveBeenCalled();
    });
  });

  describe("sanctions screening", () => {
    test("blocks sanctioned sender with structured reason", async () => {
      const screener = makeScreener([SANCTIONED]);
      const amlScorer = makeAmlScorer();
      const pendingDecisions = makePendingDecisions();

      const hook = createBeforeVerifyHook({
        config: makeConfig(),
        screener,
        amlScorer,
        pendingDecisions,
      });

      const result = await hook({
        paymentPayload: makePayload(SANCTIONED, "0xsig_sanc_1234567890123456789012345678901"),
        requirements: makeRequirements(),
      });

      expect(result).toEqual({
        abort: true,
        reason: "sanctions_hit",
        message: expect.stringContaining("Sender address flagged"),
      });
    });

    test("blocks sanctioned receiver", async () => {
      const screener = makeScreener([SANCTIONED]);
      const amlScorer = makeAmlScorer();
      const pendingDecisions = makePendingDecisions();

      const hook = createBeforeVerifyHook({
        config: makeConfig(),
        screener,
        amlScorer,
        pendingDecisions,
      });

      const result = await hook({
        paymentPayload: makePayload(),
        requirements: makeRequirements(SANCTIONED),
      });

      expect(result).toEqual({
        abort: true,
        reason: "sanctions_hit",
        message: expect.stringContaining("Receiver address flagged"),
      });
    });

    test("passes clean addresses with no abort", async () => {
      const screener = makeScreener([]); // no sanctioned addresses
      const amlScorer = makeAmlScorer(10);
      const pendingDecisions = makePendingDecisions();

      const hook = createBeforeVerifyHook({
        config: makeConfig(),
        screener,
        amlScorer,
        pendingDecisions,
      });

      const result = await hook({
        paymentPayload: makePayload(),
        requirements: makeRequirements(),
      });

      expect(result).toBeUndefined();
    });

    test("screens sender and receiver in parallel (both called)", async () => {
      const screener = makeScreener([]);
      const amlScorer = makeAmlScorer(5);
      const pendingDecisions = makePendingDecisions();

      const hook = createBeforeVerifyHook({
        config: makeConfig(),
        screener,
        amlScorer,
        pendingDecisions,
      });

      await hook({ paymentPayload: makePayload(), requirements: makeRequirements() });

      expect(screener.screen).toHaveBeenCalledTimes(2);
      expect(screener.screen).toHaveBeenCalledWith(CLEAN_SENDER, "eip155:8453");
      expect(screener.screen).toHaveBeenCalledWith(CLEAN_RECEIVER, "eip155:8453");
    });
  });

  describe("AML risk scoring", () => {
    test("blocks when score exceeds maxRiskScore threshold", async () => {
      const screener = makeScreener([]);
      const amlScorer = makeAmlScorer(85); // > 70 threshold
      const pendingDecisions = makePendingDecisions();

      const hook = createBeforeVerifyHook({
        config: makeConfig(),
        screener,
        amlScorer,
        pendingDecisions,
      });

      const result = await hook({
        paymentPayload: makePayload(),
        requirements: makeRequirements(),
      });

      expect(result).toEqual({
        abort: true,
        reason: "aml_risk_exceeded",
        message: expect.stringContaining("Risk score 85 exceeds threshold 70"),
      });
    });

    test("passes when score equals maxRiskScore", async () => {
      const screener = makeScreener([]);
      const amlScorer = makeAmlScorer(70); // exactly at threshold (not exceeding)
      const pendingDecisions = makePendingDecisions();

      const hook = createBeforeVerifyHook({
        config: makeConfig(),
        screener,
        amlScorer,
        pendingDecisions,
      });

      const result = await hook({
        paymentPayload: makePayload(),
        requirements: makeRequirements(),
      });

      expect(result).toBeUndefined();
    });

    test("passes when score is 0 (minimum)", async () => {
      const screener = makeScreener([]);
      const amlScorer = makeAmlScorer(0);
      const pendingDecisions = makePendingDecisions();

      const hook = createBeforeVerifyHook({
        config: makeConfig(),
        screener,
        amlScorer,
        pendingDecisions,
      });

      const result = await hook({
        paymentPayload: makePayload(),
        requirements: makeRequirements(),
      });

      expect(result).toBeUndefined();
    });
  });

  describe("KYA verification", () => {
    test("passes with valid agent credential", async () => {
      const screener = makeScreener([]);
      const amlScorer = makeAmlScorer(5);
      const kyaRegistry = makeKYARegistry(AGENT_ADDR);
      const kyaVerifier = makeKYAVerifier(true);
      const pendingDecisions = makePendingDecisions();

      const hook = createBeforeVerifyHook({
        config: makeConfig(),
        screener,
        amlScorer,
        kyaRegistry,
        kyaVerifier,
        pendingDecisions,
      });

      const result = await hook({
        paymentPayload: makePayload(AGENT_ADDR, "0xagent_sig_12345678901234567890123456789012"),
        requirements: makeRequirements(),
      });

      expect(result).toBeUndefined();
      expect(kyaRegistry.lookup).toHaveBeenCalledWith(AGENT_ADDR);
      expect(kyaVerifier.verify).toHaveBeenCalledWith("agent-test-001");
    });

    test("blocks agent with invalid credential", async () => {
      const screener = makeScreener([]);
      const amlScorer = makeAmlScorer(5);
      const kyaRegistry = makeKYARegistry(AGENT_ADDR);
      const kyaVerifier = makeKYAVerifier(false, false);
      const pendingDecisions = makePendingDecisions();

      const hook = createBeforeVerifyHook({
        config: makeConfig(),
        screener,
        amlScorer,
        kyaRegistry,
        kyaVerifier,
        pendingDecisions,
      });

      const result = await hook({
        paymentPayload: makePayload(AGENT_ADDR, "0xbad_agent_sig_23456789012345678901234567"),
        requirements: makeRequirements(),
      });

      expect(result).toEqual({
        abort: true,
        reason: "kya_verification_failed",
        message: expect.stringContaining("Agent verification failed"),
      });
    });

    test("blocks agent with expired credential", async () => {
      const screener = makeScreener([]);
      const amlScorer = makeAmlScorer(5);
      const kyaRegistry = makeKYARegistry(AGENT_ADDR);
      const kyaVerifier = makeKYAVerifier(false, true); // expired
      const pendingDecisions = makePendingDecisions();

      const hook = createBeforeVerifyHook({
        config: makeConfig(),
        screener,
        amlScorer,
        kyaRegistry,
        kyaVerifier,
        pendingDecisions,
      });

      const result = await hook({
        paymentPayload: makePayload(AGENT_ADDR, "0xexp_agent_sig_3456789012345678901234567ab"),
        requirements: makeRequirements(),
      });

      expect(result).toEqual({
        abort: true,
        reason: "kya_verification_failed",
        message: expect.stringContaining("Agent credential expired"),
      });
    });

    test("skips KYA check for non-agent wallets (registry returns null)", async () => {
      const screener = makeScreener([]);
      const amlScorer = makeAmlScorer(5);
      const kyaRegistry = makeKYARegistry(AGENT_ADDR); // only AGENT_ADDR is known
      const kyaVerifier = makeKYAVerifier(true);
      const pendingDecisions = makePendingDecisions();

      const hook = createBeforeVerifyHook({
        config: makeConfig(),
        screener,
        amlScorer,
        kyaRegistry,
        kyaVerifier,
        pendingDecisions,
      });

      // Regular (non-agent) sender
      const result = await hook({
        paymentPayload: makePayload(CLEAN_SENDER),
        requirements: makeRequirements(),
      });

      expect(result).toBeUndefined();
      expect(kyaVerifier.verify).not.toHaveBeenCalled();
    });

    test("records KYA skip check entry when registry returns null", async () => {
      const screener = makeScreener([]);
      const amlScorer = makeAmlScorer(5);
      const kyaRegistry = makeKYARegistry(null); // nobody is an agent
      const pendingDecisions = makePendingDecisions();

      const hook = createBeforeVerifyHook({
        config: makeConfig(),
        screener,
        amlScorer,
        kyaRegistry,
        pendingDecisions,
      });

      await hook({
        paymentPayload: makePayload(),
        requirements: makeRequirements(),
      });

      const key = payloadKey(makePayload());
      const decision = pendingDecisions.get(key);
      const kyaEntry = decision?.checks.find((c) => c.type === "kya");
      expect(kyaEntry?.result).toBe("skip");
    });
  });

  describe("error handling", () => {
    test("aborts with compliance_error when screener throws", async () => {
      const screener: SanctionsScreener = {
        screen: vi.fn().mockRejectedValue(new Error("Network timeout")),
      };
      const amlScorer = makeAmlScorer();
      const pendingDecisions = makePendingDecisions();

      const hook = createBeforeVerifyHook({
        config: makeConfig(),
        screener,
        amlScorer,
        pendingDecisions,
      });

      const result = await hook({
        paymentPayload: makePayload(),
        requirements: makeRequirements(),
      });

      expect(result).toEqual({
        abort: true,
        reason: "compliance_error",
        message: expect.stringContaining("Network timeout"),
      });
    });

    test("aborts when sender address cannot be extracted", async () => {
      const screener = makeScreener([]);
      const amlScorer = makeAmlScorer();
      const pendingDecisions = makePendingDecisions();

      const hook = createBeforeVerifyHook({
        config: makeConfig(),
        screener,
        amlScorer,
        pendingDecisions,
      });

      const payloadNoFrom: PaymentPayload = {
        x402Version: 2,
        scheme: "exact",
        network: "eip155:8453",
        payload: {
          signature: "0xnosig1234567890123456789012345678901234567890",
          // no authorization, no permit2Authorization, no sender
        },
      };

      const result = await hook({
        paymentPayload: payloadNoFrom,
        requirements: makeRequirements(),
      });

      expect(result).toEqual({
        abort: true,
        reason: "compliance_error",
        message: expect.stringContaining("Cannot extract sender address"),
      });
    });
  });

  describe("pending decisions cache", () => {
    test("caches decision with payload key after successful check", async () => {
      const screener = makeScreener([]);
      const amlScorer = makeAmlScorer(15);
      const pendingDecisions = makePendingDecisions();

      const hook = createBeforeVerifyHook({
        config: makeConfig(),
        screener,
        amlScorer,
        pendingDecisions,
      });

      const payload = makePayload();
      await hook({ paymentPayload: payload, requirements: makeRequirements() });

      const key = payloadKey(payload);
      const decision = pendingDecisions.get(key);

      expect(decision).toBeDefined();
      expect(decision!.pass).toBe(true);
      expect(decision!.riskScore).toBe(15);
      expect(decision!.checks.length).toBeGreaterThan(0);
    });

    test("does not cache decision when check fails", async () => {
      const screener = makeScreener([SANCTIONED]);
      const amlScorer = makeAmlScorer();
      const pendingDecisions = makePendingDecisions();

      const hook = createBeforeVerifyHook({
        config: makeConfig(),
        screener,
        amlScorer,
        pendingDecisions,
      });

      await hook({
        paymentPayload: makePayload(SANCTIONED, "0xsig_sanc_abc1234567890abcdef1234567890"),
        requirements: makeRequirements(),
      });

      expect(pendingDecisions.size).toBe(0);
    });
  });

  describe("event emission", () => {
    test("emits compliance:check:started and compliance:check:passed for clean payment", async () => {
      const screener = makeScreener([]);
      const amlScorer = makeAmlScorer(5);
      const pendingDecisions = makePendingDecisions();
      const events: ComplianceEvent[] = [];

      const hook = createBeforeVerifyHook({
        config: makeConfig(),
        screener,
        amlScorer,
        pendingDecisions,
        onEvent: (e) => events.push(e),
      });

      await hook({ paymentPayload: makePayload(), requirements: makeRequirements() });

      const types = events.map((e) => e.type);
      expect(types).toContain("compliance:check:started");
      expect(types).toContain("compliance:check:passed");
    });

    test("emits compliance:check:failed when sanctions hit", async () => {
      const screener = makeScreener([SANCTIONED]);
      const amlScorer = makeAmlScorer();
      const pendingDecisions = makePendingDecisions();
      const events: ComplianceEvent[] = [];

      const hook = createBeforeVerifyHook({
        config: makeConfig(),
        screener,
        amlScorer,
        pendingDecisions,
        onEvent: (e) => events.push(e),
      });

      await hook({
        paymentPayload: makePayload(SANCTIONED, "0xsig_fail_abc1234567890abcdef12345678901"),
        requirements: makeRequirements(),
      });

      expect(events.map((e) => e.type)).toContain("compliance:check:failed");
    });
  });
});

// ---------------------------------------------------------------------------
// before-settle hook tests
// ---------------------------------------------------------------------------

describe("createBeforeSettleHook", () => {
  test("passes when receiver is clean and amount is below travel rule threshold", async () => {
    const screener = makeScreener([]);
    const pendingDecisions = makePendingDecisions();
    const priceConverter = makePriceConverter(10); // $10, below $3000

    const hook = createBeforeSettleHook({
      config: makeConfig(),
      screener,
      priceConverter,
      pendingDecisions,
    });

    const result = await hook({
      paymentPayload: makePayload(),
      requirements: makeRequirements(),
    });

    expect(result).toBeUndefined();
    // Receiver re-checked once
    expect(screener.screen).toHaveBeenCalledOnce();
  });

  test("blocks when receiver is now sanctioned at settle phase", async () => {
    const screener = makeScreener([CLEAN_RECEIVER]); // receiver is now sanctioned
    const pendingDecisions = makePendingDecisions();
    const priceConverter = makePriceConverter(10);

    const hook = createBeforeSettleHook({
      config: makeConfig(),
      screener,
      priceConverter,
      pendingDecisions,
    });

    const result = await hook({
      paymentPayload: makePayload(),
      requirements: makeRequirements(),
    });

    expect(result).toEqual({
      abort: true,
      reason: "sanctions_hit",
      message: expect.stringContaining("Receiver re-check flagged"),
    });
  });

  test("triggers travel rule when amount exceeds threshold", async () => {
    const screener = makeScreener([]);
    const travelRuleService = makeTravelRuleService(true);
    const priceConverter = makePriceConverter(5000); // $5000 > $3000
    const pendingDecisions = makePendingDecisions();

    const hook = createBeforeSettleHook({
      config: makeConfig(),
      screener,
      travelRuleService,
      priceConverter,
      pendingDecisions,
    });

    const result = await hook({
      paymentPayload: makePayload(),
      requirements: makeRequirements(CLEAN_RECEIVER, "5000000000"),
    });

    expect(result).toBeUndefined();
    expect(travelRuleService.transmit).toHaveBeenCalledOnce();
    expect(travelRuleService.transmit).toHaveBeenCalledWith(
      expect.objectContaining({
        originatorAddress: CLEAN_SENDER,
        beneficiaryAddress: CLEAN_RECEIVER,
      }),
    );
  });

  test("does not trigger travel rule when amount is below threshold", async () => {
    const screener = makeScreener([]);
    const travelRuleService = makeTravelRuleService();
    const priceConverter = makePriceConverter(100); // $100 < $3000
    const pendingDecisions = makePendingDecisions();

    const hook = createBeforeSettleHook({
      config: makeConfig(),
      screener,
      travelRuleService,
      priceConverter,
      pendingDecisions,
    });

    await hook({ paymentPayload: makePayload(), requirements: makeRequirements() });

    expect(travelRuleService.transmit).not.toHaveBeenCalled();
  });

  test("aborts settlement when travel rule transmission fails", async () => {
    const screener = makeScreener([]);
    const travelRuleService = makeTravelRuleService(false);
    const priceConverter = makePriceConverter(5000);
    const pendingDecisions = makePendingDecisions();

    const hook = createBeforeSettleHook({
      config: makeConfig(),
      screener,
      travelRuleService,
      priceConverter,
      pendingDecisions,
    });

    const result = await hook({
      paymentPayload: makePayload(),
      requirements: makeRequirements(CLEAN_RECEIVER, "5000000000"),
    });

    expect(result).toEqual({
      abort: true,
      reason: "travel_rule_failed",
      message: expect.stringContaining("Notabene API error"),
    });
  });

  test("updates decision with travel rule reference on success", async () => {
    const screener = makeScreener([]);
    const travelRuleService = makeTravelRuleService(true);
    const priceConverter = makePriceConverter(5000);
    const pendingDecisions = makePendingDecisions();

    const payload = makePayload();
    // Pre-populate a pending decision as would happen after beforeVerify
    pendingDecisions.set(payloadKey(payload), {
      pass: true,
      riskScore: 10,
      checks: [],
      timestamp: Date.now(),
      latencyMs: 5,
    });

    const hook = createBeforeSettleHook({
      config: makeConfig(),
      screener,
      travelRuleService,
      priceConverter,
      pendingDecisions,
    });

    await hook({
      paymentPayload: payload,
      requirements: makeRequirements(CLEAN_RECEIVER, "5000000000"),
    });

    const decision = pendingDecisions.get(payloadKey(payload));
    expect(decision?.travelRuleRef).toBe("tr-ref-001");
  });

  test("aborts when sender address cannot be extracted", async () => {
    const screener = makeScreener([]);
    const priceConverter = makePriceConverter(10);
    const pendingDecisions = makePendingDecisions();

    const hook = createBeforeSettleHook({
      config: makeConfig(),
      screener,
      priceConverter,
      pendingDecisions,
    });

    const badPayload: PaymentPayload = {
      x402Version: 2,
      scheme: "exact",
      network: "eip155:8453",
      payload: {
        signature: "0xno_from_settle_sig_1234567890123456789012",
      },
    };

    const result = await hook({
      paymentPayload: badPayload,
      requirements: makeRequirements(),
    });

    expect(result).toEqual({
      abort: true,
      reason: "compliance_error",
      message: expect.stringContaining("Cannot extract sender address at settle phase"),
    });
  });
});

// ---------------------------------------------------------------------------
// after-settle hook tests
// ---------------------------------------------------------------------------

describe("createAfterSettleHook", () => {
  test("generates ProofLink receipt and stores audit record", async () => {
    const proofLinkService = makeProofLinkService();
    const pendingDecisions = makePendingDecisions();
    const settledProofLinks = new Map<string, { hash: string; timestamp: number }>();
    const payload = makePayload();

    // Pre-populate decision
    pendingDecisions.set(payloadKey(payload), {
      pass: true,
      riskScore: 15,
      checks: [{ type: "sanctions", target: CLEAN_SENDER, result: "pass", latencyMs: 5 }],
      timestamp: Date.now(),
      latencyMs: 10,
    });

    const hook = createAfterSettleHook({
      config: makeConfig(),
      proofLinkService,
      pendingDecisions,
      settledProofLinks,
    });

    await hook({
      paymentPayload: payload,
      requirements: makeRequirements(),
      result: {
        success: true,
        transaction: "0xtxhash12345678901234567890",
        network: "eip155:8453",
        payer: CLEAN_SENDER,
      },
    });

    expect(proofLinkService.computeHash).toHaveBeenCalledOnce();
    expect(proofLinkService.storeAuditRecord).toHaveBeenCalledOnce();
  });

  test("stores proofLink hash in settledProofLinks map", async () => {
    const proofLinkService = makeProofLinkService();
    const pendingDecisions = makePendingDecisions();
    const settledProofLinks = new Map<string, { hash: string; timestamp: number }>();
    const payload = makePayload();

    pendingDecisions.set(payloadKey(payload), {
      pass: true,
      riskScore: 5,
      checks: [],
      timestamp: Date.now(),
      latencyMs: 5,
    });

    const hook = createAfterSettleHook({
      config: makeConfig(),
      proofLinkService,
      pendingDecisions,
      settledProofLinks,
    });

    await hook({
      paymentPayload: payload,
      requirements: makeRequirements(),
      result: {
        success: true,
        transaction: "0xtxhash_store_test_1234567890",
        network: "eip155:8453",
      },
    });

    expect(settledProofLinks.size).toBe(1);
    const entry = settledProofLinks.get(payloadKey(payload));
    expect(entry?.hash).toMatch(/^0x/);
  });

  test("removes pending decision after settlement", async () => {
    const proofLinkService = makeProofLinkService();
    const pendingDecisions = makePendingDecisions();
    const settledProofLinks = new Map<string, { hash: string; timestamp: number }>();
    const payload = makePayload();
    const key = payloadKey(payload);

    pendingDecisions.set(key, {
      pass: true,
      riskScore: 5,
      checks: [],
      timestamp: Date.now(),
      latencyMs: 5,
    });

    const hook = createAfterSettleHook({
      config: makeConfig(),
      proofLinkService,
      pendingDecisions,
      settledProofLinks,
    });

    await hook({
      paymentPayload: payload,
      requirements: makeRequirements(),
      result: {
        success: true,
        transaction: "0xtx_cleanup_test_1234567890",
        network: "eip155:8453",
      },
    });

    expect(pendingDecisions.has(key)).toBe(false);
  });

  test("skips receipt generation when no pending decision exists", async () => {
    const proofLinkService = makeProofLinkService();
    const pendingDecisions = makePendingDecisions();
    const settledProofLinks = new Map<string, { hash: string; timestamp: number }>();

    const hook = createAfterSettleHook({
      config: makeConfig(),
      proofLinkService,
      pendingDecisions,
      settledProofLinks,
    });

    // No pending decision set
    await hook({
      paymentPayload: makePayload(),
      requirements: makeRequirements(),
      result: {
        success: true,
        transaction: "0xtx_no_decision",
        network: "eip155:8453",
      },
    });

    expect(proofLinkService.computeHash).not.toHaveBeenCalled();
    expect(proofLinkService.storeAuditRecord).not.toHaveBeenCalled();
  });

  test("triggers EAS attestation when EAS config is present", async () => {
    const proofLinkService = makeProofLinkService();
    const pendingDecisions = makePendingDecisions();
    const settledProofLinks = new Map<string, { hash: string; timestamp: number }>();
    const payload = makePayload();

    pendingDecisions.set(payloadKey(payload), {
      pass: true,
      riskScore: 5,
      checks: [],
      timestamp: Date.now(),
      latencyMs: 5,
    });

    const configWithEAS: ProofLinkConfig = {
      ...makeConfig(),
      eas: {
        schemaUid: "0xschema1234",
        privateKey: "0xprivatekey",
        rpcUrl: "https://rpc.test.example.com",
      },
    };

    const hook = createAfterSettleHook({
      config: configWithEAS,
      proofLinkService,
      pendingDecisions,
      settledProofLinks,
    });

    await hook({
      paymentPayload: payload,
      requirements: makeRequirements(),
      result: {
        success: true,
        transaction: "0xtx_eas_test_123456789",
        network: "eip155:8453",
      },
    });

    // attestOnChain is called async — give it a tick
    await new Promise((r) => setTimeout(r, 10));
    expect(proofLinkService.attestOnChain).toHaveBeenCalledOnce();
  });

  test("calls invoice service when configured", async () => {
    const proofLinkService = makeProofLinkService();
    const invoiceService = makeInvoiceService();
    const pendingDecisions = makePendingDecisions();
    const settledProofLinks = new Map<string, { hash: string; timestamp: number }>();
    const payload = makePayload();

    pendingDecisions.set(payloadKey(payload), {
      pass: true,
      riskScore: 5,
      checks: [],
      timestamp: Date.now(),
      latencyMs: 5,
    });

    const hook = createAfterSettleHook({
      config: makeConfig(),
      proofLinkService,
      invoiceService,
      pendingDecisions,
      settledProofLinks,
    });

    await hook({
      paymentPayload: payload,
      requirements: makeRequirements(),
      result: {
        success: true,
        transaction: "0xtx_invoice_test_1234567890",
        network: "eip155:8453",
      },
    });

    // invoiceService.generate is called async
    await new Promise((r) => setTimeout(r, 10));
    expect(invoiceService.generate).toHaveBeenCalledOnce();
  });

  test("emits compliance:settle:completed and compliance:receipt:generated events", async () => {
    const proofLinkService = makeProofLinkService();
    const pendingDecisions = makePendingDecisions();
    const settledProofLinks = new Map<string, { hash: string; timestamp: number }>();
    const payload = makePayload();
    const events: ComplianceEvent[] = [];

    pendingDecisions.set(payloadKey(payload), {
      pass: true,
      riskScore: 5,
      checks: [],
      timestamp: Date.now(),
      latencyMs: 5,
    });

    const hook = createAfterSettleHook({
      config: makeConfig(),
      proofLinkService,
      pendingDecisions,
      settledProofLinks,
      onEvent: (e) => events.push(e),
    });

    await hook({
      paymentPayload: payload,
      requirements: makeRequirements(),
      result: {
        success: true,
        transaction: "0xtx_events_test_12345678",
        network: "eip155:8453",
      },
    });

    const types = events.map((e) => e.type);
    expect(types).toContain("compliance:settle:completed");
    expect(types).toContain("compliance:receipt:generated");
  });
});

// ---------------------------------------------------------------------------
// payloadKey helper tests
// ---------------------------------------------------------------------------

describe("payloadKey", () => {
  test("returns deterministic key based on signature prefix", () => {
    const p1 = { payload: { signature: "0xabc123def456" + "x".repeat(120) } };
    const p2 = { payload: { signature: "0xabc123def456" + "x".repeat(120) } };
    expect(payloadKey(p1)).toBe(payloadKey(p2));
  });

  test("different signatures produce different keys", () => {
    const p1 = { payload: { signature: "0xAAA" + "a".repeat(125) } };
    const p2 = { payload: { signature: "0xBBB" + "b".repeat(125) } };
    expect(payloadKey(p1)).not.toBe(payloadKey(p2));
  });

  test("truncates signature to 128 characters", () => {
    const longSig = "0x" + "a".repeat(200);
    const key = payloadKey({ payload: { signature: longSig } });
    expect(key).toHaveLength(128);
  });
});
