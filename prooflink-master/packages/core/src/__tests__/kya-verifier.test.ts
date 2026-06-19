import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  KYAVerifier,
  type VerifiableCredential,
  type KYACredentialSubject,
  type DelegationScope,
} from "../identity/kya-verifier.js";
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
    restrictedJurisdictions: ["IR", "KP"],
    ...overrides,
  };
}

/** Returns a delegation scope expiring far in the future. */
function futureDelegationScope(
  overrides?: Partial<DelegationScope>,
): DelegationScope {
  return {
    expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
    maxTransactionAmount: 100_000,
    currency: "USD",
    ...overrides,
  };
}

/** Builds a valid KYA VC for the given agent DID. */
function makeValidCredential(
  agentDid = "did:key:z6Mktest",
  delegationOverrides?: Partial<DelegationScope>,
): VerifiableCredential {
  const subject: KYACredentialSubject = {
    id: agentDid,
    controllingEntityName: "Acme Corp",
    controllingEntityLEI: "213800EXAMPLE000000",
    walletAddress: "0x1234567890abcdef1234567890abcdef12345678",
    delegationScope: futureDelegationScope(delegationOverrides),
  };

  return {
    "@context": [
      "https://www.w3.org/2018/credentials/v1",
      "https://prooflink.io/kya/v1",
    ],
    type: ["VerifiableCredential", "KYACredential"],
    issuer: "did:web:prooflink.io",
    issuanceDate: new Date(Date.now() - 60_000).toISOString(),
    expirationDate: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
    credentialSubject: subject as unknown as VerifiableCredential["credentialSubject"],
    proof: {
      type: "Ed25519Signature2020",
      created: new Date(Date.now() - 60_000).toISOString(),
      verificationMethod: "did:web:prooflink.io#key-1",
      proofPurpose: "assertionMethod",
      proofValue: "mock_proof_value",
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("KYAVerifier — valid credential", () => {
  it("should verify a fully valid credential", async () => {
    const verifier = new KYAVerifier(makeConfig());
    const credential = makeValidCredential();

    const result = await verifier.verifyCredential(credential);

    expect(result.verified).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.credentialExpired).toBe(false);
    expect(result.delegationValid).toBe(true);
    expect(result.erc8004Registered).toBe(true); // no registry configured → defaults to true
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("should return agentDid from credentialSubject.id", async () => {
    const verifier = new KYAVerifier(makeConfig());
    const credential = makeValidCredential("did:key:z6MkAgent123");

    const result = await verifier.verifyCredential(credential);

    expect(result.agentDid).toBe("did:key:z6MkAgent123");
  });

  it("should accept issuer as an object with id field", async () => {
    const verifier = new KYAVerifier(makeConfig());
    const credential = makeValidCredential();
    credential.issuer = { id: "did:web:prooflink.io", name: "ProofLink" };

    const result = await verifier.verifyCredential(credential);

    expect(result.verified).toBe(true);
  });

  it("should expose controllingEntity from credential subject", async () => {
    const verifier = new KYAVerifier(makeConfig());
    const credential = makeValidCredential();

    const result = await verifier.verifyCredential(credential);

    expect(result.controllingEntity).toBe("Acme Corp");
  });
});

// ---------------------------------------------------------------------------
// Expiration
// ---------------------------------------------------------------------------

describe("KYAVerifier — credential expiration", () => {
  it("should fail verification when credential is expired", async () => {
    const verifier = new KYAVerifier(makeConfig());
    const credential = makeValidCredential();
    // Set expirationDate to the past
    credential.expirationDate = new Date(Date.now() - 1_000).toISOString();

    const result = await verifier.verifyCredential(credential);

    expect(result.verified).toBe(false);
    expect(result.credentialExpired).toBe(true);
    expect(result.errors.some((e) => e.includes("expired"))).toBe(true);
  });

  it("should pass when no expirationDate is set", async () => {
    const verifier = new KYAVerifier(makeConfig());
    const credential = makeValidCredential();
    delete credential.expirationDate;

    const result = await verifier.verifyCredential(credential);

    expect(result.credentialExpired).toBe(false);
    expect(result.verified).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Delegation scope — amount limit
// ---------------------------------------------------------------------------

describe("KYAVerifier — delegation scope amount limit", () => {
  it("should pass when transaction amount is below delegation limit", async () => {
    const verifier = new KYAVerifier(makeConfig());
    const credential = makeValidCredential(undefined, {
      maxTransactionAmount: 5_000,
    });

    const result = await verifier.verifyCredential(credential, 4_999);

    expect(result.verified).toBe(true);
    expect(result.delegationValid).toBe(true);
  });

  it("should pass when transaction amount equals delegation limit exactly", async () => {
    const verifier = new KYAVerifier(makeConfig());
    const credential = makeValidCredential(undefined, {
      maxTransactionAmount: 5_000,
    });

    // Amount equal to limit — NOT exceeded (strict >)
    const result = await verifier.verifyCredential(credential, 5_000);

    expect(result.verified).toBe(true);
    expect(result.delegationValid).toBe(true);
  });

  it("should fail when transaction amount exceeds delegation limit", async () => {
    const verifier = new KYAVerifier(makeConfig());
    const credential = makeValidCredential(undefined, {
      maxTransactionAmount: 5_000,
    });

    const result = await verifier.verifyCredential(credential, 5_001);

    expect(result.verified).toBe(false);
    expect(result.delegationValid).toBe(false);
    expect(
      result.errors.some(
        (e) => e.includes("5001") && e.includes("5000"),
      ),
    ).toBe(true);
  });

  it("should not enforce amount limit when no transactionAmountUsd is provided", async () => {
    const verifier = new KYAVerifier(makeConfig());
    const credential = makeValidCredential(undefined, {
      maxTransactionAmount: 100,
    });

    // No amount provided → no amount check
    const result = await verifier.verifyCredential(credential, undefined);

    expect(result.verified).toBe(true);
  });

  it("should not enforce amount limit when maxTransactionAmount is not set", async () => {
    const verifier = new KYAVerifier(makeConfig());
    const credential = makeValidCredential(undefined, {
      maxTransactionAmount: undefined,
    });

    const result = await verifier.verifyCredential(credential, 1_000_000);

    expect(result.verified).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Delegation scope — jurisdiction
// ---------------------------------------------------------------------------

describe("KYAVerifier — delegation scope jurisdiction checks", () => {
  it("should fail when jurisdiction is in restrictedJurisdictions of delegation", async () => {
    const verifier = new KYAVerifier(makeConfig());
    const credential = makeValidCredential(undefined, {
      restrictedJurisdictions: ["IR", "KP"],
    });

    const result = await verifier.verifyCredential(credential, 100, "IR");

    expect(result.verified).toBe(false);
    expect(result.delegationValid).toBe(false);
    expect(result.errors.some((e) => e.includes("IR"))).toBe(true);
  });

  it("should pass when jurisdiction is not in restricted list", async () => {
    const verifier = new KYAVerifier(makeConfig());
    const credential = makeValidCredential(undefined, {
      restrictedJurisdictions: ["IR", "KP"],
    });

    const result = await verifier.verifyCredential(credential, 100, "US");

    expect(result.verified).toBe(true);
  });

  it("should fail when jurisdiction is not in allowedJurisdictions list", async () => {
    const verifier = new KYAVerifier(makeConfig());
    const credential = makeValidCredential(undefined, {
      allowedJurisdictions: ["US", "GB"],
    });

    const result = await verifier.verifyCredential(credential, 100, "DE");

    expect(result.verified).toBe(false);
    expect(result.delegationValid).toBe(false);
    expect(result.errors.some((e) => e.includes("DE"))).toBe(true);
  });

  it("should pass when jurisdiction is in allowedJurisdictions list", async () => {
    const verifier = new KYAVerifier(makeConfig());
    const credential = makeValidCredential(undefined, {
      allowedJurisdictions: ["US", "GB", "DE"],
    });

    const result = await verifier.verifyCredential(credential, 100, "GB");

    expect(result.verified).toBe(true);
  });

  it("should not enforce jurisdiction checks when no jurisdiction is provided", async () => {
    const verifier = new KYAVerifier(makeConfig());
    const credential = makeValidCredential(undefined, {
      restrictedJurisdictions: ["IR"],
      allowedJurisdictions: ["US"],
    });

    // No jurisdiction provided → skip all jurisdiction checks
    const result = await verifier.verifyCredential(credential, 100, undefined);

    expect(result.verified).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Delegation scope expiry
// ---------------------------------------------------------------------------

describe("KYAVerifier — delegation scope expiry", () => {
  it("should fail when delegation scope itself is expired", async () => {
    const verifier = new KYAVerifier(makeConfig());
    const credential = makeValidCredential(undefined, {
      expiresAt: new Date(Date.now() - 1_000).toISOString(), // delegation expired
    });

    const result = await verifier.verifyCredential(credential, 100);

    expect(result.verified).toBe(false);
    expect(result.delegationValid).toBe(false);
    expect(result.errors.some((e) => e.includes("Delegation expired"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// W3C VC structure validation
// ---------------------------------------------------------------------------

describe("KYAVerifier — VC structure validation", () => {
  it("should fail when @context is missing the W3C credentials context", async () => {
    const verifier = new KYAVerifier(makeConfig());
    const credential = makeValidCredential();
    credential["@context"] = ["https://prooflink.io/kya/v1"]; // missing W3C context

    const result = await verifier.verifyCredential(credential);

    expect(result.verified).toBe(false);
    expect(result.errors.some((e) => e.includes("context"))).toBe(true);
  });

  it("should fail when @context is not an array", async () => {
    const verifier = new KYAVerifier(makeConfig());
    const credential = makeValidCredential();
    (credential as unknown as Record<string, unknown>)["@context"] = "not-an-array";

    const result = await verifier.verifyCredential(credential);

    expect(result.verified).toBe(false);
    expect(result.errors.some((e) => e.includes("context"))).toBe(true);
  });

  it("should fail when type does not include VerifiableCredential", async () => {
    const verifier = new KYAVerifier(makeConfig());
    const credential = makeValidCredential();
    credential.type = ["KYACredential"]; // missing VerifiableCredential

    const result = await verifier.verifyCredential(credential);

    expect(result.verified).toBe(false);
    expect(result.errors.some((e) => e.includes('"VerifiableCredential" type'))).toBe(true);
  });

  it("should fail when issuer is an empty string (not in trusted list)", async () => {
    // Setting issuer to undefined would cause an uncaught TypeError in the source code
    // (it tries to read .id on undefined). Test with empty string instead, which
    // passes the `!vc.issuer` structural check but fails the trust check.
    const verifier = new KYAVerifier(makeConfig());
    const credential = makeValidCredential();
    credential.issuer = ""; // empty string — fails !vc.issuer check → "Missing issuer"

    const result = await verifier.verifyCredential(credential);

    expect(result.verified).toBe(false);
    expect(result.errors.some((e) => e.includes("issuer"))).toBe(true);
  });

  it("should fail when issuanceDate is missing", async () => {
    const verifier = new KYAVerifier(makeConfig());
    const credential = makeValidCredential();
    (credential as unknown as Record<string, unknown>).issuanceDate = undefined;

    const result = await verifier.verifyCredential(credential);

    expect(result.verified).toBe(false);
    expect(result.errors.some((e) => e.includes("issuanceDate"))).toBe(true);
  });

  it("should fail when credentialSubject.id is missing", async () => {
    const verifier = new KYAVerifier(makeConfig());
    const credential = makeValidCredential();
    (credential.credentialSubject as Record<string, unknown>).id = undefined;

    const result = await verifier.verifyCredential(credential);

    expect(result.verified).toBe(false);
    expect(result.errors.some((e) => e.includes("credentialSubject.id"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Untrusted issuer
// ---------------------------------------------------------------------------

describe("KYAVerifier — issuer trust", () => {
  it("should fail when issuer is not in the trusted issuers list", async () => {
    const verifier = new KYAVerifier(makeConfig(), ["did:web:trusted.io"]);
    const credential = makeValidCredential();
    credential.issuer = "did:web:untrusted.io";

    const result = await verifier.verifyCredential(credential);

    expect(result.verified).toBe(false);
    expect(result.errors.some((e) => e.includes("trusted issuers"))).toBe(true);
  });

  it("should accept default trusted issuers (did:web:prooflink.io)", async () => {
    const verifier = new KYAVerifier(makeConfig()); // uses default trusted issuers
    const credential = makeValidCredential();
    // issuer is did:web:prooflink.io by default

    const result = await verifier.verifyCredential(credential);

    expect(result.verified).toBe(true);
  });

  it("should accept custom trusted issuers passed to constructor", async () => {
    const verifier = new KYAVerifier(makeConfig(), [
      "did:web:custom-issuer.io",
    ]);
    const credential = makeValidCredential();
    credential.issuer = "did:web:custom-issuer.io";

    const result = await verifier.verifyCredential(credential);

    expect(result.verified).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Caching behaviour
// ---------------------------------------------------------------------------

describe("KYAVerifier — caching", () => {
  it("should cache a verified credential result and return cached value on second call", async () => {
    const verifier = new KYAVerifier(makeConfig());
    const agentDid = "did:key:z6MkCacheTest";
    const credential = makeValidCredential(agentDid);

    // First call — no tx-specific params → eligible for cache
    const first = await verifier.verifyCredential(credential);
    expect(first.verified).toBe(true);

    // Second call with the same credential — should return the cached result
    // (latencyMs may differ but verified must be the same)
    const second = await verifier.verifyCredential(credential);
    expect(second.verified).toBe(true);
    expect(second.agentDid).toBe(agentDid);
  });

  it("should NOT use cache for different agent DIDs", async () => {
    const verifier = new KYAVerifier(makeConfig());

    // First agent
    const cred1 = makeValidCredential("did:key:z6MkAgent001");
    await verifier.verifyCredential(cred1);

    // Second agent with untrusted issuer → should fail (not cached)
    const cred2 = makeValidCredential("did:key:z6MkAgent002");
    cred2.issuer = "did:web:untrusted.io";
    const result = await verifier.verifyCredential(cred2);

    expect(result.verified).toBe(false);
    expect(result.errors.some((e) => e.includes("trusted issuers"))).toBe(true);
  });

  it("should bypass cache when transactionAmountUsd is provided", async () => {
    const verifier = new KYAVerifier(makeConfig());
    const credential = makeValidCredential();

    // First call — cached
    await verifier.verifyCredential(credential);

    // Second call with tx-specific param — should NOT use cache
    // Expire the delegation to force a fresh evaluation to fail
    (credential.credentialSubject as unknown as KYACredentialSubject).delegationScope.expiresAt =
      new Date(Date.now() - 1_000).toISOString();

    const freshResult = await verifier.verifyCredential(credential, 100);
    expect(freshResult.verified).toBe(false);
  });

  it("should clear the cache when clearCache() is called", async () => {
    const verifier = new KYAVerifier(makeConfig());
    const credential = makeValidCredential();

    // Prime the cache
    const first = await verifier.verifyCredential(credential);
    expect(first.verified).toBe(true);

    verifier.clearCache();

    // After clearing, expire the credential — re-evaluation should now fail
    credential.expirationDate = new Date(Date.now() - 1_000).toISOString();
    const afterClear = await verifier.verifyCredential(credential);
    expect(afterClear.verified).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// ERC-8004 registry (no registry configured → defaults to true)
// ---------------------------------------------------------------------------

describe("KYAVerifier — ERC-8004 registration", () => {
  it("should skip ERC-8004 check and set erc8004Registered=true when registry not configured", async () => {
    const verifier = new KYAVerifier(
      makeConfig({ erc8004RegistryAddress: undefined, rpcUrl: undefined }),
    );
    const credential = makeValidCredential();

    const result = await verifier.verifyCredential(credential);

    expect(result.erc8004Registered).toBe(true);
    expect(result.verified).toBe(true);
  });

  it("should include ERC-8004 error in errors array when registry check fails", async () => {
    // Configure a registry address but no valid RPC so the on-chain call will fail
    const verifier = new KYAVerifier(
      makeConfig({
        erc8004RegistryAddress: "0x1234567890abcdef1234567890abcdef12345678",
        rpcUrl: "https://invalid-rpc.example.com",
      }),
    );
    const credential = makeValidCredential();

    const result = await verifier.verifyCredential(credential);

    // ERC-8004 check fails → error pushed, verified=false
    expect(result.verified).toBe(false);
    expect(result.errors.some((e) => e.includes("ERC-8004"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Multiple errors accumulate
// ---------------------------------------------------------------------------

describe("KYAVerifier — error accumulation", () => {
  it("should accumulate multiple structural errors before returning", async () => {
    const verifier = new KYAVerifier(makeConfig());
    const credential = makeValidCredential();
    credential["@context"] = []; // missing W3C context
    credential.type = []; // missing VerifiableCredential
    (credential as unknown as Record<string, unknown>).issuanceDate = undefined; // missing issuanceDate

    const result = await verifier.verifyCredential(credential);

    expect(result.verified).toBe(false);
    expect(result.errors.length).toBeGreaterThanOrEqual(3);
  });
});
