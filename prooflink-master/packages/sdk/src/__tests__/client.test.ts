import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProofLinkClient } from "../client.js";
import { ProofLinkAPIError, ProofLinkNetworkError, ProofLinkValidationError } from "../errors.js";
import type {
  ComplianceCheckParams,
  CreateInvoiceParams,
  IssueKYAParams,
} from "../types.js";

// ---------------------------------------------------------------------------
// Mock fetch
// ---------------------------------------------------------------------------

const mockFetch = vi.fn<typeof globalThis.fetch>();

beforeEach(() => {
  vi.stubGlobal("fetch", mockFetch);
});

afterEach(() => {
  vi.restoreAllMocks();
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function errorResponse(status: number, code: string, message: string): Response {
  return new Response(JSON.stringify({ code, message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const client = new ProofLinkClient({
  apiKey: "fl_test_abc123",
  baseUrl: "https://api.test.prooflink.io/v1",
  maxRetries: 0, // no retries in tests for speed
});

const COMPLIANCE_DECISION = {
  status: "APPROVED",
  riskScore: 12,
  receiptId: "rcpt_001",
  receiptHash: "0xabc",
  checks: [
    {
      checkType: "SANCTIONS_SCREENING",
      result: "PASSED",
      performedAt: "2026-01-01T00:00:00Z",
      provider: "chainalysis_free",
    },
  ],
  travelRuleStatus: "NOT_REQUIRED",
  timestamp: "2026-01-01T00:00:00Z",
  ttl: 300,
};

const SANCTIONS_RESULT = {
  matched: false,
  listsChecked: ["OFAC_SDN"],
  matchDetails: [],
  riskScore: 0,
  screenedAt: "2026-01-01T00:00:00Z",
  provider: "chainalysis_free",
};

const AML_RISK_SCORE = {
  score: 15,
  factors: [
    { factor: "new_wallet", weight: 0.3, detail: "Wallet age < 30 days" },
  ],
  threshold: 50,
  exceeds: false,
  evaluatedAt: "2026-01-01T00:00:00Z",
};

const TRAVEL_RULE_RESULT = {
  status: "TRANSMITTED",
  originator: "0xAlice",
  beneficiary: "0xBob",
  amountUsd: 5000,
  transmittedAt: "2026-01-01T00:00:00Z",
  provider: "notabene",
};

const COMPLIANCE_RECEIPT = {
  receiptId: "rcpt_001",
  checksPerformed: [],
  overallStatus: "APPROVED",
  riskScore: 5,
  travelRuleStatus: "NOT_REQUIRED",
  signature: "0xsig",
  timestamp: "2026-01-01T00:00:00Z",
  ttl: 300,
  proofLinkVersion: "1.0.0",
};

const INVOICE = {
  "@context": ["https://schema.org", "https://prooflink.io/invoices/v1"],
  "@type": "Invoice",
  invoiceId: "inv_001",
  state: "DRAFT",
  seller: { walletAddress: "0xSeller" },
  buyer: { walletAddress: "0xBuyer" },
  lineItems: [
    {
      description: "Compute",
      quantity: 1,
      unit: "hour",
      unitPrice: 10,
      total: 10,
    },
  ],
  currency: "USDC",
  totalAmount: 10,
  anchoredOnChain: false,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

const AGENT_IDENTITY = {
  agentId: "agent_001",
  did: "did:prooflink:agent_001",
  type: "autonomous",
  principalEntity: {
    name: "Acme Corp",
    kycVerified: true,
    sanctionsCleared: true,
  },
  walletAddress: "0xAgent",
  reputationScore: 85,
  delegationScope: {
    maxTransactionValue: 10000,
    expiresAt: "2027-01-01T00:00:00Z",
  },
  registeredAt: "2025-06-01T00:00:00Z",
  x402Support: true,
};

const KYA_VERIFICATION = {
  verified: true,
  trustScore: 90,
  agentMetadata: {
    type: "autonomous",
    registeredAt: "2025-06-01T00:00:00Z",
  },
  receiptId: "rcpt_kya_001",
};

const KYA_CREDENTIAL = {
  "@context": [
    "https://www.w3.org/2018/credentials/v1",
    "https://prooflink.io/credentials/kya/v1",
  ],
  type: ["VerifiableCredential", "KYACredential"],
  id: "urn:prooflink:kya:cred_001",
  issuer: { id: "did:prooflink:issuer", name: "ProofLink" },
  issuanceDate: "2026-01-01T00:00:00Z",
  expirationDate: "2027-01-01T00:00:00Z",
  credentialSubject: {
    id: "did:prooflink:agent_001",
    agentDid: "agent_001",
    agentType: "autonomous",
    controllingEntityName: "Acme Corp",
    delegationScope: {
      maxTransactionValue: 10000,
      expiresAt: "2027-01-01T00:00:00Z",
    },
    walletAddress: "0xAgent",
  },
  proof: {
    type: "EcdsaSecp256k1Signature2019",
    created: "2026-01-01T00:00:00Z",
    verificationMethod: "did:prooflink:issuer#key-1",
    proofPurpose: "assertionMethod",
    jws: "eyJ...",
  },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function lastFetchUrl(): string {
  const [url] = mockFetch.mock.calls[0] as [string, RequestInit];
  return url;
}

function lastFetchInit(): RequestInit {
  const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
  return init;
}

// ---------------------------------------------------------------------------
// Tests: Constructor validation
// ---------------------------------------------------------------------------

describe("ProofLinkClient", () => {
  describe("constructor", () => {
    it("throws ProofLinkValidationError when apiKey is empty", () => {
      expect(() => new ProofLinkClient({ apiKey: "" })).toThrow(
        ProofLinkValidationError,
      );
    });
  });

  // -------------------------------------------------------------------------
  // Auth header
  // -------------------------------------------------------------------------

  describe("authentication", () => {
    it("sends Bearer token in Authorization header", async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse(SANCTIONS_RESULT));

      await client.screenAddress("0xTest", "ethereum");

      const headers = lastFetchInit().headers as Record<string, string>;
      expect(headers["Authorization"]).toBe("Bearer fl_test_abc123");
    });
  });

  // -------------------------------------------------------------------------
  // Compliance
  // -------------------------------------------------------------------------

  describe("checkCompliance", () => {
    it("POSTs to /compliance/check and returns a ComplianceDecision", async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse(COMPLIANCE_DECISION));

      const params: ComplianceCheckParams = {
        sender: { address: "0xAlice", chain: "base" },
        receiver: { address: "0xBob", chain: "base" },
        amount: "5000",
        asset: "USDC",
      };
      const result = await client.checkCompliance(params);

      expect(lastFetchUrl()).toBe(
        "https://api.test.prooflink.io/v1/compliance/check",
      );
      expect(lastFetchInit().method).toBe("POST");
      expect(JSON.parse(lastFetchInit().body as string)).toEqual(params);
      expect(result.status).toBe("APPROVED");
      expect(result.receiptId).toBe("rcpt_001");
    });
  });

  describe("screenAddress", () => {
    it("POSTs to /compliance/screen with address and chain", async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse(SANCTIONS_RESULT));

      const result = await client.screenAddress("0xTest", "ethereum");

      expect(lastFetchUrl()).toBe(
        "https://api.test.prooflink.io/v1/compliance/screen",
      );
      expect(lastFetchInit().method).toBe("POST");
      expect(JSON.parse(lastFetchInit().body as string)).toEqual({
        address: "0xTest",
        chain: "ethereum",
      });
      expect(result.matched).toBe(false);
    });

    it("throws ProofLinkValidationError when address is empty", async () => {
      await expect(client.screenAddress("", "ethereum")).rejects.toThrow(
        ProofLinkValidationError,
      );
    });

    it("throws ProofLinkValidationError when chain is empty", async () => {
      await expect(client.screenAddress("0xTest", "")).rejects.toThrow(
        ProofLinkValidationError,
      );
    });
  });

  describe("calculateRiskScore", () => {
    it("POSTs to /compliance/risk-score and returns AMLRiskScore", async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse(AML_RISK_SCORE));

      const result = await client.calculateRiskScore({
        senderAddress: "0xAlice",
        receiverAddress: "0xBob",
        amount: "5000",
        asset: "USDC",
        chain: "base",
      });

      expect(lastFetchUrl()).toBe(
        "https://api.test.prooflink.io/v1/compliance/risk-score",
      );
      expect(lastFetchInit().method).toBe("POST");
      expect(result.score).toBe(15);
      expect(result.exceeds).toBe(false);
    });
  });

  describe("checkTravelRule", () => {
    it("POSTs to /compliance/travel-rule and returns TravelRuleResult", async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse(TRAVEL_RULE_RESULT));

      const result = await client.checkTravelRule({
        originator: { walletAddress: "0xAlice" },
        beneficiary: { walletAddress: "0xBob" },
        amountUsd: 5000,
        asset: "USDC",
        chain: "base",
        direction: "outgoing",
        preTransaction: false,
      });

      expect(lastFetchUrl()).toBe(
        "https://api.test.prooflink.io/v1/compliance/travel-rule",
      );
      expect(result.status).toBe("TRANSMITTED");
    });
  });

  describe("getComplianceReceipt", () => {
    it("GETs /compliance/receipt/:id", async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse(COMPLIANCE_RECEIPT));

      const result = await client.getComplianceReceipt("rcpt_001");

      expect(lastFetchUrl()).toBe(
        "https://api.test.prooflink.io/v1/compliance/receipt/rcpt_001",
      );
      expect(result.overallStatus).toBe("APPROVED");
    });

    it("throws ProofLinkValidationError when receiptId is empty", async () => {
      await expect(client.getComplianceReceipt("")).rejects.toThrow(
        ProofLinkValidationError,
      );
    });
  });

  describe("getComplianceHistory", () => {
    it("GETs /compliance/history with pagination", async () => {
      const paginated = {
        items: [],
        pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
      };
      mockFetch.mockResolvedValueOnce(jsonResponse(paginated));

      const result = await client.getComplianceHistory({
        page: 1,
        limit: 20,
        status: "APPROVED",
      });

      expect(lastFetchUrl()).toContain("page=1");
      expect(lastFetchUrl()).toContain("limit=20");
      expect(lastFetchUrl()).toContain("status=APPROVED");
      expect(result.pagination.total).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // Invoices
  // -------------------------------------------------------------------------

  describe("createInvoice", () => {
    it("POSTs to /invoices and returns an AgentInvoice", async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse(INVOICE));

      const params: CreateInvoiceParams = {
        seller: { walletAddress: "0xSeller" },
        buyer: { walletAddress: "0xBuyer" },
        lineItems: [
          {
            description: "Compute",
            quantity: 1,
            unit: "hour",
            unitPrice: 10,
            total: 10,
          },
        ],
        currency: "USDC",
        totalAmount: 10,
      };
      const result = await client.createInvoice(params);

      expect(lastFetchInit().method).toBe("POST");
      expect(lastFetchUrl()).toBe("https://api.test.prooflink.io/v1/invoices");
      expect(result.invoiceId).toBe("inv_001");
    });
  });

  describe("getInvoice", () => {
    it("GETs /invoices/:id", async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse(INVOICE));

      const result = await client.getInvoice("inv_001");

      expect(lastFetchUrl()).toBe(
        "https://api.test.prooflink.io/v1/invoices/inv_001",
      );
      expect(result.state).toBe("DRAFT");
    });

    it("throws ProofLinkValidationError when id is empty", async () => {
      await expect(client.getInvoice("")).rejects.toThrow(
        ProofLinkValidationError,
      );
    });
  });

  describe("updateInvoiceState", () => {
    it("PATCHes /invoices/:id/state", async () => {
      const updated = { ...INVOICE, state: "ISSUED" };
      mockFetch.mockResolvedValueOnce(jsonResponse(updated));

      const result = await client.updateInvoiceState("inv_001", "ISSUED");

      expect(lastFetchInit().method).toBe("PATCH");
      expect(lastFetchUrl()).toBe(
        "https://api.test.prooflink.io/v1/invoices/inv_001/state",
      );
      expect(JSON.parse(lastFetchInit().body as string)).toMatchObject({
        state: "ISSUED",
      });
      expect(result.state).toBe("ISSUED");
    });
  });

  describe("listInvoices", () => {
    it("GETs /invoices with filters", async () => {
      const paginated = {
        items: [INVOICE],
        pagination: { page: 1, limit: 10, total: 1, totalPages: 1 },
      };
      mockFetch.mockResolvedValueOnce(jsonResponse(paginated));

      const result = await client.listInvoices({
        state: "DRAFT",
        seller: "0xSeller",
        page: 1,
        limit: 10,
      });

      expect(lastFetchUrl()).toContain("state=DRAFT");
      expect(lastFetchUrl()).toContain("seller=0xSeller");
      expect(result.items).toHaveLength(1);
    });
  });

  // -------------------------------------------------------------------------
  // Identity / KYA
  // -------------------------------------------------------------------------

  describe("verifyAgent", () => {
    it("POSTs to /identity/verify with agentId", async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse(KYA_VERIFICATION));

      const result = await client.verifyAgent("agent_001");

      expect(lastFetchUrl()).toBe(
        "https://api.test.prooflink.io/v1/identity/verify",
      );
      expect(lastFetchInit().method).toBe("POST");
      expect(JSON.parse(lastFetchInit().body as string)).toEqual({
        agentId: "agent_001",
      });
      expect(result.verified).toBe(true);
      expect(result.trustScore).toBe(90);
    });

    it("throws ProofLinkValidationError when agentId is empty", async () => {
      await expect(client.verifyAgent("")).rejects.toThrow(
        ProofLinkValidationError,
      );
    });
  });

  describe("registerAgent", () => {
    it("POSTs to /identity/kya/issue and returns AgentIdentity", async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse(AGENT_IDENTITY));

      const result = await client.registerAgent({
        agentDid: "did:prooflink:agent_001",
        agentType: "autonomous",
        controllingEntity: { name: "Acme Corp", kybVerified: true },
        walletAddress: "0xAgent",
        delegationScope: {
          maxTransactionValue: 10000,
          expiresAt: "2027-01-01T00:00:00Z",
        },
      });

      expect(lastFetchInit().method).toBe("POST");
      expect(lastFetchUrl()).toBe(
        "https://api.test.prooflink.io/v1/identity/kya/issue",
      );
      expect(result.walletAddress).toBe("0xAgent");
    });
  });

  describe("getAgentIdentity", () => {
    it("GETs /identity/:agentId", async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse(AGENT_IDENTITY));

      const result = await client.getAgentIdentity("agent_001");

      expect(lastFetchUrl()).toBe(
        "https://api.test.prooflink.io/v1/identity/agent_001",
      );
      expect(result.walletAddress).toBe("0xAgent");
      expect(result.reputationScore).toBe(85);
    });
  });

  describe("listAgents", () => {
    it("GETs /identity/agents with pagination", async () => {
      const paginated = {
        items: [AGENT_IDENTITY],
        pagination: { page: 1, limit: 10, total: 1, totalPages: 1 },
      };
      mockFetch.mockResolvedValueOnce(jsonResponse(paginated));

      const result = await client.listAgents({ page: 1, limit: 10 });

      expect(lastFetchUrl()).toContain("/identity/agents");
      expect(lastFetchUrl()).toContain("page=1");
      expect(lastFetchUrl()).toContain("limit=10");
      expect(lastFetchInit().method).toBe("GET");
      expect(result.items).toHaveLength(1);
    });
  });

  describe("issueKYA", () => {
    it("POSTs to /identity/kya/issue and returns a KYACredential", async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse(KYA_CREDENTIAL));

      const params: IssueKYAParams = {
        agentId: "agent_001",
        agentType: "autonomous",
        controllingEntity: { name: "Acme Corp", kybVerified: true },
        delegationScope: {
          maxTransactionValue: 10000,
          expiresAt: "2027-01-01T00:00:00Z",
        },
        walletAddress: "0xAgent",
      };
      const result = await client.issueKYA(params);

      expect(lastFetchInit().method).toBe("POST");
      expect(lastFetchUrl()).toBe(
        "https://api.test.prooflink.io/v1/identity/kya/issue",
      );
      expect(result.credentialSubject.agentDid).toBe("agent_001");
    });
  });

  // -------------------------------------------------------------------------
  // Error handling
  // -------------------------------------------------------------------------

  describe("error handling", () => {
    it("throws ProofLinkAPIError on 4xx responses", async () => {
      mockFetch.mockResolvedValueOnce(
        errorResponse(401, "UNAUTHORIZED", "Invalid API key"),
      );

      await expect(client.screenAddress("0xTest", "ethereum")).rejects.toThrow(
        ProofLinkAPIError,
      );

      try {
        mockFetch.mockResolvedValueOnce(
          errorResponse(401, "UNAUTHORIZED", "Invalid API key"),
        );
        await client.screenAddress("0xTest", "ethereum");
      } catch (err) {
        expect(err).toBeInstanceOf(ProofLinkAPIError);
        const apiErr = err as ProofLinkAPIError;
        expect(apiErr.status).toBe(401);
        expect(apiErr.body?.code).toBe("UNAUTHORIZED");
      }
    });

    it("throws ProofLinkAPIError on 404", async () => {
      mockFetch.mockResolvedValueOnce(
        errorResponse(404, "NOT_FOUND", "Receipt not found"),
      );

      await expect(client.getComplianceReceipt("nonexistent")).rejects.toThrow(
        ProofLinkAPIError,
      );
    });

    it("throws ProofLinkNetworkError on fetch failure", async () => {
      mockFetch.mockRejectedValueOnce(new TypeError("Failed to fetch"));

      await expect(client.screenAddress("0xTest", "ethereum")).rejects.toThrow(
        ProofLinkNetworkError,
      );
    });
  });

  // -------------------------------------------------------------------------
  // Retry logic
  // -------------------------------------------------------------------------

  describe("retry logic", () => {
    it("retries on 500 and succeeds on second attempt", async () => {
      const retryClient = new ProofLinkClient({
        apiKey: "fl_test_abc123",
        baseUrl: "https://api.test.prooflink.io/v1",
        maxRetries: 1,
        timeout: 5000,
      });

      mockFetch
        .mockResolvedValueOnce(
          errorResponse(500, "INTERNAL", "Server error"),
        )
        .mockResolvedValueOnce(jsonResponse(SANCTIONS_RESULT));

      const result = await retryClient.screenAddress("0xTest", "ethereum");

      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(result.matched).toBe(false);
    });

    it("respects Retry-After header on 429", async () => {
      const retryClient = new ProofLinkClient({
        apiKey: "fl_test_abc123",
        baseUrl: "https://api.test.prooflink.io/v1",
        maxRetries: 1,
        timeout: 5000,
      });

      const rateLimitResponse = new Response(
        JSON.stringify({ code: "RATE_LIMITED", message: "Too many requests" }),
        { status: 429, headers: { "Content-Type": "application/json", "Retry-After": "0" } },
      );

      mockFetch
        .mockResolvedValueOnce(rateLimitResponse)
        .mockResolvedValueOnce(jsonResponse(SANCTIONS_RESULT));

      const result = await retryClient.screenAddress("0xTest", "ethereum");

      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(result.matched).toBe(false);
    });

    it("exhausts retries and throws on persistent 503", async () => {
      const retryClient = new ProofLinkClient({
        apiKey: "fl_test_abc123",
        baseUrl: "https://api.test.prooflink.io/v1",
        maxRetries: 2,
        timeout: 5000,
      });

      mockFetch
        .mockResolvedValueOnce(errorResponse(503, "UNAVAILABLE", "Down"))
        .mockResolvedValueOnce(errorResponse(503, "UNAVAILABLE", "Down"))
        .mockResolvedValueOnce(errorResponse(503, "UNAVAILABLE", "Down"));

      await expect(retryClient.screenAddress("0xTest", "ethereum")).rejects.toThrow(
        ProofLinkAPIError,
      );
      expect(mockFetch).toHaveBeenCalledTimes(3);
    });
  });
});
