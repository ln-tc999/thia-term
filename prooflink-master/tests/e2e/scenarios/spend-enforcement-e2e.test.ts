/**
 * E2E: Spend Enforcement (Delegation Scope)
 *
 * Tests the delegation scope enforcement logic end-to-end through the API:
 *   - Agent with maxTransactionUsd=1000 → transactions > $1000 are REJECTED
 *   - Agent with allowedChains=["eip155:8453"] → eip155:1 transactions are REJECTED
 *   - Agent with no delegation scope → all transactions pass through
 *   - Invoice creation validation (independent of delegation scope)
 *
 * The delegation scope check runs inside POST /api/v1/compliance/check when
 * sender.agentDID is provided. The DB mock is seeded to return agents with
 * specific scopes so checkDelegationScope() exercises the real logic.
 *
 * No real Postgres or network required.
 *
 * DB select call order per compliance check with agentDID:
 *   1. resolveAgentOriginator(senderAgentDID) → agents table
 *   2. checkDelegationScope → agents table
 *   3. checkDelegationScope daily limit → invoices table
 *   4+ audit log hash chain → audit_log table
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import { createApp } from "../../../apps/api/src/app.js";
import { resetRateLimitStore } from "../../../apps/api/src/middleware/rate-limit.js";
// resetScreener is mocked via vi.mock below — import kept for type compat
import { resetScreener } from "../../../apps/api/src/services/screening.js";
import {
  makeComplianceCheckRow,
  makeReceiptRow,
  makeAgentRow,
  makeInvoiceRow,
  TEST_BUYER_ADDRESS,
  TEST_SELLER_ADDRESS,
} from "../setup.js";

// ---------------------------------------------------------------------------
// DB mock
// ---------------------------------------------------------------------------

const mockInsertReturning = vi.fn();
const mockSelectFrom = vi.fn();

vi.mock("../../../apps/api/src/db/index.js", () => ({
  getDb: () => ({
    insert: () => ({
      values: () => ({
        returning: mockInsertReturning,
        onConflictDoUpdate: () => ({ returning: mockInsertReturning }),
        then: (resolve: (v: unknown) => void) => Promise.resolve().then(resolve),
        catch: () => Promise.resolve(),
      }),
    }),
    select: () => ({
      from: mockSelectFrom,
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

vi.mock("../../../apps/api/src/middleware/rate-limit.js", async () => {
  const mod = await import("../../../apps/api/src/middleware/rate-limit.js");
  return mod;
});

vi.mock("../../../apps/api/src/routes/ws.js", async () => {
  const mod = await import("../../../apps/api/src/routes/ws.js");
  return { ...mod, broadcastWsEvent: vi.fn() };
});

// ---------------------------------------------------------------------------
// Mock the screening service — avoids real HTTP calls to Chainalysis
// ---------------------------------------------------------------------------

const mockScreenAddress = vi.fn();

vi.mock("../../../apps/api/src/services/screening.js", () => ({
  screenAddress: (...args: unknown[]) => mockScreenAddress(...args),
  getScreener: vi.fn(),
  resetScreener: vi.fn(),
}));

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function chainalysisClean(): Response {
  return new Response(JSON.stringify({ identifications: [] }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * Seed the select mock for a compliance check with agentDID.
 *
 * Call order per compliance request with sender.agentDID:
 *  - Calls 1-2: agent lookups (resolveAgentOriginator + checkDelegationScope)
 *  - Call 3:   daily invoices sum (checkDelegationScope daily limit)
 *  - Call 4+:  audit log selects (fire-and-forget, return empty)
 */
function seedAgentSelect(agentRow: ReturnType<typeof makeAgentRow> | null): void {
  let callCount = 0;
  mockSelectFrom.mockImplementation(() => {
    callCount++;
    if (callCount <= 2) {
      // resolveAgentOriginator + checkDelegationScope agents lookup
      return {
        where: () => ({
          limit: () => Promise.resolve(agentRow ? [agentRow] : []),
        }),
      };
    }
    if (callCount === 3) {
      // checkDelegationScope daily invoices sum
      return {
        where: () => Promise.resolve([{ dailyTotal: "0" }]),
      };
    }
    // audit log hash chain selects
    return {
      orderBy: () => ({ limit: () => Promise.resolve([]) }),
      where: () => ({ limit: () => Promise.resolve([]) }),
    };
  });
}

function seedComplianceInserts(checkOverrides: Record<string, unknown> = {}): void {
  mockInsertReturning
    .mockResolvedValueOnce([makeComplianceCheckRow(checkOverrides)])
    .mockResolvedValueOnce([makeReceiptRow()])
    // audit log insert (fire-and-forget)
    .mockResolvedValue([]);
}

/**
 * BASE_COMPLIANCE uses eip155:8453 (CAIP-2 format for Base).
 * The delegation scope uses "eip155:8453" strings for allowedChains.
 */
const BASE_COMPLIANCE = {
  sender: {
    address: TEST_BUYER_ADDRESS,
    chain: "eip155:8453",
    agentDID: "did:prooflink:agent:spend-test-001",
  },
  receiver: { address: TEST_SELLER_ADDRESS, chain: "eip155:8453" },
  amount: "100.00",
  asset: "USDC",
  protocol: "x402",
};

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("E2E: Spend Enforcement — Delegation Scope", () => {
  const app = createApp();

  beforeEach(() => {
    vi.clearAllMocks();
    resetRateLimitStore();
    resetScreener();
    mockFetch.mockResolvedValue(chainalysisClean());

    // Default: all addresses are clean
    mockScreenAddress.mockResolvedValue({
      matched: false,
      listsChecked: ["OFAC_SDN"],
      matchDetails: [],
      riskScore: 0,
      screenedAt: new Date().toISOString(),
      provider: "chainalysis_free",
    });
  });

  // -------------------------------------------------------------------------
  // maxTransactionUsd enforcement
  // -------------------------------------------------------------------------

  describe("maxTransactionUsd enforcement", () => {
    it("should APPROVE a transaction below maxTransactionUsd=1000", async () => {
      const agent = makeAgentRow({
        agentDid: BASE_COMPLIANCE.sender.agentDID,
        delegationScope: { maxTransactionUsd: 1000 },
      });
      seedAgentSelect(agent);
      seedComplianceInserts({ status: "APPROVED" });

      const res = await app.request("/api/v1/compliance/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...BASE_COMPLIANCE, amount: "500.00" }),
      });

      expect(res.status).toBe(201);
      const { data } = await res.json();
      expect(data.status).toBe("APPROVED");
      expect(data.delegationScopeReason).toBeUndefined();
    });

    it("should REJECT a transaction exceeding maxTransactionUsd=1000", async () => {
      const agent = makeAgentRow({
        agentDid: BASE_COMPLIANCE.sender.agentDID,
        delegationScope: { maxTransactionUsd: 1000 },
      });
      seedAgentSelect(agent);
      seedComplianceInserts({ status: "REJECTED" });

      const res = await app.request("/api/v1/compliance/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...BASE_COMPLIANCE, amount: "1001.00" }),
      });

      expect(res.status).toBe(201);
      const { data } = await res.json();
      expect(data.status).toBe("REJECTED");
      expect(data.delegationScopeReason).toMatch(/1000/);
    });

    it("should REJECT a transaction 1 cent over maxTransactionUsd=500 (strict boundary)", async () => {
      const agent = makeAgentRow({
        agentDid: BASE_COMPLIANCE.sender.agentDID,
        delegationScope: { maxTransactionUsd: 500 },
      });
      seedAgentSelect(agent);
      seedComplianceInserts({ status: "REJECTED" });

      const res = await app.request("/api/v1/compliance/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...BASE_COMPLIANCE, amount: "500.01" }),
      });

      expect(res.status).toBe(201);
      const { data } = await res.json();
      expect(data.status).toBe("REJECTED");
    });

    it("should APPROVE a transaction at exactly maxTransactionUsd=500 (not strictly over)", async () => {
      const agent = makeAgentRow({
        agentDid: BASE_COMPLIANCE.sender.agentDID,
        delegationScope: { maxTransactionUsd: 500 },
      });
      seedAgentSelect(agent);
      seedComplianceInserts({ status: "APPROVED" });

      const res = await app.request("/api/v1/compliance/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...BASE_COMPLIANCE, amount: "500.00" }),
      });

      expect(res.status).toBe(201);
      const { data } = await res.json();
      // The check is `amount > maxTransactionUsd` — equal is allowed
      expect(data.status).toBe("APPROVED");
    });
  });

  // -------------------------------------------------------------------------
  // allowedChains enforcement
  // -------------------------------------------------------------------------

  describe("allowedChains enforcement", () => {
    it("should REJECT a transaction on eip155:1 (Ethereum) when only eip155:8453 (Base) is allowed", async () => {
      const agentDid = "did:prooflink:agent:chain-test-002";
      const agent = makeAgentRow({
        agentDid,
        delegationScope: {
          maxTransactionUsd: 10000,
          allowedChains: ["eip155:8453"],
        },
      });
      seedAgentSelect(agent);
      seedComplianceInserts({ status: "REJECTED" });

      const res = await app.request("/api/v1/compliance/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sender: {
            address: TEST_BUYER_ADDRESS,
            chain: "eip155:1", // Ethereum mainnet — not in allowedChains
            agentDID: agentDid,
          },
          receiver: { address: TEST_SELLER_ADDRESS, chain: "eip155:1" },
          amount: "100.00",
          asset: "USDC",
          protocol: "x402",
        }),
      });

      expect(res.status).toBe(201);
      const { data } = await res.json();
      expect(data.status).toBe("REJECTED");
      expect(data.delegationScopeReason).toMatch(/eip155:1/);
    });

    it("should APPROVE a transaction on eip155:8453 when eip155:8453 is in allowedChains", async () => {
      const agent = makeAgentRow({
        agentDid: BASE_COMPLIANCE.sender.agentDID,
        delegationScope: {
          maxTransactionUsd: 10000,
          allowedChains: ["eip155:8453"],
        },
      });
      seedAgentSelect(agent);
      seedComplianceInserts({ status: "APPROVED" });

      const res = await app.request("/api/v1/compliance/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...BASE_COMPLIANCE, amount: "100.00" }),
      });

      expect(res.status).toBe(201);
      const { data } = await res.json();
      expect(data.status).toBe("APPROVED");
      expect(data.delegationScopeReason).toBeUndefined();
    });

    it("should APPROVE any chain when allowedChains is an empty array", async () => {
      const agent = makeAgentRow({
        agentDid: BASE_COMPLIANCE.sender.agentDID,
        delegationScope: {
          maxTransactionUsd: 10000,
          allowedChains: [], // empty → no chain restriction
        },
      });
      seedAgentSelect(agent);
      seedComplianceInserts({ status: "APPROVED" });

      const res = await app.request("/api/v1/compliance/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...BASE_COMPLIANCE,
          sender: { ...BASE_COMPLIANCE.sender, chain: "eip155:42161" },
          receiver: { address: TEST_SELLER_ADDRESS, chain: "eip155:42161" },
        }),
      });

      expect(res.status).toBe(201);
      const { data } = await res.json();
      expect(data.status).toBe("APPROVED");
    });
  });

  // -------------------------------------------------------------------------
  // No delegation scope — all transactions pass
  // -------------------------------------------------------------------------

  describe("No delegation scope — all transactions pass", () => {
    it("should APPROVE any transaction when agent has delegationScope=null", async () => {
      const agent = makeAgentRow({
        agentDid: BASE_COMPLIANCE.sender.agentDID,
        delegationScope: null,
      });
      seedAgentSelect(agent);
      seedComplianceInserts({ status: "APPROVED" });

      const res = await app.request("/api/v1/compliance/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...BASE_COMPLIANCE, amount: "50000.00" }),
      });

      expect(res.status).toBe(201);
      const { data } = await res.json();
      expect(data.status).toBe("APPROVED");
      expect(data.delegationScopeReason).toBeUndefined();
    });

    it("should APPROVE when agent is not found in DB (fail open)", async () => {
      // Agent not found → checkDelegationScope returns { allowed: true }
      mockSelectFrom.mockImplementation(() => ({
        where: () => ({
          limit: () => Promise.resolve([]),
        }),
        orderBy: () => ({ limit: () => Promise.resolve([]) }),
      }));
      seedComplianceInserts({ status: "APPROVED" });

      const res = await app.request("/api/v1/compliance/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...BASE_COMPLIANCE, amount: "99999.00" }),
      });

      expect(res.status).toBe(201);
      const { data } = await res.json();
      expect(data.status).toBe("APPROVED");
    });

    it("should skip delegation check entirely when sender has no agentDID", async () => {
      // No agentDID → checkDelegationScope is not called
      mockSelectFrom.mockImplementation(() => ({
        orderBy: () => ({ limit: () => Promise.resolve([]) }),
        where: () => ({ limit: () => Promise.resolve([]) }),
      }));
      seedComplianceInserts({ status: "APPROVED" });

      const res = await app.request("/api/v1/compliance/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sender: { address: TEST_BUYER_ADDRESS, chain: "eip155:8453" }, // no agentDID
          receiver: { address: TEST_SELLER_ADDRESS, chain: "eip155:8453" },
          amount: "999999.00",
          asset: "USDC",
          protocol: "x402",
        }),
      });

      expect(res.status).toBe(201);
      const { data } = await res.json();
      expect(data.delegationScopeReason).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // Invoice creation — standard validation (scope not enforced here)
  // -------------------------------------------------------------------------

  describe("Invoice creation — DB and validation behaviour", () => {
    it("should create an invoice successfully when DB insert succeeds", async () => {
      mockInsertReturning.mockResolvedValueOnce([makeInvoiceRow()]);

      const res = await app.request("/api/v1/invoices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          seller: {
            walletAddress: TEST_SELLER_ADDRESS,
            agentId: "did:prooflink:agent:seller-001",
            legalName: "Acme Corp",
          },
          buyer: {
            walletAddress: TEST_BUYER_ADDRESS,
            agentId: "did:prooflink:agent:buyer-001",
            legalName: "Test Client",
          },
          lineItems: [
            {
              description: "API inference",
              quantity: 100,
              unit: "call",
              unitPrice: 0.45,
              total: 45.0,
              serviceCategory: "api_call",
            },
          ],
          currency: "USDC",
          totalAmount: 45.0,
          paymentProtocol: "x402",
        }),
      });

      expect(res.status).toBe(201);
      const { data } = await res.json();
      expect(data.id).toBeTruthy();
      expect(data.state).toBe("DRAFT");
    });

    it("should return 400 when totalAmount does not match line item sum", async () => {
      const res = await app.request("/api/v1/invoices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          seller: { walletAddress: TEST_SELLER_ADDRESS },
          buyer: { walletAddress: TEST_BUYER_ADDRESS },
          lineItems: [
            {
              description: "Item 1",
              quantity: 1,
              unit: "unit",
              unitPrice: 100,
              total: 100,
            },
          ],
          currency: "USDC",
          totalAmount: 999, // mismatches line item sum of 100
          paymentProtocol: "x402",
        }),
      });

      expect(res.status).toBe(400);
    });

    it("should return 500 when DB insert returns empty array (no row created)", async () => {
      mockInsertReturning.mockResolvedValueOnce([]);

      const res = await app.request("/api/v1/invoices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          seller: { walletAddress: TEST_SELLER_ADDRESS },
          buyer: { walletAddress: TEST_BUYER_ADDRESS },
          lineItems: [{ description: "Item", quantity: 1, unit: "unit", unitPrice: 45, total: 45 }],
          currency: "USDC",
          totalAmount: 45,
          paymentProtocol: "x402",
        }),
      });

      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error.code).toBe("INTERNAL_ERROR");
    });
  });

  // -------------------------------------------------------------------------
  // DELEGATION_SCOPE check in compliance checks array
  // -------------------------------------------------------------------------

  describe("DELEGATION_SCOPE check recorded in compliance checks[]", () => {
    it("should include DELEGATION_SCOPE check with result=FAILED when scope is exceeded", async () => {
      const agent = makeAgentRow({
        agentDid: BASE_COMPLIANCE.sender.agentDID,
        delegationScope: { maxTransactionUsd: 100 },
      });
      seedAgentSelect(agent);
      seedComplianceInserts({ status: "REJECTED" });

      const res = await app.request("/api/v1/compliance/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...BASE_COMPLIANCE, amount: "200.00" }),
      });

      expect(res.status).toBe(201);
      const { data } = await res.json();
      expect(data.status).toBe("REJECTED");

      const delegationCheck = data.checks.find(
        (c: { checkType: string }) => c.checkType === "DELEGATION_SCOPE",
      );
      expect(delegationCheck).toBeDefined();
      expect(delegationCheck.result).toBe("FAILED");
    });

    it("should NOT include DELEGATION_SCOPE check when scope is satisfied", async () => {
      const agent = makeAgentRow({
        agentDid: BASE_COMPLIANCE.sender.agentDID,
        delegationScope: { maxTransactionUsd: 10000 },
      });
      seedAgentSelect(agent);
      seedComplianceInserts({ status: "APPROVED" });

      const res = await app.request("/api/v1/compliance/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...BASE_COMPLIANCE, amount: "50.00" }),
      });

      expect(res.status).toBe(201);
      const { data } = await res.json();
      const delegationCheck = data.checks.find(
        (c: { checkType: string }) => c.checkType === "DELEGATION_SCOPE",
      );
      expect(delegationCheck).toBeUndefined();
    });
  });
});
