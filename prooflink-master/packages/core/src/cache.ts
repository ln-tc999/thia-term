/**
 * Generic LRU cache with TTL support.
 *
 * Used for sanctions screening results, KYA credentials, and any other
 * data that benefits from short-lived caching to meet latency budgets.
 */
export class LRUCache<V> {
  private readonly map = new Map<string, { value: V; expiresAt: number }>();
  private readonly maxEntries: number;
  private readonly ttlMs: number;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  /**
   * Create an LRU cache.
   * @param maxEntries - Maximum number of entries before eviction
   * @param ttlMs - Time-to-live in milliseconds for each entry
   */
  constructor(maxEntries: number, ttlMs: number) {
    this.maxEntries = maxEntries;
    this.ttlMs = ttlMs;
  }

  /**
   * Retrieve a value from the cache.
   * Returns `undefined` if the key is missing or the entry has expired.
   * Accessing a live entry promotes it to most-recently-used.
   */
  get(key: string): V | undefined {
    const entry = this.map.get(key);
    if (!entry) return undefined;

    if (Date.now() > entry.expiresAt) {
      this.map.delete(key);
      return undefined;
    }

    // Promote to most-recently-used by re-inserting
    this.map.delete(key);
    this.map.set(key, entry);
    return entry.value;
  }

  /**
   * Store a value in the cache.
   * Evicts the least-recently-used entry if the cache is at capacity.
   * @param ttlMs - Optional per-entry TTL override
   */
  set(key: string, value: V, ttlMs?: number): void {
    // Delete first so re-insert goes to end of iteration order
    this.map.delete(key);

    if (this.map.size >= this.maxEntries) {
      // Evict the least-recently-used (first key in iteration order)
      const firstKey = this.map.keys().next().value;
      if (firstKey !== undefined) {
        this.map.delete(firstKey);
      }
    }

    this.map.set(key, {
      value,
      expiresAt: Date.now() + (ttlMs ?? this.ttlMs),
    });
  }

  /**
   * Check if a non-expired entry exists for the given key.
   */
  has(key: string): boolean {
    return this.get(key) !== undefined;
  }

  /**
   * Remove a specific entry from the cache.
   */
  delete(key: string): boolean {
    return this.map.delete(key);
  }

  /**
   * Remove all entries from the cache.
   */
  clear(): void {
    this.map.clear();
  }

  /**
   * Current number of live (non-expired) entries.
   * Prunes expired entries before counting.
   */
  get size(): number {
    this.prune();
    return this.map.size;
  }

  /**
   * Evict all expired entries. Call periodically to free memory.
   */
  prune(): number {
    const now = Date.now();
    let evicted = 0;
    for (const [key, entry] of this.map) {
      if (now > entry.expiresAt) {
        this.map.delete(key);
        evicted++;
      }
    }
    return evicted;
  }

  /**
   * Start a periodic background cleanup that calls `prune()` on an interval.
   * Only one cleanup timer is active at a time — calling again replaces the
   * previous timer.
   * @param intervalMs - How often to prune expired entries (milliseconds)
   */
  startAutoCleanup(intervalMs: number): void {
    this.stopAutoCleanup();
    this.cleanupTimer = setInterval(() => {
      this.prune();
    }, intervalMs);
    // Allow the Node.js process to exit even if the timer is active
    if (typeof this.cleanupTimer === "object" && "unref" in this.cleanupTimer) {
      this.cleanupTimer.unref();
    }
  }

  /**
   * Stop the periodic background cleanup timer.
   */
  stopAutoCleanup(): void {
    if (this.cleanupTimer !== null) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }
}
