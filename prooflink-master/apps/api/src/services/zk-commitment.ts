import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ComplianceReceiptData {
  senderAddress: string;
  receiverAddress: string;
  amount: string;
  status: string;
}

export interface CommitmentResult {
  commitmentHash: string;
  salt: string; // hex-encoded 32 bytes — stored privately, never on-chain
}

export interface MerkleProofItem {
  hash: string;
  direction: "left" | "right";
}

export interface MerkleTree {
  root: string;
  leaves: string[];
  proofs: Map<string, MerkleProofItem[]>;
}

// ---------------------------------------------------------------------------
// Commitment scheme (Pedersen-style via SHA-256)
// ---------------------------------------------------------------------------

/**
 * Create a SHA-256 commitment from compliance receipt data.
 *
 * Commit = SHA-256(sender || receiver || amount || status || salt)
 *
 * The salt is cryptographically random (32 bytes). Only the commitment hash
 * goes on-chain — the salt and plaintext fields stay private.
 */
export function createComplianceCommitment(
  receipt: ComplianceReceiptData,
): CommitmentResult {
  const salt = randomBytes(32).toString("hex");
  const preimage = buildPreimage(receipt, salt);
  const commitmentHash = createHash("sha256").update(preimage).digest("hex");
  return { commitmentHash, salt };
}

/**
 * Verify that a commitment hash matches the given receipt + salt.
 * Returns true if SHA-256(sender || receiver || amount || status || salt) === commitmentHash.
 */
export function verifyComplianceCommitment(
  commitmentHash: string,
  receipt: ComplianceReceiptData,
  salt: string,
): boolean {
  const preimage = buildPreimage(receipt, salt);
  const recomputed = createHash("sha256").update(preimage).digest("hex");
  const expected = Buffer.from(recomputed, "hex");
  const actual = Buffer.from(commitmentHash, "hex");
  if (expected.length !== actual.length) return false;
  return timingSafeEqual(expected, actual);
}

// ---------------------------------------------------------------------------
// Merkle tree for batch receipt commitments
// ---------------------------------------------------------------------------

/**
 * Build a Merkle tree from an array of receipt commitments.
 * Returns the root hash and an inclusion proof for each leaf.
 */
export function createMerkleProof(receipts: ComplianceReceiptData[]): {
  root: string;
  commitments: CommitmentResult[];
  proofs: Map<string, MerkleProofItem[]>;
} {
  if (receipts.length === 0) {
    throw new Error("Cannot create Merkle tree from empty receipts array");
  }

  // Generate commitments for each receipt
  const commitments = receipts.map((r) => createComplianceCommitment(r));
  const leaves = commitments.map((c) => c.commitmentHash);

  // Build tree bottom-up
  const tree = buildMerkleTree(leaves);
  const root = tree[tree.length - 1]![0]!;

  // Generate proofs for each leaf
  const proofs = new Map<string, MerkleProofItem[]>();
  for (let i = 0; i < leaves.length; i++) {
    proofs.set(leaves[i]!, generateProof(tree, i));
  }

  return { root, commitments, proofs };
}

/**
 * Verify a single leaf's inclusion in a Merkle tree given the root and proof.
 */
export function verifyMerkleProof(
  root: string,
  leaf: string,
  proof: MerkleProofItem[],
): boolean {
  let current = leaf;

  for (const item of proof) {
    if (item.direction === "left") {
      current = hashPair(item.hash, current);
    } else {
      current = hashPair(current, item.hash);
    }
  }

  return current === root;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function buildPreimage(receipt: ComplianceReceiptData, salt: string): string {
  // Use JSON array serialization to prevent delimiter collision attacks
  return JSON.stringify([
    receipt.senderAddress,
    receipt.receiverAddress,
    receipt.amount,
    receipt.status,
    salt,
  ]);
}

function hashPair(left: string, right: string): string {
  return createHash("sha256").update(`${left}||${right}`).digest("hex");
}

/**
 * Build a complete Merkle tree as layers (bottom-up).
 * Each layer is an array of hashes. layer[0] = leaves, layer[n] = [root].
 * If a layer has an odd number of nodes, the last node is duplicated.
 */
function buildMerkleTree(leaves: string[]): string[][] {
  if (leaves.length === 0) return [[]];

  const layers: string[][] = [[...leaves]];
  let current = [...leaves];

  while (current.length > 1) {
    const next: string[] = [];
    for (let i = 0; i < current.length; i += 2) {
      const left = current[i]!;
      const right = current[i + 1] ?? left; // duplicate last if odd
      next.push(hashPair(left, right));
    }
    layers.push(next);
    current = next;
  }

  return layers;
}

/**
 * Generate a Merkle inclusion proof for the leaf at the given index.
 */
function generateProof(layers: string[][], leafIndex: number): MerkleProofItem[] {
  const proof: MerkleProofItem[] = [];
  let idx = leafIndex;

  for (let level = 0; level < layers.length - 1; level++) {
    const layer = layers[level]!;
    const isRight = idx % 2 === 1;
    const siblingIdx = isRight ? idx - 1 : idx + 1;
    const sibling = layer[siblingIdx] ?? layer[idx]!; // duplicate if odd

    proof.push({
      hash: sibling,
      direction: isRight ? "left" : "right",
    });

    idx = Math.floor(idx / 2);
  }

  return proof;
}
