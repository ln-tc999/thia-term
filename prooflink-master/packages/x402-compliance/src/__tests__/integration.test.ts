import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { ProofLinkX402Compliance } from "../middleware.js";
import { RateLimiter } from "../rate-limiter.js";
import type {
  ProofLinkConfig,
  PaymentPayload,
  PaymentRequirements,
  SettleResponse,
  ScreeningResult,
  AmlScoreResult,
  KYACredential,
  KYAVerificationResult,
  ComplianceEvent,
} from "../types.js";
import type { SanctionsScreener, AmlScorer } from "../hooks/before-verify.js";
import type { TravelRuleService, PriceConverter } from "../hooks/before-settle.js";
import type { ProofLinkService, InvoiceService } from "../hooks/after-settle.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CLEAN_SENDER = "0x1111111111111111111111111111111111111111";
const CLEAN_RECEIVER = "0x2222222222222222222222222222222222222222";
const SANCTIONED_SENDER = "0xbaD0000000000000000000000000000000000bad";
const SANCTIONED_RECEIVER = "0xbaD1111111111111111111111111111111111bad";
const USDC_ASSET = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const BASE_NETWORK = "eip155:8453";

// ---------------------------------------------------------------------------
// Payload / requirements factories
// ---------------------------------------------------------------------------

let sigCounter = 0;

function uniqueSig(): string {
  sigCounter++;
  // Must be at least 130 hex chars (65 bytes) for payloadKey slicing to be safe.
  return `0xintegration_sig_${String(sigCounter).padStart(4, "0")}_${"a".repeat(110)}`;
}

function makePayload(
  from: string = CLEAN_SENDER,
  sigOverride?: string,
): PaymentPayload {
  return {
    x402Version: 2,
    scheme: "exact",
    network: BASE_NETWORK,
    payload: {
      signature: sigOverride ?? uniqueSig(),
      authorization: {
        from,
        to: CLEAN_RECEIVER,
        value: "1000000000",
        validAfter: "1740672089",
        validBefore: "1740672154",
        nonce: "0xf3746",
      },
    },
  };
}

function makeRequirements(
  maxAmountRequired = "1000000000",
  payTo: string = CLEAN_RECEIVER,
): PaymentRequirements {
  return {
    scheme: "exact",
    network: BASE_NETWORK,
    maxAmountRequired,
    payTo,
    asset: USDC_ASSET,
  };
}

function makeSettleResult(txHash = "0xtxhash_integration"): SettleResponse {
  return {
    success: true,
    transaction: txHash,
    network: BASE_NETWORK,
    payer: CLEAN_SENDER,
  };
}

// ---------------------------------------------------------------------------
// Service mock factories
// ---------------------------------------------------------------------------

function makeScreener(
  sanctionedAddresses: string[] = [],
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
        latencyMs: 2,
      };
    }),
  };
}

function makeAmlScorer(score = 10): AmlScorer {
  return {
    score: vi.fn(async (address: string): Promise<AmlScoreResult> => ({
      address,
      score,
      latencyMs: 2,
      factors: score > 50 ? ["velocity"] : [],
    })),
  };
}

function makeTravelRuleService(success = true, referenceId = "tr-ref-integration"): TravelRuleService {
  return {
    transmit: vi.fn(async () => ({
      success,
      referenceId: success ? referenceId : undefined,
      error: success ? undefined : "Notabene API unavailable",
      latencyMs: 15,
    })),
  };
}

function makePriceConverter(usd: number): PriceConverter {
  return {
    toUsd: vi.fn(async () => usd),
  };
}

function makeProofLinkService(hashPrefix = "0xproof"): ProofLinkService {
  return {
    computeHash: vi.fn((receipt) => `${hashPrefix}_${receipt.transactionHash.slice(2, 10)}`),
    attestOnChain: vi.fn(async () => "eas-uid-integration"),
    storeAuditRecord: vi.fn(async () => {}),
  };
}

function makeInvoiceService(invoiceId: string | null = "inv-integration-001"): InvoiceService {
  return {
    generate: vi.fn(async () => invoiceId),
  };
}

// ---------------------------------------------------------------------------
// Config factory
// ---------------------------------------------------------------------------

function makeConfig(overrides: Partial<ProofLinkConfig> = {}): ProofLinkConfig {
  return {
    chainalysisApiKey: "test-key-integration",
    policy: {
      sanctionsLists: ["OFAC_SDN"],
      maxRiskScore: 70,
      travelRuleThresholdUsd: 1000,
      ...overrides.policy,
    },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Helper: run a full 3-phase flow on a compliance instance
// ---------------------------------------------------------------------------

async function runFullFlow(
  compliance: ProofLinkX402Compliance,
  payload: PaymentPayload,
  requirements: PaymentRequirements,
  txHash = "0xtxhash_integration",
) {
  const verifyResult = await compliance.onBeforeVerify({ paymentPayload: payload, requirements });
  if (verifyResult?.abort) return { abortedAt: "verify", result: verifyResult };

  const settleResult = await compliance.onBeforeSettle({ paymentPayload: payload, requirements });
  if (settleResult?.abort) return { abortedAt: "settle", result: settleResult };

  await compliance.onAfterSettle({
    paymentPayload: payload,
    requirements,
    result: makeSettleResult(txHash),
  });

  return { abortedAt: null, result: undefined };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("integration: full compliance flow", () => {
  let compliance: ProofLinkX402Compliance;
  const events: ComplianceEvent[] = [];

  beforeEach(() => {
    sigCounter = 0;
    events.length = 0;
  });

  afterEach(() => {
    compliance?.destroy();
  });

  test("before-verify → before-settle → after-settle produces all expected events and receipt", async () => {
    const screener = makeScreener();
    const amlScorer = makeAmlScorer(15);
    const proofLinkService = makeProofLinkService();
    const invoiceService = makeInvoiceService();

    compliance = new ProofLinkX402Compliance(makeConfig(), {
      screener,
      amlScorer,
      proofLinkService,
      invoiceService,
    });
    compliance.on((e) => events.push(e));

    const payload = makePayload();
    const requirements = makeRequirements();

    const { abortedAt } = await runFullFlow(compliance, payload, requirements);

    expect(abortedAt).toBeNull();

    // Screener called: 2 (verify: sender + receiver) + 1 (settle: receiver re-check)
    expect(screener.screen).toHaveBeenCalledTimes(3);
    expect(amlScorer.score).toHaveBeenCalledOnce();

    // Receipt generation
    expect(proofLinkService.computeHash).toHaveBeenCalledOnce();
    expect(proofLinkService.storeAuditRecord).toHaveBeenCalledOnce();

    // Event sequence
    const types = events.map((e) => e.type);
    expect(types[0]).toBe("compliance:check:started");
    expect(types).toContain("compliance:check:passed");
    expect(types).toContain("compliance:settle:completed");
    expect(types).toContain("compliance:receipt:generated");
  });

  test("event payloads carry sender, receiver, network, and riskScore", async () => {
    compliance = new ProofLinkX402Compliance(makeConfig(), {
      screener: makeScreener(),
      amlScorer: makeAmlScorer(25),
      proofLinkService: makeProofLinkService(),
    });
    compliance.on((e) => events.push(e));

    const payload = makePayload();
    const requirements = makeRequirements();
    await runFullFlow(compliance, payload, requirements, "0xtxhash_events");

    const started = events.find((e) => e.type === "compliance:check:started");
    expect(started?.payload.sender).toBe(CLEAN_SENDER);
    expect(started?.payload.receiver).toBe(CLEAN_RECEIVER);
    expect(started?.payload.network).toBe(BASE_NETWORK);

    const passed = events.find((e) => e.type === "compliance:check:passed");
    expect(passed?.payload.riskScore).toBe(25);

    const settled = events.find((e) => e.type === "compliance:settle:completed");
    expect(settled?.payload.transactionHash).toBe("0xtxhash_events");
    expect(settled?.payload.proofLinkHash).toBeDefined();
  });

  test("pending decision is deleted from map after after-settle completes", async () => {
    const proofLinkService = makeProofLinkService();
    compliance = new ProofLinkX402Compliance(makeConfig(), {
      screener: makeScreener(),
      amlScorer: makeAmlScorer(),
      proofLinkService,
    });

    const payload = makePayload();
    const requirements = makeRequirements();

    await compliance.onBeforeVerify({ paymentPayload: payload, requirements });
    await compliance.onBeforeSettle({ paymentPayload: payload, requirements });

    // storeAuditRecord is called with the receipt — confirms after-settle ran
    expect(proofLinkService.storeAuditRecord).not.toHaveBeenCalled();

    await compliance.onAfterSettle({
      paymentPayload: payload,
      requirements,
      result: makeSettleResult(),
    });

    expect(proofLinkService.storeAuditRecord).toHaveBeenCalledOnce();
    // Re-running after-settle with same payload (decision deleted) → skips receipt
    const storeCallCount = (proofLinkService.storeAuditRecord as ReturnType<typeof vi.fn>).mock.calls.length;
    await compliance.onAfterSettle({
      paymentPayload: payload,
      requirements,
      result: makeSettleResult(),
    });
    expect(proofLinkService.storeAuditRecord).toHaveBeenCalledTimes(storeCallCount); // no extra call
  });
});

// ---------------------------------------------------------------------------
// Tests: payment blocked at verification (sanctioned address)
// ---------------------------------------------------------------------------

describe("integration: payment blocked at verification stage", () => {
  let compliance: ProofLinkX402Compliance;
  const events: ComplianceEvent[] = [];

  beforeEach(() => { events.length = 0; });
  afterEach(() => { compliance?.destroy(); });

  test("sanctioned sender aborts at before-verify with sanctions_hit reason", async () => {
    const screener = makeScreener([SANCTIONED_SENDER]);
    compliance = new ProofLinkX402Compliance(makeConfig(), {
      screener,
      amlScorer: makeAmlScorer(),
    });
    compliance.on((e) => events.push(e));

    const payload = makePayload(SANCTIONED_SENDER);
    const result = await compliance.onBeforeVerify({
      paymentPayload: payload,
      requirements: makeRequirements(),
    });

    expect(result).toEqual({
      abort: true,
      reason: "sanctions_hit",
      message: expect.stringContaining("Sender address flagged"),
    });

    const failedEvent = events.find((e) => e.type === "compliance:check:failed");
    expect(failedEvent?.payload.reason).toBe("sanctions_sender");
    expect(failedEvent?.payload.riskScore).toBe(100);
  });

  test("sanctioned receiver aborts at before-verify with sanctions_hit reason", async () => {
    const screener = makeScreener([SANCTIONED_RECEIVER]);
    compliance = new ProofLinkX402Compliance(makeConfig(), {
      screener,
      amlScorer: makeAmlScorer(),
    });
    compliance.on((e) => events.push(e));

    const result = await compliance.onBeforeVerify({
      paymentPayload: makePayload(),
      requirements: makeRequirements("1000000000", SANCTIONED_RECEIVER),
    });

    expect(result).toEqual({
      abort: true,
      reason: "sanctions_hit",
      message: expect.stringContaining("Receiver address flagged"),
    });

    const failedEvent = events.find((e) => e.type === "compliance:check:failed");
    expect(failedEvent?.payload.reason).toBe("sanctions_receiver");
  });

  test("sanctioned receiver caught at before-settle re-check even when verify passed", async () => {
    // Simulate a receiver that becomes sanctioned between verify and settle
    let callCount = 0;
    const screener: SanctionsScreener = {
      screen: vi.fn(async (address: string): Promise<ScreeningResult> => {
        callCount++;
        // Receiver passes on first check (verify) but fails on re-check (settle)
        const isReceiverRecheck = address.toLowerCase() === CLEAN_RECEIVER.toLowerCase() && callCount >= 3;
        return {
          address,
          clean: !isReceiverRecheck,
          matchedList: isReceiverRecheck ? "OFAC_SDN" : undefined,
          latencyMs: 1,
        };
      }),
    };

    compliance = new ProofLinkX402Compliance(makeConfig(), {
      screener,
      amlScorer: makeAmlScorer(),
    });
    compliance.on((e) => events.push(e));

    const payload = makePayload();
    const requirements = makeRequirements();

    const verifyResult = await compliance.onBeforeVerify({ paymentPayload: payload, requirements });
    expect(verifyResult).toBeUndefined();

    const settleResult = await compliance.onBeforeSettle({ paymentPayload: payload, requirements });
    expect(settleResult).toEqual({
      abort: true,
      reason: "sanctions_hit",
      message: expect.stringContaining("Receiver re-check flagged"),
    });

    const failedEvent = events.find((e) => e.type === "compliance:check:failed");
    expect(failedEvent?.payload.reason).toBe("sanctions_receiver_recheck");
  });

  test("no pending decision is stored when verify is aborted", async () => {
    const proofLinkService = makeProofLinkService();
    compliance = new ProofLinkX402Compliance(makeConfig(), {
      screener: makeScreener([SANCTIONED_SENDER]),
      amlScorer: makeAmlScorer(),
      proofLinkService,
    });

    const payload = makePayload(SANCTIONED_SENDER);
    await compliance.onBeforeVerify({
      paymentPayload: payload,
      requirements: makeRequirements(),
    });

    // after-settle with no decision → should skip receipt
    await compliance.onAfterSettle({
      paymentPayload: payload,
      requirements: makeRequirements(),
      result: makeSettleResult(),
    });

    expect(proofLinkService.computeHash).not.toHaveBeenCalled();
    expect(proofLinkService.storeAuditRecord).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Tests: Travel Rule triggered for high-value payments ($1000+)
// ---------------------------------------------------------------------------

describe("integration: travel rule for high-value payments", () => {
  let compliance: ProofLinkX402Compliance;
  const events: ComplianceEvent[] = [];

  beforeEach(() => { events.length = 0; });
  afterEach(() => { compliance?.destroy(); });

  test("travel rule is triggered when USD value >= $1000 threshold", async () => {
    const travelRuleService = makeTravelRuleService(true, "tr-ref-highvalue");
    const priceConverter = makePriceConverter(1000); // exactly at threshold
    const proofLinkService = makeProofLinkService();

    compliance = new ProofLinkX402Compliance(
      makeConfig({ policy: { sanctionsLists: ["OFAC_SDN"], maxRiskScore: 70, travelRuleThresholdUsd: 1000 } }),
      {
        screener: makeScreener(),
        amlScorer: makeAmlScorer(),
        travelRuleService,
        priceConverter,
        proofLinkService,
      },
    );
    compliance.on((e) => events.push(e));

    const payload = makePayload();
    const requirements = makeRequirements("1000000000");

    await compliance.onBeforeVerify({ paymentPayload: payload, requirements });
    const settleResult = await compliance.onBeforeSettle({ paymentPayload: payload, requirements });

    expect(settleResult).toBeUndefined();
    expect(travelRuleService.transmit).toHaveBeenCalledOnce();
    expect(travelRuleService.transmit).toHaveBeenCalledWith(
      expect.objectContaining({
        originatorAddress: CLEAN_SENDER,
        beneficiaryAddress: CLEAN_RECEIVER,
        asset: USDC_ASSET,
        network: BASE_NETWORK,
      }),
    );
  });

  test("travel rule stores reference ID in pending decision", async () => {
    const travelRuleService = makeTravelRuleService(true, "tr-ref-stored");
    const proofLinkService = makeProofLinkService();
    let capturedReceipt: Parameters<ProofLinkService["computeHash"]>[0] | null = null;
    proofLinkService.computeHash = vi.fn((r) => {
      capturedReceipt = r;
      return "0xproof_stored";
    });

    compliance = new ProofLinkX402Compliance(
      makeConfig({ policy: { sanctionsLists: ["OFAC_SDN"], maxRiskScore: 70, travelRuleThresholdUsd: 1000 } }),
      {
        screener: makeScreener(),
        amlScorer: makeAmlScorer(),
        travelRuleService,
        priceConverter: makePriceConverter(5000),
        proofLinkService,
      },
    );

    const payload = makePayload();
    const requirements = makeRequirements("5000000000");

    await compliance.onBeforeVerify({ paymentPayload: payload, requirements });
    await compliance.onBeforeSettle({ paymentPayload: payload, requirements });
    await compliance.onAfterSettle({
      paymentPayload: payload,
      requirements,
      result: makeSettleResult("0xtx_tr_stored"),
    });

    expect(capturedReceipt).not.toBeNull();
    expect((capturedReceipt as unknown as { travelRuleRef: string }).travelRuleRef).toBe("tr-ref-stored");
  });

  test("travel rule is skipped when USD value is below threshold", async () => {
    const travelRuleService = makeTravelRuleService();

    compliance = new ProofLinkX402Compliance(
      makeConfig({ policy: { sanctionsLists: ["OFAC_SDN"], maxRiskScore: 70, travelRuleThresholdUsd: 1000 } }),
      {
        screener: makeScreener(),
        amlScorer: makeAmlScorer(),
        travelRuleService,
        priceConverter: makePriceConverter(999.99), // just below threshold
      },
    );

    const payload = makePayload();
    const requirements = makeRequirements();

    await compliance.onBeforeVerify({ paymentPayload: payload, requirements });
    const settleResult = await compliance.onBeforeSettle({ paymentPayload: payload, requirements });

    expect(settleResult).toBeUndefined();
    expect(travelRuleService.transmit).not.toHaveBeenCalled();
  });

  test("settlement aborts when travel rule transmission fails", async () => {
    compliance = new ProofLinkX402Compliance(
      makeConfig({ policy: { sanctionsLists: ["OFAC_SDN"], maxRiskScore: 70, travelRuleThresholdUsd: 1000 } }),
      {
        screener: makeScreener(),
        amlScorer: makeAmlScorer(),
        travelRuleService: makeTravelRuleService(false),
        priceConverter: makePriceConverter(1500),
      },
    );
    compliance.on((e) => events.push(e));

    const payload = makePayload();
    const requirements = makeRequirements("1500000000");

    await compliance.onBeforeVerify({ paymentPayload: payload, requirements });
    const result = await compliance.onBeforeSettle({ paymentPayload: payload, requirements });

    expect(result).toEqual({
      abort: true,
      reason: "travel_rule_failed",
      message: expect.stringContaining("Notabene API unavailable"),
    });

    const failedEvent = events.find((e) => e.type === "compliance:check:failed");
    expect(failedEvent?.payload.reason).toBe("travel_rule_failed");
  });

  test("travel rule check entry is added to compliance checks in the receipt", async () => {
    const proofLinkService = makeProofLinkService();
    let capturedChecks: unknown[] = [];
    proofLinkService.computeHash = vi.fn((r) => {
      capturedChecks = (r as { complianceChecks: unknown[] }).complianceChecks;
      return "0xproof_checks";
    });

    compliance = new ProofLinkX402Compliance(
      makeConfig({ policy: { sanctionsLists: ["OFAC_SDN"], maxRiskScore: 70, travelRuleThresholdUsd: 1000 } }),
      {
        screener: makeScreener(),
        amlScorer: makeAmlScorer(),
        travelRuleService: makeTravelRuleService(true, "tr-ref-checks"),
        priceConverter: makePriceConverter(2000),
        proofLinkService,
      },
    );

    const payload = makePayload();
    const requirements = makeRequirements("2000000000");

    await compliance.onBeforeVerify({ paymentPayload: payload, requirements });
    await compliance.onBeforeSettle({ paymentPayload: payload, requirements });
    await compliance.onAfterSettle({
      paymentPayload: payload,
      requirements,
      result: makeSettleResult("0xtx_checks"),
    });

    const trCheck = (capturedChecks as Array<{ type: string; result: string }>).find(
      (c) => c.type === "travel_rule",
    );
    expect(trCheck).toBeDefined();
    expect(trCheck?.result).toBe("pass");
  });
});

// ---------------------------------------------------------------------------
// Tests: Receipt generation after successful settlement
// ---------------------------------------------------------------------------

describe("integration: receipt generation after successful settlement", () => {
  let compliance: ProofLinkX402Compliance;

  afterEach(() => { compliance?.destroy(); });

  test("receipt contains all required fields", async () => {
    const proofLinkService = makeProofLinkService();
    let capturedReceipt: Parameters<ProofLinkService["storeAuditRecord"]>[0] | null = null;
    proofLinkService.storeAuditRecord = vi.fn(async (r) => {
      capturedReceipt = r;
    });
    proofLinkService.computeHash = vi.fn(() => "0xproof_receipt_fields");

    compliance = new ProofLinkX402Compliance(makeConfig(), {
      screener: makeScreener(),
      amlScorer: makeAmlScorer(30),
      proofLinkService,
    });

    const payload = makePayload();
    const requirements = makeRequirements("500000000");

    await compliance.onBeforeVerify({ paymentPayload: payload, requirements });
    await compliance.onBeforeSettle({ paymentPayload: payload, requirements });
    await compliance.onAfterSettle({
      paymentPayload: payload,
      requirements,
      result: makeSettleResult("0xtx_receipt_fields"),
    });

    expect(capturedReceipt).not.toBeNull();
    const r = capturedReceipt as unknown as {
      version: number;
      transactionHash: string;
      network: string;
      sender: string;
      receiver: string;
      amount: string;
      asset: string;
      riskScore: number;
      proofLinkHash: string;
      createdAt: string;
      complianceChecks: unknown[];
    };
    expect(r.version).toBe(1);
    expect(r.transactionHash).toBe("0xtx_receipt_fields");
    expect(r.network).toBe(BASE_NETWORK);
    expect(r.sender).toBe(CLEAN_SENDER);
    expect(r.receiver).toBe(CLEAN_RECEIVER);
    expect(r.amount).toBe("500000000");
    expect(r.asset).toBe(USDC_ASSET);
    expect(r.riskScore).toBe(30);
    expect(r.proofLinkHash).toBe("0xproof_receipt_fields");
    expect(r.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(Array.isArray(r.complianceChecks)).toBe(true);
    expect(r.complianceChecks.length).toBeGreaterThan(0);
  });

  test("receipt compliance checks include sanctions entries for both sender and receiver", async () => {
    const proofLinkService = makeProofLinkService();
    let capturedChecks: Array<{ type: string; target: string; result: string }> = [];
    proofLinkService.storeAuditRecord = vi.fn(async (r) => {
      capturedChecks = (r as { complianceChecks: Array<{ type: string; target: string; result: string }> }).complianceChecks;
    });
    proofLinkService.computeHash = vi.fn(() => "0xproof_checks_sanctions");

    compliance = new ProofLinkX402Compliance(makeConfig(), {
      screener: makeScreener(),
      amlScorer: makeAmlScorer(),
      proofLinkService,
    });

    const payload = makePayload();
    const requirements = makeRequirements();

    await compliance.onBeforeVerify({ paymentPayload: payload, requirements });
    await compliance.onBeforeSettle({ paymentPayload: payload, requirements });
    await compliance.onAfterSettle({
      paymentPayload: payload,
      requirements,
      result: makeSettleResult("0xtx_checks_sanctions"),
    });

    const sanctionsChecks = capturedChecks.filter((c) => c.type === "sanctions");
    // At least sender + receiver from verify, plus receiver re-check from settle
    expect(sanctionsChecks.length).toBeGreaterThanOrEqual(2);
    const senderCheck = sanctionsChecks.find((c) => c.target === CLEAN_SENDER);
    expect(senderCheck?.result).toBe("pass");
  });

  test("receipt generation emits compliance:receipt:generated event", async () => {
    const events: ComplianceEvent[] = [];
    compliance = new ProofLinkX402Compliance(makeConfig(), {
      screener: makeScreener(),
      amlScorer: makeAmlScorer(),
      proofLinkService: makeProofLinkService(),
    });
    compliance.on((e) => events.push(e));

    const payload = makePayload();
    const requirements = makeRequirements();

    await compliance.onBeforeVerify({ paymentPayload: payload, requirements });
    await compliance.onBeforeSettle({ paymentPayload: payload, requirements });
    await compliance.onAfterSettle({
      paymentPayload: payload,
      requirements,
      result: makeSettleResult("0xtx_receipt_event"),
    });

    const receiptEvent = events.find((e) => e.type === "compliance:receipt:generated");
    expect(receiptEvent).toBeDefined();
    expect(receiptEvent?.payload.proofLinkHash).toBeDefined();
    expect(receiptEvent?.payload.transactionHash).toBe("0xtx_receipt_event");
  });

  test("invoice is generated when invoice service is configured", async () => {
    const invoiceService = makeInvoiceService("inv-test-flow");
    const proofLinkService = makeProofLinkService();

    compliance = new ProofLinkX402Compliance(
      makeConfig({
        invoicing: {
          enabled: true,
          companyName: "ProofLink Inc",
          companyAddress: "123 Crypto Lane",
        },
      }),
      {
        screener: makeScreener(),
        amlScorer: makeAmlScorer(),
        proofLinkService,
        invoiceService,
      },
    );

    const payload = makePayload();
    const requirements = makeRequirements();

    await compliance.onBeforeVerify({ paymentPayload: payload, requirements });
    await compliance.onBeforeSettle({ paymentPayload: payload, requirements });
    await compliance.onAfterSettle({
      paymentPayload: payload,
      requirements,
      result: makeSettleResult("0xtx_invoice"),
    });

    // Invoice generation is fire-and-forget, give it a tick
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(invoiceService.generate).toHaveBeenCalledOnce();
  });

  test("after-settle with no pending decision logs warning and skips receipt", async () => {
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    const proofLinkService = makeProofLinkService();

    compliance = new ProofLinkX402Compliance(makeConfig({ logger }), {
      screener: makeScreener(),
      amlScorer: makeAmlScorer(),
      proofLinkService,
    });

    // Run after-settle WITHOUT running before-verify first (no pending decision)
    const payload = makePayload();
    await compliance.onAfterSettle({
      paymentPayload: payload,
      requirements: makeRequirements(),
      result: makeSettleResult("0xtx_no_decision"),
    });

    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("No compliance decision found"),
    );
    expect(proofLinkService.computeHash).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Tests: Rate limiting behavior
// ---------------------------------------------------------------------------

describe("integration: rate limiting", () => {
  let limiter: RateLimiter;

  afterEach(() => { limiter?.destroy(); });

  test("allows requests up to the configured limit", () => {
    limiter = new RateLimiter({
      defaultTier: { maxRequests: 5, windowSeconds: 60 },
    });

    for (let i = 0; i < 5; i++) {
      const result = limiter.check("wallet_0xABCD");
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(4 - i);
    }
  });

  test("blocks the (limit+1)-th request within the window", () => {
    limiter = new RateLimiter({
      defaultTier: { maxRequests: 3, windowSeconds: 60 },
    });

    limiter.check("wallet_0xABCD");
    limiter.check("wallet_0xABCD");
    limiter.check("wallet_0xABCD");

    const blocked = limiter.check("wallet_0xABCD");
    expect(blocked.allowed).toBe(false);
    expect(blocked.remaining).toBe(0);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
  });

  test("tracks limits independently per wallet key", () => {
    limiter = new RateLimiter({
      defaultTier: { maxRequests: 1, windowSeconds: 60 },
    });

    const result1 = limiter.check("wallet_A");
    const result2 = limiter.check("wallet_B");

    expect(result1.allowed).toBe(true);
    expect(result2.allowed).toBe(true);

    // Both keys are now at limit
    expect(limiter.check("wallet_A").allowed).toBe(false);
    expect(limiter.check("wallet_B").allowed).toBe(false);
  });

  test("applies named tier over default when tier name matches", () => {
    limiter = new RateLimiter({
      defaultTier: { maxRequests: 100, windowSeconds: 60 },
      tiers: {
        restricted: { maxRequests: 2, windowSeconds: 60 },
      },
    });

    limiter.check("wallet_C", "restricted");
    limiter.check("wallet_C", "restricted");

    const blocked = limiter.check("wallet_C", "restricted");
    expect(blocked.allowed).toBe(false);
    expect(blocked.limit).toBe(2);
  });

  test("falls back to default tier when named tier is unknown", () => {
    limiter = new RateLimiter({
      defaultTier: { maxRequests: 10, windowSeconds: 60 },
    });

    const result = limiter.check("wallet_D", "unknown_tier");
    expect(result.allowed).toBe(true);
    expect(result.limit).toBe(10);
  });

  test("reset clears state for a specific key", () => {
    limiter = new RateLimiter({
      defaultTier: { maxRequests: 1, windowSeconds: 60 },
    });

    limiter.check("wallet_E");
    expect(limiter.check("wallet_E").allowed).toBe(false);

    limiter.reset("wallet_E");
    expect(limiter.check("wallet_E").allowed).toBe(true);
  });

  test("resetAll clears state for all keys", () => {
    limiter = new RateLimiter({
      defaultTier: { maxRequests: 1, windowSeconds: 60 },
    });

    limiter.check("wallet_F");
    limiter.check("wallet_G");

    limiter.resetAll();

    expect(limiter.check("wallet_F").allowed).toBe(true);
    expect(limiter.check("wallet_G").allowed).toBe(true);
    expect(limiter.size).toBe(2);
  });

  test("peek returns current status without consuming a request slot", () => {
    limiter = new RateLimiter({
      defaultTier: { maxRequests: 3, windowSeconds: 60 },
    });

    limiter.check("wallet_H");
    limiter.check("wallet_H");

    const peeked = limiter.peek("wallet_H");
    expect(peeked.allowed).toBe(true);
    expect(peeked.remaining).toBe(1);

    // Peek should not have consumed a slot
    const next = limiter.check("wallet_H");
    expect(next.allowed).toBe(true);
    expect(next.remaining).toBe(0);

    // Now it's exhausted
    expect(limiter.check("wallet_H").allowed).toBe(false);
  });

  test("retryAfterSeconds is a positive integer when rate limit exceeded", () => {
    limiter = new RateLimiter({
      defaultTier: { maxRequests: 1, windowSeconds: 30 },
    });

    limiter.check("wallet_I");
    const blocked = limiter.check("wallet_I");

    expect(blocked.allowed).toBe(false);
    expect(Number.isInteger(blocked.retryAfterSeconds)).toBe(true);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
    expect(blocked.retryAfterSeconds).toBeLessThanOrEqual(30);
  });

  test("resetAt is a future unix timestamp in seconds", () => {
    limiter = new RateLimiter({
      defaultTier: { maxRequests: 5, windowSeconds: 60 },
    });

    const result = limiter.check("wallet_J");
    const nowSeconds = Math.floor(Date.now() / 1000);

    expect(result.resetAt).toBeGreaterThan(nowSeconds);
    expect(result.resetAt).toBeLessThanOrEqual(nowSeconds + 60 + 2);
  });
});

// ---------------------------------------------------------------------------
// Tests: Error handling — service unavailability (fail-open vs fail-closed)
// ---------------------------------------------------------------------------

describe("integration: error handling when services are unavailable", () => {
  let compliance: ProofLinkX402Compliance;
  const events: ComplianceEvent[] = [];

  beforeEach(() => { events.length = 0; });
  afterEach(() => { compliance?.destroy(); });

  test("screener throwing aborts payment (fail-closed) and emits check:failed event", async () => {
    const screener: SanctionsScreener = {
      screen: vi.fn(async () => {
        throw new Error("Chainalysis API timeout");
      }),
    };

    compliance = new ProofLinkX402Compliance(makeConfig(), {
      screener,
      amlScorer: makeAmlScorer(),
    });
    compliance.on((e) => events.push(e));

    const result = await compliance.onBeforeVerify({
      paymentPayload: makePayload(),
      requirements: makeRequirements(),
    });

    expect(result).toEqual({
      abort: true,
      reason: "compliance_error",
      message: expect.stringContaining("Chainalysis API timeout"),
    });

    const failedEvent = events.find((e) => e.type === "compliance:check:failed");
    expect(failedEvent?.payload.reason).toBe("compliance_service_error");
  });

  test("amlScorer throwing aborts payment (fail-closed) with compliance_error", async () => {
    const amlScorer: AmlScorer = {
      score: vi.fn(async () => {
        throw new Error("AML scoring service unreachable");
      }),
    };

    compliance = new ProofLinkX402Compliance(makeConfig(), {
      screener: makeScreener(),
      amlScorer,
    });

    const result = await compliance.onBeforeVerify({
      paymentPayload: makePayload(),
      requirements: makeRequirements(),
    });

    expect(result).toEqual({
      abort: true,
      reason: "compliance_error",
      message: expect.stringContaining("AML scoring service unreachable"),
    });
  });

  test("proofLinkService.storeAuditRecord throwing does not crash after-settle", async () => {
    const proofLinkService = makeProofLinkService();
    proofLinkService.storeAuditRecord = vi.fn(async () => {
      throw new Error("DB connection lost");
    });
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

    compliance = new ProofLinkX402Compliance(makeConfig({ logger }), {
      screener: makeScreener(),
      amlScorer: makeAmlScorer(),
      proofLinkService,
    });

    const payload = makePayload();
    const requirements = makeRequirements();

    await compliance.onBeforeVerify({ paymentPayload: payload, requirements });
    await compliance.onBeforeSettle({ paymentPayload: payload, requirements });

    // Should not throw
    await expect(
      compliance.onAfterSettle({
        paymentPayload: payload,
        requirements,
        result: makeSettleResult("0xtx_store_fail"),
      }),
    ).resolves.toBeUndefined();

    // Give the async error handler a tick
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(logger.error).toHaveBeenCalledWith(
      "Audit record storage failed",
      expect.any(Error),
    );
  });

  test("EAS attestation throwing does not crash after-settle (fail-open, async)", async () => {
    const proofLinkService = makeProofLinkService();
    proofLinkService.attestOnChain = vi.fn(async () => {
      throw new Error("EAS node unavailable");
    });
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

    compliance = new ProofLinkX402Compliance(
      makeConfig({
        logger,
        eas: { schemaUid: "0xschema", privateKey: "0xpk", rpcUrl: "https://rpc.example.com" },
      }),
      {
        screener: makeScreener(),
        amlScorer: makeAmlScorer(),
        proofLinkService,
      },
    );

    const payload = makePayload();
    const requirements = makeRequirements();

    await compliance.onBeforeVerify({ paymentPayload: payload, requirements });
    await compliance.onBeforeSettle({ paymentPayload: payload, requirements });

    await expect(
      compliance.onAfterSettle({
        paymentPayload: payload,
        requirements,
        result: makeSettleResult("0xtx_eas_fail"),
      }),
    ).resolves.toBeUndefined();

    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(logger.error).toHaveBeenCalledWith(
      "EAS attestation failed",
      expect.any(Error),
    );
  });

  test("invoice service throwing does not crash after-settle (fail-open, async)", async () => {
    const invoiceService: InvoiceService = {
      generate: vi.fn(async () => {
        throw new Error("Invoice API down");
      }),
    };
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

    compliance = new ProofLinkX402Compliance(
      makeConfig({
        logger,
        invoicing: { enabled: true, companyName: "ProofLink", companyAddress: "123 Main St" },
      }),
      {
        screener: makeScreener(),
        amlScorer: makeAmlScorer(),
        proofLinkService: makeProofLinkService(),
        invoiceService,
      },
    );

    const payload = makePayload();
    const requirements = makeRequirements();

    await compliance.onBeforeVerify({ paymentPayload: payload, requirements });
    await compliance.onBeforeSettle({ paymentPayload: payload, requirements });

    await expect(
      compliance.onAfterSettle({
        paymentPayload: payload,
        requirements,
        result: makeSettleResult("0xtx_invoice_fail"),
      }),
    ).resolves.toBeUndefined();

    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(logger.error).toHaveBeenCalledWith(
      "Invoice generation failed",
      expect.any(Error),
    );
  });

  test("event handler throwing does not abort the hook execution", async () => {
    compliance = new ProofLinkX402Compliance(makeConfig(), {
      screener: makeScreener(),
      amlScorer: makeAmlScorer(),
    });

    // Register a handler that throws
    compliance.on(() => {
      throw new Error("Event handler error");
    });

    // Must not propagate — hook should still return normally
    await expect(
      compliance.onBeforeVerify({
        paymentPayload: makePayload(),
        requirements: makeRequirements(),
      }),
    ).resolves.toBeUndefined();
  });

  test("before-settle with missing sender aborts with compliance_error", async () => {
    compliance = new ProofLinkX402Compliance(makeConfig(), {
      screener: makeScreener(),
      amlScorer: makeAmlScorer(),
    });

    const noSenderPayload: PaymentPayload = {
      x402Version: 2,
      scheme: "exact",
      network: BASE_NETWORK,
      payload: {
        signature: uniqueSig(),
        // No authorization, permit2Authorization, or sender field
      },
    };

    const result = await compliance.onBeforeSettle({
      paymentPayload: noSenderPayload,
      requirements: makeRequirements(),
    });

    expect(result).toEqual({
      abort: true,
      reason: "compliance_error",
      message: expect.stringContaining("Cannot extract sender address at settle phase"),
    });
  });

  test("travel rule service throwing propagates as a rejected promise that aborts settle", async () => {
    const travelRuleService: TravelRuleService = {
      transmit: vi.fn(async () => {
        throw new Error("Travel rule service crashed");
      }),
    };

    compliance = new ProofLinkX402Compliance(
      makeConfig({ policy: { sanctionsLists: ["OFAC_SDN"], maxRiskScore: 70, travelRuleThresholdUsd: 1000 } }),
      {
        screener: makeScreener(),
        amlScorer: makeAmlScorer(),
        travelRuleService,
        priceConverter: makePriceConverter(1500),
      },
    );

    const payload = makePayload();
    const requirements = makeRequirements("1500000000");

    await compliance.onBeforeVerify({ paymentPayload: payload, requirements });

    await expect(
      compliance.onBeforeSettle({ paymentPayload: payload, requirements }),
    ).rejects.toThrow("Travel rule service crashed");
  });
});
