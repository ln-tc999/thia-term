// ---------------------------------------------------------------------------
// Prometheus Metrics Exporter — zero-dependency Prometheus text format output
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Histogram bucket boundary + count. */
interface HistogramBucket {
  le: number;
  count: number;
}

interface CounterState {
  type: "counter";
  help: string;
  labels: Map<string, number>; // serialized labels -> value
}

interface GaugeState {
  type: "gauge";
  help: string;
  labels: Map<string, number>;
}

interface HistogramState {
  type: "histogram";
  help: string;
  buckets: number[];
  observations: Map<string, { bucketCounts: number[]; sum: number; count: number }>;
}

type MetricState = CounterState | GaugeState | HistogramState;

// ---------------------------------------------------------------------------
// Label helpers
// ---------------------------------------------------------------------------

function serializeLabels(labels: Record<string, string>): string {
  const entries = Object.entries(labels);
  if (entries.length === 0) return "";
  return `{${entries.map(([k, v]) => `${k}="${escapeLabel(v)}"`).join(",")}}`;
}

function escapeLabel(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
}

// ---------------------------------------------------------------------------
// Default histogram buckets
// ---------------------------------------------------------------------------

const DEFAULT_DURATION_BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];
const DEFAULT_SCORE_BUCKETS = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0];

// ---------------------------------------------------------------------------
// PrometheusExporter
// ---------------------------------------------------------------------------

/**
 * In-process Prometheus metrics exporter.
 *
 * Provides counters, gauges, and histograms with label support.
 * Call {@link serialize} to produce the Prometheus text exposition format.
 *
 * Pre-registered metrics:
 * - `compliance_checks_total` (counter)
 * - `sanctions_matches_total` (counter)
 * - `check_duration_seconds` (histogram)
 * - `risk_score_distribution` (histogram)
 * - `active_connections` (gauge)
 * - `cache_size` (gauge)
 */
export class PrometheusExporter {
  private readonly metrics = new Map<string, MetricState>();

  constructor() {
    // Pre-register standard ProofLink metrics
    this.registerCounter(
      "compliance_checks_total",
      "Total number of compliance checks performed",
    );
    this.registerCounter(
      "sanctions_matches_total",
      "Total number of sanctions matches detected",
    );
    this.registerHistogram(
      "check_duration_seconds",
      "Duration of compliance checks in seconds",
      DEFAULT_DURATION_BUCKETS,
    );
    this.registerHistogram(
      "risk_score_distribution",
      "Distribution of AML risk scores",
      DEFAULT_SCORE_BUCKETS,
    );
    this.registerGauge(
      "active_connections",
      "Number of active connections",
    );
    this.registerGauge(
      "cache_size",
      "Current number of entries in the cache",
    );
  }

  // -------------------------------------------------------------------------
  // Registration
  // -------------------------------------------------------------------------

  /** Register a counter metric. */
  registerCounter(name: string, help: string): void {
    if (this.metrics.has(name)) return;
    this.metrics.set(name, {
      type: "counter",
      help,
      labels: new Map([["", 0]]),
    });
  }

  /** Register a gauge metric. */
  registerGauge(name: string, help: string): void {
    if (this.metrics.has(name)) return;
    this.metrics.set(name, {
      type: "gauge",
      help,
      labels: new Map([["", 0]]),
    });
  }

  /** Register a histogram metric with custom bucket boundaries. */
  registerHistogram(name: string, help: string, buckets: number[]): void {
    if (this.metrics.has(name)) return;
    const sorted = [...buckets].sort((a, b) => a - b);
    this.metrics.set(name, {
      type: "histogram",
      help,
      buckets: sorted,
      observations: new Map(),
    });
  }

  // -------------------------------------------------------------------------
  // Counter operations
  // -------------------------------------------------------------------------

  /** Increment a counter by the given value (default 1). */
  incCounter(name: string, value = 1, labels: Record<string, string> = {}): void {
    const metric = this.metrics.get(name);
    if (!metric || metric.type !== "counter") return;

    const key = serializeLabels(labels);
    const current = metric.labels.get(key) ?? 0;
    metric.labels.set(key, current + value);
  }

  // -------------------------------------------------------------------------
  // Gauge operations
  // -------------------------------------------------------------------------

  /** Set a gauge to a specific value. */
  setGauge(name: string, value: number, labels: Record<string, string> = {}): void {
    const metric = this.metrics.get(name);
    if (!metric || metric.type !== "gauge") return;

    const key = serializeLabels(labels);
    metric.labels.set(key, value);
  }

  /** Increment a gauge by the given value (default 1). */
  incGauge(name: string, value = 1, labels: Record<string, string> = {}): void {
    const metric = this.metrics.get(name);
    if (!metric || metric.type !== "gauge") return;

    const key = serializeLabels(labels);
    const current = metric.labels.get(key) ?? 0;
    metric.labels.set(key, current + value);
  }

  /** Decrement a gauge by the given value (default 1). */
  decGauge(name: string, value = 1, labels: Record<string, string> = {}): void {
    this.incGauge(name, -value, labels);
  }

  // -------------------------------------------------------------------------
  // Histogram operations
  // -------------------------------------------------------------------------

  /** Observe a value in a histogram. */
  observe(name: string, value: number, labels: Record<string, string> = {}): void {
    const metric = this.metrics.get(name);
    if (!metric || metric.type !== "histogram") return;

    const key = serializeLabels(labels);
    let obs = metric.observations.get(key);
    if (!obs) {
      obs = {
        bucketCounts: new Array<number>(metric.buckets.length).fill(0),
        sum: 0,
        count: 0,
      };
      metric.observations.set(key, obs);
    }

    obs.sum += value;
    obs.count++;

    for (let i = 0; i < metric.buckets.length; i++) {
      if (value <= metric.buckets[i]!) {
        obs.bucketCounts[i]!++;
      }
    }
  }

  // -------------------------------------------------------------------------
  // Serialization
  // -------------------------------------------------------------------------

  /**
   * Serialize all metrics in Prometheus text exposition format.
   * Suitable for responding to `GET /metrics` requests.
   */
  serialize(): string {
    const lines: string[] = [];

    for (const [name, metric] of this.metrics) {
      lines.push(`# HELP ${name} ${metric.help}`);
      lines.push(`# TYPE ${name} ${metric.type}`);

      if (metric.type === "counter" || metric.type === "gauge") {
        for (const [labelStr, value] of metric.labels) {
          lines.push(`${name}${labelStr} ${formatValue(value)}`);
        }
      } else if (metric.type === "histogram") {
        if (metric.observations.size === 0) {
          // Emit empty histogram
          for (const le of metric.buckets) {
            lines.push(`${name}_bucket{le="${le}"} 0`);
          }
          lines.push(`${name}_bucket{le="+Inf"} 0`);
          lines.push(`${name}_sum 0`);
          lines.push(`${name}_count 0`);
        }

        for (const [labelStr, obs] of metric.observations) {
          const labelPrefix = labelStr ? `${labelStr.slice(0, -1)},` : "{";
          let cumulativeCount = 0;

          for (let i = 0; i < metric.buckets.length; i++) {
            cumulativeCount += obs.bucketCounts[i]!;
            lines.push(
              `${name}_bucket${labelPrefix}le="${metric.buckets[i]}"}` +
              ` ${cumulativeCount}`,
            );
          }
          lines.push(
            `${name}_bucket${labelPrefix}le="+Inf"} ${obs.count}`,
          );
          lines.push(`${name}_sum${labelStr} ${formatValue(obs.sum)}`);
          lines.push(`${name}_count${labelStr} ${obs.count}`);
        }
      }

      lines.push("");
    }

    return lines.join("\n");
  }

  /**
   * Reset all metric values to zero.
   * Metric registrations are preserved.
   */
  reset(): void {
    for (const [, metric] of this.metrics) {
      if (metric.type === "counter" || metric.type === "gauge") {
        metric.labels.clear();
        metric.labels.set("", 0);
      } else if (metric.type === "histogram") {
        metric.observations.clear();
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatValue(value: number): string {
  if (Number.isNaN(value)) return "NaN";
  if (value === Infinity) return "+Inf";
  if (value === -Infinity) return "-Inf";
  return String(value);
}
