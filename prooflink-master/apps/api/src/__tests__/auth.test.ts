import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { createApp } from "../app.js";
import { hasScope } from "../middleware/auth.js";

// ---------------------------------------------------------------------------
// Helpers for JWT creation (HS256) — mirrors auth.ts implementation
// ---------------------------------------------------------------------------

import { createHmac } from "node:crypto";

function base64UrlEncode(data: string): string {
  return Buffer.from(data)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

function makeJwt(
  payload: Record<string, unknown>,
  secret: string,
  header?: Record<string, unknown>,
): string {
  const h = base64UrlEncode(JSON.stringify(header ?? { alg: "HS256", typ: "JWT" }));
  const p = base64UrlEncode(JSON.stringify(payload));
  const sig = createHmac("sha256", secret)
    .update(`${h}.${p}`)
    .digest("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
  return `${h}.${p}.${sig}`;
}

// ---------------------------------------------------------------------------
// Mock DB for API key auth path
// ---------------------------------------------------------------------------

const mockSelectFrom = vi.fn();

vi.mock("../db/index.js", () => ({
  getDb: () => ({
    insert: () => ({
      values: () => ({
        returning: vi.fn().mockResolvedValue([]),
        then: (resolve: (v: unknown) => void) => Promise.resolve().then(resolve),
        catch: () => Promise.resolve(),
      }),
    }),
    select: () => ({ from: mockSelectFrom }),
    update: () => ({
      set: () => ({ where: () => ({ catch: vi.fn() }) }),
    }),
  }),
  getPool: () => ({
    query: vi.fn().mockResolvedValue({ rows: [{ "?column?": 1 }] }),
  }),
}));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Auth Middleware", () => {
  const JWT_SECRET = "test-jwt-secret-at-least-32-chars-long";

  beforeEach(() => {
    vi.clearAllMocks();
    process.env["JWT_SECRET"] = JWT_SECRET;
  });

  afterEach(() => {
    delete process.env["JWT_SECRET"];
    delete process.env["API_KEY_SECRET"];
  });

  describe("missing credentials", () => {
    it("returns 401 when no Authorization or X-API-Key header provided", async () => {
      const app = createApp();
      const res = await app.request("/v1/compliance/screen", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address: "0xtest", chain: "eip155:8453" }),
      });

      expect(res.status).toBe(401);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error.code).toBe("UNAUTHORIZED");
      expect(json.error.message).toContain("Missing credentials");
    });
  });

  describe("JWT authentication", () => {
    it("passes with valid JWT token", async () => {
      const app = createApp();
      const token = makeJwt(
        {
          sub: "user-001",
          scopes: ["read", "write"],
          rateLimitPerMinute: 60,
          exp: Math.floor(Date.now() / 1000) + 3600,
        },
        JWT_SECRET,
      );

      const res = await app.request("/v1/compliance/screen", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ address: "0xtest", chain: "eip155:8453" }),
      });

      // Should not be 401 (may be 200 or 400 depending on downstream logic)
      expect(res.status).not.toBe(401);
    });

    it("returns 401 for expired JWT token", async () => {
      const app = createApp();
      const token = makeJwt(
        {
          sub: "user-001",
          scopes: ["read"],
          exp: Math.floor(Date.now() / 1000) - 100, // expired
        },
        JWT_SECRET,
      );

      const res = await app.request("/v1/compliance/screen", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ address: "0xtest", chain: "eip155:8453" }),
      });

      expect(res.status).toBe(401);
      const json = await res.json();
      expect(json.error.code).toBe("UNAUTHORIZED");
      expect(json.error.message).toContain("Invalid or expired JWT");
    });

    it("returns 401 for JWT with wrong signature", async () => {
      const app = createApp();
      const token = makeJwt(
        { sub: "user-001", scopes: ["read"] },
        "wrong-secret-that-is-also-32-chars-long",
      );

      const res = await app.request("/v1/compliance/screen", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ address: "0xtest", chain: "eip155:8453" }),
      });

      expect(res.status).toBe(401);
    });

    it("returns 401 for malformed JWT (not 3 parts)", async () => {
      const app = createApp();
      // 2-part token is treated as API key; mock empty DB result → 401
      mockSelectFrom.mockReturnValue({
        where: () => ({ limit: () => Promise.resolve([]) }),
      });

      const res = await app.request("/v1/compliance/screen", {
        method: "POST",
        headers: {
          Authorization: "Bearer header.payload",  // only 2 parts
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ address: "0xtest", chain: "eip155:8453" }),
      });

      // Treated as API key (2-part → no dot-triple), falls through to DB lookup
      // which returns no record → 401
      expect(res.status).toBe(401);
    });

    it("returns 401 when JWT_SECRET is not set", async () => {
      delete process.env["JWT_SECRET"];
      const app = createApp();

      const token = makeJwt(
        { sub: "user-001", scopes: ["read"] },
        JWT_SECRET,
      );

      const res = await app.request("/v1/compliance/screen", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ address: "0xtest", chain: "eip155:8453" }),
      });

      // Without JWT_SECRET, JWT auth is disabled → treated as API key → DB lookup → 401
      expect(res.status).toBe(401);
    });

    it("returns 401 for JWT with non-HS256 algorithm header", async () => {
      const app = createApp();
      const token = makeJwt(
        { sub: "user-001", scopes: ["read"], exp: Math.floor(Date.now() / 1000) + 3600 },
        JWT_SECRET,
        { alg: "RS256", typ: "JWT" }, // wrong alg
      );

      const res = await app.request("/v1/compliance/screen", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ address: "0xtest", chain: "eip155:8453" }),
      });

      expect(res.status).toBe(401);
    });
  });

  describe("API key authentication", () => {
    it("returns 401 for unknown API key", async () => {
      const app = createApp();
      mockSelectFrom.mockReturnValue({
        where: () => ({ limit: () => Promise.resolve([]) }),
      });

      const res = await app.request("/v1/compliance/screen", {
        method: "POST",
        headers: {
          "X-API-Key": "fl_unknown_key_12345",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ address: "0xtest", chain: "eip155:8453" }),
      });

      expect(res.status).toBe(401);
      const json = await res.json();
      expect(json.error.code).toBe("UNAUTHORIZED");
      expect(json.error.message).toContain("Invalid API key");
    });

    it("returns 403 for deactivated API key", async () => {
      const app = createApp();
      mockSelectFrom.mockReturnValue({
        where: () => ({
          limit: () =>
            Promise.resolve([
              {
                id: "key-uuid-001",
                ownerId: "owner-001",
                scopes: ["read"],
                rateLimitPerMinute: 60,
                isActive: false, // deactivated
                expiresAt: null,
              },
            ]),
        }),
      });

      const res = await app.request("/v1/compliance/screen", {
        method: "POST",
        headers: {
          "X-API-Key": "fl_deactivated_key",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ address: "0xtest", chain: "eip155:8453" }),
      });

      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.error.code).toBe("FORBIDDEN");
      expect(json.error.message).toContain("deactivated");
    });

    it("returns 403 for expired API key", async () => {
      const app = createApp();
      mockSelectFrom.mockReturnValue({
        where: () => ({
          limit: () =>
            Promise.resolve([
              {
                id: "key-uuid-002",
                ownerId: "owner-001",
                scopes: ["read"],
                rateLimitPerMinute: 60,
                isActive: true,
                expiresAt: new Date("2020-01-01T00:00:00Z"), // expired
              },
            ]),
        }),
      });

      const res = await app.request("/v1/compliance/screen", {
        method: "POST",
        headers: {
          "X-API-Key": "fl_expired_key_123",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ address: "0xtest", chain: "eip155:8453" }),
      });

      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.error.code).toBe("FORBIDDEN");
      expect(json.error.message).toContain("expired");
    });

    it("passes with valid active API key from X-API-Key header", async () => {
      const app = createApp();
      mockSelectFrom.mockReturnValue({
        where: () => ({
          limit: () =>
            Promise.resolve([
              {
                id: "key-uuid-003",
                ownerId: "owner-001",
                scopes: ["read", "write"],
                rateLimitPerMinute: 60,
                isActive: true,
                expiresAt: null,
              },
            ]),
        }),
      });

      const res = await app.request("/v1/compliance/screen", {
        method: "POST",
        headers: {
          "X-API-Key": "fl_valid_key_abcdef",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ address: "0xtest", chain: "eip155:8453" }),
      });

      // Auth passes → route processes → 200 (screen always succeeds)
      expect(res.status).toBe(200);
    });

    it("passes with valid API key from Bearer header", async () => {
      const app = createApp();
      mockSelectFrom.mockReturnValue({
        where: () => ({
          limit: () =>
            Promise.resolve([
              {
                id: "key-uuid-004",
                ownerId: "owner-001",
                scopes: ["write"],
                rateLimitPerMinute: 60,
                isActive: true,
                expiresAt: null,
              },
            ]),
        }),
      });

      // A non-JWT Bearer (no 3-dot structure) → treated as API key
      const res = await app.request("/v1/compliance/screen", {
        method: "POST",
        headers: {
          Authorization: "Bearer fl_valid_api_key_bearer",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ address: "0xtest", chain: "eip155:8453" }),
      });

      expect(res.status).toBe(200);
    });

    it("returns 500 when DB throws during auth", async () => {
      const app = createApp();
      mockSelectFrom.mockReturnValue({
        where: () => ({
          limit: () => Promise.reject(new Error("DB connection failed")),
        }),
      });

      const res = await app.request("/v1/compliance/screen", {
        method: "POST",
        headers: {
          "X-API-Key": "fl_any_key_db_will_fail",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ address: "0xtest", chain: "eip155:8453" }),
      });

      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.error.code).toBe("INTERNAL_ERROR");
    });
  });

  describe("Request signature verification", () => {
    it("returns 401 for invalid request signature", async () => {
      process.env["REQUEST_SIGNING_SECRET"] = "signing-secret-at-least-16-chars";
      const app = createApp();
      const timestamp = String(Math.floor(Date.now() / 1000));

      const res = await app.request("/v1/compliance/screen", {
        method: "POST",
        headers: {
          "X-API-Key": "fl_any_key",
          "X-Signature": "0xbadhash",
          "X-Signature-Timestamp": timestamp,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ address: "0xtest", chain: "eip155:8453" }),
      });

      expect(res.status).toBe(401);
      const json = await res.json();
      expect(json.error.code).toBe("UNAUTHORIZED");
      expect(json.error.message).toContain("Invalid request signature");

      delete process.env["REQUEST_SIGNING_SECRET"];
    });

    it("returns 401 when X-Signature is present but X-Signature-Timestamp is missing", async () => {
      process.env["REQUEST_SIGNING_SECRET"] = "signing-secret-at-least-16-chars";
      const app = createApp();

      const res = await app.request("/v1/compliance/screen", {
        method: "POST",
        headers: {
          "X-API-Key": "fl_any_key",
          "X-Signature": "somevalue",
          // No X-Signature-Timestamp
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ address: "0xtest", chain: "eip155:8453" }),
      });

      expect(res.status).toBe(401);
      delete process.env["REQUEST_SIGNING_SECRET"];
    });

    it("returns 401 for replay attack (timestamp older than 5 minutes)", async () => {
      process.env["REQUEST_SIGNING_SECRET"] = "signing-secret-at-least-16-chars";
      const app = createApp();
      const oldTimestamp = String(Math.floor(Date.now() / 1000) - 400); // >5 min ago

      const res = await app.request("/v1/compliance/screen", {
        method: "POST",
        headers: {
          "X-API-Key": "fl_any_key",
          "X-Signature": "somehash",
          "X-Signature-Timestamp": oldTimestamp,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ address: "0xtest", chain: "eip155:8453" }),
      });

      expect(res.status).toBe(401);
      delete process.env["REQUEST_SIGNING_SECRET"];
    });
  });
});

describe("hasScope helper", () => {
  it("admin scope grants admin, write, and read access", () => {
    expect(hasScope(["admin"], "admin")).toBe(true);
    expect(hasScope(["admin"], "write")).toBe(true);
    expect(hasScope(["admin"], "read")).toBe(true);
  });

  it("write scope grants write and read but not admin", () => {
    expect(hasScope(["write"], "admin")).toBe(false);
    expect(hasScope(["write"], "write")).toBe(true);
    expect(hasScope(["write"], "read")).toBe(true);
  });

  it("read scope only grants read", () => {
    expect(hasScope(["read"], "admin")).toBe(false);
    expect(hasScope(["read"], "write")).toBe(false);
    expect(hasScope(["read"], "read")).toBe(true);
  });

  it("empty scopes array grants nothing", () => {
    expect(hasScope([], "read")).toBe(false);
    expect(hasScope([], "write")).toBe(false);
    expect(hasScope([], "admin")).toBe(false);
  });

  it("unknown scope is ignored", () => {
    expect(hasScope(["unknown" as "read"], "read")).toBe(false);
  });

  it("multiple scopes in array — any match grants access", () => {
    expect(hasScope(["read", "admin"], "admin")).toBe(true);
  });
});
