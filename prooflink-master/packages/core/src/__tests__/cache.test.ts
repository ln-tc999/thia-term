import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { LRUCache } from "../cache.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCache<V>(maxEntries = 5, ttlMs = 60_000) {
  return new LRUCache<V>(maxEntries, ttlMs);
}

// ---------------------------------------------------------------------------
// Basic get / set / has / delete
// ---------------------------------------------------------------------------

describe("LRUCache — basic operations", () => {
  it("returns undefined for a missing key", () => {
    const cache = makeCache();
    expect(cache.get("missing")).toBeUndefined();
  });

  it("stores and retrieves a value", () => {
    const cache = makeCache<string>();
    cache.set("key", "value");
    expect(cache.get("key")).toBe("value");
  });

  it("has() returns true for a present key", () => {
    const cache = makeCache<number>();
    cache.set("k", 42);
    expect(cache.has("k")).toBe(true);
  });

  it("has() returns false for a missing key", () => {
    const cache = makeCache<number>();
    expect(cache.has("nope")).toBe(false);
  });

  it("delete() removes a key and returns true", () => {
    const cache = makeCache<string>();
    cache.set("k", "v");
    const deleted = cache.delete("k");
    expect(deleted).toBe(true);
    expect(cache.get("k")).toBeUndefined();
  });

  it("delete() returns false for a non-existent key", () => {
    const cache = makeCache();
    expect(cache.delete("ghost")).toBe(false);
  });

  it("clear() empties the cache", () => {
    const cache = makeCache<string>();
    cache.set("a", "1");
    cache.set("b", "2");
    cache.clear();
    expect(cache.size).toBe(0);
    expect(cache.get("a")).toBeUndefined();
  });

  it("size reflects the number of stored entries", () => {
    const cache = makeCache<number>();
    expect(cache.size).toBe(0);
    cache.set("x", 1);
    expect(cache.size).toBe(1);
    cache.set("y", 2);
    expect(cache.size).toBe(2);
    cache.delete("x");
    expect(cache.size).toBe(1);
  });

  it("overwriting a key updates the value", () => {
    const cache = makeCache<number>();
    cache.set("k", 1);
    cache.set("k", 99);
    expect(cache.get("k")).toBe(99);
    expect(cache.size).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// TTL expiry
// ---------------------------------------------------------------------------

describe("LRUCache — TTL expiry", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns undefined for an expired entry", () => {
    const cache = makeCache<string>(10, 1_000); // 1 second TTL
    cache.set("k", "value");

    vi.advanceTimersByTime(1_001);

    expect(cache.get("k")).toBeUndefined();
  });

  it("returns value for a non-expired entry just before TTL", () => {
    const cache = makeCache<string>(10, 1_000);
    cache.set("k", "value");

    vi.advanceTimersByTime(999);

    expect(cache.get("k")).toBe("value");
  });

  it("has() returns false for an expired entry", () => {
    const cache = makeCache<string>(10, 500);
    cache.set("k", "value");

    vi.advanceTimersByTime(501);

    expect(cache.has("k")).toBe(false);
  });

  it("expired entry is removed from size when accessed", () => {
    const cache = makeCache<string>(10, 500);
    cache.set("k", "value");
    expect(cache.size).toBe(1);

    vi.advanceTimersByTime(501);

    cache.get("k"); // triggers cleanup
    expect(cache.size).toBe(0);
  });

  it("per-entry TTL override takes precedence over default TTL", () => {
    const cache = makeCache<string>(10, 60_000); // 60s default
    cache.set("short", "value", 100); // override to 100ms

    vi.advanceTimersByTime(101);

    expect(cache.get("short")).toBeUndefined();
  });

  it("default TTL applies when no per-entry override", () => {
    const cache = makeCache<string>(10, 1_000);
    cache.set("k", "value"); // uses default 1s TTL

    vi.advanceTimersByTime(999);
    expect(cache.get("k")).toBe("value");

    vi.advanceTimersByTime(2);
    expect(cache.get("k")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// LRU eviction
// ---------------------------------------------------------------------------

describe("LRUCache — LRU eviction", () => {
  it("evicts the least-recently-used entry when at capacity", () => {
    const cache = makeCache<number>(3);

    cache.set("a", 1);
    cache.set("b", 2);
    cache.set("c", 3);

    // "a" is LRU, adding "d" should evict "a"
    cache.set("d", 4);

    expect(cache.get("a")).toBeUndefined();
    expect(cache.get("b")).toBe(2);
    expect(cache.get("c")).toBe(3);
    expect(cache.get("d")).toBe(4);
    expect(cache.size).toBe(3);
  });

  it("accessing an entry promotes it to MRU", () => {
    const cache = makeCache<number>(3);

    cache.set("a", 1);
    cache.set("b", 2);
    cache.set("c", 3);

    // Access "a" to promote it
    cache.get("a");

    // Now "b" is LRU; adding "d" should evict "b"
    cache.set("d", 4);

    expect(cache.get("b")).toBeUndefined();
    expect(cache.get("a")).toBe(1);
    expect(cache.get("c")).toBe(3);
    expect(cache.get("d")).toBe(4);
  });

  it("re-setting an existing key counts as access (promotes to MRU)", () => {
    const cache = makeCache<number>(3);

    cache.set("a", 1);
    cache.set("b", 2);
    cache.set("c", 3);

    // Re-set "a" — should promote it to MRU
    cache.set("a", 10);

    // "b" is now LRU; adding "d" should evict "b"
    cache.set("d", 4);

    expect(cache.get("b")).toBeUndefined();
    expect(cache.get("a")).toBe(10);
  });

  it("never exceeds maxEntries", () => {
    const maxEntries = 5;
    const cache = makeCache<number>(maxEntries);

    for (let i = 0; i < 20; i++) {
      cache.set(`key${i}`, i);
    }

    expect(cache.size).toBe(maxEntries);
  });
});

// ---------------------------------------------------------------------------
// prune
// ---------------------------------------------------------------------------

describe("LRUCache — prune", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("prune() removes expired entries and returns count", () => {
    const cache = makeCache<string>(10, 500);
    cache.set("expired1", "a");
    cache.set("expired2", "b");
    cache.set("fresh", "c", 60_000);

    vi.advanceTimersByTime(501);

    const evicted = cache.prune();
    expect(evicted).toBe(2);
    expect(cache.size).toBe(1);
    expect(cache.get("fresh")).toBe("c");
  });

  it("prune() returns 0 when no entries have expired", () => {
    const cache = makeCache<string>(10, 60_000);
    cache.set("a", "x");
    cache.set("b", "y");

    const evicted = cache.prune();
    expect(evicted).toBe(0);
    expect(cache.size).toBe(2);
  });

  it("prune() returns 0 on an empty cache", () => {
    const cache = makeCache<string>();
    expect(cache.prune()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Auto cleanup
// ---------------------------------------------------------------------------

describe("LRUCache — auto cleanup", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("startAutoCleanup() periodically prunes expired entries", () => {
    const cache = makeCache<string>(10, 500);
    cache.set("a", "1");
    cache.set("b", "2");

    cache.startAutoCleanup(1_000);

    // Advance past entry TTL but before first cleanup tick
    vi.advanceTimersByTime(600);
    // Entries are expired but not yet pruned (no access)
    // Internal map still has them
    expect(cache.size).toBe(0); // size calls prune()

    // Add fresh entries
    cache.set("c", "3");
    cache.set("d", "4");

    // Advance past TTL again and past the cleanup interval
    vi.advanceTimersByTime(1_100);

    // Auto-cleanup should have pruned the expired entries
    // size triggers prune too, but the interval should have already cleaned up
    expect(cache.size).toBe(0);

    cache.stopAutoCleanup();
  });

  it("stopAutoCleanup() stops the periodic pruning", () => {
    const cache = makeCache<string>(10, 500);
    const pruneSpy = vi.spyOn(cache, "prune");

    cache.startAutoCleanup(1_000);
    vi.advanceTimersByTime(2_500);
    const callsBeforeStop = pruneSpy.mock.calls.length;
    expect(callsBeforeStop).toBeGreaterThanOrEqual(2);

    cache.stopAutoCleanup();
    pruneSpy.mockClear();

    vi.advanceTimersByTime(5_000);
    expect(pruneSpy).not.toHaveBeenCalled();

    pruneSpy.mockRestore();
  });

  it("calling startAutoCleanup() twice replaces the previous timer", () => {
    const cache = makeCache<string>(10, 500);
    const pruneSpy = vi.spyOn(cache, "prune");

    cache.startAutoCleanup(1_000);
    cache.startAutoCleanup(2_000);

    vi.advanceTimersByTime(3_000);
    // With 2s interval and 3s elapsed, should fire once (at 2s)
    expect(pruneSpy.mock.calls.length).toBe(1);

    cache.stopAutoCleanup();
    pruneSpy.mockRestore();
  });

  it("stopAutoCleanup() is safe to call when no timer is active", () => {
    const cache = makeCache<string>();
    expect(() => cache.stopAutoCleanup()).not.toThrow();
  });
});
