// ---------------------------------------------------------------------------
// Webhook Types — shared types for the webhook/notification system
// ---------------------------------------------------------------------------

import type { WebhookEventType } from "./events.js";

/** Unique webhook event payload delivered to subscribers. */
export interface WebhookEvent {
  /** UUID v4 event identifier */
  id: string;
  /** Dot-separated event type, e.g. "compliance.check.passed" */
  type: WebhookEventType;
  /** ISO-8601 timestamp of event creation */
  timestamp: string;
  /** Arbitrary event-specific payload */
  data: Record<string, unknown>;
}

/** Webhook subscription configuration. */
export interface WebhookConfig {
  /** UUID v4 webhook identifier */
  id: string;
  /** HTTPS endpoint to deliver events to */
  url: string;
  /** HMAC-SHA256 shared secret for signature verification */
  secret: string;
  /** Event types this webhook subscribes to (empty = all) */
  events: WebhookEventType[];
  /** Whether the webhook is active */
  active: boolean;
  /** ISO-8601 creation timestamp */
  createdAt: string;
}

/** Record of a single webhook delivery attempt. */
export interface WebhookDelivery {
  /** Delivery attempt number (1-based) */
  attempt: number;
  /** HTTP status code returned by the endpoint, or null on network error */
  status: number | null;
  /** Response body or error message */
  response: string;
  /** ISO-8601 timestamp of the attempt */
  attemptedAt: string;
  /** Duration of the request in milliseconds */
  durationMs: number;
}

/** Full delivery record for a webhook event. */
export interface WebhookDeliveryRecord {
  /** UUID v4 delivery record identifier */
  id: string;
  /** The webhook config ID */
  webhookId: string;
  /** The event that was delivered */
  event: WebhookEvent;
  /** Whether delivery ultimately succeeded */
  success: boolean;
  /** All delivery attempts */
  attempts: WebhookDelivery[];
}
