import { describe, expect, it, vi, beforeEach } from "vitest";
import { createApp } from "../app.js";

// ---------------------------------------------------------------------------
// Mock the DB pool so tests run without Postgres.
// Health route uses getPool() directly (not getDb()).
// ---------------------------------------------------------------------------

const mockPoolQuery = vi.fn();

vi.mock("../db/index.js", () => ({
  getDb: () => ({
    insert: () => ({ values: () => ({ returning: vi.fn().mockResolvedValue([]) }) }),
    select: () => ({ from: vi.fn() }),
    update: () => ({ set: () => ({ where: () => ({ returning: vi.fn() }) }) }),
  }),
  getPool: () => ({
    query: mockPoolQuery,
  }),
}));

// ---------------------------------------------------------------------------
// Health does NOT go through the auth-required /api/v1 prefix.
// No auth mock needed.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Health API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env["CHAINALYSIS_API_URL"];
    delete process.env["APP_VERSION"];
  });

  describe("GET /health", () => {
    it("returns 200 with healthy status when DB is up", async () => {
      mockPoolQuery.mockResolvedValue({ rows: [{ "?column?": 1 }] });
      const app = createApp();

      const res = await app.request("/health");

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.status).toBe("healthy");
      expect(json.data.checks.database.status).toBe("healthy");
      expect(json.data.checks.database.latencyMs).toBeTypeOf("number");
    });

    it("returns uptime as a number", async () => {
      mockPoolQuery.mockResolvedValue({ rows: [] });
      const app = createApp();

      const res = await app.request("/health");
      const json = await res.json();

      expect(json.data.uptime).toBeTypeOf("number");
      expect(json.data.uptime).toBeGreaterThan(0);
    });

    it("returns timestamp in ISO 8601 format", async () => {
      mockPoolQuery.mockResolvedValue({ rows: [] });
      const app = createApp();

      const res = await app.request("/health");
      const json = await res.json();

      expect(json.data.timestamp).toMatch(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/,
      );
    });

    it("returns version from APP_VERSION env var when set", async () => {
      process.env["APP_VERSION"] = "1.2.3";
      mockPoolQuery.mockResolvedValue({ rows: [] });
      const app = createApp();

      const res = await app.request("/health");
      const json = await res.json();

      expect(json.data.version).toBe("1.2.3");
    });

    it("falls back to 0.1.0 when APP_VERSION is not set", async () => {
      mockPoolQuery.mockResolvedValue({ rows: [] });
      const app = createApp();

      const res = await app.request("/health");
      const json = await res.json();

      expect(json.data.version).toBe("0.1.0");
    });

    it("returns 503 with unhealthy status when DB is down", async () => {
      mockPoolQuery.mockRejectedValue(new Error("Connection refused"));
      const app = createApp();

      const res = await app.request("/health");

      expect(res.status).toBe(503);
      const json = await res.json();
      expect(json.data.status).toBe("unhealthy");
      expect(json.data.checks.database.status).toBe("unhealthy");
      expect(json.data.checks.database.message).toContain("Connection refused");
    });

    it("does not include chainalysis check when CHAINALYSIS_API_URL is not set at module load", async () => {
      // The health checker is a module-level singleton — CHAINALYSIS_API_URL
      // must be set before the module loads. Setting it after has no effect.
      mockPoolQuery.mockResolvedValue({ rows: [] });

      const app = createApp();
      const res = await app.request("/health");
      const json = await res.json();

      // chainalysis check is absent unless env var was set at import time
      expect(json.data.checks.chainalysis).toBeUndefined();
    });
  });

  describe("GET /health/ready", () => {
    it("returns 200 with ready=true when DB is healthy", async () => {
      mockPoolQuery.mockResolvedValue({ rows: [{ "?column?": 1 }] });
      const app = createApp();

      const res = await app.request("/health/ready");

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.ready).toBe(true);
      expect(json.data.checks.database.status).toBe("healthy");
    });

    it("returns 503 with ready=false when DB is unhealthy", async () => {
      mockPoolQuery.mockRejectedValue(new Error("Postgres unavailable"));
      const app = createApp();

      const res = await app.request("/health/ready");

      expect(res.status).toBe(503);
      const json = await res.json();
      expect(json.data.ready).toBe(false);
      expect(json.data.checks.database.status).toBe("unhealthy");
    });
  });

  describe("GET /health/live", () => {
    it("returns 200 with alive=true regardless of DB state", async () => {
      // Don't set up DB mock — liveness should never call DB
      const app = createApp();

      const res = await app.request("/health/live");

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.alive).toBe(true);
    });

    it("includes uptime in liveness response", async () => {
      const app = createApp();

      const res = await app.request("/health/live");
      const json = await res.json();

      expect(json.data.uptime).toBeTypeOf("number");
      expect(json.data.uptime).toBeGreaterThanOrEqual(0);
    });

    it("includes memory usage metrics", async () => {
      const app = createApp();

      const res = await app.request("/health/live");
      const json = await res.json();

      expect(json.data.memoryUsage).toBeDefined();
      expect(json.data.memoryUsage.rss).toBeTypeOf("number");
      expect(json.data.memoryUsage.heapUsed).toBeTypeOf("number");
      expect(json.data.memoryUsage.heapTotal).toBeTypeOf("number");
      // MB values should be positive
      expect(json.data.memoryUsage.rss).toBeGreaterThan(0);
    });

    it("includes timestamp in liveness response", async () => {
      const app = createApp();

      const res = await app.request("/health/live");
      const json = await res.json();

      expect(json.data.timestamp).toMatch(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/,
      );
    });
  });

  describe("404 handler", () => {
    it("returns 404 for unknown routes", async () => {
      const app = createApp();

      const res = await app.request("/nonexistent-route");

      expect(res.status).toBe(404);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error.code).toBe("NOT_FOUND");
      expect(json.error.message).toContain("/nonexistent-route");
    });
  });
});
