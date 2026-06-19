import { describe, it, expect, vi, beforeEach } from "vitest";
import { WebhookManager } from "../webhooks/manager.js";
import {
  WEBHOOK_EVENT_TYPES,
  isValidEventType,
} from "../webhooks/events.js";
import type { WebhookEventType } from "../webhooks/events.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ok200(): Response {
  return new Response("ok", { status: 200 });
}

function error500(): Response {
  return new Response("internal error", { status: 500 });
}

/** Manager with no-op sleep (base delay is 0) and injected fetch. */
function createManager(
  fetchFn: ReturnType<typeof vi.fn>,
  opts?: { maxRetries?: number; baseDelayMs?: number },
): WebhookManager {
  return new WebhookManager({
    maxRetries: opts?.maxRetries ?? 3,
    baseDelayMs: opts?.baseDelayMs ?? 0,
    timeoutMs: 5_000,
    fetchFn: fetchFn as unknown as typeof globalThis.fetch,
  });
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

describe("WebhookManager — registration", () => {
  it("should register a webhook with correct metadata", () => {
    const mgr = createManager(vi.fn());
    const config = mgr.register(
      "https://hooks.example.com/compliance",
      "supersecret",
      ["compliance.check.passed"],
    );

    expect(config.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    expect(config.url).toBe("https://hooks.example.com/compliance");
    expect(config.secret).toBe("supersecret");
    expect(config.events).toEqual(["compliance.check.passed"]);
    expect(config.active).toBe(true);
    expect(config.createdAt).toBeTruthy();
  });

  it("should register multiple webhooks with unique IDs", () => {
    const mgr = createManager(vi.fn());
    const c1 = mgr.register("https://a.com/hook", "s1", []);
    const c2 = mgr.register("https://b.com/hook", "s2", []);
    const c3 = mgr.register("https://c.com/hook", "s3", []);

    expect(c1.id).not.toBe(c2.id);
    expect(c2.id).not.toBe(c3.id);
    expect(mgr.list()).toHaveLength(3);
  });

  it("should return the registered config via get()", () => {
    const mgr = createManager(vi.fn());
    const config = mgr.register("https://a.com/hook", "secret", [
      "invoice.paid",
    ]);

    expect(mgr.get(config.id)).toEqual(config);
  });

  it("should return undefined for an unknown ID", () => {
    const mgr = createManager(vi.fn());
    expect(mgr.get("does-not-exist")).toBeUndefined();
  });

  it("should remove a webhook and return true", () => {
    const mgr = createManager(vi.fn());
    const config = mgr.register("https://a.com/hook", "s", []);
    expect(mgr.remove(config.id)).toBe(true);
    expect(mgr.list()).toHaveLength(0);
  });

  it("should return false when removing a non-existent ID", () => {
    const mgr = createManager(vi.fn());
    expect(mgr.remove("phantom-id")).toBe(false);
  });

  it("should register webhooks subscribing to all events via empty array", () => {
    const mgr = createManager(vi.fn());
    const config = mgr.register("https://a.com/hook", "s", []);

    expect(config.events).toEqual([]);
  });

  it("should register webhooks subscribing to multiple event types", () => {
    const mgr = createManager(vi.fn());
    const events: WebhookEventType[] = [
      "compliance.check.passed",
      "compliance.check.failed",
      "invoice.paid",
    ];
    const config = mgr.register("https://a.com/hook", "s", events);

    expect(config.events).toEqual(events);
  });
});

// ---------------------------------------------------------------------------
// Signature
// ---------------------------------------------------------------------------

describe("WebhookManager — HMAC-SHA256 signature", () => {
  it("should compute a 64-character hex signature", () => {
    const sig = WebhookManager.computeSignature('{"event":"test"}', "secret");
    expect(sig).toHaveLength(64);
    expect(sig).toMatch(/^[0-9a-f]{64}$/);
  });

  it("should produce the same signature for identical inputs (deterministic)", () => {
    const payload = JSON.stringify({ type: "invoice.paid", id: "123" });
    const sig1 = WebhookManager.computeSignature(payload, "my-secret");
    const sig2 = WebhookManager.computeSignature(payload, "my-secret");

    expect(sig1).toBe(sig2);
  });

  it("should produce different signatures for different secrets", () => {
    const payload = "same-payload";
    const sig1 = WebhookManager.computeSignature(payload, "secret-a");
    const sig2 = WebhookManager.computeSignature(payload, "secret-b");

    expect(sig1).not.toBe(sig2);
  });

  it("should produce different signatures for different payloads", () => {
    const secret = "same-secret";
    const sig1 = WebhookManager.computeSignature("payload-one", secret);
    const sig2 = WebhookManager.computeSignature("payload-two", secret);

    expect(sig1).not.toBe(sig2);
  });

  it("should verify a correctly computed signature", () => {
    const payload = '{"type":"compliance.check.passed","id":"abc-123"}';
    const secret = "verify-secret";
    const sig = WebhookManager.computeSignature(payload, secret);

    expect(WebhookManager.verifySignature(payload, secret, sig)).toBe(true);
  });

  it("should reject a tampered payload", () => {
    const secret = "verify-secret";
    const sig = WebhookManager.computeSignature("original", secret);

    expect(WebhookManager.verifySignature("tampered", secret, sig)).toBe(false);
  });

  it("should reject an all-zero signature", () => {
    expect(
      WebhookManager.verifySignature("payload", "secret", "0".repeat(64)),
    ).toBe(false);
  });

  it("should reject a signature of the wrong length (too short)", () => {
    expect(
      WebhookManager.verifySignature("payload", "secret", "abc123"),
    ).toBe(false);
  });

  it("should reject a signature of the wrong length (too long)", () => {
    const sig = "0".repeat(65);
    expect(
      WebhookManager.verifySignature("payload", "secret", sig),
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Dispatch — event routing
// ---------------------------------------------------------------------------

describe("WebhookManager — dispatch event routing", () => {
  it("should dispatch to a matching subscribed webhook", async () => {
    const mockFetch = vi.fn().mockResolvedValue(ok200());
    const mgr = createManager(mockFetch);
    mgr.register("https://example.com/hook", "secret", [
      "compliance.check.passed",
    ]);

    const records = await mgr.dispatch("compliance.check.passed", {
      checkId: "chk-001",
    });

    expect(records).toHaveLength(1);
    expect(records[0]?.success).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("should NOT dispatch to a webhook subscribed to a different event", async () => {
    const mockFetch = vi.fn().mockResolvedValue(ok200());
    const mgr = createManager(mockFetch);
    mgr.register("https://example.com/hook", "secret", ["invoice.created"]);

    const records = await mgr.dispatch("compliance.check.failed", {});

    expect(records).toHaveLength(0);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("should dispatch to a webhook with an empty events array (subscribes to all)", async () => {
    // Test a subset of event types — the catch-all (empty array) matches all
    // Use mockImplementation so each call gets a fresh Response (body can only be consumed once).
    const mockFetch = vi.fn().mockImplementation(() => Promise.resolve(ok200()));

    for (const eventType of WEBHOOK_EVENT_TYPES) {
      // Create a fresh manager per iteration to avoid cross-event state
      const mgr = createManager(mockFetch);
      mgr.register("https://example.com/hook", "secret", []);
      mockFetch.mockClear();

      const records = await mgr.dispatch(eventType, {});
      expect(records).toHaveLength(1);
      expect(records[0]?.success).toBe(true);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    }
  });

  it("should dispatch to multiple webhooks in parallel", async () => {
    // Use mockImplementation (not mockResolvedValue) so each call gets a fresh
    // Response object — Response bodies can only be consumed once.
    const mockFetch = vi.fn().mockImplementation(() =>
      Promise.resolve(ok200()),
    );
    const mgr = createManager(mockFetch);
    mgr.register("https://a.com/hook", "s1", ["invoice.paid"]);
    mgr.register("https://b.com/hook", "s2", ["invoice.paid"]);
    mgr.register("https://c.com/hook", "s3", ["invoice.paid"]);

    const records = await mgr.dispatch("invoice.paid", { invoiceId: "inv-001" });

    expect(records).toHaveLength(3);
    expect(records.every((r) => r.success)).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it("should not dispatch to inactive webhooks", async () => {
    const mockFetch = vi.fn().mockResolvedValue(ok200());
    const mgr = createManager(mockFetch);
    const config = mgr.register("https://a.com/hook", "s", []);

    // Mark inactive by modifying the stored config
    const stored = mgr.get(config.id)!;
    (stored as { active: boolean }).active = false;

    const records = await mgr.dispatch("invoice.paid", {});

    expect(records).toHaveLength(0);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Dispatch — HTTP headers
// ---------------------------------------------------------------------------

describe("WebhookManager — dispatch HTTP headers", () => {
  it("should send Content-Type: application/json", async () => {
    const mockFetch = vi.fn().mockResolvedValue(ok200());
    const mgr = createManager(mockFetch);
    mgr.register("https://example.com/hook", "secret", [
      "compliance.check.passed",
    ]);

    await mgr.dispatch("compliance.check.passed", {});

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers["Content-Type"]).toBe("application/json");
  });

  it("should send X-ProofLink-Event header with event type", async () => {
    const mockFetch = vi.fn().mockResolvedValue(ok200());
    const mgr = createManager(mockFetch);
    mgr.register("https://example.com/hook", "secret", ["invoice.created"]);

    await mgr.dispatch("invoice.created", { invoiceId: "456" });

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers["X-ProofLink-Event"]).toBe("invoice.created");
  });

  it("should send X-ProofLink-Delivery header with event ID", async () => {
    const mockFetch = vi.fn().mockResolvedValue(ok200());
    const mgr = createManager(mockFetch);
    mgr.register("https://example.com/hook", "secret", ["invoice.paid"]);

    await mgr.dispatch("invoice.paid", {});

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    // Should be a UUID
    expect(headers["X-ProofLink-Delivery"]).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  it("should send valid X-ProofLink-Signature that verifies against the payload and secret", async () => {
    const mockFetch = vi.fn().mockResolvedValue(ok200());
    const mgr = createManager(mockFetch);
    const secret = "hmac-test-secret";
    mgr.register("https://example.com/hook", secret, ["receipt.anchored"]);

    await mgr.dispatch("receipt.anchored", { uid: "0xabc" });

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    const signature = headers["X-ProofLink-Signature"];
    const body = init.body as string;

    expect(WebhookManager.verifySignature(body, secret, signature!)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Dispatch — retry logic
// ---------------------------------------------------------------------------

describe("WebhookManager — retry logic", () => {
  it("should succeed on the first attempt without retrying", async () => {
    const mockFetch = vi.fn().mockResolvedValue(ok200());
    const mgr = createManager(mockFetch, { maxRetries: 5 });
    mgr.register("https://example.com/hook", "s", []);

    const records = await mgr.dispatch("invoice.paid", {});

    expect(records[0]?.attempts).toHaveLength(1);
    expect(records[0]?.attempts[0]?.status).toBe(200);
    expect(records[0]?.success).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("should retry on 500 and succeed on second attempt", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(error500())
      .mockResolvedValueOnce(ok200());
    const mgr = createManager(mockFetch, { maxRetries: 3 });
    mgr.register("https://example.com/hook", "s", []);

    const records = await mgr.dispatch("invoice.paid", {});

    expect(records[0]?.success).toBe(true);
    expect(records[0]?.attempts).toHaveLength(2);
    expect(records[0]?.attempts[0]?.status).toBe(500);
    expect(records[0]?.attempts[1]?.status).toBe(200);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("should exhaust all retries when all attempts fail", async () => {
    const mockFetch = vi.fn().mockImplementation(() =>
      Promise.resolve(error500()),
    );
    const mgr = createManager(mockFetch, { maxRetries: 3 });
    mgr.register("https://example.com/hook", "s", []);

    const records = await mgr.dispatch("invoice.paid", {});

    expect(records[0]?.success).toBe(false);
    expect(records[0]?.attempts).toHaveLength(3);
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it("should retry on network error (fetch throws) and succeed later", async () => {
    const mockFetch = vi
      .fn()
      .mockRejectedValueOnce(new Error("ECONNREFUSED"))
      .mockResolvedValueOnce(ok200());
    const mgr = createManager(mockFetch, { maxRetries: 3 });
    mgr.register("https://example.com/hook", "s", []);

    const records = await mgr.dispatch("invoice.paid", {});

    expect(records[0]?.success).toBe(true);
    expect(records[0]?.attempts[0]?.status).toBeNull();
    expect(records[0]?.attempts[0]?.response).toBe("ECONNREFUSED");
    expect(records[0]?.attempts[1]?.status).toBe(200);
  });

  it("should mark attempt.status as null on network error", async () => {
    const mockFetch = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    const mgr = createManager(mockFetch, { maxRetries: 2 });
    mgr.register("https://example.com/hook", "s", []);

    const records = await mgr.dispatch("invoice.paid", {});

    expect(records[0]?.attempts.every((a) => a.status === null)).toBe(true);
  });

  it("should handle maxRetries=1 (no retries, just one attempt)", async () => {
    const mockFetch = vi.fn().mockImplementation(() =>
      Promise.resolve(error500()),
    );
    const mgr = createManager(mockFetch, { maxRetries: 1 });
    mgr.register("https://example.com/hook", "s", []);

    const records = await mgr.dispatch("invoice.paid", {});

    expect(records[0]?.attempts).toHaveLength(1);
    expect(records[0]?.success).toBe(false);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("should record durationMs on each attempt", async () => {
    const mockFetch = vi.fn().mockResolvedValue(ok200());
    const mgr = createManager(mockFetch, { maxRetries: 1 });
    mgr.register("https://example.com/hook", "s", []);

    const records = await mgr.dispatch("invoice.paid", {});

    expect(records[0]?.attempts[0]?.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("should record attemptedAt ISO timestamp on each attempt", async () => {
    const mockFetch = vi.fn().mockResolvedValue(ok200());
    const mgr = createManager(mockFetch, { maxRetries: 1 });
    mgr.register("https://example.com/hook", "s", []);

    const records = await mgr.dispatch("invoice.paid", {});

    const attemptedAt = records[0]?.attempts[0]?.attemptedAt;
    expect(attemptedAt).toBeTruthy();
    expect(new Date(attemptedAt!).toISOString()).toBe(attemptedAt);
  });
});

// ---------------------------------------------------------------------------
// Delivery record tracking
// ---------------------------------------------------------------------------

describe("WebhookManager — delivery records", () => {
  it("should store delivery records accessible via getDeliveries()", async () => {
    const mockFetch = vi.fn().mockImplementation(() => Promise.resolve(ok200()));
    const mgr = createManager(mockFetch);
    mgr.register("https://example.com/hook", "s", []);

    await mgr.dispatch("compliance.check.passed", { id: "1" });
    await mgr.dispatch("invoice.created", { id: "2" });

    const deliveries = mgr.getDeliveries();
    expect(deliveries).toHaveLength(2);
  });

  it("should return deliveries in most-recent-first order", async () => {
    const mockFetch = vi.fn().mockImplementation(() => Promise.resolve(ok200()));
    const mgr = createManager(mockFetch);
    mgr.register("https://example.com/hook", "s", []);

    await mgr.dispatch("compliance.check.passed", {});
    await mgr.dispatch("invoice.created", {});
    await mgr.dispatch("invoice.paid", {});

    const deliveries = mgr.getDeliveries();
    expect(deliveries[0]?.event.type).toBe("invoice.paid");
    expect(deliveries[1]?.event.type).toBe("invoice.created");
    expect(deliveries[2]?.event.type).toBe("compliance.check.passed");
  });

  it("should assign a unique UUID id to each delivery record", async () => {
    const mockFetch = vi.fn().mockImplementation(() => Promise.resolve(ok200()));
    const mgr = createManager(mockFetch);
    mgr.register("https://example.com/hook", "s", []);

    await mgr.dispatch("invoice.paid", { n: 1 });
    await mgr.dispatch("invoice.paid", { n: 2 });

    const deliveries = mgr.getDeliveries();
    expect(deliveries[0]?.id).not.toBe(deliveries[1]?.id);
  });

  it("should record the webhookId on the delivery record", async () => {
    const mockFetch = vi.fn().mockResolvedValue(ok200());
    const mgr = createManager(mockFetch);
    const config = mgr.register("https://example.com/hook", "s", []);

    await mgr.dispatch("invoice.paid", {});

    const deliveries = mgr.getDeliveries();
    expect(deliveries[0]?.webhookId).toBe(config.id);
  });

  it("should include the full event payload in the delivery record", async () => {
    const mockFetch = vi.fn().mockResolvedValue(ok200());
    const mgr = createManager(mockFetch);
    mgr.register("https://example.com/hook", "s", []);

    await mgr.dispatch("receipt.anchored", { uid: "eas-0xabc", chain: "eip155:1" });

    const deliveries = mgr.getDeliveries();
    expect(deliveries[0]?.event.type).toBe("receipt.anchored");
    expect(deliveries[0]?.event.data).toEqual({ uid: "eas-0xabc", chain: "eip155:1" });
    expect(deliveries[0]?.event.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  it("should return an empty list when no events have been dispatched", () => {
    const mgr = createManager(vi.fn());
    expect(mgr.getDeliveries()).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Events utility — isValidEventType
// ---------------------------------------------------------------------------

describe("isValidEventType", () => {
  it("should return true for every canonical event type", () => {
    for (const type of WEBHOOK_EVENT_TYPES) {
      expect(isValidEventType(type)).toBe(true);
    }
  });

  it("should return false for an unknown string", () => {
    expect(isValidEventType("unknown.event.type")).toBe(false);
  });

  it("should return false for an empty string", () => {
    expect(isValidEventType("")).toBe(false);
  });
});
