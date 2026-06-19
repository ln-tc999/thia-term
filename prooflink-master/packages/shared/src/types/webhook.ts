import { z } from "zod";

// ---------------------------------------------------------------------------
// Webhook Event Type
// ---------------------------------------------------------------------------

export const WebhookEventType = z.enum([
  "compliance.check.completed",
  "compliance.check.failed",
  "compliance.sanctions.match",
  "payment.completed",
  "payment.blocked",
  "payment.failed",
  "travel_rule.transmitted",
  "travel_rule.acknowledged",
  "travel_rule.failed",
  "invoice.created",
  "invoice.paid",
  "invoice.disputed",
  "kya.verified",
  "kya.failed",
  "attestation.created",
]);
export type WebhookEventType = z.infer<typeof WebhookEventType>;

// ---------------------------------------------------------------------------
// Webhook Config
// ---------------------------------------------------------------------------

export const WebhookConfig = z.object({
  id: z.string(),
  url: z.string().url(),
  secret: z.string().min(16),
  events: z.array(WebhookEventType).min(1),
  enabled: z.boolean().default(true),
  /** Max retry attempts on delivery failure. */
  maxRetries: z.number().int().min(0).max(10).default(3),
  /** Timeout in milliseconds for webhook delivery. */
  timeoutMs: z.number().int().positive().default(10_000),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type WebhookConfig = z.infer<typeof WebhookConfig>;

// ---------------------------------------------------------------------------
// Webhook Event
// ---------------------------------------------------------------------------

export const WebhookEvent = z.object({
  id: z.string(),
  type: WebhookEventType,
  timestamp: z.string().datetime(),
  payload: z.record(z.string(), z.unknown()),
  /** Idempotency key — consumers should deduplicate on this. */
  idempotencyKey: z.string(),
});
export type WebhookEvent = z.infer<typeof WebhookEvent>;

// ---------------------------------------------------------------------------
// Webhook Delivery
// ---------------------------------------------------------------------------

export const WebhookDeliveryStatus = z.enum([
  "pending",
  "delivered",
  "failed",
  "retrying",
]);
export type WebhookDeliveryStatus = z.infer<typeof WebhookDeliveryStatus>;

export const WebhookDelivery = z.object({
  id: z.string(),
  webhookId: z.string(),
  eventId: z.string(),
  status: WebhookDeliveryStatus,
  httpStatusCode: z.number().int().optional(),
  attempt: z.number().int().min(1),
  maxAttempts: z.number().int().positive(),
  nextRetryAt: z.string().datetime().optional(),
  responseBody: z.string().optional(),
  errorMessage: z.string().optional(),
  deliveredAt: z.string().datetime().optional(),
  createdAt: z.string().datetime(),
});
export type WebhookDelivery = z.infer<typeof WebhookDelivery>;

// ---------------------------------------------------------------------------
// Webhook Subscription (client-facing create/update shape)
// ---------------------------------------------------------------------------

export const WebhookSubscription = z.object({
  url: z.string().url(),
  events: z.array(WebhookEventType).min(1),
  enabled: z.boolean().default(true),
  maxRetries: z.number().int().min(0).max(10).default(3),
  timeoutMs: z.number().int().positive().default(10_000),
});
export type WebhookSubscription = z.infer<typeof WebhookSubscription>;
