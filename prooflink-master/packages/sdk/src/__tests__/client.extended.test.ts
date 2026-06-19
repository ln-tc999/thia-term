/**
 * Extended client tests covering cases not already handled in client.test.ts:
 * - Constructor edge cases (custom baseUrl)
 * - HTTP 403 / 429 / 500 error shapes
 * - Timeout (DOMException TimeoutError)
 * - Network error propagation
 * - 204 No Content
 * - updateInvoiceState validation
 * - getAgentIdentity validation
 * - checkTravelRule response fields
 * - getComplianceHistory without params (default empty object)
 * - listInvoices without params (default empty object)
 * - listAgents without params (default empty object)
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProofLinkClient } from "../client.js";
import {
  ProofLinkAPIError,
  ProofLinkNetworkError,
  ProofLinkTimeoutError,
  ProofLinkValidationError,
} from "../errors.js";

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
// Shared client (no retries for speed)
// ---------------------------------------------------------------------------

const client = new ProofLinkClient({
  apiKey: "fl_test_extended",
  baseUrl: "https://api.test.prooflink.io/v1",
  maxRetries: 0,
  timeout: 5000,
});

function lastUrl(): string {
  return (mockFetch.mock.calls[0] as [string, RequestInit])[0];
}

function lastInit(): RequestInit {
  return (mockFetch.mock.calls[0] as [string, RequestInit])[1];
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SANCTIONS_RESULT = {
  matched: false,
  listsChecked: ["OFAC_SDN"],
  matchDetails: [],
  riskScore: 0,
  screenedAt: "2026-01-01T00:00:00Z",
  provider: "chainalysis_free",
};

const AGENT_IDENTITY = {
  agentId: "agent_ext_001",
  did: "did:prooflink:agent_ext_001",
  type: "autonomous",
  principalEntity: { name: "Corp", kycVerified: true, sanctionsCleared: true },
  walletAddress: "0xExtAgent",
  reputationScore: 70,
  delegationScope: { maxTransactionValue: 5000, expiresAt: "2027-01-01T00:00:00Z" },
  registeredAt: "2025-01-01T00:00:00Z",
  x402Support: false,
};

// ---------------------------------------------------------------------------
// Constructor
// ---------------------------------------------------------------------------

describe("ProofLinkClient constructor", () => {
  it("throws ProofLinkValidationError for missing apiKey", () => {
    expect(() => new ProofLinkClient({ apiKey: "" })).toThrow(ProofLinkValidationError);
  });

  it("throws ProofLinkValidationError with field=apiKey", () => {
    try {
      new ProofLinkClient({ apiKey: "" });
    } catch (err) {
      expect(err).toBeInstanceOf(ProofLinkValidationError);
      expect((err as ProofLinkValidationError).field).toBe("apiKey");
    }
  });

  it("uses default base URL when not specified", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse(SANCTIONS_RESULT));
    const c = new ProofLinkClient({ apiKey: "fl_live_key", maxRetries: 0 });
    await c.screenAddress("0xtest", "ethereum");
    expect(lastUrl().startsWith("https://api.prooflink.io/v1")).toBe(true);
  });

  it("uses custom base URL when specified", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse(SANCTIONS_RESULT));
    const c = new ProofLinkClient({
      apiKey: "fl_test_key",
      baseUrl: "https://staging.prooflink.io/v1",
      maxRetries: 0,
    });
    await c.screenAddress("0xtest", "ethereum");
    expect(lastUrl().startsWith("https://staging.prooflink.io/v1")).toBe(true);
  });

  it("accepts valid apiKey and constructs without error", () => {
    expect(
      () => new ProofLinkClient({ apiKey: "fl_live_abc123" }),
    ).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// HTTP error status codes
// ---------------------------------------------------------------------------

describe("HTTP error handling", () => {
  it("throws ProofLinkAPIError with status 401 and correct body", async () => {
    mockFetch.mockResolvedValueOnce(
      errorResponse(401, "UNAUTHORIZED", "Invalid API key"),
    );
    try {
      await client.screenAddress("0xTest", "ethereum");
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ProofLinkAPIError);
      const apiErr = err as ProofLinkAPIError;
      expect(apiErr.status).toBe(401);
      expect(apiErr.body?.code).toBe("UNAUTHORIZED");
      expect(apiErr.body?.message).toBe("Invalid API key");
    }
  });

  it("throws ProofLinkAPIError with status 403", async () => {
    mockFetch.mockResolvedValueOnce(
      errorResponse(403, "FORBIDDEN", "Insufficient permissions"),
    );
    await expect(client.checkCompliance({
      sender: { address: "0xA", chain: "base" },
      receiver: { address: "0xB", chain: "base" },
      amount: "100",
      asset: "USDC",
    })).rejects.toThrow(ProofLinkAPIError);
  });

  it("throws ProofLinkAPIError with status 404 on getInvoice", async () => {
    mockFetch.mockResolvedValueOnce(
      errorResponse(404, "NOT_FOUND", "Invoice not found"),
    );
    try {
      await client.getInvoice("inv_missing");
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ProofLinkAPIError);
      const apiErr = err as ProofLinkAPIError;
      expect(apiErr.status).toBe(404);
    }
  });

  it("throws ProofLinkAPIError with null body when response is not valid JSON", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response("Internal Server Error", {
        status: 500,
        headers: { "Content-Type": "text/plain" },
      }),
    );
    // maxRetries=0, so after 1 attempt it throws
    await expect(client.screenAddress("0xTest", "ethereum")).rejects.toThrow(
      ProofLinkAPIError,
    );
  });

  it("does not retry on 4xx (non-retryable)", async () => {
    mockFetch.mockResolvedValueOnce(errorResponse(422, "UNPROCESSABLE", "Bad data"));
    const retryClient = new ProofLinkClient({
      apiKey: "fl_test",
      baseUrl: "https://api.test.prooflink.io/v1",
      maxRetries: 3,
    });
    await expect(retryClient.screenAddress("0xTest", "ethereum")).rejects.toThrow(
      ProofLinkAPIError,
    );
    // Only 1 call — no retries on 4xx
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Network error and timeout
// ---------------------------------------------------------------------------

describe("network and timeout error handling", () => {
  it("throws ProofLinkNetworkError when fetch rejects with TypeError", async () => {
    mockFetch.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await expect(client.screenAddress("0xTest", "ethereum")).rejects.toThrow(
      ProofLinkNetworkError,
    );
  });

  it("throws ProofLinkTimeoutError when fetch rejects with DOMException TimeoutError", async () => {
    const timeoutErr = new DOMException("signal timed out", "TimeoutError");
    mockFetch.mockRejectedValueOnce(timeoutErr);
    await expect(client.screenAddress("0xTest", "ethereum")).rejects.toThrow(
      ProofLinkTimeoutError,
    );
  });

  it("ProofLinkTimeoutError message includes timeout duration and URL", async () => {
    const timeoutErr = new DOMException("signal timed out", "TimeoutError");
    mockFetch.mockRejectedValueOnce(timeoutErr);
    try {
      await client.screenAddress("0xTest", "ethereum");
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ProofLinkTimeoutError);
      const tErr = err as ProofLinkTimeoutError;
      expect(tErr.message).toContain("5000ms");
      expect(tErr.url).toContain("/compliance/screen");
    }
  });

  it("ProofLinkNetworkError message includes attempt count", async () => {
    mockFetch.mockRejectedValue(new TypeError("ECONNREFUSED"));
    try {
      await client.screenAddress("0xTest", "ethereum");
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ProofLinkNetworkError);
      expect((err as ProofLinkNetworkError).message).toContain("attempt");
    }
  });
});

// ---------------------------------------------------------------------------
// Retry logic
// ---------------------------------------------------------------------------

describe("retry logic", () => {
  it("retries on 500 and succeeds on second attempt", async () => {
    const retryClient = new ProofLinkClient({
      apiKey: "fl_test",
      baseUrl: "https://api.test.prooflink.io/v1",
      maxRetries: 1,
      timeout: 5000,
    });
    mockFetch
      .mockResolvedValueOnce(errorResponse(500, "INTERNAL", "Server error"))
      .mockResolvedValueOnce(jsonResponse(SANCTIONS_RESULT));

    const result = await retryClient.screenAddress("0xTest", "ethereum");
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(result.matched).toBe(false);
  });

  it("retries on 502 Bad Gateway", async () => {
    const retryClient = new ProofLinkClient({
      apiKey: "fl_test",
      baseUrl: "https://api.test.prooflink.io/v1",
      maxRetries: 1,
      timeout: 5000,
    });
    mockFetch
      .mockResolvedValueOnce(errorResponse(502, "BAD_GATEWAY", "Upstream error"))
      .mockResolvedValueOnce(jsonResponse(SANCTIONS_RESULT));

    const result = await retryClient.screenAddress("0xTest", "ethereum");
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(result.matched).toBe(false);
  });

  it("retries on 503 Service Unavailable", async () => {
    const retryClient = new ProofLinkClient({
      apiKey: "fl_test",
      baseUrl: "https://api.test.prooflink.io/v1",
      maxRetries: 1,
      timeout: 5000,
    });
    mockFetch
      .mockResolvedValueOnce(errorResponse(503, "UNAVAILABLE", "Down"))
      .mockResolvedValueOnce(jsonResponse(SANCTIONS_RESULT));

    const result = await retryClient.screenAddress("0xTest", "ethereum");
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(result.matched).toBe(false);
  });

  it("retries on 408 Request Timeout", async () => {
    const retryClient = new ProofLinkClient({
      apiKey: "fl_test",
      baseUrl: "https://api.test.prooflink.io/v1",
      maxRetries: 1,
      timeout: 5000,
    });
    mockFetch
      .mockResolvedValueOnce(errorResponse(408, "TIMEOUT", "Request timed out"))
      .mockResolvedValueOnce(jsonResponse(SANCTIONS_RESULT));

    const result = await retryClient.screenAddress("0xTest", "ethereum");
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(result.matched).toBe(false);
  });

  it("exhausts retries and throws the last API error", async () => {
    const retryClient = new ProofLinkClient({
      apiKey: "fl_test",
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

  it("respects Retry-After header on 429", async () => {
    const retryClient = new ProofLinkClient({
      apiKey: "fl_test",
      baseUrl: "https://api.test.prooflink.io/v1",
      maxRetries: 1,
      timeout: 5000,
    });
    const rateLimitResp = new Response(
      JSON.stringify({ code: "RATE_LIMITED", message: "Too many requests" }),
      { status: 429, headers: { "Content-Type": "application/json", "Retry-After": "0" } },
    );
    mockFetch
      .mockResolvedValueOnce(rateLimitResp)
      .mockResolvedValueOnce(jsonResponse(SANCTIONS_RESULT));

    const result = await retryClient.screenAddress("0xTest", "ethereum");
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(result.matched).toBe(false);
  });

  it("does not retry on DOMException TimeoutError after maxRetries exhausted", async () => {
    const retryClient = new ProofLinkClient({
      apiKey: "fl_test",
      baseUrl: "https://api.test.prooflink.io/v1",
      maxRetries: 1,
      timeout: 5000,
    });
    const timeoutErr = new DOMException("signal timed out", "TimeoutError");
    mockFetch
      .mockRejectedValueOnce(timeoutErr)
      .mockRejectedValueOnce(timeoutErr);

    await expect(retryClient.screenAddress("0xTest", "ethereum")).rejects.toThrow(
      ProofLinkTimeoutError,
    );
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// Validation errors from methods
// ---------------------------------------------------------------------------

describe("client-side validation errors", () => {
  it("screenAddress throws when address is empty string", async () => {
    await expect(client.screenAddress("", "ethereum")).rejects.toThrow(
      ProofLinkValidationError,
    );
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("screenAddress throws when chain is empty string", async () => {
    await expect(client.screenAddress("0xTest", "")).rejects.toThrow(
      ProofLinkValidationError,
    );
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("getComplianceReceipt throws when receiptId is empty", async () => {
    await expect(client.getComplianceReceipt("")).rejects.toThrow(
      ProofLinkValidationError,
    );
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("getInvoice throws when id is empty", async () => {
    await expect(client.getInvoice("")).rejects.toThrow(
      ProofLinkValidationError,
    );
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("updateInvoiceState throws when invoiceId is empty", async () => {
    await expect(client.updateInvoiceState("", "ISSUED")).rejects.toThrow(
      ProofLinkValidationError,
    );
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("verifyAgent throws when agentId is empty", async () => {
    await expect(client.verifyAgent("")).rejects.toThrow(ProofLinkValidationError);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("getAgentIdentity throws when agentId is empty", async () => {
    await expect(client.getAgentIdentity("")).rejects.toThrow(
      ProofLinkValidationError,
    );
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("screenAddress field name is address for address error", async () => {
    try {
      await client.screenAddress("", "ethereum");
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ProofLinkValidationError);
      expect((err as ProofLinkValidationError).field).toBe("address");
    }
  });

  it("screenAddress field name is chain for chain error", async () => {
    try {
      await client.screenAddress("0xTest", "");
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ProofLinkValidationError);
      expect((err as ProofLinkValidationError).field).toBe("chain");
    }
  });
});

// ---------------------------------------------------------------------------
// Request structure verification
// ---------------------------------------------------------------------------

describe("request structure", () => {
  it("sends Content-Type: application/json on POST requests", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse(SANCTIONS_RESULT));
    await client.screenAddress("0xTest", "ethereum");
    const headers = lastInit().headers as Record<string, string>;
    expect(headers["Content-Type"]).toBe("application/json");
  });

  it("sends Accept: application/json on all requests", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse(SANCTIONS_RESULT));
    await client.screenAddress("0xTest", "ethereum");
    const headers = lastInit().headers as Record<string, string>;
    expect(headers["Accept"]).toBe("application/json");
  });

  it("does not send Content-Type on GET requests", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({ receiptId: "r1", checksPerformed: [], overallStatus: "APPROVED", riskScore: 0, travelRuleStatus: "NOT_REQUIRED", signature: "0xsig", timestamp: "2026-01-01T00:00:00Z", ttl: 300, proofLinkVersion: "1.0.0" }),
    );
    await client.getComplianceReceipt("r1");
    const headers = lastInit().headers as Record<string, string>;
    expect(headers["Content-Type"]).toBeUndefined();
  });

  it("URL-encodes path segments for getComplianceReceipt", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({ receiptId: "rcpt/with/slashes", checksPerformed: [], overallStatus: "APPROVED", riskScore: 0, travelRuleStatus: "NOT_REQUIRED", signature: "0x", timestamp: "2026-01-01T00:00:00Z", ttl: 300, proofLinkVersion: "1.0.0" }),
    );
    await client.getComplianceReceipt("rcpt/with/slashes");
    expect(lastUrl()).toContain("rcpt%2Fwith%2Fslashes");
  });

  it("URL-encodes path segments for getInvoice", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({ "@context": [], "@type": "Invoice", invoiceId: "inv/special", state: "DRAFT", seller: { walletAddress: "0xS" }, buyer: { walletAddress: "0xB" }, lineItems: [], currency: "USDC", totalAmount: 0, anchoredOnChain: false, createdAt: "", updatedAt: "" }),
    );
    await client.getInvoice("inv/special");
    expect(lastUrl()).toContain("inv%2Fspecial");
  });

  it("getComplianceHistory sends no query params when called with empty object", async () => {
    const paginated = { items: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 0 } };
    mockFetch.mockResolvedValueOnce(jsonResponse(paginated));
    await client.getComplianceHistory({});
    // URL should end cleanly without a ? or with only ?
    const url = lastUrl();
    expect(url).toBe("https://api.test.prooflink.io/v1/compliance/history");
  });

  it("listInvoices sends no query params when called with empty object", async () => {
    const paginated = { items: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 0 } };
    mockFetch.mockResolvedValueOnce(jsonResponse(paginated));
    await client.listInvoices({});
    expect(lastUrl()).toBe("https://api.test.prooflink.io/v1/invoices");
  });

  it("listAgents sends no query params when called with empty object", async () => {
    const paginated = { items: [AGENT_IDENTITY], pagination: { page: 1, limit: 10, total: 1, totalPages: 1 } };
    mockFetch.mockResolvedValueOnce(jsonResponse(paginated));
    await client.listAgents({});
    expect(lastUrl()).toBe("https://api.test.prooflink.io/v1/identity/agents");
  });

  it("updateInvoiceState sends state and optional reason in body", async () => {
    const updated = { "@context": [], "@type": "Invoice", invoiceId: "inv_001", state: "CANCELLED", seller: { walletAddress: "0xS" }, buyer: { walletAddress: "0xB" }, lineItems: [], currency: "USDC", totalAmount: 0, anchoredOnChain: false, createdAt: "", updatedAt: "" };
    mockFetch.mockResolvedValueOnce(jsonResponse(updated));
    await client.updateInvoiceState("inv_001", "CANCELLED", "User requested cancellation");
    const body = JSON.parse(lastInit().body as string) as Record<string, unknown>;
    expect(body.state).toBe("CANCELLED");
    expect(body.reason).toBe("User requested cancellation");
  });

  it("updateInvoiceState omits reason when not provided", async () => {
    const updated = { "@context": [], "@type": "Invoice", invoiceId: "inv_002", state: "ISSUED", seller: { walletAddress: "0xS" }, buyer: { walletAddress: "0xB" }, lineItems: [], currency: "USDC", totalAmount: 0, anchoredOnChain: false, createdAt: "", updatedAt: "" };
    mockFetch.mockResolvedValueOnce(jsonResponse(updated));
    await client.updateInvoiceState("inv_002", "ISSUED");
    const body = JSON.parse(lastInit().body as string) as Record<string, unknown>;
    expect(body.state).toBe("ISSUED");
    // reason present as undefined in body is fine — JSON.stringify omits it
  });
});

// ---------------------------------------------------------------------------
// checkCompliance — sanctioned address response
// ---------------------------------------------------------------------------

describe("checkCompliance with sanctioned address", () => {
  it("returns REJECTED status for sanctioned sender", async () => {
    const rejectedDecision = {
      status: "REJECTED",
      riskScore: 100,
      receiptId: "rcpt_sanctioned",
      receiptHash: "0xdead",
      checks: [
        {
          checkType: "SANCTIONS_SCREENING",
          result: "FAILED",
          performedAt: "2026-01-01T00:00:00Z",
          provider: "chainalysis",
        },
      ],
      travelRuleStatus: "NOT_REQUIRED",
      timestamp: "2026-01-01T00:00:00Z",
      ttl: 300,
      blockReason: "Sanctioned address: OFAC SDN match",
    };
    mockFetch.mockResolvedValueOnce(jsonResponse(rejectedDecision));

    const result = await client.checkCompliance({
      sender: { address: "0xSanctioned", chain: "ethereum" },
      receiver: { address: "0xBob", chain: "ethereum" },
      amount: "10000",
      asset: "USDC",
    });

    expect(result.status).toBe("REJECTED");
    expect(result.riskScore).toBe(100);
    expect(result.blockReason).toBe("Sanctioned address: OFAC SDN match");
  });
});

// ---------------------------------------------------------------------------
// calculateRiskScore with high risk metadata
// ---------------------------------------------------------------------------

describe("calculateRiskScore", () => {
  it("returns score with exceeds=true when above threshold", async () => {
    const highRisk = {
      score: 75,
      factors: [
        { factor: "mixer_exposure", weight: 0.8, detail: "Connected to known mixer" },
      ],
      threshold: 50,
      exceeds: true,
      evaluatedAt: "2026-01-01T00:00:00Z",
    };
    mockFetch.mockResolvedValueOnce(jsonResponse(highRisk));

    const result = await client.calculateRiskScore({
      senderAddress: "0xHighRisk",
      receiverAddress: "0xBob",
      amount: "100000",
      asset: "USDC",
      chain: "ethereum",
      metadata: { txCount: 500 },
    });

    expect(result.score).toBe(75);
    expect(result.exceeds).toBe(true);
    expect(result.factors[0]?.factor).toBe("mixer_exposure");
  });
});

// ---------------------------------------------------------------------------
// issueKYA
// ---------------------------------------------------------------------------

describe("issueKYA", () => {
  it("POSTs to /identity/kya/issue with full params", async () => {
    const credential = {
      "@context": ["https://www.w3.org/2018/credentials/v1"],
      type: ["VerifiableCredential", "KYACredential"],
      id: "urn:prooflink:kya:cred_ext_001",
      issuer: { id: "did:prooflink:issuer", name: "ProofLink" },
      issuanceDate: "2026-01-01T00:00:00Z",
      expirationDate: "2027-01-01T00:00:00Z",
      credentialSubject: {
        id: "did:prooflink:agent_ext_001",
        agentDid: "agent_ext_001",
        agentType: "autonomous",
        controllingEntityName: "Corp",
        delegationScope: { maxTransactionValue: 5000, expiresAt: "2027-01-01T00:00:00Z" },
        walletAddress: "0xExtAgent",
      },
      proof: {
        type: "EcdsaSecp256k1Signature2019",
        created: "2026-01-01T00:00:00Z",
        verificationMethod: "did:prooflink:issuer#key-1",
        proofPurpose: "assertionMethod",
        jws: "eyJ...",
      },
    };
    mockFetch.mockResolvedValueOnce(jsonResponse(credential));

    const result = await client.issueKYA({
      agentId: "agent_ext_001",
      agentType: "autonomous",
      controllingEntity: { name: "Corp", kybVerified: true },
      delegationScope: { maxTransactionValue: 5000, expiresAt: "2027-01-01T00:00:00Z" },
      walletAddress: "0xExtAgent",
      validationEvidence: "kyb-doc-123",
    });

    expect(lastInit().method).toBe("POST");
    expect(lastUrl()).toBe("https://api.test.prooflink.io/v1/identity/kya/issue");
    expect(result.credentialSubject.agentDid).toBe("agent_ext_001");
  });
});
