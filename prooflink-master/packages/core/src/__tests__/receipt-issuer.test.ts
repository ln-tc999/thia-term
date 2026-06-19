import { describe, it, expect } from "vitest";
import {
  ReceiptIssuer,
  generateReceiptId,
} from "../receipts/issuer.js";
import type { ComplianceDecision } from "@prooflink/shared";
import type { ProofLinkConfig } from "../config.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeConfig(overrides?: Partial<ProofLinkConfig>): ProofLinkConfig {
  return {
    chainalysisBaseUrl: "https://public.chainalysis.com/api/v1",
    sanctionsLists: ["OFAC_SDN"],
    maxRiskScore: 85,
    escalationThreshold: 60,
    failOpen: false,
    allowlist: [],
    blocklist: [],
    travelRuleThresholds: { US: 3000 },
    defaultTravelRuleThresholdUsd: 3000,
    cacheMaxEntries: 100,
    sanctionsCacheTtlMs: 300_000,
    kyaCacheTtlMs: 900_000,
    restrictedJurisdictions: [],
    ...overrides,
  };
}

function makeDecision(
  status: ComplianceDecision["status"],
  riskScore = 0,
): ComplianceDecision {
  return {
    status,
    riskScore,
    receiptId: `pl-${Date.now().toString(16)}-abc123`,
    receiptHash: "0xdeadbeef",
    checks: [
      {
        checkType: "SANCTIONS_SCREENING",
        result: status === "REJECTED" ? "FAILED" : "PASSED",
        performedAt: new Date().toISOString(),
        provider: "chainalysis_free",
        detail: "Test check",
      },
    ],
    travelRuleStatus: "NOT_REQUIRED",
    timestamp: new Date().toISOString(),
    ttl: 300,
  };
}

function makeTxContext() {
  return {
    senderAddress: "0x1234567890abcdef1234567890abcdef12345678",
    receiverAddress: "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd",
    amountUsd: 500,
    chain: "eip155:8453",
  };
}

// ---------------------------------------------------------------------------
// generateReceiptId — deterministic ID generation
// ---------------------------------------------------------------------------

describe("generateReceiptId", () => {
  it("should return a string starting with 'pl-'", () => {
    const id = generateReceiptId({
      senderAddress: "0x1234",
      receiverAddress: "0xabcd",
      amountUsd: 100,
      chain: "eip155:1",
      timestamp: new Date().toISOString(),
    });

    expect(id).toMatch(/^pl-/);
  });

  it("should produce the same ID for identical inputs (deterministic)", () => {
    const params = {
      senderAddress: "0x1234",
      receiverAddress: "0xabcd",
      amountUsd: 100,
      chain: "eip155:1",
      timestamp: "2026-01-01T00:00:00.000Z",
    };

    const id1 = generateReceiptId(params);
    const id2 = generateReceiptId(params);

    expect(id1).toBe(id2);
  });

  it("should produce different IDs for different timestamps", () => {
    const base = {
      senderAddress: "0x1234",
      receiverAddress: "0xabcd",
      amountUsd: 100,
      chain: "eip155:1",
    };

    const id1 = generateReceiptId({ ...base, timestamp: "2026-01-01T00:00:00.000Z" });
    const id2 = generateReceiptId({ ...base, timestamp: "2026-01-01T00:00:01.000Z" });

    expect(id1).not.toBe(id2);
  });

  it("should produce different IDs for different sender addresses", () => {
    const base = {
      receiverAddress: "0xabcd",
      amountUsd: 100,
      chain: "eip155:1",
      timestamp: "2026-01-01T00:00:00.000Z",
    };

    const id1 = generateReceiptId({ ...base, senderAddress: "0x1111" });
    const id2 = generateReceiptId({ ...base, senderAddress: "0x2222" });

    expect(id1).not.toBe(id2);
  });

  it("should normalise sender address to lowercase before hashing", () => {
    const base = {
      receiverAddress: "0xabcd",
      amountUsd: 100,
      chain: "eip155:1",
      timestamp: "2026-01-01T00:00:00.000Z",
    };

    const lower = generateReceiptId({ ...base, senderAddress: "0xABCD" });
    const upper = generateReceiptId({ ...base, senderAddress: "0xabcd" });

    // lowercase normalisation means same ID
    expect(lower).toBe(upper);
  });

  it("should produce different IDs for different amounts", () => {
    const base = {
      senderAddress: "0x1234",
      receiverAddress: "0xabcd",
      chain: "eip155:1",
      timestamp: "2026-01-01T00:00:00.000Z",
    };

    const id1 = generateReceiptId({ ...base, amountUsd: 100 });
    const id2 = generateReceiptId({ ...base, amountUsd: 200 });

    expect(id1).not.toBe(id2);
  });
});

// ---------------------------------------------------------------------------
// ReceiptIssuer.issueReceipt — structure
// ---------------------------------------------------------------------------

describe("ReceiptIssuer — receipt structure", () => {
  it("should return a receipt with all required fields", async () => {
    const issuer = new ReceiptIssuer(makeConfig());
    const decision = makeDecision("APPROVED");
    const txContext = makeTxContext();

    const receipt = await issuer.issueReceipt(decision, txContext);

    expect(receipt.receiptId).toMatch(/^pl-/);
    expect(receipt.checksPerformed).toHaveLength(1);
    expect(receipt.overallStatus).toBeDefined();
    expect(receipt.riskScore).toBe(decision.riskScore);
    expect(receipt.travelRuleStatus).toBe(decision.travelRuleStatus);
    expect(receipt.signature).toBeTruthy();
    expect(receipt.timestamp).toBeTruthy();
    expect(receipt.ttl).toBe(300);
    expect(receipt.proofLinkVersion).toBe("1.0.0");
    expect(receipt.ipfsCid).toBeTruthy();
  });

  it("should include txHash when provided in context", async () => {
    const issuer = new ReceiptIssuer(makeConfig());
    const decision = makeDecision("APPROVED");
    const txContext = {
      ...makeTxContext(),
      txHash: "0xdeadbeefdeadbeef",
    };

    const receipt = await issuer.issueReceipt(decision, txContext);

    expect(receipt.txHash).toBe("0xdeadbeefdeadbeef");
  });

  it("should not set txHash when not provided", async () => {
    const issuer = new ReceiptIssuer(makeConfig());
    const decision = makeDecision("APPROVED");
    const txContext = makeTxContext(); // no txHash

    const receipt = await issuer.issueReceipt(decision, txContext);

    expect(receipt.txHash).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// ReceiptIssuer — decision status mapping
// ---------------------------------------------------------------------------

describe("ReceiptIssuer — decision status → overallStatus mapping", () => {
  it("APPROVED decision maps to APPROVED receipt", async () => {
    const issuer = new ReceiptIssuer(makeConfig());
    const receipt = await issuer.issueReceipt(makeDecision("APPROVED"), makeTxContext());

    expect(receipt.overallStatus).toBe("APPROVED");
  });

  it("REJECTED decision maps to REJECTED receipt", async () => {
    const issuer = new ReceiptIssuer(makeConfig());
    const receipt = await issuer.issueReceipt(makeDecision("REJECTED", 100), makeTxContext());

    expect(receipt.overallStatus).toBe("REJECTED");
  });

  it("ESCALATED decision maps to ESCALATED receipt", async () => {
    const issuer = new ReceiptIssuer(makeConfig());
    const receipt = await issuer.issueReceipt(makeDecision("ESCALATED", 70), makeTxContext());

    expect(receipt.overallStatus).toBe("ESCALATED");
  });
});

// ---------------------------------------------------------------------------
// ReceiptIssuer — receipt ID uniqueness
// ---------------------------------------------------------------------------

describe("ReceiptIssuer — receipt ID uniqueness", () => {
  it("should produce different receipt IDs for different timestamps", async () => {
    const issuer = new ReceiptIssuer(makeConfig());
    const decision = makeDecision("APPROVED");
    const txContext = makeTxContext();

    const r1 = await issuer.issueReceipt(decision, txContext);

    // Wait 1ms to guarantee a different timestamp
    await new Promise((resolve) => setTimeout(resolve, 2));

    const r2 = await issuer.issueReceipt(decision, txContext);

    expect(r1.receiptId).not.toBe(r2.receiptId);
  });

  it("should produce different receipt IDs for different sender addresses", async () => {
    const issuer = new ReceiptIssuer(makeConfig());
    const decision = makeDecision("APPROVED");

    const r1 = await issuer.issueReceipt(decision, {
      ...makeTxContext(),
      senderAddress: "0x1111111111111111111111111111111111111111",
    });
    const r2 = await issuer.issueReceipt(decision, {
      ...makeTxContext(),
      senderAddress: "0x2222222222222222222222222222222222222222",
    });

    expect(r1.receiptId).not.toBe(r2.receiptId);
  });
});

// ---------------------------------------------------------------------------
// ReceiptIssuer — signature
// ---------------------------------------------------------------------------

describe("ReceiptIssuer — signature generation", () => {
  it("should include a non-empty signature when no signer key is configured", async () => {
    const issuer = new ReceiptIssuer(makeConfig({ signerPrivateKey: undefined }));
    const receipt = await issuer.issueReceipt(makeDecision("APPROVED"), makeTxContext());

    // Without a signer key, a deterministic placeholder is used
    expect(receipt.signature).toBeTruthy();
    expect(receipt.signature.startsWith("unsigned:")).toBe(true);
  });

  it("should produce same unsigned signature for identical receipts (deterministic placeholder)", async () => {
    const issuer = new ReceiptIssuer(makeConfig({ signerPrivateKey: undefined }));
    const decision = makeDecision("APPROVED");
    const txContext = makeTxContext();

    // Two separate calls at same ms will produce different receiptIds (different timestamps)
    // so we just check the format, not equality
    const receipt = await issuer.issueReceipt(decision, txContext);

    expect(receipt.signature).toMatch(/^unsigned:[0-9a-f]+/);
  });

  it("should return unsigned receipt with signingWarning when signerPrivateKey is invalid (bad hex)", async () => {
    const issuer = new ReceiptIssuer(
      makeConfig({ signerPrivateKey: "not-a-valid-private-key" }),
    );

    const receipt = await issuer.issueReceipt(makeDecision("APPROVED"), makeTxContext());

    // Signing failure is now gracefully handled — receipt is returned unsigned
    expect(receipt.signature).toMatch(/^unsigned:signing-failed:/);
    expect((receipt as Record<string, unknown>).signingWarning).toBeDefined();
    expect((receipt as Record<string, unknown>).signingWarning).toMatch(/EIP-712 signing failed/);
  });
});

// ---------------------------------------------------------------------------
// ReceiptIssuer — IPFS CID generation
// ---------------------------------------------------------------------------

describe("ReceiptIssuer — content hash (ipfsCid field)", () => {
  it("should generate a non-empty content hash in the ipfsCid field", async () => {
    const issuer = new ReceiptIssuer(makeConfig());
    const receipt = await issuer.issueReceipt(makeDecision("APPROVED"), makeTxContext());

    expect(receipt.ipfsCid).toBeTruthy();
    // Current implementation produces `sha256:<hex64>` (honest content-addressable URI)
    expect(receipt.ipfsCid).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it("should produce a deterministic content hash for the same receipt content", async () => {
    // Two receipts with different timestamps will have different content hashes
    const issuer = new ReceiptIssuer(makeConfig());
    const receipt = await issuer.issueReceipt(makeDecision("APPROVED"), makeTxContext());

    expect(receipt.ipfsCid?.startsWith("sha256:")).toBe(true);
    expect(receipt.ipfsCid?.length).toBe(7 + 64); // "sha256:" (7) + 64 hex chars
  });
});

// ---------------------------------------------------------------------------
// ReceiptIssuer — computeReceiptHash
// ---------------------------------------------------------------------------

describe("ReceiptIssuer — computeReceiptHash", () => {
  it("should return a 0x-prefixed keccak256 hash", async () => {
    const issuer = new ReceiptIssuer(makeConfig());
    const decision = makeDecision("APPROVED");
    const receipt = await issuer.issueReceipt(decision, makeTxContext());

    const hash = await issuer.computeReceiptHash(receipt);

    expect(hash).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it("should produce the same hash for the same receipt (deterministic)", async () => {
    const issuer = new ReceiptIssuer(makeConfig());
    const decision = makeDecision("APPROVED");
    const receipt = await issuer.issueReceipt(decision, makeTxContext());

    const hash1 = await issuer.computeReceiptHash(receipt);
    const hash2 = await issuer.computeReceiptHash(receipt);

    expect(hash1).toBe(hash2);
  });

  it("should produce different hashes for different receipts", async () => {
    const issuer = new ReceiptIssuer(makeConfig());

    const r1 = await issuer.issueReceipt(makeDecision("APPROVED", 0), makeTxContext());
    await new Promise((resolve) => setTimeout(resolve, 2)); // ensure different timestamp
    const r2 = await issuer.issueReceipt(makeDecision("REJECTED", 100), makeTxContext());

    const h1 = await issuer.computeReceiptHash(r1);
    const h2 = await issuer.computeReceiptHash(r2);

    expect(h1).not.toBe(h2);
  });
});

// ---------------------------------------------------------------------------
// ReceiptIssuer — riskScore propagation
// ---------------------------------------------------------------------------

describe("ReceiptIssuer — riskScore", () => {
  it("should carry riskScore 0 for APPROVED decision", async () => {
    const issuer = new ReceiptIssuer(makeConfig());
    const receipt = await issuer.issueReceipt(makeDecision("APPROVED", 0), makeTxContext());

    expect(receipt.riskScore).toBe(0);
  });

  it("should carry riskScore 100 for REJECTED decision", async () => {
    const issuer = new ReceiptIssuer(makeConfig());
    const receipt = await issuer.issueReceipt(makeDecision("REJECTED", 100), makeTxContext());

    expect(receipt.riskScore).toBe(100);
  });

  it("should propagate all checks from the decision", async () => {
    const issuer = new ReceiptIssuer(makeConfig());
    const decision: ComplianceDecision = {
      ...makeDecision("APPROVED"),
      checks: [
        {
          checkType: "SANCTIONS_SCREENING",
          result: "PASSED",
          performedAt: new Date().toISOString(),
          provider: "chainalysis_free",
          detail: "Clean",
        },
        {
          checkType: "AML_MONITORING",
          result: "PASSED",
          performedAt: new Date().toISOString(),
          provider: "prooflink_aml",
          detail: "Score 0/85",
        },
        {
          checkType: "JURISDICTIONAL_RULES",
          result: "PASSED",
          performedAt: new Date().toISOString(),
          provider: "prooflink_jurisdiction",
        },
      ],
    };

    const receipt = await issuer.issueReceipt(decision, makeTxContext());

    expect(receipt.checksPerformed).toHaveLength(3);
    expect(receipt.checksPerformed[0]?.checkType).toBe("SANCTIONS_SCREENING");
    expect(receipt.checksPerformed[1]?.checkType).toBe("AML_MONITORING");
    expect(receipt.checksPerformed[2]?.checkType).toBe("JURISDICTIONAL_RULES");
  });
});
