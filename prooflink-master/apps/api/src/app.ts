import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { cors } from "hono/cors";
import { secureHeaders } from "hono/secure-headers";
import { timing } from "hono/timing";

import { timeout } from "./middleware/timeout.js";

// Augment Hono's ContextVariableMap with our custom variables
import "./types/hono.js";

import { authMiddleware } from "./middleware/auth.js";
import { globalErrorHandler } from "./middleware/error-handler.js";
import { rateLimitMiddleware } from "./middleware/rate-limit.js";
import { analytics } from "./routes/analytics.js";
import { compliance } from "./routes/compliance.js";
import { dashboard } from "./routes/dashboard.js";
import { disputeRoutes } from "./routes/disputes.js";
import { escrowRoutes } from "./routes/escrow.js";
import { health } from "./routes/health.js";
import { identity } from "./routes/identity.js";
import { invoiceRoutes } from "./routes/invoices.js";
import { openapi } from "./routes/openapi.js";
import { receipts } from "./routes/receipts.js";
import { reportRoutes } from "./routes/reports.js";
import { sagaRoutes } from "./routes/sagas.js";
import { webhookRoutes } from "./routes/webhooks.js";
import { permissionRoutes } from "./routes/permissions.js";
import { wsRoutes } from "./routes/ws.js";
import { discovery, wellKnownAgent } from "./routes/discovery.js";
import { policyRoutes } from "./routes/policies.js";
import { streamRoutes } from "./routes/streams.js";
import { requestIdMiddleware, requestLoggerMiddleware } from "./utils/logger.js";

// ---------------------------------------------------------------------------
// App factory — separated from server start for testability
// ---------------------------------------------------------------------------

export function createApp(): Hono {
  const app = new Hono();

  // Global error handler
  app.onError(globalErrorHandler);

  // 404 handler
  app.notFound((c) => {
    return c.json(
      {
        success: false,
        error: { code: "NOT_FOUND", message: `Route ${c.req.method} ${c.req.path} not found.` },
      },
      404,
    );
  });

  // ---------------------------------------------------------------------------
  // Global middleware — MUST be registered before routes
  // ---------------------------------------------------------------------------

  // Request ID must be first — downstream middleware and handlers depend on it
  app.use("*", requestIdMiddleware());

  // Structured request logging (replaces hono/logger)
  app.use("*", requestLoggerMiddleware());

  app.use("*", timing());
  app.use("*", secureHeaders());

  // CORS configuration
  app.use(
    "*",
    cors({
      origin: (origin) => {
        const allowedOrigins = process.env["CORS_ORIGIN"]?.split(",") ?? ["http://localhost:3000", "http://localhost:3100"];

        // Allow requests with no origin (server-to-server, curl, etc.)
        if (!origin) return origin;

        // Check if the origin is in the allowed list
        if (allowedOrigins.includes(origin)) return origin;

        // Check wildcard patterns (e.g., "*.prooflink.io")
        for (const allowed of allowedOrigins) {
          if (allowed.startsWith("*.")) {
            const domain = allowed.slice(2);
            if (origin === domain || origin.endsWith(`.${domain}`)) return origin;
          }
        }

        return null;
      },
      allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      allowHeaders: [
        "Content-Type",
        "Authorization",
        "X-API-Key",
        "X-Request-ID",
        "X-Signature",
        "X-Signature-Timestamp",
      ],
      exposeHeaders: [
        "X-RateLimit-Limit",
        "X-RateLimit-Remaining",
        "X-RateLimit-Reset",
        "X-Request-ID",
        "Retry-After",
      ],
      maxAge: 86400,
      credentials: true,
    }),
  );

  // Request timeout — abort if a request takes longer than 30s
  app.use("*", timeout());

  // Body size limit — reject payloads larger than 1 MB
  app.use(
    "*",
    bodyLimit({
      maxSize: 1024 * 1024,
      onError: (c) => {
        return c.json(
          { error: "PAYLOAD_TOO_LARGE", message: "Request body exceeds 1MB limit" },
          413,
        );
      },
    }),
  );

  // ---------------------------------------------------------------------------
  // Public routes (no auth) — health checks and OpenAPI spec
  // ---------------------------------------------------------------------------

  app.route("/", health);
  app.route("/", openapi);
  app.route("/.well-known", wellKnownAgent);

  // ---------------------------------------------------------------------------
  // API v1 — all authenticated routes under /v1/
  // ---------------------------------------------------------------------------

  const v1 = new Hono();

  v1.use("*", authMiddleware());
  v1.use("*", rateLimitMiddleware({ defaultLimit: 60 }));

  v1.route("/compliance", compliance);
  v1.route("/disputes", disputeRoutes);
  v1.route("/escrow", escrowRoutes);
  v1.route("/invoices", invoiceRoutes);
  v1.route("/identity", identity);
  v1.route("/receipts", receipts);
  v1.route("/reports", reportRoutes);
  v1.route("/sagas", sagaRoutes);
  v1.route("/webhooks", webhookRoutes);
  v1.route("/analytics", analytics);
  v1.route("/dashboard", dashboard);
  v1.route("/discovery", discovery);
  v1.route("/policies", policyRoutes);
  v1.route("/streams", streamRoutes);
  v1.route("/permissions", permissionRoutes);
  v1.route("/ws", wsRoutes);

  app.route("/v1", v1);
  app.route("/api/v1", v1);

  return app;
}
