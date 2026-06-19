// ---------------------------------------------------------------------------
// Health Checker — dependency health verification
// ---------------------------------------------------------------------------

/** Result of a single health check. */
export interface HealthCheckResult {
  name: string;
  status: "healthy" | "unhealthy";
  latencyMs: number;
  message?: string;
}

/** Aggregated health status across all checks. */
export interface HealthStatus {
  status: "healthy" | "degraded" | "unhealthy";
  checks: HealthCheckResult[];
}

/** A single health check function. */
export interface HealthCheck {
  name: string;
  check: () => Promise<HealthCheckResult>;
}

/** Options for constructing a HealthChecker. */
export interface HealthCheckerOptions {
  /** Timeout in ms for individual checks (default: 5000). */
  timeoutMs?: number;
}

// ---------------------------------------------------------------------------
// Built-in check factories
// ---------------------------------------------------------------------------

/**
 * Create a health check that verifies an HTTP endpoint is reachable.
 * Uses HEAD request with configurable timeout.
 */
export function httpCheck(name: string, url: string, timeoutMs = 5000): HealthCheck {
  return {
    name,
    check: async (): Promise<HealthCheckResult> => {
      const start = performance.now();
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        const response = await fetch(url, {
          method: "HEAD",
          signal: controller.signal,
        });
        clearTimeout(timer);
        const latencyMs = Math.round(performance.now() - start);
        const ok = response.ok || response.status === 405;
        return {
          name,
          status: ok ? "healthy" : "unhealthy",
          latencyMs,
          message: ok ? undefined : `HTTP ${response.status}`,
        };
      } catch (err: unknown) {
        const latencyMs = Math.round(performance.now() - start);
        const message = err instanceof Error ? err.message : String(err);
        return { name, status: "unhealthy", latencyMs, message };
      }
    },
  };
}

/**
 * Create a health check from an arbitrary async probe function.
 * The probe should throw on failure.
 */
export function customCheck(
  name: string,
  probe: () => Promise<void>,
  timeoutMs = 5000,
): HealthCheck {
  return {
    name,
    check: async (): Promise<HealthCheckResult> => {
      const start = performance.now();
      try {
        await Promise.race([
          probe(),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error("check timed out")), timeoutMs),
          ),
        ]);
        return {
          name,
          status: "healthy",
          latencyMs: Math.round(performance.now() - start),
        };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          name,
          status: "unhealthy",
          latencyMs: Math.round(performance.now() - start),
          message,
        };
      }
    },
  };
}

// ---------------------------------------------------------------------------
// HealthChecker
// ---------------------------------------------------------------------------

/**
 * Orchestrates multiple health checks and produces an aggregated status.
 *
 * Register checks via {@link addCheck}, then call {@link check} to run all
 * checks in parallel and get a unified {@link HealthStatus}.
 */
export class HealthChecker {
  private readonly checks: HealthCheck[] = [];
  private readonly timeoutMs: number;

  constructor(options: HealthCheckerOptions = {}) {
    this.timeoutMs = options.timeoutMs ?? 5000;
  }

  /** Register a health check. */
  addCheck(healthCheck: HealthCheck): this {
    this.checks.push(healthCheck);
    return this;
  }

  /** Convenience: register an HTTP reachability check. */
  addHttpCheck(name: string, url: string): this {
    return this.addCheck(httpCheck(name, url, this.timeoutMs));
  }

  /** Convenience: register a custom probe check. */
  addCustomCheck(name: string, probe: () => Promise<void>): this {
    return this.addCheck(customCheck(name, probe, this.timeoutMs));
  }

  /**
   * Run all registered checks in parallel and return aggregated status.
   *
   * - "healthy"   — all checks passed
   * - "degraded"  — at least one passed, at least one failed
   * - "unhealthy" — all checks failed (or no checks registered)
   */
  async check(): Promise<HealthStatus> {
    if (this.checks.length === 0) {
      return { status: "unhealthy", checks: [] };
    }

    const results = await Promise.all(
      this.checks.map((c) => c.check()),
    );

    const allHealthy = results.every((r) => r.status === "healthy");
    const anyHealthy = results.some((r) => r.status === "healthy");

    const status: HealthStatus["status"] = allHealthy
      ? "healthy"
      : anyHealthy
        ? "degraded"
        : "unhealthy";

    return { status, checks: results };
  }
}
