// ---------------------------------------------------------------------------
// System Monitor — uptime, memory, event loop lag, periodic health checks
// ---------------------------------------------------------------------------

import { EventEmitter } from "node:events";

import type { HealthChecker, HealthStatus } from "./checker.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Memory usage snapshot in megabytes. */
export interface MemorySnapshot {
  rss: number;
  heapUsed: number;
  heapTotal: number;
  external: number;
}

/** Complete system metrics snapshot. */
export interface SystemSnapshot {
  uptimeSeconds: number;
  memory: MemorySnapshot;
  eventLoopLagMs: number;
  health: HealthStatus | null;
  timestamp: string;
}

/** Events emitted by SystemMonitor. */
export interface SystemMonitorEvents {
  "status:changed": {
    previous: HealthStatus["status"] | null;
    current: HealthStatus["status"];
    snapshot: SystemSnapshot;
  };
  "health:check": {
    snapshot: SystemSnapshot;
  };
}

/** Configuration for SystemMonitor. */
export interface SystemMonitorOptions {
  /** Interval between health checks in ms (default: 30000). */
  intervalMs?: number;
  /** HealthChecker instance to use for periodic checks. */
  healthChecker?: HealthChecker;
}

// ---------------------------------------------------------------------------
// SystemMonitor
// ---------------------------------------------------------------------------

/**
 * Monitors system health metrics and emits events on status changes.
 *
 * Tracks uptime, memory usage, event loop lag, and runs periodic health
 * checks via a {@link HealthChecker} instance.
 */
export class SystemMonitor {
  private readonly emitter = new EventEmitter();
  private readonly intervalMs: number;
  private readonly healthChecker: HealthChecker | null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastStatus: HealthStatus["status"] | null = null;
  private lastHealth: HealthStatus | null = null;
  private readonly startTime: number;

  constructor(options: SystemMonitorOptions = {}) {
    this.intervalMs = options.intervalMs ?? 30_000;
    this.healthChecker = options.healthChecker ?? null;
    this.startTime = Date.now();
    this.emitter.setMaxListeners(20);
  }

  /** Register an event listener. */
  on<K extends keyof SystemMonitorEvents>(
    event: K,
    listener: (payload: SystemMonitorEvents[K]) => void,
  ): this {
    this.emitter.on(event, listener as (...args: unknown[]) => void);
    return this;
  }

  /** Remove an event listener. */
  off<K extends keyof SystemMonitorEvents>(
    event: K,
    listener: (payload: SystemMonitorEvents[K]) => void,
  ): this {
    this.emitter.off(event, listener as (...args: unknown[]) => void);
    return this;
  }

  /** Start periodic monitoring. */
  start(): void {
    if (this.timer) return;
    // Run immediately, then at interval
    void this.tick();
    this.timer = setInterval(() => void this.tick(), this.intervalMs);
    // Allow the timer to not prevent process exit
    if (this.timer && typeof this.timer === "object" && "unref" in this.timer) {
      this.timer.unref();
    }
  }

  /** Stop periodic monitoring. */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** Whether the monitor is currently running. */
  get running(): boolean {
    return this.timer !== null;
  }

  /** Get a snapshot of current system metrics without running health checks. */
  getSnapshot(): SystemSnapshot {
    return {
      uptimeSeconds: Math.round((Date.now() - this.startTime) / 1000),
      memory: this.getMemory(),
      eventLoopLagMs: 0, // only measured during tick
      health: this.lastHealth,
      timestamp: new Date().toISOString(),
    };
  }

  /** Measure event loop lag (sync, fast). */
  async measureEventLoopLag(): Promise<number> {
    const start = performance.now();
    return new Promise<number>((resolve) => {
      setTimeout(() => {
        // The difference between actual elapsed and the 0ms requested
        // timeout gives us the event loop lag
        const lag = Math.max(0, performance.now() - start);
        resolve(Math.round(lag * 100) / 100);
      }, 0);
    });
  }

  // -------------------------------------------------------------------------
  // Private
  // -------------------------------------------------------------------------

  private getMemory(): MemorySnapshot {
    const mem = process.memoryUsage();
    const toMB = (bytes: number): number => Math.round((bytes / 1024 / 1024) * 100) / 100;
    return {
      rss: toMB(mem.rss),
      heapUsed: toMB(mem.heapUsed),
      heapTotal: toMB(mem.heapTotal),
      external: toMB(mem.external),
    };
  }

  private async tick(): Promise<void> {
    const eventLoopLagMs = await this.measureEventLoopLag();

    let health: HealthStatus | null = null;
    if (this.healthChecker) {
      health = await this.healthChecker.check();
      this.lastHealth = health;
    }

    const snapshot: SystemSnapshot = {
      uptimeSeconds: Math.round((Date.now() - this.startTime) / 1000),
      memory: this.getMemory(),
      eventLoopLagMs,
      health,
      timestamp: new Date().toISOString(),
    };

    this.emitter.emit("health:check", { snapshot });

    if (health) {
      const currentStatus = health.status;
      if (this.lastStatus !== null && this.lastStatus !== currentStatus) {
        this.emitter.emit("status:changed", {
          previous: this.lastStatus,
          current: currentStatus,
          snapshot,
        });
      }
      this.lastStatus = currentStatus;
    }
  }
}
