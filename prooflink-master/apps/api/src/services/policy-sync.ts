import { and, eq, gte, sql } from "drizzle-orm";

import { getDb } from "../db/index.js";
import { agentPolicies, complianceChecks } from "../db/schema.js";
import { logger } from "../utils/logger.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ChainPolicy {
  chain: string; // CAIP-2 format: "eip155:1", "eip155:8453", "solana:mainnet"
  maxTransactionUsd: number;
  dailyLimitUsd: number;
  allowedAssets: string[];
  allowedCounterparties: string[];
  paymasterAddress?: string;
}

export interface AgentPolicy {
  agentDid: string;
  chains: ChainPolicy[];
  globalDailyLimitUsd: number;
  globalMonthlyLimitUsd: number;
  velocityWindow: number; // seconds
  blockedCounterparties: string[];
  allowedProtocols: string[];
  updatedAt: string; // ISO-8601
}

export interface ChainSyncState {
  chain: string;
  synced: boolean;
  lastSyncedVersion: number;
  lastSyncedAt: string | null;
  error: string | null;
}

export interface PolicySyncEvent {
  agentDid: string;
  chain: string;
  version: number;
  policy: ChainPolicy;
  globalLimits: {
    dailyLimitUsd: number;
    monthlyLimitUsd: number;
    velocityWindow: number;
    blockedCounterparties: string[];
  };
  timestamp: string;
}

export interface SpendSummary {
  chain: string;
  dailySpendUsd: number;
  monthlySpendUsd: number;
  transactionCount: number;
}

export interface AggregatedSpend {
  agentDid: string;
  totalDailySpendUsd: number;
  totalMonthlySpendUsd: number;
  perChain: SpendSummary[];
  computedAt: string;
}

export interface CrossChainValidation {
  allowed: boolean;
  reason?: string;
  currentDailySpendUsd: number;
  currentMonthlySpendUsd: number;
  globalDailyLimitUsd: number;
  globalMonthlyLimitUsd: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseAgentPolicy(raw: Record<string, unknown>): AgentPolicy {
  return {
    agentDid: String(raw["agentDid"] ?? ""),
    chains: Array.isArray(raw["chains"]) ? (raw["chains"] as ChainPolicy[]) : [],
    globalDailyLimitUsd: typeof raw["globalDailyLimitUsd"] === "number" ? raw["globalDailyLimitUsd"] : 0,
    globalMonthlyLimitUsd: typeof raw["globalMonthlyLimitUsd"] === "number" ? raw["globalMonthlyLimitUsd"] : 0,
    velocityWindow: typeof raw["velocityWindow"] === "number" ? raw["velocityWindow"] : 86400,
    blockedCounterparties: Array.isArray(raw["blockedCounterparties"])
      ? (raw["blockedCounterparties"] as string[])
      : [],
    allowedProtocols: Array.isArray(raw["allowedProtocols"])
      ? (raw["allowedProtocols"] as string[])
      : [],
    updatedAt: typeof raw["updatedAt"] === "string" ? raw["updatedAt"] : new Date().toISOString(),
  };
}

function parseSyncStatus(raw: Record<string, unknown>): Record<string, ChainSyncState> {
  const result: Record<string, ChainSyncState> = {};
  for (const [chain, state] of Object.entries(raw)) {
    if (state && typeof state === "object") {
      const s = state as Record<string, unknown>;
      result[chain] = {
        chain,
        synced: s["synced"] === true,
        lastSyncedVersion: typeof s["lastSyncedVersion"] === "number" ? s["lastSyncedVersion"] : 0,
        lastSyncedAt: typeof s["lastSyncedAt"] === "string" ? s["lastSyncedAt"] : null,
        error: typeof s["error"] === "string" ? s["error"] : null,
      };
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// getAgentPolicy
// ---------------------------------------------------------------------------

export async function getAgentPolicy(agentDid: string): Promise<{
  policy: AgentPolicy;
  version: number;
  syncStatus: Record<string, ChainSyncState>;
} | null> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(agentPolicies)
    .where(eq(agentPolicies.agentDid, agentDid))
    .limit(1);

  if (!row) return null;

  return {
    policy: parseAgentPolicy(row.policy),
    version: row.version,
    syncStatus: parseSyncStatus(row.syncStatus),
  };
}

// ---------------------------------------------------------------------------
// updateAgentPolicy
// ---------------------------------------------------------------------------

export async function updateAgentPolicy(
  agentDid: string,
  policy: AgentPolicy,
): Promise<{ version: number; syncEvents: PolicySyncEvent[] }> {
  const db = getDb();
  const now = new Date().toISOString();

  // Build initial sync status — all chains marked as pending
  const syncStatus: Record<string, ChainSyncState> = {};
  for (const chainPolicy of policy.chains) {
    syncStatus[chainPolicy.chain] = {
      chain: chainPolicy.chain,
      synced: false,
      lastSyncedVersion: 0,
      lastSyncedAt: null,
      error: null,
    };
  }

  const policyData: Record<string, unknown> = {
    ...policy,
    agentDid,
    updatedAt: now,
  };

  // Upsert: insert or update with version increment
  const existing = await getAgentPolicy(agentDid);
  const newVersion = existing ? existing.version + 1 : 1;

  if (existing) {
    await db
      .update(agentPolicies)
      .set({
        policy: policyData,
        version: newVersion,
        syncStatus: syncStatus as unknown as Record<string, unknown>,
        updatedAt: new Date(),
      })
      .where(eq(agentPolicies.agentDid, agentDid));
  } else {
    await db.insert(agentPolicies).values({
      agentDid,
      policy: policyData,
      version: newVersion,
      syncStatus: syncStatus as unknown as Record<string, unknown>,
    });
  }

  // Generate sync events for all chains
  const syncEvents: PolicySyncEvent[] = policy.chains.map((chainPolicy) => ({
    agentDid,
    chain: chainPolicy.chain,
    version: newVersion,
    policy: chainPolicy,
    globalLimits: {
      dailyLimitUsd: policy.globalDailyLimitUsd,
      monthlyLimitUsd: policy.globalMonthlyLimitUsd,
      velocityWindow: policy.velocityWindow,
      blockedCounterparties: policy.blockedCounterparties,
    },
    timestamp: now,
  }));

  logger.info("Agent policy updated, sync events emitted", {
    agentDid,
    version: newVersion,
    chainCount: policy.chains.length,
  });

  return { version: newVersion, syncEvents };
}

// ---------------------------------------------------------------------------
// syncPolicyToChain
// ---------------------------------------------------------------------------

export async function syncPolicyToChain(
  agentDid: string,
  chain: string,
): Promise<PolicySyncEvent | null> {
  const record = await getAgentPolicy(agentDid);
  if (!record) return null;

  const { policy, version } = record;
  const chainPolicy = policy.chains.find((cp) => cp.chain === chain);
  if (!chainPolicy) return null;

  const now = new Date().toISOString();

  // Update sync status for this chain
  const db = getDb();
  const currentSyncStatus = record.syncStatus;
  currentSyncStatus[chain] = {
    chain,
    synced: true,
    lastSyncedVersion: version,
    lastSyncedAt: now,
    error: null,
  };

  await db
    .update(agentPolicies)
    .set({
      syncStatus: currentSyncStatus as unknown as Record<string, unknown>,
      updatedAt: new Date(),
    })
    .where(eq(agentPolicies.agentDid, agentDid));

  logger.info("Policy synced to chain", { agentDid, chain, version });

  return {
    agentDid,
    chain,
    version,
    policy: chainPolicy,
    globalLimits: {
      dailyLimitUsd: policy.globalDailyLimitUsd,
      monthlyLimitUsd: policy.globalMonthlyLimitUsd,
      velocityWindow: policy.velocityWindow,
      blockedCounterparties: policy.blockedCounterparties,
    },
    timestamp: now,
  };
}

// ---------------------------------------------------------------------------
// aggregateSpendAcrossChains
// ---------------------------------------------------------------------------

export async function aggregateSpendAcrossChains(agentDid: string): Promise<AggregatedSpend> {
  const db = getDb();
  const now = new Date();

  const todayStart = new Date(now);
  todayStart.setUTCHours(0, 0, 0, 0);

  const monthStart = new Date(now.getUTCFullYear(), now.getUTCMonth(), 1);
  monthStart.setUTCHours(0, 0, 0, 0);

  // Daily spend per chain
  const dailyRows = await db
    .select({
      chain: complianceChecks.chain,
      totalUsd: sql<string>`coalesce(sum(${complianceChecks.amount}::numeric), 0)::text`.as("total_usd"),
      txCount: sql<number>`count(*)::int`.as("tx_count"),
    })
    .from(complianceChecks)
    .where(
      and(
        eq(complianceChecks.senderAgentDid, agentDid),
        eq(complianceChecks.status, "APPROVED"),
        gte(complianceChecks.createdAt, todayStart),
      ),
    )
    .groupBy(complianceChecks.chain);

  // Monthly spend per chain
  const monthlyRows = await db
    .select({
      chain: complianceChecks.chain,
      totalUsd: sql<string>`coalesce(sum(${complianceChecks.amount}::numeric), 0)::text`.as("total_usd"),
      txCount: sql<number>`count(*)::int`.as("tx_count"),
    })
    .from(complianceChecks)
    .where(
      and(
        eq(complianceChecks.senderAgentDid, agentDid),
        eq(complianceChecks.status, "APPROVED"),
        gte(complianceChecks.createdAt, monthStart),
      ),
    )
    .groupBy(complianceChecks.chain);

  // Build per-chain summary map
  const chainMap = new Map<string, SpendSummary>();

  for (const row of dailyRows) {
    chainMap.set(row.chain, {
      chain: row.chain,
      dailySpendUsd: Number(row.totalUsd),
      monthlySpendUsd: 0,
      transactionCount: row.txCount,
    });
  }

  for (const row of monthlyRows) {
    const existing = chainMap.get(row.chain);
    if (existing) {
      existing.monthlySpendUsd = Number(row.totalUsd);
    } else {
      chainMap.set(row.chain, {
        chain: row.chain,
        dailySpendUsd: 0,
        monthlySpendUsd: Number(row.totalUsd),
        transactionCount: row.txCount,
      });
    }
  }

  const perChain = Array.from(chainMap.values());
  const totalDailySpendUsd = perChain.reduce((sum, c) => sum + c.dailySpendUsd, 0);
  const totalMonthlySpendUsd = perChain.reduce((sum, c) => sum + c.monthlySpendUsd, 0);

  return {
    agentDid,
    totalDailySpendUsd,
    totalMonthlySpendUsd,
    perChain,
    computedAt: now.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// validateCrossChainSpend
// ---------------------------------------------------------------------------

export async function validateCrossChainSpend(
  agentDid: string,
  chain: string,
  amount: number,
): Promise<CrossChainValidation> {
  const record = await getAgentPolicy(agentDid);

  // No cross-chain policy => pass (backwards compatible — per-chain delegation scope still applies)
  if (!record) {
    return {
      allowed: true,
      currentDailySpendUsd: 0,
      currentMonthlySpendUsd: 0,
      globalDailyLimitUsd: 0,
      globalMonthlyLimitUsd: 0,
    };
  }

  const { policy } = record;
  const spend = await aggregateSpendAcrossChains(agentDid);

  // Check chain-specific policy
  const chainPolicy = policy.chains.find((cp) => cp.chain === chain);
  if (chainPolicy) {
    // Per-chain max transaction check
    if (chainPolicy.maxTransactionUsd > 0 && amount > chainPolicy.maxTransactionUsd) {
      return {
        allowed: false,
        reason: `Transaction ${amount} USD exceeds chain ${chain} max of ${chainPolicy.maxTransactionUsd} USD`,
        currentDailySpendUsd: spend.totalDailySpendUsd,
        currentMonthlySpendUsd: spend.totalMonthlySpendUsd,
        globalDailyLimitUsd: policy.globalDailyLimitUsd,
        globalMonthlyLimitUsd: policy.globalMonthlyLimitUsd,
      };
    }

    // Per-chain daily limit check
    const chainDailySpend = spend.perChain.find((c) => c.chain === chain)?.dailySpendUsd ?? 0;
    if (chainPolicy.dailyLimitUsd > 0 && chainDailySpend + amount > chainPolicy.dailyLimitUsd) {
      return {
        allowed: false,
        reason: `Adding ${amount} USD on ${chain} would exceed chain daily limit of ${chainPolicy.dailyLimitUsd} USD (spent: ${chainDailySpend})`,
        currentDailySpendUsd: spend.totalDailySpendUsd,
        currentMonthlySpendUsd: spend.totalMonthlySpendUsd,
        globalDailyLimitUsd: policy.globalDailyLimitUsd,
        globalMonthlyLimitUsd: policy.globalMonthlyLimitUsd,
      };
    }
  }

  // Check blocked counterparties is handled at route level — not here
  // (counterparty address is not passed to this function)

  // Global daily limit check (across ALL chains)
  if (policy.globalDailyLimitUsd > 0 && spend.totalDailySpendUsd + amount > policy.globalDailyLimitUsd) {
    return {
      allowed: false,
      reason: `Adding ${amount} USD would exceed global daily limit of ${policy.globalDailyLimitUsd} USD (total across all chains: ${spend.totalDailySpendUsd})`,
      currentDailySpendUsd: spend.totalDailySpendUsd,
      currentMonthlySpendUsd: spend.totalMonthlySpendUsd,
      globalDailyLimitUsd: policy.globalDailyLimitUsd,
      globalMonthlyLimitUsd: policy.globalMonthlyLimitUsd,
    };
  }

  // Global monthly limit check (across ALL chains)
  if (policy.globalMonthlyLimitUsd > 0 && spend.totalMonthlySpendUsd + amount > policy.globalMonthlyLimitUsd) {
    return {
      allowed: false,
      reason: `Adding ${amount} USD would exceed global monthly limit of ${policy.globalMonthlyLimitUsd} USD (total across all chains: ${spend.totalMonthlySpendUsd})`,
      currentDailySpendUsd: spend.totalDailySpendUsd,
      currentMonthlySpendUsd: spend.totalMonthlySpendUsd,
      globalDailyLimitUsd: policy.globalDailyLimitUsd,
      globalMonthlyLimitUsd: policy.globalMonthlyLimitUsd,
    };
  }

  return {
    allowed: true,
    currentDailySpendUsd: spend.totalDailySpendUsd,
    currentMonthlySpendUsd: spend.totalMonthlySpendUsd,
    globalDailyLimitUsd: policy.globalDailyLimitUsd,
    globalMonthlyLimitUsd: policy.globalMonthlyLimitUsd,
  };
}
