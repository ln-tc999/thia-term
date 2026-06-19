import type { ComplianceEvent, ComplianceEventType, Logger } from "./types.js";

// ---------------------------------------------------------------------------
// Structured compliance event logger
// ---------------------------------------------------------------------------

/** Serialized log entry for external aggregators */
export interface ComplianceLogEntry {
  level: "info" | "warn" | "error";
  timestamp: string;
  event: ComplianceEventType;
  /** ISO 8601 formatted timestamp */
  isoTimestamp: string;
  /** Structured payload */
  data: Record<string, unknown>;
  /** Service identifier */
  service: string;
  /** Correlation ID (if available) */
  correlationId?: string;
}

/** Interface for external log aggregator transports */
export interface LogTransport {
  /** Send a structured log entry to the aggregator */
  send(entry: ComplianceLogEntry): void | Promise<void>;
  /** Flush pending log entries (for graceful shutdown) */
  flush?(): Promise<void>;
}

/** Options for creating a compliance logger */
export interface ComplianceLoggerOptions {
  /** Service name for log entries (default: "x402-compliance") */
  serviceName?: string;
  /** Base logger for console output */
  logger?: Logger;
  /** External log transports (DataDog, Loki, etc.) */
  transports?: LogTransport[];
  /** Minimum event types to log (defaults to all) */
  eventFilter?: ComplianceEventType[];
  /** Whether to include full payload in logs (default: true) */
  includePayload?: boolean;
}

/**
 * Structured compliance event logger.
 *
 * Logs all compliance decisions with full context and forwards
 * to external log aggregators via transports.
 */
export class ComplianceLogger {
  private readonly serviceName: string;
  private readonly logger?: Logger;
  private readonly transports: LogTransport[];
  private readonly eventFilter?: Set<ComplianceEventType>;
  private readonly includePayload: boolean;

  constructor(options: ComplianceLoggerOptions = {}) {
    this.serviceName = options.serviceName ?? "x402-compliance";
    this.logger = options.logger;
    this.transports = options.transports ?? [];
    this.eventFilter = options.eventFilter ? new Set(options.eventFilter) : undefined;
    this.includePayload = options.includePayload ?? true;
  }

  /**
   * Log a compliance event. Use this as a ComplianceEventHandler.
   */
  log(event: ComplianceEvent): void {
    // Filter events if filter is configured
    if (this.eventFilter && !this.eventFilter.has(event.type)) return;

    const level = eventLevel(event.type);
    const entry = this.buildEntry(event, level);

    // Console output via base logger
    this.logToConsole(entry, level);

    // Forward to transports (fire-and-forget)
    for (const transport of this.transports) {
      try {
        void transport.send(entry);
      } catch (err) {
        this.logger?.error("Log transport send failed", err);
      }
    }
  }

  /**
   * Create a bound handler function suitable for `compliance.on()`.
   */
  handler(): (event: ComplianceEvent) => void {
    return (event) => this.log(event);
  }

  /**
   * Flush all transports (for graceful shutdown).
   */
  async flush(): Promise<void> {
    await Promise.allSettled(
      this.transports
        .filter((t) => t.flush)
        .map((t) => t.flush!()),
    );
  }

  /**
   * Add a transport at runtime.
   */
  addTransport(transport: LogTransport): void {
    this.transports.push(transport);
  }

  private buildEntry(event: ComplianceEvent, level: "info" | "warn" | "error"): ComplianceLogEntry {
    const now = new Date(event.timestamp);
    const data = this.includePayload ? { ...event.payload } : {};

    // Extract correlation ID from transaction hash or prooflink hash
    const correlationId =
      (event.payload.transactionHash as string | undefined) ??
      (event.payload.proofLinkHash as string | undefined);

    return {
      level,
      timestamp: now.toISOString(),
      event: event.type,
      isoTimestamp: now.toISOString(),
      data,
      service: this.serviceName,
      correlationId,
    };
  }

  private logToConsole(entry: ComplianceLogEntry, level: "info" | "warn" | "error"): void {
    if (!this.logger) return;

    const message = `[${entry.service}] ${entry.event}`;
    const metadata = {
      ...entry.data,
      correlationId: entry.correlationId,
    };

    switch (level) {
      case "error":
        this.logger.error(message, metadata);
        break;
      case "warn":
        this.logger.warn(message, metadata);
        break;
      default:
        this.logger.info(message, metadata);
        break;
    }
  }
}

// ---------------------------------------------------------------------------
// Console transport (for development)
// ---------------------------------------------------------------------------

/**
 * Simple console transport that outputs JSON lines.
 * Useful for development and piping to log aggregators via stdout.
 */
export class ConsoleJsonTransport implements LogTransport {
  private readonly pretty: boolean;

  constructor(options?: { pretty?: boolean }) {
    this.pretty = options?.pretty ?? false;
  }

  send(entry: ComplianceLogEntry): void {
    const output = this.pretty
      ? JSON.stringify(entry, null, 2)
      : JSON.stringify(entry);
    // eslint-disable-next-line no-console
    console.log(output);
  }
}

// ---------------------------------------------------------------------------
// Buffered transport (batches entries and flushes periodically)
// ---------------------------------------------------------------------------

/**
 * Buffered transport that batches log entries and flushes via a callback.
 * Useful for sending batches to HTTP endpoints.
 */
export class BufferedTransport implements LogTransport {
  private buffer: ComplianceLogEntry[] = [];
  private readonly maxSize: number;
  private readonly flushIntervalMs: number;
  private readonly onFlush: (entries: ComplianceLogEntry[]) => Promise<void>;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(options: {
    /** Callback to handle batched entries */
    onFlush: (entries: ComplianceLogEntry[]) => Promise<void>;
    /** Max buffer size before auto-flush (default 100) */
    maxSize?: number;
    /** Flush interval in ms (default 10000) */
    flushIntervalMs?: number;
  }) {
    this.onFlush = options.onFlush;
    this.maxSize = options.maxSize ?? 100;
    this.flushIntervalMs = options.flushIntervalMs ?? 10_000;

    this.timer = setInterval(() => void this.flush(), this.flushIntervalMs);
    if (typeof this.timer === "object" && "unref" in this.timer) {
      this.timer.unref();
    }
  }

  send(entry: ComplianceLogEntry): void {
    this.buffer.push(entry);
    if (this.buffer.length >= this.maxSize) {
      void this.flush();
    }
  }

  async flush(): Promise<void> {
    if (this.buffer.length === 0) return;
    const batch = this.buffer;
    this.buffer = [];
    await this.onFlush(batch);
  }

  destroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function eventLevel(type: ComplianceEventType): "info" | "warn" | "error" {
  switch (type) {
    case "compliance:check:failed":
      return "warn";
    case "compliance:check:started":
    case "compliance:check:passed":
    case "compliance:settle:completed":
    case "compliance:receipt:generated":
    case "compliance:receipt:attested":
      return "info";
    default:
      return "info";
  }
}
