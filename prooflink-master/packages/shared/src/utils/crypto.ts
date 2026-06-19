import { createHash, randomUUID } from "node:crypto";

// ---------------------------------------------------------------------------
// Hash helpers
// ---------------------------------------------------------------------------

/** Compute a SHA-256 hex digest. */
export function sha256(data: string | Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

/**
 * Stub: returns the SHA3-256 (NIST Keccak variant) hex digest.
 *
 * WARNING: SHA3-256 !== keccak256. Node.js crypto does not expose the
 * pre-standardised Keccak-256 that Ethereum uses. For any output that will
 * be verified on-chain (EAS attestation, ProofLink receipts, EIP-712 domain
 * separators) you MUST use a real keccak256 implementation such as
 * `@noble/hashes/sha3` (keccak_256) or viem's `keccak256()`.
 *
 * This function is intentionally named `sha3_256Stub` to make the mismatch
 * visible. Use `@prooflink/core` for EVM-compatible hashing.
 *
 * @deprecated Use keccak256 from @noble/hashes or viem in @prooflink/core.
 */
export function sha3_256Stub(data: string | Buffer): string {
  return createHash("sha3-256").update(data).digest("hex");
}

/**
 * Compute a non-EVM-compatible domain separator hash for logging/caching only.
 *
 * WARNING: This is NOT an EIP-712 domain separator. EIP-712 requires ABI
 * encoding + keccak256, neither of which is available in Node's built-in
 * crypto. String concatenation causes collisions when field values share
 * characters across boundaries (e.g. name="ab", version="c" collides with
 * name="a", version="bc").
 *
 * For on-chain use, compute the domain separator in @prooflink/core using viem
 * or ethers.
 */
export function domainSeparatorHashOffChain(
  name: string,
  version: string,
  chainId: number,
  verifyingContract: string,
): string {
  // Delimiter-separated to avoid cross-field collisions
  const encoded = `${name}\x00${version}\x00${chainId}\x00${verifyingContract}`;
  return sha256(encoded);
}

// ---------------------------------------------------------------------------
// Receipt ID generation
// ---------------------------------------------------------------------------

/**
 * Generate a unique receipt ID with a type prefix.
 *
 * Format: `{prefix}_{uuid-without-dashes}`
 *
 * Prefixes:
 * - `scr` — sanctions screening receipt
 * - `kya` — KYA verification receipt
 * - `trl` — travel rule transmission receipt
 * - `inv` — invoice receipt
 * - `cmp` — composite compliance receipt
 * - `stl` — settlement receipt
 */
export type ReceiptPrefix = "scr" | "kya" | "trl" | "inv" | "cmp" | "stl";

export function generateReceiptId(prefix: ReceiptPrefix): string {
  const uuid = randomUUID().replace(/-/g, "");
  return `${prefix}_${uuid}`;
}

// ---------------------------------------------------------------------------
// Signature verification
// ---------------------------------------------------------------------------
//
// EIP-191 personal_sign and EIP-712 typed-data signature verification require
// keccak256 and ecrecover, which are not available in Node.js built-in crypto.
//
// These functions live in @prooflink/core (which depends on viem).
// They are intentionally NOT exported from @prooflink/shared to prevent callers
// from importing a stub that always throws at runtime.

// ---------------------------------------------------------------------------
// Content hashing for on-chain anchoring
// ---------------------------------------------------------------------------

/**
 * Hash a JSON object deterministically (recursively sorted keys) for use as a
 * content fingerprint (e.g. ProofLink receipt hash, invoice anchor hash).
 *
 * Keys are sorted recursively at every nesting level to ensure identical
 * objects always produce the same canonical JSON string regardless of
 * property insertion order.
 */
export function hashJsonDeterministic(obj: Record<string, unknown>): string {
  return sha256(canonicalize(obj));
}

/** Recursively sort object keys to produce a deterministic JSON string. */
function canonicalize(value: unknown): string {
  if (value === null) {
    return "null";
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalize).join(",")}]`;
  }
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const entries = Object.keys(obj)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalize(obj[k])}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value);
}

/**
 * Compute an off-chain receipt fingerprint for storage/lookup purposes.
 *
 * WARNING: This does NOT match the Solidity `keccak256(abi.encodePacked(...))`
 * implementation because:
 *   1. Node.js crypto has no keccak256 (Ethereum variant).
 *   2. String concatenation (`${txHash}${chainId}${timestamp}`) collides when
 *      values share characters across field boundaries.
 *
 * For on-chain verification use @prooflink/core which uses viem's keccak256 with
 * proper ABI encoding. This function produces a SHA-256 hash suitable only for
 * off-chain receipt lookup (database primary keys, cache keys, etc).
 */
export function computeReceiptHashOffChain(
  paymentTxHash: string,
  chainId: number,
  timestamp: number,
): string {
  // Delimiter-separated to avoid cross-field collisions
  const packed = `${paymentTxHash}\x00${chainId}\x00${timestamp}`;
  return sha256(packed);
}
