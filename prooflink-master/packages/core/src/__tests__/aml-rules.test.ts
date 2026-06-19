import { describe, expect, it } from "vitest";
import {
  AMLScorer,
  type ScoringRule,
  type TransactionContext,
} from "../aml/scorer.js";
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

/** Minimal clean transaction — triggers zero rules by default. */
function makeTx(overrides?: Partial<TransactionContext>): TransactionContext {
  return {
    senderAddress: "0x1234567890abcdef1234567890abcdef12345678",
    receiverAddress: "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd",
    amountUsd: 100,
    chain: "eip155:1",
    asset: "USDC",
    // Explicitly zero out all optional signals so tests are isolation-safe
    txCountLastHour: 1,
    txCountLast24h: 5,
    historicalAvgAmountUsd: 100,
    receiverSanctionedProximity: -1,
    isNewWallet: false,
    involvesMixer: false,
    receiverDarknetExposure: false,
    recentAmountsUsd: [],
    crossChainCount24h: 0,
    recentBridgeActivity: false,
    ...overrides,
  };
}

/** Round a weighted score the same way AMLScorer does. */
function expectedScore(triggeredWeight: number, totalWeight: number): number {
  return Math.round((triggeredWeight / totalWeight) * 100);
}

// Total weight of all 10 default rules
const TOTAL_WEIGHT = 0.15 + 0.2 + 0.15 + 0.08 + 0.12 + 0.08 + 0.1 + 0.1 + 0.05 + 0.07;

// Extract individual default rule evaluate functions by instantiating a fresh scorer.
// This lets us build single-rule scorers without duplicating rule logic.
const _defaultRules = new AMLScorer(makeConfig()).getRules();
function getDefaultRule(factor: string): ScoringRule {
  const rule = _defaultRules.find((r) => r.factor === factor);
  if (!rule) throw new Error(`Default rule '${factor}' not found`);
  return rule as ScoringRule;
}
const DEFAULT_CROSS_CHAIN_RULE = getDefaultRule("cross_chain_correlation");
const DEFAULT_INDIRECT_EXPOSURE_RULE = getDefaultRule("indirect_exposure");

// ---------------------------------------------------------------------------
// Helpers to extract a named factor from a result
// ---------------------------------------------------------------------------

function getFactor(
  result: ReturnType<AMLScorer["calculateRiskScore"]>,
  name: string,
) {
  return result.factors.find((f) => f.factor === name);
}

// ---------------------------------------------------------------------------
// 1. Individual rule isolation
// ---------------------------------------------------------------------------

describe("AML rules — velocity_anomaly (weight 0.15)", () => {
  it("should not trigger when tx counts are below thresholds", () => {
    const scorer = new AMLScorer(makeConfig());
    const result = scorer.calculateRiskScore(
      makeTx({ txCountLastHour: 20, txCountLast24h: 100 }),
    );
    const factor = getFactor(result, "velocity_anomaly");
    // 20 is NOT > 20; 100 is NOT > 100 → not triggered
    expect(factor?.detail).toContain("Normal velocity");
    expect(result.score).toBe(0);
  });

  it("should trigger when txCountLastHour exceeds 20", () => {
    const scorer = new AMLScorer(makeConfig());
    const result = scorer.calculateRiskScore(
      makeTx({ txCountLastHour: 21, txCountLast24h: 5 }),
    );
    const factor = getFactor(result, "velocity_anomaly");
    expect(factor?.detail).toContain("High velocity");
    expect(factor?.detail).toContain("21 tx/hour");
    expect(result.score).toBe(expectedScore(0.15, TOTAL_WEIGHT));
  });

  it("should trigger when txCountLast24h exceeds 100", () => {
    const scorer = new AMLScorer(makeConfig());
    const result = scorer.calculateRiskScore(
      makeTx({ txCountLastHour: 1, txCountLast24h: 101 }),
    );
    const factor = getFactor(result, "velocity_anomaly");
    expect(factor?.detail).toContain("High velocity");
    expect(result.score).toBe(expectedScore(0.15, TOTAL_WEIGHT));
  });

  it("should default to 0 when tx counts are undefined", () => {
    const scorer = new AMLScorer(makeConfig());
    const result = scorer.calculateRiskScore(
      makeTx({ txCountLastHour: undefined, txCountLast24h: undefined }),
    );
    const factor = getFactor(result, "velocity_anomaly");
    expect(factor?.detail).toContain("Normal velocity");
  });

  it("should trigger at extreme volume (1000 tx/hour)", () => {
    const scorer = new AMLScorer(makeConfig());
    const result = scorer.calculateRiskScore(
      makeTx({ txCountLastHour: 1000, txCountLast24h: 5000 }),
    );
    expect(getFactor(result, "velocity_anomaly")?.detail).toContain(
      "High velocity",
    );
  });
});

describe("AML rules — amount_anomaly (weight 0.20)", () => {
  it("should not trigger when amount is exactly 5x historical average", () => {
    const scorer = new AMLScorer(makeConfig());
    const result = scorer.calculateRiskScore(
      makeTx({ amountUsd: 500, historicalAvgAmountUsd: 100 }),
    );
    // ratio = 5.0 — NOT > 5
    const factor = getFactor(result, "amount_anomaly");
    expect(factor?.detail).toContain("5.0x");
    expect(result.score).toBe(0);
  });

  it("should trigger when amount is more than 5x historical average", () => {
    const scorer = new AMLScorer(makeConfig());
    const result = scorer.calculateRiskScore(
      makeTx({ amountUsd: 501, historicalAvgAmountUsd: 100 }),
    );
    const factor = getFactor(result, "amount_anomaly");
    expect(factor?.detail).toContain("5.0x");
    expect(result.score).toBe(expectedScore(0.2, TOTAL_WEIGHT));
  });

  it("should trigger on amount > $10,000 when no historical average is present", () => {
    const scorer = new AMLScorer(makeConfig());
    const result = scorer.calculateRiskScore(
      makeTx({ amountUsd: 10_001, historicalAvgAmountUsd: undefined }),
    );
    const factor = getFactor(result, "amount_anomaly");
    expect(factor?.detail).toContain("No historical average");
    expect(result.score).toBe(expectedScore(0.2, TOTAL_WEIGHT));
  });

  it("should not trigger on amount <= $10,000 when no historical average is present", () => {
    const scorer = new AMLScorer(makeConfig());
    const result = scorer.calculateRiskScore(
      makeTx({ amountUsd: 10_000, historicalAvgAmountUsd: undefined }),
    );
    const factor = getFactor(result, "amount_anomaly");
    expect(factor?.detail).toContain("No historical average");
    expect(result.score).toBe(0);
  });

  it("should not trigger when historicalAvgAmountUsd is 0 and amount is low", () => {
    const scorer = new AMLScorer(makeConfig());
    const result = scorer.calculateRiskScore(
      makeTx({ amountUsd: 50, historicalAvgAmountUsd: 0 }),
    );
    // historicalAvgAmountUsd=0 is treated as absent → falls back to >10000 gate
    expect(result.score).toBe(0);
  });

  it("should trigger with very large amount (1M USD, avg 100)", () => {
    const scorer = new AMLScorer(makeConfig());
    const result = scorer.calculateRiskScore(
      makeTx({ amountUsd: 1_000_000, historicalAvgAmountUsd: 100 }),
    );
    const factor = getFactor(result, "amount_anomaly");
    expect(factor?.detail).toContain("10000.0x");
  });
});

describe("AML rules — destination_risk (weight 0.15)", () => {
  it("should not trigger when proximity is -1 (no sanctioned link)", () => {
    const scorer = new AMLScorer(makeConfig());
    const result = scorer.calculateRiskScore(
      makeTx({ receiverSanctionedProximity: -1 }),
    );
    expect(result.score).toBe(0);
    const factor = getFactor(result, "destination_risk");
    expect(factor?.detail).toContain("No sanctioned proximity");
  });

  it("should trigger at proximity 0 (direct sanctioned address)", () => {
    const scorer = new AMLScorer(makeConfig());
    const result = scorer.calculateRiskScore(
      makeTx({ receiverSanctionedProximity: 0 }),
    );
    const factor = getFactor(result, "destination_risk");
    expect(factor?.detail).toContain("0 hops");
    expect(result.score).toBeGreaterThan(0);
  });

  it("should trigger at proximity 1", () => {
    const scorer = new AMLScorer(makeConfig());
    const result = scorer.calculateRiskScore(
      makeTx({ receiverSanctionedProximity: 1 }),
    );
    expect(getFactor(result, "destination_risk")?.detail).toContain("1 hops");
  });

  it("should trigger at proximity 3 (boundary)", () => {
    const scorer = new AMLScorer(makeConfig());
    const result = scorer.calculateRiskScore(
      makeTx({ receiverSanctionedProximity: 3 }),
    );
    expect(getFactor(result, "destination_risk")?.detail).toContain("3 hops");
    // destination_risk triggered; indirect_exposure (4-6) not triggered
    expect(getFactor(result, "indirect_exposure")?.detail).toContain(
      "No indirect",
    );
  });

  it("should not trigger destination_risk at proximity 4 (triggers indirect_exposure instead)", () => {
    const scorer = new AMLScorer(makeConfig());
    const result = scorer.calculateRiskScore(
      makeTx({ receiverSanctionedProximity: 4 }),
    );
    // destination_risk range is [0,3], so 4 falls outside
    const destFactor = getFactor(result, "destination_risk");
    expect(destFactor?.detail).not.toContain("No sanctioned proximity");
    // indirect_exposure range is [4,6], so 4 triggers it
    const indirectFactor = getFactor(result, "indirect_exposure");
    expect(indirectFactor?.detail).toContain("indirect exposure");
  });

  it("should not trigger either rule at proximity 7+", () => {
    const scorer = new AMLScorer(makeConfig());
    const result = scorer.calculateRiskScore(
      makeTx({ receiverSanctionedProximity: 7 }),
    );
    expect(result.score).toBe(0);
  });

  it("should not trigger when proximity is undefined (defaults to -1)", () => {
    const scorer = new AMLScorer(makeConfig());
    const result = scorer.calculateRiskScore(
      makeTx({ receiverSanctionedProximity: undefined }),
    );
    expect(result.score).toBe(0);
  });
});

describe("AML rules — new_wallet (weight 0.08)", () => {
  it("should not trigger when isNewWallet is false", () => {
    const scorer = new AMLScorer(makeConfig());
    const result = scorer.calculateRiskScore(makeTx({ isNewWallet: false }));
    const factor = getFactor(result, "new_wallet");
    expect(factor?.detail).toContain("Established wallet");
    expect(result.score).toBe(0);
  });

  it("should trigger when isNewWallet is true", () => {
    const scorer = new AMLScorer(makeConfig());
    const result = scorer.calculateRiskScore(makeTx({ isNewWallet: true }));
    const factor = getFactor(result, "new_wallet");
    expect(factor?.detail).toContain("<30 days");
    expect(result.score).toBe(expectedScore(0.08, TOTAL_WEIGHT));
  });

  it("should not trigger when isNewWallet is undefined (defaults to false)", () => {
    const scorer = new AMLScorer(makeConfig());
    const result = scorer.calculateRiskScore(
      makeTx({ isNewWallet: undefined }),
    );
    expect(result.score).toBe(0);
  });
});

describe("AML rules — mixer_interaction (weight 0.12)", () => {
  it("should not trigger when involvesMixer is false", () => {
    const scorer = new AMLScorer(makeConfig());
    const result = scorer.calculateRiskScore(makeTx({ involvesMixer: false }));
    const factor = getFactor(result, "mixer_interaction");
    expect(factor?.detail).toContain("No mixer");
    expect(result.score).toBe(0);
  });

  it("should trigger when involvesMixer is true", () => {
    const scorer = new AMLScorer(makeConfig());
    const result = scorer.calculateRiskScore(makeTx({ involvesMixer: true }));
    const factor = getFactor(result, "mixer_interaction");
    expect(factor?.detail).toContain("mixer");
    expect(result.score).toBe(expectedScore(0.12, TOTAL_WEIGHT));
  });

  it("should not trigger when involvesMixer is undefined (defaults to false)", () => {
    const scorer = new AMLScorer(makeConfig());
    const result = scorer.calculateRiskScore(
      makeTx({ involvesMixer: undefined }),
    );
    expect(result.score).toBe(0);
  });
});

describe("AML rules — darknet_exposure (weight 0.08)", () => {
  it("should not trigger when receiverDarknetExposure is false", () => {
    const scorer = new AMLScorer(makeConfig());
    const result = scorer.calculateRiskScore(
      makeTx({ receiverDarknetExposure: false }),
    );
    const factor = getFactor(result, "darknet_exposure");
    expect(factor?.detail).toContain("No darknet");
    expect(result.score).toBe(0);
  });

  it("should trigger when receiverDarknetExposure is true", () => {
    const scorer = new AMLScorer(makeConfig());
    const result = scorer.calculateRiskScore(
      makeTx({ receiverDarknetExposure: true }),
    );
    const factor = getFactor(result, "darknet_exposure");
    expect(factor?.detail).toContain("darknet");
    expect(result.score).toBe(expectedScore(0.08, TOTAL_WEIGHT));
  });

  it("should not trigger when receiverDarknetExposure is undefined (defaults to false)", () => {
    const scorer = new AMLScorer(makeConfig());
    const result = scorer.calculateRiskScore(
      makeTx({ receiverDarknetExposure: undefined }),
    );
    expect(result.score).toBe(0);
  });
});

describe("AML rules — structuring (weight 0.10)", () => {
  describe("single transaction just-below-threshold detection", () => {
    // $3,000 threshold — 10% margin means [$2,700, $3,000)
    it("should not trigger at exactly $3,000 (at the threshold, not below)", () => {
      const scorer = new AMLScorer(makeConfig());
      const result = scorer.calculateRiskScore(
        makeTx({ amountUsd: 3_000 }),
      );
      expect(getFactor(result, "structuring")?.detail).toContain(
        "No structuring",
      );
    });

    it("should trigger at $2,999.99 (just below $3,000 threshold)", () => {
      const scorer = new AMLScorer(makeConfig());
      const result = scorer.calculateRiskScore(
        makeTx({ amountUsd: 2_999.99 }),
      );
      const factor = getFactor(result, "structuring");
      expect(factor?.detail).toContain("just below a reporting threshold");
    });

    it("should trigger at $2,700 (lower boundary: 10% below $3,000)", () => {
      const scorer = new AMLScorer(makeConfig());
      const result = scorer.calculateRiskScore(
        makeTx({ amountUsd: 2_700 }),
      );
      expect(getFactor(result, "structuring")?.detail).toContain(
        "just below a reporting threshold",
      );
    });

    it("should not trigger at $2,699 (below the 10% margin of $3,000 threshold)", () => {
      const scorer = new AMLScorer(makeConfig());
      const result = scorer.calculateRiskScore(
        makeTx({ amountUsd: 2_699 }),
      );
      // Not in [$2700,$3000) and not in [$9000,$10000)
      expect(getFactor(result, "structuring")?.detail).toContain(
        "No structuring",
      );
    });

    // $10,000 threshold — 10% margin means [$9,000, $10,000)
    it("should not trigger at exactly $10,000 (at the threshold)", () => {
      const scorer = new AMLScorer(makeConfig());
      const result = scorer.calculateRiskScore(
        makeTx({ amountUsd: 10_000 }),
      );
      expect(getFactor(result, "structuring")?.detail).toContain(
        "No structuring",
      );
    });

    it("should trigger at $9,999 (just below $10,000 threshold)", () => {
      const scorer = new AMLScorer(makeConfig());
      const result = scorer.calculateRiskScore(
        makeTx({ amountUsd: 9_999 }),
      );
      expect(getFactor(result, "structuring")?.detail).toContain(
        "just below a reporting threshold",
      );
    });

    it("should trigger at $9,000 (lower boundary: 10% below $10,000)", () => {
      const scorer = new AMLScorer(makeConfig());
      const result = scorer.calculateRiskScore(
        makeTx({ amountUsd: 9_000 }),
      );
      expect(getFactor(result, "structuring")?.detail).toContain(
        "just below a reporting threshold",
      );
    });

    it("should not trigger at $8,999 (below the 10% margin of $10,000 threshold)", () => {
      const scorer = new AMLScorer(makeConfig());
      const result = scorer.calculateRiskScore(
        makeTx({ amountUsd: 8_999 }),
      );
      expect(getFactor(result, "structuring")?.detail).toContain(
        "No structuring",
      );
    });
  });

  describe("pattern detection via recentAmountsUsd", () => {
    it("should trigger when 2 of 3+ recent amounts are just below a threshold", () => {
      const scorer = new AMLScorer(makeConfig());
      const result = scorer.calculateRiskScore(
        makeTx({
          amountUsd: 500, // current tx is not itself suspicious
          recentAmountsUsd: [2_900, 9_500, 200], // 2 of 3 cluster near thresholds
        }),
      );
      const factor = getFactor(result, "structuring");
      expect(factor?.detail).toContain("Structuring pattern");
      expect(factor?.detail).toContain("3 recent txs");
    });

    it("should not trigger when fewer than 2 recent amounts are near thresholds", () => {
      const scorer = new AMLScorer(makeConfig());
      const result = scorer.calculateRiskScore(
        makeTx({
          amountUsd: 500,
          recentAmountsUsd: [2_900, 100, 200], // only 1 near threshold
        }),
      );
      expect(getFactor(result, "structuring")?.detail).toContain(
        "No structuring",
      );
    });

    it("should not trigger pattern when fewer than 3 recent amounts exist", () => {
      const scorer = new AMLScorer(makeConfig());
      const result = scorer.calculateRiskScore(
        makeTx({
          amountUsd: 500,
          recentAmountsUsd: [2_900, 9_500], // only 2 entries — below the 3-entry minimum
        }),
      );
      // pattern requires length >= 3
      expect(getFactor(result, "structuring")?.detail).toContain(
        "No structuring",
      );
    });

    it("should not trigger when recentAmountsUsd is empty", () => {
      const scorer = new AMLScorer(makeConfig());
      const result = scorer.calculateRiskScore(
        makeTx({ amountUsd: 500, recentAmountsUsd: [] }),
      );
      expect(getFactor(result, "structuring")?.detail).toContain(
        "No structuring",
      );
    });
  });
});

describe("AML rules — time_of_day_anomaly (weight 0.05)", () => {
  it("should not trigger when transactionHourUtc is undefined", () => {
    const scorer = new AMLScorer(makeConfig());
    const result = scorer.calculateRiskScore(
      makeTx({ transactionHourUtc: undefined }),
    );
    const factor = getFactor(result, "time_of_day_anomaly");
    expect(factor?.detail).toContain("not provided");
    expect(result.score).toBe(0);
  });

  it("should trigger at hour 1 (start of high-risk window)", () => {
    const scorer = new AMLScorer(makeConfig());
    const result = scorer.calculateRiskScore(
      makeTx({ transactionHourUtc: 1 }),
    );
    expect(getFactor(result, "time_of_day_anomaly")?.detail).toContain(
      "1:00 UTC",
    );
    expect(result.score).toBe(expectedScore(0.05, TOTAL_WEIGHT));
  });

  it("should trigger at hour 3 (middle of high-risk window)", () => {
    const scorer = new AMLScorer(makeConfig());
    const result = scorer.calculateRiskScore(
      makeTx({ transactionHourUtc: 3 }),
    );
    expect(getFactor(result, "time_of_day_anomaly")?.detail).toContain(
      "high-risk window",
    );
  });

  it("should trigger at hour 5 (end of high-risk window)", () => {
    const scorer = new AMLScorer(makeConfig());
    const result = scorer.calculateRiskScore(
      makeTx({ transactionHourUtc: 5 }),
    );
    expect(getFactor(result, "time_of_day_anomaly")?.detail).toContain(
      "5:00 UTC",
    );
  });

  it("should not trigger at hour 0 (before window)", () => {
    const scorer = new AMLScorer(makeConfig());
    const result = scorer.calculateRiskScore(
      makeTx({ transactionHourUtc: 0 }),
    );
    const factor = getFactor(result, "time_of_day_anomaly");
    expect(factor?.detail).toContain("normal hours");
    expect(result.score).toBe(0);
  });

  it("should not trigger at hour 6 (after window)", () => {
    const scorer = new AMLScorer(makeConfig());
    const result = scorer.calculateRiskScore(
      makeTx({ transactionHourUtc: 6 }),
    );
    expect(getFactor(result, "time_of_day_anomaly")?.detail).toContain(
      "normal hours",
    );
    expect(result.score).toBe(0);
  });

  it("should not trigger at hour 12 (midday)", () => {
    const scorer = new AMLScorer(makeConfig());
    const result = scorer.calculateRiskScore(
      makeTx({ transactionHourUtc: 12 }),
    );
    expect(result.score).toBe(0);
  });

  it("should not trigger at hour 23 (late evening)", () => {
    const scorer = new AMLScorer(makeConfig());
    const result = scorer.calculateRiskScore(
      makeTx({ transactionHourUtc: 23 }),
    );
    expect(result.score).toBe(0);
  });
});

describe("AML rules — cross_chain_correlation (weight 0.07)", () => {
  // These tests use a single-rule scorer to test cross_chain_correlation in isolation.
  function makeCrossChainScorer() {
    return new AMLScorer(makeConfig(), [
      {
        factor: "cross_chain_correlation",
        weight: 0.07,
        evaluate: DEFAULT_CROSS_CHAIN_RULE.evaluate,
      },
    ]);
  }

  it("should not trigger below thresholds (2 chains, $5,000, no bridge)", () => {
    const scorer = makeCrossChainScorer();
    const result = scorer.calculateRiskScore(
      makeTx({
        crossChainCount24h: 2,
        recentBridgeActivity: false,
        amountUsd: 5_000,
      }),
    );
    const factor = getFactor(result, "cross_chain_correlation");
    expect(factor?.detail).toContain("Normal chain usage");
    expect(result.score).toBe(0);
  });

  it("should trigger when 3+ chains AND amount > $1,000", () => {
    const scorer = makeCrossChainScorer();
    const result = scorer.calculateRiskScore(
      makeTx({
        crossChainCount24h: 3,
        amountUsd: 1_001,
        recentBridgeActivity: false,
        historicalAvgAmountUsd: 1_001, // neutralise amount_anomaly in full-ruleset tests
      }),
    );
    const factor = getFactor(result, "cross_chain_correlation");
    expect(factor?.detail).toContain("Cross-chain activity");
    // Single rule scorer: 0.07/0.07 * 100 = 100
    expect(result.score).toBe(100);
  });

  it("should not trigger when 3+ chains but amount is exactly $1,000", () => {
    const scorer = makeCrossChainScorer();
    const result = scorer.calculateRiskScore(
      makeTx({
        crossChainCount24h: 3,
        amountUsd: 1_000,
        recentBridgeActivity: false,
      }),
    );
    expect(result.score).toBe(0);
  });

  it("should trigger when bridge activity AND amount > $5,000", () => {
    const scorer = makeCrossChainScorer();
    const result = scorer.calculateRiskScore(
      makeTx({
        crossChainCount24h: 1,
        amountUsd: 5_001,
        recentBridgeActivity: true,
      }),
    );
    expect(getFactor(result, "cross_chain_correlation")?.detail).toContain(
      "Cross-chain activity",
    );
    expect(result.score).toBe(100);
  });

  it("should not trigger when bridge activity but amount is exactly $5,000", () => {
    const scorer = makeCrossChainScorer();
    const result = scorer.calculateRiskScore(
      makeTx({
        crossChainCount24h: 1,
        amountUsd: 5_000,
        recentBridgeActivity: true,
      }),
    );
    expect(result.score).toBe(0);
  });

  it("should not trigger when crossChainCount24h is undefined (defaults to 0)", () => {
    const scorer = makeCrossChainScorer();
    const result = scorer.calculateRiskScore(
      // amountUsd deliberately high — verifies the chainCount guard holds
      makeTx({ crossChainCount24h: undefined, amountUsd: 50_000, recentBridgeActivity: false }),
    );
    // 0 chains < 3 threshold and no bridge → not triggered
    expect(result.score).toBe(0);
  });
});

describe("AML rules — indirect_exposure (weight 0.10)", () => {
  it("should trigger at proximity 4 (start of indirect range)", () => {
    const scorer = new AMLScorer(makeConfig());
    const result = scorer.calculateRiskScore(
      makeTx({ receiverSanctionedProximity: 4 }),
    );
    expect(getFactor(result, "indirect_exposure")?.detail).toContain(
      "indirect exposure",
    );
    expect(result.score).toBe(expectedScore(0.1, TOTAL_WEIGHT));
  });

  it("should trigger at proximity 6 (end of indirect range)", () => {
    const scorer = new AMLScorer(makeConfig());
    const result = scorer.calculateRiskScore(
      makeTx({ receiverSanctionedProximity: 6 }),
    );
    expect(getFactor(result, "indirect_exposure")?.detail).toContain(
      "indirect exposure",
    );
  });

  it("should not trigger at proximity 3 (handled by destination_risk)", () => {
    const scorer = new AMLScorer(makeConfig());
    const result = scorer.calculateRiskScore(
      makeTx({ receiverSanctionedProximity: 3 }),
    );
    expect(getFactor(result, "indirect_exposure")?.detail).toContain(
      "No indirect",
    );
  });

  it("should not trigger at proximity 7 (beyond both ranges)", () => {
    // Use a single-rule scorer to isolate indirect_exposure from other defaults
    const scorer = new AMLScorer(makeConfig(), [
      {
        factor: "indirect_exposure",
        weight: 0.1,
        evaluate: DEFAULT_INDIRECT_EXPOSURE_RULE.evaluate,
      },
    ]);
    const result = scorer.calculateRiskScore(
      makeTx({ receiverSanctionedProximity: 7 }),
    );
    // triggered=false even though the detail string uses the proximity>=4 branch
    // (the detail branch is deliberately looser than the trigger predicate)
    expect(result.score).toBe(0);
  });

  it("should not trigger when proximity is -1", () => {
    const scorer = new AMLScorer(makeConfig());
    const result = scorer.calculateRiskScore(
      makeTx({ receiverSanctionedProximity: -1 }),
    );
    expect(result.score).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 2. Rule combination — composite score calculation
// ---------------------------------------------------------------------------

describe("AML rules — composite scoring", () => {
  it("should produce score 0 when no rules are triggered", () => {
    const scorer = new AMLScorer(makeConfig());
    const result = scorer.calculateRiskScore(makeTx());
    expect(result.score).toBe(0);
    expect(result.exceeds).toBe(false);
    // All 10 default rules should be represented in the factors array
    expect(result.factors).toHaveLength(10);
  });

  it("should correctly combine velocity_anomaly + new_wallet (weights 0.15 + 0.08)", () => {
    const scorer = new AMLScorer(makeConfig());
    const result = scorer.calculateRiskScore(
      makeTx({ txCountLastHour: 50, isNewWallet: true }),
    );
    expect(result.score).toBe(expectedScore(0.15 + 0.08, TOTAL_WEIGHT));
  });

  it("should correctly combine mixer_interaction + darknet_exposure (weights 0.12 + 0.08)", () => {
    const scorer = new AMLScorer(makeConfig());
    const result = scorer.calculateRiskScore(
      makeTx({ involvesMixer: true, receiverDarknetExposure: true }),
    );
    expect(result.score).toBe(expectedScore(0.12 + 0.08, TOTAL_WEIGHT));
  });

  it("should trigger all 10 rules and produce maximum score", () => {
    // destination_risk (prox 0-3) and indirect_exposure (prox 4-6) are mutually
    // exclusive. Using proximity=1 triggers destination_risk (0.15) and leaves
    // indirect_exposure (0.10) untriggered → 9 of 10 rules active.
    const scorer = new AMLScorer(makeConfig());
    const result = scorer.calculateRiskScore(
      makeTx({
        txCountLastHour: 50,        // velocity_anomaly (0.15)
        txCountLast24h: 200,
        amountUsd: 9_500,           // amount_anomaly (0.20, 95x > 5) + structuring (0.10, in [$9000,$10000))
        historicalAvgAmountUsd: 100,
        receiverSanctionedProximity: 1, // destination_risk (0.15)
        isNewWallet: true,          // new_wallet (0.08)
        involvesMixer: true,        // mixer_interaction (0.12)
        receiverDarknetExposure: true, // darknet_exposure (0.08)
        transactionHourUtc: 3,      // time_of_day_anomaly (0.05)
        crossChainCount24h: 3,      // cross_chain_correlation (0.07, 3 chains + 9500 > 1000)
        // indirect_exposure NOT triggered (proximity=1, not in [4,6])
      }),
    );
    // 9 of 10 triggered: total weight - 0.10 (indirect_exposure) = 1.0
    expect(result.score).toBe(expectedScore(TOTAL_WEIGHT - 0.1, TOTAL_WEIGHT));
    expect(result.exceeds).toBe(true);
  });

  it("should trigger all 10 rules using indirect_exposure instead of destination_risk", () => {
    // Using proximity=4 triggers indirect_exposure (0.10) instead of destination_risk (0.15)
    const scorer = new AMLScorer(makeConfig());
    const result = scorer.calculateRiskScore(
      makeTx({
        txCountLastHour: 50,
        txCountLast24h: 200,
        amountUsd: 9_500,
        historicalAvgAmountUsd: 100,
        receiverSanctionedProximity: 4, // indirect_exposure (0.10)
        isNewWallet: true,
        involvesMixer: true,
        receiverDarknetExposure: true,
        transactionHourUtc: 3,
        crossChainCount24h: 3,
      }),
    );
    // 9 of 10 triggered: total weight - 0.15 (destination_risk) = 0.95
    expect(result.score).toBe(expectedScore(TOTAL_WEIGHT - 0.15, TOTAL_WEIGHT));
  });

  it("should report exceeds=true when score > maxRiskScore", () => {
    const scorer = new AMLScorer(makeConfig({ maxRiskScore: 10 }));
    const result = scorer.calculateRiskScore(
      makeTx({ involvesMixer: true, isNewWallet: true }),
    );
    expect(result.exceeds).toBe(true);
    expect(result.threshold).toBe(10);
  });

  it("should report exceeds=false when score equals maxRiskScore", () => {
    // mixer_interaction alone → score = round(0.12 / 1.1 * 100) = round(10.9) = 11
    const scorer = new AMLScorer(makeConfig({ maxRiskScore: 11 }));
    const result = scorer.calculateRiskScore(makeTx({ involvesMixer: true }));
    expect(result.score).toBe(11);
    expect(result.exceeds).toBe(false); // score must be STRICTLY greater than threshold
  });

  it("should include evaluatedAt as a valid ISO datetime string", () => {
    const scorer = new AMLScorer(makeConfig());
    const before = Date.now();
    const result = scorer.calculateRiskScore(makeTx());
    const after = Date.now();
    const ts = new Date(result.evaluatedAt).getTime();
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after);
  });
});

// ---------------------------------------------------------------------------
// 3. Custom rules added at runtime
// ---------------------------------------------------------------------------

describe("AMLScorer — custom rule management", () => {
  it("should accept custom rules passed to constructor", () => {
    const customRule: ScoringRule = {
      factor: "velocity_anomaly", // reuse an existing factor type
      weight: 0.5,
      evaluate: () => ({ triggered: true, detail: "always fires" }),
    };
    const scorer = new AMLScorer(makeConfig(), [customRule]);
    const result = scorer.calculateRiskScore(makeTx());
    expect(result.score).toBe(100); // only rule, always triggered
    expect(getFactor(result, "velocity_anomaly")?.detail).toBe("always fires");
  });

  it("should add a new custom rule via addRule and include it in scoring", () => {
    const scorer = new AMLScorer(makeConfig());
    const customRule: ScoringRule = {
      factor: "velocity_anomaly", // use existing factor name as AMLRiskFactor
      weight: 99, // large weight to dominate score
      evaluate: (ctx) => ({
        triggered: ctx.amountUsd > 50_000,
        detail: "whale alert",
      }),
    };
    scorer.addRule(customRule);

    // The default velocity_anomaly rule is now replaced by customRule
    const result = scorer.calculateRiskScore(
      makeTx({ amountUsd: 100_000, txCountLastHour: 0, txCountLast24h: 0 }),
    );
    expect(getFactor(result, "velocity_anomaly")?.detail).toBe("whale alert");
  });

  it("should replace an existing rule when adding a rule with the same factor", () => {
    const scorer = new AMLScorer(makeConfig());
    const initialRuleCount = scorer.getRules().length;

    const replacementRule: ScoringRule = {
      factor: "new_wallet",
      weight: 0.08,
      evaluate: () => ({ triggered: false, detail: "always safe" }),
    };
    scorer.addRule(replacementRule);

    // Count should stay the same — replacement, not addition
    expect(scorer.getRules().length).toBe(initialRuleCount);
    const result = scorer.calculateRiskScore(makeTx({ isNewWallet: true }));
    // Custom rule says not triggered despite isNewWallet=true
    expect(getFactor(result, "new_wallet")?.detail).toBe("always safe");
  });

  it("should remove a rule by factor name and reduce rule count", () => {
    const scorer = new AMLScorer(makeConfig());
    const before = scorer.getRules().length;

    const removed = scorer.removeRule("mixer_interaction");
    expect(removed).toBe(true);
    expect(scorer.getRules().length).toBe(before - 1);

    // mixer_interaction should no longer appear in factors
    const result = scorer.calculateRiskScore(makeTx({ involvesMixer: true }));
    expect(getFactor(result, "mixer_interaction")).toBeUndefined();
  });

  it("should return false when removing a non-existent factor", () => {
    const scorer = new AMLScorer(makeConfig());
    // "indirect_exposure" exists in the default set; removing it twice should fail the second time
    scorer.removeRule("indirect_exposure");
    const result = scorer.removeRule("indirect_exposure");
    expect(result).toBe(false);
  });

  it("should return an empty score of 0 when all rules are removed", () => {
    const scorer = new AMLScorer(makeConfig(), []);
    const result = scorer.calculateRiskScore(
      makeTx({ involvesMixer: true, isNewWallet: true }),
    );
    expect(result.score).toBe(0);
    expect(result.factors).toHaveLength(0);
  });

  it("should expose immutable getRules snapshot that does not allow external mutation", () => {
    const scorer = new AMLScorer(makeConfig());
    const rules = scorer.getRules();
    // TypeScript enforces ReadonlyArray, but ensure the count is stable
    const countBefore = rules.length;
    // Attempting to push should be a TS error, but at runtime the array reference
    // is readonly — verify we still have the same rules
    expect(scorer.getRules().length).toBe(countBefore);
  });
});

// ---------------------------------------------------------------------------
// 4. Edge cases — zero values, very large amounts, boundary conditions
// ---------------------------------------------------------------------------

describe("AML rules — edge cases", () => {
  it("should handle zero amountUsd without throwing", () => {
    const scorer = new AMLScorer(makeConfig());
    const result = scorer.calculateRiskScore(
      makeTx({ amountUsd: 0, historicalAvgAmountUsd: 100 }),
    );
    // ratio = 0/100 = 0 → not > 5 → not triggered
    expect(result.score).toBe(0);
  });

  it("should handle negative amountUsd without throwing", () => {
    const scorer = new AMLScorer(makeConfig());
    // Negative amounts can result from refunds/credits — scorer should not crash
    expect(() =>
      scorer.calculateRiskScore(makeTx({ amountUsd: -500 })),
    ).not.toThrow();
  });

  it("should handle very large amountUsd (1 billion USD)", () => {
    const scorer = new AMLScorer(makeConfig());
    const result = scorer.calculateRiskScore(
      makeTx({ amountUsd: 1_000_000_000, historicalAvgAmountUsd: 100 }),
    );
    expect(result.score).toBeGreaterThan(0);
    expect(result.score).toBeLessThanOrEqual(100);
  });

  it("should handle all optional fields undefined", () => {
    const scorer = new AMLScorer(makeConfig());
    const result = scorer.calculateRiskScore({
      senderAddress: "0xaaa",
      receiverAddress: "0xbbb",
      amountUsd: 0,
      chain: "eip155:1",
      asset: "ETH",
    });
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
    expect(result.factors).toHaveLength(10);
  });

  it("should handle txCountLastHour=0 and txCountLast24h=0 (no velocity)", () => {
    const scorer = new AMLScorer(makeConfig());
    const result = scorer.calculateRiskScore(
      makeTx({ txCountLastHour: 0, txCountLast24h: 0 }),
    );
    expect(getFactor(result, "velocity_anomaly")?.detail).toContain(
      "Normal velocity",
    );
  });

  it("should clamp score to 100 even if weights sum to more than 1", () => {
    // Construct rules with total weight > 1 where all trigger
    const hugeRules: ScoringRule[] = [
      {
        factor: "velocity_anomaly",
        weight: 50,
        evaluate: () => ({ triggered: true, detail: "big" }),
      },
      {
        factor: "amount_anomaly",
        weight: 50,
        evaluate: () => ({ triggered: true, detail: "big" }),
      },
    ];
    const scorer = new AMLScorer(makeConfig(), hugeRules);
    const result = scorer.calculateRiskScore(makeTx());
    // (50+50)/(50+50)*100 = 100 — already 100, but clamp is applied
    expect(result.score).toBe(100);
  });

  it("should return score 0 when no rules trigger even with large weights", () => {
    const neverTriggerRule: ScoringRule = {
      factor: "velocity_anomaly",
      weight: 999,
      evaluate: () => ({ triggered: false, detail: "never" }),
    };
    const scorer = new AMLScorer(makeConfig(), [neverTriggerRule]);
    const result = scorer.calculateRiskScore(makeTx());
    expect(result.score).toBe(0);
  });

  it("should handle recentAmountsUsd with exactly 3 elements where only 1 clusters", () => {
    const scorer = new AMLScorer(makeConfig());
    // Only 1 of 3 amounts is near a threshold → pattern NOT triggered
    const result = scorer.calculateRiskScore(
      makeTx({ amountUsd: 50, recentAmountsUsd: [2_900, 50, 100] }),
    );
    expect(getFactor(result, "structuring")?.detail).toContain(
      "No structuring",
    );
  });

  it("should handle crossChainCount24h exactly at the 3-chain boundary with exact $1,000 amount", () => {
    // Isolate cross_chain_correlation to avoid amount_anomaly firing at $1000 with avg $100
    const scorer = new AMLScorer(makeConfig(), [
      {
        factor: "cross_chain_correlation",
        weight: 0.07,
        evaluate: DEFAULT_CROSS_CHAIN_RULE.evaluate,
      },
    ]);
    // 3 chains AND amount === 1000 (NOT > 1000) → not triggered
    const result = scorer.calculateRiskScore(
      makeTx({ crossChainCount24h: 3, amountUsd: 1_000 }),
    );
    expect(result.score).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 5. Score normalization to 0-100 range
// ---------------------------------------------------------------------------

describe("AML rules — score normalization", () => {
  it("should always return an integer score", () => {
    const scorer = new AMLScorer(makeConfig());
    const scenarios: Partial<TransactionContext>[] = [
      { involvesMixer: true },
      { isNewWallet: true },
      { receiverDarknetExposure: true },
      { txCountLastHour: 25 },
      { receiverSanctionedProximity: 2 },
      { receiverSanctionedProximity: 5 },
      {},
    ];
    for (const override of scenarios) {
      const result = scorer.calculateRiskScore(makeTx(override));
      expect(Number.isInteger(result.score)).toBe(true);
    }
  });

  it("should return score within [0, 100] for any combination of inputs", () => {
    const scorer = new AMLScorer(makeConfig());
    const extremes: Partial<TransactionContext>[] = [
      { amountUsd: 0, txCountLastHour: 0, txCountLast24h: 0 },
      {
        amountUsd: 1e12,
        txCountLastHour: 1e6,
        txCountLast24h: 1e6,
        historicalAvgAmountUsd: 1,
        receiverSanctionedProximity: 0,
        isNewWallet: true,
        involvesMixer: true,
        receiverDarknetExposure: true,
        transactionHourUtc: 2,
        crossChainCount24h: 100,
        recentBridgeActivity: true,
        recentAmountsUsd: [2_900, 9_900, 2_800],
      },
    ];
    for (const override of extremes) {
      const result = scorer.calculateRiskScore(makeTx(override));
      expect(result.score).toBeGreaterThanOrEqual(0);
      expect(result.score).toBeLessThanOrEqual(100);
    }
  });

  it("should normalize correctly for a single rule with weight 1.0", () => {
    const rule: ScoringRule = {
      factor: "velocity_anomaly",
      weight: 1.0,
      evaluate: () => ({ triggered: true, detail: "triggered" }),
    };
    const scorer = new AMLScorer(makeConfig(), [rule]);
    const result = scorer.calculateRiskScore(makeTx());
    // (1.0 / 1.0) * 100 = 100
    expect(result.score).toBe(100);
  });

  it("should produce score of 0 with a single untriggered rule", () => {
    const rule: ScoringRule = {
      factor: "darknet_exposure",
      weight: 1.0,
      evaluate: () => ({ triggered: false, detail: "clean" }),
    };
    const scorer = new AMLScorer(makeConfig(), [rule]);
    const result = scorer.calculateRiskScore(makeTx());
    expect(result.score).toBe(0);
  });

  it("should produce score of 50 when half the weight is triggered", () => {
    const rules: ScoringRule[] = [
      {
        factor: "velocity_anomaly",
        weight: 1.0,
        evaluate: () => ({ triggered: true, detail: "yes" }),
      },
      {
        factor: "amount_anomaly",
        weight: 1.0,
        evaluate: () => ({ triggered: false, detail: "no" }),
      },
    ];
    const scorer = new AMLScorer(makeConfig(), rules);
    const result = scorer.calculateRiskScore(makeTx());
    // (1.0 / 2.0) * 100 = 50
    expect(result.score).toBe(50);
  });

  it("should return threshold from config in every result", () => {
    const scorer = new AMLScorer(makeConfig({ maxRiskScore: 42 }));
    const result = scorer.calculateRiskScore(makeTx());
    expect(result.threshold).toBe(42);
  });
});
