import { describe, expect, it, vi, beforeEach } from "vitest";
import { createApp } from "../app.js";
import { resetWebhookManager } from "../routes/webhooks.js";

// ---------------------------------------------------------------------------
// Mock DB — webhooks route uses in-memory WebhookManager, not DB directly,
// but the DB mock is still needed for app.ts auth/rate-limit middleware.
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
        where: () => ({ limit: () => Promise.resolve([]) }),
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

// Bypass auth
vi.mock("../middleware/auth.js", () => ({
  requireScope: () => async (_c: unknown, next: () => Promise<void>) => { await next(); },
  authMiddleware: () => {
    return async (_c: unknown, next: () => Promise<void>) => {
      await next();
    };
  },
}));

// Mock fetch so webhook test delivery doesn't attempt real HTTP
const mockFetch = vi.fn().mockResolvedValue({
  ok: true,
  status: 200,
  text: () => Promise.resolve("OK"),
});
vi.stubGlobal("fetch", mockFetch);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const VALID_SECRET = "supersecret-at-least-16-chars";
const VALID_URL = "https://example.com/webhook";

async function registerWebhook(
  app: ReturnType<typeof createApp>,
  overrides?: Record<string, unknown>,
) {
  return app.request("/v1/webhooks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      url: VALID_URL,
      secret: VALID_SECRET,
      events: ["compliance.check.passed"],
      ...overrides,
    }),
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Webhooks API", () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    vi.clearAllMocks();
    resetWebhookManager();
    app = createApp();
    mockFetch.mockResolvedValue({ ok: true, status: 200, text: () => Promise.resolve("OK") });
  });

  describe("POST /v1/webhooks — register", () => {
    it("returns 201 with webhook details (no secret)", async () => {
      const res = await registerWebhook(app);

      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.id).toBeTypeOf("string");
      expect(json.data.url).toBe(VALID_URL);
      expect(json.data.events).toContain("compliance.check.passed");
      expect(json.data.active).toBe(true);
      expect(json.data.createdAt).toBeTypeOf("string");
      // Secret must never be returned
      expect(json.data.secret).toBeUndefined();
    });

    it("returns 201 with empty events subscribing to all", async () => {
      const res = await registerWebhook(app, { events: [] });

      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.data.events).toBeInstanceOf(Array);
    });

    it("returns 201 with multiple event types", async () => {
      const res = await registerWebhook(app, {
        events: ["compliance.check.passed", "invoice.created"],
      });

      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.data.events).toHaveLength(2);
    });

    it("returns 400 for missing URL", async () => {
      const res = await app.request("/v1/webhooks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ secret: VALID_SECRET }),
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error.code).toBe("VALIDATION_ERROR");
    });

    it("returns 400 for non-URL string in url field", async () => {
      const res = await registerWebhook(app, { url: "not-a-url" });

      expect(res.status).toBe(400);
    });

    it("returns 400 for secret shorter than 16 characters", async () => {
      const res = await registerWebhook(app, { secret: "short" });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.code).toBe("VALIDATION_ERROR");
    });

    it("returns 400 for invalid event type", async () => {
      const res = await registerWebhook(app, {
        events: ["not.a.real.event"],
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.code).toBe("VALIDATION_ERROR");
    });

    it("returns 400 for invalid JSON body", async () => {
      const res = await app.request("/v1/webhooks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{invalid",
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.code).toBe("BAD_REQUEST");
    });
  });

  describe("GET /v1/webhooks — list", () => {
    it("returns 200 with empty list initially", async () => {
      const res = await app.request("/v1/webhooks");

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data).toBeInstanceOf(Array);
      expect(json.data).toHaveLength(0);
    });

    it("returns 200 with registered webhooks", async () => {
      await registerWebhook(app);
      await registerWebhook(app, {
        url: "https://other.example.com/hook",
        events: ["invoice.paid"],
      });

      const res = await app.request("/v1/webhooks");

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data).toHaveLength(2);
      // Secrets must never appear in list
      for (const wh of json.data) {
        expect(wh.secret).toBeUndefined();
        expect(wh.id).toBeTypeOf("string");
        expect(wh.url).toBeTypeOf("string");
        expect(wh.active).toBe(true);
      }
    });
  });

  describe("DELETE /v1/webhooks/:id", () => {
    it("returns 200 when webhook exists and is deleted", async () => {
      const createRes = await registerWebhook(app);
      const createJson = await createRes.json();
      const webhookId = createJson.data.id;

      const deleteRes = await app.request(`/v1/webhooks/${webhookId}`, {
        method: "DELETE",
      });

      expect(deleteRes.status).toBe(200);
      const json = await deleteRes.json();
      expect(json.success).toBe(true);
      expect(json.data.id).toBe(webhookId);
      expect(json.data.deleted).toBe(true);
    });

    it("returns 404 when webhook not found", async () => {
      const nonExistentUUID = "550e8400-e29b-41d4-a716-446655440099";
      const res = await app.request(`/v1/webhooks/${nonExistentUUID}`, {
        method: "DELETE",
      });

      expect(res.status).toBe(404);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error.code).toBe("NOT_FOUND");
    });

    it("returns 400 for non-UUID webhook id", async () => {
      const res = await app.request("/v1/webhooks/not-a-uuid", {
        method: "DELETE",
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.code).toBe("VALIDATION_ERROR");
    });

    it("confirms webhook is gone after deletion", async () => {
      const createRes = await registerWebhook(app);
      const createJson = await createRes.json();
      const webhookId = createJson.data.id;

      await app.request(`/v1/webhooks/${webhookId}`, {
        method: "DELETE",
      });

      // List should be empty
      const listRes = await app.request("/v1/webhooks");
      const listJson = await listRes.json();
      expect(listJson.data).toHaveLength(0);
    });
  });

  describe("POST /v1/webhooks/:id/test — test delivery", () => {
    it("returns 200 with delivery result when webhook exists", async () => {
      const createRes = await registerWebhook(app);
      const createJson = await createRes.json();
      const webhookId = createJson.data.id;

      const testRes = await app.request(
        `/v1/webhooks/${webhookId}/test`,
        { method: "POST" },
      );

      expect(testRes.status).toBe(200);
      const json = await testRes.json();
      expect(json.success).toBe(true);
      expect(json.data.delivered).toBeTypeOf("boolean");
      expect(json.data.attempts).toBeTypeOf("number");
    });

    it("returns 404 when webhook not found", async () => {
      const nonExistentUUID = "550e8400-e29b-41d4-a716-446655440098";
      const res = await app.request(
        `/v1/webhooks/${nonExistentUUID}/test`,
        { method: "POST" },
      );

      expect(res.status).toBe(404);
      const json = await res.json();
      expect(json.error.code).toBe("NOT_FOUND");
    });

    it("returns 400 for non-UUID webhook id in test path", async () => {
      const res = await app.request("/v1/webhooks/bad-id/test", {
        method: "POST",
      });

      expect(res.status).toBe(400);
    });
  });
});
