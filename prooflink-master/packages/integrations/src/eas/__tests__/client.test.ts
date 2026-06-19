import { describe, expect, it, vi } from "vitest";
import { EASClient } from "../client.js";
import {
  buildSanctionsFlags,
  decodeReceiptFromAttestation,
  encodeReceiptForAttestation,
  PROOFLINK_SCHEMA_REVOCABLE,
  PROOFLINK_SCHEMA_NAME,
  PROOFLINK_SCHEMA_DEFINITION,
  SANCTIONS_BITS,
} from "../schema.js";
import type {
  AttestationData,
  EASAttestation,
  EASConfig,
  EASReader,
  EASSigner,
} from "../types.js";
import type { ComplianceReceipt } from "@prooflink/shared";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const EAS_CONFIG: EASConfig = {
  registryAddress: "0xSchemaRegistry",
  schemaUid: "0xSchemaUID",
  privateKey: "0xdeadbeef",
  rpcUrl: "https://mainnet.infura.io/v3/test",
  chainId: 1,
};

const COMPLIANCE_RECEIPT: ComplianceReceipt = {
  receiptId: "rcpt_eas_001",
  checksPerformed: [],
  overallStatus: "APPROVED",
  riskScore: 5,
  travelRuleStatus: "NOT_REQUIRED",
  signature: "0xsignature",
  timestamp: "2026-01-01T00:00:00Z",
  ttl: 300,
  proofLinkVersion: "1.0.0",
};

const EAS_ATTESTATION: EASAttestation = {
  uid: "0xAttestationUID",
  schema: "0xSchemaUID",
  time: 1704067200,
  expirationTime: 0,
  revocationTime: 0,
  recipient: "0xAttester",
  attester: "0xAttester",
  revocable: true,
  data: JSON.stringify({
    receiptId: "rcpt_eas_001",
    paymentTxHash: "0x" + "0".repeat(64),
    chainId: 0,
    payer: "0x" + "0".repeat(40),
    payee: "0x" + "0".repeat(40),
    amount: "0",
    token: "0x" + "0".repeat(40),
    ipfsContentHash: "0x" + "0".repeat(64),
    riskScore: 5,
    sanctionsFlags: 0,
    travelRuleCompliant: true,
    flowType: 0,
    agentIdHash: "0x" + "0".repeat(64),
  }),
};

// ---------------------------------------------------------------------------
// Mock factories
// ---------------------------------------------------------------------------

function makeSigner(overrides: Partial<EASSigner> = {}): EASSigner {
  return {
    attest: vi.fn().mockResolvedValue({ uid: "0xAttestationUID", txHash: "0xTxHash" }),
    revoke: vi.fn().mockResolvedValue("0xRevokeTxHash"),
    getAddress: vi.fn().mockResolvedValue("0xAttester"),
    ...overrides,
  };
}

function makeReader(overrides: Partial<EASReader> = {}): EASReader {
  return {
    getAttestation: vi.fn().mockResolvedValue(EAS_ATTESTATION),
    isAttestationValid: vi.fn().mockResolvedValue(true),
    getAttestationsByRecipient: vi.fn().mockResolvedValue([EAS_ATTESTATION]),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// EASClient — attest
// ---------------------------------------------------------------------------

describe("EASClient", () => {
  describe("attest", () => {
    it("calls signer.getAddress to get attester address", async () => {
      const signer = makeSigner();
      const reader = makeReader();
      const client = new EASClient(EAS_CONFIG, signer, reader);

      await client.attest(COMPLIANCE_RECEIPT);

      expect(signer.getAddress).toHaveBeenCalledOnce();
    });

    it("calls signer.attest with correct schema UID", async () => {
      const signer = makeSigner();
      const reader = makeReader();
      const client = new EASClient(EAS_CONFIG, signer, reader);

      await client.attest(COMPLIANCE_RECEIPT);

      expect(signer.attest).toHaveBeenCalledOnce();
      const [req] = (signer.attest as ReturnType<typeof vi.fn>).mock.calls[0] as [
        Parameters<EASSigner["attest"]>[0],
      ];
      expect(req.schema).toBe("0xSchemaUID");
    });

    it("calls signer.attest with recipient set to attester address", async () => {
      const signer = makeSigner();
      const reader = makeReader();
      const client = new EASClient(EAS_CONFIG, signer, reader);

      await client.attest(COMPLIANCE_RECEIPT);

      const [req] = (signer.attest as ReturnType<typeof vi.fn>).mock.calls[0] as [
        Parameters<EASSigner["attest"]>[0],
      ];
      expect(req.data.recipient).toBe("0xAttester");
    });

    it("calls signer.attest with revocable=true (PROOFLINK_SCHEMA_REVOCABLE)", async () => {
      const signer = makeSigner();
      const reader = makeReader();
      const client = new EASClient(EAS_CONFIG, signer, reader);

      await client.attest(COMPLIANCE_RECEIPT);

      const [req] = (signer.attest as ReturnType<typeof vi.fn>).mock.calls[0] as [
        Parameters<EASSigner["attest"]>[0],
      ];
      expect(req.data.revocable).toBe(PROOFLINK_SCHEMA_REVOCABLE);
    });

    it("calls signer.attest with expirationTime=0 (no expiration)", async () => {
      const signer = makeSigner();
      const reader = makeReader();
      const client = new EASClient(EAS_CONFIG, signer, reader);

      await client.attest(COMPLIANCE_RECEIPT);

      const [req] = (signer.attest as ReturnType<typeof vi.fn>).mock.calls[0] as [
        Parameters<EASSigner["attest"]>[0],
      ];
      expect(req.data.expirationTime).toBe(0);
    });

    it("encodes receipt data into attestation data field as JSON", async () => {
      const signer = makeSigner();
      const reader = makeReader();
      const client = new EASClient(EAS_CONFIG, signer, reader);

      await client.attest(COMPLIANCE_RECEIPT);

      const [req] = (signer.attest as ReturnType<typeof vi.fn>).mock.calls[0] as [
        Parameters<EASSigner["attest"]>[0],
      ];
      const decoded = JSON.parse(req.data.data) as AttestationData;
      expect(decoded.receiptId).toBe("rcpt_eas_001");
      expect(decoded.riskScore).toBe(5);
      expect(decoded.travelRuleCompliant).toBe(true); // NOT_REQUIRED maps to true
    });

    it("returns AttestationResult with uid, txHash, timestamp", async () => {
      const signer = makeSigner();
      const reader = makeReader();
      const client = new EASClient(EAS_CONFIG, signer, reader);

      const result = await client.attest(COMPLIANCE_RECEIPT);

      expect(result.uid).toBe("0xAttestationUID");
      expect(result.txHash).toBe("0xTxHash");
      expect(typeof result.timestamp).toBe("number");
      expect(result.timestamp).toBeGreaterThan(0);
    });

    it("propagates error when signer.attest fails", async () => {
      const signer = makeSigner({
        attest: vi.fn().mockRejectedValue(new Error("Transaction reverted")),
      });
      const reader = makeReader();
      const client = new EASClient(EAS_CONFIG, signer, reader);

      await expect(client.attest(COMPLIANCE_RECEIPT)).rejects.toThrow("Transaction reverted");
    });

    it("propagates error when signer.getAddress fails", async () => {
      const signer = makeSigner({
        getAddress: vi.fn().mockRejectedValue(new Error("Wallet locked")),
      });
      const reader = makeReader();
      const client = new EASClient(EAS_CONFIG, signer, reader);

      await expect(client.attest(COMPLIANCE_RECEIPT)).rejects.toThrow("Wallet locked");
    });
  });

  // -------------------------------------------------------------------------
  // verify
  // -------------------------------------------------------------------------

  describe("verify", () => {
    it("delegates to reader.getAttestation", async () => {
      const signer = makeSigner();
      const reader = makeReader();
      const client = new EASClient(EAS_CONFIG, signer, reader);

      await client.verify("0xAttestationUID");

      expect(reader.getAttestation).toHaveBeenCalledWith("0xAttestationUID");
    });

    it("returns valid=true for non-revoked attestation", async () => {
      const signer = makeSigner();
      const reader = makeReader({
        getAttestation: vi.fn().mockResolvedValue({
          ...EAS_ATTESTATION,
          revocationTime: 0,
        }),
      });
      const client = new EASClient(EAS_CONFIG, signer, reader);

      const result = await client.verify("0xAttestationUID");

      expect(result.valid).toBe(true);
    });

    it("returns valid=false for revoked attestation", async () => {
      const signer = makeSigner();
      const reader = makeReader({
        getAttestation: vi.fn().mockResolvedValue({
          ...EAS_ATTESTATION,
          revocationTime: 1704067300, // non-zero means revoked
        }),
      });
      const client = new EASClient(EAS_CONFIG, signer, reader);

      const result = await client.verify("0xRevokedUID");

      expect(result.valid).toBe(false);
    });

    it("returns valid=false and empty data when attestation not found", async () => {
      const signer = makeSigner();
      const reader = makeReader({
        getAttestation: vi.fn().mockResolvedValue(null),
      });
      const client = new EASClient(EAS_CONFIG, signer, reader);

      const result = await client.verify("0xNonExistent");

      expect(result.valid).toBe(false);
      expect(result.data.receiptId).toBe("");
    });

    it("returns parsed attestation data", async () => {
      const signer = makeSigner();
      const reader = makeReader();
      const client = new EASClient(EAS_CONFIG, signer, reader);

      const result = await client.verify("0xAttestationUID");

      expect(result.data.receiptId).toBe("rcpt_eas_001");
      expect(result.data.riskScore).toBe(5);
    });

    it("propagates error from reader.getAttestation", async () => {
      const signer = makeSigner();
      const reader = makeReader({
        getAttestation: vi.fn().mockRejectedValue(new Error("RPC error")),
      });
      const client = new EASClient(EAS_CONFIG, signer, reader);

      await expect(client.verify("0xUID")).rejects.toThrow("RPC error");
    });
  });

  // -------------------------------------------------------------------------
  // revoke
  // -------------------------------------------------------------------------

  describe("revoke", () => {
    it("calls signer.revoke with schemaUid and attestation uid", async () => {
      const signer = makeSigner();
      const reader = makeReader();
      const client = new EASClient(EAS_CONFIG, signer, reader);

      await client.revoke("0xAttestationToRevoke");

      expect(signer.revoke).toHaveBeenCalledWith(
        "0xSchemaUID",
        "0xAttestationToRevoke",
      );
    });

    it("returns the revocation transaction hash", async () => {
      const signer = makeSigner();
      const reader = makeReader();
      const client = new EASClient(EAS_CONFIG, signer, reader);

      const txHash = await client.revoke("0xUID");

      expect(txHash).toBe("0xRevokeTxHash");
    });

    it("propagates error when signer.revoke fails", async () => {
      const signer = makeSigner({
        revoke: vi.fn().mockRejectedValue(new Error("Not authorized to revoke")),
      });
      const reader = makeReader();
      const client = new EASClient(EAS_CONFIG, signer, reader);

      await expect(client.revoke("0xUID")).rejects.toThrow("Not authorized to revoke");
    });
  });

  // -------------------------------------------------------------------------
  // getAttestationsByRecipient
  // -------------------------------------------------------------------------

  describe("getAttestationsByRecipient", () => {
    it("delegates to reader.getAttestationsByRecipient with schemaUid and address", async () => {
      const signer = makeSigner();
      const reader = makeReader();
      const client = new EASClient(EAS_CONFIG, signer, reader);

      await client.getAttestationsByRecipient("0xRecipient");

      expect(reader.getAttestationsByRecipient).toHaveBeenCalledWith(
        "0xSchemaUID",
        "0xRecipient",
      );
    });

    it("maps attestation records to AttestationResult with uid and timestamp", async () => {
      const signer = makeSigner();
      const reader = makeReader();
      const client = new EASClient(EAS_CONFIG, signer, reader);

      const results = await client.getAttestationsByRecipient("0xRecipient");

      expect(results).toHaveLength(1);
      expect(results[0]?.uid).toBe("0xAttestationUID");
      expect(results[0]?.timestamp).toBe(1704067200);
    });

    it("returns txHash as empty string (not stored in attestation)", async () => {
      const signer = makeSigner();
      const reader = makeReader();
      const client = new EASClient(EAS_CONFIG, signer, reader);

      const results = await client.getAttestationsByRecipient("0xRecipient");

      expect(results[0]?.txHash).toBe("");
    });

    it("returns empty array when no attestations found", async () => {
      const signer = makeSigner();
      const reader = makeReader({
        getAttestationsByRecipient: vi.fn().mockResolvedValue([]),
      });
      const client = new EASClient(EAS_CONFIG, signer, reader);

      const results = await client.getAttestationsByRecipient("0xNewRecipient");

      expect(results).toHaveLength(0);
    });
  });
});

// ---------------------------------------------------------------------------
// Schema helpers — encodeReceiptForAttestation
// ---------------------------------------------------------------------------

describe("encodeReceiptForAttestation", () => {
  const BASE_RECEIPT: ComplianceReceipt = {
    receiptId: "rcpt_enc_001",
    checksPerformed: [],
    overallStatus: "APPROVED",
    riskScore: 10,
    travelRuleStatus: "NOT_REQUIRED",
    signature: "0xsig",
    timestamp: "2026-01-01T00:00:00Z",
    ttl: 300,
    proofLinkVersion: "1.0.0",
  };

  it("returns AttestationData with correct receiptId", () => {
    const data = encodeReceiptForAttestation(BASE_RECEIPT);
    expect(data.receiptId).toBe("rcpt_enc_001");
  });

  it("returns correct riskScore", () => {
    const data = encodeReceiptForAttestation(BASE_RECEIPT);
    expect(data.riskScore).toBe(10);
  });

  it("travelRuleCompliant=true for NOT_REQUIRED status", () => {
    const data = encodeReceiptForAttestation({
      ...BASE_RECEIPT,
      travelRuleStatus: "NOT_REQUIRED",
    });
    expect(data.travelRuleCompliant).toBe(true);
  });

  it("travelRuleCompliant=true for TRANSMITTED status", () => {
    const data = encodeReceiptForAttestation({
      ...BASE_RECEIPT,
      travelRuleStatus: "TRANSMITTED",
    });
    expect(data.travelRuleCompliant).toBe(true);
  });

  it("travelRuleCompliant=true for ACK_RECEIVED status", () => {
    const data = encodeReceiptForAttestation({
      ...BASE_RECEIPT,
      travelRuleStatus: "ACK_RECEIVED",
    });
    expect(data.travelRuleCompliant).toBe(true);
  });

  it("travelRuleCompliant=false for FAILED status", () => {
    const data = encodeReceiptForAttestation({
      ...BASE_RECEIPT,
      travelRuleStatus: "FAILED",
    });
    expect(data.travelRuleCompliant).toBe(false);
  });

  it("uses zero-padded hash for paymentTxHash when txHash absent", () => {
    const data = encodeReceiptForAttestation(BASE_RECEIPT);
    expect(data.paymentTxHash).toBe("0x" + "0".repeat(64));
  });

  it("uses actual txHash when provided", () => {
    const data = encodeReceiptForAttestation({
      ...BASE_RECEIPT,
      txHash: "0xActualTxHash",
    });
    expect(data.paymentTxHash).toBe("0xActualTxHash");
  });

  it("uses zero-padded hash for ipfsContentHash when ipfsCid absent", () => {
    const data = encodeReceiptForAttestation(BASE_RECEIPT);
    expect(data.ipfsContentHash).toBe("0x" + "0".repeat(64));
  });

  it("uses actual ipfsCid when provided", () => {
    const data = encodeReceiptForAttestation({
      ...BASE_RECEIPT,
      ipfsCid: "QmActualIPFSHash",
    });
    expect(data.ipfsContentHash).toBe("QmActualIPFSHash");
  });

  it("returns sanctionsFlags=0 when no sanctions checks performed", () => {
    const data = encodeReceiptForAttestation(BASE_RECEIPT);
    expect(data.sanctionsFlags).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Schema helpers — decodeReceiptFromAttestation
// ---------------------------------------------------------------------------

describe("decodeReceiptFromAttestation", () => {
  it("decodes AttestationData fields correctly", () => {
    const input: AttestationData = {
      receiptId: "rcpt_dec_001",
      paymentTxHash: "0xTxHash",
      chainId: 8453,
      payer: "0xPayer",
      payee: "0xPayee",
      amount: "1000000",
      token: "0xUSDC",
      ipfsContentHash: "QmIPFSHash",
      riskScore: 25,
      sanctionsFlags: 0,
      travelRuleCompliant: true,
      flowType: 3,
      agentIdHash: "0xAgentHash",
    };

    const decoded = decodeReceiptFromAttestation(input);

    expect(decoded.receiptId).toBe("rcpt_dec_001");
    expect(decoded.riskScore).toBe(25);
    expect(decoded.travelRuleCompliant).toBe(true);
    expect(decoded.sanctionsFlags).toBe(0);
    expect(decoded.flowType).toBe(3);
    expect(decoded.ipfsContentHash).toBe("QmIPFSHash");
  });

  it("round-trips through encode/decode correctly", () => {
    const receipt: ComplianceReceipt = {
      receiptId: "rcpt_rt_001",
      checksPerformed: [],
      overallStatus: "APPROVED",
      riskScore: 42,
      travelRuleStatus: "TRANSMITTED",
      signature: "0xsig",
      timestamp: "2026-06-15T12:00:00Z",
      ttl: 300,
      proofLinkVersion: "2.0.0",
    };

    const encoded = encodeReceiptForAttestation(receipt);
    const decoded = decodeReceiptFromAttestation(encoded);

    expect(decoded.receiptId).toBe("rcpt_rt_001");
    expect(decoded.riskScore).toBe(42);
    expect(decoded.travelRuleCompliant).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Schema helpers — buildSanctionsFlags
// ---------------------------------------------------------------------------

describe("buildSanctionsFlags", () => {
  it("returns 0 for empty checks array", () => {
    expect(buildSanctionsFlags([])).toBe(0);
  });

  it("ignores non-sanctions check types", () => {
    const checks: ComplianceReceipt["checksPerformed"] = [
      {
        checkType: "AML_MONITORING",
        result: "PASSED",
        performedAt: "2026-01-01T00:00:00Z",
        provider: "prooflink",
      },
    ];
    expect(buildSanctionsFlags(checks)).toBe(0);
  });

  it("sets OFAC_SDN_SCREENED bit for OFAC detail", () => {
    const checks: ComplianceReceipt["checksPerformed"] = [
      {
        checkType: "SANCTIONS_SCREENING",
        result: "PASSED",
        performedAt: "2026-01-01T00:00:00Z",
        provider: "chainalysis",
        detail: "OFAC SDN screening",
      },
    ];
    const flags = buildSanctionsFlags(checks);
    expect(flags & (1 << SANCTIONS_BITS.OFAC_SDN_SCREENED)).toBeGreaterThan(0);
  });

  it("sets EU_SCREENED bit for EU detail", () => {
    const checks: ComplianceReceipt["checksPerformed"] = [
      {
        checkType: "SANCTIONS_SCREENING",
        result: "PASSED",
        performedAt: "2026-01-01T00:00:00Z",
        provider: "trm",
        detail: "EU consolidated list screening",
      },
    ];
    const flags = buildSanctionsFlags(checks);
    expect(flags & (1 << SANCTIONS_BITS.EU_SCREENED)).toBeGreaterThan(0);
  });

  it("sets OFAC_SDN_MATCHED bit when OFAC check FAILED", () => {
    const checks: ComplianceReceipt["checksPerformed"] = [
      {
        checkType: "SANCTIONS_SCREENING",
        result: "FAILED",
        performedAt: "2026-01-01T00:00:00Z",
        provider: "chainalysis",
        detail: "OFAC SDN match found",
      },
    ];
    const flags = buildSanctionsFlags(checks);
    expect(flags & (1 << SANCTIONS_BITS.OFAC_SDN_MATCHED)).toBeGreaterThan(0);
  });

  it("does not set match bit when check PASSED", () => {
    const checks: ComplianceReceipt["checksPerformed"] = [
      {
        checkType: "SANCTIONS_SCREENING",
        result: "PASSED",
        performedAt: "2026-01-01T00:00:00Z",
        provider: "chainalysis",
        detail: "OFAC SDN screening",
      },
    ];
    const flags = buildSanctionsFlags(checks);
    expect(flags & (1 << SANCTIONS_BITS.OFAC_SDN_MATCHED)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Schema constants
// ---------------------------------------------------------------------------

describe("schema constants", () => {
  it("PROOFLINK_SCHEMA_REVOCABLE is true", () => {
    expect(PROOFLINK_SCHEMA_REVOCABLE).toBe(true);
  });

  it("PROOFLINK_SCHEMA_DEFINITION is a non-empty string", () => {
    expect(typeof PROOFLINK_SCHEMA_DEFINITION).toBe("string");
    expect(PROOFLINK_SCHEMA_DEFINITION.length).toBeGreaterThan(0);
  });

  it("PROOFLINK_SCHEMA_NAME contains ProofLink", () => {
    expect(PROOFLINK_SCHEMA_NAME).toContain("ProofLink");
  });
});
