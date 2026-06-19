import { and, eq } from "drizzle-orm";

import { getDb } from "../db/index.js";
import { agents, disputes, escrows } from "../db/schema.js";
import type { Dispute, Escrow } from "../db/schema.js";
import { logger } from "../utils/logger.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DisputeCategory =
  | "NON_DELIVERY"
  | "OVERCHARGE"
  | "UNAUTHORIZED"
  | "SERVICE_QUALITY"
  | "OTHER";

export type ArbitrationOutcome =
  | "REFUND_FULL"
  | "REFUND_PARTIAL"
  | "REJECT"
  | "REQUIRES_HUMAN"
  | "NO_ACTION";

export interface ArbitrationResult {
  disputeId: string;
  outcome: ArbitrationOutcome;
  refundAmount: string | null;
  reasoning: string;
  automated: boolean;
  decidedAt: string;
}

// ---------------------------------------------------------------------------
// Evidence helpers
// ---------------------------------------------------------------------------

interface EvidenceEntry {
  submittedBy?: string;
  type?: string;
  deliveryProof?: boolean;
  [key: string]: unknown;
}

function hasDeliveryProof(
  evidence: EvidenceEntry[],
  respondentDid: string,
): boolean {
  return evidence.some(
    (e) =>
      e.submittedBy === respondentDid &&
      (e.type === "delivery_proof" || e.deliveryProof === true),
  );
}

function bothPartiesSubmittedEvidence(
  evidence: EvidenceEntry[],
  initiatorDid: string,
  respondentDid: string,
): boolean {
  const hasInitiator = evidence.some((e) => e.submittedBy === initiatorDid);
  const hasRespondent = evidence.some((e) => e.submittedBy === respondentDid);
  return hasInitiator && hasRespondent;
}

// ---------------------------------------------------------------------------
// calculateRefundAmount
// ---------------------------------------------------------------------------

export function calculateRefundAmount(
  dispute: Dispute,
  escrow: Escrow,
): string {
  const category = dispute.category as DisputeCategory;
  const escrowAmount = Number(escrow.amount);

  switch (category) {
    case "NON_DELIVERY":
      // Full refund — nothing was delivered
      return escrowAmount.toString();

    case "OVERCHARGE": {
      // Refund the difference between escrowed and agreed amount
      const conditions = escrow.conditions as Record<string, unknown>;
      const agreedPrice = Number(conditions["agreedPrice"] ?? escrowAmount);
      const diff = escrowAmount - agreedPrice;
      return diff > 0 ? diff.toString() : "0";
    }

    case "UNAUTHORIZED":
      // Full refund — transaction was not authorized
      return escrowAmount.toString();

    case "SERVICE_QUALITY":
      // 50% refund as default for quality disputes (human review expected)
      return (escrowAmount * 0.5).toString();

    default:
      return "0";
  }
}

// ---------------------------------------------------------------------------
// autoArbitrate
// ---------------------------------------------------------------------------

export async function autoArbitrate(
  disputeId: string,
): Promise<ArbitrationResult> {
  const db = getDb();

  // Fetch dispute
  const [dispute] = await db
    .select()
    .from(disputes)
    .where(eq(disputes.id, disputeId))
    .limit(1);

  if (!dispute) {
    throw new Error(`Dispute ${disputeId} not found`);
  }

  if (dispute.state !== "ARBITRATION") {
    throw new Error(
      `Cannot auto-arbitrate dispute ${disputeId}: expected state ARBITRATION, got ${dispute.state}.`,
    );
  }

  const category = dispute.category as DisputeCategory;
  const evidence = (dispute.evidence ?? []) as EvidenceEntry[];
  const now = new Date();

  let outcome: ArbitrationOutcome;
  let reasoning: string;
  let refundAmount: string | null = null;

  // Fetch associated escrow if present
  let escrow: Escrow | undefined;
  if (dispute.escrowId) {
    const [row] = await db
      .select()
      .from(escrows)
      .where(eq(escrows.id, dispute.escrowId))
      .limit(1);
    escrow = row;
  }

  switch (category) {
    case "NON_DELIVERY": {
      const deadlinePassed = now > new Date(dispute.deadline);
      const respondentProved = hasDeliveryProof(
        evidence,
        dispute.respondentDid,
      );

      if (!respondentProved && deadlinePassed) {
        outcome = "REFUND_FULL";
        reasoning =
          "No delivery proof submitted by respondent and deadline has passed. Auto-resolving with full refund.";
        refundAmount = escrow
          ? calculateRefundAmount(dispute, escrow)
          : null;
      } else if (respondentProved) {
        outcome = "REQUIRES_HUMAN";
        reasoning =
          "Respondent submitted delivery proof but initiator disputes it. Requires human review.";
      } else {
        outcome = "REQUIRES_HUMAN";
        reasoning =
          "Deadline has not yet passed. Waiting for respondent to submit delivery proof.";
      }
      break;
    }

    case "OVERCHARGE": {
      if (!escrow) {
        outcome = "REQUIRES_HUMAN";
        reasoning =
          "No associated escrow found. Cannot determine overcharge amount automatically.";
        break;
      }

      const conditions = escrow.conditions as Record<string, unknown>;
      const agreedPrice = Number(conditions["agreedPrice"] ?? 0);
      const escrowAmount = Number(escrow.amount);

      if (agreedPrice <= 0) {
        outcome = "REQUIRES_HUMAN";
        reasoning =
          "No agreed price recorded in escrow conditions. Cannot determine overcharge automatically.";
        break;
      }

      const diff = escrowAmount - agreedPrice;
      const diffPercent = (diff / agreedPrice) * 100;

      if (diffPercent > 20) {
        outcome = "REFUND_PARTIAL";
        reasoning = `Amount exceeds agreed price by ${diffPercent.toFixed(1)}% (> 20% threshold). Auto-resolving with partial refund of ${diff}.`;
        refundAmount = diff.toString();
      } else {
        outcome = "REQUIRES_HUMAN";
        reasoning = `Amount exceeds agreed price by ${diffPercent.toFixed(1)}% which is within the 20% auto-resolve threshold. Requires human review.`;
      }
      break;
    }

    case "UNAUTHORIZED": {
      // Check if initiator has a valid KYA credential
      const [agent] = await db
        .select()
        .from(agents)
        .where(eq(agents.agentDid, dispute.initiatorDid))
        .limit(1);

      const hasValidKya =
        agent?.kyaCredentialHash != null &&
        agent.isActive &&
        (agent.expiresAt == null || agent.expiresAt > now);

      if (!hasValidKya) {
        outcome = "REJECT";
        reasoning =
          "Initiator does not have a valid KYA credential. Dispute rejected — unauthorized agent cannot file disputes.";
      } else {
        outcome = "REQUIRES_HUMAN";
        reasoning =
          "Initiator has valid KYA credentials. Unauthorized transaction claim requires human investigation.";
      }
      break;
    }

    case "SERVICE_QUALITY": {
      const bothSubmitted = bothPartiesSubmittedEvidence(
        evidence,
        dispute.initiatorDid,
        dispute.respondentDid,
      );

      if (bothSubmitted) {
        outcome = "REQUIRES_HUMAN";
        reasoning =
          "Both parties submitted evidence for subjective service quality dispute. Cannot auto-resolve — requires human arbitration.";
      } else {
        outcome = "REQUIRES_HUMAN";
        reasoning =
          "Service quality disputes are subjective and always require human review.";
      }
      break;
    }

    default: {
      outcome = "REQUIRES_HUMAN";
      reasoning = `Dispute category "${category}" is not eligible for automated arbitration.`;
    }
  }

  const decidedAt = now.toISOString();

  // Persist resolution to the dispute record
  const resolution: Record<string, unknown> = {
    outcome,
    reasoning,
    refundAmount,
    automated: true,
    decidedAt,
  };

  const newState =
    outcome === "REQUIRES_HUMAN" ? "ARBITRATION" : "RESOLVED";

  const [updatedRow] = await db
    .update(disputes)
    .set({
      state: newState,
      resolution,
      resolvedBy: outcome === "REQUIRES_HUMAN" ? undefined : "system:auto-arbitration",
      updatedAt: now,
    })
    .where(and(eq(disputes.id, disputeId), eq(disputes.state, "ARBITRATION")))
    .returning();

  if (!updatedRow) {
    throw new Error(
      `Concurrent modification on dispute ${disputeId}: state changed during auto-arbitration. Retry.`,
    );
  }

  logger.info("Auto-arbitration completed", {
    disputeId,
    category,
    outcome,
    automated: true,
  });

  return {
    disputeId,
    outcome,
    refundAmount,
    reasoning,
    automated: true,
    decidedAt,
  };
}

// ---------------------------------------------------------------------------
// getArbitrationResult
// ---------------------------------------------------------------------------

export async function getArbitrationResult(
  disputeId: string,
): Promise<ArbitrationResult | null> {
  const db = getDb();

  const [dispute] = await db
    .select()
    .from(disputes)
    .where(eq(disputes.id, disputeId))
    .limit(1);

  if (!dispute) {
    throw new Error(`Dispute ${disputeId} not found`);
  }

  const resolution = dispute.resolution as Record<string, unknown> | null;
  if (!resolution) {
    return null;
  }

  return {
    disputeId,
    outcome: (resolution["outcome"] as ArbitrationOutcome) ?? "REQUIRES_HUMAN",
    refundAmount: (resolution["refundAmount"] as string) ?? null,
    reasoning: (resolution["reasoning"] as string) ?? "No reasoning provided.",
    automated: (resolution["automated"] as boolean) ?? false,
    decidedAt: (resolution["decidedAt"] as string) ?? dispute.updatedAt.toISOString(),
  };
}
