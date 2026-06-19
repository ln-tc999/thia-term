import { describe, it, expect } from "vitest";
import {
  sha256,
  sha3_256Stub,
  domainSeparatorHashOffChain,
  generateReceiptId,
  hashJsonDeterministic,
  computeReceiptHashOffChain,
} from "../utils/crypto.js";
import type { ReceiptPrefix } from "../utils/crypto.js";

// ---------------------------------------------------------------------------
// sha256
// ---------------------------------------------------------------------------

describe("sha256", () => {
  it("returns a 64-character hex string", () => {
    const hash = sha256("hello");
    expect(hash).toHaveLength(64);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("produces deterministic output for the same input", () => {
    expect(sha256("test")).toBe(sha256("test"));
  });

  it("produces different output for different inputs", () => {
    expect(sha256("abc")).not.toBe(sha256("def"));
  });

  it("matches known SHA-256 value for 'abc'", () => {
    // Known SHA-256 of "abc"
    expect(sha256("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("accepts a Buffer input", () => {
    const hash = sha256(Buffer.from("hello"));
    expect(hash).toHaveLength(64);
  });

  it("string and Buffer inputs produce same hash for same bytes", () => {
    expect(sha256("hello")).toBe(sha256(Buffer.from("hello")));
  });

  it("empty string produces a known sha256 hash", () => {
    expect(sha256("")).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });

  it("produces different hashes for strings differing only in case", () => {
    expect(sha256("Hello")).not.toBe(sha256("hello"));
  });

  it("produces different hashes for strings differing by whitespace", () => {
    expect(sha256("abc")).not.toBe(sha256("abc "));
    expect(sha256("abc")).not.toBe(sha256(" abc"));
  });

  it("handles binary data in Buffer", () => {
    const buf = Buffer.from([0x00, 0xff, 0x80, 0x40]);
    const hash = sha256(buf);
    expect(hash).toHaveLength(64);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });
});

// ---------------------------------------------------------------------------
// sha3_256Stub
// ---------------------------------------------------------------------------

describe("sha3_256Stub", () => {
  it("returns a 64-character hex string", () => {
    const hash = sha3_256Stub("hello");
    expect(hash).toHaveLength(64);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("differs from sha256 for the same input", () => {
    // SHA-3 and SHA-2 produce different results
    expect(sha3_256Stub("abc")).not.toBe(sha256("abc"));
  });

  it("is deterministic", () => {
    expect(sha3_256Stub("test")).toBe(sha3_256Stub("test"));
  });

  it("produces different output for different inputs", () => {
    expect(sha3_256Stub("abc")).not.toBe(sha3_256Stub("def"));
  });

  it("accepts Buffer input", () => {
    const hash = sha3_256Stub(Buffer.from("hello"));
    expect(hash).toHaveLength(64);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("string and Buffer produce same hash for same bytes", () => {
    expect(sha3_256Stub("hello")).toBe(sha3_256Stub(Buffer.from("hello")));
  });

  it("empty string is different from sha256 empty string", () => {
    expect(sha3_256Stub("")).not.toBe(sha256(""));
  });
});

// ---------------------------------------------------------------------------
// domainSeparatorHashOffChain
// ---------------------------------------------------------------------------

describe("domainSeparatorHashOffChain", () => {
  it("returns a 64-char hex hash", () => {
    const hash = domainSeparatorHashOffChain(
      "ProofLink",
      "1",
      8453,
      "0xabcdef1234567890abcdef1234567890abcdef12",
    );
    expect(hash).toHaveLength(64);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is deterministic", () => {
    const args = [
      "ProofLink",
      "1",
      8453,
      "0xabcdef1234567890abcdef1234567890abcdef12",
    ] as const;
    expect(domainSeparatorHashOffChain(...args)).toBe(
      domainSeparatorHashOffChain(...args),
    );
  });

  it("differs when name changes", () => {
    const base = domainSeparatorHashOffChain(
      "ProofLink",
      "1",
      1,
      "0x1234567890abcdef1234567890abcdef12345678",
    );
    const changed = domainSeparatorHashOffChain(
      "OtherApp",
      "1",
      1,
      "0x1234567890abcdef1234567890abcdef12345678",
    );
    expect(base).not.toBe(changed);
  });

  it("differs when version changes", () => {
    const v1 = domainSeparatorHashOffChain(
      "ProofLink",
      "1",
      1,
      "0x1234567890abcdef1234567890abcdef12345678",
    );
    const v2 = domainSeparatorHashOffChain(
      "ProofLink",
      "2",
      1,
      "0x1234567890abcdef1234567890abcdef12345678",
    );
    expect(v1).not.toBe(v2);
  });

  it("differs when chainId changes", () => {
    const mainnet = domainSeparatorHashOffChain(
      "App",
      "1",
      1,
      "0x1234567890abcdef1234567890abcdef12345678",
    );
    const testnet = domainSeparatorHashOffChain(
      "App",
      "1",
      11155111,
      "0x1234567890abcdef1234567890abcdef12345678",
    );
    expect(mainnet).not.toBe(testnet);
  });

  it("differs when verifyingContract changes", () => {
    const c1 = domainSeparatorHashOffChain(
      "App",
      "1",
      1,
      "0x1111111111111111111111111111111111111111",
    );
    const c2 = domainSeparatorHashOffChain(
      "App",
      "1",
      1,
      "0x2222222222222222222222222222222222222222",
    );
    expect(c1).not.toBe(c2);
  });

  it("is resistant to cross-field collisions (name+version boundary)", () => {
    // name="ab", version="c" must not equal name="a", version="bc"
    const h1 = domainSeparatorHashOffChain(
      "ab",
      "c",
      1,
      "0x1234567890abcdef1234567890abcdef12345678",
    );
    const h2 = domainSeparatorHashOffChain(
      "a",
      "bc",
      1,
      "0x1234567890abcdef1234567890abcdef12345678",
    );
    expect(h1).not.toBe(h2);
  });

  it("is resistant to cross-field collisions (chainId+contract boundary)", () => {
    // chainId=18, contract="453..." vs chainId=184, contract="53..."
    const h1 = domainSeparatorHashOffChain(
      "App",
      "1",
      18,
      "0x453000000000000000000000000000000000abcd",
    );
    const h2 = domainSeparatorHashOffChain(
      "App",
      "1",
      184,
      "0x53000000000000000000000000000000000abcd0",
    );
    expect(h1).not.toBe(h2);
  });

  it("produces same hash for equivalent inputs on mainnet and testnet when params match", () => {
    // Two chains with the same numeric ID would produce the same hash — this confirms
    // that collisions only come from truly identical inputs.
    const h1 = domainSeparatorHashOffChain("App", "1", 1, "0x" + "1".repeat(40));
    const h2 = domainSeparatorHashOffChain("App", "1", 1, "0x" + "1".repeat(40));
    expect(h1).toBe(h2);
  });
});

// ---------------------------------------------------------------------------
// generateReceiptId
// ---------------------------------------------------------------------------

describe("generateReceiptId", () => {
  const prefixes: ReceiptPrefix[] = ["scr", "kya", "trl", "inv", "cmp", "stl"];

  it.each(prefixes)("generates a receipt with prefix '%s'", (prefix) => {
    const id = generateReceiptId(prefix);
    expect(id).toMatch(new RegExp(`^${prefix}_[0-9a-f]{32}$`));
  });

  it("generates unique IDs on repeated calls", () => {
    const ids = new Set(
      Array.from({ length: 100 }, () => generateReceiptId("scr")),
    );
    expect(ids.size).toBe(100);
  });

  it("generates IDs with consistent structure (prefix_uuid-no-dashes)", () => {
    const id = generateReceiptId("cmp");
    const parts = id.split("_");
    expect(parts).toHaveLength(2);
    expect(parts[0]).toBe("cmp");
    expect(parts[1]).toHaveLength(32); // UUID without dashes
  });

  it("different prefixes produce IDs with correct prefixes", () => {
    for (const prefix of prefixes) {
      const id = generateReceiptId(prefix);
      expect(id.startsWith(`${prefix}_`)).toBe(true);
    }
  });

  it("generates 1000 unique IDs across all prefixes", () => {
    const allIds = prefixes.flatMap((prefix) =>
      Array.from({ length: 100 }, () => generateReceiptId(prefix)),
    );
    const unique = new Set(allIds);
    // Cross-prefix collisions are astronomically unlikely but we check uniqueness
    expect(unique.size).toBe(allIds.length);
  });
});

// ---------------------------------------------------------------------------
// hashJsonDeterministic
// ---------------------------------------------------------------------------

describe("hashJsonDeterministic", () => {
  it("returns a 64-char hex hash", () => {
    const hash = hashJsonDeterministic({ a: 1, b: 2 });
    expect(hash).toHaveLength(64);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("produces the same hash regardless of key insertion order", () => {
    const h1 = hashJsonDeterministic({ a: 1, b: 2 });
    const h2 = hashJsonDeterministic({ b: 2, a: 1 });
    expect(h1).toBe(h2);
  });

  it("produces different hashes for different values", () => {
    const h1 = hashJsonDeterministic({ a: 1 });
    const h2 = hashJsonDeterministic({ a: 2 });
    expect(h1).not.toBe(h2);
  });

  it("produces different hashes for different key sets", () => {
    const h1 = hashJsonDeterministic({ a: 1 });
    const h2 = hashJsonDeterministic({ b: 1 });
    expect(h1).not.toBe(h2);
  });

  it("is deterministic across multiple calls", () => {
    const obj = { receiptId: "cmp_001", status: "APPROVED", riskScore: 5 };
    expect(hashJsonDeterministic(obj)).toBe(hashJsonDeterministic(obj));
  });

  it("empty object produces a consistent hash", () => {
    expect(hashJsonDeterministic({})).toBe(hashJsonDeterministic({}));
    expect(hashJsonDeterministic({})).toHaveLength(64);
  });

  it("produces different hashes for empty vs non-empty object", () => {
    expect(hashJsonDeterministic({})).not.toBe(hashJsonDeterministic({ a: 1 }));
  });

  it("correctly hashes nested objects with different values", () => {
    const h1 = hashJsonDeterministic({ a: { x: 1 } });
    const h2 = hashJsonDeterministic({ a: { x: 2 } });
    expect(h1).not.toBe(h2);
  });

  it("produces the same hash for nested objects regardless of key order", () => {
    const h1 = hashJsonDeterministic({ a: { y: 2, x: 1 } });
    const h2 = hashJsonDeterministic({ a: { x: 1, y: 2 } });
    expect(h1).toBe(h2);
  });

  it("handles deeply nested objects deterministically", () => {
    const h1 = hashJsonDeterministic({ a: { b: { d: 4, c: 3 } } });
    const h2 = hashJsonDeterministic({ a: { b: { c: 3, d: 4 } } });
    expect(h1).toBe(h2);
  });

  it("handles arrays preserving order", () => {
    const h1 = hashJsonDeterministic({ a: [1, 2, 3] });
    const h2 = hashJsonDeterministic({ a: [3, 2, 1] });
    expect(h1).not.toBe(h2);
  });

  it("handles null values", () => {
    const h1 = hashJsonDeterministic({ a: null, b: 1 });
    const h2 = hashJsonDeterministic({ b: 1, a: null });
    expect(h1).toBe(h2);
  });

  it("produces different hashes for string vs number values", () => {
    // JSON serialization distinguishes "1" (string) from 1 (number)
    const h1 = hashJsonDeterministic({ a: "1" });
    const h2 = hashJsonDeterministic({ a: 1 });
    expect(h1).not.toBe(h2);
  });

  it("3 keys with different orderings all produce the same hash", () => {
    const orderings = [
      { a: 1, b: 2, c: 3 },
      { b: 2, a: 1, c: 3 },
      { c: 3, b: 2, a: 1 },
      { a: 1, c: 3, b: 2 },
    ];
    const hashes = orderings.map((o) => hashJsonDeterministic(o));
    const unique = new Set(hashes);
    expect(unique.size).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// computeReceiptHashOffChain
// ---------------------------------------------------------------------------

describe("computeReceiptHashOffChain", () => {
  it("returns a 64-char hex hash", () => {
    const hash = computeReceiptHashOffChain("0xabc", 8453, 1_700_000_000_000);
    expect(hash).toHaveLength(64);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is deterministic", () => {
    const args = ["0xabc", 8453, 1_700_000_000_000] as const;
    expect(computeReceiptHashOffChain(...args)).toBe(
      computeReceiptHashOffChain(...args),
    );
  });

  it("differs when txHash changes", () => {
    const h1 = computeReceiptHashOffChain("0xabc", 1, 1_000);
    const h2 = computeReceiptHashOffChain("0xdef", 1, 1_000);
    expect(h1).not.toBe(h2);
  });

  it("differs when chainId changes", () => {
    const h1 = computeReceiptHashOffChain("0xabc", 1, 1_000);
    const h2 = computeReceiptHashOffChain("0xabc", 8453, 1_000);
    expect(h1).not.toBe(h2);
  });

  it("differs when timestamp changes", () => {
    const h1 = computeReceiptHashOffChain("0xabc", 1, 1_000);
    const h2 = computeReceiptHashOffChain("0xabc", 1, 2_000);
    expect(h1).not.toBe(h2);
  });

  it("is resistant to cross-field collisions (txHash+chainId boundary)", () => {
    // "0xabc\x001\x001000" must not equal "0xabc1\x00\x001000"
    const h1 = computeReceiptHashOffChain("0xabc", 1, 1_000);
    const h2 = computeReceiptHashOffChain("0xabc1", 0, 1_000);
    expect(h1).not.toBe(h2);
  });

  it("is resistant to cross-field collisions (chainId+timestamp boundary)", () => {
    // chainId=11, timestamp=1000 vs chainId=1, timestamp=11000
    const h1 = computeReceiptHashOffChain("0x1", 11, 1_000);
    const h2 = computeReceiptHashOffChain("0x1", 1, 11_000);
    expect(h1).not.toBe(h2);
  });

  it("handles zero timestamp", () => {
    const hash = computeReceiptHashOffChain("0xabc", 1, 0);
    expect(hash).toHaveLength(64);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("handles zero chainId", () => {
    const hash = computeReceiptHashOffChain("0xabc", 0, 1000);
    expect(hash).toHaveLength(64);
  });

  it("handles empty txHash string", () => {
    const hash = computeReceiptHashOffChain("", 1, 1000);
    expect(hash).toHaveLength(64);
    expect(hash).not.toBe(computeReceiptHashOffChain("x", 1, 1000));
  });

  it("produces unique hashes for a batch of realistic inputs", () => {
    const inputs = [
      ["0xtx001", 8453, 1_700_000_000],
      ["0xtx001", 1, 1_700_000_000],
      ["0xtx001", 8453, 1_700_000_001],
      ["0xtx002", 8453, 1_700_000_000],
    ] as const;
    const hashes = inputs.map(([tx, chain, ts]) =>
      computeReceiptHashOffChain(tx, chain, ts),
    );
    const unique = new Set(hashes);
    expect(unique.size).toBe(inputs.length);
  });
});
