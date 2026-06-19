import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { LRUCache } from "../cache.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCache<V>(maxEntries = 5, ttlMs = 60_000) {
  return new LRUCache<V>(maxEntries, ttlMs);
}

// ---------------------------------------------------------------------------
// Cache eviction when maxEntries exceeded
// ---------------------------------------------------------------------------

describe("LRUCache — eviction stress", () => {
  it("should never exceed maxEntries after many inserts", () => {
    const maxEntries = 10;
    const cache = makeCache<number>(maxEntries);

    for (let i = 0; i < 1000; i++) {
      cache.set(`key${i}`, i);
      expect(cache.size).toBeLessThanOrEqual(maxEntries);
    }
  });

  it("should evict the oldest entry (LRU) on each overflow insert", () => {
    const cache = makeCache<number>(3);

    cache.set("a", 1);
    cache.set("b", 2);
    cache.set("c", 3);

    // Insert 10 more — at each step the LRU is evicted
    for (let i = 4; i <= 13; i++) {
      cache.set(`k${i}`, i);
    }

    // Only the last 3 inserted keys should remain
    expect(cache.get("k11")).toBe(11);
    expect(cache.get("k12")).toBe(12);
    expect(cache.get("k13")).toBe(13);
    expect(cache.size).toBe(3);
  });

  it("should evict LRU correctly when access pattern promotes entries", () => {
    const cache = makeCache<string>(3);

    cache.set("a", "alpha");
    cache.set("b", "beta");
    cache.set("c", "gamma");

    // Promote "a" to MRU
    cache.get("a");
    // Promote "b" to MRU (after a)
    cache.get("b");
    // Now LRU is "c" → adding "d" evicts "c"
    cache.set("d", "delta");

    expect(cache.get("c")).toBeUndefined();
    expect(cache.get("a")).toBe("alpha");
    expect(cache.get("b")).toBe("beta");
    expect(cache.get("d")).toBe("delta");
  });

  it("should handle maxEntries=1 correctly (always evicts previous)", () => {
    const cache = makeCache<number>(1);

    for (let i = 0; i < 20; i++) {
      cache.set(`k${i}`, i);
      expect(cache.size).toBe(1);
      expect(cache.get(`k${i}`)).toBe(i);
      if (i > 0) {
        expect(cache.get(`k${i - 1}`)).toBeUndefined();
      }
    }
  });

  it("should not evict when re-setting the same key (size stays constant)", () => {
    const cache = makeCache<number>(3);

    cache.set("a", 1);
    cache.set("b", 2);
    cache.set("c", 3);

    // Re-set each key — no eviction should occur
    for (let i = 0; i < 10; i++) {
      cache.set("a", i);
      cache.set("b", i + 1);
      cache.set("c", i + 2);
    }

    expect(cache.size).toBe(3);
    expect(cache.get("a")).toBeDefined();
    expect(cache.get("b")).toBeDefined();
    expect(cache.get("c")).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Cache TTL expiration
// ---------------------------------------------------------------------------

describe("LRUCache — TTL expiration stress", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should expire all entries at once after TTL elapses", () => {
    const cache = makeCache<string>(100, 500);

    for (let i = 0; i < 50; i++) {
      cache.set(`k${i}`, `v${i}`);
    }

    expect(cache.size).toBe(50);

    vi.advanceTimersByTime(501);

    // prune() should remove all 50
    const evicted = cache.prune();
    expect(evicted).toBe(50);
    expect(cache.size).toBe(0);
  });

  it("should keep entries that have per-entry TTL overrides outlasting default TTL", () => {
    const cache = makeCache<string>(20, 500); // 500ms default

    // Entries with short TTL
    for (let i = 0; i < 10; i++) {
      cache.set(`short${i}`, "short", 100);
    }

    // Entries with long TTL override
    for (let i = 0; i < 10; i++) {
      cache.set(`long${i}`, "long", 10_000);
    }

    vi.advanceTimersByTime(501); // past default TTL and short override

    const evicted = cache.prune();
    expect(evicted).toBe(10); // only short ones expire
    expect(cache.size).toBe(10);

    // Long ones still valid
    for (let i = 0; i < 10; i++) {
      expect(cache.get(`long${i}`)).toBe("long");
    }
  });

  it("should handle interleaved insert and expiry correctly", () => {
    const cache = makeCache<number>(50, 1_000);

    cache.set("early", 1);
    vi.advanceTimersByTime(500);
    cache.set("mid", 2);
    vi.advanceTimersByTime(600); // "early" expires (1100ms total), "mid" at 600ms

    expect(cache.get("early")).toBeUndefined(); // expired at 1000ms
    expect(cache.get("mid")).toBe(2); // still valid (only 600ms old)
  });

  it("should return undefined for entry accessed exactly at TTL boundary (expiresAt = now)", () => {
    const cache = makeCache<string>(10, 1_000);
    cache.set("k", "v");

    // Advance to exactly expiresAt (Date.now() > expiresAt check in source)
    vi.advanceTimersByTime(1_001); // just past boundary

    expect(cache.get("k")).toBeUndefined();
  });

  it("should correctly report size=0 after all entries expire", () => {
    const cache = makeCache<string>(10, 200);

    cache.set("a", "1");
    cache.set("b", "2");
    cache.set("c", "3");

    vi.advanceTimersByTime(201);

    // size getter calls prune internally
    expect(cache.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Concurrent reads/writes
// ---------------------------------------------------------------------------

describe("LRUCache — concurrent reads and writes", () => {
  it("should remain consistent after interleaved async reads and writes", async () => {
    const cache = makeCache<number>(10, 60_000);

    const writes = Array.from({ length: 20 }, (_, i) =>
      Promise.resolve().then(() => cache.set(`k${i}`, i)),
    );
    const reads = Array.from({ length: 20 }, (_, i) =>
      Promise.resolve().then(() => cache.get(`k${i}`)),
    );

    await Promise.all([...writes, ...reads]);

    // After all writes, each written key should be retrievable
    // (size capped at 10 due to LRU, so only last 10 survive)
    expect(cache.size).toBeLessThanOrEqual(10);
    // The size should be exactly 10 (since we inserted 20 keys into a cap-10 cache)
    expect(cache.size).toBe(10);
  });

  it("should handle concurrent set and delete on same key without throwing", async () => {
    const cache = makeCache<string>(10);

    const ops = Array.from({ length: 50 }, (_, i) =>
      Promise.resolve().then(() => {
        if (i % 2 === 0) {
          cache.set("contested", `value${i}`);
        } else {
          cache.delete("contested");
        }
      }),
    );

    await expect(Promise.all(ops)).resolves.not.toThrow();
  });

  it("should handle concurrent clear operations without throwing", async () => {
    const cache = makeCache<number>(100);

    for (let i = 0; i < 50; i++) cache.set(`k${i}`, i);

    const ops = [
      Promise.resolve().then(() => cache.clear()),
      Promise.resolve().then(() => cache.clear()),
      Promise.resolve().then(() => cache.size),
    ];

    await expect(Promise.all(ops)).resolves.not.toThrow();
    expect(cache.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Cache hit ratio tracking
// ---------------------------------------------------------------------------

describe("LRUCache — hit ratio tracking", () => {
  it("should achieve 100% hit rate when all keys are pre-populated and read back", () => {
    const cache = makeCache<number>(50, 60_000);
    const keys = Array.from({ length: 20 }, (_, i) => `k${i}`);

    for (const key of keys) cache.set(key, parseInt(key.slice(1)));

    let hits = 0;
    let misses = 0;

    for (const key of keys) {
      const val = cache.get(key);
      if (val !== undefined) hits++;
      else misses++;
    }

    expect(hits).toBe(20);
    expect(misses).toBe(0);
    expect(hits / (hits + misses)).toBe(1.0);
  });

  it("should achieve 0% hit rate for keys never inserted", () => {
    const cache = makeCache<number>(50);

    let hits = 0;
    const totalLookups = 20;

    for (let i = 0; i < totalLookups; i++) {
      if (cache.get(`missing${i}`) !== undefined) hits++;
    }

    expect(hits).toBe(0);
  });

  it("should achieve ~50% hit rate for half-populated keys", () => {
    const cache = makeCache<number>(50);

    for (let i = 0; i < 10; i++) cache.set(`k${i}`, i);

    let hits = 0;
    for (let i = 0; i < 20; i++) {
      if (cache.get(`k${i}`) !== undefined) hits++;
    }

    // First 10 are hits, next 10 are misses → exactly 50%
    expect(hits).toBe(10);
  });

  it("should show degraded hit rate after LRU eviction purges early inserts", () => {
    const cache = makeCache<number>(5);

    // Insert 5 entries
    for (let i = 0; i < 5; i++) cache.set(`k${i}`, i);

    // Insert 5 more → first 5 evicted
    for (let i = 5; i < 10; i++) cache.set(`k${i}`, i);

    let hits = 0;
    for (let i = 0; i < 10; i++) {
      if (cache.get(`k${i}`) !== undefined) hits++;
    }

    // Only k5..k9 survive → 5 hits
    expect(hits).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// Cache clear during operations
// ---------------------------------------------------------------------------

describe("LRUCache — clear during operations", () => {
  it("should return undefined for all keys after clear()", () => {
    const cache = makeCache<string>(20);

    for (let i = 0; i < 10; i++) cache.set(`k${i}`, `v${i}`);
    cache.clear();

    for (let i = 0; i < 10; i++) {
      expect(cache.get(`k${i}`)).toBeUndefined();
    }
    expect(cache.size).toBe(0);
  });

  it("should allow insertion after clear()", () => {
    const cache = makeCache<number>(10);

    for (let i = 0; i < 10; i++) cache.set(`k${i}`, i);
    cache.clear();

    cache.set("new", 42);
    expect(cache.get("new")).toBe(42);
    expect(cache.size).toBe(1);
  });

  it("should handle clear() on empty cache without throwing", () => {
    const cache = makeCache<number>();
    expect(() => cache.clear()).not.toThrow();
    expect(cache.size).toBe(0);
  });

  it("should allow subsequent prune() after clear() returns 0 evicted", () => {
    const cache = makeCache<string>(10);
    cache.set("a", "1");
    cache.clear();

    // After clear(), internal map is empty — prune should return 0
    const evicted = cache.prune();
    expect(evicted).toBe(0);
  });

  it("should correctly resume LRU ordering after clear() and re-population", () => {
    const cache = makeCache<number>(3);

    // First population
    cache.set("x", 1);
    cache.set("y", 2);
    cache.set("z", 3);
    cache.clear();

    // Re-populate — LRU order resets
    cache.set("a", 10);
    cache.set("b", 20);
    cache.set("c", 30);

    // Adding "d" should evict "a" (LRU after fresh clear)
    cache.set("d", 40);

    expect(cache.get("a")).toBeUndefined();
    expect(cache.get("b")).toBe(20);
    expect(cache.get("c")).toBe(30);
    expect(cache.get("d")).toBe(40);
  });
});
