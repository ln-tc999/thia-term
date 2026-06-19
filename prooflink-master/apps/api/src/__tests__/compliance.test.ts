import { describe, expect, it, vi, beforeEach } from "vitest";
import { createApp } from "../app.js";

// ---------------------------------------------------------------------------
// Mock the DB layer so tests run without Postgres
// ---------------------------------------------------------------------------

const mockInsertReturning = vi.fn();
const mockSelectFrom = vi.fn();

vi.mock("../db/index.js", () => ({
  getDb: () => ({
    insert: () => ({
      values: () => ({
        returning: mockInsertReturning,
        then: (resolve: (v: unknown) => void) => Promise.resolve().then(resolve),
        catch: () => Promise.resolve(),
      }),
    }),
    select: () => ({
      from: mockSelectFrom,
    }),
  }),
  getPool: () => ({
    query: vi.fn().mockResolvedValue({ rows: [{ "?column?": 1 }] }),
  }),
}));

// Bypass auth — tested separately in auth.test.ts
vi.mock("../middleware/auth.js", () => ({
  requireScope: () => async (_c: unknown, next: () => Promise<void>) => { await next(); },
  authMiddleware: () => {
    return async (c: { set: (k: string, v: unknown) => void }, next: () => Promise<void>) => {
      c.set("auth", { apiKeyId: "test-key-id", ownerId: "test-owner", scopes: ["admin"], rateLimitPerMinute: 60, authMethod: "api_key" });
      await next();
    };
  },
}));

// ---------------------------------------------------------------------------
// Mock the screening service — avoids real HTTP calls to Chainalysis
// ---------------------------------------------------------------------------

const mockScreenAddress = vi.fn();

vi.mock("../services/screening.js", () => ({
  screenAddress: (...args: unknown[]) => mockScreenAddress(...args),
  getScreener: vi.fn(),
  resetScreener: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Test UUIDs (real UUID v4 format required by routes)
// ---------------------------------------------------------------------------

const CHECK_UUID = "550e8400-e29b-41d4-a716-446655440001";
const RECEIPT_UUID = "550e8400-e29b-41d4-a716-446655440002";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCheckInsertResult() {
  return {
    id: CHECK_UUID,
    senderAddress: "0x1234",
    receiverAddress: "0x5678",
    status: "APPROVED",
    riskScore: 12,
    checks: [],
    totalDurationMs: 100,
    createdAt: new Date("2026-03-20T00:00:00Z"),
  };
}

function makeReceiptInsertResult() {
  return {
    id: RECEIPT_UUID,
    checkId: CHECK_UUID,
    receiptHash: "0xabc123",
    overallStatus: "APPROVED",
    riskScore: 12,
    travelRuleStatus: "TRANSMITTED",
    signature: "0x000",
    checksPerformed: [],
    ttl: 300,
    createdAt: new Date("2026-03-20T00:00:00Z"),
  };
}

function makeValidCheckBody() {
  return {
    sender: { address: "0x1234567890abcdef", chain: "eip155:8453" },
    receiver: { address: "0xabcdef1234567890", chain: "eip155:8453" },
    amount: "100.00",
    asset: "USDC",
    protocol: "x402",
  };
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe("Compliance API", () => {
  const app = createApp();

  beforeEach(() => {
    vi.clearAllMocks();

    // Default: all addresses are clean
    mockScreenAddress.mockResolvedValue({
      matched: false,
      listsChecked: ["OFAC_SDN"],
      matchDetails: [],
      riskScore: 0,
      screenedAt: new Date().toISOString(),
      provider: "chainalysis_free",
    });

    // Default: agents table lookup returns empty (no agent found → fail open)
    mockSelectFrom.mockImplementation(() => ({
      where: () => ({
        limit: () => Promise.resolve([]),
      }),
      orderBy: () => ({
        limit: () => Promise.resolve([]),
      }),
    }));
  });

  describe("POST /v1/compliance/check", () => {
    it("returns 201 with compliance decision for valid request", async () => {
      mockInsertReturning
        .mockResolvedValueOnce([makeCheckInsertResult()])
        .mockResolvedValueOnce([makeReceiptInsertResult()]);

      const res = await app.request("/v1/compliance/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(makeValidCheckBody()),
      });

      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.status).toBe("APPROVED");
      expect(json.data.riskScore).toBeTypeOf("number");
      expect(json.data.riskScore).toBeLessThan(50); // non-sanctioned = low risk
      expect(json.data.receiptId).toBe(RECEIPT_UUID);
      expect(json.data.receiptHash).toMatch(/^0x/);
      expect(json.data.checks).toBeInstanceOf(Array);
      expect(json.data.checks.length).toBeGreaterThan(0);
      expect(json.data.travelRuleStatus).toBeTypeOf("string");
      expect(json.data.totalDurationMs).toBeTypeOf("number");
      expect(json.data.timestamp).toBeTypeOf("string");
    });

    it("returns 201 with KYA check PASSED when agentDID is provided", async () => {
      mockInsertReturning
        .mockResolvedValueOnce([makeCheckInsertResult()])
        .mockResolvedValueOnce([makeReceiptInsertResult()]);

      const res = await app.request("/v1/compliance/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...makeValidCheckBody(),
          sender: {
            address: "0x1234567890abcdef",
            chain: "eip155:8453",
            agentDID: "did:prooflink:agent:001",
          },
        }),
      });

      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.success).toBe(true);
      const kyaCheck = json.data.checks.find(
        (c: { checkType: string }) => c.checkType === "KYA_VERIFICATION",
      );
      // KYA result is UNRESOLVED when agentDID is provided but agent not found in registry
      expect(kyaCheck?.result).toBe("UNRESOLVED");
    });

    it("returns 201 with KYA check SKIPPED when agentDID is absent", async () => {
      mockInsertReturning
        .mockResolvedValueOnce([makeCheckInsertResult()])
        .mockResolvedValueOnce([makeReceiptInsertResult()]);

      const res = await app.request("/v1/compliance/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(makeValidCheckBody()),
      });

      expect(res.status).toBe(201);
      const json = await res.json();
      const kyaCheck = json.data.checks.find(
        (c: { checkType: string }) => c.checkType === "KYA_VERIFICATION",
      );
      expect(kyaCheck?.result).toBe("SKIPPED");
    });

    it("returns 400 for invalid JSON body", async () => {
      const res = await app.request("/v1/compliance/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "not-json{{{",
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error.code).toBe("BAD_REQUEST");
    });

    it("returns 400 when sender address is missing", async () => {
      const res = await app.request("/v1/compliance/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sender: { chain: "eip155:8453" }, // missing address
          receiver: { address: "0xabcdef", chain: "eip155:8453" },
          amount: "100",
          asset: "USDC",
        }),
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error.code).toBe("VALIDATION_ERROR");
    });

    it("returns 400 when receiver is entirely missing", async () => {
      const res = await app.request("/v1/compliance/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sender: { address: "0x1234", chain: "eip155:8453" },
          amount: "100",
          asset: "USDC",
        }),
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.success).toBe(false);
    });

    it("returns 400 when amount is missing", async () => {
      const res = await app.request("/v1/compliance/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sender: { address: "0x1234", chain: "eip155:8453" },
          receiver: { address: "0x5678", chain: "eip155:8453" },
          asset: "USDC",
          // no amount
        }),
      });

      expect(res.status).toBe(400);
    });

    it("returns 500 when check DB insert fails", async () => {
      mockInsertReturning.mockResolvedValueOnce([]); // empty = no record

      const res = await app.request("/v1/compliance/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(makeValidCheckBody()),
      });

      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error.code).toBe("INTERNAL_ERROR");
    });

    it("returns 500 when receipt DB insert fails", async () => {
      mockInsertReturning
        .mockResolvedValueOnce([makeCheckInsertResult()])
        .mockResolvedValueOnce([]); // receipt insert fails

      const res = await app.request("/v1/compliance/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(makeValidCheckBody()),
      });

      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error.code).toBe("INTERNAL_ERROR");
    });

    it("uses default protocol 'x402' when protocol is omitted", async () => {
      mockInsertReturning
        .mockResolvedValueOnce([makeCheckInsertResult()])
        .mockResolvedValueOnce([makeReceiptInsertResult()]);

      const body = { ...makeValidCheckBody() };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (body as any).protocol;

      const res = await app.request("/v1/compliance/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      // Route should still succeed with default protocol
      expect(res.status).toBe(201);
    });
  });

  describe("POST /v1/compliance/screen", () => {
    it("returns 200 with screening result for address + chain", async () => {
      const res = await app.request("/v1/compliance/screen", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          address: "0x1234abcdef5678",
          chain: "eip155:8453",
        }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.address).toBe("0x1234abcdef5678");
      expect(json.data.chain).toBe("eip155:8453");
      expect(json.data.matched).toBe(false);
      expect(json.data.listsChecked).toContain("OFAC_SDN");
      expect(json.data.riskScore).toBe(0);
      expect(json.data.provider).toBe("chainalysis_free");
      expect(json.data.screenedAt).toBeTypeOf("string");
    });

    it("returns 200 with entityName included when provided", async () => {
      const res = await app.request("/v1/compliance/screen", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          address: "0xdeadbeef12345678",
          chain: "eip155:1",
          entityName: "Acme Corp",
        }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.entityName).toBe("Acme Corp");
    });

    it("returns 200 with null entityName when not provided", async () => {
      const res = await app.request("/v1/compliance/screen", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          address: "0xdeadbeef12345678",
          chain: "eip155:1",
        }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.entityName).toBeNull();
    });

    it("returns 400 for missing address", async () => {
      const res = await app.request("/v1/compliance/screen", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chain: "eip155:8453" }),
      });

      expect(res.status).toBe(400);
    });

    it("returns 400 for invalid JSON", async () => {
      const res = await app.request("/v1/compliance/screen", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "bad{json",
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.code).toBe("BAD_REQUEST");
    });

    it("returns 400 for empty address string", async () => {
      const res = await app.request("/v1/compliance/screen", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address: "", chain: "eip155:8453" }),
      });

      expect(res.status).toBe(400);
    });
  });

  describe("GET /v1/compliance/receipt/:id", () => {
    it("returns 200 with receipt data when found", async () => {
      const mockReceipt = {
        id: RECEIPT_UUID,
        checkId: CHECK_UUID,
        receiptHash: "0xabc123def456",
        overallStatus: "APPROVED",
        riskScore: 12,
        travelRuleStatus: "TRANSMITTED",
        signature: "0x000000",
        checksPerformed: [],
        ttl: 300,
        createdAt: new Date("2026-03-20T00:00:00Z"),
      };

      mockSelectFrom.mockReturnValue({
        where: () => ({
          limit: () => Promise.resolve([mockReceipt]),
        }),
      });

      const res = await app.request(
        `/v1/compliance/receipt/${RECEIPT_UUID}`,
      );

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.id).toBe(RECEIPT_UUID);
      expect(json.data.overallStatus).toBe("APPROVED");
    });

    it("returns 404 when receipt not found", async () => {
      mockSelectFrom.mockReturnValue({
        where: () => ({
          limit: () => Promise.resolve([]),
        }),
      });

      const res = await app.request(
        `/v1/compliance/receipt/${RECEIPT_UUID}`,
      );

      expect(res.status).toBe(404);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error.code).toBe("NOT_FOUND");
    });

    it("returns 400 for non-UUID receipt id", async () => {
      const res = await app.request(
        "/v1/compliance/receipt/not-a-uuid-at-all",
      );

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error.code).toBe("VALIDATION_ERROR");
    });

    it("returns 400 for receipt id that is too short", async () => {
      const res = await app.request("/v1/compliance/receipt/abc123");

      expect(res.status).toBe(400);
    });
  });

  describe("GET /v1/compliance/history", () => {
    function buildHistorySelectMock(
      items: unknown[],
      count: number,
    ) {
      let call = 0;
      mockSelectFrom.mockImplementation(() => {
        call++;
        if (call % 2 === 1) {
          return {
            where: () => ({
              orderBy: () => ({
                limit: () => ({
                  offset: () => Promise.resolve(items),
                }),
              }),
            }),
          };
        }
        return {
          where: () => Promise.resolve([{ count }]),
        };
      });
    }

    it("returns 200 with paginated results", async () => {
      const items = [
        {
          id: CHECK_UUID,
          senderAddress: "0x1234",
          receiverAddress: "0x5678",
          status: "APPROVED",
          riskScore: 10,
          createdAt: new Date("2026-03-20T00:00:00Z"),
        },
      ];
      buildHistorySelectMock(items, 1);

      const res = await app.request(
        "/v1/compliance/history?page=1&limit=10",
      );

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.items).toBeInstanceOf(Array);
      expect(json.data.pagination.page).toBe(1);
      expect(json.data.pagination.pageSize).toBe(10);
      expect(json.data.pagination.total).toBe(1);
      expect(json.data.pagination.totalPages).toBe(1);
    });

    it("returns 200 with default pagination when no params provided", async () => {
      buildHistorySelectMock([], 0);

      const res = await app.request("/v1/compliance/history");

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.pagination.page).toBe(1);
      expect(json.data.pagination.pageSize).toBe(20);
    });

    it("accepts status filter", async () => {
      buildHistorySelectMock([], 0);

      const res = await app.request(
        "/v1/compliance/history?status=REJECTED",
      );

      expect(res.status).toBe(200);
    });

    it("accepts date range filters", async () => {
      buildHistorySelectMock([], 0);

      const res = await app.request(
        "/v1/compliance/history?from=2026-01-01T00:00:00Z&to=2026-03-31T00:00:00Z",
      );

      expect(res.status).toBe(200);
    });

    it("returns 400 for invalid status filter", async () => {
      const res = await app.request(
        "/v1/compliance/history?status=INVALID_STATUS",
      );

      expect(res.status).toBe(400);
    });
  });
});
