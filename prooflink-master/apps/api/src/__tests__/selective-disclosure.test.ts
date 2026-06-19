import { describe, expect, it } from "vitest";
import {
  createSelectiveProof,
  verifySelectiveProof,
  createComplianceAttestation,
} from "../services/selective-disclosure.js";

const CREDENTIAL = {
  id: "did:example:agent1",
  agentDid: "did:example:agent1",
  controllingEntityName: "Acme Corp",
  controllingEntityLEI: "5493001KJTIIGC8Y1R12",
  walletAddress: "0xAlice123",
  delegationScope: {
    maxTransactionValue: 10000,
    dailyLimit: 50000,
    allowedChains: ["eip155:1", "eip155:8453"],
    blockedJurisdictions: ["KP", "IR"],
    expiresAt: "2027-01-01T00:00:00Z",
  },
  agentType: "autonomous",
};

describe("Selective Disclosure", () => {
  it("discloses only requested fields", () => {
    const proof = createSelectiveProof(CREDENTIAL, [
      "controllingEntityName",
      "delegationScope.maxTransactionValue",
    ]);

    expect(proof.disclosed["controllingEntityName"]).toBe("Acme Corp");
    expect(proof.disclosed["delegationScope.maxTransactionValue"]).toBe(10000);

    // Sensitive fields must be hashed, not disclosed
    expect(proof.disclosed["walletAddress"]).toBeUndefined();
    expect(proof.disclosed["controllingEntityLEI"]).toBeUndefined();
    expect(proof.undisclosedHashes["walletAddress"]).toMatch(/^[0-9a-f]{64}$/);
    expect(proof.undisclosedHashes["controllingEntityLEI"]).toMatch(/^[0-9a-f]{64}$/);
  });

  it("verifies a valid selective proof", () => {
    const disclosedFields = ["controllingEntityName"];
    const proof = createSelectiveProof(CREDENTIAL, disclosedFields);
    const result = verifySelectiveProof(proof, disclosedFields);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("detects tampering of disclosed values", () => {
    const disclosedFields = ["controllingEntityName"];
    const proof = createSelectiveProof(CREDENTIAL, disclosedFields);

    // Tamper with a disclosed field
    proof.disclosed["controllingEntityName"] = "Evil Corp";

    const result = verifySelectiveProof(proof, disclosedFields);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("discloses nested objects when parent path is specified", () => {
    const proof = createSelectiveProof(CREDENTIAL, ["delegationScope"]);

    // All child fields of delegationScope should be disclosed
    expect(proof.disclosed["delegationScope.maxTransactionValue"]).toBe(10000);
    expect(proof.disclosed["delegationScope.dailyLimit"]).toBe(50000);
    expect(proof.disclosed["delegationScope.expiresAt"]).toBe("2027-01-01T00:00:00Z");

    // Non-delegationScope fields should be hashed
    expect(proof.undisclosedHashes["walletAddress"]).toBeDefined();
    expect(proof.undisclosedHashes["controllingEntityName"]).toBeDefined();
  });

  it("has a different proofHash for different nonces", () => {
    const a = createSelectiveProof(CREDENTIAL, ["controllingEntityName"]);
    const b = createSelectiveProof(CREDENTIAL, ["controllingEntityName"]);
    // Nonces differ, so proof hashes differ
    expect(a.nonce).not.toBe(b.nonce);
    expect(a.proofHash).not.toBe(b.proofHash);
  });
});

describe("Compliance Attestation", () => {
  const CHECK_RESULT = {
    status: "APPROVED",
    riskScore: 25,
    travelRuleCompliant: true,
    senderAddress: "0xAlice",
    receiverAddress: "0xBob",
    amount: "5000",
    asset: "USDC",
    checksPerformed: [
      { checkType: "SANCTIONS", result: "PASSED" },
      { checkType: "AML", result: "PASSED" },
    ],
  };

  it("reveals compliance status but hides addresses", () => {
    const attestation = createComplianceAttestation(CHECK_RESULT);

    // Disclosed: compliance facts
    expect(attestation.disclosed["status"]).toBe("APPROVED");
    expect(attestation.disclosed["riskBelowThreshold"]).toBe(true);
    expect(attestation.disclosed["travelRuleCompliant"]).toBe(true);
    expect(attestation.disclosed["checksCount"]).toBe(2);

    // Hidden: PII
    expect(attestation.undisclosedHashes["senderAddress"]).toMatch(/^[0-9a-f]{64}$/);
    expect(attestation.undisclosedHashes["receiverAddress"]).toMatch(/^[0-9a-f]{64}$/);
    expect(attestation.undisclosedHashes["amount"]).toMatch(/^[0-9a-f]{64}$/);

    // riskScore hidden by default
    expect(attestation.undisclosedHashes["riskScore"]).toMatch(/^[0-9a-f]{64}$/);
    expect(attestation.disclosed["riskScore"]).toBeUndefined();
  });

  it("optionally discloses riskScore and asset", () => {
    const attestation = createComplianceAttestation(CHECK_RESULT, ["riskScore", "asset"]);

    expect(attestation.disclosed["riskScore"]).toBe(25);
    expect(attestation.disclosed["asset"]).toBe("USDC");
    expect(attestation.undisclosedHashes["riskScore"]).toBeUndefined();
    expect(attestation.undisclosedHashes["asset"]).toBeUndefined();
  });

  it("correctly reports riskBelowThreshold for high-risk checks", () => {
    const highRisk = { ...CHECK_RESULT, riskScore: 90 };
    const attestation = createComplianceAttestation(highRisk);
    expect(attestation.disclosed["riskBelowThreshold"]).toBe(false);
  });
});
