import { Hono } from "hono";
import { z } from "zod";

import { validate } from "../middleware/validate.js";
import {
  buildAgentCard,
  buildPlatformAgentCard,
  registerExternalAgent,
  searchAgents,
} from "../services/discovery.js";

// ---------------------------------------------------------------------------
// Request / query schemas
// ---------------------------------------------------------------------------

const SearchAgentsQuery = z.object({
  q: z.string().optional(),
  kyaValid: z.enum(["true", "false"]).optional(),
  minComplianceScore: z.coerce.number().int().min(0).max(100).optional(),
  allowedChain: z.string().optional(),
  allowedAsset: z.string().optional(),
  capabilities: z.string().optional(), // comma-separated
  protocol: z.string().optional(),
  agentType: z.enum(["autonomous", "semi-autonomous", "human-supervised"]).optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

const AgentDidParams = z.object({
  did: z.string().min(1, "DID is required"),
});

const ImportAgentCardRequest = z.object({
  agentCard: z.record(z.unknown()),
  sourceUrl: z.string().url().optional(),
});

// ---------------------------------------------------------------------------
// Route group
// ---------------------------------------------------------------------------

export const discovery = new Hono();

// GET /v1/discovery/agents — compliance-aware agent search
discovery.get("/agents", validate({ query: SearchAgentsQuery }), async (c) => {
  const query = c.get("validatedQuery") as z.infer<typeof SearchAgentsQuery>;

  const result = await searchAgents({
    q: query.q,
    kyaValid: query.kyaValid === "true",
    minComplianceScore: query.minComplianceScore,
    allowedChain: query.allowedChain,
    allowedAsset: query.allowedAsset,
    capabilities: query.capabilities?.split(",").map((s) => s.trim()),
    protocol: query.protocol,
    agentType: query.agentType,
    page: query.page,
    limit: query.limit,
  });

  return c.json({
    success: true,
    data: result,
  });
});

// GET /v1/discovery/agents/:did/card — get a specific agent's A2A card
discovery.get(
  "/agents/:did/card",
  validate({ params: AgentDidParams }),
  async (c) => {
    const { did } = c.get("validatedParams") as z.infer<typeof AgentDidParams>;
    const decodedDid = decodeURIComponent(did);

    const card = await buildAgentCard(decodedDid);

    if (!card) {
      return c.json(
        {
          success: false,
          error: { code: "NOT_FOUND", message: "Agent not found." },
        },
        404,
      );
    }

    return c.json({
      success: true,
      data: card,
    });
  },
);

// POST /v1/discovery/agents/import — import external A2A agent card
discovery.post(
  "/agents/import",
  validate({ body: ImportAgentCardRequest }),
  async (c) => {
    const { agentCard, sourceUrl } = c.get("validatedBody") as z.infer<
      typeof ImportAgentCardRequest
    >;

    try {
      const result = await registerExternalAgent(agentCard, sourceUrl);
      return c.json(
        {
          success: true,
          data: {
            agentDid: result.agentDid,
            id: result.id,
            created: result.created,
            message: result.created
              ? "External agent imported successfully."
              : "Existing agent record updated from card.",
          },
        },
        result.created ? 201 : 200,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return c.json(
        {
          success: false,
          error: { code: "IMPORT_FAILED", message },
        },
        500,
      );
    }
  },
);

// ---------------------------------------------------------------------------
// Well-known route — must be mounted separately at the app root
// ---------------------------------------------------------------------------

export const wellKnownAgent = new Hono();

// GET /.well-known/agent.json — ProofLink platform Agent Card
wellKnownAgent.get("/agent.json", (c) => {
  const card = buildPlatformAgentCard();
  return c.json(card);
});
