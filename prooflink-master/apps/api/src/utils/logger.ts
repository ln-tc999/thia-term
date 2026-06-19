import { randomUUID } from "node:crypto";
import type { MiddlewareHandler } from "hono";

// ---------------------------------------------------------------------------
// Log levels
// ---------------------------------------------------------------------------

const LOG_LEVELS = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
} as const;

type LogLevel = keyof typeof LOG_LEVELS;

// ---------------------------------------------------------------------------
// Structured log entry
// ---------------------------------------------------------------------------

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  requestId?: string;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Logger
// ---------------------------------------------------------------------------

const currentLevel: LogLevel = (process.env["LOG_LEVEL"] as LogLevel) ?? "info";

function shouldLog(level: LogLevel): boolean {
  return LOG_LEVELS[level] >= LOG_LEVELS[currentLevel];
}

function formatEntry(entry: LogEntry): string {
  return JSON.stringify(entry);
}

function log(level: LogLevel, message: string, meta?: Record<string, unknown>): void {
  if (!shouldLog(level)) return;

  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...meta,
  };

  const output = formatEntry(entry);

  if (level === "error") {
    process.stderr.write(output + "\n");
  } else {
    process.stdout.write(output + "\n");
  }
}

export const logger = {
  debug: (message: string, meta?: Record<string, unknown>) => log("debug", message, meta),
  info: (message: string, meta?: Record<string, unknown>) => log("info", message, meta),
  warn: (message: string, meta?: Record<string, unknown>) => log("warn", message, meta),
  error: (message: string, meta?: Record<string, unknown>) => log("error", message, meta),
};

// ---------------------------------------------------------------------------
// Request ID middleware — attaches a unique ID to every request
// ---------------------------------------------------------------------------

export function requestIdMiddleware(): MiddlewareHandler {
  return async (c, next) => {
    const requestId = c.req.header("X-Request-ID") ?? randomUUID();
    c.set("requestId", requestId);
    c.header("X-Request-ID", requestId);
    await next();
  };
}

// ---------------------------------------------------------------------------
// Request logging middleware — structured JSON logs per request
// ---------------------------------------------------------------------------

export function requestLoggerMiddleware(): MiddlewareHandler {
  return async (c, next) => {
    const start = Date.now();
    const requestId = c.get("requestId") as string | undefined;

    logger.info("request_start", {
      requestId,
      method: c.req.method,
      path: c.req.path,
      userAgent: c.req.header("User-Agent"),
    });

    await next();

    const durationMs = Date.now() - start;

    logger.info("request_end", {
      requestId,
      method: c.req.method,
      path: c.req.path,
      status: c.res.status,
      durationMs,
    });
  };
}
