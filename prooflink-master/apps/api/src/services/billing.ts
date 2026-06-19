import { and, eq, gte, lte, sql } from "drizzle-orm";

import { getDb } from "../db/index.js";
import { usageRecords } from "../db/schema.js";
import { logger } from "../utils/logger.js";

// ---------------------------------------------------------------------------
// Pricing constants
// ---------------------------------------------------------------------------

/** Basis points charged on transaction volume (5 bps = 0.05%) */
const TRANSACTION_FEE_BPS = 5;

/** Per-action flat fees in USD */
const ACTION_FEES: Record<string, number> = {
  compliance_check: 0.01,
  screen: 0.005,
  invoice: 0.01,
  escrow: 0.01,
  dispute: 0.01,
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type BillableAction =
  | "compliance_check"
  | "screen"
  | "invoice"
  | "escrow"
  | "dispute";

export interface UsageSummary {
  agentDid: string;
  from: Date;
  to: Date;
  totalRecords: number;
  totalAmountUsd: number;
  byAction: Record<string, { count: number; totalUsd: number }>;
}

export interface AgentBill {
  agentDid: string;
  from: Date;
  to: Date;
  lineItems: BillLineItem[];
  totalUsd: number;
  generatedAt: string;
}

export interface BillLineItem {
  action: string;
  count: number;
  unitPriceUsd: number;
  totalUsd: number;
}

// ---------------------------------------------------------------------------
// recordUsage — fire-and-forget usage recording
// ---------------------------------------------------------------------------

export function recordUsage(
  agentDid: string,
  action: BillableAction,
  amountUsd: number,
  metadata?: Record<string, unknown>,
  traceId?: string,
): void {
  const db = getDb();

  // Fire-and-forget: insert usage record without blocking the caller
  db.insert(usageRecords)
    .values({
      agentDid,
      action,
      amountUsd: amountUsd.toString(),
      metadata: metadata ?? null,
      traceId: traceId ?? null,
    })
    .then(() => {
      logger.debug("Usage recorded", { agentDid, action, amountUsd });
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      logger.error("Failed to record usage", {
        agentDid,
        action,
        amountUsd,
        error: message,
      });
    });
}

// ---------------------------------------------------------------------------
// getAgentUsage — usage summary for a billing period
// ---------------------------------------------------------------------------

export async function getAgentUsage(
  agentDid: string,
  from: Date,
  to: Date,
): Promise<UsageSummary> {
  const db = getDb();

  const conditions = [
    eq(usageRecords.agentDid, agentDid),
    gte(usageRecords.createdAt, from),
    lte(usageRecords.createdAt, to),
  ];

  const [records, breakdown] = await Promise.all([
    db
      .select({
        totalRecords: sql<number>`count(*)::int`.as("total_records"),
        totalAmountUsd: sql<number>`coalesce(sum(${usageRecords.amountUsd}::numeric), 0)::float`.as(
          "total_amount_usd",
        ),
      })
      .from(usageRecords)
      .where(and(...conditions)),
    db
      .select({
        action: usageRecords.action,
        count: sql<number>`count(*)::int`.as("count"),
        totalUsd: sql<number>`coalesce(sum(${usageRecords.amountUsd}::numeric), 0)::float`.as(
          "total_usd",
        ),
      })
      .from(usageRecords)
      .where(and(...conditions))
      .groupBy(usageRecords.action),
  ]);

  const byAction: Record<string, { count: number; totalUsd: number }> = {};
  for (const row of breakdown) {
    byAction[row.action] = { count: row.count, totalUsd: row.totalUsd };
  }

  return {
    agentDid,
    from,
    to,
    totalRecords: records[0]?.totalRecords ?? 0,
    totalAmountUsd: records[0]?.totalAmountUsd ?? 0,
    byAction,
  };
}

// ---------------------------------------------------------------------------
// getAgentBill — calculate bill based on usage
// ---------------------------------------------------------------------------

export async function getAgentBill(
  agentDid: string,
  from: Date,
  to: Date,
): Promise<AgentBill> {
  const usage = await getAgentUsage(agentDid, from, to);
  const lineItems: BillLineItem[] = [];

  // Per-action flat fees
  for (const [action, stats] of Object.entries(usage.byAction)) {
    const unitPrice = ACTION_FEES[action] ?? 0;
    const total = unitPrice * stats.count;

    lineItems.push({
      action,
      count: stats.count,
      unitPriceUsd: unitPrice,
      totalUsd: Math.round(total * 100_000_000) / 100_000_000,
    });
  }

  // Transaction volume fee (5 bps on total volume)
  if (usage.totalAmountUsd > 0) {
    const volumeFee =
      (usage.totalAmountUsd * TRANSACTION_FEE_BPS) / 10_000;

    lineItems.push({
      action: "transaction_volume_fee",
      count: 1,
      unitPriceUsd: volumeFee,
      totalUsd: Math.round(volumeFee * 100_000_000) / 100_000_000,
    });
  }

  const totalUsd = lineItems.reduce((sum, item) => sum + item.totalUsd, 0);

  return {
    agentDid,
    from,
    to,
    lineItems,
    totalUsd: Math.round(totalUsd * 100_000_000) / 100_000_000,
    generatedAt: new Date().toISOString(),
  };
}
