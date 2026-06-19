import { randomUUID } from "node:crypto";

import { broadcastWsEvent } from "../routes/ws.js";
import { writeAuditLog } from "./audit.js";
import { logger } from "./logger.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ComplianceEventType =
  | "compliance.check.passed"
  | "compliance.check.failed"
  | "compliance.check.review"
  | "sanctions.alert"
  | "invoice.created"
  | "invoice.paid"
  | "escrow.created"
  | "escrow.funded"
  | "escrow.activated"
  | "escrow.completed"
  | "escrow.disputed"
  | "escrow.refunded"
  | "escrow.expired";

interface ComplianceEvent {
  type: ComplianceEventType;
  data: Record<string, unknown>;
  timestamp: string;
  id: string;
  traceId?: string;
}

// ---------------------------------------------------------------------------
// Audit log integration
// ---------------------------------------------------------------------------

function fireAuditLog(eventType: string, payload: Record<string, unknown>, extras?: {
  receiptId?: string;
  invoiceId?: string;
  agentDid?: string;
  apiKeyId?: string;
}): void {
  try {
    writeAuditLog({
      eventType,
      payload,
      ...extras,
    });
  } catch (err: unknown) {
    // writeAuditLog is fire-and-forget and should not throw, but guard anyway.
    logger.warn("fireAuditLog: unexpected synchronous error", {
      eventType,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// ---------------------------------------------------------------------------
// emitComplianceEvent — broadcast + audit persistence
// ---------------------------------------------------------------------------

/**
 * Emit a typed compliance event. Broadcasts to all connected WebSocket
 * clients and persists to the audit log (fire-and-forget).
 */
export function emitComplianceEvent(
  type: ComplianceEventType,
  data: Record<string, unknown>,
  options?: { traceId?: string; receiptId?: string; invoiceId?: string; agentDid?: string; apiKeyId?: string },
): ComplianceEvent {
  const event: ComplianceEvent = {
    type,
    data,
    timestamp: new Date().toISOString(),
    id: randomUUID(),
    ...(options?.traceId ? { traceId: options.traceId } : {}),
  };

  // Broadcast to WebSocket clients (tenant-scoped when apiKeyId is provided)
  // Cast to WsEvent — ComplianceEventType is a superset of WsEventType;
  // extra event types are forwarded to clients that subscribe to them
  broadcastWsEvent({
    ...event,
    ...(options?.apiKeyId ? { apiKeyId: options.apiKeyId } : {}),
  } as unknown as Parameters<typeof broadcastWsEvent>[0]);

  // Fire-and-forget audit persistence
  fireAuditLog(`event.${type}`, {
    eventId: event.id,
    ...data,
    ...(options?.traceId ? { traceId: options.traceId } : {}),
  }, {
    receiptId: options?.receiptId,
    invoiceId: options?.invoiceId,
    agentDid: options?.agentDid,
    apiKeyId: options?.apiKeyId,
  });

  logger.info("Compliance event emitted", { eventType: type, eventId: event.id });

  return event;
}

// ---------------------------------------------------------------------------
// emitSanctionsAlert — high-priority sanctions match broadcast
// ---------------------------------------------------------------------------

/**
 * Emit a high-priority sanctions alert. Broadcasts immediately, logs at
 * ERROR level, and triggers webhook notifications (placeholder).
 */
export function emitSanctionsAlert(
  data: Record<string, unknown>,
  options?: { traceId?: string; agentDid?: string; apiKeyId?: string },
): ComplianceEvent {
  const event: ComplianceEvent = {
    type: "sanctions.alert",
    data,
    timestamp: new Date().toISOString(),
    id: randomUUID(),
    ...(options?.traceId ? { traceId: options.traceId } : {}),
  };

  // Broadcast immediately (tenant-scoped when apiKeyId is provided)
  // Cast to WsEvent — ComplianceEventType is a superset of WsEventType;
  // extra event types are forwarded to clients that subscribe to them
  broadcastWsEvent({
    ...event,
    ...(options?.apiKeyId ? { apiKeyId: options.apiKeyId } : {}),
  } as unknown as Parameters<typeof broadcastWsEvent>[0]);

  // Log at ERROR level — sanctions matches are high priority
  logger.error("SANCTIONS ALERT: address matched sanctions list", {
    eventId: event.id,
    ...data,
  });

  // Fire-and-forget audit persistence
  fireAuditLog("sanctions.alert", {
    eventId: event.id,
    severity: "CRITICAL",
    ...data,
    ...(options?.traceId ? { traceId: options.traceId } : {}),
  }, {
    agentDid: options?.agentDid,
    apiKeyId: options?.apiKeyId,
  });

  // TODO(webhook): trigger webhook notification for sanctions alerts
  // This would POST to configured webhook URLs for real-time alerting.
  // For now, the WebSocket broadcast + audit log + error log cover visibility.

  return event;
}
