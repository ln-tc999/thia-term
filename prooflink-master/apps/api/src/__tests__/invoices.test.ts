import { describe, expect, it, vi, beforeEach } from "vitest";
import { createApp } from "../app.js";

// ---------------------------------------------------------------------------
// Mock DB
// ---------------------------------------------------------------------------

const mockInsertReturning = vi.fn();
const mockSelectFrom = vi.fn();
const mockUpdateReturning = vi.fn();

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
          returning: mockUpdateReturning,
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

const INVOICE_UUID = "550e8400-e29b-41d4-a716-446655440010";

const sampleInvoice = {
  id: INVOICE_UUID,
  issuerAgentDid: "did:prooflink:agent:seller",
  recipientAgentDid: "did:prooflink:agent:buyer",
  sellerWalletAddress: "0xSELLER123",
  buyerWalletAddress: "0xBUYER456",
  currency: "USDC",
  totalAmount: "250.00",
  state: "DRAFT",
  lineItems: [
    { description: "API calls", quantity: 1000, unit: "call", unitPrice: 0.25, total: 250 },
  ],
  paymentProtocol: "x402",
  invoiceData: {},
  createdAt: new Date("2026-03-20T00:00:00Z"),
  updatedAt: new Date("2026-03-20T00:00:00Z"),
};

function validCreateBody() {
  return {
    seller: {
      walletAddress: "0xSELLER123",
      agentId: "did:prooflink:agent:seller",
    },
    buyer: {
      walletAddress: "0xBUYER456",
      agentId: "did:prooflink:agent:buyer",
    },
    lineItems: [
      { description: "API calls", quantity: 1000, unit: "call", unitPrice: 0.25, total: 250 },
    ],
    currency: "USDC",
    totalAmount: 250,
    paymentProtocol: "x402",
  };
}

function buildListSelectMock(items: unknown[], count: number) {
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Invoice API", () => {
  const app = createApp();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("POST /v1/invoices", () => {
    it("returns 201 with created invoice for valid request", async () => {
      mockInsertReturning.mockResolvedValue([sampleInvoice]);

      const res = await app.request("/v1/invoices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(validCreateBody()),
      });

      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.id).toBe(INVOICE_UUID);
      expect(json.data.state).toBe("DRAFT");
      expect(json.data.currency).toBe("USDC");
    });

    it("uses walletAddress as issuerDid when agentId is absent", async () => {
      mockInsertReturning.mockResolvedValue([
        { ...sampleInvoice, issuerAgentDid: "0xSELLER123" },
      ]);

      const body = {
        ...validCreateBody(),
        seller: { walletAddress: "0xSELLER123" }, // no agentId
      };

      const res = await app.request("/v1/invoices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      expect(res.status).toBe(201);
    });

    it("returns 400 for missing buyer", async () => {
      const res = await app.request("/v1/invoices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          seller: { walletAddress: "0xSELLER" },
          // missing buyer, lineItems, currency, totalAmount
        }),
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error.code).toBe("VALIDATION_ERROR");
    });

    it("returns 400 for empty lineItems array", async () => {
      const res = await app.request("/v1/invoices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          seller: { walletAddress: "0xSELLER" },
          buyer: { walletAddress: "0xBUYER" },
          lineItems: [],
          currency: "USDC",
          totalAmount: 0,
        }),
      });

      expect(res.status).toBe(400);
    });

    it("returns 400 for invalid currency", async () => {
      const res = await app.request("/v1/invoices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...validCreateBody(),
          currency: "DOGE",
        }),
      });

      expect(res.status).toBe(400);
    });

    it("returns 400 for negative totalAmount", async () => {
      const res = await app.request("/v1/invoices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...validCreateBody(),
          totalAmount: -100,
        }),
      });

      expect(res.status).toBe(400);
    });

    it("returns 400 for invalid JSON body", async () => {
      const res = await app.request("/v1/invoices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{invalid json{{",
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.code).toBe("BAD_REQUEST");
    });

    it("returns 500 when DB insert fails", async () => {
      mockInsertReturning.mockResolvedValue([]);

      const res = await app.request("/v1/invoices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(validCreateBody()),
      });

      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.error.code).toBe("INTERNAL_ERROR");
    });

    it("accepts optional dueDate in ISO 8601 format", async () => {
      mockInsertReturning.mockResolvedValue([sampleInvoice]);

      const res = await app.request("/v1/invoices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...validCreateBody(),
          dueDate: "2026-04-01T00:00:00Z",
        }),
      });

      expect(res.status).toBe(201);
    });

    it("accepts zero totalAmount (free service)", async () => {
      mockInsertReturning.mockResolvedValue([
        { ...sampleInvoice, totalAmount: "0" },
      ]);

      const res = await app.request("/v1/invoices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...validCreateBody(),
          lineItems: [
            { description: "Free tier", quantity: 1, unit: "unit", unitPrice: 0, total: 0 },
          ],
          totalAmount: 0,
        }),
      });

      expect(res.status).toBe(201);
    });
  });

  describe("GET /v1/invoices/:id", () => {
    it("returns 200 when invoice exists", async () => {
      mockSelectFrom.mockReturnValue({
        where: () => ({
          limit: () => Promise.resolve([sampleInvoice]),
        }),
      });

      const res = await app.request(`/v1/invoices/${INVOICE_UUID}`);

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.id).toBe(INVOICE_UUID);
      expect(json.data.state).toBe("DRAFT");
    });

    it("returns 404 when invoice not found", async () => {
      mockSelectFrom.mockReturnValue({
        where: () => ({
          limit: () => Promise.resolve([]),
        }),
      });

      const res = await app.request(`/v1/invoices/${INVOICE_UUID}`);

      expect(res.status).toBe(404);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error.code).toBe("NOT_FOUND");
    });

    it("returns 400 for non-UUID invoice id", async () => {
      const res = await app.request("/v1/invoices/not-a-valid-uuid");

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.code).toBe("VALIDATION_ERROR");
    });

    it("returns 400 for short numeric id", async () => {
      const res = await app.request("/v1/invoices/12345");

      expect(res.status).toBe(400);
    });
  });

  describe("PATCH /v1/invoices/:id/state", () => {
    it("returns 200 for valid state transition DRAFT -> ISSUED", async () => {
      mockSelectFrom.mockReturnValue({
        where: () => ({
          limit: () => Promise.resolve([{ ...sampleInvoice, state: "DRAFT" }]),
        }),
      });
      mockUpdateReturning.mockResolvedValue([{ ...sampleInvoice, state: "ISSUED" }]);

      const res = await app.request(`/v1/invoices/${INVOICE_UUID}/state`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ state: "ISSUED" }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.state).toBe("ISSUED");
    });

    it("returns 200 for valid state transition ISSUED -> PAID", async () => {
      mockSelectFrom.mockReturnValue({
        where: () => ({
          limit: () => Promise.resolve([{ ...sampleInvoice, state: "ISSUED" }]),
        }),
      });
      mockUpdateReturning.mockResolvedValue([{ ...sampleInvoice, state: "PAID" }]);

      const res = await app.request(`/v1/invoices/${INVOICE_UUID}/state`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ state: "PAID" }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.state).toBe("PAID");
    });

    it("returns 200 for valid state transition DRAFT -> CANCELLED", async () => {
      mockSelectFrom.mockReturnValue({
        where: () => ({
          limit: () => Promise.resolve([{ ...sampleInvoice, state: "DRAFT" }]),
        }),
      });
      mockUpdateReturning.mockResolvedValue([
        { ...sampleInvoice, state: "CANCELLED" },
      ]);

      const res = await app.request(`/v1/invoices/${INVOICE_UUID}/state`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ state: "CANCELLED" }),
      });

      expect(res.status).toBe(200);
    });

    it("returns 422 for invalid state transition DRAFT -> PAID", async () => {
      mockSelectFrom.mockReturnValue({
        where: () => ({
          limit: () => Promise.resolve([{ ...sampleInvoice, state: "DRAFT" }]),
        }),
      });

      const res = await app.request(`/v1/invoices/${INVOICE_UUID}/state`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ state: "PAID" }),
      });

      expect(res.status).toBe(422);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error.code).toBe("INVALID_STATE_TRANSITION");
      expect(json.error.message).toContain("DRAFT");
      expect(json.error.message).toContain("PAID");
    });

    it("returns 422 for transition from terminal state SETTLED", async () => {
      mockSelectFrom.mockReturnValue({
        where: () => ({
          limit: () => Promise.resolve([{ ...sampleInvoice, state: "SETTLED" }]),
        }),
      });

      const res = await app.request(`/v1/invoices/${INVOICE_UUID}/state`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ state: "ISSUED" }),
      });

      expect(res.status).toBe(422);
      const json = await res.json();
      expect(json.error.code).toBe("INVALID_STATE_TRANSITION");
      expect(json.error.message).toContain("none"); // no allowed transitions
    });

    it("returns 422 for transition from terminal state CANCELLED", async () => {
      mockSelectFrom.mockReturnValue({
        where: () => ({
          limit: () => Promise.resolve([{ ...sampleInvoice, state: "CANCELLED" }]),
        }),
      });

      const res = await app.request(`/v1/invoices/${INVOICE_UUID}/state`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ state: "ISSUED" }),
      });

      expect(res.status).toBe(422);
      const json = await res.json();
      expect(json.error.code).toBe("INVALID_STATE_TRANSITION");
    });

    it("returns 404 when invoice not found", async () => {
      mockSelectFrom.mockReturnValue({
        where: () => ({
          limit: () => Promise.resolve([]),
        }),
      });

      const res = await app.request(`/v1/invoices/${INVOICE_UUID}/state`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ state: "ISSUED" }),
      });

      expect(res.status).toBe(404);
    });

    it("returns 400 for non-UUID invoice id in path", async () => {
      const res = await app.request("/v1/invoices/bad-id/state", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ state: "ISSUED" }),
      });

      expect(res.status).toBe(400);
    });

    it("returns 400 for invalid JSON body", async () => {
      const res = await app.request(`/v1/invoices/${INVOICE_UUID}/state`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: "not-json",
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.code).toBe("BAD_REQUEST");
    });

    it("returns 400 for invalid state value", async () => {
      const res = await app.request(`/v1/invoices/${INVOICE_UUID}/state`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ state: "NONEXISTENT_STATE" }),
      });

      expect(res.status).toBe(400);
    });
  });

  describe("GET /v1/invoices", () => {
    it("returns 200 with paginated list", async () => {
      buildListSelectMock([sampleInvoice], 1);

      const res = await app.request("/v1/invoices?page=1&limit=10");

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.items).toBeInstanceOf(Array);
      expect(json.data.items).toHaveLength(1);
      expect(json.data.pagination.page).toBe(1);
      expect(json.data.pagination.limit).toBe(10);
      expect(json.data.pagination.total).toBe(1);
      expect(json.data.pagination.totalPages).toBe(1);
    });

    it("returns 200 with defaults when no query params provided", async () => {
      buildListSelectMock([], 0);

      const res = await app.request("/v1/invoices");

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.pagination.page).toBe(1);
      expect(json.data.pagination.limit).toBe(20);
      expect(json.data.pagination.total).toBe(0);
      expect(json.data.pagination.totalPages).toBe(0);
    });

    it("accepts state filter", async () => {
      buildListSelectMock([], 0);

      const res = await app.request("/v1/invoices?state=DRAFT");

      expect(res.status).toBe(200);
    });

    it("accepts currency filter", async () => {
      buildListSelectMock([], 0);

      const res = await app.request("/v1/invoices?currency=USDC");

      expect(res.status).toBe(200);
    });

    it("accepts seller and buyer wallet filters", async () => {
      buildListSelectMock([], 0);

      const res = await app.request(
        "/v1/invoices?seller=0xSELLER&buyer=0xBUYER",
      );

      expect(res.status).toBe(200);
    });

    it("accepts date range filters", async () => {
      buildListSelectMock([], 0);

      const res = await app.request(
        "/v1/invoices?from=2026-01-01T00:00:00Z&to=2026-03-31T00:00:00Z",
      );

      expect(res.status).toBe(200);
    });

    it("returns 400 for invalid state filter", async () => {
      const res = await app.request("/v1/invoices?state=GARBAGE");

      expect(res.status).toBe(400);
    });

    it("returns 400 for invalid currency filter", async () => {
      const res = await app.request("/v1/invoices?currency=DOGE");

      expect(res.status).toBe(400);
    });

    it("returns 400 for page less than 1", async () => {
      const res = await app.request("/v1/invoices?page=0");

      expect(res.status).toBe(400);
    });

    it("returns 400 for limit above max (100)", async () => {
      const res = await app.request("/v1/invoices?limit=200");

      expect(res.status).toBe(400);
    });

    it("computes totalPages correctly for multi-page results", async () => {
      buildListSelectMock([sampleInvoice], 55);

      const res = await app.request("/v1/invoices?page=1&limit=10");

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.pagination.totalPages).toBe(6); // ceil(55/10)
    });
  });
});
