import type { AMLRiskFactor, AMLRiskScore } from "@prooflink/shared";
import type { ProofLinkConfig } from "../config.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Context about a transaction for AML risk scoring. */
export interface TransactionContext {
  /** Sender wallet address */
  senderAddress: string;
  /** Receiver wallet address */
  receiverAddress: string;
  /** Transaction amount in USD equivalent */
  amountUsd: number;
  /** CAIP-2 chain identifier */
  chain: string;
  /** Asset identifier (e.g., "USDC", "EURC") */
  asset: string;
  /** Number of transactions from sender in the last hour */
  txCountLastHour?: number;
  /** Number of transactions from sender in the last 24 hours */
  txCountLast24h?: number;
  /** Sender's 30-day average transaction amount in USD */
  historicalAvgAmountUsd?: number;
  /** Whether the receiver has any sanctioned-address proximity (within N hops) */
  receiverSanctionedProximity?: number;
  /** Whether the sender wallet is new (less than 30 days old) */
  isNewWallet?: boolean;
  /** Whether the transaction involves a known mixer */
  involvesMixer?: boolean;
  /** Whether the receiver has darknet exposure */
  receiverDarknetExposure?: boolean;
  /** Recent transaction amounts from this sender (for structuring detection) */
  recentAmountsUsd?: number[];
  /** Hour of day (0-23) in UTC for the transaction */
  transactionHourUtc?: number;
  /** Number of distinct chains the sender has transacted on in last 24h */
  crossChainCount24h?: number;
  /** Whether the sender has bridged assets in the last 24h */
  recentBridgeActivity?: boolean;
}

// ---------------------------------------------------------------------------
// Scoring rule interface (pluggable)
// ---------------------------------------------------------------------------

/** A single scoring rule that evaluates a risk factor. */
export interface ScoringRule {
  factor: AMLRiskFactor;
  weight: number;
  evaluate: (ctx: TransactionContext) => { triggered: boolean; detail: string };
}

// ---------------------------------------------------------------------------
// Default scoring rules
// ---------------------------------------------------------------------------

const DEFAULT_SCORING_RULES: ScoringRule[] = [
  {
    factor: "velocity_anomaly",
    weight: 0.15,
    evaluate: (ctx) => {
      const hourly = ctx.txCountLastHour ?? 0;
      const daily = ctx.txCountLast24h ?? 0;
      // Flag if >20 tx/hour or >100 tx/day
      const triggered = hourly > 20 || daily > 100;
      return {
        triggered,
        detail: triggered
          ? `High velocity: ${hourly} tx/hour, ${daily} tx/24h`
          : `Normal velocity: ${hourly} tx/hour, ${daily} tx/24h`,
      };
    },
  },
  {
    factor: "amount_anomaly",
    weight: 0.2,
    evaluate: (ctx) => {
      const avg = ctx.historicalAvgAmountUsd;
      if (!avg || avg === 0) {
        // No history — mild risk signal
        return {
          triggered: ctx.amountUsd > 10_000,
          detail: `No historical average; amount $${ctx.amountUsd.toFixed(2)}`,
        };
      }
      const ratio = ctx.amountUsd / avg;
      // Flag if amount is >5x the historical average
      const triggered = ratio > 5;
      return {
        triggered,
        detail: `Amount $${ctx.amountUsd.toFixed(2)} is ${ratio.toFixed(1)}x historical avg $${avg.toFixed(2)}`,
      };
    },
  },
  {
    factor: "destination_risk",
    weight: 0.15,
    evaluate: (ctx) => {
      const proximity = ctx.receiverSanctionedProximity ?? -1;
      // Flag if receiver is within 3 hops of a sanctioned address
      const triggered = proximity >= 0 && proximity <= 3;
      return {
        triggered,
        detail:
          proximity >= 0
            ? `Receiver ${proximity} hops from sanctioned address`
            : "No sanctioned proximity detected",
      };
    },
  },
  {
    factor: "new_wallet",
    weight: 0.08,
    evaluate: (ctx) => {
      const triggered = ctx.isNewWallet ?? false;
      return {
        triggered,
        detail: triggered ? "Sender wallet is <30 days old" : "Established wallet",
      };
    },
  },
  {
    factor: "mixer_interaction",
    weight: 0.12,
    evaluate: (ctx) => {
      const triggered = ctx.involvesMixer ?? false;
      return {
        triggered,
        detail: triggered
          ? "Transaction involves a known mixer"
          : "No mixer involvement detected",
      };
    },
  },
  {
    factor: "darknet_exposure",
    weight: 0.08,
    evaluate: (ctx) => {
      const triggered = ctx.receiverDarknetExposure ?? false;
      return {
        triggered,
        detail: triggered
          ? "Receiver has darknet exposure"
          : "No darknet exposure detected",
      };
    },
  },

  // ─── Indirect exposure (4-6 hops from sanctioned address) ──────────────
  {
    factor: "indirect_exposure",
    weight: 0.1,
    evaluate: (ctx) => {
      const proximity = ctx.receiverSanctionedProximity ?? -1;
      // Flag if receiver is 4-6 hops from a sanctioned address (indirect)
      const triggered = proximity >= 4 && proximity <= 6;
      return {
        triggered,
        detail:
          proximity >= 4
            ? `Receiver ${proximity} hops from sanctioned address (indirect exposure)`
            : "No indirect sanctioned exposure",
      };
    },
  },

  // ─── Structuring detection ────────────────────────────────────────────
  {
    factor: "structuring",
    weight: 0.1,
    evaluate: (ctx) => {
      // Detect transactions just below common reporting thresholds
      // Common thresholds: $3,000 (Travel Rule US), $10,000 (CTR/BSA)
      const thresholds = [3_000, 10_000];
      const margin = 0.1; // 10% below threshold

      const justBelowThreshold = thresholds.some((threshold) => {
        const lower = threshold * (1 - margin);
        return ctx.amountUsd >= lower && ctx.amountUsd < threshold;
      });

      // Also check if recent amounts show a pattern of staying just below
      const recentAmounts = ctx.recentAmountsUsd ?? [];
      const structuringPattern =
        recentAmounts.length >= 3 &&
        recentAmounts.filter((amt) =>
          thresholds.some((t) => amt >= t * (1 - margin) && amt < t),
        ).length >= 2;

      const triggered = justBelowThreshold || structuringPattern;

      return {
        triggered,
        detail: triggered
          ? structuringPattern
            ? `Structuring pattern: ${recentAmounts.length} recent txs cluster below reporting thresholds`
            : `Amount $${ctx.amountUsd.toFixed(2)} is just below a reporting threshold`
          : "No structuring indicators",
      };
    },
  },

  // ─── New: Time-of-day anomaly detection ─────────────────────────────────
  {
    factor: "time_of_day_anomaly",
    weight: 0.05,
    evaluate: (ctx) => {
      const hour = ctx.transactionHourUtc;
      if (hour === undefined) {
        return { triggered: false, detail: "Transaction hour not provided" };
      }
      // Flag transactions in unusual hours (01:00-05:00 UTC)
      // High-risk window for automated illicit transfers
      const triggered = hour >= 1 && hour <= 5;
      return {
        triggered,
        detail: triggered
          ? `Transaction at ${hour}:00 UTC (high-risk window 01:00-05:00)`
          : `Transaction at ${hour}:00 UTC (normal hours)`,
      };
    },
  },

  // ─── New: Cross-chain correlation ───────────────────────────────────────
  {
    factor: "cross_chain_correlation",
    weight: 0.07,
    evaluate: (ctx) => {
      const chainCount = ctx.crossChainCount24h ?? 0;
      const hasBridge = ctx.recentBridgeActivity ?? false;

      // Flag if sender is active on 3+ chains or has recent bridge activity
      // with high-value transactions — common pattern for chain-hopping laundering
      const triggered =
        (chainCount >= 3 && ctx.amountUsd > 1_000) ||
        (hasBridge && ctx.amountUsd > 5_000);

      return {
        triggered,
        detail: triggered
          ? `Cross-chain activity: ${chainCount} chains in 24h, bridge=${hasBridge}, amount=$${ctx.amountUsd.toFixed(2)}`
          : `Normal chain usage: ${chainCount} chains, bridge=${hasBridge}`,
      };
    },
  },
];

// ---------------------------------------------------------------------------
// AMLScorer
// ---------------------------------------------------------------------------

/**
 * Rule-based AML risk scoring engine.
 *
 * Evaluates multiple risk factors (velocity, amount anomaly, destination risk,
 * new wallet, mixer interaction, darknet exposure, structuring, time-of-day
 * anomaly, cross-chain correlation) and produces a composite score from
 * 0 (no risk) to 100 (maximum risk).
 *
 * Scoring rules are pluggable — pass custom rules via constructor or
 * addRule/removeRule at runtime.
 *
 * This is a deterministic, rule-based scorer — no ML models are used.
 * Designed for <50ms execution.
 */
export class AMLScorer {
  private readonly config: ProofLinkConfig;
  private readonly rules: ScoringRule[];

  constructor(config: ProofLinkConfig, rules?: ScoringRule[]) {
    this.config = config;
    this.rules = rules ?? [...DEFAULT_SCORING_RULES];
  }

  /**
   * Add a custom scoring rule at runtime.
   * If a rule with the same factor already exists, it is replaced.
   */
  addRule(rule: ScoringRule): void {
    const idx = this.rules.findIndex((r) => r.factor === rule.factor);
    if (idx !== -1) {
      this.rules[idx] = rule;
    } else {
      this.rules.push(rule);
    }
  }

  /**
   * Remove a scoring rule by factor name.
   * Returns true if the rule was found and removed.
   */
  removeRule(factor: AMLRiskFactor): boolean {
    const idx = this.rules.findIndex((r) => r.factor === factor);
    if (idx === -1) return false;
    this.rules.splice(idx, 1);
    return true;
  }

  /**
   * Get all currently active scoring rules.
   */
  getRules(): ReadonlyArray<ScoringRule> {
    return this.rules;
  }

  /**
   * Calculate a composite AML risk score for a transaction.
   *
   * @param ctx - Transaction context with optional behavioral signals
   * @returns AML risk score with detailed factor breakdown
   */
  calculateRiskScore(ctx: TransactionContext): AMLRiskScore {
    const now = new Date().toISOString();
    const factors: AMLRiskScore["factors"] = [];
    let totalWeightedScore = 0;
    let totalWeight = 0;

    for (const rule of this.rules) {
      const { triggered, detail } = rule.evaluate(ctx);
      const factorScore = triggered ? 1.0 : 0.0;

      factors.push({
        factor: rule.factor,
        weight: rule.weight,
        detail,
      });

      totalWeightedScore += factorScore * rule.weight;
      totalWeight += rule.weight;
    }

    // Normalize to 0-100 scale
    const rawScore =
      totalWeight > 0 ? (totalWeightedScore / totalWeight) * 100 : 0;
    const score = Math.round(Math.min(100, Math.max(0, rawScore)));

    return {
      score,
      factors,
      threshold: this.config.maxRiskScore,
      exceeds: score > this.config.maxRiskScore,
      evaluatedAt: now,
    };
  }
}
