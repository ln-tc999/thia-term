import { describe, expect, it } from "vitest";
import {
  createComplianceCommitment,
  verifyComplianceCommitment,
  createMerkleProof,
  verifyMerkleProof,
} from "../services/zk-commitment.js";
import type { ComplianceReceiptData } from "../services/zk-commitment.js";

const RECEIPT: ComplianceReceiptData = {
  senderAddress: "0xAlice",
  receiverAddress: "0xBob",
  amount: "100.5",
  status: "APPROVED",
};

describe("ZK Commitment", () => {
  it("creates a commitment with 64-char hex hash and 64-char hex salt", () => {
    const result = createComplianceCommitment(RECEIPT);
    expect(result.commitmentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(result.salt).toMatch(/^[0-9a-f]{64}$/);
  });

  it("produces different commitments for the same receipt (random salt)", () => {
    const a = createComplianceCommitment(RECEIPT);
    const b = createComplianceCommitment(RECEIPT);
    expect(a.commitmentHash).not.toBe(b.commitmentHash);
    expect(a.salt).not.toBe(b.salt);
  });

  it("verifies a valid commitment", () => {
    const { commitmentHash, salt } = createComplianceCommitment(RECEIPT);
    expect(verifyComplianceCommitment(commitmentHash, RECEIPT, salt)).toBe(true);
  });

  it("rejects tampered receipt data", () => {
    const { commitmentHash, salt } = createComplianceCommitment(RECEIPT);
    const tampered = { ...RECEIPT, amount: "999" };
    expect(verifyComplianceCommitment(commitmentHash, tampered, salt)).toBe(false);
  });

  it("rejects wrong salt", () => {
    const { commitmentHash } = createComplianceCommitment(RECEIPT);
    expect(verifyComplianceCommitment(commitmentHash, RECEIPT, "badsalt")).toBe(false);
  });
});

describe("Merkle Tree", () => {
  const receipts: ComplianceReceiptData[] = [
    { senderAddress: "0xA", receiverAddress: "0xB", amount: "10", status: "APPROVED" },
    { senderAddress: "0xC", receiverAddress: "0xD", amount: "20", status: "APPROVED" },
    { senderAddress: "0xE", receiverAddress: "0xF", amount: "30", status: "REJECTED" },
  ];

  it("creates a valid Merkle root from multiple receipts", () => {
    const result = createMerkleProof(receipts);
    expect(result.root).toMatch(/^[0-9a-f]{64}$/);
    expect(result.commitments).toHaveLength(3);
    expect(result.proofs.size).toBe(3);
  });

  it("verifies each leaf's inclusion proof", () => {
    const result = createMerkleProof(receipts);
    for (const commitment of result.commitments) {
      const proof = result.proofs.get(commitment.commitmentHash);
      expect(proof).toBeDefined();
      expect(verifyMerkleProof(result.root, commitment.commitmentHash, proof!)).toBe(true);
    }
  });

  it("rejects a proof with the wrong root", () => {
    const result = createMerkleProof(receipts);
    const firstCommitment = result.commitments[0]!;
    const proof = result.proofs.get(firstCommitment.commitmentHash)!;
    expect(verifyMerkleProof("deadbeef".repeat(8), firstCommitment.commitmentHash, proof)).toBe(false);
  });

  it("rejects a proof with the wrong leaf", () => {
    const result = createMerkleProof(receipts);
    const firstProof = result.proofs.get(result.commitments[0]!.commitmentHash)!;
    expect(verifyMerkleProof(result.root, "fakeleaf".repeat(8), firstProof)).toBe(false);
  });

  it("handles a single receipt", () => {
    const result = createMerkleProof([receipts[0]!]);
    expect(result.root).toMatch(/^[0-9a-f]{64}$/);
    expect(result.commitments).toHaveLength(1);
    const proof = result.proofs.get(result.commitments[0]!.commitmentHash)!;
    expect(verifyMerkleProof(result.root, result.commitments[0]!.commitmentHash, proof)).toBe(true);
  });

  it("throws on empty receipts", () => {
    expect(() => createMerkleProof([])).toThrow("Cannot create Merkle tree from empty receipts array");
  });
});
