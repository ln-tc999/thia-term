import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { createHash, createHmac, randomUUID } from "node:crypto";

import { getDb } from "../db/index.js";
import { apiKeys } from "../db/schema.js";
import { logger } from "../utils/logger.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type WsEventType =
  | "compliance.check.passed"
  | "compliance.check.failed"
  | "compliance.check.review"
  | "sanctions.alert"
  | "invoice.created"
  | "invoice.paid"
  | "invoice.state_changed"
  | "receipt.anchored"
  | "escrow.created"
  | "escrow.funded"
  | "escrow.activated"
  | "escrow.completed"
  | "escrow.disputed"
  | "escrow.refunded"
  | "escrow.expired";

interface WsClient {
  id: string;
  ws: WebSocket;
  apiKeyId: string;
  subscriptions: Set<WsEventType>;
  lastPong: number;
}

interface WsMessage {
  type: "subscribe" | "unsubscribe" | "ping";
  events?: string[];
}

interface WsEvent {
  type: WsEventType;
  data: Record<string, unknown>;
  timestamp: string;
  id: string;
  /** When set, only deliver to clients authenticated with this apiKeyId. */
  apiKeyId?: string;
}

// ---------------------------------------------------------------------------
// Client registry (in-memory; production would use Redis pub/sub)
// ---------------------------------------------------------------------------

const clients = new Map<string, WsClient>();

const VALID_EVENTS: WsEventType[] = [
  "compliance.check.passed",
  "compliance.check.failed",
  "compliance.check.review",
  "sanctions.alert",
  "invoice.created",
  "invoice.paid",
  "invoice.state_changed",
  "receipt.anchored",
  "escrow.created",
  "escrow.funded",
  "escrow.activated",
  "escrow.completed",
  "escrow.disputed",
  "escrow.refunded",
  "escrow.expired",
];

// ---------------------------------------------------------------------------
// Heartbeat — ping all clients every 30s, drop stale ones
// ---------------------------------------------------------------------------

const HEARTBEAT_INTERVAL_MS = 30_000;
const STALE_THRESHOLD_MS = 90_000;

let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

function startHeartbeat(): void {
  if (heartbeatTimer) return;
  heartbeatTimer = setInterval(() => {
    const now = Date.now();
    for (const [id, client] of clients) {
      if (now - client.lastPong > STALE_THRESHOLD_MS) {
        logger.info("Closing stale WebSocket connection", { clientId: id });
        try {
          client.ws.close(1000, "Heartbeat timeout");
        } catch {
          /* already closed */
        }
        clients.delete(id);
        continue;
      }
      try {
        client.ws.send(JSON.stringify({ type: "ping", timestamp: new Date().toISOString() }));
      } catch {
        clients.delete(id);
      }
    }
  }, HEARTBEAT_INTERVAL_MS);
  heartbeatTimer.unref();
}

// ---------------------------------------------------------------------------
// Broadcast helper — callable from other modules
// ---------------------------------------------------------------------------

/**
 * Broadcast an event to connected WebSocket clients subscribed to the event type.
 *
 * Tenant isolation: if the event carries an `apiKeyId`, only clients
 * authenticated with that same key receive the message. System events
 * (no apiKeyId) are broadcast to all subscribers.
 *
 * The `apiKeyId` is stripped from the payload before sending so it is
 * never leaked to clients.
 */
export function broadcastWsEvent(event: WsEvent): void {
  // Strip apiKeyId from the payload sent to clients
  const { apiKeyId, ...safeEvent } = event;
  const payload = JSON.stringify(safeEvent);

  for (const client of clients.values()) {
    // Tenant isolation: if event is scoped, only matching clients receive it
    if (apiKeyId && client.apiKeyId !== apiKeyId) continue;

    if (client.subscriptions.size === 0 || client.subscriptions.has(event.type)) {
      try {
        client.ws.send(payload);
      } catch {
        /* client disconnected — will be cleaned up by heartbeat */
      }
    }
  }
}

/** Get the count of active WebSocket connections. */
export function getWsClientCount(): number {
  return clients.size;
}

/** Gracefully close all WebSocket connections during server shutdown. */
export function shutdownWebSockets(): void {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }

  for (const [id, client] of clients) {
    try {
      client.ws.close(1001, "Server shutting down");
    } catch {
      /* already closed */
    }
    clients.delete(id);
  }
}

// ---------------------------------------------------------------------------
// API key authentication for WebSocket
// ---------------------------------------------------------------------------

function hashApiKey(key: string): string {
  const secret = process.env["API_KEY_SECRET"];
  if (!secret) {
    return createHash("sha256").update(key).digest("hex");
  }
  return createHmac("sha256", secret).update(key).digest("hex");
}

async function authenticateWs(apiKey: string | null): Promise<string | null> {
  if (!apiKey) return null;

  const keyHash = hashApiKey(apiKey);

  try {
    const db = getDb();
    const [keyRecord] = await db
      .select()
      .from(apiKeys)
      .where(eq(apiKeys.keyHash, keyHash))
      .limit(1);

    if (!keyRecord) return null;
    if (!keyRecord.isActive) return null;
    if (keyRecord.expiresAt && keyRecord.expiresAt < new Date()) return null;

    // Fire-and-forget: update lastUsedAt
    db.update(apiKeys)
      .set({ lastUsedAt: new Date() })
      .where(eq(apiKeys.id, keyRecord.id))
      .catch(() => {
        /* best-effort */
      });

    return keyRecord.id;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error("Database error during WebSocket auth", { error: message });
    return null;
  }
}

// ---------------------------------------------------------------------------
// Route group — uses native WebSocket upgrade
// ---------------------------------------------------------------------------

const wsRoutes = new Hono();

/**
 * GET /v1/ws — WebSocket endpoint for real-time event streaming.
 *
 * Authentication: pass API key via `X-API-Key` header or `Authorization: Bearer <key>` header.
 *
 * After connecting, send JSON messages to subscribe/unsubscribe:
 *   { "type": "subscribe", "events": ["compliance.check.passed", "invoice.created"] }
 *   { "type": "unsubscribe", "events": ["invoice.created"] }
 *   { "type": "ping" }
 *
 * Server sends events matching subscriptions, plus periodic pings.
 */
wsRoutes.get("/", async (c) => {
  // Extract API key from headers only (never from query params to avoid URL logging leaks)
  const authHeader = c.req.header("Authorization");
  const bearerKey = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  const apiKey = c.req.header("X-API-Key") ?? bearerKey ?? null;
  const apiKeyId = await authenticateWs(apiKey);

  if (!apiKeyId) {
    return c.json(
      {
        success: false,
        error: {
          code: "UNAUTHORIZED",
          message: "WebSocket connections require API key authentication. Pass via X-API-Key or Authorization: Bearer header.",
        },
      },
      401,
    );
  }

  // Check for WebSocket upgrade
  const upgradeHeader = c.req.header("Upgrade");
  if (upgradeHeader?.toLowerCase() !== "websocket") {
    return c.json(
      {
        success: false,
        error: {
          code: "BAD_REQUEST",
          message: "This endpoint requires a WebSocket upgrade. Connect using a WebSocket client.",
        },
      },
      400,
    );
  }

  // Use the server's native upgrade mechanism
  // @ts-expect-error — Hono's env.upgrade is injected by the server adapter
  const pair = c.env?.upgrade?.(c.req.raw);
  if (!pair) {
    return c.json(
      {
        success: false,
        error: {
          code: "INTERNAL_ERROR",
          message: "WebSocket upgrade not supported by the current server adapter.",
        },
      },
      500,
    );
  }

  return new Response(null, { status: 101 });
});

/**
 * Handle a raw WebSocket connection (called by the server adapter after upgrade).
 */
export function handleWsConnection(ws: WebSocket, apiKeyId: string): void {
  startHeartbeat();

  const clientId = `ws_${randomUUID()}`;

  const client: WsClient = {
    id: clientId,
    ws,
    apiKeyId,
    subscriptions: new Set(),
    lastPong: Date.now(),
  };

  clients.set(clientId, client);

  logger.info("WebSocket client connected", { clientId, apiKeyId });

  // Send welcome message
  ws.send(
    JSON.stringify({
      type: "connected",
      clientId,
      availableEvents: VALID_EVENTS,
      message: "Connected to ProofLink event stream. Send subscribe messages to start receiving events.",
    }),
  );

  ws.addEventListener("message", (event: MessageEvent) => {
    client.lastPong = Date.now();

    let msg: WsMessage;
    try {
      msg = JSON.parse(String(event.data)) as WsMessage;
    } catch {
      ws.send(JSON.stringify({ type: "error", message: "Invalid JSON" }));
      return;
    }

    switch (msg.type) {
      case "subscribe": {
        const events = (msg.events ?? []).filter((e): e is WsEventType =>
          VALID_EVENTS.includes(e as WsEventType),
        );
        for (const evt of events) {
          client.subscriptions.add(evt);
        }
        ws.send(
          JSON.stringify({
            type: "subscribed",
            events: [...client.subscriptions],
          }),
        );
        break;
      }

      case "unsubscribe": {
        const events = msg.events ?? [];
        for (const evt of events) {
          client.subscriptions.delete(evt as WsEventType);
        }
        ws.send(
          JSON.stringify({
            type: "unsubscribed",
            events: [...client.subscriptions],
          }),
        );
        break;
      }

      case "ping": {
        ws.send(JSON.stringify({ type: "pong", timestamp: new Date().toISOString() }));
        break;
      }

      default: {
        ws.send(
          JSON.stringify({
            type: "error",
            message: `Unknown message type. Supported: subscribe, unsubscribe, ping`,
          }),
        );
      }
    }
  });

  ws.addEventListener("close", () => {
    clients.delete(clientId);
    logger.info("WebSocket client disconnected", { clientId });
  });

  ws.addEventListener("error", (err: Event) => {
    logger.error("WebSocket error", { clientId, error: String(err) });
    clients.delete(clientId);
  });
}

export { wsRoutes };
