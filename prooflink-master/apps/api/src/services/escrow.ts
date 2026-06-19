import { and, eq } from "drizzle-orm";

import { getDb } from "../db/index.js";
import { escrows } from "../db/schema.js";
import type { Escrow } from "../db/schema.js";
import { screenAddress } from "./screening.js";
import { writeAuditLog } from "../utils/audit.js";
import { emitComplianceEvent } from "../utils/events.js";
import { logger } from "../utils/logger.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type EscrowState =
  | "CREATED"
  | "FUNDED"
  | "ACTIVE"
  | "COMPLETED"
  | "DISPUTED"
  | "REFUNDED"
  | "EXPIRED";

export type EscrowType = "PAYMENT" | "SERVICE" | "MILESTONE";

export interface CreateEscrowParams {
  escrowType: EscrowType;
  payerAgentDid: string;
  payeeAgentDid: string;
  payerWallet: string;
  payeeWallet: string;
  amount: string;
  asset: string;
  chain: string;
  conditions: Record<string, unknown>;
  evaluatorAddress?: string;
  expiresAt: Date;
  traceId?: string;
  apiKeyId?: string;
}

export interface EvaluatorProof {
  evaluator: string;
  signature: string;
  result: Record<string, unknown>;
  timestamp: string;
}

// ---------------------------------------------------------------------------
// Valid state transitions
// ---------------------------------------------------------------------------

const STATE_TRANSITIONS: Record<EscrowState, EscrowState[]> = {
  CREATED: ["FUNDED", "EXPIRED"],
  FUNDED: ["ACTIVE", "EXPIRED"],
  ACTIVE: ["COMPLETED", "DISPUTED", "EXPIRED"],
  COMPLETED: [],
  DISPUTED: ["REFUNDED"],
  REFUNDED: [],
  EXPIRED: ["REFUNDED"],
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function assertTransition(
  escrowId: string,
  current: string,
  target: EscrowState,
): void {
  const allowed = STATE_TRANSITIONS[current as EscrowState];
  if (!allowed || !allowed.includes(target)) {
    throw new EscrowTransitionError(escrowId, current, target, allowed);
  }
}

export class EscrowTransitionError extends Error {
  public readonly code = "INVALID_STATE_TRANSITION" as const;
  constructor(
    public readonly escrowId: string,
    public readonly from: string,
    public readonly to: string,
    public readonly allowed?: string[],
    public readonly reason?: string,
  ) {
    super(reason ?? `Cannot transition escrow ${escrowId} from ${from} to ${to}.`);
    this.name = "EscrowTransitionError";
  }
}

export class EscrowNotFoundError extends Error {
  public readonly code = "NOT_FOUND" as const;
  constructor(id: string) {
    super(`Escrow ${id} not found.`);
    this.name = "EscrowNotFoundError";
  }
}

export class EscrowComplianceError extends Error {
  public readonly code = "COMPLIANCE_FAILED" as const;
  constructor(message: string) {
    super(message);
    this.name = "EscrowComplianceError";
  }
}

// ---------------------------------------------------------------------------
// Fetch helper
// ---------------------------------------------------------------------------

async function getEscrowOrThrow(escrowId: string, apiKeyId?: string): Promise<Escrow> {
  const db = getDb();
  const conditions = [eq(escrows.id, escrowId)];
  if (apiKeyId) {
    conditions.push(eq(escrows.apiKeyId, apiKeyId));
  }
  const [row] = await db
    .select()
    .from(escrows)
    .where(and(...conditions))
    .limit(1);

  if (!row) {
    throw new EscrowNotFoundError(escrowId);
  }
  // Auto-check expiry on every fetch — if expired and still mutable, transition
  if (row.expiresAt < new Date() && !["COMPLETED", "REFUNDED", "EXPIRED"].includes(row.state)) {
    const db2 = getDb();
    await db2.update(escrows)
      .set({ state: "EXPIRED", updatedAt: new Date() })
      .where(and(eq(escrows.id, escrowId), eq(escrows.state, row.state)))
      .returning();
    throw new EscrowTransitionError(escrowId, row.state, "EXPIRED", undefined, "Escrow has expired");
  }
  return row;
}

// ---------------------------------------------------------------------------
// Service functions
// ---------------------------------------------------------------------------

/**
 * Create an escrow after running compliance screening on both parties.
 */
export async function createEscrow(
  params: CreateEscrowParams,
): Promise<Escrow> {
  const db = getDb();

  // Screen both wallets in parallel
  const [payerScreen, payeeScreen] = await Promise.all([
    screenAddress(params.payerWallet, params.chain),
    screenAddress(params.payeeWallet, params.chain),
  ]);

  if (payerScreen.matched) {
    throw new EscrowComplianceError(
      `Payer wallet ${params.payerWallet} flagged by sanctions screening.`,
    );
  }
  if (payeeScreen.matched) {
    throw new EscrowComplianceError(
      `Payee wallet ${params.payeeWallet} flagged by sanctions screening.`,
    );
  }

  const [escrow] = await db
    .insert(escrows)
    .values({
      escrowType: params.escrowType,
      state: "CREATED",
      payerAgentDid: params.payerAgentDid,
      payeeAgentDid: params.payeeAgentDid,
      payerWallet: params.payerWallet,
      payeeWallet: params.payeeWallet,
      amount: params.amount,
      asset: params.asset,
      chain: params.chain,
      conditions: params.conditions,
      evaluatorAddress: params.evaluatorAddress ?? null,
      expiresAt: params.expiresAt,
      traceId: params.traceId ?? null,
      apiKeyId: params.apiKeyId ?? null,
    })
    .returning();

  if (!escrow) {
    throw new Error("Failed to insert escrow row.");
  }

  writeAuditLog({
    eventType: "escrow.created",
    payload: {
      escrowId: escrow.id,
      escrowType: escrow.escrowType,
      payerWallet: escrow.payerWallet,
      payeeWallet: escrow.payeeWallet,
      amount: escrow.amount,
      asset: escrow.asset,
    },
    agentDid: params.payerAgentDid,
  });

  emitComplianceEvent("escrow.created", {
    escrowId: escrow.id,
    escrowType: escrow.escrowType,
    amount: escrow.amount,
    asset: escrow.asset,
  }, { traceId: params.traceId });

  logger.info("Escrow created", { escrowId: escrow.id });

  return escrow;
}

/**
 * Transition CREATED -> FUNDED.
 */
export async function fundEscrow(escrowId: string, apiKeyId?: string): Promise<Escrow> {
  const existing = await getEscrowOrThrow(escrowId, apiKeyId);
  assertTransition(escrowId, existing.state, "FUNDED");

  const db = getDb();
  const now = new Date();
  const [updated] = await db
    .update(escrows)
    .set({ state: "FUNDED", fundedAt: now, updatedAt: now })
    .where(and(eq(escrows.id, escrowId), eq(escrows.state, existing.state)))
    .returning();

  if (!updated) {
    throw new EscrowTransitionError(escrowId, existing.state, "UNKNOWN", undefined, "Concurrent modification — state changed by another request. Retry.");
  }

  writeAuditLog({
    eventType: "escrow.funded",
    payload: { escrowId, previousState: existing.state },
    agentDid: existing.payerAgentDid,
  });

  emitComplianceEvent("escrow.funded", {
    escrowId,
    amount: existing.amount,
    asset: existing.asset,
  }, { traceId: existing.traceId ?? undefined });

  logger.info("Escrow funded", { escrowId });
  return updated;
}

/**
 * Transition FUNDED -> ACTIVE. Work can begin.
 */
export async function activateEscrow(escrowId: string, apiKeyId?: string): Promise<Escrow> {
  const existing = await getEscrowOrThrow(escrowId, apiKeyId);
  assertTransition(escrowId, existing.state, "ACTIVE");

  const db = getDb();
  const now = new Date();
  const [updated] = await db
    .update(escrows)
    .set({ state: "ACTIVE", updatedAt: now })
    .where(and(eq(escrows.id, escrowId), eq(escrows.state, existing.state)))
    .returning();

  if (!updated) {
    throw new EscrowTransitionError(escrowId, existing.state, "UNKNOWN", undefined, "Concurrent modification — state changed by another request. Retry.");
  }

  writeAuditLog({
    eventType: "escrow.activated",
    payload: { escrowId, previousState: existing.state },
    agentDid: existing.payeeAgentDid,
  });

  emitComplianceEvent("escrow.activated", {
    escrowId,
    amount: existing.amount,
    asset: existing.asset,
  }, { traceId: existing.traceId ?? undefined });

  logger.info("Escrow activated", { escrowId });
  return updated;
}

/**
 * Transition ACTIVE -> COMPLETED. Releases funds to payee.
 */
export async function completeEscrow(
  escrowId: string,
  evaluatorProof: EvaluatorProof,
  apiKeyId?: string,
): Promise<Escrow> {
  const existing = await getEscrowOrThrow(escrowId, apiKeyId);
  assertTransition(escrowId, existing.state, "COMPLETED");

  // If an evaluator address is set, verify the proof comes from the right evaluator
  if (
    existing.evaluatorAddress &&
    evaluatorProof.evaluator.toLowerCase() !== existing.evaluatorAddress.toLowerCase()
  ) {
    throw new EscrowComplianceError(
      `Proof evaluator ${evaluatorProof.evaluator} does not match registered evaluator ${existing.evaluatorAddress}.`,
    );
  }

  const db = getDb();
  const now = new Date();
  const [updated] = await db
    .update(escrows)
    .set({ state: "COMPLETED", completedAt: now, updatedAt: now })
    .where(and(eq(escrows.id, escrowId), eq(escrows.state, existing.state)))
    .returning();

  if (!updated) {
    throw new EscrowTransitionError(escrowId, existing.state, "UNKNOWN", undefined, "Concurrent modification — state changed by another request. Retry.");
  }

  writeAuditLog({
    eventType: "escrow.completed",
    payload: {
      escrowId,
      previousState: existing.state,
      evaluatorProof: {
        evaluator: evaluatorProof.evaluator,
        result: evaluatorProof.result,
        timestamp: evaluatorProof.timestamp,
      },
    },
    agentDid: existing.payeeAgentDid,
  });

  emitComplianceEvent("escrow.completed", {
    escrowId,
    amount: existing.amount,
    asset: existing.asset,
    evaluator: evaluatorProof.evaluator,
  }, { traceId: existing.traceId ?? undefined });

  logger.info("Escrow completed", { escrowId });
  return updated;
}

/**
 * Transition ACTIVE -> DISPUTED.
 */
export async function disputeEscrow(
  escrowId: string,
  reason: string,
  apiKeyId?: string,
): Promise<Escrow> {
  const existing = await getEscrowOrThrow(escrowId, apiKeyId);
  assertTransition(escrowId, existing.state, "DISPUTED");

  const db = getDb();
  const now = new Date();
  const [updated] = await db
    .update(escrows)
    .set({ state: "DISPUTED", disputedAt: now, updatedAt: now })
    .where(and(eq(escrows.id, escrowId), eq(escrows.state, existing.state)))
    .returning();

  if (!updated) {
    throw new EscrowTransitionError(escrowId, existing.state, "UNKNOWN", undefined, "Concurrent modification — state changed by another request. Retry.");
  }

  writeAuditLog({
    eventType: "escrow.disputed",
    payload: { escrowId, previousState: existing.state, reason },
    agentDid: existing.payerAgentDid,
  });

  emitComplianceEvent("escrow.disputed", {
    escrowId,
    amount: existing.amount,
    asset: existing.asset,
    reason,
  }, { traceId: existing.traceId ?? undefined });

  logger.info("Escrow disputed", { escrowId, reason });
  return updated;
}

/**
 * Transition DISPUTED/EXPIRED -> REFUNDED.
 */
export async function refundEscrow(escrowId: string, apiKeyId?: string): Promise<Escrow> {
  const existing = await getEscrowOrThrow(escrowId, apiKeyId);
  assertTransition(escrowId, existing.state, "REFUNDED");

  const db = getDb();
  const now = new Date();
  const [updated] = await db
    .update(escrows)
    .set({ state: "REFUNDED", updatedAt: now })
    .where(and(eq(escrows.id, escrowId), eq(escrows.state, existing.state)))
    .returning();

  if (!updated) {
    throw new EscrowTransitionError(escrowId, existing.state, "UNKNOWN", undefined, "Concurrent modification — state changed by another request. Retry.");
  }

  writeAuditLog({
    eventType: "escrow.refunded",
    payload: { escrowId, previousState: existing.state },
    agentDid: existing.payerAgentDid,
  });

  emitComplianceEvent("escrow.refunded", {
    escrowId,
    amount: existing.amount,
    asset: existing.asset,
  }, { traceId: existing.traceId ?? undefined });

  logger.info("Escrow refunded", { escrowId });
  return updated;
}

/**
 * Check if an escrow has expired and transition to EXPIRED if so.
 * Only transitions from CREATED, FUNDED, or ACTIVE.
 */
export async function expireEscrow(escrowId: string, apiKeyId?: string): Promise<Escrow> {
  let existing: Escrow;
  try {
    existing = await getEscrowOrThrow(escrowId, apiKeyId);
  } catch (err) {
    // getEscrowOrThrow auto-expires past-due escrows and throws — that's exactly
    // what this function wants to do, so re-fetch the (now EXPIRED) row.
    if (err instanceof EscrowTransitionError && err.to === "EXPIRED") {
      const db = getDb();
      const [row] = await db.select().from(escrows).where(eq(escrows.id, escrowId)).limit(1);
      if (row) return row;
    }
    throw err;
  }

  if (new Date() < new Date(existing.expiresAt)) {
    throw new EscrowTransitionError(
      escrowId,
      existing.state,
      "EXPIRED",
      undefined,
      "Escrow has not yet expired.",
    );
  }

  assertTransition(escrowId, existing.state, "EXPIRED");

  const db = getDb();
  const now = new Date();
  const [updated] = await db
    .update(escrows)
    .set({ state: "EXPIRED", updatedAt: now })
    .where(and(eq(escrows.id, escrowId), eq(escrows.state, existing.state)))
    .returning();

  if (!updated) {
    throw new EscrowTransitionError(escrowId, existing.state, "UNKNOWN", undefined, "Concurrent modification — state changed by another request. Retry.");
  }

  writeAuditLog({
    eventType: "escrow.expired",
    payload: { escrowId, previousState: existing.state, expiresAt: existing.expiresAt },
    agentDid: existing.payerAgentDid,
  });

  emitComplianceEvent("escrow.expired", {
    escrowId,
    amount: existing.amount,
    asset: existing.asset,
  }, { traceId: existing.traceId ?? undefined });

  logger.info("Escrow expired", { escrowId });
  return updated;
}
