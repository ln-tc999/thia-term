import { describe, expect, it, vi, beforeEach } from "vitest";

import { WebhookManager } from "../manager.js";
import type { WebhookEventType } from "../events.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ok200(): Response {
  return new Response("ok", { status: 200 });
}

function error500(): Response {
  return new Response("internal error", { status: 500 });
}

/** Create a manager that skips sleep and uses a mock fetch. */
function createManager(
  fetchFn: ReturnType<typeof vi.fn>,
  opts?: { maxRetries?: number },
): WebhookManager {
  const manager = new WebhookManager({
    maxRetries: opts?.maxRetries ?? 3,
    baseDelayMs: 1, // effectively instant for tests
    timeoutMs: 5_000,
    fetchFn: fetchFn as unknown as typeof globalThis.fetch,
  });
  return manager;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("WebhookManager", () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
  });

  // -----------------------------------------------------------------------
  // Registration
  // -----------------------------------------------------------------------

  describe("registration", () => {
    it("registers a webhook and returns config with ID", () => {
      const mgr = createManager(mockFetch);
      const config = mgr.register("https://example.com/hook", "secret123", [
        "compliance.check.passed",
      ]);

      expect(config.id).toBeTruthy();
      expect(config.url).toBe("https://example.com/hook");
      expect(config.secret).toBe("secret123");
      expect(config.events).toEqual(["compliance.check.passed"]);
      expect(config.active).toBe(true);
    });

    it("lists registered webhooks", () => {
      const mgr = createManager(mockFetch);
      mgr.register("https://a.com/hook", "s1", ["invoice.created"]);
      mgr.register("https://b.com/hook", "s2", ["invoice.paid"]);

      expect(mgr.list()).toHaveLength(2);
    });

    it("removes a webhook by ID", () => {
      const mgr = createManager(mockFetch);
      const config = mgr.register("https://a.com/hook", "s1", []);
      expect(mgr.remove(config.id)).toBe(true);
      expect(mgr.list()).toHaveLength(0);
    });

    it("returns false when removing non-existent ID", () => {
      const mgr = createManager(mockFetch);
      expect(mgr.remove("nonexistent")).toBe(false);
    });

    it("gets a webhook by ID", () => {
      const mgr = createManager(mockFetch);
      const config = mgr.register("https://a.com/hook", "s1", []);
      expect(mgr.get(config.id)).toEqual(config);
      expect(mgr.get("nonexistent")).toBeUndefined();
    });
  });

  // -----------------------------------------------------------------------
  // Signature verification
  // -----------------------------------------------------------------------

  describe("signature", () => {
    it("computes deterministic HMAC-SHA256 signatures", () => {
      const sig1 = WebhookManager.computeSignature('{"test":true}', "secret");
      const sig2 = WebhookManager.computeSignature('{"test":true}', "secret");
      expect(sig1).toBe(sig2);
      expect(sig1).toHaveLength(64); // 256 bits = 64 hex chars
    });

    it("produces different signatures for different secrets", () => {
      const sig1 = WebhookManager.computeSignature("payload", "secret-a");
      const sig2 = WebhookManager.computeSignature("payload", "secret-b");
      expect(sig1).not.toBe(sig2);
    });

    it("verifies a valid signature", () => {
      const payload = '{"event":"test"}';
      const secret = "my-secret";
      const sig = WebhookManager.computeSignature(payload, secret);
      expect(WebhookManager.verifySignature(payload, secret, sig)).toBe(true);
    });

    it("rejects an invalid signature", () => {
      const payload = '{"event":"test"}';
      expect(
        WebhookManager.verifySignature(payload, "secret", "0".repeat(64)),
      ).toBe(false);
    });

    it("rejects signatures of wrong length", () => {
      expect(
        WebhookManager.verifySignature("payload", "secret", "tooshort"),
      ).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // Delivery
  // -----------------------------------------------------------------------

  describe("delivery", () => {
    it("delivers an event to a matching webhook", async () => {
      mockFetch.mockResolvedValue(ok200());
      const mgr = createManager(mockFetch);
      mgr.register("https://example.com/hook", "secret", [
        "compliance.check.passed",
      ]);

      const records = await mgr.dispatch("compliance.check.passed", {
        checkId: "abc",
      });

      expect(records).toHaveLength(1);
      expect(records[0]?.success).toBe(true);
      expect(records[0]?.attempts).toHaveLength(1);
      expect(records[0]?.attempts[0]?.status).toBe(200);
      expect(mockFetch).toHaveBeenCalledTimes(1);

      // Verify headers
      const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toBe("https://example.com/hook");
      const headers = init.headers as Record<string, string>;
      expect(headers["Content-Type"]).toBe("application/json");
      expect(headers["X-ProofLink-Signature"]).toBeTruthy();
      expect(headers["X-ProofLink-Event"]).toBe("compliance.check.passed");
    });

    it("skips webhooks not subscribed to the event type", async () => {
      mockFetch.mockResolvedValue(ok200());
      const mgr = createManager(mockFetch);
      mgr.register("https://example.com/hook", "secret", ["invoice.created"]);

      const records = await mgr.dispatch("compliance.check.passed", {});

      expect(records).toHaveLength(0);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("delivers to webhooks subscribed to all events (empty events array)", async () => {
      mockFetch.mockResolvedValue(ok200());
      const mgr = createManager(mockFetch);
      mgr.register("https://example.com/hook", "secret", []);

      const records = await mgr.dispatch("invoice.paid", { invoiceId: "123" });

      expect(records).toHaveLength(1);
      expect(records[0]?.success).toBe(true);
    });

    it("includes correct signature in delivery", async () => {
      mockFetch.mockResolvedValue(ok200());
      const mgr = createManager(mockFetch);
      const config = mgr.register("https://example.com/hook", "test-secret", [
        "invoice.created",
      ]);

      await mgr.dispatch("invoice.created", { invoiceId: "456" });

      const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
      const headers = init.headers as Record<string, string>;
      const signature = headers["X-ProofLink-Signature"];
      const body = init.body as string;

      expect(
        WebhookManager.verifySignature(body, "test-secret", signature!),
      ).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // Retry logic
  // -----------------------------------------------------------------------

  describe("retry", () => {
    it("retries on server error and succeeds on later attempt", async () => {
      mockFetch
        .mockResolvedValueOnce(error500())
        .mockResolvedValueOnce(ok200());

      const mgr = createManager(mockFetch, { maxRetries: 3 });
      mgr.register("https://example.com/hook", "secret", [
        "compliance.check.failed",
      ]);

      const records = await mgr.dispatch("compliance.check.failed", {});

      expect(records).toHaveLength(1);
      expect(records[0]?.success).toBe(true);
      expect(records[0]?.attempts).toHaveLength(2);
      expect(records[0]?.attempts[0]?.status).toBe(500);
      expect(records[0]?.attempts[1]?.status).toBe(200);
    });

    it("exhausts retries and marks delivery as failed", async () => {
      mockFetch.mockResolvedValue(error500());

      const mgr = createManager(mockFetch, { maxRetries: 3 });
      mgr.register("https://example.com/hook", "secret", [
        "receipt.anchored",
      ]);

      const records = await mgr.dispatch("receipt.anchored", {});

      expect(records).toHaveLength(1);
      expect(records[0]?.success).toBe(false);
      expect(records[0]?.attempts).toHaveLength(3);
      expect(mockFetch).toHaveBeenCalledTimes(3);
    });

    it("retries on network error (fetch throws)", async () => {
      mockFetch
        .mockRejectedValueOnce(new Error("ECONNREFUSED"))
        .mockResolvedValueOnce(ok200());

      const mgr = createManager(mockFetch, { maxRetries: 3 });
      mgr.register("https://example.com/hook", "secret", [
        "invoice.state_changed",
      ]);

      const records = await mgr.dispatch("invoice.state_changed", {});

      expect(records).toHaveLength(1);
      expect(records[0]?.success).toBe(true);
      expect(records[0]?.attempts).toHaveLength(2);
      expect(records[0]?.attempts[0]?.status).toBeNull();
      expect(records[0]?.attempts[0]?.response).toBe("ECONNREFUSED");
    });
  });

  // -----------------------------------------------------------------------
  // Delivery history
  // -----------------------------------------------------------------------

  describe("delivery history", () => {
    it("stores delivery records accessible via getDeliveries()", async () => {
      mockFetch.mockResolvedValue(ok200());
      const mgr = createManager(mockFetch);
      mgr.register("https://example.com/hook", "secret", []);

      await mgr.dispatch("compliance.check.passed", { id: "1" });
      await mgr.dispatch("invoice.created", { id: "2" });

      const deliveries = mgr.getDeliveries();
      expect(deliveries).toHaveLength(2);
      // Most recent first
      expect(deliveries[0]?.event.type).toBe("invoice.created");
      expect(deliveries[1]?.event.type).toBe("compliance.check.passed");
    });
  });
});
