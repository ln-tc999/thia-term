import { and, eq, sql } from "drizzle-orm";

import { getDb } from "../db/index.js";
import { paymentStreams } from "../db/schema.js";
import type { PaymentStream } from "../db/schema.js";
import { writeAuditLog } from "../utils/audit.js";
import { logger } from "../utils/logger.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type StreamModel =
  | "PER_REQUEST"
  | "PER_SECOND"
  | "PER_TOKEN"
  | "PER_RESULT"
  | "MILESTONE";

export type StreamStatus = "ACTIVE" | "PAUSED" | "SETTLED" | "EXHAUSTED";

export interface CreateStreamParams {
  payerDid: string;
  payeeDid: string;
  model: StreamModel;
  ratePerUnit: string;
  unit: string;
  totalBudget: string;
  expiresAt: Date;
  traceId?: string;
  apiKeyId?: string;
}

export interface RecordUsageParams {
  units: string;
  metadata?: Record<string, unknown>;
}

export interface StreamStatusResult {
  stream: PaymentStream;
  remainingBudget: string;
  usagePercent: number;
  projectedExhaustionAt: Date | null;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class StreamNotFoundError extends Error {
  public readonly code = "NOT_FOUND" as const;
  constructor(id: string) {
    super(`Payment stream ${id} not found.`);
    this.name = "StreamNotFoundError";
  }
}

export class StreamTransitionError extends Error {
  public readonly code = "INVALID_STREAM_TRANSITION" as const;
  constructor(
    public readonly streamId: string,
    public readonly currentStatus: string,
    public readonly targetStatus: string,
    public readonly reason?: string,
  ) {
    super(
      reason ??
        `Cannot transition stream ${streamId} from ${currentStatus} to ${targetStatus}.`,
    );
    this.name = "StreamTransitionError";
  }
}

export class StreamBudgetExceededError extends Error {
  public readonly code = "BUDGET_EXCEEDED" as const;
  constructor(
    public readonly streamId: string,
    public readonly requested: string,
    public readonly remaining: string,
  ) {
    super(
      `Stream ${streamId} budget exceeded: requested ${requested}, remaining ${remaining}.`,
    );
    this.name = "StreamBudgetExceededError";
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function getStreamOrThrow(streamId: string, apiKeyId?: string): Promise<PaymentStream> {
  const db = getDb();
  const conditions = [eq(paymentStreams.id, streamId)];
  if (apiKeyId) {
    conditions.push(eq(paymentStreams.apiKeyId, apiKeyId));
  }
  const [row] = await db
    .select()
    .from(paymentStreams)
    .where(and(...conditions))
    .limit(1);

  if (!row) {
    throw new StreamNotFoundError(streamId);
  }

  // Auto-check expiry on ACTIVE streams
  if (
    row.status === "ACTIVE" &&
    row.expiresAt &&
    new Date(row.expiresAt) < new Date()
  ) {
    const now = new Date();
    await db
      .update(paymentStreams)
      .set({ status: "SETTLED", settledAt: now, updatedAt: now })
      .where(
        and(eq(paymentStreams.id, streamId), eq(paymentStreams.status, "ACTIVE")),
      );

    writeAuditLog({
      eventType: "stream.auto_settled",
      payload: { streamId, reason: "expired" },
      agentDid: row.payerDid,
    });

    // Re-fetch after auto-settle
    const [updated] = await db
      .select()
      .from(paymentStreams)
      .where(eq(paymentStreams.id, streamId))
      .limit(1);

    return updated!;
  }

  return row;
}

// ---------------------------------------------------------------------------
// Service functions
// ---------------------------------------------------------------------------

/**
 * Create a new payment stream with a budget and rate.
 */
export async function createStream(
  params: CreateStreamParams,
): Promise<PaymentStream> {
  const db = getDb();

  const [stream] = await db
    .insert(paymentStreams)
    .values({
      payerDid: params.payerDid,
      payeeDid: params.payeeDid,
      model: params.model,
      ratePerUnit: params.ratePerUnit,
      unit: params.unit,
      totalBudget: params.totalBudget,
      spent: "0",
      status: "ACTIVE",
      traceId: params.traceId ?? null,
      apiKeyId: params.apiKeyId ?? null,
      startedAt: new Date(),
      expiresAt: params.expiresAt,
    })
    .returning();

  if (!stream) {
    throw new Error("Failed to insert payment stream row.");
  }

  writeAuditLog({
    eventType: "stream.created",
    payload: {
      streamId: stream.id,
      model: stream.model,
      payerDid: stream.payerDid,
      payeeDid: stream.payeeDid,
      totalBudget: stream.totalBudget,
      ratePerUnit: stream.ratePerUnit,
      unit: stream.unit,
    },
    agentDid: params.payerDid,
  });

  logger.info("Payment stream created", { streamId: stream.id, model: stream.model });

  return stream;
}

/**
 * Record usage against a stream, checking budget limits.
 * Returns the updated stream.
 */
export async function recordStreamUsage(
  streamId: string,
  params: RecordUsageParams,
  apiKeyId?: string,
): Promise<PaymentStream> {
  const existing = await getStreamOrThrow(streamId, apiKeyId);

  if (existing.status !== "ACTIVE") {
    throw new StreamTransitionError(
      streamId,
      existing.status,
      "ACTIVE",
      `Cannot record usage on a ${existing.status} stream.`,
    );
  }

  const rate = parseFloat(existing.ratePerUnit);
  const units = parseFloat(params.units);
  const cost = rate * units;

  // Atomic budget check + spend update in a single SQL statement.
  // Prevents race condition where two concurrent requests both pass the budget check.
  const db = getDb();
  const now = new Date();

  const [updated] = await db
    .update(paymentStreams)
    .set({
      spent: sql`${paymentStreams.spent}::numeric + ${cost.toString()}::numeric`,
      status: sql`CASE WHEN (${paymentStreams.spent}::numeric + ${cost.toString()}::numeric) >= ${paymentStreams.totalBudget}::numeric THEN 'EXHAUSTED' ELSE 'ACTIVE' END`,
      updatedAt: now,
    })
    .where(
      and(
        eq(paymentStreams.id, streamId),
        eq(paymentStreams.status, "ACTIVE"),
        sql`(${paymentStreams.spent}::numeric + ${cost.toString()}::numeric) <= ${paymentStreams.totalBudget}::numeric`,
      ),
    )
    .returning();

  if (!updated) {
    // Distinguish between budget exceeded and concurrent state change
    const [current] = await db
      .select()
      .from(paymentStreams)
      .where(eq(paymentStreams.id, streamId))
      .limit(1);

    if (current && current.status === "ACTIVE") {
      // Stream is still ACTIVE but budget would be exceeded
      const currentSpent = parseFloat(current.spent);
      const budget = parseFloat(current.totalBudget);
      throw new StreamBudgetExceededError(
        streamId,
        cost.toString(),
        (budget - currentSpent).toString(),
      );
    }

    throw new StreamTransitionError(
      streamId,
      current?.status ?? "UNKNOWN",
      "ACTIVE",
      "Concurrent modification — state changed by another request. Retry.",
    );
  }

  const newSpent = parseFloat(updated.spent);
  const budget = parseFloat(updated.totalBudget);
  const newStatus = updated.status as StreamStatus;

  writeAuditLog({
    eventType: newStatus === "EXHAUSTED" ? "stream.exhausted" : "stream.usage_recorded",
    payload: {
      streamId,
      units: params.units,
      cost: cost.toString(),
      totalSpent: newSpent.toString(),
      remainingBudget: (budget - newSpent).toString(),
      metadata: params.metadata,
    },
    agentDid: existing.payerDid,
  });

  logger.info("Stream usage recorded", {
    streamId,
    units: params.units,
    cost,
    newStatus,
  });

  return updated;
}

/**
 * Pause an active stream.
 */
export async function pauseStream(streamId: string, apiKeyId?: string): Promise<PaymentStream> {
  const existing = await getStreamOrThrow(streamId, apiKeyId);

  if (existing.status !== "ACTIVE") {
    throw new StreamTransitionError(
      streamId,
      existing.status,
      "PAUSED",
      `Can only pause ACTIVE streams, current status: ${existing.status}.`,
    );
  }

  const db = getDb();
  const now = new Date();
  const [updated] = await db
    .update(paymentStreams)
    .set({ status: "PAUSED", updatedAt: now })
    .where(
      and(eq(paymentStreams.id, streamId), eq(paymentStreams.status, "ACTIVE")),
    )
    .returning();

  if (!updated) {
    throw new StreamTransitionError(
      streamId,
      existing.status,
      "PAUSED",
      "Concurrent modification — state changed by another request. Retry.",
    );
  }

  writeAuditLog({
    eventType: "stream.paused",
    payload: { streamId, previousStatus: existing.status },
    agentDid: existing.payerDid,
  });

  logger.info("Payment stream paused", { streamId });

  return updated;
}

/**
 * Resume a paused stream.
 */
export async function resumeStream(streamId: string, apiKeyId?: string): Promise<PaymentStream> {
  const existing = await getStreamOrThrow(streamId, apiKeyId);

  if (existing.status !== "PAUSED") {
    throw new StreamTransitionError(
      streamId,
      existing.status,
      "ACTIVE",
      `Can only resume PAUSED streams, current status: ${existing.status}.`,
    );
  }

  const db = getDb();
  const now = new Date();
  const [updated] = await db
    .update(paymentStreams)
    .set({ status: "ACTIVE", updatedAt: now })
    .where(
      and(eq(paymentStreams.id, streamId), eq(paymentStreams.status, "PAUSED")),
    )
    .returning();

  if (!updated) {
    throw new StreamTransitionError(
      streamId,
      existing.status,
      "ACTIVE",
      "Concurrent modification — state changed by another request. Retry.",
    );
  }

  writeAuditLog({
    eventType: "stream.resumed",
    payload: { streamId, previousStatus: existing.status },
    agentDid: existing.payerDid,
  });

  logger.info("Payment stream resumed", { streamId });

  return updated;
}

/**
 * Settle a stream — calculate final amount and close it.
 * Can settle from ACTIVE, PAUSED, or EXHAUSTED states.
 */
export async function settleStream(streamId: string, apiKeyId?: string): Promise<PaymentStream> {
  const existing = await getStreamOrThrow(streamId, apiKeyId);

  if (existing.status === "SETTLED") {
    throw new StreamTransitionError(
      streamId,
      existing.status,
      "SETTLED",
      "Stream is already settled.",
    );
  }

  if (!["ACTIVE", "PAUSED", "EXHAUSTED"].includes(existing.status)) {
    throw new StreamTransitionError(
      streamId,
      existing.status,
      "SETTLED",
      `Cannot settle a stream in ${existing.status} status.`,
    );
  }

  const db = getDb();
  const now = new Date();
  const [updated] = await db
    .update(paymentStreams)
    .set({ status: "SETTLED", settledAt: now, updatedAt: now })
    .where(
      and(
        eq(paymentStreams.id, streamId),
        eq(paymentStreams.status, existing.status),
      ),
    )
    .returning();

  if (!updated) {
    throw new StreamTransitionError(
      streamId,
      existing.status,
      "SETTLED",
      "Concurrent modification — state changed by another request. Retry.",
    );
  }

  writeAuditLog({
    eventType: "stream.settled",
    payload: {
      streamId,
      previousStatus: existing.status,
      finalSpent: existing.spent,
      totalBudget: existing.totalBudget,
    },
    agentDid: existing.payerDid,
  });

  logger.info("Payment stream settled", {
    streamId,
    finalSpent: existing.spent,
  });

  return updated;
}

/**
 * Get current stream status with computed fields:
 * remaining budget, usage percentage, and projected exhaustion time.
 */
export async function getStreamStatus(
  streamId: string,
  apiKeyId?: string,
): Promise<StreamStatusResult> {
  const stream = await getStreamOrThrow(streamId, apiKeyId);

  const spent = parseFloat(stream.spent);
  const budget = parseFloat(stream.totalBudget);
  const remaining = budget - spent;
  const usagePercent = budget > 0 ? (spent / budget) * 100 : 0;

  // Project exhaustion time based on spend rate since stream start
  let projectedExhaustionAt: Date | null = null;
  if (
    stream.status === "ACTIVE" &&
    spent > 0 &&
    remaining > 0 &&
    stream.startedAt
  ) {
    const elapsedMs = Date.now() - new Date(stream.startedAt).getTime();
    if (elapsedMs > 0) {
      const spendRatePerMs = spent / elapsedMs;
      const msUntilExhausted = remaining / spendRatePerMs;
      projectedExhaustionAt = new Date(Date.now() + msUntilExhausted);
    }
  }

  return {
    stream,
    remainingBudget: remaining.toString(),
    usagePercent: Math.round(usagePercent * 100) / 100,
    projectedExhaustionAt,
  };
}
