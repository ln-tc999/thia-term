// ---------------------------------------------------------------------------
// Webhook Event Types — all event types emitted by ProofLink
// ---------------------------------------------------------------------------

/** All webhook event types supported by the system. */
export const WEBHOOK_EVENT_TYPES = [
  /** Compliance check passed — no risks detected */
  "compliance.check.passed",
  /** Compliance check failed — sanctions match, high-risk score, etc. */
  "compliance.check.failed",
  /** Compliance check needs manual review — medium-risk score */
  "compliance.check.review",
  /** New invoice created */
  "invoice.created",
  /** Invoice payment detected on-chain */
  "invoice.paid",
  /** Invoice state transition (e.g. draft → pending → paid → cancelled) */
  "invoice.state_changed",
  /** Compliance receipt anchored on-chain (ERC-8004) */
  "receipt.anchored",
] as const;

export type WebhookEventType = (typeof WEBHOOK_EVENT_TYPES)[number];

/** Human-readable descriptions for each event type. */
export const WEBHOOK_EVENT_DESCRIPTIONS: Record<WebhookEventType, string> = {
  "compliance.check.passed": "Compliance check passed — no risks detected",
  "compliance.check.failed": "Compliance check failed — sanctions match, high-risk score, etc.",
  "compliance.check.review": "Compliance check needs manual review — medium-risk score",
  "invoice.created": "New invoice created",
  "invoice.paid": "Invoice payment detected on-chain",
  "invoice.state_changed": "Invoice state transition",
  "receipt.anchored": "Compliance receipt anchored on-chain",
};

/** Check whether a string is a valid webhook event type. */
export function isValidEventType(type: string): type is WebhookEventType {
  return (WEBHOOK_EVENT_TYPES as readonly string[]).includes(type);
}
