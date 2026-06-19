// ---------------------------------------------------------------------------
// WebhookManager — register, queue, deliver, and retry webhook events
// ---------------------------------------------------------------------------

import { createHmac, randomUUID } from "node:crypto";

import type { WebhookEventType } from "./events.js";
import type {
  WebhookConfig,
  WebhookDelivery,
  WebhookDeliveryRecord,
  WebhookEvent,
} from "./types.js";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface WebhookManagerOptions {
  /** Maximum delivery attempts per event (default: 5) */
  maxRetries?: number;
  /** Base delay in ms for exponential backoff (default: 1000) */
  baseDelayMs?: number;
  /** Request timeout in ms (default: 10_000) */
  timeoutMs?: number;
  /** Custom fetch implementation (for testing) */
  fetchFn?: typeof globalThis.fetch;
}

const DEFAULT_MAX_RETRIES = 5;
const DEFAULT_BASE_DELAY_MS = 1_000;
const DEFAULT_TIMEOUT_MS = 10_000;

// ---------------------------------------------------------------------------
// Manager
// ---------------------------------------------------------------------------

export class WebhookManager {
  private readonly webhooks = new Map<string, WebhookConfig>();
  private readonly deliveries: WebhookDeliveryRecord[] = [];
  private readonly maxRetries: number;
  private readonly baseDelayMs: number;
  private readonly timeoutMs: number;
  private readonly fetchFn: typeof globalThis.fetch;

  constructor(options: WebhookManagerOptions = {}) {
    this.maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.baseDelayMs = options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.fetchFn = options.fetchFn ?? globalThis.fetch;
  }

  // -------------------------------------------------------------------------
  // Registration
  // -------------------------------------------------------------------------

  /** Register a new webhook subscription. Returns the created config. */
  register(url: string, secret: string, events: WebhookEventType[]): WebhookConfig {
    const config: WebhookConfig = {
      id: randomUUID(),
      url,
      secret,
      events,
      active: true,
      createdAt: new Date().toISOString(),
    };
    this.webhooks.set(config.id, config);
    return config;
  }

  /** Remove a webhook by ID. Returns true if it existed. */
  remove(id: string): boolean {
    return this.webhooks.delete(id);
  }

  /** List all registered webhooks. */
  list(): WebhookConfig[] {
    return [...this.webhooks.values()];
  }

  /** Get a webhook by ID. */
  get(id: string): WebhookConfig | undefined {
    return this.webhooks.get(id);
  }

  // -------------------------------------------------------------------------
  // Signature
  // -------------------------------------------------------------------------

  /** Compute HMAC-SHA256 signature for a payload. */
  static computeSignature(payload: string, secret: string): string {
    return createHmac("sha256", secret).update(payload).digest("hex");
  }

  /** Verify an incoming webhook signature. */
  static verifySignature(payload: string, secret: string, signature: string): boolean {
    const expected = WebhookManager.computeSignature(payload, secret);
    // Constant-time comparison via buffer equality
    if (expected.length !== signature.length) return false;
    const a = Buffer.from(expected, "hex");
    const b = Buffer.from(signature, "hex");
    if (a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) {
      diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
    }
    return diff === 0;
  }

  // -------------------------------------------------------------------------
  // Delivery
  // -------------------------------------------------------------------------

  /** Dispatch an event to all matching webhooks. Returns delivery records. */
  async dispatch(
    type: WebhookEventType,
    data: Record<string, unknown>,
  ): Promise<WebhookDeliveryRecord[]> {
    const event: WebhookEvent = {
      id: randomUUID(),
      type,
      timestamp: new Date().toISOString(),
      data,
    };

    const matching = [...this.webhooks.values()].filter(
      (wh) => wh.active && (wh.events.length === 0 || wh.events.includes(type)),
    );

    const records = await Promise.all(
      matching.map((wh) => this.deliverWithRetry(wh, event)),
    );

    this.deliveries.push(...records);
    return records;
  }

  /** Get all delivery records (most recent first). */
  getDeliveries(): WebhookDeliveryRecord[] {
    return [...this.deliveries].reverse();
  }

  // -------------------------------------------------------------------------
  // Internal — delivery + retry
  // -------------------------------------------------------------------------

  private async deliverWithRetry(
    webhook: WebhookConfig,
    event: WebhookEvent,
  ): Promise<WebhookDeliveryRecord> {
    const record: WebhookDeliveryRecord = {
      id: randomUUID(),
      webhookId: webhook.id,
      event,
      success: false,
      attempts: [],
    };

    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      if (attempt > 1) {
        const delay = this.baseDelayMs * 2 ** (attempt - 2);
        await this.sleep(delay);
      }

      const delivery = await this.attemptDelivery(webhook, event, attempt);
      record.attempts.push(delivery);

      if (delivery.status !== null && delivery.status >= 200 && delivery.status < 300) {
        record.success = true;
        break;
      }
    }

    return record;
  }

  private async attemptDelivery(
    webhook: WebhookConfig,
    event: WebhookEvent,
    attempt: number,
  ): Promise<WebhookDelivery> {
    const payload = JSON.stringify(event);
    const signature = WebhookManager.computeSignature(payload, webhook.secret);
    const start = Date.now();

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);

      const response = await this.fetchFn(webhook.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-ProofLink-Signature": signature,
          "X-ProofLink-Event": event.type,
          "X-ProofLink-Delivery": event.id,
        },
        body: payload,
        signal: controller.signal,
      });

      clearTimeout(timer);

      const body = await response.text();
      return {
        attempt,
        status: response.status,
        response: body.slice(0, 4096),
        attemptedAt: new Date().toISOString(),
        durationMs: Date.now() - start,
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return {
        attempt,
        status: null,
        response: message,
        attemptedAt: new Date().toISOString(),
        durationMs: Date.now() - start,
      };
    }
  }

  /** Overridable sleep for testing. */
  protected sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
