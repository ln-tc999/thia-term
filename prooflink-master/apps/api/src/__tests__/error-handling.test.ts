import { describe, expect, it, vi, beforeEach } from "vitest";
import { createApp } from "../app.js";

// ---------------------------------------------------------------------------
// Mock DB
// ---------------------------------------------------------------------------

vi.mock("../db/index.js", () => ({
  getDb: () => ({
    insert: () => ({
      values: () => ({
        returning: vi.fn().mockResolvedValue([]),
      }),
    }),
    select: () => ({
      from: vi.fn().mockReturnValue({
        where: () => ({
          limit: () => Promise.resolve([]),
          orderBy: () => ({
            limit: () => ({
              offset: () => Promise.resolve([]),
            }),
          }),
        }),
      }),
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

// Bypass auth for most tests
vi.mock("../middleware/auth.js", () => ({
  requireScope: () => async (_c: unknown, next: () => Promise<void>) => { await next(); },
  authMiddleware: () => {
    return async (c: { set: (k: string, v: unknown) => void }, next: () => Promise<void>) => {
      c.set("auth", { apiKeyId: "test-key-id", ownerId: "test-owner", scopes: ["admin"], rateLimitPerMinute: 60, authMethod: "api_key" });
      await next();
    };
  },
}));

// Mock screening
vi.mock("../services/screening.js", () => ({
  screenAddress: vi.fn().mockResolvedValue({ matched: false, listsChecked: ["OFAC_SDN"], matchDetails: [], riskScore: 0, screenedAt: new Date().toISOString(), provider: "chainalysis_free" }),
  getScreener: vi.fn(),
  resetScreener: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Error Handling", () => {
  const app = createApp();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Invalid JSON body → 400", () => {
    it("returns 400 with BAD_REQUEST for malformed JSON on invoices", async () => {
      const res = await app.request("/v1/invoices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{not valid json!!!",
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error.code).toBe("BAD_REQUEST");
      expect(json.error.message).toContain("JSON");
    });

    it("returns 400 with BAD_REQUEST for malformed JSON on compliance check", async () => {
      const res = await app.request("/v1/compliance/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{{invalid",
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.code).toBe("BAD_REQUEST");
    });

    it("returns 400 with BAD_REQUEST for malformed JSON on escrow", async () => {
      const res = await app.request("/v1/escrow", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "not json",
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.code).toBe("BAD_REQUEST");
    });
  });

  describe("Missing required fields → 400 with field-level errors", () => {
    it("returns validation error with details for invoices", async () => {
      const res = await app.request("/v1/invoices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ seller: { walletAddress: "0x123" } }),
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error.code).toBe("VALIDATION_ERROR");
      expect(json.error.details).toBeInstanceOf(Array);
      expect(json.error.details.length).toBeGreaterThan(0);
      expect(json.error.details[0]).toHaveProperty("path");
      expect(json.error.details[0]).toHaveProperty("message");
    });

    it("returns validation error with details for escrow missing fields", async () => {
      const res = await app.request("/v1/escrow", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ escrowType: "PAYMENT" }),
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.code).toBe("VALIDATION_ERROR");
      expect(json.error.details).toBeInstanceOf(Array);
      expect(json.error.details.length).toBeGreaterThan(0);
    });

    it("returns validation error with details for compliance check missing sender", async () => {
      const res = await app.request("/v1/compliance/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          receiver: { address: "0xabc", chain: "eip155:8453" },
          amount: "100",
          asset: "USDC",
        }),
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error.code).toBe("VALIDATION_ERROR");
    });
  });

  describe("Non-existent resource → 404", () => {
    it("returns 404 for non-existent invoice", async () => {
      const uuid = "550e8400-e29b-41d4-a716-446655440099";
      const res = await app.request(`/v1/invoices/${uuid}`);

      expect(res.status).toBe(404);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error.code).toBe("NOT_FOUND");
    });

    it("returns 404 for non-existent escrow", async () => {
      const uuid = "550e8400-e29b-41d4-a716-446655440099";
      const res = await app.request(`/v1/escrow/${uuid}`);

      expect(res.status).toBe(404);
      const json = await res.json();
      expect(json.error.code).toBe("NOT_FOUND");
    });

    it("returns 404 for non-existent dispute", async () => {
      const uuid = "550e8400-e29b-41d4-a716-446655440099";
      const res = await app.request(`/v1/disputes/${uuid}`);

      expect(res.status).toBe(404);
      const json = await res.json();
      expect(json.error.code).toBe("NOT_FOUND");
    });

    it("returns 404 for non-existent compliance receipt", async () => {
      const uuid = "550e8400-e29b-41d4-a716-446655440099";
      const res = await app.request(`/v1/compliance/receipt/${uuid}`);

      expect(res.status).toBe(404);
      const json = await res.json();
      expect(json.error.code).toBe("NOT_FOUND");
    });

    it("returns 404 for completely unknown route", async () => {
      const res = await app.request("/v1/nonexistent/route");

      expect(res.status).toBe(404);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error.code).toBe("NOT_FOUND");
      expect(json.error.message).toContain("not found");
    });
  });

  describe("Invalid path parameters → 400", () => {
    it("returns 400 for non-UUID invoice id", async () => {
      const res = await app.request("/v1/invoices/not-a-uuid");

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.code).toBe("VALIDATION_ERROR");
    });

    it("returns 400 for non-UUID escrow id", async () => {
      const res = await app.request("/v1/escrow/bad-id");

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.code).toBe("VALIDATION_ERROR");
    });

    it("returns 400 for non-UUID dispute id", async () => {
      const res = await app.request("/v1/disputes/xyz");

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.code).toBe("VALIDATION_ERROR");
    });

    it("returns 400 for non-UUID compliance receipt id", async () => {
      const res = await app.request("/v1/compliance/receipt/abc");

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.code).toBe("VALIDATION_ERROR");
    });
  });

  describe("Invalid query parameters → 400", () => {
    it("returns 400 for invalid state filter on invoices", async () => {
      const res = await app.request("/v1/invoices?state=INVALID");

      expect(res.status).toBe(400);
    });

    it("returns 400 for page=0 on invoices", async () => {
      const res = await app.request("/v1/invoices?page=0");

      expect(res.status).toBe(400);
    });

    it("returns 400 for limit exceeding max on escrow", async () => {
      const res = await app.request("/v1/escrow?limit=500");

      expect(res.status).toBe(400);
    });
  });
});
