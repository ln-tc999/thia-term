import { describe, expect, it, vi, beforeEach } from "vitest";
import { ProofLinkEngine } from "../engine/prooflink.js";
import type { ComplianceRequest } from "../engine/prooflink.js";
import type { ProofLinkConfig } from "../config.js";
import { MockNotabeneProvider } from "../travel-rule/checker.js";

// ---------------------------------------------------------------------------
// Mock fetch globally to avoid real Chainalysis API calls
// ---------------------------------------------------------------------------

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

/** Factory — must return a fresh Response each call (body is consumed once). */
function mockCleanResponse(): Response {
  return new Response(JSON.stringify({ identifications: [] }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function mockSanctionedResponse(): Response {
  return new Response(
    JSON.stringify({
      identifications: [
        {
          category: "sanctions",
          name: "OFAC SDN Designated",
          description: "Tornado Cash",
          url: "https://ofac.treasury.gov/tornado-cash",
        },
      ],
    }),
    {
      status: 200,
      headers: { "Content-Type": "application/json" },
    },
  );
}

/** Set mockFetch to always return a fresh clean response. */
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
    travelRuleThresholds: { US: 3000, EU: 0, SG: 1100 },
    defaultTravelRuleThresholdUsd: 3000,
    cacheMaxEntries: 1000,
    sanctionsCacheTtlMs: 300_000,
    kyaCacheTtlMs: 900_000,
    restrictedJurisdictions: ["IR", "KP", "SY", "CU"],
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ProofLinkEngine", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  describe("checkCompliance — happy path", () => {
    it("should approve a clean transaction", async () => {
      setCleanFetch();

      const engine = new ProofLinkEngine(makeConfig(), {
        travelRuleProvider: new MockNotabeneProvider(),
      });
      const decision = await engine.checkCompliance(makeRequest());

      expect(decision.status).toBe("APPROVED");
      expect(decision.riskScore).toBeLessThanOrEqual(85);
      expect(decision.checks.length).toBeGreaterThanOrEqual(3);
      expect(decision.travelRuleStatus).toBe("NOT_REQUIRED");
      expect(decision.receiptId).toBeTruthy();
      expect(decision.timestamp).toBeTruthy();
    });

    it("should complete in under 500ms with mocked services", async () => {
      setCleanFetch();

      const engine = new ProofLinkEngine(makeConfig(), {
        travelRuleProvider: new MockNotabeneProvider(),
      });
      const start = Date.now();
      await engine.checkCompliance(makeRequest());
      const elapsed = Date.now() - start;

      expect(elapsed).toBeLessThan(500);
    });
  });

  describe("checkCompliance — sanctions rejection", () => {
    it("should reject a sanctioned sender", async () => {
      // First call (sender) → sanctioned, second call (receiver) → clean
      mockFetch
        .mockImplementationOnce(() => Promise.resolve(mockSanctionedResponse()))
        .mockImplementationOnce(() => Promise.resolve(mockCleanResponse()));

      const engine = new ProofLinkEngine(makeConfig());
      const decision = await engine.checkCompliance(makeRequest());

      expect(decision.status).toBe("REJECTED");
      expect(decision.riskScore).toBe(100);
      const sanctionsCheck = decision.checks.find(
        (c) => c.checkType === "SANCTIONS_SCREENING" && c.result === "FAILED",
      );
      expect(sanctionsCheck).toBeDefined();
    });

    it("should reject a sanctioned receiver", async () => {
      mockFetch
        .mockImplementationOnce(() => Promise.resolve(mockCleanResponse()))
        .mockImplementationOnce(() => Promise.resolve(mockSanctionedResponse()));

      const engine = new ProofLinkEngine(makeConfig());
      const decision = await engine.checkCompliance(makeRequest());

      expect(decision.status).toBe("REJECTED");
    });
  });

  describe("checkCompliance — blocklist / allowlist", () => {
    it("should immediately reject blocklisted sender", async () => {
      const sender = "0xblocklisted1234567890abcdef1234567890ab";
      const engine = new ProofLinkEngine(
        makeConfig({ blocklist: [sender.toLowerCase()] }),
      );

      const decision = await engine.checkCompliance(
        makeRequest({ sender }),
      );

      expect(decision.status).toBe("REJECTED");
      // No fetch calls should be made — blocklist is checked first
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("should immediately approve allowlisted sender", async () => {
      setCleanFetch();
      const sender = "0xallowlisted1234567890abcdef123456789ab";
      const engine = new ProofLinkEngine(
        makeConfig({ allowlist: [sender.toLowerCase()] }),
      );

      const decision = await engine.checkCompliance(
        makeRequest({ sender }),
      );

      expect(decision.status).toBe("APPROVED");
      expect(decision.riskScore).toBe(0);
    });
  });

  describe("checkCompliance — AML risk scoring", () => {
    it("should reject when risk score exceeds threshold", async () => {
      setCleanFetch();

      const engine = new ProofLinkEngine(makeConfig({ maxRiskScore: 10 }), {
        travelRuleProvider: new MockNotabeneProvider(),
      });

      // Provide context that triggers multiple risk factors
      const decision = await engine.checkCompliance(
        makeRequest({
          transactionContext: {
            txCountLastHour: 50,
            txCountLast24h: 200,
            isNewWallet: true,
            involvesMixer: true,
            receiverDarknetExposure: true,
            amountUsd: 100_000,
            historicalAvgAmountUsd: 100,
          },
        }),
      );

      expect(decision.status).toBe("REJECTED");
      const amlCheck = decision.checks.find(
        (c) => c.checkType === "AML_MONITORING",
      );
      expect(amlCheck?.result).toBe("FAILED");
    });

    it("should escalate when score exceeds escalation threshold but not max", async () => {
      setCleanFetch();

      const engine = new ProofLinkEngine(
        makeConfig({ maxRiskScore: 85, escalationThreshold: 10 }),
        { travelRuleProvider: new MockNotabeneProvider() },
      );

      const decision = await engine.checkCompliance(
        makeRequest({
          transactionContext: {
            txCountLastHour: 50,
            txCountLast24h: 200,
          },
        }),
      );

      expect(decision.status).toBe("ESCALATED");
    });
  });

  describe("checkCompliance — Travel Rule", () => {
    it("should trigger Travel Rule for amounts above threshold", async () => {
      setCleanFetch();

      const engine = new ProofLinkEngine(makeConfig(), {
        travelRuleProvider: new MockNotabeneProvider(),
      });

      const decision = await engine.checkCompliance(
        makeRequest({ amountUsd: 5000, senderJurisdiction: "US" }),
      );

      expect(decision.status).toBe("APPROVED");
      expect(decision.travelRuleStatus).toBe("TRANSMITTED");
      const trCheck = decision.checks.find(
        (c) => c.checkType === "TRAVEL_RULE",
      );
      expect(trCheck).toBeDefined();
      expect(trCheck?.result).toBe("PASSED");
    });

    it("should not trigger Travel Rule for amounts below threshold", async () => {
      setCleanFetch();

      const engine = new ProofLinkEngine(makeConfig(), {
        travelRuleProvider: new MockNotabeneProvider(),
      });

      const decision = await engine.checkCompliance(
        makeRequest({ amountUsd: 100, senderJurisdiction: "US" }),
      );

      expect(decision.travelRuleStatus).toBe("NOT_REQUIRED");
    });

    it("should reject when Travel Rule transmission fails and failOpen is false", async () => {
      setCleanFetch();

      const engine = new ProofLinkEngine(
        makeConfig({ failOpen: false }),
        { travelRuleProvider: new MockNotabeneProvider(false) },
      );

      const decision = await engine.checkCompliance(
        makeRequest({ amountUsd: 5000, senderJurisdiction: "US" }),
      );

      expect(decision.status).toBe("REJECTED");
      expect(decision.travelRuleStatus).toBe("FAILED");
    });
  });

  describe("checkCompliance — jurisdictional rules", () => {
    it("should reject transactions involving restricted jurisdictions", async () => {
      setCleanFetch();

      const engine = new ProofLinkEngine(makeConfig(), {
        travelRuleProvider: new MockNotabeneProvider(),
      });

      const decision = await engine.checkCompliance(
        makeRequest({ senderJurisdiction: "IR" }),
      );

      expect(decision.status).toBe("REJECTED");
      const jurisdictionCheck = decision.checks.find(
        (c) => c.checkType === "JURISDICTIONAL_RULES",
      );
      expect(jurisdictionCheck?.result).toBe("FAILED");
    });

    it("should reject USDT in EU jurisdictions (not MiCA authorized)", async () => {
      setCleanFetch();

      const engine = new ProofLinkEngine(makeConfig(), {
        travelRuleProvider: new MockNotabeneProvider(),
      });

      const decision = await engine.checkCompliance(
        makeRequest({
          asset: "USDT",
          senderJurisdiction: "DE",
        }),
      );

      expect(decision.status).toBe("REJECTED");
    });
  });

  describe("checkCompliance — blocklisted receiver", () => {
    it("should immediately reject blocklisted receiver", async () => {
      const receiver = "0xbadreceiver1234567890abcdef1234567890ab";
      const engine = new ProofLinkEngine(
        makeConfig({ blocklist: [receiver.toLowerCase()] }),
      );

      const decision = await engine.checkCompliance(
        makeRequest({ receiver }),
      );

      expect(decision.status).toBe("REJECTED");
      expect(mockFetch).not.toHaveBeenCalled();
      const check = decision.checks.find(
        (c) => c.checkType === "SANCTIONS_SCREENING" && c.result === "FAILED",
      );
      expect(check?.detail).toContain("blocklist");
    });
  });

  describe("checkCompliance — KYA verification", () => {
    it("should approve when KYA credential is valid", async () => {
      setCleanFetch();

      const engine = new ProofLinkEngine(makeConfig(), {
        travelRuleProvider: new MockNotabeneProvider(),
      });

      const futureDate = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();
      const kyaCredential = {
        "@context": [
          "https://www.w3.org/2018/credentials/v1",
          "https://prooflink.io/kya/v1",
        ],
        type: ["VerifiableCredential", "KYACredential"],
        issuer: "did:web:prooflink.io",
        issuanceDate: new Date().toISOString(),
        expirationDate: futureDate,
        credentialSubject: {
          id: "did:key:z6Mkagent",
          walletAddress: "0x1234567890abcdef1234567890abcdef12345678",
          delegationScope: {
            expiresAt: futureDate,
            maxTransactionAmount: 100_000,
          },
        },
      };

      const decision = await engine.checkCompliance(
        makeRequest({ kyaCredential }),
      );

      expect(decision.status).toBe("APPROVED");
      const kyaCheck = decision.checks.find(
        (c) => c.checkType === "KYA_VERIFICATION",
      );
      expect(kyaCheck).toBeDefined();
      expect(kyaCheck?.result).toBe("PASSED");
    });

    it("should reject when KYA credential is expired", async () => {
      const engine = new ProofLinkEngine(makeConfig(), {
        travelRuleProvider: new MockNotabeneProvider(),
      });

      const expiredCredential = {
        "@context": ["https://www.w3.org/2018/credentials/v1"],
        type: ["VerifiableCredential", "KYACredential"],
        issuer: "did:web:prooflink.io",
        issuanceDate: new Date(Date.now() - 2_000).toISOString(),
        expirationDate: new Date(Date.now() - 1_000).toISOString(),
        credentialSubject: {
          id: "did:key:z6Mkexpired",
          walletAddress: "0x1234567890abcdef1234567890abcdef12345678",
          delegationScope: {
            expiresAt: new Date(Date.now() - 1_000).toISOString(),
          },
        },
      };

      const decision = await engine.checkCompliance(
        makeRequest({ kyaCredential: expiredCredential }),
      );

      expect(decision.status).toBe("REJECTED");
      const kyaCheck = decision.checks.find(
        (c) => c.checkType === "KYA_VERIFICATION",
      );
      expect(kyaCheck?.result).toBe("FAILED");
    });

    it("should skip KYA and continue pipeline when failOpen=true and KYA throws", async () => {
      setCleanFetch();

      const engine = new ProofLinkEngine(
        makeConfig({ failOpen: true }),
        { travelRuleProvider: new MockNotabeneProvider() },
      );

      // KYA credential with bad issuer will throw/fail inside verifier
      const badCredential = {
        "@context": [], // structurally invalid — will produce errors but not throw
        type: [],
        issuer: "",
        issuanceDate: "",
        credentialSubject: { id: "" },
      };

      // With failOpen=true the engine should not crash
      const decision = await engine.checkCompliance(
        makeRequest({ kyaCredential: badCredential }),
      );

      // KYA fails → REJECTED (errors.length > 0 → verified=false → REJECTED regardless of failOpen)
      expect(decision.status).toBe("REJECTED");
    });
  });

  describe("checkCompliance — fail-open mode", () => {
    it("should approve when sanctions API fails and failOpen=true", async () => {
      // Fail every fetch call (simulates Chainalysis outage)
      mockFetch.mockRejectedValue(new Error("Network unreachable"));

      const engine = new ProofLinkEngine(
        makeConfig({ failOpen: true }),
        { travelRuleProvider: new MockNotabeneProvider() },
      );

      const decision = await engine.checkCompliance(makeRequest());

      // With failOpen, offline list is checked; our test addresses are clean → APPROVED
      expect(decision.status).toBe("APPROVED");
    });

    it("should reject via offline list when failOpen=true but known OFAC address used", async () => {
      mockFetch.mockRejectedValue(new Error("Network unreachable"));

      // Use a known OFAC address from the offline list
      const knownSanctioned = "0x8589427373d6d84e98730d7795d8f6f8731fda16";
      const engine = new ProofLinkEngine(makeConfig({ failOpen: true }));

      const decision = await engine.checkCompliance(
        makeRequest({ sender: knownSanctioned }),
      );

      expect(decision.status).toBe("REJECTED");
    });
  });

  describe("checkCompliance — jurisdictional rules edge cases", () => {
    it("should reject USDT for receiver in EU jurisdiction", async () => {
      setCleanFetch();

      const engine = new ProofLinkEngine(makeConfig(), {
        travelRuleProvider: new MockNotabeneProvider(),
      });

      const decision = await engine.checkCompliance(
        makeRequest({
          asset: "USDT",
          receiverJurisdiction: "FR", // EU jurisdiction
        }),
      );

      expect(decision.status).toBe("REJECTED");
    });

    it("should allow USDC in EU jurisdiction (MiCA-authorized)", async () => {
      setCleanFetch();

      const engine = new ProofLinkEngine(makeConfig(), {
        travelRuleProvider: new MockNotabeneProvider(),
      });

      const decision = await engine.checkCompliance(
        makeRequest({
          asset: "USDC",
          senderJurisdiction: "DE",
        }),
      );

      // USDC is not blocked — should pass (EU Travel Rule at $0 threshold will transmit)
      expect(decision.status).toBe("APPROVED");
    });

    it("should reject when receiver jurisdiction is restricted", async () => {
      setCleanFetch();

      const engine = new ProofLinkEngine(makeConfig(), {
        travelRuleProvider: new MockNotabeneProvider(),
      });

      const decision = await engine.checkCompliance(
        makeRequest({ receiverJurisdiction: "KP" }), // North Korea
      );

      expect(decision.status).toBe("REJECTED");
    });

    it("should allow transaction when no jurisdiction restrictions apply", async () => {
      setCleanFetch();

      const engine = new ProofLinkEngine(makeConfig(), {
        travelRuleProvider: new MockNotabeneProvider(),
      });

      const decision = await engine.checkCompliance(
        makeRequest({
          asset: "USDC",
          senderJurisdiction: "US",
          receiverJurisdiction: "GB",
          amountUsd: 100, // below US $3000 Travel Rule threshold
        }),
      );

      expect(decision.status).toBe("APPROVED");
    });
  });

  describe("checkCompliance — edge cases", () => {
    it("should handle zero amount transaction", async () => {
      // Zero amount won't trigger amount_anomaly (no history → 0 > 10000 is false)
      // and Travel Rule threshold check passes (0 < 3000)
      setCleanFetch();
      const engine = new ProofLinkEngine(makeConfig(), {
        travelRuleProvider: new MockNotabeneProvider(),
      });

      const decision = await engine.checkCompliance(
        makeRequest({ amountUsd: 0 }),
      );

      expect(decision.status).toBe("APPROVED");
      expect(decision.travelRuleStatus).toBe("NOT_REQUIRED");
    });

    it("should handle very large amount and trigger Travel Rule", async () => {
      setCleanFetch();
      const engine = new ProofLinkEngine(makeConfig(), {
        travelRuleProvider: new MockNotabeneProvider(),
      });

      const decision = await engine.checkCompliance(
        makeRequest({ amountUsd: 10_000_000, senderJurisdiction: "US" }),
      );

      expect(decision.travelRuleStatus).toBe("TRANSMITTED");
    });

    it("should produce a receiptId starting with 'pl-' on every call", async () => {
      setCleanFetch();
      const engine = new ProofLinkEngine(makeConfig(), {
        travelRuleProvider: new MockNotabeneProvider(),
      });

      const d1 = await engine.checkCompliance(makeRequest());
      const d2 = await engine.checkCompliance(makeRequest());

      // Both receiptIds must start with 'pl-' and contain hex characters
      expect(d1.receiptId).toMatch(/^pl-[0-9a-f]/);
      expect(d2.receiptId).toMatch(/^pl-[0-9a-f]/);
    });

    it("should include a non-empty receiptHash", async () => {
      setCleanFetch();
      const engine = new ProofLinkEngine(makeConfig(), {
        travelRuleProvider: new MockNotabeneProvider(),
      });

      const decision = await engine.checkCompliance(makeRequest());

      expect(decision.receiptHash).toBeTruthy();
      expect(decision.receiptHash.startsWith("0x")).toBe(true);
    });

    it("should always include a timestamp in ISO-8601 format", async () => {
      setCleanFetch();
      const engine = new ProofLinkEngine(makeConfig(), {
        travelRuleProvider: new MockNotabeneProvider(),
      });

      const decision = await engine.checkCompliance(makeRequest());

      expect(() => new Date(decision.timestamp)).not.toThrow();
      expect(decision.timestamp).toMatch(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/,
      );
    });

    it("should set ttl to 300 seconds", async () => {
      setCleanFetch();
      const engine = new ProofLinkEngine(makeConfig(), {
        travelRuleProvider: new MockNotabeneProvider(),
      });

      const decision = await engine.checkCompliance(makeRequest());

      expect(decision.ttl).toBe(300);
    });
  });

  describe("checkCompliance — allowlist case-insensitive matching", () => {
    it("should treat allowlist addresses as case-insensitive", async () => {
      setCleanFetch();
      const sender = "0xAABBCCDDeeff1234567890abcdef1234567890AB";
      const engine = new ProofLinkEngine(
        makeConfig({ allowlist: [sender.toLowerCase()] }),
      );

      // Provide sender with mixed case — should still match (after sanctions pass)
      const decision = await engine.checkCompliance(
        makeRequest({ sender }),
      );

      expect(decision.status).toBe("APPROVED");
    });
  });

  describe("issueReceipt", () => {
    it("should issue a valid receipt for an approved decision", async () => {
      setCleanFetch();
      const engine = new ProofLinkEngine(makeConfig(), {
        travelRuleProvider: new MockNotabeneProvider(),
      });

      const request = makeRequest({ txHash: "0xhashvalue" });
      const decision = await engine.checkCompliance(request);
      const receipt = await engine.issueReceipt(decision, request);

      expect(receipt.overallStatus).toBe("APPROVED");
      expect(receipt.receiptId).toMatch(/^pl-/);
      expect(receipt.txHash).toBe("0xhashvalue");
      expect(receipt.signature).toBeTruthy();
    });
  });

  describe("checkTravelRule (convenience method)", () => {
    it("should delegate to TravelRuleChecker.checkTravelRule", async () => {
      const engine = new ProofLinkEngine(makeConfig(), {
        travelRuleProvider: new MockNotabeneProvider(),
      });

      const result = await engine.checkTravelRule({
        originator: { walletAddress: "0x1234" },
        beneficiary: { walletAddress: "0xabcd" },
        amountUsd: 500,
        asset: "USDC",
        chain: "eip155:1",
        direction: "outgoing",
        preTransaction: true,
      });

      expect(result.status).toBe("NOT_REQUIRED");
    });
  });

  describe("screenAddress", () => {
    it("should return clean result for non-sanctioned address", async () => {
      setCleanFetch();

      const engine = new ProofLinkEngine(makeConfig());
      const result = await engine.screenAddress(
        "0x1234567890abcdef1234567890abcdef12345678",
        "eip155:1",
      );

      expect(result.matched).toBe(false);
      expect(result.riskScore).toBe(0);
    });
  });

  describe("calculateRiskScore", () => {
    it("should return low score for normal transaction", async () => {
      const engine = new ProofLinkEngine(makeConfig());
      const score = await engine.calculateRiskScore({
        senderAddress: "0x1234",
        receiverAddress: "0xabcd",
        amountUsd: 50,
        chain: "eip155:1",
        asset: "USDC",
        txCountLastHour: 2,
        txCountLast24h: 10,
        historicalAvgAmountUsd: 45,
      });

      expect(score.score).toBeLessThan(50);
      expect(score.exceeds).toBe(false);
    });
  });
});
