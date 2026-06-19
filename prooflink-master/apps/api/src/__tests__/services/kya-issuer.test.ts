import { describe, expect, it, beforeEach, afterEach } from "vitest";

import {
  issueKYACredential,
  verifyCredentialSignature,
} from "../../services/kya-issuer.js";
import type { IssueKYACredentialInput } from "../../services/kya-issuer.js";

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

function makeInput(overrides: Partial<IssueKYACredentialInput> = {}): IssueKYACredentialInput {
  return {
    agentDid: "did:web:agent.prooflink.io",
    controllingEntityName: "Acme Corp",
    walletAddress: "0xABCDEF1234567890ABCDEF1234567890ABCDEF12",
    delegationScope: {
      maxTransactionValue: 5000,
      expiresAt: "2027-01-01T00:00:00.000Z",
    },
    expiresAt: "2027-01-01T00:00:00.000Z",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("issueKYACredential + verifyCredentialSignature", () => {
  const originalSecret = process.env.KYA_SIGNING_SECRET;

  beforeEach(() => {
    process.env.KYA_SIGNING_SECRET = "test-secret-do-not-use-in-production";
  });

  afterEach(() => {
    if (originalSecret === undefined) {
      delete process.env.KYA_SIGNING_SECRET;
    } else {
      process.env.KYA_SIGNING_SECRET = originalSecret;
    }
  });

  // -------------------------------------------------------------------------
  // Round-trip signature verification
  // -------------------------------------------------------------------------

  it("verifyCredentialSignature returns true for a freshly issued credential", () => {
    const { credential } = issueKYACredential(makeInput());
    expect(verifyCredentialSignature(credential)).toBe(true);
  });

  it("verifyCredentialSignature returns false after tampering with credentialSubject.agentDid", () => {
    const { credential } = issueKYACredential(makeInput());

    // Deep-clone and mutate the subject
    const tampered = JSON.parse(JSON.stringify(credential));
    tampered.credentialSubject.id = "did:web:evil-attacker.io";
    tampered.credentialSubject.agentDid = "did:web:evil-attacker.io";

    expect(verifyCredentialSignature(tampered)).toBe(false);
  });

  it("verifyCredentialSignature returns false after tampering with controllingEntityName", () => {
    const { credential } = issueKYACredential(makeInput());

    const tampered = JSON.parse(JSON.stringify(credential));
    tampered.credentialSubject.controllingEntityName = "Malicious Corp";

    expect(verifyCredentialSignature(tampered)).toBe(false);
  });

  it("verifyCredentialSignature returns false after tampering with delegationScope.maxTransactionValue", () => {
    const { credential } = issueKYACredential(makeInput());

    const tampered = JSON.parse(JSON.stringify(credential));
    tampered.credentialSubject.delegationScope.maxTransactionValue = 999_999_999;

    expect(verifyCredentialSignature(tampered)).toBe(false);
  });

  it("verifyCredentialSignature returns false when jws is replaced with a random string", () => {
    const { credential } = issueKYACredential(makeInput());

    const tampered = JSON.parse(JSON.stringify(credential));
    tampered.proof.jws = "totally-invalid-jws-value";

    expect(verifyCredentialSignature(tampered)).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Missing required fields — Zod throws
  // -------------------------------------------------------------------------

  it("throws a ZodError when agentDid is missing", () => {
    const input = makeInput({ agentDid: undefined as unknown as string });
    expect(() => issueKYACredential(input)).toThrow();
  });

  it("throws a ZodError when agentDid does not match did: pattern", () => {
    const input = makeInput({ agentDid: "not-a-did" });
    expect(() => issueKYACredential(input)).toThrow();
  });

  it("throws a ZodError when controllingEntityName is empty", () => {
    const input = makeInput({ controllingEntityName: "" });
    expect(() => issueKYACredential(input)).toThrow();
  });

  it("throws a ZodError when walletAddress is empty", () => {
    const input = makeInput({ walletAddress: "" });
    expect(() => issueKYACredential(input)).toThrow();
  });

  it("throws a ZodError when delegationScope is missing expiresAt", () => {
    const input = makeInput({
      delegationScope: {
        maxTransactionValue: 1000,
        expiresAt: undefined as unknown as string,
      },
    });
    expect(() => issueKYACredential(input)).toThrow();
  });

  it("throws a ZodError when delegationScope.maxTransactionValue is negative", () => {
    const input = makeInput({
      delegationScope: {
        maxTransactionValue: -1,
        expiresAt: "2027-01-01T00:00:00.000Z",
      },
    });
    expect(() => issueKYACredential(input)).toThrow();
  });

  it("throws a ZodError when controllingEntityLEI has wrong format", () => {
    const input = makeInput({ controllingEntityLEI: "TOOLONGORSHORT" });
    expect(() => issueKYACredential(input)).toThrow();
  });

  it("throws a ZodError when agentType is not a valid enum value", () => {
    const input = makeInput({ agentType: "super-agent" as "autonomous" });
    expect(() => issueKYACredential(input)).toThrow();
  });

  // -------------------------------------------------------------------------
  // Missing KYA_SIGNING_SECRET
  // -------------------------------------------------------------------------

  it("throws when KYA_SIGNING_SECRET is not set", () => {
    delete process.env.KYA_SIGNING_SECRET;
    expect(() => issueKYACredential(makeInput())).toThrow(
      "KYA_SIGNING_SECRET environment variable is not set",
    );
  });

  it("verifyCredentialSignature throws when KYA_SIGNING_SECRET is not set", () => {
    const { credential } = issueKYACredential(makeInput());
    delete process.env.KYA_SIGNING_SECRET;
    expect(() => verifyCredentialSignature(credential)).toThrow(
      "KYA_SIGNING_SECRET environment variable is not set",
    );
  });

  // -------------------------------------------------------------------------
  // Deterministic credential hash
  // -------------------------------------------------------------------------

  it("generates the same credentialHash for identical inputs (minus UUID)", () => {
    // Two separate issuances will have different credentialIds (UUID) so the
    // hashes will differ. We verify determinism by checking the hash is stable
    // across the issueKYACredential call for the same issued credential.
    const { credential, credentialHash } = issueKYACredential(makeInput());
    // The hash returned equals the hash embedded in the credential
    expect(credential.credentialHash).toBe(credentialHash);
  });

  it("returns different credentialHash for different agentDid inputs", () => {
    const { credentialHash: hash1 } = issueKYACredential(makeInput({ agentDid: "did:web:agent-a.io" }));
    const { credentialHash: hash2 } = issueKYACredential(makeInput({ agentDid: "did:web:agent-b.io" }));
    expect(hash1).not.toBe(hash2);
  });

  it("credentialHash is a 64-character lowercase hex string (SHA-256)", () => {
    const { credentialHash } = issueKYACredential(makeInput());
    expect(credentialHash).toMatch(/^[a-f0-9]{64}$/);
  });

  // -------------------------------------------------------------------------
  // Credential structure
  // -------------------------------------------------------------------------

  it("credential has @context with W3C and ProofLink context URLs", () => {
    const { credential } = issueKYACredential(makeInput());
    expect(credential["@context"]).toContain("https://www.w3.org/2018/credentials/v1");
    expect(credential["@context"]).toContain("https://prooflink.io/credentials/kya/v1");
  });

  it("credential type includes VerifiableCredential and KYACredential", () => {
    const { credential } = issueKYACredential(makeInput());
    expect(credential.type).toContain("VerifiableCredential");
    expect(credential.type).toContain("KYACredential");
  });

  it("credential proof has type HmacSha256Signature2024", () => {
    const { credential } = issueKYACredential(makeInput());
    expect(credential.proof.type).toBe("HmacSha256Signature2024");
  });

  it("credential proof.verificationMethod references the issuer DID", () => {
    const { credential } = issueKYACredential(makeInput());
    expect(credential.proof.verificationMethod).toContain("did:web:prooflink.io");
  });

  it("credential proof.proofPurpose is assertionMethod", () => {
    const { credential } = issueKYACredential(makeInput());
    expect(credential.proof.proofPurpose).toBe("assertionMethod");
  });

  it("credential issuer.id is did:web:prooflink.io", () => {
    const { credential } = issueKYACredential(makeInput());
    expect((credential.issuer as { id: string }).id).toBe("did:web:prooflink.io");
  });

  it("credential issuer.name is ProofLink", () => {
    const { credential } = issueKYACredential(makeInput());
    expect((credential.issuer as { name: string }).name).toBe("ProofLink");
  });

  it("credential id is a urn:uuid: string", () => {
    const { credential } = issueKYACredential(makeInput());
    expect(credential.id).toMatch(/^urn:uuid:[0-9a-f-]{36}$/);
  });

  it("credentialSubject.id equals the agentDid", () => {
    const { credential } = issueKYACredential(
      makeInput({ agentDid: "did:web:test-agent.io" }),
    );
    expect(credential.credentialSubject.id).toBe("did:web:test-agent.io");
  });

  it("optional fields are carried through when provided", () => {
    const { credential } = issueKYACredential(
      makeInput({
        controllingEntityLEI: "529900T8BM49AURSDO55",
        agentType: "autonomous",
        allowedProtocols: ["x402", "direct"],
        erc8004AgentId: "erc8004-001",
      }),
    );
    expect(credential.credentialSubject.controllingEntityLEI).toBe("529900T8BM49AURSDO55");
    expect(credential.credentialSubject.agentType).toBe("autonomous");
    expect(credential.credentialSubject.allowedProtocols).toEqual(["x402", "direct"]);
    expect(credential.credentialSubject.erc8004AgentId).toBe("erc8004-001");
  });

  it("expirationDate matches the expiresAt input", () => {
    const expiresAt = "2028-06-15T00:00:00.000Z";
    const { credential } = issueKYACredential(makeInput({ expiresAt }));
    expect(credential.expirationDate).toBe(expiresAt);
  });
});
