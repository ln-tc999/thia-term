import { describe, expect, it, vi, beforeEach } from "vitest";
import { createApp } from "../app.js";

// ---------------------------------------------------------------------------
// Mock DB
// ---------------------------------------------------------------------------

const mockInsertReturning = vi.fn();
const mockSelectFrom = vi.fn();

vi.mock("../db/index.js", () => ({
  getDb: () => ({
    insert: () => ({
      values: () => ({
        returning: mockInsertReturning,
        onConflictDoUpdate: () => ({
          returning: mockInsertReturning,
        }),
      }),
    }),
    select: () => ({
      from: mockSelectFrom,
    }),
    update: () => ({
      set: () => ({
        where: () => ({
          returning: vi.fn().mockResolvedValue([]),
        }),
      }),
    }),
  }),
  getPool: () => ({
    query: vi.fn().mockResolvedValue({ rows: [{ "?column?": 1 }] }),
  }),
}));

// Bypass auth
vi.mock("../middleware/auth.js", () => ({
  requireScope: () => async (_c: unknown, next: () => Promise<void>) => { await next(); },
  authMiddleware: () => {
    return async (_c: unknown, next: () => Promise<void>) => {
      await next();
    };
  },
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const AGENT_UUID = "550e8400-e29b-41d4-a716-446655440020";
const AGENT_DID = "did:prooflink:agent:testAgent001";

const sampleAgent = {
  id: AGENT_UUID,
  agentDid: AGENT_DID,
  name: "Test Agent",
  agentType: "semi-autonomous",
  walletAddress: "0xAGENT1234567890",
  controllingEntityName: "Acme Corp",
  controllingEntityLei: null,
  erc8004Id: null,
  erc8004Registry: null,
  complianceScore: 80,
  isActive: true,
  delegationScope: {
    maxTransactionValue: 10000,
    dailyLimit: 50000,
    expiresAt: "2027-01-01T00:00:00Z",
  },
  validatedAt: new Date("2026-03-20T00:00:00Z"),
  expiresAt: new Date("2027-01-01T00:00:00Z"),
  createdAt: new Date("2026-03-20T00:00:00Z"),
  updatedAt: new Date("2026-03-20T00:00:00Z"),
};

function validIssueKYABody() {
  return {
    agentDid: AGENT_DID,
    agentType: "semi-autonomous" as const,
    controllingEntity: {
      name: "Acme Corp",
      kybVerified: true,
    },
    walletAddress: "0xAGENT1234567890",
    delegationScope: {
      maxTransactionValue: 10000,
      dailyLimit: 50000,
      expiresAt: "2027-01-01T00:00:00Z",
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Identity API", () => {
  const app = createApp();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("GET /v1/identity/:agentId", () => {
    it("returns 200 with agent data when found", async () => {
      mockSelectFrom.mockReturnValue({
        where: () => ({
          limit: () => Promise.resolve([sampleAgent]),
        }),
      });

      const res = await app.request(
        `/v1/identity/${encodeURIComponent(AGENT_DID)}`,
      );

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.agentDid).toBe(AGENT_DID);
      expect(json.data.agentType).toBe("semi-autonomous");
      expect(json.data.walletAddress).toBe("0xAGENT1234567890");
      expect(json.data.complianceScore).toBe(80);
      expect(json.data.isActive).toBe(true);
    });

    it("returns 200 with full agent shape including optional fields", async () => {
      mockSelectFrom.mockReturnValue({
        where: () => ({
          limit: () => Promise.resolve([sampleAgent]),
        }),
      });

      const res = await app.request(
        `/v1/identity/${encodeURIComponent(AGENT_DID)}`,
      );

      const json = await res.json();
      expect(json.data.id).toBe(AGENT_UUID);
      expect(json.data.controllingEntity).toBeDefined();
      expect(json.data.controllingEntity.name).toBe("Acme Corp");
      expect(json.data.delegationScope).toBeDefined();
      expect(json.data.validatedAt).toBeTypeOf("string");
      expect(json.data.expiresAt).toBeTypeOf("string");
      expect(json.data.createdAt).toBeTypeOf("string");
    });

    it("returns 404 when agent not found", async () => {
      mockSelectFrom.mockReturnValue({
        where: () => ({
          limit: () => Promise.resolve([]),
        }),
      });

      const res = await app.request("/v1/identity/did:prooflink:nonexistent");

      expect(res.status).toBe(404);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error.code).toBe("NOT_FOUND");
    });

    it("returns null for expiresAt when agent has no expiry", async () => {
      mockSelectFrom.mockReturnValue({
        where: () => ({
          limit: () =>
            Promise.resolve([{ ...sampleAgent, expiresAt: null }]),
        }),
      });

      const res = await app.request(
        `/v1/identity/${encodeURIComponent(AGENT_DID)}`,
      );

      const json = await res.json();
      expect(json.data.expiresAt).toBeNull();
    });
  });

  describe("POST /v1/identity/verify", () => {
    it("returns 200 with verified=true for active registered agent", async () => {
      mockSelectFrom.mockReturnValue({
        where: () => ({
          limit: () => Promise.resolve([sampleAgent]),
        }),
      });

      const res = await app.request("/v1/identity/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentId: AGENT_DID }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.verified).toBe(true);
      expect(json.data.trustScore).toBe(80);
      expect(json.data.agentMetadata).toBeDefined();
      expect(json.data.agentMetadata.type).toBe("semi-autonomous");
      expect(json.data.agentMetadata.operator).toBe("Acme Corp");
      expect(json.data.operatorStatus.sanctionsCleared).toBe(true);
      expect(json.data.delegationScope).toBeDefined();
    });

    it("returns 200 with verified=false for inactive agent", async () => {
      mockSelectFrom.mockReturnValue({
        where: () => ({
          limit: () =>
            Promise.resolve([{ ...sampleAgent, isActive: false }]),
        }),
      });

      const res = await app.request("/v1/identity/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentId: AGENT_DID }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.verified).toBe(false);
    });

    it("returns 200 with verified=false for expired agent", async () => {
      mockSelectFrom.mockReturnValue({
        where: () => ({
          limit: () =>
            Promise.resolve([
              { ...sampleAgent, expiresAt: new Date("2020-01-01T00:00:00Z") },
            ]),
        }),
      });

      const res = await app.request("/v1/identity/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentId: AGENT_DID }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.verified).toBe(false);
    });

    it("returns 200 with verified=false when agent not in registry", async () => {
      mockSelectFrom.mockReturnValue({
        where: () => ({
          limit: () => Promise.resolve([]),
        }),
      });

      const res = await app.request("/v1/identity/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentId: "did:prooflink:unknown" }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.verified).toBe(false);
      expect(json.data.trustScore).toBe(0);
      expect(json.data.agentMetadata).toBeNull();
    });

    it("uses default chain when chain is not provided", async () => {
      mockSelectFrom.mockReturnValue({
        where: () => ({
          limit: () => Promise.resolve([sampleAgent]),
        }),
      });

      const res = await app.request("/v1/identity/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentId: AGENT_DID }), // no chain
      });

      expect(res.status).toBe(200);
    });

    it("returns 400 for missing agentId", async () => {
      const res = await app.request("/v1/identity/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(400);
    });

    it("returns 400 for invalid JSON body", async () => {
      const res = await app.request("/v1/identity/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{bad-json",
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.code).toBe("BAD_REQUEST");
    });
  });

  describe("POST /v1/identity/kya/issue", () => {
    it("returns 201 with W3C VC credential for valid request", async () => {
      mockInsertReturning.mockResolvedValue([sampleAgent]);

      const res = await app.request("/v1/identity/kya/issue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(validIssueKYABody()),
      });

      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.agent).toBeDefined();
      expect(json.data.credential).toBeDefined();
      expect(json.data.credential.type).toContain("KYACredential");
      expect(json.data.credential.type).toContain("VerifiableCredential");
      expect(json.data.credential.issuer.id).toBe("did:prooflink:issuer");
      expect(json.data.credential.credentialSubject.id).toBe(AGENT_DID);
      expect(json.data.credential.proof).toBeDefined();
    });

    it("returns 201 with optional ERC-8004 fields when provided", async () => {
      mockInsertReturning.mockResolvedValue([
        { ...sampleAgent, erc8004Id: 42, erc8004Registry: "0xREGISTRY" },
      ]);

      const res = await app.request("/v1/identity/kya/issue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...validIssueKYABody(),
          erc8004RegistryAddress: "0xREGISTRY",
          erc8004TokenId: "42",
        }),
      });

      expect(res.status).toBe(201);
    });

    it("returns 400 for missing agentDid", async () => {
      const body = { ...validIssueKYABody() };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (body as any).agentDid;

      const res = await app.request("/v1/identity/kya/issue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      expect(res.status).toBe(400);
    });

    it("returns 400 for invalid agentType", async () => {
      const res = await app.request("/v1/identity/kya/issue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...validIssueKYABody(),
          agentType: "robot", // not a valid enum value
        }),
      });

      expect(res.status).toBe(400);
    });

    it("returns 400 for negative maxTransactionValue", async () => {
      const res = await app.request("/v1/identity/kya/issue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...validIssueKYABody(),
          delegationScope: {
            ...validIssueKYABody().delegationScope,
            maxTransactionValue: -100,
          },
        }),
      });

      expect(res.status).toBe(400);
    });

    it("returns 400 for invalid expiresAt datetime", async () => {
      const res = await app.request("/v1/identity/kya/issue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...validIssueKYABody(),
          delegationScope: {
            ...validIssueKYABody().delegationScope,
            expiresAt: "not-a-date",
          },
        }),
      });

      expect(res.status).toBe(400);
    });

    it("returns 400 for invalid JSON body", async () => {
      const res = await app.request("/v1/identity/kya/issue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "not-json",
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.code).toBe("BAD_REQUEST");
    });

    it("returns 500 when DB upsert returns empty", async () => {
      mockInsertReturning.mockResolvedValue([]);

      const res = await app.request("/v1/identity/kya/issue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(validIssueKYABody()),
      });

      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.error.code).toBe("INTERNAL_ERROR");
    });

    it("accepts all three valid agentType values", async () => {
      const types = [
        "autonomous",
        "semi-autonomous",
        "human-supervised",
      ] as const;

      for (const agentType of types) {
        mockInsertReturning.mockResolvedValue([{ ...sampleAgent, agentType }]);

        const res = await app.request("/v1/identity/kya/issue", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...validIssueKYABody(), agentType }),
        });

        expect(res.status).toBe(201);
      }
    });
  });
});
