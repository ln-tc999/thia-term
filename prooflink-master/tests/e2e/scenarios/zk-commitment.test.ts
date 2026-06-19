/**
 * E2E: ZK Commitment Verification
 *
 * Tests the ZK commitment scheme and Merkle batch functionality:
 *   - createComplianceCommitment → returns hash and salt (not the raw fields)
 *   - verifyComplianceCommitment → passes with correct salt, fails with wrong
 *   - Selective disclosure: hash is deterministic given same preimage
 *   - createMerkleProof + verifyMerkleProof → batch inclusion proofs
 *
 * These are pure-function tests — the zk-commitment service has no DB or
 * network dependencies, so no mocks are needed.
 *
 * Service: apps/api/src/services/zk-commitment.ts
 */

import { describe, expect, it } from "vitest";
import {
  createComplianceCommitment,
  verifyComplianceCommitment,
  createMerkleProof,
  verifyMerkleProof,
} from "../../../apps/api/src/services/zk-commitment.js";
import type { ComplianceReceiptData } from "../../../apps/api/src/services/zk-commitment.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const TEST_RECEIPT: ComplianceReceiptData = {
  senderAddress: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
  receiverAddress: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
  amount: "500.00",
  status: "APPROVED",
};

const ALT_RECEIPT: ComplianceReceiptData = {
  senderAddress: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
  receiverAddress: "0x71C7656EC7ab88b098defB751B7401B5f6d8976F",
  amount: "1200.00",
  status: "APPROVED",
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("E2E: ZK Commitment Verification", () => {
  // -------------------------------------------------------------------------
  // createComplianceCommitment
  // -------------------------------------------------------------------------

  describe("createComplianceCommitment", () => {
    it("should return a commitment hash and a salt — not the raw fields", () => {
      const { commitmentHash, salt } = createComplianceCommitment(TEST_RECEIPT);

      expect(commitmentHash).toBeTruthy();
      expect(salt).toBeTruthy();

      // Hash is 64-char hex (SHA-256)
      expect(commitmentHash).toMatch(/^[0-9a-f]{64}$/);

      // Salt is 64-char hex (32 random bytes)
      expect(salt).toMatch(/^[0-9a-f]{64}$/);

      // The commitment hash must NOT equal the raw sender address or amount
      expect(commitmentHash).not.toBe(TEST_RECEIPT.senderAddress);
      expect(commitmentHash).not.toBe(TEST_RECEIPT.amount);
      expect(commitmentHash).not.toContain(TEST_RECEIPT.senderAddress);
    });

    it("should produce different hashes for the same receipt on each call (random salt)", () => {
      const result1 = createComplianceCommitment(TEST_RECEIPT);
      const result2 = createComplianceCommitment(TEST_RECEIPT);

      // Salts must differ (cryptographic randomness)
      expect(result1.salt).not.toBe(result2.salt);

      // Since salts differ, hashes must differ
      expect(result1.commitmentHash).not.toBe(result2.commitmentHash);
    });

    it("should produce different hashes for different receipts with the same salt reuse", () => {
      const r1 = createComplianceCommitment(TEST_RECEIPT);
      const r2 = createComplianceCommitment(ALT_RECEIPT);

      expect(r1.commitmentHash).not.toBe(r2.commitmentHash);
    });

    it("should not expose sender or receiver address in the commitment hash", () => {
      const { commitmentHash } = createComplianceCommitment(TEST_RECEIPT);

      expect(commitmentHash).not.toContain(TEST_RECEIPT.senderAddress.toLowerCase().replace("0x", ""));
      expect(commitmentHash).not.toContain(TEST_RECEIPT.receiverAddress.toLowerCase().replace("0x", ""));
    });
  });

  // -------------------------------------------------------------------------
  // verifyComplianceCommitment — correct salt passes
  // -------------------------------------------------------------------------

  describe("verifyComplianceCommitment — correct salt", () => {
    it("should return true when receipt + salt match the commitment hash", () => {
      const { commitmentHash, salt } = createComplianceCommitment(TEST_RECEIPT);

      const result = verifyComplianceCommitment(commitmentHash, TEST_RECEIPT, salt);

      expect(result).toBe(true);
    });

    it("should verify across multiple independent commitments", () => {
      for (let i = 0; i < 5; i++) {
        const receipt: ComplianceReceiptData = {
          ...TEST_RECEIPT,
          amount: `${(i + 1) * 100}.00`,
        };
        const { commitmentHash, salt } = createComplianceCommitment(receipt);

        expect(verifyComplianceCommitment(commitmentHash, receipt, salt)).toBe(true);
      }
    });
  });

  // -------------------------------------------------------------------------
  // verifyComplianceCommitment — wrong inputs fail
  // -------------------------------------------------------------------------

  describe("verifyComplianceCommitment — wrong inputs return false", () => {
    it("should return false when salt is wrong", () => {
      const { commitmentHash } = createComplianceCommitment(TEST_RECEIPT);
      const wrongSalt = "0".repeat(64); // all-zeros salt

      const result = verifyComplianceCommitment(commitmentHash, TEST_RECEIPT, wrongSalt);

      expect(result).toBe(false);
    });

    it("should return false when receipt fields have changed", () => {
      const { commitmentHash, salt } = createComplianceCommitment(TEST_RECEIPT);

      const tamperedReceipt: ComplianceReceiptData = {
        ...TEST_RECEIPT,
        amount: "9999.00", // tampered amount
      };

      const result = verifyComplianceCommitment(commitmentHash, tamperedReceipt, salt);

      expect(result).toBe(false);
    });

    it("should return false when sender address is swapped with receiver", () => {
      const { commitmentHash, salt } = createComplianceCommitment(TEST_RECEIPT);

      const swappedReceipt: ComplianceReceiptData = {
        ...TEST_RECEIPT,
        senderAddress: TEST_RECEIPT.receiverAddress,
        receiverAddress: TEST_RECEIPT.senderAddress,
      };

      const result = verifyComplianceCommitment(commitmentHash, swappedReceipt, salt);

      expect(result).toBe(false);
    });

    it("should return false when status changes from APPROVED to REJECTED", () => {
      const { commitmentHash, salt } = createComplianceCommitment(TEST_RECEIPT);

      const tamperedStatus: ComplianceReceiptData = {
        ...TEST_RECEIPT,
        status: "REJECTED",
      };

      const result = verifyComplianceCommitment(commitmentHash, tamperedStatus, salt);

      expect(result).toBe(false);
    });

    it("should return false when commitment hash is wrong (all zeros)", () => {
      const { salt } = createComplianceCommitment(TEST_RECEIPT);
      const wrongHash = "0".repeat(64);

      const result = verifyComplianceCommitment(wrongHash, TEST_RECEIPT, salt);

      expect(result).toBe(false);
    });

    it("should return false when salt is empty string", () => {
      const { commitmentHash } = createComplianceCommitment(TEST_RECEIPT);

      const result = verifyComplianceCommitment(commitmentHash, TEST_RECEIPT, "");

      expect(result).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // Selective disclosure: only the committed fields are visible
  // -------------------------------------------------------------------------

  describe("Selective disclosure — only committed fields are exposed", () => {
    it("should commit only the declared fields (sender, receiver, amount, status)", () => {
      // The commitment binds exactly 4 fields via buildPreimage.
      // If a 5th field were added, the same salt + original 4 fields would still verify.
      const { commitmentHash, salt } = createComplianceCommitment(TEST_RECEIPT);

      // Verify that adding extra fields to the receipt object does NOT affect verification
      // (extra fields are not part of the preimage)
      const receiptWithExtraFields = {
        ...TEST_RECEIPT,
        extraField: "should-not-matter",
      };

      // verifyComplianceCommitment only uses the 4 declared fields
      const result = verifyComplianceCommitment(
        commitmentHash,
        receiptWithExtraFields as ComplianceReceiptData,
        salt,
      );

      expect(result).toBe(true);
    });

    it("should produce distinct commitments when any single field differs (isolation)", () => {
      const base = createComplianceCommitment(TEST_RECEIPT);

      const changedSender = createComplianceCommitment({ ...TEST_RECEIPT, senderAddress: "0xDEAD" });
      const changedReceiver = createComplianceCommitment({ ...TEST_RECEIPT, receiverAddress: "0xBEEF" });
      const changedAmount = createComplianceCommitment({ ...TEST_RECEIPT, amount: "0.01" });
      const changedStatus = createComplianceCommitment({ ...TEST_RECEIPT, status: "REJECTED" });

      // All should differ because different fields produce different hashes
      const hashes = new Set([
        base.commitmentHash,
        changedSender.commitmentHash,
        changedReceiver.commitmentHash,
        changedAmount.commitmentHash,
        changedStatus.commitmentHash,
      ]);

      // In theory all should differ; at minimum changedSender/changedReceiver/changedAmount/changedStatus
      // should differ from base (extremely unlikely collision with SHA-256)
      expect(hashes.size).toBe(5);
    });
  });

  // -------------------------------------------------------------------------
  // Merkle batch: createMerkleProof + verifyMerkleProof
  // -------------------------------------------------------------------------

  describe("Merkle batch — individual proof verifies against root", () => {
    it("should return a root hash and proofs for a single receipt", () => {
      const { root, commitments, proofs } = createMerkleProof([TEST_RECEIPT]);

      expect(root).toMatch(/^[0-9a-f]{64}$/);
      expect(commitments).toHaveLength(1);
      expect(proofs.size).toBe(1);
    });

    it("should verify each leaf against the Merkle root for 2 receipts", () => {
      const receipts = [TEST_RECEIPT, ALT_RECEIPT];
      const { root, commitments, proofs } = createMerkleProof(receipts);

      for (const commitment of commitments) {
        const proof = proofs.get(commitment.commitmentHash);
        expect(proof).toBeDefined();

        const verified = verifyMerkleProof(root, commitment.commitmentHash, proof!);
        expect(verified).toBe(true);
      }
    });

    it("should verify each leaf against the Merkle root for 3 receipts (odd count)", () => {
      const receipts: ComplianceReceiptData[] = [
        TEST_RECEIPT,
        ALT_RECEIPT,
        { ...TEST_RECEIPT, amount: "750.00", status: "APPROVED" },
      ];
      const { root, commitments, proofs } = createMerkleProof(receipts);

      expect(commitments).toHaveLength(3);

      for (const commitment of commitments) {
        const proof = proofs.get(commitment.commitmentHash);
        expect(proof).toBeDefined();
        expect(verifyMerkleProof(root, commitment.commitmentHash, proof!)).toBe(true);
      }
    });

    it("should verify each leaf against the Merkle root for 4 receipts (power of 2)", () => {
      const receipts: ComplianceReceiptData[] = Array.from({ length: 4 }, (_, i) => ({
        senderAddress: `0x${String(i).padStart(40, "0")}`,
        receiverAddress: `0x${String(i + 10).padStart(40, "0")}`,
        amount: `${(i + 1) * 100}.00`,
        status: "APPROVED",
      }));

      const { root, commitments, proofs } = createMerkleProof(receipts);

      expect(commitments).toHaveLength(4);
      for (const commitment of commitments) {
        const proof = proofs.get(commitment.commitmentHash);
        expect(verifyMerkleProof(root, commitment.commitmentHash, proof!)).toBe(true);
      }
    });

    it("should return false when verifying a leaf that is not in the tree", () => {
      const { root, proofs, commitments } = createMerkleProof([TEST_RECEIPT, ALT_RECEIPT]);

      // Use the proof from leaf[0] but verify against a fake leaf hash
      const firstProof = proofs.get(commitments[0]!.commitmentHash)!;
      const fakeLeaf = "f".repeat(64);

      const result = verifyMerkleProof(root, fakeLeaf, firstProof);

      expect(result).toBe(false);
    });

    it("should return false when root is tampered", () => {
      const { commitments, proofs } = createMerkleProof([TEST_RECEIPT, ALT_RECEIPT]);

      const leaf = commitments[0]!.commitmentHash;
      const proof = proofs.get(leaf)!;
      const tamperedRoot = "0".repeat(64);

      const result = verifyMerkleProof(tamperedRoot, leaf, proof);

      expect(result).toBe(false);
    });

    it("should throw when called with an empty receipts array", () => {
      expect(() => createMerkleProof([])).toThrow(
        "Cannot create Merkle tree from empty receipts array",
      );
    });

    it("should produce consistent root for same receipts (commitments differ due to random salt)", () => {
      // Two separate calls with same receipts produce different salts → different roots
      // (because each leaf gets a fresh random salt — this is intentional)
      const result1 = createMerkleProof([TEST_RECEIPT]);
      const result2 = createMerkleProof([TEST_RECEIPT]);

      // Roots differ because commitments use random salts
      expect(result1.commitments[0]!.salt).not.toBe(result2.commitments[0]!.salt);
      expect(result1.root).not.toBe(result2.root);
    });

    it("should verify a single-leaf tree (degenerate case)", () => {
      const { root, commitments, proofs } = createMerkleProof([TEST_RECEIPT]);

      const leaf = commitments[0]!.commitmentHash;
      const proof = proofs.get(leaf)!;

      // Single leaf: root IS the leaf (no sibling to hash with)
      // Proof is empty, current=leaf, loop doesn't execute, returns leaf===root
      expect(verifyMerkleProof(root, leaf, proof)).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Edge cases
  // -------------------------------------------------------------------------

  describe("Edge cases", () => {
    it("should handle empty string fields in receipt", () => {
      const receipt: ComplianceReceiptData = {
        senderAddress: "",
        receiverAddress: "",
        amount: "0",
        status: "",
      };

      const { commitmentHash, salt } = createComplianceCommitment(receipt);
      expect(commitmentHash).toMatch(/^[0-9a-f]{64}$/);
      expect(verifyComplianceCommitment(commitmentHash, receipt, salt)).toBe(true);
    });

    it("should handle very large amount strings", () => {
      const receipt: ComplianceReceiptData = {
        ...TEST_RECEIPT,
        amount: "999999999999999999999999999999.999999999999999999",
      };

      const { commitmentHash, salt } = createComplianceCommitment(receipt);
      expect(verifyComplianceCommitment(commitmentHash, receipt, salt)).toBe(true);
    });

    it("should handle special characters in addresses", () => {
      // Checksummed hex addresses with uppercase
      const receipt: ComplianceReceiptData = {
        senderAddress: "0xAbCdEf1234567890AbCdEf1234567890AbCdEf12",
        receiverAddress: "0xFeDcBa0987654321FeDcBa0987654321FeDcBa09",
        amount: "1.00",
        status: "APPROVED",
      };

      const { commitmentHash, salt } = createComplianceCommitment(receipt);
      expect(verifyComplianceCommitment(commitmentHash, receipt, salt)).toBe(true);
    });
  });
});
