// ---------------------------------------------------------------------------
// Structuring Detection — Detects transactions designed to evade thresholds
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A recorded transaction for structuring analysis. */
export interface StructuringTransaction {
  /** Transaction amount in USD */
  readonly amountUsd: number;
  /** ISO 8601 timestamp */
  readonly timestamp: string;
  /** Sender address */
  readonly senderAddress: string;
  /** Receiver address */
  readonly receiverAddress: string;
  /** Optional transaction identifier */
  readonly txId?: string;
}

/** A detected structuring alert. */
export interface StructuringAlert {
  /** Alert severity level */
  readonly severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  /** The type of structuring pattern detected */
  readonly pattern: StructuringPattern;
  /** Human-readable description of the alert */
  readonly description: string;
  /** Transactions that triggered the alert */
  readonly transactions: readonly StructuringTransaction[];
  /** The reporting threshold being evaded */
  readonly thresholdUsd: number;
  /** Total amount across flagged transactions */
  readonly totalAmountUsd: number;
  /** Confidence score (0.0 - 1.0) */
  readonly confidence: number;
  /** ISO 8601 timestamp when alert was generated */
  readonly detectedAt: string;
}

/** Types of structuring patterns. */
export type StructuringPattern =
  | "JUST_BELOW_THRESHOLD"
  | "SPLIT_TRANSACTIONS"
  | "ROUND_TRIP"
  | "RAPID_SUCCESSION";

/** Configuration for structuring detection. */
export interface StructuringDetectorConfig {
  /**
   * Reporting thresholds in USD to monitor.
   * @default [3000, 10000]
   */
  readonly thresholdsUsd?: readonly number[];
  /**
   * Margin below threshold to flag (0.0 - 1.0).
   * E.g., 0.1 means flag amounts within 10% below threshold.
   * @default 0.1
   */
  readonly belowThresholdMargin?: number;
  /**
   * Time window in milliseconds for analyzing transaction patterns.
   * @default 86400000 (24 hours)
   */
  readonly timeWindowMs?: number;
  /**
   * Minimum number of transactions to trigger a split-transaction alert.
   * @default 3
   */
  readonly minSplitCount?: number;
  /**
   * Maximum gap between rapid-succession transactions in milliseconds.
   * @default 3600000 (1 hour)
   */
  readonly rapidSuccessionGapMs?: number;
}

// ---------------------------------------------------------------------------
// StructuringDetector
// ---------------------------------------------------------------------------

/**
 * Detects potential structuring (smurfing) patterns in transaction flows.
 *
 * Structuring is the practice of deliberately breaking transactions into
 * smaller amounts to avoid regulatory reporting thresholds (e.g., the
 * $10,000 CTR/BSA threshold or the $3,000 Travel Rule threshold).
 *
 * Detection strategies:
 * - **Just-below-threshold**: Single transactions just below reporting limits
 * - **Split transactions**: Multiple transactions within a window that sum
 *   above a threshold but are individually below it
 * - **Rapid succession**: Burst of transactions in a short period
 * - **Round trip**: Funds sent and returned to obscure the trail
 *
 * @example
 * ```ts
 * const detector = new StructuringDetector({
 *   thresholdsUsd: [3_000, 10_000],
 *   belowThresholdMargin: 0.1,
 *   timeWindowMs: 24 * 60 * 60 * 1000,
 * });
 *
 * detector.recordTransaction({
 *   amountUsd: 9500,
 *   timestamp: new Date().toISOString(),
 *   senderAddress: "0xabc...",
 *   receiverAddress: "0xdef...",
 * });
 *
 * const alerts = detector.analyze("0xabc...");
 * ```
 */
export class StructuringDetector {
  private readonly thresholdsUsd: readonly number[];
  private readonly belowThresholdMargin: number;
  private readonly timeWindowMs: number;
  private readonly minSplitCount: number;
  private readonly rapidSuccessionGapMs: number;

  /**
   * Transaction history keyed by sender address.
   * Entries are pruned when they fall outside the time window.
   */
  private readonly history: Map<string, StructuringTransaction[]> = new Map();

  constructor(config?: StructuringDetectorConfig) {
    this.thresholdsUsd = config?.thresholdsUsd ?? [3_000, 10_000];
    this.belowThresholdMargin = config?.belowThresholdMargin ?? 0.1;
    this.timeWindowMs = config?.timeWindowMs ?? 24 * 60 * 60 * 1000;
    this.minSplitCount = config?.minSplitCount ?? 3;
    this.rapidSuccessionGapMs = config?.rapidSuccessionGapMs ?? 60 * 60 * 1000;
  }

  /**
   * Record a transaction for pattern analysis.
   *
   * @param tx - Transaction to record
   */
  recordTransaction(tx: StructuringTransaction): void {
    const key = tx.senderAddress.toLowerCase();
    const existing = this.history.get(key) ?? [];
    existing.push(tx);
    this.history.set(key, existing);
  }

  /**
   * Analyze transaction history for a given address and return alerts.
   *
   * Prunes expired transactions (outside time window) before analysis.
   *
   * @param address - Sender address to analyze
   * @returns Array of structuring alerts, sorted by severity (highest first)
   */
  analyze(address: string): readonly StructuringAlert[] {
    const key = address.toLowerCase();
    const now = Date.now();

    // Prune expired transactions
    this.pruneExpired(key, now);

    const txs = this.history.get(key);
    if (!txs || txs.length === 0) return [];

    const alerts: StructuringAlert[] = [];

    alerts.push(...this.detectJustBelowThreshold(txs));
    alerts.push(...this.detectSplitTransactions(txs));
    alerts.push(...this.detectRapidSuccession(txs));
    alerts.push(...this.detectRoundTrip(key));

    // Sort by severity (CRITICAL > HIGH > MEDIUM > LOW)
    const severityOrder: Record<StructuringAlert["severity"], number> = {
      CRITICAL: 3,
      HIGH: 2,
      MEDIUM: 1,
      LOW: 0,
    };
    alerts.sort(
      (a, b) => severityOrder[b.severity] - severityOrder[a.severity],
    );

    return alerts;
  }

  /**
   * Get the number of recorded transactions for an address.
   *
   * @param address - Address to check
   * @returns Transaction count
   */
  getTransactionCount(address: string): number {
    return this.history.get(address.toLowerCase())?.length ?? 0;
  }

  /**
   * Clear all recorded transaction history.
   */
  clear(): void {
    this.history.clear();
  }

  /**
   * Clear transaction history for a specific address.
   *
   * @param address - Address to clear
   */
  clearAddress(address: string): void {
    this.history.delete(address.toLowerCase());
  }

  // -------------------------------------------------------------------------
  // Detection strategies
  // -------------------------------------------------------------------------

  /**
   * Detect transactions just below reporting thresholds.
   */
  private detectJustBelowThreshold(
    txs: readonly StructuringTransaction[],
  ): StructuringAlert[] {
    const alerts: StructuringAlert[] = [];

    for (const threshold of this.thresholdsUsd) {
      const lower = threshold * (1 - this.belowThresholdMargin);
      const flagged = txs.filter(
        (tx) => tx.amountUsd >= lower && tx.amountUsd < threshold,
      );

      if (flagged.length === 0) continue;

      const total = flagged.reduce((sum, tx) => sum + tx.amountUsd, 0);
      const severity = this.assessJustBelowSeverity(flagged.length);

      alerts.push({
        severity,
        pattern: "JUST_BELOW_THRESHOLD",
        description: `${flagged.length} transaction(s) within ${(this.belowThresholdMargin * 100).toFixed(0)}% below $${threshold.toLocaleString()} threshold`,
        transactions: flagged,
        thresholdUsd: threshold,
        totalAmountUsd: total,
        confidence: Math.min(1.0, 0.4 + flagged.length * 0.2),
        detectedAt: new Date().toISOString(),
      });
    }

    return alerts;
  }

  /**
   * Detect split transactions that individually are below a threshold
   * but collectively exceed it.
   */
  private detectSplitTransactions(
    txs: readonly StructuringTransaction[],
  ): StructuringAlert[] {
    const alerts: StructuringAlert[] = [];

    for (const threshold of this.thresholdsUsd) {
      // Find transactions below the threshold
      const belowThreshold = txs.filter((tx) => tx.amountUsd < threshold);
      if (belowThreshold.length < this.minSplitCount) continue;

      const total = belowThreshold.reduce((sum, tx) => sum + tx.amountUsd, 0);

      // Only alert if the combined total exceeds the threshold
      if (total < threshold) continue;

      const multiplier = total / threshold;
      const severity: StructuringAlert["severity"] =
        multiplier >= 3 ? "HIGH" : multiplier >= 2 ? "MEDIUM" : "LOW";

      alerts.push({
        severity,
        pattern: "SPLIT_TRANSACTIONS",
        description: `${belowThreshold.length} transactions totaling $${total.toFixed(2)} (${multiplier.toFixed(1)}x the $${threshold.toLocaleString()} threshold)`,
        transactions: belowThreshold,
        thresholdUsd: threshold,
        totalAmountUsd: total,
        confidence: Math.min(1.0, 0.3 + (belowThreshold.length / 10) * 0.4),
        detectedAt: new Date().toISOString(),
      });
    }

    return alerts;
  }

  /**
   * Detect rapid-succession transactions from the same sender.
   */
  private detectRapidSuccession(
    txs: readonly StructuringTransaction[],
  ): StructuringAlert[] {
    if (txs.length < 3) return [];

    const sorted = [...txs].sort(
      (a, b) =>
        new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
    );

    const bursts: StructuringTransaction[][] = [];
    let currentBurst: StructuringTransaction[] = [sorted[0]!];

    for (let i = 1; i < sorted.length; i++) {
      const prev = new Date(sorted[i - 1]!.timestamp).getTime();
      const curr = new Date(sorted[i]!.timestamp).getTime();

      if (curr - prev <= this.rapidSuccessionGapMs) {
        currentBurst.push(sorted[i]!);
      } else {
        if (currentBurst.length >= 3) {
          bursts.push(currentBurst);
        }
        currentBurst = [sorted[i]!];
      }
    }
    if (currentBurst.length >= 3) {
      bursts.push(currentBurst);
    }

    return bursts.map((burst) => {
      const total = burst.reduce((sum, tx) => sum + tx.amountUsd, 0);
      const severity: StructuringAlert["severity"] =
        burst.length >= 10 ? "HIGH" : burst.length >= 5 ? "MEDIUM" : "LOW";

      // Find the lowest threshold exceeded by the total
      const exceededThreshold =
        [...this.thresholdsUsd]
          .sort((a, b) => b - a)
          .find((t) => total >= t) ?? this.thresholdsUsd[0]!;

      return {
        severity,
        pattern: "RAPID_SUCCESSION" as const,
        description: `${burst.length} transactions in rapid succession totaling $${total.toFixed(2)}`,
        transactions: burst,
        thresholdUsd: exceededThreshold,
        totalAmountUsd: total,
        confidence: Math.min(1.0, 0.3 + burst.length * 0.1),
        detectedAt: new Date().toISOString(),
      };
    });
  }

  /**
   * Detect round-trip patterns: sender sends to receiver who sends back.
   */
  private detectRoundTrip(senderKey: string): StructuringAlert[] {
    const senderTxs = this.history.get(senderKey);
    if (!senderTxs || senderTxs.length === 0) return [];

    const alerts: StructuringAlert[] = [];

    // Find receivers who also have transactions back to the sender
    const receivers = new Set(
      senderTxs.map((tx) => tx.receiverAddress.toLowerCase()),
    );

    for (const receiverKey of receivers) {
      const receiverTxs = this.history.get(receiverKey);
      if (!receiverTxs) continue;

      const returnTxs = receiverTxs.filter(
        (tx) => tx.receiverAddress.toLowerCase() === senderKey,
      );
      if (returnTxs.length === 0) continue;

      const outgoing = senderTxs.filter(
        (tx) => tx.receiverAddress.toLowerCase() === receiverKey,
      );
      const allTxs = [...outgoing, ...returnTxs];
      const total = allTxs.reduce((sum, tx) => sum + tx.amountUsd, 0);

      const exceededThreshold =
        [...this.thresholdsUsd]
          .sort((a, b) => b - a)
          .find((t) => total >= t) ?? this.thresholdsUsd[0]!;

      alerts.push({
        severity: "HIGH",
        pattern: "ROUND_TRIP",
        description: `Round-trip detected: ${outgoing.length} outgoing + ${returnTxs.length} return transactions between addresses`,
        transactions: allTxs,
        thresholdUsd: exceededThreshold,
        totalAmountUsd: total,
        confidence: 0.8,
        detectedAt: new Date().toISOString(),
      });
    }

    return alerts;
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  /** Prune transactions outside the time window. */
  private pruneExpired(key: string, nowMs: number): void {
    const txs = this.history.get(key);
    if (!txs) return;

    const cutoff = nowMs - this.timeWindowMs;
    const valid = txs.filter(
      (tx) => new Date(tx.timestamp).getTime() >= cutoff,
    );

    if (valid.length === 0) {
      this.history.delete(key);
    } else {
      this.history.set(key, valid);
    }
  }

  /** Map just-below-threshold count to severity. */
  private assessJustBelowSeverity(
    count: number,
  ): StructuringAlert["severity"] {
    if (count >= 5) return "CRITICAL";
    if (count >= 3) return "HIGH";
    if (count >= 2) return "MEDIUM";
    return "LOW";
  }
}
