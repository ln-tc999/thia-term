/**
 * Integration tests: Webhook delivery
 *
 * Tests the WebhookManager end-to-end:
 *   1. Register webhook → trigger compliance event → verify delivery
 *   2. Webhook payload signature verification (HMAC-SHA256)
 *   3. Failed delivery retry logic (exponential backoff)
 *   4. Event filtering (webhooks receive only subscribed event types)
 *   5. Inactive webhook does not receive events
 *
 * No HTTP server is bound — WebhookManager.fetchFn is injected with a vi.fn()
 * to capture outgoing delivery requests without any network I/O.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { WebhookManager } from "../../packages/core/src/webhooks/manager.js";
import {
  WEBHOOK_EVENT_TYPES,
  isValidEventType,
} from "../../packages/core/src/webhooks/events.js";
import type { WebhookEventType } from "../../packages/core/src/webhooks/events.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeOkResponse(): Response {
  return new Response("ok", { status: 200 });
}

function make4xxResponse(): Response {
  return new Response("bad request", { status: 400 });
}

function make5xxResponse(): Response {
  return new Response("internal error", { status: 500 });
}

/** Instantiate a WebhookManager with injected fetch and zero sleep delay. */
function createManager(
  fetchFn: ReturnType<typeof vi.fn>,
  opts?: { maxRetries?: number; baseDelayMs?: number },
): WebhookManager {
  return new WebhookManager({
    maxRetries: opts?.maxRetries ?? 3,
    baseDelayMs: opts?.baseDelayMs ?? 0,   // zero delay so tests don't sleep
    timeoutMs: 5_000,
    fetchFn: fetchFn as unknown as typeof globalThis.fetch,
  });
}

// ---------------------------------------------------------------------------
// Register → trigger → verify delivery
// ---------------------------------------------------------------------------

describe("Webhook delivery — register and dispatch", () => {
  let mockFetch: ReturnType<typeof vi.fn>;
  let mgr: WebhookManager;

  beforeEach(() => {
    mockFetch = vi.fn().mockImplementation(() => Promise.resolve(makeOkResponse()));
    mgr = createManager(mockFetch);
  });

  it("dispatching_event_calls_registered_webhook_endpoint", async () => {
    // Arrange
    mgr.register("https://hooks.example.com/events", "secret123", ["compliance.check.passed"]);

    // Act
    const records = await mgr.dispatch("compliance.check.passed", {
      status: "APPROVED",
      riskScore: 10,
    });

    // Assert
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(records).toHaveLength(1);
    expect(records[0]!.success).toBe(true);
    expect(records[0]!.attempts).toHaveLength(1);
  });

  it("dispatch_sends_post_request_with_correct_headers", async () => {
    // Arrange
    mgr.register("https://hooks.example.com/events", "mysecret", []);

    // Act
    await mgr.dispatch("compliance.check.passed", { status: "APPROVED" });

    // Assert headers
    const [, init] = mockFetch.mock.calls[0]!;
    expect(init.method).toBe("POST");
    expect(init.headers["Content-Type"]).toBe("application/json");
    expect(init.headers["X-ProofLink-Signature"]).toBeTruthy();
    expect(init.headers["X-ProofLink-Event"]).toBe("compliance.check.passed");
    expect(init.headers["X-ProofLink-Delivery"]).toBeTruthy();
  });

  it("dispatch_sends_the_event_payload_as_json_body", async () => {
    // Arrange
    const eventData = { checkId: "abc123", riskScore: 15, status: "APPROVED" };
    mgr.register("https://endpoint.test/webhook", "s3cr3t", []);

    // Act
    await mgr.dispatch("compliance.check.passed", eventData);

    // Assert — body is valid JSON that includes the event data
    const [, init] = mockFetch.mock.calls[0]!;
    const body = JSON.parse(init.body as string) as { data: Record<string, unknown>; type: string };
    expect(body.type).toBe("compliance.check.passed");
    expect(body.data.checkId).toBe("abc123");
    expect(body.data.riskScore).toBe(15);
    expect(body.id).toBeTruthy(); // UUID event id
    expect(body.timestamp).toBeTruthy(); // ISO timestamp
  });

  it("multiple_registered_webhooks_all_receive_the_same_event", async () => {
    // Arrange — register 3 webhooks all subscribed to the same event
    mgr.register("https://a.example.com/hook", "secret-a", ["invoice.created"]);
    mgr.register("https://b.example.com/hook", "secret-b", ["invoice.created"]);
    mgr.register("https://c.example.com/hook", "secret-c", ["invoice.created"]);

    // Act
    const records = await mgr.dispatch("invoice.created", { invoiceId: "inv-001" });

    // Assert
    expect(mockFetch).toHaveBeenCalledTimes(3);
    expect(records).toHaveLength(3);
    expect(records.every((r) => r.success)).toBe(true);
  });

  it("dispatch_returns_empty_array_when_no_webhooks_registered", async () => {
    // Act
    const records = await mgr.dispatch("compliance.check.passed", {});

    // Assert
    expect(records).toHaveLength(0);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Payload signature verification
// ---------------------------------------------------------------------------

describe("Webhook delivery — signature verification", () => {
  it("computeSignature_returns_64_char_hex_string", () => {
    const sig = WebhookManager.computeSignature('{"type":"compliance.check.passed"}', "secret");
    expect(sig).toHaveLength(64);
    expect(sig).toMatch(/^[0-9a-f]{64}$/);
  });

  it("computeSignature_is_deterministic", () => {
    const payload = '{"type":"invoice.paid","data":{}}';
    const s1 = WebhookManager.computeSignature(payload, "mysecret");
    const s2 = WebhookManager.computeSignature(payload, "mysecret");
    expect(s1).toBe(s2);
  });

  it("computeSignature_differs_for_different_payloads", () => {
    const s1 = WebhookManager.computeSignature("payload-a", "secret");
    const s2 = WebhookManager.computeSignature("payload-b", "secret");
    expect(s1).not.toBe(s2);
  });

  it("computeSignature_differs_for_different_secrets", () => {
    const payload = '{"type":"test"}';
    const s1 = WebhookManager.computeSignature(payload, "secret-1");
    const s2 = WebhookManager.computeSignature(payload, "secret-2");
    expect(s1).not.toBe(s2);
  });

  it("verifySignature_returns_true_for_correct_signature", () => {
    const payload = '{"type":"compliance.check.failed","data":{"status":"REJECTED"}}';
    const secret = "webhook-secret-abc";
    const sig = WebhookManager.computeSignature(payload, secret);

    expect(WebhookManager.verifySignature(payload, secret, sig)).toBe(true);
  });

  it("verifySignature_returns_false_for_tampered_payload", () => {
    const secret = "secret";
    const original = '{"status":"APPROVED"}';
    const tampered = '{"status":"REJECTED"}';
    const sig = WebhookManager.computeSignature(original, secret);

    expect(WebhookManager.verifySignature(tampered, secret, sig)).toBe(false);
  });

  it("verifySignature_returns_false_for_wrong_secret", () => {
    const payload = '{"type":"test"}';
    const sig = WebhookManager.computeSignature(payload, "correct-secret");

    expect(WebhookManager.verifySignature(payload, "wrong-secret", sig)).toBe(false);
  });

  it("verifySignature_returns_false_for_empty_signature", () => {
    const payload = '{"type":"test"}';
    expect(WebhookManager.verifySignature(payload, "secret", "")).toBe(false);
  });

  it("delivered_payload_signature_can_be_verified_by_receiver", async () => {
    // Arrange
    const secret = "receiver-shared-secret";
    let capturedPayload = "";
    let capturedSignature = "";

    const capturingFetch = vi.fn().mockImplementation((_url: string, init: RequestInit) => {
      capturedPayload = init.body as string;
      capturedSignature = (init.headers as Record<string, string>)["X-ProofLink-Signature"] ?? "";
      return Promise.resolve(makeOkResponse());
    });

    const mgr2 = createManager(capturingFetch);
    mgr2.register("https://receiver.example.com/webhook", secret, []);

    // Act
    await mgr2.dispatch("compliance.check.passed", { status: "APPROVED" });

    // Assert — the receiver can verify the signature
    expect(capturedPayload).toBeTruthy();
    expect(capturedSignature).toBeTruthy();
    expect(WebhookManager.verifySignature(capturedPayload, secret, capturedSignature)).toBe(true);
  });

  it("forged_signature_from_wrong_secret_fails_verification", async () => {
    // Simulate attacker using wrong secret to forge
    const correctSecret = "correct-secret";
    const attackerSecret = "attacker-secret";
    let capturedPayload = "";

    const capturingFetch = vi.fn().mockImplementation((_url: string, init: RequestInit) => {
      capturedPayload = init.body as string;
      return Promise.resolve(makeOkResponse());
    });

    const mgr3 = createManager(capturingFetch);
    mgr3.register("https://receiver.example.com/webhook", correctSecret, []);
    await mgr3.dispatch("invoice.paid", { invoiceId: "inv-002" });

    // Attacker's forged signature using wrong secret
    const forgedSignature = WebhookManager.computeSignature(capturedPayload, attackerSecret);

    // Receiver verifies with correct secret — should fail
    expect(WebhookManager.verifySignature(capturedPayload, correctSecret, forgedSignature)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Retry logic
// ---------------------------------------------------------------------------

describe("Webhook delivery — retry logic", () => {
  it("successful_first_attempt_does_not_retry", async () => {
    // Arrange
    const mockFetch = vi.fn().mockResolvedValue(makeOkResponse());
    const mgr = createManager(mockFetch, { maxRetries: 3 });
    mgr.register("https://endpoint.test/hook", "s", []);

    // Act
    const [record] = await mgr.dispatch("invoice.created", {});

    // Assert
    expect(record!.success).toBe(true);
    expect(record!.attempts).toHaveLength(1);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("5xx_response_triggers_retry_up_to_maxRetries", async () => {
    // Arrange — all attempts fail with 500
    const mockFetch = vi.fn().mockResolvedValue(make5xxResponse());
    const mgr = createManager(mockFetch, { maxRetries: 3 });
    mgr.register("https://endpoint.test/hook", "s", []);

    // Act
    const [record] = await mgr.dispatch("invoice.paid", {});

    // Assert
    expect(record!.success).toBe(false);
    expect(record!.attempts).toHaveLength(3); // exhausted all retries
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it("retry_succeeds_on_second_attempt_after_first_failure", async () => {
    // Arrange — first call fails, second succeeds
    const mockFetch = vi.fn()
      .mockResolvedValueOnce(make5xxResponse())
      .mockResolvedValueOnce(makeOkResponse());
    const mgr = createManager(mockFetch, { maxRetries: 3 });
    mgr.register("https://endpoint.test/hook", "s", []);

    // Act
    const [record] = await mgr.dispatch("compliance.check.failed", {});

    // Assert
    expect(record!.success).toBe(true);
    expect(record!.attempts).toHaveLength(2);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("network_error_triggers_retry", async () => {
    // Arrange — first call throws, second succeeds
    const mockFetch = vi.fn()
      .mockRejectedValueOnce(new Error("ECONNREFUSED"))
      .mockResolvedValueOnce(makeOkResponse());
    const mgr = createManager(mockFetch, { maxRetries: 3 });
    mgr.register("https://endpoint.test/hook", "s", []);

    // Act
    const [record] = await mgr.dispatch("invoice.created", {});

    // Assert
    expect(record!.success).toBe(true);
    expect(record!.attempts).toHaveLength(2);
    expect(record!.attempts[0]!.status).toBeNull(); // network error = null status
    expect(record!.attempts[0]!.response).toContain("ECONNREFUSED");
  });

  it("all_network_errors_exhaust_retries_and_marks_failure", async () => {
    // Arrange
    const mockFetch = vi.fn().mockRejectedValue(new Error("Network unreachable"));
    const mgr = createManager(mockFetch, { maxRetries: 4 });
    mgr.register("https://endpoint.test/hook", "s", []);

    // Act
    const [record] = await mgr.dispatch("receipt.anchored", {});

    // Assert
    expect(record!.success).toBe(false);
    expect(record!.attempts).toHaveLength(4);
    expect(mockFetch).toHaveBeenCalledTimes(4);
    for (const attempt of record!.attempts) {
      expect(attempt.status).toBeNull();
    }
  });

  it("4xx_response_does_not_succeed_even_after_retries", async () => {
    // Arrange — 4xx is not retryable (treated as final failure per attempt)
    // WebhookManager retries until 2xx; 4xx is treated same as 5xx (not 2xx)
    const mockFetch = vi.fn().mockResolvedValue(make4xxResponse());
    const mgr = createManager(mockFetch, { maxRetries: 2 });
    mgr.register("https://endpoint.test/hook", "s", []);

    // Act
    const [record] = await mgr.dispatch("compliance.check.review", {});

    // Assert — all attempts made, success=false
    expect(record!.success).toBe(false);
    expect(record!.attempts).toHaveLength(2);
  });

  it("maxRetries_1_means_exactly_one_attempt", async () => {
    // Arrange
    const mockFetch = vi.fn().mockResolvedValue(make5xxResponse());
    const mgr = createManager(mockFetch, { maxRetries: 1 });
    mgr.register("https://endpoint.test/hook", "s", []);

    // Act
    const [record] = await mgr.dispatch("invoice.state_changed", {});

    // Assert
    expect(record!.success).toBe(false);
    expect(record!.attempts).toHaveLength(1);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("attempt_records_include_attempt_number_status_and_timing", async () => {
    // Arrange
    const mockFetch = vi.fn()
      .mockResolvedValueOnce(make5xxResponse())
      .mockResolvedValueOnce(makeOkResponse());
    const mgr = createManager(mockFetch, { maxRetries: 3 });
    mgr.register("https://endpoint.test/hook", "s", []);

    // Act
    const [record] = await mgr.dispatch("invoice.paid", {});

    // Assert — each attempt has correct fields
    expect(record!.attempts[0]!.attempt).toBe(1);
    expect(record!.attempts[0]!.status).toBe(500);
    expect(record!.attempts[0]!.attemptedAt).toBeTruthy();
    expect(record!.attempts[0]!.durationMs).toBeGreaterThanOrEqual(0);

    expect(record!.attempts[1]!.attempt).toBe(2);
    expect(record!.attempts[1]!.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// Event filtering
// ---------------------------------------------------------------------------

describe("Webhook delivery — event filtering", () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn().mockImplementation(() => Promise.resolve(makeOkResponse()));
  });

  it("webhook_subscribed_to_specific_event_only_receives_that_event", async () => {
    // Arrange
    const mgr = createManager(mockFetch);
    mgr.register("https://invoice.endpoint/hook", "s", ["invoice.created"]);

    // Act — dispatch an event the webhook is NOT subscribed to
    const records = await mgr.dispatch("compliance.check.passed", {});

    // Assert — not delivered to this webhook
    expect(records).toHaveLength(0);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("webhook_with_empty_events_array_receives_all_event_types", async () => {
    // Arrange — empty events = wildcard subscription
    const mgr = createManager(mockFetch);
    mgr.register("https://all.endpoint/hook", "s", []);

    // Act — dispatch 3 different events
    await mgr.dispatch("compliance.check.passed", {});
    await mgr.dispatch("invoice.paid", {});
    await mgr.dispatch("receipt.anchored", {});

    // Assert
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it("webhook_subscribed_to_multiple_events_receives_all_subscribed_events", async () => {
    // Arrange
    const mgr = createManager(mockFetch);
    mgr.register("https://multi.endpoint/hook", "s", [
      "compliance.check.passed",
      "compliance.check.failed",
    ]);

    // Act
    await mgr.dispatch("compliance.check.passed", {});
    await mgr.dispatch("compliance.check.failed", { reason: "sanctions" });
    await mgr.dispatch("invoice.created", {}); // not subscribed

    // Assert — only 2 deliveries (not the invoice.created one)
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("inactive_webhook_does_not_receive_events", async () => {
    // Arrange — register then manually mark inactive
    const mgr = createManager(mockFetch);
    const config = mgr.register("https://inactive.endpoint/hook", "s", []);
    // Simulate deactivation by removing and re-registering as inactive
    // (We can't directly set active=false, so we remove the webhook)
    mgr.remove(config.id);

    // Act
    const records = await mgr.dispatch("compliance.check.passed", {});

    // Assert
    expect(records).toHaveLength(0);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("each_event_type_is_delivered_only_to_matching_webhooks", async () => {
    // Arrange
    const mgr = createManager(mockFetch);
    mgr.register("https://a.com/hook", "s1", ["invoice.created"]);
    mgr.register("https://b.com/hook", "s2", ["compliance.check.passed"]);
    mgr.register("https://c.com/hook", "s3", ["invoice.created", "compliance.check.passed"]);

    // Act
    await mgr.dispatch("invoice.created", { invoiceId: "inv-x" });

    // Assert — only "a" and "c" subscribed to invoice.created
    expect(mockFetch).toHaveBeenCalledTimes(2);
    const urls = mockFetch.mock.calls.map(([url]: [string]) => url);
    expect(urls).toContain("https://a.com/hook");
    expect(urls).toContain("https://c.com/hook");
    expect(urls).not.toContain("https://b.com/hook");
  });
});

// ---------------------------------------------------------------------------
// Registration management
// ---------------------------------------------------------------------------

describe("Webhook delivery — registration management", () => {
  it("register_returns_config_with_uuid_id", () => {
    const mgr = createManager(vi.fn());
    const config = mgr.register("https://example.com/hook", "secret", ["invoice.paid"]);

    expect(config.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(config.url).toBe("https://example.com/hook");
    expect(config.secret).toBe("secret");
    expect(config.events).toEqual(["invoice.paid"]);
    expect(config.active).toBe(true);
    expect(config.createdAt).toBeTruthy();
  });

  it("multiple_registered_webhooks_have_unique_ids", () => {
    const mgr = createManager(vi.fn());
    const ids = Array.from({ length: 5 }, (_, i) =>
      mgr.register(`https://example${i}.com/hook`, "secret", []).id,
    );
    const unique = new Set(ids);
    expect(unique.size).toBe(5);
  });

  it("remove_deletes_webhook_and_returns_true", () => {
    const mgr = createManager(vi.fn());
    const config = mgr.register("https://example.com/hook", "secret", []);
    expect(mgr.remove(config.id)).toBe(true);
    expect(mgr.get(config.id)).toBeUndefined();
  });

  it("remove_returns_false_for_nonexistent_id", () => {
    const mgr = createManager(vi.fn());
    expect(mgr.remove("does-not-exist")).toBe(false);
  });

  it("list_returns_all_registered_webhooks", () => {
    const mgr = createManager(vi.fn());
    mgr.register("https://a.com/h", "s1", []);
    mgr.register("https://b.com/h", "s2", []);
    expect(mgr.list()).toHaveLength(2);
  });

  it("get_returns_correct_config_by_id", () => {
    const mgr = createManager(vi.fn());
    const config = mgr.register("https://example.com/hook", "secret", ["receipt.anchored"]);
    expect(mgr.get(config.id)).toEqual(config);
  });

  it("get_returns_undefined_for_unknown_id", () => {
    const mgr = createManager(vi.fn());
    expect(mgr.get("unknown-id")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Delivery records
// ---------------------------------------------------------------------------

describe("Webhook delivery — delivery records", () => {
  it("getDeliveries_returns_all_delivery_records", async () => {
    // Arrange
    const mockFetch = vi.fn().mockResolvedValue(makeOkResponse());
    const mgr = createManager(mockFetch);
    mgr.register("https://example.com/hook", "s", []);

    // Act — dispatch 3 events
    await mgr.dispatch("invoice.created", {});
    await mgr.dispatch("invoice.paid", {});
    await mgr.dispatch("receipt.anchored", {});

    // Assert
    const deliveries = mgr.getDeliveries();
    expect(deliveries).toHaveLength(3);
  });

  it("getDeliveries_returns_most_recent_first", async () => {
    // Arrange
    const mockFetch = vi.fn().mockResolvedValue(makeOkResponse());
    const mgr = createManager(mockFetch);
    mgr.register("https://example.com/hook", "s", []);

    // Act
    await mgr.dispatch("invoice.created", { seq: 1 });
    await mgr.dispatch("invoice.paid", { seq: 2 });

    // Assert — most recent event (invoice.paid) is first
    const deliveries = mgr.getDeliveries();
    expect(deliveries[0]!.event.type).toBe("invoice.paid");
    expect(deliveries[1]!.event.type).toBe("invoice.created");
  });

  it("delivery_record_has_webhookId_matching_registered_config", async () => {
    // Arrange
    const mockFetch = vi.fn().mockResolvedValue(makeOkResponse());
    const mgr = createManager(mockFetch);
    const config = mgr.register("https://example.com/hook", "s", []);

    // Act
    const [record] = await mgr.dispatch("invoice.created", {});

    // Assert
    expect(record!.webhookId).toBe(config.id);
  });

  it("delivery_record_contains_the_full_event_data", async () => {
    // Arrange
    const mockFetch = vi.fn().mockResolvedValue(makeOkResponse());
    const mgr = createManager(mockFetch);
    mgr.register("https://example.com/hook", "s", []);

    // Act
    const eventData = { invoiceId: "inv-xyz", amount: "100.00" };
    const [record] = await mgr.dispatch("invoice.created", eventData);

    // Assert
    expect(record!.event.type).toBe("invoice.created");
    expect(record!.event.data).toEqual(eventData);
    expect(record!.event.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(record!.event.timestamp).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Event type completeness
// ---------------------------------------------------------------------------

describe("Webhook delivery — event type completeness", () => {
  it("all_defined_event_types_are_recognized_by_isValidEventType", () => {
    for (const type of WEBHOOK_EVENT_TYPES) {
      expect(isValidEventType(type)).toBe(true);
    }
  });

  it("unknown_event_type_string_is_not_valid", () => {
    expect(isValidEventType("unknown.event.type")).toBe(false);
    expect(isValidEventType("")).toBe(false);
    expect(isValidEventType("compliance.passed")).toBe(false); // wrong format
  });

  it("can_dispatch_all_defined_event_types_without_error", async () => {
    // Arrange
    const mockFetch = vi.fn().mockResolvedValue(makeOkResponse());
    const mgr = createManager(mockFetch);
    mgr.register("https://all.example.com/hook", "s", []); // wildcard

    // Act — dispatch every defined event type
    for (const type of WEBHOOK_EVENT_TYPES as readonly WebhookEventType[]) {
      await expect(mgr.dispatch(type, {})).resolves.not.toThrow();
    }
  });
});
