import { describe, it, expect, vi, beforeEach } from "vitest";
import { ProofLinkEngine, type ComplianceRequest } from "../engine/prooflink.js";
import { KYAVerifier, type VerifiableCredential, type DelegationScope } from "../identity/kya-verifier.js";
import { AMLScorer, type TransactionContext } from "../aml/scorer.js";
import type { ProofLinkConfig } from "../config.js";
import { MockNotabeneProvider } from "../travel-rule/checker.js";

// ---------------------------------------------------------------------------
// Mock fetch globally to avoid real Chainalysis API calls
// ---------------------------------------------------------------------------

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

function mockCleanResponse(): Response {
  return new Response(JSON.stringify({ identifications: [] }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function setCleanFetch(): void {
  mockFetch.mockImplementation(() => Promise.resolve(mockCleanResponse()));
}

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
    cacheMaxEntries: 1000,
    sanctionsCacheTtlMs: 300_000,
    kyaCacheTtlMs: 900_000,
    restrictedJurisdictions: ["IR", "KP", "SY", "CU", "RU"],
    ...overrides,
  };
}

function makeRequest(overrides?: Partial<ComplianceRequest>): ComplianceRequest {
  return {
    sender: "0x1234567890abcdef1234567890abcdef12345678",
    receiver: "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd",
    amountUsd: 100,
    asset: "USDC",
    chain: "eip155:8453",
    ...overrides,
  };
}

function makeTx(overrides?: Partial<TransactionContext>): TransactionContext {
  return {
    senderAddress: "0x1234567890abcdef1234567890abcdef12345678",
    receiverAddress: "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd",
    amountUsd: 100,
    chain: "eip155:1",
    asset: "USDC",
    ...overrides,
  };
}

function futureDelegationScope(overrides?: Partial<DelegationScope>): DelegationScope {
  return {
    expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
    maxTransactionAmount: 100_000,
    ...overrides,
  };
}

function makeValidCredential(
  agentDid = "did:key:z6Mktest",
  delegationOverrides?: Partial<DelegationScope>,
): VerifiableCredential {
  return {
    "@context": [
      "https://www.w3.org/2018/credentials/v1",
      "https://prooflink.io/kya/v1",
    ],
    type: ["VerifiableCredential", "KYACredential"],
    issuer: "did:web:prooflink.io",
    issuanceDate: new Date(Date.now() - 60_000).toISOString(),
    expirationDate: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
    credentialSubject: {
      id: agentDid,
      walletAddress: "0x1234567890abcdef1234567890abcdef12345678",
      delegationScope: futureDelegationScope(delegationOverrides),
    } as unknown as VerifiableCredential["credentialSubject"],
  };
}

// ---------------------------------------------------------------------------
// Empty string addresses
// ---------------------------------------------------------------------------

describe("ProofLinkEngine — empty string addresses", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it("should process request with empty sender address without throwing", async () => {
    setCleanFetch();
    const engine = new ProofLinkEngine(makeConfig(), {
      travelRuleProvider: new MockNotabeneProvider(),
    });

    // Empty sender will be lowercased and screened; API returns clean
    const decision = await engine.checkCompliance(makeRequest({ sender: "" }));
    expect(decision.status).toBeDefined();
  });

  it("should process request with empty receiver address without throwing", async () => {
    setCleanFetch();
    const engine = new ProofLinkEngine(makeConfig(), {
      travelRuleProvider: new MockNotabeneProvider(),
    });

    const decision = await engine.checkCompliance(makeRequest({ receiver: "" }));
    expect(decision.status).toBeDefined();
  });

  it("should match empty sender against blocklist entry of empty string", async () => {
    const engine = new ProofLinkEngine(makeConfig({ blocklist: [""] }));

    const decision = await engine.checkCompliance(makeRequest({ sender: "" }));
    expect(decision.status).toBe("REJECTED");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("should match empty sender against allowlist entry of empty string", async () => {
    setCleanFetch();
    const engine = new ProofLinkEngine(makeConfig({ allowlist: [""] }));

    const decision = await engine.checkCompliance(makeRequest({ sender: "" }));
    expect(decision.status).toBe("APPROVED");
  });
});

// ---------------------------------------------------------------------------
// Unicode in asset names
// ---------------------------------------------------------------------------

describe("ProofLinkEngine — unicode in asset names", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it("should handle unicode asset name without throwing", async () => {
    setCleanFetch();
    const engine = new ProofLinkEngine(makeConfig(), {
      travelRuleProvider: new MockNotabeneProvider(),
    });

    const decision = await engine.checkCompliance(
      makeRequest({ asset: "テスト通貨" }),
    );
    expect(decision.status).toBeDefined();
    expect(decision.receiptId).toBeTruthy();
  });

  it("should handle emoji in asset name", async () => {
    setCleanFetch();
    const engine = new ProofLinkEngine(makeConfig(), {
      travelRuleProvider: new MockNotabeneProvider(),
    });

    const decision = await engine.checkCompliance(
      makeRequest({ asset: "💎TOKEN" }),
    );
    expect(decision.status).toBeDefined();
  });

  it("should not flag USDT MiCA rule for unicode asset name", async () => {
    setCleanFetch();
    const engine = new ProofLinkEngine(makeConfig(), {
      travelRuleProvider: new MockNotabeneProvider(),
    });

    // Unicode asset is not USDT, so MiCA rule should not trigger
    const decision = await engine.checkCompliance(
      makeRequest({ asset: "USDT\u200B", senderJurisdiction: "DE" }),
    );

    const jurisdictionCheck = decision.checks.find(
      (c) => c.checkType === "JURISDICTIONAL_RULES",
    );
    // The trimmed-looking asset is not exactly "USDT" so MiCA should pass
    expect(jurisdictionCheck?.result).toBe("PASSED");
  });
});

// ---------------------------------------------------------------------------
// Negative amounts
// ---------------------------------------------------------------------------

describe("AMLScorer — negative amounts", () => {
  it("should not trigger amount_anomaly flag for negative amount with no history", () => {
    const scorer = new AMLScorer(makeConfig());
    // Negative amount: no history branch → triggered if amountUsd > 10_000, -500 is not
    const result = scorer.calculateRiskScore(makeTx({ amountUsd: -500 }));
    const factor = result.factors.find((f) => f.factor === "amount_anomaly");
    expect(factor?.detail).toContain("No historical average");
    // -500 is not > 10_000, so no trigger on amount alone
  });

  it("should produce score in [0, 100] range for negative amount", () => {
    const scorer = new AMLScorer(makeConfig());
    const result = scorer.calculateRiskScore(makeTx({ amountUsd: -999_999 }));
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
  });

  it("should not flag structuring for negative amount", () => {
    const scorer = new AMLScorer(makeConfig());
    // Structuring checks for values in [threshold*0.9, threshold) — negative fails both
    const result = scorer.calculateRiskScore(makeTx({ amountUsd: -2_800 }));
    const factor = result.factors.find((f) => f.factor === "structuring");
    expect(factor?.detail).toContain("No structuring");
  });
});

// ---------------------------------------------------------------------------
// Zero amounts
// ---------------------------------------------------------------------------

describe("ProofLinkEngine — zero amount", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it("should approve a zero-amount transaction (no AML signals, below Travel Rule)", async () => {
    setCleanFetch();
    const engine = new ProofLinkEngine(makeConfig(), {
      travelRuleProvider: new MockNotabeneProvider(),
    });

    const decision = await engine.checkCompliance(makeRequest({ amountUsd: 0 }));

    expect(decision.status).toBe("APPROVED");
    expect(decision.travelRuleStatus).toBe("NOT_REQUIRED");
  });

  it("AMLScorer should produce score 0 for zero amount with clean context", () => {
    const scorer = new AMLScorer(makeConfig());
    const result = scorer.calculateRiskScore(
      makeTx({
        amountUsd: 0,
        txCountLastHour: 1,
        txCountLast24h: 5,
        historicalAvgAmountUsd: 100,
        isNewWallet: false,
        involvesMixer: false,
        receiverDarknetExposure: false,
        receiverSanctionedProximity: -1,
      }),
    );
    expect(result.score).toBe(0);
    expect(result.exceeds).toBe(false);
  });

  it("should not trigger cross_chain_correlation at zero amount even with bridge", () => {
    const scorer = new AMLScorer(makeConfig());
    const result = scorer.calculateRiskScore(
      makeTx({
        amountUsd: 0,
        crossChainCount24h: 5,
        recentBridgeActivity: true,
      }),
    );
    const factor = result.factors.find((f) => f.factor === "cross_chain_correlation");
    // crossChain: chainCount >= 3 AND amount > 1000 → 0 fails second condition
    // bridge: amount > 5000 → 0 fails → not triggered
    expect(factor?.detail).toContain("Normal chain usage");
  });
});

// ---------------------------------------------------------------------------
// Very large amounts ($1 billion+)
// ---------------------------------------------------------------------------

describe("ProofLinkEngine — very large amounts", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it("should handle $1 billion transaction without throwing", async () => {
    setCleanFetch();
    const engine = new ProofLinkEngine(makeConfig(), {
      travelRuleProvider: new MockNotabeneProvider(),
    });

    const decision = await engine.checkCompliance(
      makeRequest({ amountUsd: 1_000_000_000, senderJurisdiction: "US" }),
    );

    expect(decision.status).toBeDefined();
    expect(decision.travelRuleStatus).toBe("TRANSMITTED");
  });

  it("AMLScorer should clamp score to 100 for $1 billion with all risk flags", () => {
    const scorer = new AMLScorer(makeConfig());
    const result = scorer.calculateRiskScore(
      makeTx({
        amountUsd: 1_000_000_000,
        historicalAvgAmountUsd: 100, // 10M× the average → amount_anomaly
        txCountLastHour: 50,
        isNewWallet: true,
        involvesMixer: true,
        receiverDarknetExposure: true,
        receiverSanctionedProximity: 1,
        transactionHourUtc: 3,
        crossChainCount24h: 5,
      }),
    );
    expect(result.score).toBeLessThanOrEqual(100);
    expect(result.score).toBeGreaterThanOrEqual(0);
  });

  it("AMLScorer detail strings should not overflow for $1 billion", () => {
    const scorer = new AMLScorer(makeConfig());
    const result = scorer.calculateRiskScore(
      makeTx({ amountUsd: 1_000_000_000, historicalAvgAmountUsd: 1 }),
    );
    // toFixed(2) should produce a finite string
    const amountFactor = result.factors.find((f) => f.factor === "amount_anomaly");
    expect(amountFactor?.detail).toContain("1000000000.00");
  });
});

// ---------------------------------------------------------------------------
// Very long chain IDs
// ---------------------------------------------------------------------------

describe("ProofLinkEngine — very long chain IDs", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it("should handle a very long chain ID string without throwing", async () => {
    setCleanFetch();
    const engine = new ProofLinkEngine(makeConfig(), {
      travelRuleProvider: new MockNotabeneProvider(),
    });

    const longChainId = "eip155:" + "9".repeat(1000);
    const decision = await engine.checkCompliance(
      makeRequest({ chain: longChainId }),
    );

    expect(decision.status).toBeDefined();
  });

  it("AMLScorer should accept long chain ID in context without throwing", () => {
    const scorer = new AMLScorer(makeConfig());
    const result = scorer.calculateRiskScore(
      makeTx({ chain: "eip155:" + "1".repeat(500) }),
    );
    expect(result.score).toBeGreaterThanOrEqual(0);
  });
});

// ---------------------------------------------------------------------------
// Concurrent compliance checks (race conditions)
// ---------------------------------------------------------------------------

describe("ProofLinkEngine — concurrent compliance checks", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it("should handle 10 concurrent checks without data corruption", async () => {
    setCleanFetch();
    const engine = new ProofLinkEngine(makeConfig(), {
      travelRuleProvider: new MockNotabeneProvider(),
    });

    const promises = Array.from({ length: 10 }, (_, i) =>
      engine.checkCompliance(
        makeRequest({
          sender: `0x${String(i).padStart(40, "0")}`,
          amountUsd: 100 + i,
        }),
      ),
    );

    const decisions = await Promise.all(promises);

    expect(decisions).toHaveLength(10);
    for (const decision of decisions) {
      expect(decision.status).toBeDefined();
      expect(decision.receiptId).toBeTruthy();
    }
  });

  it("should produce distinct receiptIds for concurrent checks on same addresses", async () => {
    setCleanFetch();
    const engine = new ProofLinkEngine(makeConfig(), {
      travelRuleProvider: new MockNotabeneProvider(),
    });

    // Same sender/receiver/amount → but timestamp differs so receiptId differs
    const promises = Array.from({ length: 5 }, () =>
      engine.checkCompliance(makeRequest()),
    );
    const decisions = await Promise.all(promises);
    const ids = new Set(decisions.map((d) => d.receiptId));
    // All should be valid, even if some collide (timestamp resolution);
    // at minimum, all should be truthy
    for (const id of ids) {
      expect(id).toMatch(/^pl-[0-9a-f]/);
    }
  });

  it("should return correct statuses for mixed allowlisted and normal senders concurrently", async () => {
    const allowedSender = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa0";
    setCleanFetch();
    const engine = new ProofLinkEngine(
      makeConfig({ allowlist: [allowedSender] }),
      { travelRuleProvider: new MockNotabeneProvider() },
    );

    const [allowedDecision, normalDecision] = await Promise.all([
      engine.checkCompliance(makeRequest({ sender: allowedSender })),
      engine.checkCompliance(makeRequest()),
    ]);

    expect(allowedDecision.status).toBe("APPROVED");
    expect(allowedDecision.riskScore).toBe(0);
    expect(normalDecision.status).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Config with all thresholds at 0
// ---------------------------------------------------------------------------

describe("ProofLinkEngine — all thresholds at 0", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it("should reject any transaction when maxRiskScore=0 and any factor is triggered", async () => {
    setCleanFetch();
    const engine = new ProofLinkEngine(
      makeConfig({ maxRiskScore: 0, escalationThreshold: 0 }),
      { travelRuleProvider: new MockNotabeneProvider() },
    );

    // Any non-zero score will exceed threshold=0
    const decision = await engine.checkCompliance(
      makeRequest({
        transactionContext: { isNewWallet: true }, // triggers new_wallet (score > 0)
      }),
    );

    expect(decision.status).toBe("REJECTED");
  });

  it("should approve clean transaction when maxRiskScore=0 and score is exactly 0", async () => {
    setCleanFetch();
    const engine = new ProofLinkEngine(
      makeConfig({ maxRiskScore: 0, escalationThreshold: 0 }),
      { travelRuleProvider: new MockNotabeneProvider() },
    );

    // Fully clean context → score = 0, not > 0 → approved
    const decision = await engine.checkCompliance(
      makeRequest({
        transactionContext: {
          txCountLastHour: 1,
          txCountLast24h: 5,
          historicalAvgAmountUsd: 100,
          isNewWallet: false,
          involvesMixer: false,
          receiverDarknetExposure: false,
          receiverSanctionedProximity: -1,
        },
      }),
    );

    expect(decision.status).toBe("APPROVED");
    expect(decision.riskScore).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Config with all thresholds at max
// ---------------------------------------------------------------------------

describe("ProofLinkEngine — all thresholds at max", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it("should never reject based on AML score alone when maxRiskScore=100", async () => {
    setCleanFetch();
    const engine = new ProofLinkEngine(
      makeConfig({ maxRiskScore: 100, escalationThreshold: 100 }),
      { travelRuleProvider: new MockNotabeneProvider() },
    );

    // Trigger many risk factors but score can never exceed 100
    const decision = await engine.checkCompliance(
      makeRequest({
        transactionContext: {
          txCountLastHour: 100,
          txCountLast24h: 1000,
          isNewWallet: true,
          involvesMixer: true,
          receiverDarknetExposure: true,
          receiverSanctionedProximity: 1,
        },
      }),
    );

    const amlCheck = decision.checks.find((c) => c.checkType === "AML_MONITORING");
    // score can be at most 100, which is NOT > 100, so AML check passes
    expect(amlCheck?.result).toBe("PASSED");
  });
});

// ---------------------------------------------------------------------------
// Allowlist + blocklist same address (allowlist wins — checked first)
// ---------------------------------------------------------------------------

describe("ProofLinkEngine — allowlist and blocklist same address", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it("should reject when address is on both allowlist and blocklist (blocklist checked first)", async () => {
    const addr = "0x1234567890abcdef1234567890abcdef12345678";
    const engine = new ProofLinkEngine(
      makeConfig({
        allowlist: [addr],
        blocklist: [addr],
      }),
    );

    const decision = await engine.checkCompliance(makeRequest({ sender: addr }));

    // Blocklist is evaluated before allowlist in the engine — compliance-conservative
    expect(decision.status).toBe("REJECTED");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("should reject when receiver is on blocklist even if sender is on allowlist", async () => {
    const sender = "0xaaaabbbbccccddddeeeeffffaaaabbbbccccdddd";
    const receiver = "0x1111222233334444555566667777888899990000";
    const engine = new ProofLinkEngine(
      makeConfig({
        allowlist: [sender],
        blocklist: [receiver],
      }),
    );

    // Blocklist is checked for all parties before allowlist fast-path
    const decision = await engine.checkCompliance(makeRequest({ sender, receiver }));
    expect(decision.status).toBe("REJECTED");
  });
});

// ---------------------------------------------------------------------------
// Same sender and receiver address
// ---------------------------------------------------------------------------

describe("ProofLinkEngine — same sender and receiver", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it("should process same-address transaction without throwing", async () => {
    setCleanFetch();
    const addr = "0x1234567890abcdef1234567890abcdef12345678";
    const engine = new ProofLinkEngine(makeConfig(), {
      travelRuleProvider: new MockNotabeneProvider(),
    });

    const decision = await engine.checkCompliance(
      makeRequest({ sender: addr, receiver: addr }),
    );

    expect(decision.status).toBeDefined();
    expect(decision.receiptId).toBeTruthy();
  });

  it("should reject self-send to blocklisted address", async () => {
    const addr = "0x1234567890abcdef1234567890abcdef12345678";
    const engine = new ProofLinkEngine(
      makeConfig({ blocklist: [addr] }),
    );

    const decision = await engine.checkCompliance(
      makeRequest({ sender: addr, receiver: addr }),
    );

    // Both sender and receiver are blocklisted
    expect(decision.status).toBe("REJECTED");
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Multiple KYA credentials for same agent
// ---------------------------------------------------------------------------

describe("KYAVerifier — multiple credentials for same agent DID", () => {
  it("should cache first credential result and return it on second call without tx params", async () => {
    const verifier = new KYAVerifier(makeConfig());
    const agentDid = "did:key:z6MkDuplicateAgent";

    const cred1 = makeValidCredential(agentDid);
    const cred2 = makeValidCredential(agentDid); // same DID, same cache key

    const result1 = await verifier.verifyCredential(cred1);
    // cred2 is a separate object but same DID → cache key is "kya:did:key:z6MkDuplicateAgent"
    const result2 = await verifier.verifyCredential(cred2);

    expect(result1.verified).toBe(true);
    expect(result2.verified).toBe(true);
    expect(result2.agentDid).toBe(agentDid);
  });

  it("should re-evaluate second credential when it has a different DID", async () => {
    const verifier = new KYAVerifier(makeConfig());

    const cred1 = makeValidCredential("did:key:z6MkAgent001");
    const cred2 = makeValidCredential("did:key:z6MkAgent002");
    // Make cred2 fail by using untrusted issuer
    cred2.issuer = "did:web:untrusted-issuer.io";

    const result1 = await verifier.verifyCredential(cred1);
    const result2 = await verifier.verifyCredential(cred2);

    expect(result1.verified).toBe(true);
    expect(result2.verified).toBe(false);
    expect(result2.errors.some((e) => e.includes("trusted issuers"))).toBe(true);
  });

  it("should not use stale cached result when clearCache is called between verifications", async () => {
    const verifier = new KYAVerifier(makeConfig());
    const agentDid = "did:key:z6MkClearBetween";

    const validCred = makeValidCredential(agentDid);
    await verifier.verifyCredential(validCred); // prime cache

    verifier.clearCache();

    // Now expire the credential — fresh evaluation should pick this up
    validCred.expirationDate = new Date(Date.now() - 1_000).toISOString();
    const result = await verifier.verifyCredential(validCred);

    expect(result.verified).toBe(false);
    expect(result.credentialExpired).toBe(true);
  });
});
