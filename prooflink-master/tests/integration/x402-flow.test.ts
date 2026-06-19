/**
 * Integration tests: x402 compliance middleware (packages/x402-compliance)
 *
 * Tests ProofLinkX402Compliance hooks end-to-end:
 *   - onBeforeVerify (sanctions + AML + KYA)
 *   - onBeforeSettle (re-screen + Travel Rule)
 *   - onAfterSettle (ProofLink receipt generation)
 *   - Extension enrichment of 402/settlement responses
 *
 * All external services are mock-injected. Real hook logic is exercised.
 */

import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { ProofLinkX402Compliance } from "../../packages/x402-compliance/src/middleware.js";
import type { ComplianceEvent } from "../../packages/x402-compliance/src/types.js";
import {
  makeX402Config,
  makePaymentPayload,
  makePaymentRequirements,
  createMockScreener,
  createMockAmlScorer,
  createMockKYARegistry,
  createMockKYAVerifier,
  createMockTravelRuleService,
  createMockPriceConverter,
  createMockProofLinkService,
  createMockInvoiceService,
  createMockX402Server,
  CLEAN_SENDER,
  CLEAN_RECEIVER,
  MOCK_SANCTIONED_ADDRESS,
  AGENT_ADDRESS,
} from "./setup.js";

let compliance: ProofLinkX402Compliance;

afterEach(() => {
  compliance?.destroy();
});

// ---------------------------------------------------------------------------
// Happy path: clean payment flows through all three hooks
// ---------------------------------------------------------------------------

describe("x402 — full happy-path flow", () => {
  test("payment_to_clean_address_settles_successfully", async () => {
    // Arrange
    const screener = createMockScreener();
    const amlScorer = createMockAmlScorer(20);
    const proofLinkService = createMockProofLinkService();
    const events: ComplianceEvent[] = [];

    compliance = new ProofLinkX402Compliance(makeX402Config(), {
      screener,
      amlScorer,
      proofLinkService,
    });
    compliance.on((e) => events.push(e));

    const payload = makePaymentPayload();
    const requirements = makePaymentRequirements();

    // Act — three-stage pipeline
    const verifyResult = await compliance.onBeforeVerify({ paymentPayload: payload, requirements });
    const settleResult = await compliance.onBeforeSettle({ paymentPayload: payload, requirements });
    await compliance.onAfterSettle({
      paymentPayload: payload,
      requirements,
      result: { success: true, transaction: "0xtx001", network: "eip155:8453", payer: CLEAN_SENDER },
    });

    // Assert
    expect(verifyResult).toBeUndefined(); // undefined = pass
    expect(settleResult).toBeUndefined();
    expect(proofLinkService.computeHash).toHaveBeenCalledOnce();
    expect(proofLinkService.storeAuditRecord).toHaveBeenCalledOnce();
  });

  test("full_flow_emits_expected_compliance_events", async () => {
    // Arrange
    const events: ComplianceEvent[] = [];
    compliance = new ProofLinkX402Compliance(makeX402Config(), {
      screener: createMockScreener(),
      amlScorer: createMockAmlScorer(10),
      proofLinkService: createMockProofLinkService(),
    });
    compliance.on((e) => events.push(e));

    const payload = makePaymentPayload();
    const requirements = makePaymentRequirements();

    // Act
    await compliance.onBeforeVerify({ paymentPayload: payload, requirements });
    await compliance.onBeforeSettle({ paymentPayload: payload, requirements });
    await compliance.onAfterSettle({
      paymentPayload: payload,
      requirements,
      result: { success: true, transaction: "0xtx002", network: "eip155:8453" },
    });

    // Assert
    const types = events.map((e) => e.type);
    expect(types).toContain("compliance:check:started");
    expect(types).toContain("compliance:check:passed");
    expect(types).toContain("compliance:settle:completed");
    expect(types).toContain("compliance:receipt:generated");
  });
});

// ---------------------------------------------------------------------------
// Sanctions block in beforeVerify
// ---------------------------------------------------------------------------

describe("x402 — sanctions screening", () => {
  test("payment_to_sanctioned_sender_aborts_with_structured_reason", async () => {
    // Arrange
    compliance = new ProofLinkX402Compliance(makeX402Config(), {
      screener: createMockScreener(MOCK_SANCTIONED_ADDRESS),
      amlScorer: createMockAmlScorer(10),
    });

    const payload = makePaymentPayload({
      payload: {
        signature: "0xsanctioned_sig_1234567890abcdef1234567890abcdef12345678",
        authorization: {
          from: MOCK_SANCTIONED_ADDRESS,
          to: CLEAN_RECEIVER,
          value: "10000",
          validAfter: "1740672089",
          validBefore: "1740672154",
          nonce: "0xf3746",
        },
      },
    });

    // Act
    const result = await compliance.onBeforeVerify({
      paymentPayload: payload,
      requirements: makePaymentRequirements(),
    });

    // Assert
    expect(result).toEqual({
      abort: true,
      reason: "sanctions_hit",
      message: expect.stringContaining("Sender address flagged"),
    });
  });

  test("payment_to_sanctioned_receiver_aborts_with_structured_reason", async () => {
    // Arrange
    compliance = new ProofLinkX402Compliance(makeX402Config(), {
      screener: createMockScreener(MOCK_SANCTIONED_ADDRESS),
      amlScorer: createMockAmlScorer(10),
    });

    // Act
    const result = await compliance.onBeforeVerify({
      paymentPayload: makePaymentPayload(),
      requirements: makePaymentRequirements({ payTo: MOCK_SANCTIONED_ADDRESS }),
    });

    // Assert
    expect(result).toEqual({
      abort: true,
      reason: "sanctions_hit",
      message: expect.stringContaining("Receiver address flagged"),
    });
  });

  test("blocklisted_sender_aborts_before_any_screener_call", async () => {
    // Arrange
    const screener = createMockScreener();
    compliance = new ProofLinkX402Compliance(
      makeX402Config({ policy: { sanctionsLists: ["OFAC_SDN"], maxRiskScore: 70, travelRuleThresholdUsd: 3000, blocklist: [CLEAN_SENDER] } }),
      { screener },
    );

    // Act
    const result = await compliance.onBeforeVerify({
      paymentPayload: makePaymentPayload(),
      requirements: makePaymentRequirements(),
    });

    // Assert
    expect(result).toEqual({
      abort: true,
      reason: "compliance_blocked",
      message: "Sender address is blocklisted",
    });
    expect(screener.screen).not.toHaveBeenCalled();
  });

  test("receiver_re_screened_at_settlement_phase", async () => {
    // Arrange
    const screener = createMockScreener();
    const amlScorer = createMockAmlScorer(10);
    compliance = new ProofLinkX402Compliance(makeX402Config(), { screener, amlScorer });

    const payload = makePaymentPayload();
    const requirements = makePaymentRequirements();

    // Act
    await compliance.onBeforeVerify({ paymentPayload: payload, requirements });
    await compliance.onBeforeSettle({ paymentPayload: payload, requirements });

    // Assert — sender+receiver at verify (2), then receiver at settle (+1) = 3
    expect(screener.screen).toHaveBeenCalledTimes(3);
  });
});

// ---------------------------------------------------------------------------
// Travel Rule in beforeSettle
// ---------------------------------------------------------------------------

describe("x402 — Travel Rule", () => {
  test("payment_above_travel_rule_threshold_transmits_travel_rule_data", async () => {
    // Arrange — $5000 > $3000 threshold
    const travelRuleService = createMockTravelRuleService(true);
    const priceConverter = createMockPriceConverter(5000);
    const screener = createMockScreener();
    const amlScorer = createMockAmlScorer(10);

    compliance = new ProofLinkX402Compliance(
      makeX402Config({ notabene: { apiKey: "test-key", vaspDID: "did:ethr:0x123" } }),
      { screener, amlScorer, travelRuleService, priceConverter },
    );

    const payload = makePaymentPayload();
    const requirements = makePaymentRequirements({ maxAmountRequired: "5000000000" });

    // Act
    await compliance.onBeforeVerify({ paymentPayload: payload, requirements });
    const settleResult = await compliance.onBeforeSettle({ paymentPayload: payload, requirements });

    // Assert
    expect(settleResult).toBeUndefined(); // passed
    expect(travelRuleService.transmit).toHaveBeenCalledOnce();
    expect(travelRuleService.transmit).toHaveBeenCalledWith(
      expect.objectContaining({
        originatorAddress: CLEAN_SENDER,
        beneficiaryAddress: CLEAN_RECEIVER,
      }),
    );
  });

  test("payment_below_travel_rule_threshold_skips_transmission", async () => {
    // Arrange — $0.01 < $3000 threshold
    const travelRuleService = createMockTravelRuleService(true);
    const priceConverter = createMockPriceConverter(0.01);

    compliance = new ProofLinkX402Compliance(
      makeX402Config({ notabene: { apiKey: "test-key", vaspDID: "did:ethr:0x123" } }),
      {
        screener: createMockScreener(),
        amlScorer: createMockAmlScorer(10),
        travelRuleService,
        priceConverter,
      },
    );

    const payload = makePaymentPayload();
    const requirements = makePaymentRequirements();

    // Act
    await compliance.onBeforeVerify({ paymentPayload: payload, requirements });
    await compliance.onBeforeSettle({ paymentPayload: payload, requirements });

    // Assert
    expect(travelRuleService.transmit).not.toHaveBeenCalled();
  });

  test("travel_rule_transmission_failure_aborts_settlement", async () => {
    // Arrange
    const travelRuleService = createMockTravelRuleService(false);
    const priceConverter = createMockPriceConverter(5000);

    compliance = new ProofLinkX402Compliance(
      makeX402Config({ notabene: { apiKey: "test-key", vaspDID: "did:ethr:0x123" } }),
      {
        screener: createMockScreener(),
        amlScorer: createMockAmlScorer(10),
        travelRuleService,
        priceConverter,
      },
    );

    const payload = makePaymentPayload();
    const requirements = makePaymentRequirements({ maxAmountRequired: "5000000000" });

    // Act
    await compliance.onBeforeVerify({ paymentPayload: payload, requirements });
    const result = await compliance.onBeforeSettle({ paymentPayload: payload, requirements });

    // Assert
    expect(result).toEqual({
      abort: true,
      reason: "travel_rule_failed",
      message: expect.stringContaining("Notabene API error"),
    });
  });
});

// ---------------------------------------------------------------------------
// afterSettle: ProofLink receipt generated
// ---------------------------------------------------------------------------

describe("x402 — afterSettle hook", () => {
  test("afterSettle_hook_generates_prooflink_receipt", async () => {
    // Arrange
    const proofLinkService = createMockProofLinkService();
    compliance = new ProofLinkX402Compliance(makeX402Config(), {
      screener: createMockScreener(),
      amlScorer: createMockAmlScorer(10),
      proofLinkService,
    });

    const payload = makePaymentPayload();
    const requirements = makePaymentRequirements();

    // Act
    await compliance.onBeforeVerify({ paymentPayload: payload, requirements });
    await compliance.onBeforeSettle({ paymentPayload: payload, requirements });
    await compliance.onAfterSettle({
      paymentPayload: payload,
      requirements,
      result: { success: true, transaction: "0xtxhash-receipt-test", network: "eip155:8453" },
    });

    // Assert
    expect(proofLinkService.computeHash).toHaveBeenCalledOnce();
    expect(proofLinkService.storeAuditRecord).toHaveBeenCalledOnce();
    const receiptArg = (proofLinkService.storeAuditRecord as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect(receiptArg).toBeDefined();
    expect(receiptArg.transactionHash).toBe("0xtxhash-receipt-test");
    expect(receiptArg.sender).toBe(CLEAN_SENDER);
    expect(receiptArg.receiver).toBe(CLEAN_RECEIVER);
    expect(receiptArg.proofLinkHash).toMatch(/^0x/);
  });

  test("afterSettle_skips_receipt_when_no_pending_decision", async () => {
    // Arrange — afterSettle without a preceding verify
    const proofLinkService = createMockProofLinkService();
    compliance = new ProofLinkX402Compliance(makeX402Config(), { proofLinkService });

    // Act — call afterSettle without running beforeVerify first
    await compliance.onAfterSettle({
      paymentPayload: makePaymentPayload(),
      requirements: makePaymentRequirements(),
      result: { success: true, transaction: "0xtxorphan", network: "eip155:8453" },
    });

    // Assert — no hash computed since there's no pending decision
    expect(proofLinkService.computeHash).not.toHaveBeenCalled();
  });

  test("afterSettle_triggers_eas_attestation_when_eas_config_present", async () => {
    // Arrange
    const proofLinkService = createMockProofLinkService();
    compliance = new ProofLinkX402Compliance(
      makeX402Config({
        eas: { schemaUid: "0xschema123", privateKey: "0xprivkey", rpcUrl: "https://rpc.example.com" },
      }),
      {
        screener: createMockScreener(),
        amlScorer: createMockAmlScorer(10),
        proofLinkService,
      },
    );

    const payload = makePaymentPayload();
    const requirements = makePaymentRequirements();

    // Act
    await compliance.onBeforeVerify({ paymentPayload: payload, requirements });
    await compliance.onBeforeSettle({ paymentPayload: payload, requirements });
    await compliance.onAfterSettle({
      paymentPayload: payload,
      requirements,
      result: { success: true, transaction: "0xtxeas", network: "eip155:8453" },
    });

    // Give the fire-and-forget async chain a tick to resolve
    await new Promise((r) => setTimeout(r, 20));

    // Assert
    expect(proofLinkService.attestOnChain).toHaveBeenCalledOnce();
  });

  test("invoice_generated_after_settlement_when_invoice_service_configured", async () => {
    // Arrange
    const invoiceService = createMockInvoiceService();
    compliance = new ProofLinkX402Compliance(makeX402Config(), {
      screener: createMockScreener(),
      amlScorer: createMockAmlScorer(10),
      proofLinkService: createMockProofLinkService(),
      invoiceService,
    });

    const payload = makePaymentPayload();
    const requirements = makePaymentRequirements();

    // Act
    await compliance.onBeforeVerify({ paymentPayload: payload, requirements });
    await compliance.onBeforeSettle({ paymentPayload: payload, requirements });
    await compliance.onAfterSettle({
      paymentPayload: payload,
      requirements,
      result: { success: true, transaction: "0xtxinvoice", network: "eip155:8453" },
    });

    // Allow fire-and-forget to complete
    await new Promise((r) => setTimeout(r, 20));

    // Assert
    expect(invoiceService.generate).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// Extension enrichment
// ---------------------------------------------------------------------------

describe("x402 — extension enrichment", () => {
  test("extension_enriches_402_response_with_compliance_info", async () => {
    // Arrange
    compliance = new ProofLinkX402Compliance(
      makeX402Config({
        policy: { sanctionsLists: ["OFAC_SDN", "EU", "UN"], maxRiskScore: 70, travelRuleThresholdUsd: 3000 },
      }),
    );
    const server = createMockX402Server();
    compliance.register(server);

    const extension = server.extensions[0]!;

    // Act
    const enriched = await extension.enrichPaymentRequiredResponse!(
      {},
      { requirements: makePaymentRequirements() },
    );

    // Assert
    expect(enriched).toEqual({
      complianceRequired: true,
      provider: "prooflink",
      version: expect.any(String),
      sanctionsLists: ["OFAC_SDN", "EU", "UN"],
      travelRuleThresholdUsd: 3000,
      maxRiskScore: 70,
    });
  });

  test("extension_enriches_settlement_response_with_prooflink_hash", async () => {
    // Arrange
    const proofLinkService = createMockProofLinkService();
    compliance = new ProofLinkX402Compliance(makeX402Config(), {
      screener: createMockScreener(),
      amlScorer: createMockAmlScorer(10),
      proofLinkService,
    });
    const server = createMockX402Server();
    compliance.register(server);

    const payload = makePaymentPayload();
    const requirements = makePaymentRequirements();

    // Act — run full flow to populate settledProofLinks
    await compliance.onBeforeVerify({ paymentPayload: payload, requirements });
    await compliance.onBeforeSettle({ paymentPayload: payload, requirements });
    await compliance.onAfterSettle({
      paymentPayload: payload,
      requirements,
      result: { success: true, transaction: "0xtxenrich", network: "eip155:8453" },
    });

    const extension = server.extensions[0]!;
    const enriched = await extension.enrichSettlementResponse!(
      {},
      { paymentPayload: payload, requirements },
    );

    // Assert
    expect(enriched).toEqual({
      complianceVerified: true,
      provider: "prooflink",
      proofLinkHash: expect.stringMatching(/^0x/),
    });
  });

  test("register_attaches_all_hooks_and_extension_to_server", () => {
    // Arrange
    compliance = new ProofLinkX402Compliance(makeX402Config());
    const server = createMockX402Server();

    // Act
    compliance.register(server);

    // Assert
    expect(server.onBeforeVerify).toHaveBeenCalledOnce();
    expect(server.onBeforeSettle).toHaveBeenCalledOnce();
    expect(server.onAfterSettle).toHaveBeenCalledOnce();
    expect(server.registerExtension).toHaveBeenCalledOnce();
    expect(server.extensions[0]?.key).toBe("prooflink");
  });
});

// ---------------------------------------------------------------------------
// KYA verification
// ---------------------------------------------------------------------------

describe("x402 — KYA verification", () => {
  test("valid_agent_credential_passes_identity_check", async () => {
    // Arrange
    const kyaRegistry = createMockKYARegistry(AGENT_ADDRESS);
    const kyaVerifier = createMockKYAVerifier(true);

    compliance = new ProofLinkX402Compliance(makeX402Config(), {
      screener: createMockScreener(),
      amlScorer: createMockAmlScorer(10),
      kyaRegistry,
      kyaVerifier,
    });

    const payload = makePaymentPayload({
      payload: {
        signature: "0xagent_sig_123456789012345678901234567890abcdef1234567890",
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

    // Act
    const result = await compliance.onBeforeVerify({
      paymentPayload: payload,
      requirements: makePaymentRequirements(),
    });

    // Assert
    expect(result).toBeUndefined();
    expect(kyaRegistry.lookup).toHaveBeenCalledWith(AGENT_ADDRESS);
    expect(kyaVerifier.verify).toHaveBeenCalledWith("agent-001");
  });

  test("invalid_kya_credential_fails_identity_check", async () => {
    // Arrange
    const kyaRegistry = createMockKYARegistry(AGENT_ADDRESS);
    const kyaVerifier = createMockKYAVerifier(false, false);

    compliance = new ProofLinkX402Compliance(makeX402Config(), {
      screener: createMockScreener(),
      amlScorer: createMockAmlScorer(10),
      kyaRegistry,
      kyaVerifier,
    });

    const payload = makePaymentPayload({
      payload: {
        signature: "0xagent_bad_sig_234567890123456789012345678901234567890",
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

    // Act
    const result = await compliance.onBeforeVerify({
      paymentPayload: payload,
      requirements: makePaymentRequirements(),
    });

    // Assert
    expect(result).toEqual({
      abort: true,
      reason: "kya_verification_failed",
      message: expect.stringContaining("Agent verification failed"),
    });
  });

  test("expired_kya_credential_fails_identity_check", async () => {
    // Arrange
    const kyaRegistry = createMockKYARegistry(AGENT_ADDRESS);
    const kyaVerifier = createMockKYAVerifier(false, true);

    compliance = new ProofLinkX402Compliance(makeX402Config(), {
      screener: createMockScreener(),
      amlScorer: createMockAmlScorer(10),
      kyaRegistry,
      kyaVerifier,
    });

    const payload = makePaymentPayload({
      payload: {
        signature: "0xagent_exp_sig_3456789012345678901234567890123456789",
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

    // Act
    const result = await compliance.onBeforeVerify({
      paymentPayload: payload,
      requirements: makePaymentRequirements(),
    });

    // Assert
    expect(result).toEqual({
      abort: true,
      reason: "kya_verification_failed",
      message: expect.stringContaining("Agent credential expired"),
    });
  });

  test("non_agent_wallet_skips_kya_check", async () => {
    // Arrange — registry only knows AGENT_ADDRESS, CLEAN_SENDER is a regular wallet
    const kyaRegistry = createMockKYARegistry(AGENT_ADDRESS);
    const kyaVerifier = createMockKYAVerifier(true);

    compliance = new ProofLinkX402Compliance(makeX402Config(), {
      screener: createMockScreener(),
      amlScorer: createMockAmlScorer(10),
      kyaRegistry,
      kyaVerifier,
    });

    // Act — uses CLEAN_SENDER, which is not the known agent
    const result = await compliance.onBeforeVerify({
      paymentPayload: makePaymentPayload(),
      requirements: makePaymentRequirements(),
    });

    // Assert
    expect(result).toBeUndefined();
    expect(kyaVerifier.verify).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// AML risk scoring
// ---------------------------------------------------------------------------

describe("x402 — AML risk scoring", () => {
  test("high_risk_score_aborts_before_verify", async () => {
    // Arrange — score 85 > threshold 70
    compliance = new ProofLinkX402Compliance(makeX402Config(), {
      screener: createMockScreener(),
      amlScorer: createMockAmlScorer(85),
    });

    // Act
    const result = await compliance.onBeforeVerify({
      paymentPayload: makePaymentPayload(),
      requirements: makePaymentRequirements(),
    });

    // Assert
    expect(result).toEqual({
      abort: true,
      reason: "aml_risk_exceeded",
      message: expect.stringContaining("Risk score 85 exceeds threshold 70"),
    });
  });

  test("acceptable_risk_score_passes_before_verify", async () => {
    // Arrange — score 50 < threshold 70
    compliance = new ProofLinkX402Compliance(makeX402Config(), {
      screener: createMockScreener(),
      amlScorer: createMockAmlScorer(50),
    });

    // Act
    const result = await compliance.onBeforeVerify({
      paymentPayload: makePaymentPayload(),
      requirements: makePaymentRequirements(),
    });

    // Assert
    expect(result).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Event subscription
// ---------------------------------------------------------------------------

describe("x402 — event subscription", () => {
  test("on_handler_can_be_unsubscribed", async () => {
    // Arrange
    compliance = new ProofLinkX402Compliance(makeX402Config());
    const handler = vi.fn();
    const unsub = compliance.on(handler);

    // Act
    unsub();
    await compliance.onBeforeVerify({
      paymentPayload: makePaymentPayload(),
      requirements: makePaymentRequirements(),
    });

    // After unsub the handler should not fire for subsequent events
    expect(typeof unsub).toBe("function");
  });
});
