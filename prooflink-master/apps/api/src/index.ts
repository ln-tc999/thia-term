import { initTelemetry } from "./telemetry.js";
const telemetrySdkPromise = initTelemetry();

import { serve } from "@hono/node-server";
import type { ServerType } from "@hono/node-server";

import { createApp } from "./app.js";
import { closeDb } from "./db/index.js";
import { shutdownWebSockets } from "./routes/ws.js";
import { logger } from "./utils/logger.js";

// ---------------------------------------------------------------------------
// Env var validation — fail fast at startup, not at request time
// ---------------------------------------------------------------------------

function validateEnv(): void {
  const required = ["DATABASE_URL"];
  const requiredInProd = ["API_KEY_SECRET", "JWT_SECRET"];

  const envKeys =
    process.env["NODE_ENV"] === "production"
      ? [...required, ...requiredInProd]
      : required;

  const missing = envKeys.filter((k) => !process.env[k]);
  if (missing.length > 0) {
    throw new Error(`Missing required env vars: ${missing.join(", ")}`);
  }

  const port = Number(process.env["PORT"] ?? 3001);
  if (!Number.isFinite(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid PORT environment variable: ${process.env["PORT"]}`);
  }
}

validateEnv();

// ---------------------------------------------------------------------------
// Server startup
// ---------------------------------------------------------------------------

const app = createApp();
const port = Number(process.env["PORT"] ?? 3001);

logger.info("Starting ProofLink API server", { port });

const server: ServerType = serve(
  { fetch: app.fetch, port },
  (info) => {
    logger.info("Server running", {
      url: `http://localhost:${info.port}`,
      version: process.env["APP_VERSION"] ?? "0.1.0",
      nodeEnv: process.env["NODE_ENV"] ?? "development",
    });
  },
);

// ---------------------------------------------------------------------------
// Graceful shutdown — drain in-flight requests before closing the DB pool
// ---------------------------------------------------------------------------

let isShuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (isShuttingDown) return;
  isShuttingDown = true;

  logger.info("Received shutdown signal — starting graceful shutdown", { signal });

  // Close WebSocket connections before shutting down
  shutdownWebSockets();

  // Shutdown telemetry
  const telemetrySdk = await telemetrySdkPromise;
  await telemetrySdk?.shutdown();

  // Stop accepting new connections
  server.close(async (err) => {
    if (err) {
      logger.error("Error closing HTTP server", { error: err.message });
    } else {
      logger.info("HTTP server closed");
    }

    try {
      await closeDb();
      logger.info("Database pool closed");
    } catch (dbErr: unknown) {
      const message = dbErr instanceof Error ? dbErr.message : String(dbErr);
      logger.error("Error closing database pool", { error: message });
    }

    logger.info("Graceful shutdown complete");
    process.exit(err ? 1 : 0);
  });

  // Force-kill if graceful shutdown takes more than 10 seconds
  setTimeout(() => {
    logger.error("Graceful shutdown timed out — forcing exit");
    process.exit(1);
  }, 10_000).unref();
}

process.on("SIGTERM", () => { void shutdown("SIGTERM"); });
process.on("SIGINT",  () => { void shutdown("SIGINT"); });
