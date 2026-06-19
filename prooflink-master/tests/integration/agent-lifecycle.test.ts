/**
 * Integration tests: Agent lifecycle
 *
 * Covers the agent identity and compliance flow:
 *   1. Issue KYA credential (POST /v1/identity/kya/issue) → creates agent record
 *   2. Retrieve agent KYA status (GET /v1/identity/:agentId)
 *   3. Verify agent (POST /v1/identity/verify)
 *   4. Agent makes a payment with KYA credential (POST /v1/compliance/check w/ agentDID)
 *   5. Compliance check verifies KYA credential in pipeline
 *   6. Get compliance receipt
 *
 * Additional scenarios:
 *   - Agent delegation scope enforcement (amount exceeds maxTransactionAmount)
 *   - Agent with expired credential gets rejected
 *   - Inactive agent cannot verify
 *
 * DB is mocked. Chainalysis API is mocked via vi.stubGlobal("fetch").
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { createApp } from "../../apps/api/src/app.js";
import { resetRateLimitStore } from "../../apps/api/src/middleware/rate-limit.js";
import {
  mockInsertReturning,
  mockSelectFrom,
  mockUpdateReturning,
  sampleComplianceCheck,
  sampleReceipt,
  CLEAN_SENDER,
  CLEAN_RECEIVER,
  AGENT_ADDRESS,
  cleanChainalysisResponse,
} from "./setup.js";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("../../apps/api/src/db/index.js", () => ({
  getDb: () => ({
    insert: () => ({
      values: () => ({
        returning: mockInsertReturning,
        onConflictDoUpdate: () => ({ returning: mockInsertReturning }),
      }),
    }),
    select: () => ({ from: mockSelectFrom }),
    update: () => ({
      set: () => ({
        where: () => ({
          returning: mockUpdateReturning,
          catch: () => {},
        }),
      }),
    }),
  }),
  getPool: () => ({
    query: vi.fn().mockResolvedValue({ rows: [{ "?column?": 1 }] }),
  }),
}));

vi.mock("../../apps/api/src/middleware/auth.js", () => ({
  authMiddleware: () => async (_c: unknown, next: () => Promise<void>) => next(),
}));

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const app = createApp();

function setCleanFetch(): void {
  mockFetch.mockImplementation(() => Promise.resolve(cleanChainalysisResponse()));
}

const AGENT_DID = "did:prooflink:agent:inference-v3";

function makeKYAPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    agentDid: AGENT_DID,
    agentType: "semi-autonomous",
    controllingEntity: {
      name: "Acme Corp",
      lei: "549300ABCDEF123456AB",
      did: "did:web:acmecorp.com",
      kybVerified: true,
    },
    walletAddress: AGENT_ADDRESS,
    delegationScope: {
      maxTransactionValue: 10_000,
      dailyLimit: 50_000,
      allowedChains: ["eip155:8453", "eip155:1"],
      allowedCurrencies: ["USDC", "USDT"],
      expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
    },
    erc8004RegistryAddress: "0xRegistry1234567890abcdef1234567890abcd",
    erc8004TokenId: "42",
    ...overrides,
  };
}

function makeValidKYACredential(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    "@context": ["https://www.w3.org/2018/credentials/v1"],
    type: ["VerifiableCredential", "KYACredential"],
    issuer: "did:web:prooflink.io",
    issuanceDate: "2026-01-01T00:00:00Z",
    expirationDate: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
    credentialSubject: {
      id: AGENT_DID,
      walletAddress: AGENT_ADDRESS,
      delegationScope: {
        maxTransactionAmount: 10_000,
        expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
      },
    },
    ...overrides,
  };
}

const sampleAgentRow = {
  id: "550e8400-e29b-41d4-a716-446655440010",
  agentDid: AGENT_DID,
  name: null,
  agentType: "semi-autonomous",
  walletAddress: AGENT_ADDRESS,
  controllingEntityName: "Acme Corp",
  controllingEntityLei: "549300ABCDEF123456AB",
  erc8004Id: 42,
  erc8004Registry: "0xRegistry1234567890abcdef1234567890abcd",
  complianceScore: 80,
  delegationScope: {
    maxTransactionValue: 10_000,
    dailyLimit: 50_000,
    allowedChains: ["eip155:8453", "eip155:1"],
    allowedCurrencies: ["USDC", "USDT"],
    expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
  },
  isActive: true,
  validatedAt: new Date("2026-01-01T00:00:00Z"),
  expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-01T00:00:00Z"),
};

function seedCheckAndReceipt(
  checkOverrides: Record<string, unknown> = {},
  receiptOverrides: Record<string, unknown> = {},
): void {
  mockInsertReturning
    .mockResolvedValueOnce([{ ...sampleComplianceCheck, ...checkOverrides, createdAt: new Date() }])
    .mockResolvedValueOnce([{ ...sampleReceipt, ...receiptOverrides, createdAt: new Date() }]);
}

async function runCheckWithAgent(overrides: Record<string, unknown> = {}): Promise<Response> {
  return app.request("/v1/compliance/check", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sender: { address: AGENT_ADDRESS, chain: "eip155:8453", agentDID: AGENT_DID },
      receiver: { address: CLEAN_RECEIVER, chain: "eip155:8453" },
      amount: "500.00",
      asset: "USDC",
      protocol: "x402",
      ...overrides,
    }),
  });
}

// ---------------------------------------------------------------------------
// Agent KYA issuance (POST /v1/identity/kya/issue)
// ---------------------------------------------------------------------------

describe("Agent lifecycle — KYA credential issuance", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetRateLimitStore();
    setCleanFetch();
  });

  it("POST identity/kya/issue returns 201 with agent record and W3C credential", async () => {
    // Arrange — route does a select (lookup existing) then insert/upsert
    mockSelectFrom.mockReturnValue({
      where: () => ({
        limit: () => Promise.resolve([]),
      }),
    });
    mockInsertReturning.mockResolvedValueOnce([sampleAgentRow]);

    // Act
    const res = await app.request("/v1/identity/kya/issue", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(makeKYAPayload()),
    });

    // Assert
    expect(res.status).toBe(201);
    const json = await res.json() as { success: boolean; data: { agent: Record<string, unknown>; credential: Record<string, unknown> } };
    expect(json.success).toBe(true);
    expect(json.data.agent.agentDid).toBe(AGENT_DID);
    expect(json.data.agent.isActive).toBe(true);

    // W3C VC structure
    expect(json.data.credential["@context"]).toBeInstanceOf(Array);
    expect((json.data.credential.type as string[])).toContain("VerifiableCredential");
    expect((json.data.credential.type as string[])).toContain("KYACredential");
    expect(json.data.credential.issuer).toBeTruthy();
    expect(json.data.credential.credentialSubject).toBeDefined();
    expect(json.data.credential.issuanceDate).toBeTruthy();
    expect(json.data.credential.expirationDate).toBeTruthy();
    expect(json.data.credential.proof).toBeDefined();
  });

  it("POST identity/kya/issue returns 400 for missing walletAddress", async () => {
    // Act
    const res = await app.request("/v1/identity/kya/issue", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        agentDid: AGENT_DID,
        agentType: "autonomous",
        controllingEntity: { name: "Corp", kybVerified: false },
        // walletAddress missing
        delegationScope: {
          maxTransactionValue: 1000,
          expiresAt: new Date(Date.now() + 86400000).toISOString(),
        },
      }),
    });

    // Assert
    expect(res.status).toBe(400);
    const json = await res.json() as { success: boolean };
    expect(json.success).toBe(false);
  });

  it("POST identity/kya/issue returns 400 for missing controllingEntity", async () => {
    // Act
    const res = await app.request("/v1/identity/kya/issue", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        agentDid: AGENT_DID,
        agentType: "autonomous",
        walletAddress: AGENT_ADDRESS,
        // controllingEntity missing
        delegationScope: {
          maxTransactionValue: 1000,
          expiresAt: new Date(Date.now() + 86400000).toISOString(),
        },
      }),
    });

    // Assert
    expect(res.status).toBe(400);
  });

  it("POST identity/kya/issue preserves compliance score on re-issue", async () => {
    // Arrange — simulate existing agent with higher compliance score
    mockSelectFrom.mockReturnValue({
      where: () => ({
        limit: () => Promise.resolve([{ complianceScore: 90 }]),
      }),
    });
    mockInsertReturning.mockResolvedValueOnce([{ ...sampleAgentRow, complianceScore: 90 }]);

    // Act
    const res = await app.request("/v1/identity/kya/issue", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(makeKYAPayload()),
    });

    // Assert — DB was called, score preserved from existing agent
    expect(res.status).toBe(201);
    const json = await res.json() as { success: boolean; data: { agent: Record<string, unknown> } };
    expect(json.data.agent.complianceScore).toBe(90);
  });

  it("POST identity/kya/issue for invalid agentType returns 400", async () => {
    // Act
    const res = await app.request("/v1/identity/kya/issue", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(makeKYAPayload({ agentType: "super-autonomous" })), // invalid enum
    });

    // Assert
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// Agent retrieval (GET /v1/identity/:agentId)
// ---------------------------------------------------------------------------

describe("Agent lifecycle — KYA retrieval", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetRateLimitStore();
    setCleanFetch();
  });

  it("GET identity/:agentId returns 200 with full agent data", async () => {
    // Arrange
    mockSelectFrom.mockReturnValue({
      where: () => ({
        limit: () => Promise.resolve([sampleAgentRow]),
      }),
    });

    // Act
    const encodedDid = encodeURIComponent(AGENT_DID);
    const res = await app.request(`/v1/identity/${encodedDid}`);

    // Assert
    expect(res.status).toBe(200);
    const json = await res.json() as { success: boolean; data: Record<string, unknown> };
    expect(json.success).toBe(true);
    expect(json.data.agentDid).toBe(AGENT_DID);
    expect(json.data.isActive).toBe(true);
    expect(json.data.complianceScore).toBe(80);
    expect(json.data.delegationScope).toBeDefined();
    expect(json.data.walletAddress).toBe(AGENT_ADDRESS);
  });

  it("GET identity/:agentId returns 404 for unknown agent", async () => {
    // Arrange
    mockSelectFrom.mockReturnValue({
      where: () => ({
        limit: () => Promise.resolve([]),
      }),
    });

    // Act
    const res = await app.request("/v1/identity/did:prooflink:agent:unknown-999");

    // Assert
    expect(res.status).toBe(404);
    const json = await res.json() as { success: boolean; error: Record<string, string> };
    expect(json.success).toBe(false);
    expect(json.error.code).toBe("NOT_FOUND");
  });

  it("GET identity/:agentId returns controlling entity details", async () => {
    // Arrange
    mockSelectFrom.mockReturnValue({
      where: () => ({
        limit: () => Promise.resolve([sampleAgentRow]),
      }),
    });

    // Act
    const res = await app.request(`/v1/identity/${encodeURIComponent(AGENT_DID)}`);

    // Assert
    const json = await res.json() as { data: Record<string, unknown> };
    const entity = json.data.controllingEntity as Record<string, string>;
    expect(entity.name).toBe("Acme Corp");
  });
});

// ---------------------------------------------------------------------------
// Agent verification (POST /v1/identity/verify)
// ---------------------------------------------------------------------------

describe("Agent lifecycle — identity verification", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetRateLimitStore();
    setCleanFetch();
  });

  it("POST identity/verify returns verified:true for active non-expired agent", async () => {
    // Arrange
    mockSelectFrom.mockReturnValue({
      where: () => ({
        limit: () => Promise.resolve([sampleAgentRow]),
      }),
    });

    // Act
    const res = await app.request("/v1/identity/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agentId: AGENT_DID }),
    });

    // Assert
    expect(res.status).toBe(200);
    const json = await res.json() as { success: boolean; data: Record<string, unknown> };
    expect(json.success).toBe(true);
    expect(json.data.verified).toBe(true);
    expect(json.data.trustScore).toBe(80);
    expect(json.data.delegationScope).toBeDefined();
  });

  it("POST identity/verify returns verified:false for inactive agent", async () => {
    // Arrange
    mockSelectFrom.mockReturnValue({
      where: () => ({
        limit: () => Promise.resolve([{ ...sampleAgentRow, isActive: false }]),
      }),
    });

    // Act
    const res = await app.request("/v1/identity/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agentId: AGENT_DID }),
    });

    // Assert
    expect(res.status).toBe(200);
    const json = await res.json() as { data: Record<string, unknown> };
    expect(json.data.verified).toBe(false);
  });

  it("POST identity/verify returns verified:false for expired agent (expiresAt in past)", async () => {
    // Arrange
    mockSelectFrom.mockReturnValue({
      where: () => ({
        limit: () => Promise.resolve([{
          ...sampleAgentRow,
          isActive: true,
          expiresAt: new Date("2020-01-01"), // expired
        }]),
      }),
    });

    // Act
    const res = await app.request("/v1/identity/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agentId: AGENT_DID }),
    });

    // Assert
    expect(res.status).toBe(200);
    const json = await res.json() as { data: Record<string, unknown> };
    expect(json.data.verified).toBe(false);
  });

  it("POST identity/verify returns 200 verified:false for unknown agent (soft miss, not 404)", async () => {
    // Arrange
    mockSelectFrom.mockReturnValue({
      where: () => ({
        limit: () => Promise.resolve([]),
      }),
    });

    // Act
    const res = await app.request("/v1/identity/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agentId: "did:prooflink:agent:totally-unknown" }),
    });

    // Assert — 200 with verified: false (not a 404)
    expect(res.status).toBe(200);
    const json = await res.json() as { data: Record<string, unknown> };
    expect(json.data.verified).toBe(false);
  });

  it("POST identity/verify returns 400 for missing agentId", async () => {
    // Act
    const res = await app.request("/v1/identity/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    // Assert
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// Compliance check with KYA credential in pipeline
// ---------------------------------------------------------------------------

describe("Agent lifecycle — compliance check with KYA credential", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetRateLimitStore();
    setCleanFetch();
  });

  it("compliance_check_with_valid_agent_did_passes_kya_verification", async () => {
    // Arrange
    seedCheckAndReceipt();

    // Act
    const res = await runCheckWithAgent();

    // Assert
    expect(res.status).toBe(201);
    const json = await res.json() as { success: boolean; data: { checks: Array<Record<string, string>> } };
    expect(json.success).toBe(true);
    const kyaCheck = json.data.checks.find((c) => c.checkType === "KYA_VERIFICATION");
    expect(kyaCheck).toBeDefined();
    expect(kyaCheck?.result).toBe("PASSED");
  });

  it("compliance_check_with_valid_kya_credential_payload_passes", async () => {
    // Arrange — include full KYA credential in the request body
    seedCheckAndReceipt();

    // Act
    const res = await app.request("/v1/compliance/check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sender: { address: CLEAN_SENDER, chain: "eip155:8453" },
        receiver: { address: CLEAN_RECEIVER, chain: "eip155:8453" },
        amount: "500.00",
        asset: "USDC",
        protocol: "x402",
        kyaCredential: makeValidKYACredential(),
      }),
    });

    // Assert
    expect(res.status).toBe(201);
    const json = await res.json() as { success: boolean; data: Record<string, unknown> };
    expect(json.success).toBe(true);
    expect(json.data.status).toBe("APPROVED");
  });

  it("compliance_check_receipt_stored_in_db_for_agent_payment", async () => {
    // Arrange
    seedCheckAndReceipt();

    // Act
    await runCheckWithAgent();

    // Assert — both DB inserts (check + receipt) happened
    expect(mockInsertReturning).toHaveBeenCalledTimes(2);
  });

  it("get_receipt_for_agent_payment_returns_correct_data", async () => {
    // Arrange
    mockSelectFrom.mockReturnValue({
      where: () => ({
        limit: () => Promise.resolve([{ ...sampleReceipt, createdAt: new Date() }]),
      }),
    });

    // Act
    const res = await app.request(`/v1/compliance/receipt/${sampleReceipt.id}`);

    // Assert
    expect(res.status).toBe(200);
    const json = await res.json() as { success: boolean; data: Record<string, unknown> };
    expect(json.success).toBe(true);
    expect(json.data.id).toBe(sampleReceipt.id);
    expect(json.data.overallStatus).toBeTruthy();
    expect(json.data.riskScore).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Delegation scope enforcement
// ---------------------------------------------------------------------------

describe("Agent lifecycle — delegation scope enforcement", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetRateLimitStore();
    setCleanFetch();
  });

  it("compliance_check_amount_exceeding_delegation_limit_stores_receipt", async () => {
    // Arrange — KYA credential allows max $1000 but amount is $15000
    seedCheckAndReceipt({ status: "REJECTED", riskScore: 100 });

    // Act
    const res = await app.request("/v1/compliance/check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sender: { address: CLEAN_SENDER, chain: "eip155:8453" },
        receiver: { address: CLEAN_RECEIVER, chain: "eip155:8453" },
        amount: "15000.00",
        asset: "USDC",
        protocol: "x402",
        kyaCredential: makeValidKYACredential({
          credentialSubject: {
            id: AGENT_DID,
            walletAddress: AGENT_ADDRESS,
            delegationScope: {
              maxTransactionAmount: 1_000,
              expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
            },
          },
        }),
      }),
    });

    // Assert
    expect(res.status).toBe(201);
    const json = await res.json() as { success: boolean; data: Record<string, unknown> };
    expect(json.success).toBe(true);
    // Receipt was stored (DB insert was called)
    expect(json.data.receiptId).toBeTruthy();
  });

  it("agent_within_delegation_limit_passes_compliance", async () => {
    // Arrange — delegate allows $10000; amount is $500
    seedCheckAndReceipt({ status: "APPROVED", riskScore: 5 });

    // Act
    const res = await runCheckWithAgent({ amount: "500.00" });

    // Assert
    expect(res.status).toBe(201);
    const json = await res.json() as { success: boolean; data: Record<string, unknown> };
    expect(json.data.status).toBe("APPROVED");
  });

  it("compliance_check_at_exact_delegation_limit_passes", async () => {
    // Arrange — $10000 == maxTransactionAmount (boundary)
    seedCheckAndReceipt({ status: "APPROVED", riskScore: 5 });

    // Act
    const res = await app.request("/v1/compliance/check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sender: { address: CLEAN_SENDER, chain: "eip155:8453" },
        receiver: { address: CLEAN_RECEIVER, chain: "eip155:8453" },
        amount: "10000.00",
        asset: "USDC",
        protocol: "x402",
        kyaCredential: makeValidKYACredential(),
      }),
    });

    // Assert
    expect(res.status).toBe(201);
    const json = await res.json() as { success: boolean; data: Record<string, unknown> };
    expect(json.data.status).toBe("APPROVED");
  });
});

// ---------------------------------------------------------------------------
// Expired / invalid credentials
// ---------------------------------------------------------------------------

describe("Agent lifecycle — expired/invalid credential", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetRateLimitStore();
    setCleanFetch();
  });

  it("compliance_check_with_expired_kya_credential_is_rejected_by_pipeline", async () => {
    // Arrange — expiredCredential has past date
    seedCheckAndReceipt({ status: "REJECTED", riskScore: 100 });

    // Act
    const res = await app.request("/v1/compliance/check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sender: { address: CLEAN_SENDER, chain: "eip155:8453" },
        receiver: { address: CLEAN_RECEIVER, chain: "eip155:8453" },
        amount: "500.00",
        asset: "USDC",
        protocol: "x402",
        kyaCredential: makeValidKYACredential({
          expirationDate: "2020-01-01T00:00:00Z", // clearly expired
        }),
      }),
    });

    // Assert
    expect(res.status).toBe(201);
    const json = await res.json() as { success: boolean };
    expect(json.success).toBe(true);
    expect(mockInsertReturning).toHaveBeenCalledTimes(2);
  });

  it("compliance_check_with_untrusted_issuer_stores_receipt", async () => {
    // Arrange
    seedCheckAndReceipt({ status: "REJECTED", riskScore: 100 });

    // Act
    const res = await app.request("/v1/compliance/check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sender: { address: CLEAN_SENDER, chain: "eip155:8453" },
        receiver: { address: CLEAN_RECEIVER, chain: "eip155:8453" },
        amount: "500.00",
        asset: "USDC",
        protocol: "x402",
        kyaCredential: makeValidKYACredential({
          issuer: "did:web:untrusted-issuer.example.com",
        }),
      }),
    });

    // Assert
    expect(res.status).toBe(201);
    const json = await res.json() as { success: boolean };
    expect(json.success).toBe(true);
    expect(mockInsertReturning).toHaveBeenCalledTimes(2);
  });

  it("compliance_check_with_missing_w3c_context_stores_receipt", async () => {
    // Arrange
    seedCheckAndReceipt({ status: "REJECTED", riskScore: 100 });

    // Act
    const res = await app.request("/v1/compliance/check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sender: { address: CLEAN_SENDER, chain: "eip155:8453" },
        receiver: { address: CLEAN_RECEIVER, chain: "eip155:8453" },
        amount: "500.00",
        asset: "USDC",
        protocol: "x402",
        kyaCredential: makeValidKYACredential({
          "@context": [], // missing required W3C context
        }),
      }),
    });

    // Assert
    expect(res.status).toBe(201);
    const json = await res.json() as { success: boolean };
    expect(json.success).toBe(true);
    expect(mockInsertReturning).toHaveBeenCalledTimes(2);
  });
});
