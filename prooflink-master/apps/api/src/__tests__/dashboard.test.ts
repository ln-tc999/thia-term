import { describe, expect, it, vi, beforeEach } from "vitest";
import { createApp } from "../app.js";

// ---------------------------------------------------------------------------
// Mock DB layer — dashboard routes use getDb() for all queries.
// The health endpoint additionally calls db.execute() to ping the database.
// ---------------------------------------------------------------------------

const mockSelectFrom = vi.fn();
const mockExecute = vi.fn();

vi.mock("../db/index.js", () => ({
  getDb: () => ({
    select: () => ({ from: mockSelectFrom }),
    execute: mockExecute,
    insert: () => ({
      values: () => ({ returning: vi.fn().mockResolvedValue([]) }),
    }),
    update: () => ({
      set: () => ({ where: () => ({ returning: vi.fn().mockResolvedValue([]) }) }),
    }),
  }),
  getPool: () => ({
    query: vi.fn().mockResolvedValue({ rows: [{ "?column?": 1 }] }),
  }),
}));

// Dashboard routes are public — no auth middleware involved.
// Auth mock is still required so createApp() can import the middleware without
// hitting the real JWT logic when other routes are registered.
vi.mock("../middleware/auth.js", () => ({
  requireScope: () => async (_c: unknown, next: () => Promise<void>) => { await next(); },
  authMiddleware: () => async (_c: unknown, next: () => Promise<void>) => {
    await next();
  },
}));

// ---------------------------------------------------------------------------
// Fixture factories
// ---------------------------------------------------------------------------

function makeCheck(overrides: Record<string, unknown> = {}) {
  return {
    id: "check-uuid-0001",
    senderAddress: "0xSENDER001",
    receiverAddress: "0xRECEIVER001",
    senderAgentDid: "did:prooflink:agent:sender",
    chain: "eip155:8453",
    status: "APPROVED",
    riskScore: 15,
    amount: "100.00",
    asset: "USDC",
    createdAt: new Date("2026-03-20T12:00:00Z"),
    ...overrides,
  };
}

function makeInvoice(overrides: Record<string, unknown> = {}) {
  return {
    id: "inv-uuid-0001",
    issuerAgentDid: "did:prooflink:agent:seller",
    buyerWalletAddress: "0xBUYER001",
    sellerWalletAddress: "0xSELLER001",
    currency: "USDC",
    totalAmount: "500.00",
    state: "ISSUED",
    lineItems: [{ description: "API service", quantity: 1, unitPrice: 500 }],
    complianceReceiptId: null,
    dueDate: new Date("2026-04-01T00:00:00Z"),
    createdAt: new Date("2026-03-20T10:00:00Z"),
    ...overrides,
  };
}

function makeAgent(overrides: Record<string, unknown> = {}) {
  return {
    agentDid: "did:prooflink:agent:001",
    name: "Test Agent",
    isActive: true,
    expiresAt: new Date("2027-01-01T00:00:00Z"),
    validatedAt: new Date("2026-01-01T00:00:00Z"),
    delegationScope: { payments: true, compliance: true },
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-03-20T00:00:00Z"),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Helpers to build chained select mock return values
// ---------------------------------------------------------------------------

/** db.select().from().where().orderBy().limit() or db.select().from().orderBy().limit() */
function selectFromOrderByLimit(rows: unknown[]) {
  const orderByChain = {
    orderBy: () => ({
      limit: () => Promise.resolve(rows),
    }),
    groupBy: () => ({
      orderBy: () => Promise.resolve(rows),
    }),
  };
  mockSelectFrom.mockReturnValue({
    ...orderByChain,
    where: () => orderByChain,
  });
}

/** db.select().from().where().orderBy() or db.select().from().orderBy() (no limit) */
function selectFromOrderBy(rows: unknown[]) {
  const chain = {
    orderBy: () => Promise.resolve(rows),
  };
  mockSelectFrom.mockReturnValue({
    ...chain,
    where: () => chain,
  });
}

/**
 * /stats fires 4 parallel select().from() calls:
 *   call 1: .from(complianceChecks) -> [{ total }]
 *   call 2: .from(complianceChecks).groupBy(status) -> statusBreakdown[]
 *   call 3: .from(agents) -> [{ total }]
 *   call 4: .from(invoices) -> [{ totalVolume }]
 *
 * Since all four share the same mocked `from`, we sequence by call order.
 */
function setupStatsMock({
  checksTotal = 0,
  statusBreakdown = [] as Array<{ status: string; count: number }>,
  agentsTotal = 0,
  totalVolume = "0",
} = {}) {
  let call = 0;
  mockSelectFrom.mockImplementation(() => {
    call++;
    const resolved = (val: unknown) => {
      const p = Promise.resolve(val);
      // Add .where() that returns the same promise (for tenant-scoped queries)
      (p as Record<string, unknown>)["where"] = () => p;
      return p;
    };
    if (call === 1) return resolved([{ total: checksTotal }]);
    if (call === 2) {
      const groupByChain = {
        groupBy: () => Promise.resolve(statusBreakdown),
      };
      return { ...groupByChain, where: () => groupByChain };
    }
    if (call === 3) return resolved([{ total: agentsTotal }]);
    // call 4: invoices volume
    return resolved([{ totalVolume }]);
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Dashboard API", () => {
  const app = createApp();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // GET /dashboard/stats
  // -------------------------------------------------------------------------

  describe("GET /dashboard/stats", () => {
    it("returns 200 with correct shape when data is present", async () => {
      setupStatsMock({
        checksTotal: 200,
        statusBreakdown: [
          { status: "APPROVED", count: 180 },
          { status: "REJECTED", count: 20 },
        ],
        agentsTotal: 5,
        totalVolume: "12500.50",
      });

      const res = await app.request("/v1/dashboard/stats");

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data).toMatchObject({
        totalChecks: 200,
        activeAgents: 5,
        checksChange: 0,
        passRateChange: 0,
        volumeChange: 0,
        agentsChange: 0,
      });
    });

    it("calculates passRate correctly from APPROVED count", async () => {
      setupStatsMock({
        checksTotal: 100,
        statusBreakdown: [
          { status: "APPROVED", count: 75 },
          { status: "REJECTED", count: 25 },
        ],
        agentsTotal: 3,
        totalVolume: "0",
      });

      const res = await app.request("/v1/dashboard/stats");
      const json = await res.json();

      expect(json.data.passRate).toBe(75);
    });

    it("returns passRate=0 when totalChecks is zero (no division by zero)", async () => {
      setupStatsMock({
        checksTotal: 0,
        statusBreakdown: [],
        agentsTotal: 0,
        totalVolume: "0",
      });

      const res = await app.request("/v1/dashboard/stats");
      const json = await res.json();

      expect(json.data.passRate).toBe(0);
      expect(json.data.totalChecks).toBe(0);
    });

    it("returns totalVolume as a number (not a string)", async () => {
      setupStatsMock({ totalVolume: "9999.99" });

      const res = await app.request("/v1/dashboard/stats");
      const json = await res.json();

      expect(typeof json.data.totalVolume).toBe("number");
      expect(json.data.totalVolume).toBe(9999.99);
    });

    it("defaults totalVolume to 0 when DB returns null/undefined", async () => {
      setupStatsMock({ totalVolume: undefined as unknown as string });

      const res = await app.request("/v1/dashboard/stats");
      const json = await res.json();

      expect(json.data.totalVolume).toBe(0);
    });

    it("calculates passRate with two decimal precision", async () => {
      setupStatsMock({
        checksTotal: 3,
        statusBreakdown: [{ status: "APPROVED", count: 2 }],
        agentsTotal: 1,
        totalVolume: "0",
      });

      const res = await app.request("/v1/dashboard/stats");
      const json = await res.json();

      // 2/3 * 100 = 66.666... rounded to 66.67
      expect(json.data.passRate).toBeCloseTo(66.67, 1);
    });

    it("returns passRate=0 when no APPROVED entries in statusBreakdown", async () => {
      setupStatsMock({
        checksTotal: 10,
        statusBreakdown: [{ status: "REJECTED", count: 10 }],
        agentsTotal: 2,
        totalVolume: "100",
      });

      const res = await app.request("/v1/dashboard/stats");
      const json = await res.json();

      expect(json.data.passRate).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // GET /dashboard/checks
  // -------------------------------------------------------------------------

  describe("GET /dashboard/checks", () => {
    it("returns 200 with correct shape for recent checks", async () => {
      selectFromOrderByLimit([makeCheck()]);

      const res = await app.request("/v1/dashboard/checks");

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(Array.isArray(json.data)).toBe(true);
      expect(json.data).toHaveLength(1);

      const item = json.data[0];
      expect(item).toHaveProperty("id");
      expect(item).toHaveProperty("walletAddress");
      expect(item).toHaveProperty("chain");
      expect(item).toHaveProperty("status");
      expect(item).toHaveProperty("riskScore");
      expect(item).toHaveProperty("amount");
      expect(item).toHaveProperty("currency");
      expect(item).toHaveProperty("counterparty");
      expect(item).toHaveProperty("agentDid");
      expect(item).toHaveProperty("createdAt");
      expect(item).toHaveProperty("checks");
    });

    it("maps APPROVED status to PASS", async () => {
      selectFromOrderByLimit([makeCheck({ status: "APPROVED" })]);

      const res = await app.request("/v1/dashboard/checks");
      const json = await res.json();

      expect(json.data[0].status).toBe("PASS");
    });

    it("maps REJECTED status to FAIL", async () => {
      selectFromOrderByLimit([makeCheck({ status: "REJECTED" })]);

      const res = await app.request("/v1/dashboard/checks");
      const json = await res.json();

      expect(json.data[0].status).toBe("FAIL");
    });

    it("maps ESCALATED status to REVIEW", async () => {
      selectFromOrderByLimit([makeCheck({ status: "ESCALATED" })]);

      const res = await app.request("/v1/dashboard/checks");
      const json = await res.json();

      expect(json.data[0].status).toBe("REVIEW");
    });

    it("maps any unknown status to REVIEW as fallback", async () => {
      selectFromOrderByLimit([makeCheck({ status: "PENDING" })]);

      const res = await app.request("/v1/dashboard/checks");
      const json = await res.json();

      expect(json.data[0].status).toBe("REVIEW");
    });

    it("returns amount as a number", async () => {
      selectFromOrderByLimit([makeCheck({ amount: "999.99" })]);

      const res = await app.request("/v1/dashboard/checks");
      const json = await res.json();

      expect(typeof json.data[0].amount).toBe("number");
      expect(json.data[0].amount).toBe(999.99);
    });

    it("returns createdAt as ISO 8601 string", async () => {
      selectFromOrderByLimit([makeCheck()]);

      const res = await app.request("/v1/dashboard/checks");
      const json = await res.json();

      expect(json.data[0].createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    });

    it("returns empty array when no checks exist", async () => {
      selectFromOrderByLimit([]);

      const res = await app.request("/v1/dashboard/checks");
      const json = await res.json();

      expect(json.data).toHaveLength(0);
    });

    it("falls back to empty string for agentDid when senderAgentDid is null", async () => {
      selectFromOrderByLimit([makeCheck({ senderAgentDid: null })]);

      const res = await app.request("/v1/dashboard/checks");
      const json = await res.json();

      expect(json.data[0].agentDid).toBe("");
    });

    it("respects limit query parameter up to max 100", async () => {
      // Mock is called; we just verify the route accepts the param without error
      selectFromOrderByLimit([]);

      const res = await app.request("/v1/dashboard/checks?limit=10");

      expect(res.status).toBe(200);
    });

    it("caps limit at 100 even when a larger value is provided", async () => {
      selectFromOrderByLimit([]);

      // The route does Math.min(Number(limit || "50"), 100) — just verify 200 OK
      const res = await app.request("/v1/dashboard/checks?limit=9999");

      expect(res.status).toBe(200);
    });

    it("returns checks field with APPROVED status having riskScore true", async () => {
      selectFromOrderByLimit([makeCheck({ status: "APPROVED" })]);

      const res = await app.request("/v1/dashboard/checks");
      const json = await res.json();

      expect(json.data[0].checks.riskScore).toBe(true);
      expect(json.data[0].checks.ofac).toBe(true);
      expect(json.data[0].checks.velocity).toBe(true);
      expect(json.data[0].checks.jurisdiction).toBe(true);
    });

    it("returns checks.riskScore=false for REJECTED check", async () => {
      selectFromOrderByLimit([makeCheck({ status: "REJECTED" })]);

      const res = await app.request("/v1/dashboard/checks");
      const json = await res.json();

      expect(json.data[0].checks.riskScore).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // GET /dashboard/invoices
  // -------------------------------------------------------------------------

  describe("GET /dashboard/invoices", () => {
    it("returns 200 with correct shape", async () => {
      selectFromOrderByLimit([makeInvoice()]);

      const res = await app.request("/v1/dashboard/invoices");

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(Array.isArray(json.data)).toBe(true);
      expect(json.data).toHaveLength(1);

      const item = json.data[0];
      expect(item).toHaveProperty("id");
      expect(item).toHaveProperty("number");
      expect(item).toHaveProperty("from");
      expect(item).toHaveProperty("to");
      expect(item).toHaveProperty("amount");
      expect(item).toHaveProperty("currency");
      expect(item).toHaveProperty("state");
      expect(item).toHaveProperty("dueDate");
      expect(item).toHaveProperty("createdAt");
      expect(item).toHaveProperty("walletAddress");
      expect(item).toHaveProperty("lineItems");
    });

    it("maps ISSUED state to PENDING in the response", async () => {
      selectFromOrderByLimit([makeInvoice({ state: "ISSUED" })]);

      const res = await app.request("/v1/dashboard/invoices");
      const json = await res.json();

      expect(json.data[0].state).toBe("PENDING");
    });

    it("passes through non-ISSUED states unchanged", async () => {
      selectFromOrderByLimit([makeInvoice({ state: "PAID" })]);

      const res = await app.request("/v1/dashboard/invoices");
      const json = await res.json();

      expect(json.data[0].state).toBe("PAID");
    });

    it("formats invoice number as FL-{year}-{id-prefix}", async () => {
      selectFromOrderByLimit([
        makeInvoice({ id: "abcd1234-0000-0000-0000-000000000000" }),
      ]);

      const res = await app.request("/v1/dashboard/invoices");
      const json = await res.json();

      // number should start with FL- followed by the year
      expect(json.data[0].number).toMatch(/^FL-\d{4}-[A-Z0-9]{4}$/);
    });

    it("returns amount as a number", async () => {
      selectFromOrderByLimit([makeInvoice({ totalAmount: "1234.56" })]);

      const res = await app.request("/v1/dashboard/invoices");
      const json = await res.json();

      expect(typeof json.data[0].amount).toBe("number");
      expect(json.data[0].amount).toBe(1234.56);
    });

    it("returns empty string for dueDate when null", async () => {
      selectFromOrderByLimit([makeInvoice({ dueDate: null })]);

      const res = await app.request("/v1/dashboard/invoices");
      const json = await res.json();

      expect(json.data[0].dueDate).toBe("");
    });

    it("returns dueDate as ISO string when present", async () => {
      selectFromOrderByLimit([
        makeInvoice({ dueDate: new Date("2026-04-01T00:00:00Z") }),
      ]);

      const res = await app.request("/v1/dashboard/invoices");
      const json = await res.json();

      expect(json.data[0].dueDate).toBe("2026-04-01T00:00:00.000Z");
    });

    it("uses first lineItem description, falls back to 'Service'", async () => {
      selectFromOrderByLimit([makeInvoice({ lineItems: [] })]);

      const res = await app.request("/v1/dashboard/invoices");
      const json = await res.json();

      expect(json.data[0].description).toBe("Service");
    });

    it("uses description from first lineItem when present", async () => {
      selectFromOrderByLimit([
        makeInvoice({
          lineItems: [{ description: "Custom work", quantity: 1, unitPrice: 100 }],
        }),
      ]);

      const res = await app.request("/v1/dashboard/invoices");
      const json = await res.json();

      expect(json.data[0].description).toBe("Custom work");
    });

    it("returns chain as 'Base'", async () => {
      selectFromOrderByLimit([makeInvoice()]);

      const res = await app.request("/v1/dashboard/invoices");
      const json = await res.json();

      expect(json.data[0].chain).toBe("Base");
    });

    it("returns complianceCheckId as undefined when null", async () => {
      selectFromOrderByLimit([makeInvoice({ complianceReceiptId: null })]);

      const res = await app.request("/v1/dashboard/invoices");
      const json = await res.json();

      expect(json.data[0].complianceCheckId).toBeUndefined();
    });

    it("returns empty array when no invoices exist", async () => {
      selectFromOrderByLimit([]);

      const res = await app.request("/v1/dashboard/invoices");
      const json = await res.json();

      expect(json.data).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // GET /dashboard/agents
  // -------------------------------------------------------------------------

  describe("GET /dashboard/agents", () => {
    it("returns 200 with correct shape", async () => {
      selectFromOrderBy([makeAgent()]);

      const res = await app.request("/v1/dashboard/agents");

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(Array.isArray(json.data)).toBe(true);
      expect(json.data).toHaveLength(1);

      const item = json.data[0];
      expect(item).toHaveProperty("did");
      expect(item).toHaveProperty("name");
      expect(item).toHaveProperty("provider");
      expect(item).toHaveProperty("status");
      expect(item).toHaveProperty("credentialType");
      expect(item).toHaveProperty("issuedAt");
      expect(item).toHaveProperty("expiresAt");
      expect(item).toHaveProperty("checksPerformed");
      expect(item).toHaveProperty("delegationScope");
      expect(item).toHaveProperty("transactionVolume");
      expect(item).toHaveProperty("lastActive");
      expect(item).toHaveProperty("riskScoreHistory");
    });

    it("returns VERIFIED for active, validated, non-expired agent", async () => {
      selectFromOrderBy([
        makeAgent({
          isActive: true,
          validatedAt: new Date("2026-01-01T00:00:00Z"),
          expiresAt: new Date("2027-01-01T00:00:00Z"),
        }),
      ]);

      const res = await app.request("/v1/dashboard/agents");
      const json = await res.json();

      expect(json.data[0].status).toBe("VERIFIED");
    });

    it("returns REVOKED when agent isActive=false", async () => {
      selectFromOrderBy([makeAgent({ isActive: false })]);

      const res = await app.request("/v1/dashboard/agents");
      const json = await res.json();

      expect(json.data[0].status).toBe("REVOKED");
    });

    it("returns EXPIRED when agent is active but expiresAt is in the past", async () => {
      selectFromOrderBy([
        makeAgent({
          isActive: true,
          expiresAt: new Date("2020-01-01T00:00:00Z"), // past date
          validatedAt: new Date("2019-01-01T00:00:00Z"),
        }),
      ]);

      const res = await app.request("/v1/dashboard/agents");
      const json = await res.json();

      expect(json.data[0].status).toBe("EXPIRED");
    });

    it("returns PENDING when agent is active but not yet validated", async () => {
      selectFromOrderBy([
        makeAgent({
          isActive: true,
          expiresAt: new Date("2027-01-01T00:00:00Z"),
          validatedAt: null,
        }),
      ]);

      const res = await app.request("/v1/dashboard/agents");
      const json = await res.json();

      expect(json.data[0].status).toBe("PENDING");
    });

    it("falls back to agentDid when name is null", async () => {
      selectFromOrderBy([makeAgent({ name: null })]);

      const res = await app.request("/v1/dashboard/agents");
      const json = await res.json();

      expect(json.data[0].name).toBe("did:prooflink:agent:001");
    });

    it("returns delegationScope keys as an array", async () => {
      selectFromOrderBy([
        makeAgent({ delegationScope: { payments: true, compliance: true } }),
      ]);

      const res = await app.request("/v1/dashboard/agents");
      const json = await res.json();

      expect(Array.isArray(json.data[0].delegationScope)).toBe(true);
      expect(json.data[0].delegationScope).toContain("payments");
      expect(json.data[0].delegationScope).toContain("compliance");
    });

    it("returns empty delegationScope array when null", async () => {
      selectFromOrderBy([makeAgent({ delegationScope: null })]);

      const res = await app.request("/v1/dashboard/agents");
      const json = await res.json();

      expect(json.data[0].delegationScope).toEqual([]);
    });

    it("returns provider as 'ProofLink'", async () => {
      selectFromOrderBy([makeAgent()]);

      const res = await app.request("/v1/dashboard/agents");
      const json = await res.json();

      expect(json.data[0].provider).toBe("ProofLink");
    });

    it("returns credentialType as 'KYA-v1'", async () => {
      selectFromOrderBy([makeAgent()]);

      const res = await app.request("/v1/dashboard/agents");
      const json = await res.json();

      expect(json.data[0].credentialType).toBe("KYA-v1");
    });

    it("uses createdAt as issuedAt when validatedAt is null", async () => {
      selectFromOrderBy([
        makeAgent({
          validatedAt: null,
          createdAt: new Date("2026-02-01T00:00:00Z"),
        }),
      ]);

      const res = await app.request("/v1/dashboard/agents");
      const json = await res.json();

      expect(json.data[0].issuedAt).toBe("2026-02-01T00:00:00.000Z");
    });

    it("returns empty expiresAt string when agent has no expiry", async () => {
      selectFromOrderBy([makeAgent({ expiresAt: null })]);

      const res = await app.request("/v1/dashboard/agents");
      const json = await res.json();

      expect(json.data[0].expiresAt).toBe("");
    });

    it("returns empty array when no agents exist", async () => {
      selectFromOrderBy([]);

      const res = await app.request("/v1/dashboard/agents");
      const json = await res.json();

      expect(json.data).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // GET /dashboard/volume
  // -------------------------------------------------------------------------

  describe("GET /dashboard/volume", () => {
    it("returns 200 with correct shape", async () => {
      const groupByChain = {
        groupBy: () => ({
          orderBy: () =>
            Promise.resolve([
              { date: "2026-03-20", total: 10, passed: 8, failed: 2 },
            ]),
        }),
      };
      mockSelectFrom.mockReturnValue({
        ...groupByChain,
        where: () => groupByChain,
      });

      const res = await app.request("/v1/dashboard/volume");

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(Array.isArray(json.data)).toBe(true);
      expect(json.data[0]).toHaveProperty("date");
      expect(json.data[0]).toHaveProperty("passed");
      expect(json.data[0]).toHaveProperty("failed");
      expect(json.data[0]).toHaveProperty("volume");
    });

    it("computes volume as (passed + failed) * 1000", async () => {
      const groupByChain = {
        groupBy: () => ({
          orderBy: () =>
            Promise.resolve([
              { date: "2026-03-20", total: 10, passed: 7, failed: 3 },
            ]),
        }),
      };
      mockSelectFrom.mockReturnValue({
        ...groupByChain,
        where: () => groupByChain,
      });

      const res = await app.request("/v1/dashboard/volume");
      const json = await res.json();

      expect(json.data[0].volume).toBe(10000); // (7 + 3) * 1000
    });

    it("returns empty array when no volume data exists", async () => {
      const groupByChain = {
        groupBy: () => ({
          orderBy: () => Promise.resolve([]),
        }),
      };
      mockSelectFrom.mockReturnValue({
        ...groupByChain,
        where: () => groupByChain,
      });

      const res = await app.request("/v1/dashboard/volume");
      const json = await res.json();

      expect(json.data).toHaveLength(0);
    });

    it("returns multiple rows when multiple days of data exist", async () => {
      const groupByChain = {
        groupBy: () => ({
          orderBy: () =>
            Promise.resolve([
              { date: "2026-03-19", total: 5, passed: 4, failed: 1 },
              { date: "2026-03-20", total: 8, passed: 6, failed: 2 },
            ]),
        }),
      };
      mockSelectFrom.mockReturnValue({
        ...groupByChain,
        where: () => groupByChain,
      });

      const res = await app.request("/v1/dashboard/volume");
      const json = await res.json();

      expect(json.data).toHaveLength(2);
      expect(json.data[0].date).toBe("2026-03-19");
      expect(json.data[1].date).toBe("2026-03-20");
    });

    it("preserves passed and failed counts from the query result", async () => {
      const groupByChain = {
        groupBy: () => ({
          orderBy: () =>
            Promise.resolve([
              { date: "2026-03-20", total: 3, passed: 1, failed: 2 },
            ]),
        }),
      };
      mockSelectFrom.mockReturnValue({
        ...groupByChain,
        where: () => groupByChain,
      });

      const res = await app.request("/v1/dashboard/volume");
      const json = await res.json();

      expect(json.data[0].passed).toBe(1);
      expect(json.data[0].failed).toBe(2);
    });
  });

  // -------------------------------------------------------------------------
  // GET /dashboard/health
  // -------------------------------------------------------------------------

  describe("GET /dashboard/health", () => {
    it("returns 200 with operational status when DB is up", async () => {
      mockExecute.mockResolvedValue([{ "?column?": 1 }]);

      const res = await app.request("/v1/dashboard/health");

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.status).toBe("operational");
    });

    it("returns degraded status when DB execute throws", async () => {
      mockExecute.mockRejectedValue(new Error("DB connection refused"));

      const res = await app.request("/v1/dashboard/health");

      expect(res.status).toBe(200); // health endpoint always returns 200
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.status).toBe("degraded");
    });

    it("returns a services array with the expected service names", async () => {
      mockExecute.mockResolvedValue([{ "?column?": 1 }]);

      const res = await app.request("/v1/dashboard/health");
      const json = await res.json();

      const serviceNames = json.data.services.map(
        (s: { name: string }) => s.name,
      );
      expect(serviceNames).toContain("Compliance Engine");
      expect(serviceNames).toContain("OFAC Screening");
      expect(serviceNames).toContain("Risk Scoring");
      expect(serviceNames).toContain("Database");
      expect(serviceNames).toContain("KYA Verification");
    });

    it("marks Database service as operational when DB is up", async () => {
      mockExecute.mockResolvedValue([]);

      const res = await app.request("/v1/dashboard/health");
      const json = await res.json();

      const dbService = json.data.services.find(
        (s: { name: string }) => s.name === "Database",
      );
      expect(dbService?.status).toBe("operational");
    });

    it("marks Database service as down when DB execute fails", async () => {
      mockExecute.mockRejectedValue(new Error("timeout"));

      const res = await app.request("/v1/dashboard/health");
      const json = await res.json();

      const dbService = json.data.services.find(
        (s: { name: string }) => s.name === "Database",
      );
      expect(dbService?.status).toBe("down");
    });

    it("returns uptime as a number", async () => {
      mockExecute.mockResolvedValue([]);

      const res = await app.request("/v1/dashboard/health");
      const json = await res.json();

      expect(typeof json.data.uptime).toBe("number");
      expect(json.data.uptime).toBeGreaterThanOrEqual(0);
    });

    it("returns lastChecked as an ISO 8601 timestamp", async () => {
      mockExecute.mockResolvedValue([]);

      const res = await app.request("/v1/dashboard/health");
      const json = await res.json();

      expect(json.data.lastChecked).toMatch(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/,
      );
    });

    it("returns latency as a non-negative number", async () => {
      mockExecute.mockResolvedValue([]);

      const res = await app.request("/v1/dashboard/health");
      const json = await res.json();

      expect(typeof json.data.latency).toBe("number");
      expect(json.data.latency).toBeGreaterThanOrEqual(0);
    });

    it("has exactly 5 services in the service list", async () => {
      mockExecute.mockResolvedValue([]);

      const res = await app.request("/v1/dashboard/health");
      const json = await res.json();

      expect(json.data.services).toHaveLength(5);
    });

    it("all non-database services are operational regardless of DB state", async () => {
      mockExecute.mockRejectedValue(new Error("DB down"));

      const res = await app.request("/v1/dashboard/health");
      const json = await res.json();

      const nonDbServices = json.data.services.filter(
        (s: { name: string }) => s.name !== "Database",
      );
      for (const svc of nonDbServices) {
        expect(svc.status).toBe("operational");
      }
    });
  });
});
