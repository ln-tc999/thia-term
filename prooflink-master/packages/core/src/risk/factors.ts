// ---------------------------------------------------------------------------
// Risk Factor Registry — Pluggable risk factor evaluation system
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Context provided to each risk factor for evaluation.
 * Contains transaction data, behavioral signals, and historical patterns.
 */
export interface RiskFactorContext {
  /** Wallet address being evaluated */
  readonly address: string;
  /** Transaction amount in USD equivalent */
  readonly amountUsd: number;
  /** CAIP-2 chain identifier */
  readonly chain: string;
  /** Asset identifier (e.g., "USDC", "EURC") */
  readonly asset: string;
  /** Counterparty address */
  readonly counterpartyAddress?: string;
  /** Number of transactions in the last hour */
  readonly txCountLastHour?: number;
  /** Number of transactions in the last 24 hours */
  readonly txCountLast24h?: number;
  /** 30-day average transaction amount in USD */
  readonly historicalAvgAmountUsd?: number;
  /** Recent transaction amounts in USD */
  readonly recentAmountsUsd?: readonly number[];
  /** Hour of day (0-23) in UTC */
  readonly transactionHourUtc?: number;
  /** Number of distinct chains in last 24h */
  readonly crossChainCount24h?: number;
  /** Whether recent bridge activity occurred */
  readonly recentBridgeActivity?: boolean;
  /** Number of unique counterparties in the last 30 days */
  readonly uniqueCounterparties30d?: number;
  /** Total volume in last 30 days (USD) */
  readonly totalVolume30dUsd?: number;
  /** Arbitrary metadata for custom factors */
  readonly metadata?: Readonly<Record<string, unknown>>;
}

/**
 * Result returned by a risk factor evaluation.
 */
export interface RiskFactorResult {
  /** Normalized score from 0.0 (no risk) to 1.0 (maximum risk) */
  readonly score: number;
  /** Human-readable explanation of the score */
  readonly detail: string;
  /** Whether this factor was triggered (score > 0) */
  readonly triggered: boolean;
}

/**
 * A pluggable risk factor that evaluates a specific dimension of risk.
 *
 * Each factor has a unique name, a weight (relative importance),
 * and an evaluate function that produces a normalized score.
 */
export interface RiskFactor {
  /** Unique name identifying this factor */
  readonly name: string;
  /** Relative weight for composite scoring (0.0 - 1.0) */
  readonly weight: number;
  /** Human-readable description of what this factor measures */
  readonly description: string;
  /**
   * Evaluate the risk factor against the provided context.
   *
   * @param context - Transaction and behavioral context
   * @returns Factor evaluation result with score, detail, and triggered flag
   */
  evaluate(context: RiskFactorContext): RiskFactorResult;
}

// ---------------------------------------------------------------------------
// Built-in Risk Factors
// ---------------------------------------------------------------------------

/**
 * Velocity risk factor.
 * Flags addresses with abnormally high transaction frequency.
 */
export const velocityFactor: RiskFactor = {
  name: "velocity",
  weight: 0.15,
  description: "Detects abnormally high transaction frequency",
  evaluate(ctx: RiskFactorContext): RiskFactorResult {
    const hourly = ctx.txCountLastHour ?? 0;
    const daily = ctx.txCountLast24h ?? 0;

    let score = 0;
    if (hourly > 20) {
      score = Math.min(1.0, hourly / 50);
    } else if (daily > 100) {
      score = Math.min(1.0, daily / 250);
    }

    return {
      score,
      triggered: score > 0,
      detail:
        score > 0
          ? `High velocity: ${hourly} tx/hour, ${daily} tx/24h`
          : `Normal velocity: ${hourly} tx/hour, ${daily} tx/24h`,
    };
  },
};

/**
 * Amount anomaly risk factor.
 * Flags transactions significantly above historical average.
 */
export const amountFactor: RiskFactor = {
  name: "amount",
  weight: 0.2,
  description: "Detects transactions significantly above historical average",
  evaluate(ctx: RiskFactorContext): RiskFactorResult {
    const avg = ctx.historicalAvgAmountUsd;
    if (!avg || avg === 0) {
      const score = ctx.amountUsd > 10_000 ? 0.5 : 0;
      return {
        score,
        triggered: score > 0,
        detail: `No historical average; amount $${ctx.amountUsd.toFixed(2)}`,
      };
    }

    const ratio = ctx.amountUsd / avg;
    const score = ratio > 5 ? Math.min(1.0, (ratio - 5) / 10 + 0.5) : 0;

    return {
      score,
      triggered: score > 0,
      detail: `Amount $${ctx.amountUsd.toFixed(2)} is ${ratio.toFixed(1)}x historical avg $${avg.toFixed(2)}`,
    };
  },
};

/**
 * Destination risk factor.
 * Flags transactions to high-risk or sanctioned-proximity addresses.
 */
export const destinationFactor: RiskFactor = {
  name: "destination",
  weight: 0.15,
  description:
    "Evaluates risk based on counterparty address characteristics",
  evaluate(ctx: RiskFactorContext): RiskFactorResult {
    // Without counterparty data, we can't evaluate destination risk
    if (!ctx.counterpartyAddress) {
      return { score: 0, triggered: false, detail: "No counterparty data" };
    }

    // Check metadata for sanctioned proximity
    const proximity = ctx.metadata?.["sanctionedProximity"] as
      | number
      | undefined;
    if (proximity !== undefined && proximity >= 0 && proximity <= 3) {
      const score = Math.min(1.0, 1.0 - proximity * 0.2);
      return {
        score,
        triggered: true,
        detail: `Counterparty ${proximity} hops from sanctioned address`,
      };
    }

    return {
      score: 0,
      triggered: false,
      detail: "No elevated destination risk detected",
    };
  },
};

/**
 * Time-of-day risk factor.
 * Flags transactions during unusual hours (01:00-05:00 UTC).
 */
export const timeOfDayFactor: RiskFactor = {
  name: "time_of_day",
  weight: 0.05,
  description:
    "Flags transactions during statistically unusual hours (01:00-05:00 UTC)",
  evaluate(ctx: RiskFactorContext): RiskFactorResult {
    const hour = ctx.transactionHourUtc;
    if (hour === undefined) {
      return { score: 0, triggered: false, detail: "Transaction hour not provided" };
    }

    const triggered = hour >= 1 && hour <= 5;
    return {
      score: triggered ? 0.6 : 0,
      triggered,
      detail: triggered
        ? `Transaction at ${hour}:00 UTC (high-risk window 01:00-05:00)`
        : `Transaction at ${hour}:00 UTC (normal hours)`,
    };
  },
};

/**
 * Cross-chain risk factor.
 * Flags multi-chain activity patterns common in chain-hopping laundering.
 */
export const crossChainFactor: RiskFactor = {
  name: "cross_chain",
  weight: 0.07,
  description: "Detects chain-hopping patterns used in laundering",
  evaluate(ctx: RiskFactorContext): RiskFactorResult {
    const chainCount = ctx.crossChainCount24h ?? 0;
    const hasBridge = ctx.recentBridgeActivity ?? false;

    let score = 0;
    if (chainCount >= 3 && ctx.amountUsd > 1_000) {
      score = Math.min(1.0, chainCount / 8);
    }
    if (hasBridge && ctx.amountUsd > 5_000) {
      score = Math.max(score, 0.7);
    }

    return {
      score,
      triggered: score > 0,
      detail:
        score > 0
          ? `Cross-chain activity: ${chainCount} chains in 24h, bridge=${hasBridge}, amount=$${ctx.amountUsd.toFixed(2)}`
          : `Normal chain usage: ${chainCount} chains, bridge=${hasBridge}`,
    };
  },
};

/**
 * All built-in risk factors, ready for registration.
 */
export const BUILT_IN_FACTORS: readonly RiskFactor[] = [
  velocityFactor,
  amountFactor,
  destinationFactor,
  timeOfDayFactor,
  crossChainFactor,
];

// ---------------------------------------------------------------------------
// RiskFactorRegistry
// ---------------------------------------------------------------------------

/**
 * Registry for pluggable risk factors.
 *
 * Manages a set of named risk factors, each with a weight and evaluation
 * function. Factors can be registered, unregistered, and evaluated against
 * a context to produce individual and composite risk scores.
 *
 * @example
 * ```ts
 * const registry = new RiskFactorRegistry();
 * registry.registerBuiltIns();
 * registry.registerFactor({
 *   name: "custom_geo",
 *   weight: 0.1,
 *   description: "Geographic risk scoring",
 *   evaluate: (ctx) => ({ score: 0.3, triggered: true, detail: "High-risk geo" }),
 * });
 *
 * const results = registry.evaluateAll(context);
 * const composite = registry.computeCompositeScore(results);
 * ```
 */
export class RiskFactorRegistry {
  private readonly factors: Map<string, RiskFactor> = new Map();

  /**
   * Register a risk factor.
   * Replaces any existing factor with the same name.
   *
   * @param factor - The risk factor to register
   * @throws Error if factor weight is not in [0, 1]
   */
  registerFactor(factor: RiskFactor): void {
    if (factor.weight < 0 || factor.weight > 1) {
      throw new Error(
        `Factor "${factor.name}" weight must be between 0 and 1, got ${factor.weight}`,
      );
    }
    this.factors.set(factor.name, factor);
  }

  /**
   * Unregister a risk factor by name.
   *
   * @param name - Factor name to remove
   * @returns true if a factor was removed, false if not found
   */
  unregisterFactor(name: string): boolean {
    return this.factors.delete(name);
  }

  /**
   * Get a registered factor by name.
   *
   * @param name - Factor name
   * @returns The factor, or undefined if not found
   */
  getFactor(name: string): RiskFactor | undefined {
    return this.factors.get(name);
  }

  /**
   * Get all registered factors.
   */
  getFactors(): readonly RiskFactor[] {
    return Array.from(this.factors.values());
  }

  /**
   * Register all built-in risk factors.
   */
  registerBuiltIns(): void {
    for (const factor of BUILT_IN_FACTORS) {
      this.registerFactor(factor);
    }
  }

  /**
   * Evaluate all registered factors against a context.
   *
   * @param context - Risk factor evaluation context
   * @returns Map of factor name to evaluation result
   */
  evaluateAll(
    context: RiskFactorContext,
  ): ReadonlyMap<string, RiskFactorResult> {
    const results = new Map<string, RiskFactorResult>();
    for (const [name, factor] of this.factors) {
      results.set(name, factor.evaluate(context));
    }
    return results;
  }

  /**
   * Compute a weighted composite risk score from factor results.
   *
   * Score is normalized to 0-100.
   *
   * @param results - Map of factor name to evaluation result (from evaluateAll)
   * @returns Composite score (0-100)
   */
  computeCompositeScore(
    results: ReadonlyMap<string, RiskFactorResult>,
  ): number {
    let totalWeightedScore = 0;
    let totalWeight = 0;

    for (const [name, result] of results) {
      const factor = this.factors.get(name);
      if (!factor) continue;

      totalWeightedScore += result.score * factor.weight;
      totalWeight += factor.weight;
    }

    if (totalWeight === 0) return 0;

    const raw = (totalWeightedScore / totalWeight) * 100;
    return Math.round(Math.min(100, Math.max(0, raw)));
  }
}
