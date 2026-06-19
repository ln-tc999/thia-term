// ---------------------------------------------------------------------------
// Address Risk Profile — Aggregated risk data for an address over time
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Direction a transaction was observed from the profiled address's perspective. */
export type TransactionDirection = "sent" | "received";

/** Risk trend over time. */
export type RiskTrend = "improving" | "worsening" | "stable";

/** A transaction record for profile tracking. */
export interface ProfileTransaction {
  /** Transaction amount in USD */
  readonly amountUsd: number;
  /** ISO 8601 timestamp */
  readonly timestamp: string;
  /** Direction relative to the profiled address */
  readonly direction: TransactionDirection;
  /** Counterparty address */
  readonly counterpartyAddress: string;
  /** CAIP-2 chain identifier */
  readonly chain: string;
  /** Risk score at time of transaction (0-100) */
  readonly riskScore?: number;
}

/** Snapshot of an address risk profile. */
export interface RiskProfileSnapshot {
  /** The profiled address */
  readonly address: string;
  /** Total transaction volume in USD (sent + received) */
  readonly totalVolumeUsd: number;
  /** Total sent volume in USD */
  readonly totalSentUsd: number;
  /** Total received volume in USD */
  readonly totalReceivedUsd: number;
  /** Average transaction amount in USD */
  readonly averageAmountUsd: number;
  /** Total number of transactions */
  readonly transactionCount: number;
  /** Number of transactions sent */
  readonly sentCount: number;
  /** Number of transactions received */
  readonly receivedCount: number;
  /** Number of unique counterparty addresses */
  readonly uniqueCounterparties: number;
  /** Number of unique chains transacted on */
  readonly uniqueChains: number;
  /** Average risk score across transactions with scores */
  readonly averageRiskScore: number;
  /** Current risk trend */
  readonly riskTrend: RiskTrend;
  /** ISO 8601 timestamp of first recorded transaction */
  readonly firstSeen: string;
  /** ISO 8601 timestamp of most recent transaction */
  readonly lastSeen: string;
  /** Transactions per day (average over active period) */
  readonly frequencyPerDay: number;
  /** ISO 8601 timestamp when this snapshot was generated */
  readonly generatedAt: string;
}

/** Configuration for AddressRiskProfile. */
export interface RiskProfileConfig {
  /**
   * Number of recent risk scores to use for trend calculation.
   * @default 10
   */
  readonly trendWindowSize?: number;
  /**
   * Minimum absolute change in average risk score to be considered
   * "improving" or "worsening" (vs "stable").
   * @default 5
   */
  readonly trendThreshold?: number;
}

// ---------------------------------------------------------------------------
// AddressRiskProfile
// ---------------------------------------------------------------------------

/**
 * Aggregates risk data for a single address over time.
 *
 * Tracks:
 * - Total volume (sent/received) and average transaction size
 * - Transaction frequency and count
 * - Counterparty diversity (unique addresses)
 * - Chain diversity
 * - Risk trend (improving / worsening / stable) based on rolling scores
 * - First seen / last seen timestamps
 *
 * @example
 * ```ts
 * const profile = new AddressRiskProfile("0xabc...");
 *
 * profile.recordTransaction({
 *   amountUsd: 5000,
 *   timestamp: new Date().toISOString(),
 *   direction: "sent",
 *   counterpartyAddress: "0xdef...",
 *   chain: "eip155:1",
 *   riskScore: 25,
 * });
 *
 * const snapshot = profile.getSnapshot();
 * console.log(snapshot.riskTrend); // "stable"
 * ```
 */
export class AddressRiskProfile {
  /** The address this profile tracks. */
  readonly address: string;

  private readonly trendWindowSize: number;
  private readonly trendThreshold: number;
  private readonly transactions: ProfileTransaction[] = [];
  private readonly counterparties: Set<string> = new Set();
  private readonly chains: Set<string> = new Set();

  private totalSentUsd = 0;
  private totalReceivedUsd = 0;
  private sentCount = 0;
  private receivedCount = 0;
  private riskScores: number[] = [];
  private firstSeenTs: string | undefined;
  private lastSeenTs: string | undefined;

  constructor(address: string, config?: RiskProfileConfig) {
    this.address = address.toLowerCase();
    this.trendWindowSize = config?.trendWindowSize ?? 10;
    this.trendThreshold = config?.trendThreshold ?? 5;
  }

  /**
   * Record a transaction against this profile.
   *
   * @param tx - Transaction to record
   */
  recordTransaction(tx: ProfileTransaction): void {
    this.transactions.push(tx);

    if (tx.direction === "sent") {
      this.totalSentUsd += tx.amountUsd;
      this.sentCount++;
    } else {
      this.totalReceivedUsd += tx.amountUsd;
      this.receivedCount++;
    }

    this.counterparties.add(tx.counterpartyAddress.toLowerCase());
    this.chains.add(tx.chain);

    if (tx.riskScore !== undefined) {
      this.riskScores.push(tx.riskScore);
    }

    // Track first/last seen
    if (!this.firstSeenTs || tx.timestamp < this.firstSeenTs) {
      this.firstSeenTs = tx.timestamp;
    }
    if (!this.lastSeenTs || tx.timestamp > this.lastSeenTs) {
      this.lastSeenTs = tx.timestamp;
    }
  }

  /**
   * Get the total number of recorded transactions.
   */
  get transactionCount(): number {
    return this.transactions.length;
  }

  /**
   * Get the total volume in USD (sent + received).
   */
  get totalVolumeUsd(): number {
    return this.totalSentUsd + this.totalReceivedUsd;
  }

  /**
   * Generate a snapshot of the current risk profile.
   *
   * @returns Immutable snapshot with all computed metrics
   */
  getSnapshot(): RiskProfileSnapshot {
    const now = new Date().toISOString();
    const count = this.transactions.length;
    const totalVolume = this.totalSentUsd + this.totalReceivedUsd;

    // Frequency: transactions per day over active period
    let frequencyPerDay = 0;
    if (this.firstSeenTs && this.lastSeenTs && count > 1) {
      const firstMs = new Date(this.firstSeenTs).getTime();
      const lastMs = new Date(this.lastSeenTs).getTime();
      const days = Math.max(1, (lastMs - firstMs) / (24 * 60 * 60 * 1000));
      frequencyPerDay = Math.round((count / days) * 100) / 100;
    } else if (count === 1) {
      frequencyPerDay = 1;
    }

    return {
      address: this.address,
      totalVolumeUsd: totalVolume,
      totalSentUsd: this.totalSentUsd,
      totalReceivedUsd: this.totalReceivedUsd,
      averageAmountUsd: count > 0 ? totalVolume / count : 0,
      transactionCount: count,
      sentCount: this.sentCount,
      receivedCount: this.receivedCount,
      uniqueCounterparties: this.counterparties.size,
      uniqueChains: this.chains.size,
      averageRiskScore: this.computeAverageRiskScore(),
      riskTrend: this.computeRiskTrend(),
      firstSeen: this.firstSeenTs ?? now,
      lastSeen: this.lastSeenTs ?? now,
      frequencyPerDay,
      generatedAt: now,
    };
  }

  /**
   * Reset the profile, clearing all recorded data.
   */
  reset(): void {
    this.transactions.length = 0;
    this.counterparties.clear();
    this.chains.clear();
    this.totalSentUsd = 0;
    this.totalReceivedUsd = 0;
    this.sentCount = 0;
    this.receivedCount = 0;
    this.riskScores = [];
    this.firstSeenTs = undefined;
    this.lastSeenTs = undefined;
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  /** Compute average risk score across all recorded scores. */
  private computeAverageRiskScore(): number {
    if (this.riskScores.length === 0) return 0;
    const sum = this.riskScores.reduce((a, b) => a + b, 0);
    return Math.round(sum / this.riskScores.length);
  }

  /**
   * Compute risk trend by comparing the first half vs second half
   * of the trend window.
   */
  private computeRiskTrend(): RiskTrend {
    if (this.riskScores.length < 2) return "stable";

    const window = this.riskScores.slice(-this.trendWindowSize);
    const mid = Math.floor(window.length / 2);
    const firstHalf = window.slice(0, mid);
    const secondHalf = window.slice(mid);

    const avgFirst =
      firstHalf.reduce((a, b) => a + b, 0) / firstHalf.length;
    const avgSecond =
      secondHalf.reduce((a, b) => a + b, 0) / secondHalf.length;

    const delta = avgSecond - avgFirst;

    if (delta > this.trendThreshold) return "worsening";
    if (delta < -this.trendThreshold) return "improving";
    return "stable";
  }
}
