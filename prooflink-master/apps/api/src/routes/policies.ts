import { requireScope } from "../middleware/auth.js";
import { Hono } from "hono";
import { z } from "zod";

import { validate } from "../middleware/validate.js";
import { logger } from "../utils/logger.js";
import {
  getAgentPolicy,
  updateAgentPolicy,
  syncPolicyToChain,
  aggregateSpendAcrossChains,
  validateCrossChainSpend,
} from "../services/policy-sync.js";
import type { AgentPolicy, ChainPolicy } from "../services/policy-sync.js";

// ---------------------------------------------------------------------------
// Request schemas
// ---------------------------------------------------------------------------

const ChainPolicySchema = z.object({
  chain: z.string().min(1),
  maxTransactionUsd: z.number().min(0),
  dailyLimitUsd: z.number().min(0),
  allowedAssets: z.array(z.string()),
  allowedCounterparties: z.array(z.string()),
  paymasterAddress: z.string().optional(),
});

const UpdatePolicyBody = z.object({
  chains: z.array(ChainPolicySchema).min(1),
  globalDailyLimitUsd: z.number().min(0),
  globalMonthlyLimitUsd: z.number().min(0),
  velocityWindow: z.number().int().min(60).default(86400), // min 1 minute
  blockedCounterparties: z.array(z.string()).default([]),
  allowedProtocols: z.array(z.string()).default([]),
});

const SyncBody = z.object({
  chain: z.string().min(1),
});

const ValidateSpendBody = z.object({
  chain: z.string().min(1),
  amount: z.number().positive(),
});

const AgentDidParam = z.object({
  agentDid: z.string().min(1),
});

// ---------------------------------------------------------------------------
// Route group
// ---------------------------------------------------------------------------

export const policyRoutes = new Hono();

// GET /v1/policies/:agentDid — get agent's cross-chain policy
policyRoutes.get("/:agentDid", async (c) => {
  const agentDid = decodeURIComponent(c.req.param("agentDid"));
  const parsed = AgentDidParam.safeParse({ agentDid });
  if (!parsed.success) {
    return c.json({ success: false, error: { code: "VALIDATION_ERROR", message: "Invalid agentDid" } }, 400);
  }

  const record = await getAgentPolicy(agentDid);
  if (!record) {
    return c.json({ success: false, error: { code: "NOT_FOUND", message: "No policy found for agent" } }, 404);
  }

  return c.json({
    success: true,
    data: {
      agentDid,
      policy: record.policy,
      version: record.version,
      syncStatus: record.syncStatus,
    },
  });
});

// PUT /v1/policies/:agentDid — update policy (admin scope)
policyRoutes.put("/:agentDid", requireScope("admin"), validate({ body: UpdatePolicyBody }), async (c) => {
  const agentDid = decodeURIComponent(c.req.param("agentDid"));
  const parsed = AgentDidParam.safeParse({ agentDid });
  if (!parsed.success) {
    return c.json({ success: false, error: { code: "VALIDATION_ERROR", message: "Invalid agentDid" } }, 400);
  }

  const body = c.get("validatedBody") as z.infer<typeof UpdatePolicyBody>;

  const policy: AgentPolicy = {
    agentDid,
    chains: body.chains as ChainPolicy[],
    globalDailyLimitUsd: body.globalDailyLimitUsd,
    globalMonthlyLimitUsd: body.globalMonthlyLimitUsd,
    velocityWindow: body.velocityWindow,
    blockedCounterparties: body.blockedCounterparties,
    allowedProtocols: body.allowedProtocols,
    updatedAt: new Date().toISOString(),
  };

  const result = await updateAgentPolicy(agentDid, policy);

  logger.info("Policy updated via API", { agentDid, version: result.version });

  return c.json({
    success: true,
    data: {
      agentDid,
      version: result.version,
      syncEvents: result.syncEvents,
    },
  });
});

// POST /v1/policies/:agentDid/sync — trigger cross-chain sync for a specific chain
policyRoutes.post("/:agentDid/sync", requireScope("admin"), validate({ body: SyncBody }), async (c) => {
  const agentDid = decodeURIComponent(c.req.param("agentDid"));
  const parsed = AgentDidParam.safeParse({ agentDid });
  if (!parsed.success) {
    return c.json({ success: false, error: { code: "VALIDATION_ERROR", message: "Invalid agentDid" } }, 400);
  }

  const body = c.get("validatedBody") as z.infer<typeof SyncBody>;
  const syncEvent = await syncPolicyToChain(agentDid, body.chain);

  if (!syncEvent) {
    return c.json({
      success: false,
      error: { code: "NOT_FOUND", message: `No policy or chain config found for agent on chain ${body.chain}` },
    }, 404);
  }

  return c.json({
    success: true,
    data: {
      syncEvent,
    },
  });
});

// GET /v1/policies/:agentDid/spend — get aggregated spend across chains
policyRoutes.get("/:agentDid/spend", async (c) => {
  const agentDid = decodeURIComponent(c.req.param("agentDid"));
  const parsed = AgentDidParam.safeParse({ agentDid });
  if (!parsed.success) {
    return c.json({ success: false, error: { code: "VALIDATION_ERROR", message: "Invalid agentDid" } }, 400);
  }

  const spend = await aggregateSpendAcrossChains(agentDid);

  return c.json({
    success: true,
    data: spend,
  });
});

// POST /v1/policies/:agentDid/validate — validate a proposed spend against global limits
policyRoutes.post("/:agentDid/validate", validate({ body: ValidateSpendBody }), async (c) => {
  const agentDid = decodeURIComponent(c.req.param("agentDid"));
  const parsed = AgentDidParam.safeParse({ agentDid });
  if (!parsed.success) {
    return c.json({ success: false, error: { code: "VALIDATION_ERROR", message: "Invalid agentDid" } }, 400);
  }

  const body = c.get("validatedBody") as z.infer<typeof ValidateSpendBody>;
  const validation = await validateCrossChainSpend(agentDid, body.chain, body.amount);

  return c.json({
    success: true,
    data: validation,
  });
});
