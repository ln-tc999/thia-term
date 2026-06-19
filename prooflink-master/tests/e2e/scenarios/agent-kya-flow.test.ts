/**
 * E2E: Agent KYA (Know Your Agent) Flow
 *
 * Covers the full agent identity lifecycle per the demo script (Demo 2, §[4:30-6:30]):
 *
 * 1. Register agent identity via POST /api/v1/identity/kya/issue
 *    - Verify W3C VC-shaped credential is returned
 *    - Verify agent record persisted in DB
 * 2. Issue KYA credential
 *    - Verify credential includes all required fields (issuer, type, subject)
 *    - Verify delegation scope persisted
 * 3. Verify KYA credential via POST /api/v1/identity/verify
 *    - Agent is active → verified: true, trustScore present
 *    - Expired KYA → verified: false (expiresAt in the past)
 *    - Revoked KYA (isActive: false) → verified: false
 *    - Unknown agent → verified: false, not a 404 — returns soft miss
 * 4. Agent initiates payment → KYA check embedded in compliance pipeline
 *    - agentDID present in compliance/check → KYA_VERIFICATION check included
 * 5. GET /api/v1/identity/:agentId — retrieve agent profile
 *    - Returns full agent metadata including delegationScope
 *    - Returns 404 for unknown agent
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import { createApp } from "../../../apps/api/src/app.js";
import {
  makeAgentRow,
  makeComplianceCheckRow,
  makeReceiptRow,
  BASE_COMPLIANCE_CHECK_PAYLOAD,
} from "../setup.js";

// ---------------------------------------------------------------------------
// DB mocks
// ---------------------------------------------------------------------------

const mockInsertReturning = vi.fn();
const mockSelectFrom = vi.fn();

vi.mock("../../../apps/api/src/db/index.js", () => ({
  getDb: () => ({
    insert: () => ({
      values: () => ({
        returning: mockInsertReturning,
        onConflictDoUpdate: () => ({
          returning: mockInsertReturning,
        }),
        then: (resolve: (v: unknown) => void) => Promise.resolve().then(resolve),
        catch: () => Promise.resolve(),
      }),
    }),
    select: (..._args: unknown[]) => ({
      from: (...args: unknown[]) => {
        const result = mockSelectFrom(...args);
        if (result && typeof result === "object" && "where" in result) {
          return result;
        }
        // Default chainable for select().from().where().limit()
        return {
          where: () => ({
            limit: () => Promise.resolve([]),
          }),
        };
      },
    }),
    update: () => ({
      set: () => ({
        where: () => ({
          returning: vi.fn().mockResolvedValue([]),
          catch: () => Promise.resolve(),
        }),
      }),
    }),
  }),
  getPool: () => ({
    query: vi.fn().mockResolvedValue({ rows: [{ "?column?": 1 }] }),
  }),
}));

vi.mock("../../../apps/api/src/middleware/auth.js", () => ({
  authMiddleware: () => async (_c: unknown, next: () => Promise<void>) => next(),
  requireScope: () => async (_c: unknown, next: () => Promise<void>) => next(),
}));

vi.mock("../../../apps/api/src/middleware/rate-limit.js", () => ({
  rateLimitMiddleware: () => async (_c: unknown, next: () => Promise<void>) => next(),
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const TEST_AGENT_DID = "did:prooflink:agent:inference-v3";
const TEST_AGENT_WALLET = "0xAgentWallet1234567890abcdef1234567890ab";

function futureDate(yearsAhead = 1): string {
  const d = new Date();
  d.setFullYear(d.getFullYear() + yearsAhead);
  return d.toISOString();
}

function pastDate(daysAgo = 1): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString();
}

const BASE_KYA_PAYLOAD = {
  agentDid: TEST_AGENT_DID,
  agentType: "semi-autonomous" as const,
  controllingEntity: {
    name: "Acme Corp",
    lei: "549300ABCDEF123456AB",
    did: "did:web:acmecorp.com",
    kybVerified: true,
  },
  walletAddress: TEST_AGENT_WALLET,
  delegationScope: {
    maxTransactionValue: 10000,
    dailyLimit: 50000,
    allowedChains: ["eip155:8453", "eip155:1"],
    allowedCurrencies: ["USDC", "USDT"],
    expiresAt: futureDate(1),
  },
  erc8004RegistryAddress: "0xRegistry1234567890abcdef1234567890abcd",
  erc8004TokenId: "42",
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("E2E: Agent KYA Flow", () => {
  const app = createApp();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // 1. Register agent identity / issue KYA credential
  // -------------------------------------------------------------------------

  describe("POST /api/v1/identity/kya/issue — register and issue credential", () => {
    it("should create agent record and return a W3C VerifiableCredential", async () => {
      mockInsertReturning.mockResolvedValue([makeAgentRow()]);

      const res = await app.request("/api/v1/identity/kya/issue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(BASE_KYA_PAYLOAD),
      });

      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.success).toBe(true);

      const { agent, credential } = json.data;

      // Agent record
      expect(agent.agentDid).toBe(TEST_AGENT_DID);
      expect(agent.walletAddress).toBe(TEST_AGENT_WALLET);
      expect(agent.controllingEntityName).toBe("Acme Corp");
      expect(agent.isActive).toBe(true);

      // W3C VC structure
      expect(credential["@context"]).toContain("https://www.w3.org/2018/credentials/v1");
      expect(credential.type).toContain("VerifiableCredential");
      expect(credential.type).toContain("KYACredential");
      expect(credential.issuer.id).toBe("did:prooflink:issuer");
      expect(credential.issuanceDate).toBeTruthy();
      expect(credential.expirationDate).toBeTruthy();
    });

    it("should embed agent DID as credentialSubject.id", async () => {
      mockInsertReturning.mockResolvedValue([makeAgentRow()]);

      const res = await app.request("/api/v1/identity/kya/issue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(BASE_KYA_PAYLOAD),
      });

      const json = await res.json();
      expect(json.data.credential.credentialSubject.id).toBe(TEST_AGENT_DID);
    });

    it("should embed delegationScope in the credential subject", async () => {
      mockInsertReturning.mockResolvedValue([makeAgentRow()]);

      const res = await app.request("/api/v1/identity/kya/issue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(BASE_KYA_PAYLOAD),
      });

      const json = await res.json();
      const { credentialSubject } = json.data.credential;

      expect(credentialSubject.delegationScope).toBeDefined();
      expect(credentialSubject.delegationScope.maxTransactionValue).toBe(10000);
      expect(credentialSubject.delegationScope.dailyLimit).toBe(50000);
    });

    it("should include a proof block in the credential", async () => {
      mockInsertReturning.mockResolvedValue([makeAgentRow()]);

      const res = await app.request("/api/v1/identity/kya/issue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(BASE_KYA_PAYLOAD),
      });

      const json = await res.json();
      const { proof } = json.data.credential;

      expect(proof).toBeDefined();
      expect(proof.type).toBeTruthy();
      expect(proof.verificationMethod).toBeTruthy();
      expect(proof.proofPurpose).toBe("assertionMethod");
    });

    it("should upsert agent on second issue (idempotent re-issue)", async () => {
      mockInsertReturning.mockResolvedValue([makeAgentRow()]);

      // Issue twice — both should succeed
      for (let i = 0; i < 2; i++) {
        const res = await app.request("/api/v1/identity/kya/issue", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(BASE_KYA_PAYLOAD),
        });
        expect(res.status).toBe(201);
      }
    });

    it("should return 400 for missing agentDid", async () => {
      const { agentDid: _, ...payload } = BASE_KYA_PAYLOAD;

      const res = await app.request("/api/v1/identity/kya/issue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      expect(res.status).toBe(400);
    });

    it("should return 400 for missing delegationScope.expiresAt", async () => {
      const payload = {
        ...BASE_KYA_PAYLOAD,
        delegationScope: { maxTransactionValue: 1000 }, // missing expiresAt
      };

      const res = await app.request("/api/v1/identity/kya/issue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      expect(res.status).toBe(400);
    });
  });

  // -------------------------------------------------------------------------
  // 2. Verify KYA credential — active agent
  // -------------------------------------------------------------------------

  describe("POST /api/v1/identity/verify — active KYA credential", () => {
    it("should return verified=true for an active agent", async () => {
      mockSelectFrom.mockReturnValue({
        where: () => ({
          limit: () => Promise.resolve([makeAgentRow()]),
        }),
      });

      const res = await app.request("/api/v1/identity/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agentId: TEST_AGENT_DID,
          chain: "eip155:8453",
        }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.verified).toBe(true);
      expect(json.data.trustScore).toBeGreaterThan(0);
      expect(json.data.agentMetadata).toBeDefined();
      expect(json.data.agentMetadata.name).toBe("inference-agent-v3");
    });

    it("should return operator status in verification result", async () => {
      mockSelectFrom.mockReturnValue({
        where: () => ({
          limit: () => Promise.resolve([makeAgentRow()]),
        }),
      });

      const res = await app.request("/api/v1/identity/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentId: TEST_AGENT_DID }),
      });

      const json = await res.json();
      expect(json.data.operatorStatus).toBeDefined();
      expect(json.data.operatorStatus.sanctionsCleared).toBe(true);
      expect(json.data.operatorStatus.kycVerified).toBe(true);
    });

    it("should include delegationScope in verification result", async () => {
      mockSelectFrom.mockReturnValue({
        where: () => ({
          limit: () => Promise.resolve([makeAgentRow()]),
        }),
      });

      const res = await app.request("/api/v1/identity/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentId: TEST_AGENT_DID }),
      });

      const json = await res.json();
      expect(json.data.delegationScope).toBeDefined();
      expect(json.data.delegationScope.maxTransactionValue).toBe(10000);
    });
  });

  // -------------------------------------------------------------------------
  // 3. Expired KYA → payment blocked
  // -------------------------------------------------------------------------

  describe("POST /api/v1/identity/verify — expired KYA credential", () => {
    it("should return verified=false when agent expiresAt is in the past", async () => {
      const expiredAgent = makeAgentRow({
        expiresAt: new Date(pastDate(1)), // expired yesterday
        isActive: true, // still marked active but past expiry
      });

      mockSelectFrom.mockReturnValue({
        where: () => ({
          limit: () => Promise.resolve([expiredAgent]),
        }),
      });

      const res = await app.request("/api/v1/identity/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentId: TEST_AGENT_DID }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      // KYA expiry should result in verified: false
      expect(json.data.verified).toBe(false);
    });

    it("should still return 200 (soft rejection) for expired credentials", async () => {
      const expiredAgent = makeAgentRow({
        expiresAt: new Date("2020-01-01T00:00:00Z"),
      });

      mockSelectFrom.mockReturnValue({
        where: () => ({
          limit: () => Promise.resolve([expiredAgent]),
        }),
      });

      const res = await app.request("/api/v1/identity/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentId: TEST_AGENT_DID }),
      });

      // Must be 200, not 403/401 — the decision is a compliance soft-miss
      expect(res.status).toBe(200);
    });
  });

  // -------------------------------------------------------------------------
  // 4. Revoked KYA → payment blocked
  // -------------------------------------------------------------------------

  describe("POST /api/v1/identity/verify — revoked KYA (isActive: false)", () => {
    it("should return verified=false when agent is deactivated", async () => {
      const revokedAgent = makeAgentRow({ isActive: false });

      mockSelectFrom.mockReturnValue({
        where: () => ({
          limit: () => Promise.resolve([revokedAgent]),
        }),
      });

      const res = await app.request("/api/v1/identity/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentId: TEST_AGENT_DID }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.verified).toBe(false);
    });

    it("should return trustScore of 0 for revoked agent", async () => {
      const revokedAgent = makeAgentRow({ isActive: false });

      mockSelectFrom.mockReturnValue({
        where: () => ({
          limit: () => Promise.resolve([revokedAgent]),
        }),
      });

      const res = await app.request("/api/v1/identity/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentId: TEST_AGENT_DID }),
      });

      const json = await res.json();
      expect(json.data.trustScore).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // 5. Unknown agent → soft miss (not 404)
  // -------------------------------------------------------------------------

  describe("POST /api/v1/identity/verify — unknown agent", () => {
    it("should return verified=false with message for unknown agentId", async () => {
      mockSelectFrom.mockReturnValue({
        where: () => ({
          limit: () => Promise.resolve([]),
        }),
      });

      const res = await app.request("/api/v1/identity/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentId: "did:prooflink:agent:does-not-exist" }),
      });

      // 200 soft-miss, not a 404 hard error
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.verified).toBe(false);
      expect(json.data.trustScore).toBe(0);
      expect(json.data.agentMetadata).toBeNull();
      expect(json.data.message).toContain("not found");
    });
  });

  // -------------------------------------------------------------------------
  // 6. Agent payment: KYA check embedded in compliance pipeline
  // -------------------------------------------------------------------------

  describe("POST /api/v1/compliance/check — KYA embedded in payment flow", () => {
    it("should include KYA_VERIFICATION check when sender provides agentDID", async () => {
      mockInsertReturning
        .mockResolvedValueOnce([makeComplianceCheckRow()])
        .mockResolvedValueOnce([makeReceiptRow()]);

      // Seed agent lookup so resolveAgentOriginator finds an active agent
      const agentRow = makeAgentRow();
      mockSelectFrom.mockImplementation(() => ({
        where: () => ({
          limit: () => Promise.resolve([agentRow]),
        }),
        orderBy: () => ({ limit: () => Promise.resolve([]) }),
      }));

      const res = await app.request("/api/v1/compliance/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...BASE_COMPLIANCE_CHECK_PAYLOAD,
          sender: {
            ...BASE_COMPLIANCE_CHECK_PAYLOAD.sender,
            agentDID: TEST_AGENT_DID,
          },
        }),
      });

      expect(res.status).toBe(201);
      const json = await res.json();
      const kyaCheck = json.data.checks.find(
        (c: { checkType: string }) => c.checkType === "KYA_VERIFICATION",
      );

      expect(kyaCheck).toBeDefined();
      expect(kyaCheck.result).toBe("PASSED");
      expect(kyaCheck.provider).toBeTruthy();
    });

    it("should include KYA_VERIFICATION check as SKIPPED when no agentDID provided", async () => {
      mockInsertReturning
        .mockResolvedValueOnce([makeComplianceCheckRow()])
        .mockResolvedValueOnce([makeReceiptRow()]);

      const res = await app.request("/api/v1/compliance/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(BASE_COMPLIANCE_CHECK_PAYLOAD),
      });

      expect(res.status).toBe(201);
      const json = await res.json();
      const kyaCheck = json.data.checks.find(
        (c: { checkType: string }) => c.checkType === "KYA_VERIFICATION",
      );

      // When no agentDID present, check is SKIPPED (not FAILED)
      expect(kyaCheck?.result).toBe("SKIPPED");
    });
  });

  // -------------------------------------------------------------------------
  // 7. GET /api/v1/identity/:agentId — retrieve agent profile
  // -------------------------------------------------------------------------

  describe("GET /api/v1/identity/:agentId", () => {
    it("should return full agent profile for a registered agent", async () => {
      mockSelectFrom.mockReturnValue({
        where: () => ({
          limit: () => Promise.resolve([makeAgentRow()]),
        }),
      });

      const res = await app.request(
        `/api/v1/identity/${encodeURIComponent(TEST_AGENT_DID)}`,
      );

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);

      const { data } = json;
      expect(data.agentDid).toBe(TEST_AGENT_DID);
      expect(data.agentType).toBe("semi-autonomous");
      expect(data.walletAddress).toBe(TEST_AGENT_WALLET);
      expect(data.controllingEntity.name).toBe("Acme Corp");
      expect(data.complianceScore).toBe(87);
      expect(data.isActive).toBe(true);
      expect(data.delegationScope).toBeDefined();
    });

    it("should include ERC-8004 registry fields when set", async () => {
      mockSelectFrom.mockReturnValue({
        where: () => ({
          limit: () => Promise.resolve([makeAgentRow()]),
        }),
      });

      const res = await app.request(
        `/api/v1/identity/${encodeURIComponent(TEST_AGENT_DID)}`,
      );

      const json = await res.json();
      expect(json.data.erc8004Id).toBe(42);
      expect(json.data.erc8004Registry).toBeTruthy();
    });

    it("should return 404 for an unregistered agent", async () => {
      mockSelectFrom.mockReturnValue({
        where: () => ({
          limit: () => Promise.resolve([]),
        }),
      });

      const res = await app.request(
        "/api/v1/identity/did:prooflink:agent:ghost",
      );

      expect(res.status).toBe(404);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error.code).toBe("NOT_FOUND");
    });

    it("should include validatedAt and expiresAt timestamps", async () => {
      mockSelectFrom.mockReturnValue({
        where: () => ({
          limit: () => Promise.resolve([makeAgentRow()]),
        }),
      });

      const res = await app.request(
        `/api/v1/identity/${encodeURIComponent(TEST_AGENT_DID)}`,
      );

      const json = await res.json();
      expect(json.data.validatedAt).toBeTruthy();
      expect(json.data.expiresAt).toBeTruthy();
      // expiresAt should be in the future
      expect(new Date(json.data.expiresAt).getTime()).toBeGreaterThan(Date.now());
    });
  });
});
