import type { RateLimitTier, Logger } from "./types.js";

// ---------------------------------------------------------------------------
// Sliding window rate limiter
// ---------------------------------------------------------------------------

/** Result of a rate limit check */
export interface RateLimitResult {
  allowed: boolean;
  /** Remaining requests in the current window */
  remaining: number;
  /** Total limit for this tier */
  limit: number;
  /** Unix timestamp (seconds) when the window resets */
  resetAt: number;
  /** Retry-After in seconds (0 if allowed) */
  retryAfterSeconds: number;
}

/** Individual request timestamp entry */
interface WindowEntry {
  timestamps: number[];
}

/**
 * In-memory sliding window rate limiter.
 *
 * Tracks request timestamps per key (typically a wallet address) and
 * enforces configurable limits by tier. Uses a sliding window — older
 * entries outside the window are pruned on each check.
 */
export class RateLimiter {
  private readonly tiers: ReadonlyMap<string, RateLimitTier>;
  private readonly defaultTier: RateLimitTier;
  private readonly windows = new Map<string, WindowEntry>();
  private readonly logger?: Logger;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor(options: {
    tiers?: Record<string, RateLimitTier>;
    defaultTier?: RateLimitTier;
    logger?: Logger;
    /** Interval in ms for pruning stale entries (default 60000) */
    cleanupIntervalMs?: number;
  }) {
    this.tiers = new Map(Object.entries(options.tiers ?? {}));
    this.defaultTier = options.defaultTier ?? { maxRequests: 100, windowSeconds: 60 };
    this.logger = options.logger;

    const cleanupMs = options.cleanupIntervalMs ?? 60_000;
    this.cleanupTimer = setInterval(() => this.pruneStaleEntries(), cleanupMs);
    if (typeof this.cleanupTimer === "object" && "unref" in this.cleanupTimer) {
      this.cleanupTimer.unref();
    }
  }

  /**
   * Check if a request from `key` is allowed under the given tier.
   * If allowed, the request is recorded.
   */
  check(key: string, tierName?: string): RateLimitResult {
    const tier = tierName ? this.tiers.get(tierName) ?? this.defaultTier : this.defaultTier;
    const now = Date.now();
    const windowStartMs = now - tier.windowSeconds * 1000;

    // Get or create the window entry
    let entry = this.windows.get(key);
    if (!entry) {
      entry = { timestamps: [] };
      this.windows.set(key, entry);
    }

    // Prune timestamps outside the window
    entry.timestamps = entry.timestamps.filter((t) => t > windowStartMs);

    const count = entry.timestamps.length;
    const resetAt = Math.ceil((now + tier.windowSeconds * 1000) / 1000);

    if (count >= tier.maxRequests) {
      // Find when the oldest entry in window will expire
      const oldestInWindow = entry.timestamps[0];
      const retryAfterMs = oldestInWindow
        ? oldestInWindow + tier.windowSeconds * 1000 - now
        : tier.windowSeconds * 1000;

      this.logger?.debug(`Rate limit exceeded for ${key}`, {
        tier: tierName ?? "default",
        count,
        limit: tier.maxRequests,
      });

      return {
        allowed: false,
        remaining: 0,
        limit: tier.maxRequests,
        resetAt,
        retryAfterSeconds: Math.ceil(Math.max(retryAfterMs, 0) / 1000),
      };
    }

    // Record this request
    entry.timestamps.push(now);

    return {
      allowed: true,
      remaining: tier.maxRequests - count - 1,
      limit: tier.maxRequests,
      resetAt,
      retryAfterSeconds: 0,
    };
  }

  /**
   * Get current rate limit status for a key without recording a request.
   */
  peek(key: string, tierName?: string): RateLimitResult {
    const tier = tierName ? this.tiers.get(tierName) ?? this.defaultTier : this.defaultTier;
    const now = Date.now();
    const windowStartMs = now - tier.windowSeconds * 1000;

    const entry = this.windows.get(key);
    const timestamps = entry?.timestamps.filter((t) => t > windowStartMs) ?? [];
    const count = timestamps.length;
    const resetAt = Math.ceil((now + tier.windowSeconds * 1000) / 1000);

    return {
      allowed: count < tier.maxRequests,
      remaining: Math.max(tier.maxRequests - count, 0),
      limit: tier.maxRequests,
      resetAt,
      retryAfterSeconds: 0,
    };
  }

  /**
   * Reset rate limit state for a specific key.
   */
  reset(key: string): void {
    this.windows.delete(key);
  }

  /**
   * Reset all rate limit state.
   */
  resetAll(): void {
    this.windows.clear();
  }

  /**
   * Remove entries that have no timestamps within any tier's window.
   */
  private pruneStaleEntries(): void {
    const now = Date.now();
    // Use the largest window across all tiers for conservative pruning
    let maxWindowMs = this.defaultTier.windowSeconds * 1000;
    for (const tier of this.tiers.values()) {
      maxWindowMs = Math.max(maxWindowMs, tier.windowSeconds * 1000);
    }

    const cutoff = now - maxWindowMs;
    for (const [key, entry] of this.windows) {
      entry.timestamps = entry.timestamps.filter((t) => t > cutoff);
      if (entry.timestamps.length === 0) {
        this.windows.delete(key);
      }
    }
  }

  /**
   * Cleanup resources (stop periodic pruning timer).
   */
  destroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    this.windows.clear();
  }

  /** Number of tracked keys */
  get size(): number {
    return this.windows.size;
  }
}
