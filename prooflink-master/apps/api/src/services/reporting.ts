import { eq } from "drizzle-orm";

import { getDb } from "../db/index.js";
import { complianceChecks, reports } from "../db/schema.js";
import type { ComplianceCheck, Report } from "../db/schema.js";
import { logger } from "../utils/logger.js";

// ---------------------------------------------------------------------------
// SAR trigger factors
// ---------------------------------------------------------------------------

const SAR_TRIGGER_FACTORS = new Set([
  "sanctions_match",
  "structuring",
  "mixer_interaction",
  "rapid_movement",
  "darknet_interaction",
]);

const SAR_RISK_THRESHOLD = 70;
const CTR_AMOUNT_THRESHOLD_USD = 10_000;

// ---------------------------------------------------------------------------
// Auto-generation decision helpers
// ---------------------------------------------------------------------------

export function shouldAutoGenerateSAR(
  riskScore: number,
  factors: string[],
): boolean {
  if (riskScore > SAR_RISK_THRESHOLD) return true;
  return factors.some((f) => SAR_TRIGGER_FACTORS.has(f));
}

export function shouldAutoGenerateCTR(amountUsd: number): boolean {
  return Number.isFinite(amountUsd) && amountUsd >= CTR_AMOUNT_THRESHOLD_USD;
}

// ---------------------------------------------------------------------------
// Priority derivation
// ---------------------------------------------------------------------------

function derivePriority(
  riskScore: number,
  factors: string[],
): "LOW" | "NORMAL" | "HIGH" | "CRITICAL" {
  if (factors.includes("sanctions_match")) return "CRITICAL";
  if (riskScore >= 90) return "CRITICAL";
  if (riskScore >= 70) return "HIGH";
  if (riskScore >= 50) return "NORMAL";
  return "LOW";
}

// ---------------------------------------------------------------------------
// Report generators
// ---------------------------------------------------------------------------

export async function generateSAR(
  checkId: string,
  reason: string,
  data: Record<string, unknown>,
): Promise<Report> {
  const db = getDb();

  let check: ComplianceCheck | undefined;
  try {
    const [row] = await db
      .select()
      .from(complianceChecks)
      .where(eq(complianceChecks.id, checkId))
      .limit(1);
    check = row;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`DB error fetching compliance check ${checkId}: ${message}`);
  }

  if (!check) {
    throw new Error(`Compliance check ${checkId} not found`);
  }

  const riskFactors = extractRiskFactors(check);
  const priority = derivePriority(check.riskScore, riskFactors);

  const reportData: Record<string, unknown> = {
    ...data,
    complianceCheck: {
      id: check.id,
      senderAddress: check.senderAddress,
      receiverAddress: check.receiverAddress,
      senderAgentDid: check.senderAgentDid,
      receiverAgentDid: check.receiverAgentDid,
      amount: check.amount,
      asset: check.asset,
      chain: check.chain,
      protocol: check.protocol,
      status: check.status,
      riskScore: check.riskScore,
      checks: check.checks,
      createdAt: check.createdAt.toISOString(),
    },
    riskFactors,
    generatedAt: new Date().toISOString(),
  };

  let report: Report | undefined;
  try {
    const [row] = await db
      .insert(reports)
      .values({
        type: "SAR",
        status: "DRAFT",
        priority,
        complianceCheckId: checkId,
        agentDid: check.senderAgentDid ?? undefined,
        triggerReason: reason,
        reportData,
      })
      .returning();
    report = row;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`DB error inserting SAR for check ${checkId}: ${message}`);
  }

  if (!report) {
    throw new Error("Failed to create SAR report");
  }

  logger.info("SAR report generated", {
    reportId: report.id,
    checkId,
    priority,
    reason,
  });

  return report;
}

export async function generateCTR(
  checkId: string,
  data: Record<string, unknown>,
): Promise<Report> {
  const db = getDb();

  let check: ComplianceCheck | undefined;
  try {
    const [row] = await db
      .select()
      .from(complianceChecks)
      .where(eq(complianceChecks.id, checkId))
      .limit(1);
    check = row;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`DB error fetching compliance check ${checkId}: ${message}`);
  }

  if (!check) {
    throw new Error(`Compliance check ${checkId} not found`);
  }

  const reportData: Record<string, unknown> = {
    ...data,
    complianceCheck: {
      id: check.id,
      senderAddress: check.senderAddress,
      receiverAddress: check.receiverAddress,
      senderAgentDid: check.senderAgentDid,
      receiverAgentDid: check.receiverAgentDid,
      amount: check.amount,
      asset: check.asset,
      chain: check.chain,
      protocol: check.protocol,
      status: check.status,
      riskScore: check.riskScore,
      checks: check.checks,
      createdAt: check.createdAt.toISOString(),
    },
    generatedAt: new Date().toISOString(),
  };

  let report: Report | undefined;
  try {
    const [row] = await db
      .insert(reports)
      .values({
        type: "CTR",
        status: "DRAFT",
        priority: "NORMAL",
        complianceCheckId: checkId,
        agentDid: check.senderAgentDid ?? undefined,
        triggerReason: `Currency transaction >= $${CTR_AMOUNT_THRESHOLD_USD.toLocaleString()} USD`,
        reportData,
      })
      .returning();
    report = row;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`DB error inserting CTR for check ${checkId}: ${message}`);
  }

  if (!report) {
    throw new Error("Failed to create CTR report");
  }

  logger.info("CTR report generated", {
    reportId: report.id,
    checkId,
    amountUsd: data["amountUsd"],
  });

  return report;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function extractRiskFactors(check: ComplianceCheck): string[] {
  const factors: string[] = [];
  const checks = check.checks as Array<Record<string, unknown>>;

  for (const c of checks) {
    if (c["checkType"] === "SANCTIONS_SCREENING" && c["result"] === "FAILED") {
      factors.push("sanctions_match");
    }
    if (c["checkType"] === "AML_MONITORING" && c["result"] === "FAILED") {
      factors.push("aml_flag");
    }
  }

  if (check.riskScore >= 80) {
    factors.push("high_risk_score");
  }

  return factors;
}
