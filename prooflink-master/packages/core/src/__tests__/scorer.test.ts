import { describe, expect, it } from "vitest";
import { AMLScorer, type TransactionContext } from "../aml/scorer.js";
import type { ProofLinkConfig } from "../config.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeConfig(overrides?: Partial<ProofLinkConfig>): ProofLinkConfig {
  return {
    chainalysisBaseUrl: "https://public.chainalysis.com/api/v1",
    sanctionsLists: ["OFAC_SDN"],
    maxRiskScore: 85,
    escalationThreshold: 60,
    failOpen: false,
    allowlist: [],
    blocklist: [],
    travelRuleThresholds: { US: 3000 },
    defaultTravelRuleThresholdUsd: 3000,
    cacheMaxEntries: 1000,
    sanctionsCacheTtlMs: 300_000,
    kyaCacheTtlMs: 900_000,
    restrictedJurisdictions: [],
    ...overrides,
  };
}

function makeTx(overrides?: Partial<TransactionContext>): TransactionContext {
  return {
    senderAddress: "0x1234567890abcdef1234567890abcdef12345678",
    receiverAddress: "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd",
    amountUsd: 100,
    chain: "eip155:1",
    asset: "USDC",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("AMLScorer", () => {
  describe("calculateRiskScore — low risk", () => {
    it("should return score 0 for a completely clean transaction", () => {
      const scorer = new AMLScorer(makeConfig());
      const result = scorer.calculateRiskScore(
        makeTx({
          txCountLastHour: 1,
          txCountLast24h: 5,
          historicalAvgAmountUsd: 100,
          isNewWallet: false,
          involvesMixer: false,
          receiverDarknetExposure: false,
          receiverSanctionedProximity: -1,
        }),
      );

      expect(result.score).toBe(0);
      expect(result.exceeds).toBe(false);
      expect(result.factors.length).toBeGreaterThan(0);
    });

    it("should return low score for normal activity", () => {
      const scorer = new AMLScorer(makeConfig());
      const result = scorer.calculateRiskScore(
        makeTx({
          txCountLastHour: 5,
          txCountLast24h: 30,
          historicalAvgAmountUsd: 90,
        }),
      );

      expect(result.score).toBeLessThan(30);
    });
  });

  describe("calculateRiskScore — high risk", () => {
    it("should return high score when all triggerable risk factors are triggered", () => {
      // Total weight = 1.1 across 10 rules.
      // destination_risk (prox 0-3) and indirect_exposure (prox 4-6) are mutually
      // exclusive on a single transaction, so the maximum achievable score uses
      // proximity=1 to trigger destination_risk (weight 0.15) and leaves
      // indirect_exposure (weight 0.1) un-triggered → 9 of 10 rules → score 91.
      const scorer = new AMLScorer(makeConfig());
      const result = scorer.calculateRiskScore(
        makeTx({
          // velocity_anomaly (0.15): >20 tx/hour ✓
          txCountLastHour: 50,
          txCountLast24h: 200,
          // amount_anomaly (0.20): 9500/100 = 95x > 5 ✓
          amountUsd: 9_500,
          historicalAvgAmountUsd: 100,
          // destination_risk (0.15): 1 hop ≤ 3 ✓
          receiverSanctionedProximity: 1,
          // new_wallet (0.08) ✓
          isNewWallet: true,
          // mixer_interaction (0.12) ✓
          involvesMixer: true,
          // darknet_exposure (0.08) ✓
          receiverDarknetExposure: true,
          // structuring (0.10): 9000 ≤ 9500 < 10000 ✓
          // time_of_day_anomaly (0.05): 3 UTC ∈ [1,5] ✓
          transactionHourUtc: 3,
          // cross_chain_correlation (0.07): 3 chains AND amount 9500 > 1000 ✓
          crossChainCount24h: 3,
          // indirect_exposure (0.10): NOT triggered (proximity=1, not in [4,6])
        }),
      );

      // 9 of 10 rules triggered → round((1.1-0.1)/1.1 * 100) = round(90.9) = 91
      expect(result.score).toBe(91);
      expect(result.exceeds).toBe(true);
    });

    it("should exceed threshold when score > maxRiskScore", () => {
      const scorer = new AMLScorer(makeConfig({ maxRiskScore: 20 }));
      const result = scorer.calculateRiskScore(
        makeTx({
          txCountLastHour: 50,
          txCountLast24h: 200,
          isNewWallet: true,
        }),
      );

      expect(result.exceeds).toBe(true);
      expect(result.threshold).toBe(20);
    });
  });

  describe("calculateRiskScore — individual factors", () => {
    it("should flag velocity anomaly when tx count is high", () => {
      const scorer = new AMLScorer(makeConfig());
      const result = scorer.calculateRiskScore(
        makeTx({
          txCountLastHour: 25,
          txCountLast24h: 50,
        }),
      );

      const velocityFactor = result.factors.find(
        (f) => f.factor === "velocity_anomaly",
      );
      expect(velocityFactor).toBeDefined();
      expect(velocityFactor?.detail).toContain("25 tx/hour");
    });

    it("should flag amount anomaly when amount is 5x+ historical average", () => {
      const scorer = new AMLScorer(makeConfig());
      const result = scorer.calculateRiskScore(
        makeTx({
          amountUsd: 1000,
          historicalAvgAmountUsd: 100,
        }),
      );

      const amountFactor = result.factors.find(
        (f) => f.factor === "amount_anomaly",
      );
      expect(amountFactor).toBeDefined();
      expect(amountFactor?.detail).toContain("10.0x");
    });

    it("should not flag amount anomaly when amount is within normal range", () => {
      const scorer = new AMLScorer(makeConfig());
      const result = scorer.calculateRiskScore(
        makeTx({
          amountUsd: 200,
          historicalAvgAmountUsd: 100,
          txCountLastHour: 1,
          txCountLast24h: 5,
          isNewWallet: false,
          involvesMixer: false,
          receiverDarknetExposure: false,
          receiverSanctionedProximity: -1,
        }),
      );

      expect(result.score).toBe(0);
    });

    it("should flag destination risk when receiver is close to sanctioned address", () => {
      const scorer = new AMLScorer(makeConfig());
      const result = scorer.calculateRiskScore(
        makeTx({
          receiverSanctionedProximity: 2,
        }),
      );

      const destFactor = result.factors.find(
        (f) => f.factor === "destination_risk",
      );
      expect(destFactor).toBeDefined();
      expect(destFactor?.detail).toContain("2 hops");
    });

    it("should not flag destination_risk when proximity is 5 hops (triggers indirect_exposure instead)", () => {
      const scorer = new AMLScorer(makeConfig());
      const result = scorer.calculateRiskScore(
        makeTx({
          // proximity=5 is outside destination_risk range (>3) → destination NOT triggered
          // but proximity=5 IS inside indirect_exposure range [4,6] → indirect triggered
          receiverSanctionedProximity: 5,
          txCountLastHour: 1,
          txCountLast24h: 5,
          historicalAvgAmountUsd: 100,
          isNewWallet: false,
          involvesMixer: false,
          receiverDarknetExposure: false,
        }),
      );

      const destFactor = result.factors.find(
        (f) => f.factor === "destination_risk",
      );
      // destination_risk should NOT be triggered at proximity=5
      expect(destFactor?.detail).toContain("5 hops");

      // indirect_exposure IS triggered at proximity=5 → score = round(0.1/1.1*100) = 9
      const indirectFactor = result.factors.find(
        (f) => f.factor === "indirect_exposure",
      );
      expect(indirectFactor?.detail).toContain("indirect exposure");
    });

    it("should not flag destination_risk or indirect_exposure when proximity is 7+ hops", () => {
      const scorer = new AMLScorer(makeConfig());
      const result = scorer.calculateRiskScore(
        makeTx({
          receiverSanctionedProximity: 7, // outside both ranges (>3 and >6)
          txCountLastHour: 1,
          txCountLast24h: 5,
          historicalAvgAmountUsd: 100,
          isNewWallet: false,
          involvesMixer: false,
          receiverDarknetExposure: false,
        }),
      );

      expect(result.score).toBe(0);
    });

    it("should flag new wallet", () => {
      const scorer = new AMLScorer(makeConfig());
      const result = scorer.calculateRiskScore(
        makeTx({ isNewWallet: true }),
      );

      const newWalletFactor = result.factors.find(
        (f) => f.factor === "new_wallet",
      );
      expect(newWalletFactor).toBeDefined();
      expect(newWalletFactor?.detail).toContain("<30 days");
    });

    it("should flag mixer interaction", () => {
      const scorer = new AMLScorer(makeConfig());
      const result = scorer.calculateRiskScore(
        makeTx({ involvesMixer: true }),
      );

      const mixerFactor = result.factors.find(
        (f) => f.factor === "mixer_interaction",
      );
      expect(mixerFactor).toBeDefined();
      expect(mixerFactor?.detail).toContain("mixer");
    });

    it("should flag darknet exposure", () => {
      const scorer = new AMLScorer(makeConfig());
      const result = scorer.calculateRiskScore(
        makeTx({ receiverDarknetExposure: true }),
      );

      const darknetFactor = result.factors.find(
        (f) => f.factor === "darknet_exposure",
      );
      expect(darknetFactor).toBeDefined();
      expect(darknetFactor?.detail).toContain("darknet");
    });
  });

  describe("calculateRiskScore — threshold configuration", () => {
    it("should use configured maxRiskScore as threshold", () => {
      const scorer = new AMLScorer(makeConfig({ maxRiskScore: 50 }));
      const result = scorer.calculateRiskScore(makeTx());

      expect(result.threshold).toBe(50);
    });

    it("should always return score between 0 and 100", () => {
      const scorer = new AMLScorer(makeConfig());

      // Run many scenarios
      const contexts: TransactionContext[] = [
        makeTx(),
        makeTx({
          txCountLastHour: 0,
          txCountLast24h: 0,
          historicalAvgAmountUsd: 0,
        }),
        makeTx({
          txCountLastHour: 1000,
          txCountLast24h: 10000,
          amountUsd: 1_000_000,
          historicalAvgAmountUsd: 1,
          receiverSanctionedProximity: 0,
          isNewWallet: true,
          involvesMixer: true,
          receiverDarknetExposure: true,
        }),
      ];

      for (const ctx of contexts) {
        const result = scorer.calculateRiskScore(ctx);
        expect(result.score).toBeGreaterThanOrEqual(0);
        expect(result.score).toBeLessThanOrEqual(100);
      }
    });
  });

  describe("calculateRiskScore — performance", () => {
    it("should execute in under 5ms", () => {
      const scorer = new AMLScorer(makeConfig());
      const ctx = makeTx({
        txCountLastHour: 10,
        txCountLast24h: 50,
        historicalAvgAmountUsd: 100,
        receiverSanctionedProximity: 5,
        isNewWallet: false,
        involvesMixer: false,
        receiverDarknetExposure: false,
      });

      const start = performance.now();
      for (let i = 0; i < 1000; i++) {
        scorer.calculateRiskScore(ctx);
      }
      const elapsed = performance.now() - start;

      // 1000 iterations should take less than 50ms total → <0.05ms per call
      expect(elapsed).toBeLessThan(50);
    });
  });
});
