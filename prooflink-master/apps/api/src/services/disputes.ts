import { and, eq, or } from "drizzle-orm";

import { getDb } from "../db/index.js";
import { disputes } from "../db/schema.js";
import type { Dispute } from "../db/schema.js";
import { writeAuditLog } from "../utils/audit.js";
import { logger } from "../utils/logger.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DISPUTE_DEADLINE_HOURS = 72;

export const DISPUTE_STATES = ["OPEN", "EVIDENCE", "ARBITRATION", "RESOLVED", "CLOSED"] as const;
export type DisputeState = (typeof DISPUTE_STATES)[number];

export const DISPUTE_CATEGORIES = [
  "SERVICE_QUALITY",
  "NON_DELIVERY",
  "UNAUTHORIZED",
  "OVERCHARGE",
  "OTHER",
] as const;
export type DisputeCategory = (typeof DISPUTE_CATEGORIES)[number];

export const RESOLUTION_OUTCOMES = [
  "REFUND_FULL",
  "REFUND_PARTIAL",
  "REJECT",
  "SPLIT",
] as const;
export type ResolutionOutcome = (typeof RESOLUTION_OUTCOMES)[number];

/** Valid state transitions: from → allowed targets */
const STATE_TRANSITIONS: Record<DisputeState, DisputeState[]> = {
  OPEN: ["EVIDENCE"],
  EVIDENCE: ["ARBITRATION"],
  ARBITRATION: ["RESOLVED"],
  RESOLVED: ["CLOSED"],
  CLOSED: [],
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function assertTransition(current: string, target: DisputeState): void {
  const allowed = STATE_TRANSITIONS[current as DisputeState] ?? [];
  if (!allowed.includes(target)) {
    throw new DisputeTransitionError(current, target, allowed);
  }
}

export class DisputeTransitionError extends Error {
  public readonly code = "INVALID_TRANSITION" as const;
  constructor(
    public readonly from: string,
    public readonly to: string,
    public readonly allowed: string[],
  ) {
    super(`Cannot transition from ${from} to ${to}. Allowed: ${allowed.join(", ") || "none"}.`);
  }
}

export class DisputeNotFoundError extends Error {
  public readonly code = "NOT_FOUND" as const;
  constructor(id: string) {
    super(`Dispute ${id} not found.`);
  }
}

// ---------------------------------------------------------------------------
// openDispute
// ---------------------------------------------------------------------------

export interface OpenDisputeParams {
  escrowId?: string;
  invoiceId?: string;
  initiatorDid: string;
  respondentDid: string;
  reason: string;
  category: DisputeCategory;
  traceId?: string;
  apiKeyId?: string;
}

export async function openDispute(params: OpenDisputeParams): Promise<Dispute> {
  const db = getDb();

  const deadline = new Date();
  deadline.setHours(deadline.getHours() + DISPUTE_DEADLINE_HOURS);

  const [dispute] = await db
    .insert(disputes)
    .values({
      escrowId: params.escrowId ?? null,
      invoiceId: params.invoiceId ?? null,
      state: "OPEN",
      initiatorDid: params.initiatorDid,
      respondentDid: params.respondentDid,
      reason: params.reason,
      category: params.category,
      traceId: params.traceId ?? null,
      apiKeyId: params.apiKeyId ?? null,
      deadline,
    })
    .returning();

  if (!dispute) {
    throw new Error("Failed to create dispute");
  }

  logger.info("Dispute opened", {
    disputeId: dispute.id,
    category: params.category,
    initiator: params.initiatorDid,
    respondent: params.respondentDid,
  });

  writeAuditLog({
    eventType: "dispute.opened",
    payload: {
      disputeId: dispute.id,
      category: params.category,
      initiatorDid: params.initiatorDid,
      respondentDid: params.respondentDid,
      escrowId: params.escrowId,
      invoiceId: params.invoiceId,
    },
    invoiceId: params.invoiceId,
    apiKeyId: params.apiKeyId,
  });

  return dispute;
}

// ---------------------------------------------------------------------------
// submitEvidence
// ---------------------------------------------------------------------------

export async function submitEvidence(
  disputeId: string,
  evidence: Record<string, unknown>,
  apiKeyId?: string,
): Promise<Dispute> {
  const db = getDb();
  const dispute = await fetchDispute(disputeId, apiKeyId);

  // Evidence can be submitted in OPEN or EVIDENCE states
  if (dispute.state !== "OPEN" && dispute.state !== "EVIDENCE") {
    throw new DisputeTransitionError(dispute.state, "EVIDENCE", ["OPEN", "EVIDENCE"]);
  }

  const existingEvidence = (dispute.evidence ?? []) as Record<string, unknown>[];
  const updatedEvidence = [...existingEvidence, { ...evidence, submittedAt: new Date().toISOString() }];

  // Auto-transition OPEN → EVIDENCE on first evidence submission
  const newState = dispute.state === "OPEN" ? "EVIDENCE" : dispute.state;

  const [updated] = await db
    .update(disputes)
    .set({
      evidence: updatedEvidence,
      state: newState,
      updatedAt: new Date(),
    })
    .where(eq(disputes.id, disputeId))
    .returning();

  if (!updated) {
    throw new Error("Failed to update dispute evidence");
  }

  logger.info("Evidence submitted", { disputeId, evidenceCount: updatedEvidence.length });

  writeAuditLog({
    eventType: "dispute.evidence.submitted",
    payload: { disputeId, evidenceIndex: updatedEvidence.length - 1 },
    apiKeyId,
  });

  return updated;
}

// ---------------------------------------------------------------------------
// escalateToArbitration
// ---------------------------------------------------------------------------

export async function escalateToArbitration(
  disputeId: string,
  apiKeyId?: string,
): Promise<Dispute> {
  const db = getDb();
  const dispute = await fetchDispute(disputeId, apiKeyId);

  assertTransition(dispute.state, "ARBITRATION");

  const [updated] = await db
    .update(disputes)
    .set({ state: "ARBITRATION", updatedAt: new Date() })
    .where(eq(disputes.id, disputeId))
    .returning();

  if (!updated) {
    throw new Error("Failed to escalate dispute");
  }

  logger.info("Dispute escalated to arbitration", { disputeId });

  writeAuditLog({
    eventType: "dispute.escalated",
    payload: { disputeId, from: dispute.state, to: "ARBITRATION" },
    apiKeyId,
  });

  return updated;
}

// ---------------------------------------------------------------------------
// resolveDispute
// ---------------------------------------------------------------------------

export interface ResolveDisputeParams {
  outcome: ResolutionOutcome;
  resolvedBy: string;
  notes?: string;
  refundAmount?: string;
}

export async function resolveDispute(
  disputeId: string,
  params: ResolveDisputeParams,
  apiKeyId?: string,
): Promise<Dispute> {
  const db = getDb();
  const dispute = await fetchDispute(disputeId, apiKeyId);

  assertTransition(dispute.state, "RESOLVED");

  const resolution: Record<string, unknown> = {
    outcome: params.outcome,
    resolvedBy: params.resolvedBy,
    notes: params.notes,
    refundAmount: params.refundAmount,
    resolvedAt: new Date().toISOString(),
  };

  const [updated] = await db
    .update(disputes)
    .set({
      state: "RESOLVED",
      resolution,
      resolvedBy: params.resolvedBy,
      updatedAt: new Date(),
    })
    .where(eq(disputes.id, disputeId))
    .returning();

  if (!updated) {
    throw new Error("Failed to resolve dispute");
  }

  logger.info("Dispute resolved", { disputeId, outcome: params.outcome });

  writeAuditLog({
    eventType: "dispute.resolved",
    payload: { disputeId, outcome: params.outcome, resolvedBy: params.resolvedBy },
    apiKeyId,
  });

  return updated;
}

// ---------------------------------------------------------------------------
// closeDispute
// ---------------------------------------------------------------------------

export async function closeDispute(
  disputeId: string,
  apiKeyId?: string,
): Promise<Dispute> {
  const db = getDb();
  const dispute = await fetchDispute(disputeId, apiKeyId);

  assertTransition(dispute.state, "CLOSED");

  const [updated] = await db
    .update(disputes)
    .set({ state: "CLOSED", updatedAt: new Date() })
    .where(eq(disputes.id, disputeId))
    .returning();

  if (!updated) {
    throw new Error("Failed to close dispute");
  }

  logger.info("Dispute closed", { disputeId });

  writeAuditLog({
    eventType: "dispute.closed",
    payload: { disputeId },
    apiKeyId,
  });

  return updated;
}

// ---------------------------------------------------------------------------
// autoResolveExpired — resolve in favor of initiator if deadline passed
// ---------------------------------------------------------------------------

export async function autoResolveExpired(): Promise<Dispute[]> {
  const db = getDb();
  const now = new Date();

  // Find disputes past deadline that are still in OPEN or EVIDENCE
  const expired = await db
    .select()
    .from(disputes)
    .where(or(eq(disputes.state, "OPEN"), eq(disputes.state, "EVIDENCE")));

  const resolved: Dispute[] = [];

  for (const dispute of expired) {
    if (dispute.deadline <= now) {
      // Step 1: Transition to intermediate states respecting the state machine
      // OPEN → EVIDENCE (if currently OPEN)
      if (dispute.state === "OPEN") {
        const [stepped] = await db
          .update(disputes)
          .set({ state: "EVIDENCE", updatedAt: now })
          .where(and(eq(disputes.id, dispute.id), eq(disputes.state, "OPEN")))
          .returning();

        if (!stepped) {
          // Concurrent modification — skip this dispute
          logger.warn("Auto-resolve: concurrent modification during OPEN→EVIDENCE", { disputeId: dispute.id });
          continue;
        }

        writeAuditLog({
          eventType: "dispute.auto-escalated",
          payload: { disputeId: dispute.id, from: "OPEN", to: "EVIDENCE", reason: "respondent_deadline_expired" },
        });
      }

      // Step 2: EVIDENCE → ARBITRATION
      const [toArbitration] = await db
        .update(disputes)
        .set({ state: "ARBITRATION", updatedAt: now })
        .where(and(eq(disputes.id, dispute.id), eq(disputes.state, "EVIDENCE")))
        .returning();

      if (!toArbitration) {
        logger.warn("Auto-resolve: concurrent modification during EVIDENCE→ARBITRATION", { disputeId: dispute.id });
        continue;
      }

      writeAuditLog({
        eventType: "dispute.auto-escalated",
        payload: { disputeId: dispute.id, from: "EVIDENCE", to: "ARBITRATION", reason: "respondent_deadline_expired" },
      });

      // Step 3: ARBITRATION → RESOLVED
      const resolution: Record<string, unknown> = {
        outcome: "REFUND_FULL",
        resolvedBy: "system:auto-resolve",
        notes: "Auto-resolved in favor of initiator — respondent missed deadline.",
        resolvedAt: now.toISOString(),
      };

      const [updated] = await db
        .update(disputes)
        .set({
          state: "RESOLVED",
          resolution,
          resolvedBy: "system:auto-resolve",
          updatedAt: now,
        })
        .where(and(eq(disputes.id, dispute.id), eq(disputes.state, "ARBITRATION")))
        .returning();

      if (updated) {
        resolved.push(updated);
        logger.info("Dispute auto-resolved (deadline expired)", { disputeId: dispute.id });

        writeAuditLog({
          eventType: "dispute.auto-resolved",
          payload: {
            disputeId: dispute.id,
            outcome: "REFUND_FULL",
            reason: "respondent_deadline_expired",
          },
        });
      } else {
        logger.warn("Auto-resolve: concurrent modification during ARBITRATION→RESOLVED", { disputeId: dispute.id });
      }
    }
  }

  return resolved;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

async function fetchDispute(disputeId: string, apiKeyId?: string): Promise<Dispute> {
  const db = getDb();

  const conditions = [eq(disputes.id, disputeId)];
  if (apiKeyId) {
    conditions.push(eq(disputes.apiKeyId, apiKeyId));
  }

  const [dispute] = await db
    .select()
    .from(disputes)
    .where(and(...conditions))
    .limit(1);

  if (!dispute) {
    throw new DisputeNotFoundError(disputeId);
  }

  return dispute;
}
