import { and, desc, eq, gte, sql } from "drizzle-orm";

import { getDb } from "../db/index.js";
import { agents } from "../db/schema.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Google A2A-compatible Agent Card with ProofLink extensions */
export interface AgentCard {
  name: string;
  description: string;
  url: string;
  provider: {
    organization: string;
    url: string;
  };
  version: string;
  documentationUrl: string;
  capabilities: {
    streaming: boolean;
    pushNotifications: boolean;
    extendedAgentCard: boolean;
  };
  securitySchemes: Record<string, SecurityScheme>;
  security: Array<Record<string, string[]>>;
  skills: AgentSkill[];
  extensions: AgentCardExtension[];
  "x-prooflink": ProofLinkExtension;
}

interface SecurityScheme {
  type: string;
  scheme?: string;
  flows?: Record<string, unknown>;
}

interface AgentSkill {
  id: string;
  name: string;
  description: string;
  tags: string[];
  examples: string[];
  inputModes: string[];
  outputModes: string[];
}

interface AgentCardExtension {
  uri: string;
  data: Record<string, unknown>;
}

interface ProofLinkExtension {
  agentDid: string;
  complianceScore: number;
  kyaStatus: "VERIFIED" | "EXPIRED" | "UNVERIFIED";
  agentType: string;
  controllingEntity: {
    name: string;
    lei: string | null;
  };
  delegationScope: Record<string, unknown>;
  allowedChains: string[];
  allowedAssets: string[];
  erc8004Id: number | null;
  erc8004Registry: string | null;
  registeredAt: string;
  expiresAt: string | null;
}

export interface SearchAgentsQuery {
  q?: string;
  kyaValid?: boolean;
  minComplianceScore?: number;
  allowedChain?: string;
  allowedAsset?: string;
  capabilities?: string[];
  protocol?: string;
  agentType?: string;
  page: number;
  limit: number;
}

export interface ExternalAgentCardImport {
  agentCard: Record<string, unknown>;
  sourceUrl?: string;
}

// ---------------------------------------------------------------------------
// Service Functions
// ---------------------------------------------------------------------------

const BASE_URL = process.env["PROOFLINK_BASE_URL"] ?? "https://api.prooflink.io";

/**
 * Compute KYA status from an agent record.
 */
function computeKyaStatus(agent: {
  isActive: boolean;
  validatedAt: Date | null;
  expiresAt: Date | null;
}): "VERIFIED" | "EXPIRED" | "UNVERIFIED" {
  if (!agent.validatedAt) return "UNVERIFIED";
  if (!agent.isActive) return "EXPIRED";
  if (agent.expiresAt && agent.expiresAt < new Date()) return "EXPIRED";
  return "VERIFIED";
}

/**
 * Infer skills from an agent's type and delegation scope.
 * In production this would come from a skills registry; for now we derive
 * reasonable defaults from the agent metadata.
 */
function inferSkills(agent: {
  agentType: string;
  delegationScope: Record<string, unknown> | null;
}): AgentSkill[] {
  const skills: AgentSkill[] = [];

  // All agents can receive compliance checks
  skills.push({
    id: "compliance-check",
    name: "Compliance Check",
    description: "Accepts compliance verification requests for transactions",
    tags: ["compliance", "kya", "verification"],
    examples: ["Verify compliance for a $10,000 USDC transfer"],
    inputModes: ["application/json"],
    outputModes: ["application/json"],
  });

  const scope = agent.delegationScope ?? {};
  if (
    typeof scope["maxTransactionValue"] === "number" &&
    scope["maxTransactionValue"] > 0
  ) {
    skills.push({
      id: "process-payment",
      name: "Process Payment",
      description: `Handles payments up to $${scope["maxTransactionValue"]}`,
      tags: ["payment", "x402", "invoice"],
      examples: ["Pay invoice #INV-2024-001"],
      inputModes: ["application/json", "text"],
      outputModes: ["application/json"],
    });
  }

  return skills;
}

/**
 * Build an A2A-compatible Agent Card from a ProofLink agent DB record.
 */
export async function buildAgentCard(agentDid: string): Promise<AgentCard | null> {
  const db = getDb();

  const [agent] = await db
    .select()
    .from(agents)
    .where(eq(agents.agentDid, agentDid))
    .limit(1);

  if (!agent) return null;

  const scope = (agent.delegationScope ?? {}) as Record<string, unknown>;
  const allowedChains = Array.isArray(scope["allowedChains"])
    ? (scope["allowedChains"] as string[])
    : [];
  const allowedAssets = Array.isArray(scope["allowedCurrencies"])
    ? (scope["allowedCurrencies"] as string[])
    : [];

  const kyaStatus = computeKyaStatus(agent);

  return {
    name: agent.name ?? agent.agentDid,
    description: `ProofLink ${agent.agentType} agent operated by ${agent.controllingEntityName}`,
    url: `${BASE_URL}/v1/a2a/${encodeURIComponent(agent.agentDid)}`,
    provider: {
      organization: agent.controllingEntityName,
      url: BASE_URL,
    },
    version: "1.0.0",
    documentationUrl: `${BASE_URL}/docs/agents/${encodeURIComponent(agent.agentDid)}`,
    capabilities: {
      streaming: false,
      pushNotifications: false,
      extendedAgentCard: true,
    },
    securitySchemes: {
      BearerAuth: { type: "http", scheme: "bearer" },
    },
    security: [{ BearerAuth: [] }],
    skills: inferSkills(agent),
    extensions: [
      {
        uri: "https://prooflink.io/extensions/compliance/v1",
        data: {
          complianceScore: agent.complianceScore,
          kyaStatus,
        },
      },
    ],
    "x-prooflink": {
      agentDid: agent.agentDid,
      complianceScore: agent.complianceScore,
      kyaStatus,
      agentType: agent.agentType,
      controllingEntity: {
        name: agent.controllingEntityName,
        lei: agent.controllingEntityLei ?? null,
      },
      delegationScope: scope,
      allowedChains,
      allowedAssets,
      erc8004Id: agent.erc8004Id ?? null,
      erc8004Registry: agent.erc8004Registry ?? null,
      registeredAt: agent.createdAt.toISOString(),
      expiresAt: agent.expiresAt?.toISOString() ?? null,
    },
  };
}

/**
 * Search agents with compliance-aware filters.
 */
export async function searchAgents(query: SearchAgentsQuery): Promise<{
  items: AgentCard[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
}> {
  const db = getDb();
  const { page, limit } = query;
  const offset = (page - 1) * limit;

  const conditions = [];

  // Only active agents
  conditions.push(eq(agents.isActive, true));

  // KYA validity filter: not expired
  if (query.kyaValid) {
    conditions.push(
      sql`(${agents.expiresAt} IS NULL OR ${agents.expiresAt} > NOW())`,
    );
    conditions.push(sql`${agents.validatedAt} IS NOT NULL`);
  }

  // Minimum compliance score
  if (query.minComplianceScore !== undefined) {
    conditions.push(gte(agents.complianceScore, query.minComplianceScore));
  }

  // Agent type filter
  if (query.agentType) {
    conditions.push(eq(agents.agentType, query.agentType));
  }

  // Chain filter — check within JSONB delegationScope.allowedChains
  if (query.allowedChain) {
    conditions.push(
      sql`${agents.delegationScope}->'allowedChains' ? ${query.allowedChain}`,
    );
  }

  // Asset filter — check within JSONB delegationScope.allowedCurrencies
  if (query.allowedAsset) {
    conditions.push(
      sql`${agents.delegationScope}->'allowedCurrencies' ? ${query.allowedAsset}`,
    );
  }

  // Free-text search on name and agentDid
  if (query.q) {
    const pattern = `%${query.q}%`;
    conditions.push(
      sql`(${agents.name} ILIKE ${pattern} OR ${agents.agentDid} ILIKE ${pattern} OR ${agents.controllingEntityName} ILIKE ${pattern})`,
    );
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const [items, countResult] = await Promise.all([
    db
      .select()
      .from(agents)
      .where(whereClause)
      .orderBy(desc(agents.complianceScore), desc(agents.createdAt))
      .limit(limit)
      .offset(offset),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(agents)
      .where(whereClause),
  ]);

  const total = countResult[0]?.count ?? 0;

  // Build Agent Cards for each result
  const cards: AgentCard[] = items.map((agent) => {
    const scope = (agent.delegationScope ?? {}) as Record<string, unknown>;
    const allowedChains = Array.isArray(scope["allowedChains"])
      ? (scope["allowedChains"] as string[])
      : [];
    const allowedAssets = Array.isArray(scope["allowedCurrencies"])
      ? (scope["allowedCurrencies"] as string[])
      : [];
    const kyaStatus = computeKyaStatus(agent);

    return {
      name: agent.name ?? agent.agentDid,
      description: `ProofLink ${agent.agentType} agent operated by ${agent.controllingEntityName}`,
      url: `${BASE_URL}/v1/a2a/${encodeURIComponent(agent.agentDid)}`,
      provider: {
        organization: agent.controllingEntityName,
        url: BASE_URL,
      },
      version: "1.0.0",
      documentationUrl: `${BASE_URL}/docs/agents/${encodeURIComponent(agent.agentDid)}`,
      capabilities: {
        streaming: false,
        pushNotifications: false,
        extendedAgentCard: true,
      },
      securitySchemes: {
        BearerAuth: { type: "http", scheme: "bearer" },
      },
      security: [{ BearerAuth: [] }],
      skills: inferSkills(agent),
      extensions: [
        {
          uri: "https://prooflink.io/extensions/compliance/v1",
          data: { complianceScore: agent.complianceScore, kyaStatus },
        },
      ],
      "x-prooflink": {
        agentDid: agent.agentDid,
        complianceScore: agent.complianceScore,
        kyaStatus,
        agentType: agent.agentType,
        controllingEntity: {
          name: agent.controllingEntityName,
          lei: agent.controllingEntityLei ?? null,
        },
        delegationScope: scope,
        allowedChains,
        allowedAssets,
        erc8004Id: agent.erc8004Id ?? null,
        erc8004Registry: agent.erc8004Registry ?? null,
        registeredAt: agent.createdAt.toISOString(),
        expiresAt: agent.expiresAt?.toISOString() ?? null,
      },
    };
  });

  return {
    items: cards,
    pagination: {
      page,
      pageSize: limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
}

/**
 * Import an external A2A Agent Card into ProofLink's registry.
 * Extracts identity fields from the card and creates/updates the agent record.
 */
export async function registerExternalAgent(
  agentCard: Record<string, unknown>,
  sourceUrl?: string,
): Promise<{ agentDid: string; id: string; created: boolean }> {
  const db = getDb();

  // Extract fields from A2A card
  const name = typeof agentCard["name"] === "string" ? agentCard["name"] : "Unknown Agent";
  const url = typeof agentCard["url"] === "string" ? agentCard["url"] : sourceUrl ?? "";

  // Try to extract DID from x-prooflink extension or generate from URL
  const xProoflink = agentCard["x-prooflink"] as Record<string, unknown> | undefined;
  const agentDid =
    (typeof xProoflink?.["agentDid"] === "string" ? xProoflink["agentDid"] : null) ??
    `did:web:${new URL(url || "https://unknown.agent").hostname}`;

  const provider = agentCard["provider"] as Record<string, unknown> | undefined;
  const orgName =
    typeof provider?.["organization"] === "string"
      ? provider["organization"]
      : "External";

  // Check if agent already exists
  const [existing] = await db
    .select({ id: agents.id })
    .from(agents)
    .where(eq(agents.agentDid, agentDid))
    .limit(1);

  const now = new Date();
  const defaultExpiry = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000); // 1 year

  // Extract chain/currency info from x-prooflink if available
  const allowedChains = Array.isArray(xProoflink?.["allowedChains"])
    ? (xProoflink["allowedChains"] as string[])
    : [];
  const allowedAssets = Array.isArray(xProoflink?.["allowedAssets"])
    ? (xProoflink["allowedAssets"] as string[])
    : [];

  const delegationScope: Record<string, unknown> = {
    maxTransactionValue: 0,
    allowedChains,
    allowedCurrencies: allowedAssets,
    expiresAt: defaultExpiry.toISOString(),
    sourceUrl: sourceUrl ?? null,
    importedAgentCard: agentCard,
  };

  if (existing) {
    // Update existing record with refreshed card data
    await db
      .update(agents)
      .set({
        name,
        controllingEntityName: orgName,
        delegationScope,
        updatedAt: now,
      })
      .where(eq(agents.agentDid, agentDid));

    return { agentDid, id: existing.id, created: false };
  }

  // Create new record
  const [agent] = await db
    .insert(agents)
    .values({
      agentDid,
      name,
      agentType: (typeof xProoflink?.["agentType"] === "string"
        ? xProoflink["agentType"]
        : "autonomous") as "autonomous" | "semi-autonomous" | "human-supervised",
      walletAddress: "0x0000000000000000000000000000000000000000", // Placeholder for external agents
      controllingEntityName: orgName,
      complianceScore: 0, // External agents start at 0 until verified
      delegationScope,
      isActive: true,
      validatedAt: null, // Not validated until KYA is issued
      expiresAt: defaultExpiry,
    })
    .returning();

  if (!agent) {
    throw new Error("Failed to import external agent card");
  }

  return { agentDid, id: agent.id, created: true };
}

/**
 * Build the ProofLink platform's own Agent Card (served at /.well-known/agent.json).
 */
export function buildPlatformAgentCard(): Record<string, unknown> {
  return {
    name: "ProofLink",
    description:
      "Compliance-aware trust layer for agentic payments. Provides KYA identity, " +
      "sanctions screening, transaction compliance checks, and federated agent discovery.",
    url: `${BASE_URL}/v1/a2a`,
    provider: {
      organization: "ProofLink",
      url: BASE_URL,
    },
    version: "1.0.0",
    documentationUrl: `${BASE_URL}/docs`,
    capabilities: {
      streaming: false,
      pushNotifications: false,
      extendedAgentCard: true,
    },
    securitySchemes: {
      BearerAuth: { type: "http", scheme: "bearer" },
      ApiKey: { type: "apiKey", in: "header", name: "X-API-Key" },
    },
    security: [{ BearerAuth: [] }, { ApiKey: [] }],
    skills: [
      {
        id: "compliance-check",
        name: "Compliance Check",
        description: "Run a full compliance pipeline (sanctions, risk scoring, travel rule) on a transaction",
        tags: ["compliance", "sanctions", "aml", "risk"],
        examples: ["Check compliance for a $50,000 USDC transfer from 0xABC to 0xDEF on Base"],
        inputModes: ["application/json"],
        outputModes: ["application/json"],
      },
      {
        id: "agent-verification",
        name: "Agent Verification",
        description: "Verify an agent's KYA credential and delegation scope",
        tags: ["identity", "kya", "verification"],
        examples: ["Verify agent did:web:acme.com"],
        inputModes: ["application/json"],
        outputModes: ["application/json"],
      },
      {
        id: "agent-discovery",
        name: "Agent Discovery",
        description: "Search for compliant agents by capability, chain, asset, or compliance score",
        tags: ["discovery", "search", "registry"],
        examples: ["Find agents that can process payments on Base with USDC"],
        inputModes: ["application/json", "text"],
        outputModes: ["application/json"],
      },
      {
        id: "sanctions-screening",
        name: "Sanctions Screening",
        description: "Screen wallet addresses against OFAC and other sanctions lists",
        tags: ["sanctions", "ofac", "screening"],
        examples: ["Screen wallet 0xABC against sanctions lists"],
        inputModes: ["application/json"],
        outputModes: ["application/json"],
      },
    ],
    extensions: [
      {
        uri: "https://prooflink.io/extensions/compliance/v1",
        data: {
          supportedProtocols: ["x402", "erc-4337"],
          supportedChains: ["eip155:8453", "eip155:1", "eip155:42161"],
          complianceStandards: ["FATF-R16", "EU-TFR"],
        },
      },
    ],
    "x-prooflink": {
      platformDid: "did:prooflink:platform",
      registryVersion: "1.0.0",
      federationSupported: true,
    },
  };
}
