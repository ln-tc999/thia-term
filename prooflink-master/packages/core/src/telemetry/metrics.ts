// ---------------------------------------------------------------------------
// Compliance Metrics / Telemetry
// ---------------------------------------------------------------------------

import type { ComplianceDecisionStatus } from "@prooflink/shared";
import type { TypedEventEmitter } from "../events/emitter.js";
import type { ProofLinkEvents } from "../events/emitter.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Snapshot of all collected metrics. */
export interface MetricsSnapshot {
  /** Decisions broken down by status */
  decisions: Record<ComplianceDecisionStatus, number>;
  /** Total decisions issued */
  totalDecisions: number;
  /** Average latency in milliseconds */
  averageLatencyMs: number;
  /** P95 latency in milliseconds */
  p95LatencyMs: number;
  /** P99 latency in milliseconds */
  p99LatencyMs: number;
  /** Cache hit rate (0-1) */
  cacheHitRate: number;
  /** Total cache lookups */
  cacheLookups: number;
  /** Total cache hits */
  cacheHits: number;
  /** API error count */
  apiErrors: number;
  /** API error rate (0-1, errors / total API calls) */
  apiErrorRate: number;
  /** Total API calls */
  totalApiCalls: number;
  /** Total sanctions matches detected */
  sanctionsMatches: number;
  /** Timestamp of snapshot */
  collectedAt: string;
}

/**
 * Interface for external metric reporters.
 * Implement this to push metrics to StatsD, Prometheus, Datadog, etc.
 */
export interface MetricReporter {
  /** Report a counter increment */
  increment(metric: string, value: number, tags?: Record<string, string>): void;
  /** Report a gauge value */
  gauge(metric: string, value: number, tags?: Record<string, string>): void;
  /** Report a timing/histogram value */
  timing(metric: string, valueMs: number, tags?: Record<string, string>): void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)]!;
}

function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

// ---------------------------------------------------------------------------
// ComplianceMetrics
// ---------------------------------------------------------------------------

/**
 * In-memory compliance metrics collector.
 *
 * Tracks decision counts by status, latency percentiles (avg/p95/p99),
 * cache hit rates, API errors, and sanctions matches.
 * Supports pluggable external reporters for forwarding to monitoring systems.
 *
 * Can auto-collect metrics by subscribing to a ProofLinkEngine's typed event emitter
 * via {@link connectToEvents}.
 */
export class ComplianceMetrics {
  private decisionCounts: Record<ComplianceDecisionStatus, number> = {
    APPROVED: 0,
    REJECTED: 0,
    ESCALATED: 0,
  };

  private latencies: number[] = [];
  private sortedLatencies: number[] | null = null; // lazily sorted
  private cacheHits = 0;
  private cacheLookups = 0;
  private apiErrors = 0;
  private totalApiCalls = 0;
  private sanctionsMatches = 0;

  private readonly reporters: MetricReporter[] = [];

  /**
   * Register an external metric reporter.
   * Reporters receive real-time metric updates.
   */
  addReporter(reporter: MetricReporter): void {
    this.reporters.push(reporter);
  }

  /**
   * Remove a previously registered reporter.
   */
  removeReporter(reporter: MetricReporter): boolean {
    const idx = this.reporters.indexOf(reporter);
    if (idx === -1) return false;
    this.reporters.splice(idx, 1);
    return true;
  }

  /**
   * Connect to a TypedEventEmitter to auto-collect metrics from engine events.
   *
   * Listens to:
   * - compliance:decision  -> recordDecision (status only; latency via direct call)
   * - sanctions:match      -> increment sanctionsMatches
   * - error                -> increment apiErrors
   */
  connectToEvents(emitter: TypedEventEmitter<ProofLinkEvents>): void {
    emitter.on("compliance:approved", () => {
      // Decision already recorded via recordDecision in postDecision
    });

    emitter.on("sanctions:match", () => {
      this.recordSanctionsMatch();
    });

    emitter.on("error", () => {
      this.recordApiCall(false);
    });
  }

  /**
   * Record a compliance decision with latency.
   */
  recordDecision(status: ComplianceDecisionStatus, latencyMs: number): void {
    this.decisionCounts[status]++;
    this.latencies.push(latencyMs);
    this.sortedLatencies = null; // invalidate cache

    for (const r of this.reporters) {
      r.increment("prooflink.decisions", 1, { status });
      r.timing("prooflink.decision_latency", latencyMs, { status });
    }
  }

  /**
   * Record a sanctions match detection.
   */
  recordSanctionsMatch(): void {
    this.sanctionsMatches++;

    for (const r of this.reporters) {
      r.increment("prooflink.sanctions_matches", 1);
    }
  }

  /**
   * Record a cache lookup result.
   */
  recordCacheLookup(hit: boolean): void {
    this.cacheLookups++;
    if (hit) this.cacheHits++;

    for (const r of this.reporters) {
      r.increment("prooflink.cache_lookups", 1, { hit: String(hit) });
    }
  }

  /**
   * Record an API call result.
   */
  recordApiCall(success: boolean): void {
    this.totalApiCalls++;
    if (!success) this.apiErrors++;

    for (const r of this.reporters) {
      r.increment("prooflink.api_calls", 1, { success: String(success) });
    }
  }

  /**
   * Get a snapshot of all collected metrics.
   */
  getMetrics(): MetricsSnapshot {
    const totalDecisions = Object.values(this.decisionCounts).reduce(
      (sum, count) => sum + count,
      0,
    );

    const averageLatencyMs =
      this.latencies.length > 0
        ? this.latencies.reduce((sum, l) => sum + l, 0) / this.latencies.length
        : 0;

    // Lazily sort for percentile calculations
    if (!this.sortedLatencies) {
      this.sortedLatencies = [...this.latencies].sort((a, b) => a - b);
    }

    const p95LatencyMs = percentile(this.sortedLatencies, 95);
    const p99LatencyMs = percentile(this.sortedLatencies, 99);

    const cacheHitRate =
      this.cacheLookups > 0 ? this.cacheHits / this.cacheLookups : 0;

    const apiErrorRate =
      this.totalApiCalls > 0 ? this.apiErrors / this.totalApiCalls : 0;

    const snapshot: MetricsSnapshot = {
      decisions: { ...this.decisionCounts },
      totalDecisions,
      averageLatencyMs: round(averageLatencyMs, 2),
      p95LatencyMs: round(p95LatencyMs, 2),
      p99LatencyMs: round(p99LatencyMs, 2),
      cacheHitRate: round(cacheHitRate, 4),
      cacheLookups: this.cacheLookups,
      cacheHits: this.cacheHits,
      apiErrors: this.apiErrors,
      apiErrorRate: round(apiErrorRate, 4),
      totalApiCalls: this.totalApiCalls,
      sanctionsMatches: this.sanctionsMatches,
      collectedAt: new Date().toISOString(),
    };

    // Report gauges to external reporters
    for (const r of this.reporters) {
      r.gauge("prooflink.total_decisions", totalDecisions);
      r.gauge("prooflink.avg_latency_ms", snapshot.averageLatencyMs);
      r.gauge("prooflink.p95_latency_ms", snapshot.p95LatencyMs);
      r.gauge("prooflink.p99_latency_ms", snapshot.p99LatencyMs);
      r.gauge("prooflink.cache_hit_rate", snapshot.cacheHitRate);
      r.gauge("prooflink.api_error_rate", snapshot.apiErrorRate);
      r.gauge("prooflink.sanctions_matches", snapshot.sanctionsMatches);
    }

    return snapshot;
  }

  /**
   * Reset all counters. Useful for testing or periodic resets.
   */
  reset(): void {
    this.decisionCounts = { APPROVED: 0, REJECTED: 0, ESCALATED: 0 };
    this.latencies = [];
    this.sortedLatencies = null;
    this.cacheHits = 0;
    this.cacheLookups = 0;
    this.apiErrors = 0;
    this.totalApiCalls = 0;
    this.sanctionsMatches = 0;
  }
}
