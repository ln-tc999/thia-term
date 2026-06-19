import { and, eq, gte, sql } from "drizzle-orm";

import { getDb } from "../db/index.js";
import { agents, invoices } from "../db/schema.js";

// ---------------------------------------------------------------------------
// DelegationScope type
// ---------------------------------------------------------------------------

export interface DelegationScope {
  maxTransactionUsd?: number;
  dailyLimitUsd?: number;
  allowedChains?: string[];
  allowedAssets?: string[];
  allowedCounterparties?: string[];
}

function parseDelegationScope(raw: unknown): DelegationScope | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  return {
    maxTransactionUsd: typeof obj["maxTransactionUsd"] === "number" ? obj["maxTransactionUsd"] : undefined,
    dailyLimitUsd: typeof obj["dailyLimitUsd"] === "number" ? obj["dailyLimitUsd"] : undefined,
    allowedChains: Array.isArray(obj["allowedChains"]) ? (obj["allowedChains"] as string[]) : undefined,
    allowedAssets: Array.isArray(obj["allowedAssets"]) ? (obj["allowedAssets"] as string[]) : undefined,
    allowedCounterparties: Array.isArray(obj["allowedCounterparties"]) ? (obj["allowedCounterparties"] as string[]) : undefined,
  };
}

// ---------------------------------------------------------------------------
// Result type
// ---------------------------------------------------------------------------

export interface ScopeCheckResult {
  allowed: boolean;
  reason?: string;
}

// ---------------------------------------------------------------------------
// Core check
// ---------------------------------------------------------------------------

export async function checkDelegationScope(
  agentDid: string,
  amount: number,
  currency: string,
  chain: string,
  counterpartyAddress: string,
): Promise<ScopeCheckResult> {
  let agent: { delegationScope: Record<string, unknown> | null } | undefined;

  try {
    const db = getDb();
    const [row] = await db
      .select({ delegationScope: agents.delegationScope })
      .from(agents)
      .where(eq(agents.agentDid, agentDid))
      .limit(1);
    agent = row;
  } catch (err) {
    // DB unavailable — fail closed to prevent spend limit bypass
    const message = err instanceof Error ? err.message : String(err);
    // eslint-disable-next-line no-console
    console.error("[spend-enforcement] DB error during agent lookup, failing closed", { agentDid, error: message });
    return { allowed: false, reason: "Compliance check unavailable — transaction blocked for safety" };
  }

  // No agent or no scope => backwards compatible, allow
  if (!agent) return { allowed: true };

  const scope = parseDelegationScope(agent.delegationScope);
  if (!scope) return { allowed: true };

  // (a) maxTransactionUsd — 0 means unlimited
  if (scope.maxTransactionUsd && scope.maxTransactionUsd > 0 && amount > scope.maxTransactionUsd) {
    return {
      allowed: false,
      reason: `Transaction amount ${amount} ${currency} exceeds max per-transaction limit of ${scope.maxTransactionUsd} USD`,
    };
  }

  // (b) allowedChains — empty array means any
  if (scope.allowedChains && scope.allowedChains.length > 0) {
    const normalizedChain = chain.toLowerCase();
    const allowed = scope.allowedChains.some((c) => c.toLowerCase() === normalizedChain);
    if (!allowed) {
      return {
        allowed: false,
        reason: `Chain "${chain}" is not in the agent's allowed chains: [${scope.allowedChains.join(", ")}]`,
      };
    }
  }

  // (c) allowedAssets — empty array means any
  if (scope.allowedAssets && scope.allowedAssets.length > 0) {
    const normalizedCurrency = currency.toLowerCase();
    const allowed = scope.allowedAssets.some((a) => a.toLowerCase() === normalizedCurrency);
    if (!allowed) {
      return {
        allowed: false,
        reason: `Asset "${currency}" is not in the agent's allowed assets: [${scope.allowedAssets.join(", ")}]`,
      };
    }
  }

  // (d) allowedCounterparties — empty array means any
  if (scope.allowedCounterparties && scope.allowedCounterparties.length > 0) {
    const normalizedCounterparty = counterpartyAddress.toLowerCase();
    const allowed = scope.allowedCounterparties.some((cp) => cp.toLowerCase() === normalizedCounterparty);
    if (!allowed) {
      return {
        allowed: false,
        reason: `Counterparty "${counterpartyAddress}" is not in the agent's allowed counterparties`,
      };
    }
  }

  // (e) dailyLimitUsd — 0 means unlimited
  if (scope.dailyLimitUsd && scope.dailyLimitUsd > 0) {
    try {
      const db = getDb();
      const todayStart = new Date();
      todayStart.setUTCHours(0, 0, 0, 0);

      const [result] = await db
        .select({
          dailyTotal: sql<string>`coalesce(sum(${invoices.totalAmount}), 0)::text`.as("daily_total"),
        })
        .from(invoices)
        .where(
          and(
            eq(invoices.issuerAgentDid, agentDid),
            gte(invoices.createdAt, todayStart),
          ),
        );

      const dailyTotal = Number(result?.dailyTotal ?? 0);
      if (dailyTotal + amount > scope.dailyLimitUsd) {
        return {
          allowed: false,
          reason: `Adding ${amount} ${currency} would exceed daily limit of ${scope.dailyLimitUsd} USD (spent today: ${dailyTotal})`,
        };
      }
    } catch (err) {
      // DB unavailable — fail closed to prevent spend limit bypass
      // eslint-disable-next-line no-console
      console.error("[spend-enforcement] Daily limit check failed, blocking transaction", { agentDid, error: String(err) });
      return { allowed: false, reason: "Daily limit check unavailable — transaction blocked for safety" };
    }
  }

  return { allowed: true };
}
