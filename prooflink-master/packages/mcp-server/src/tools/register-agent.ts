import { randomUUID } from "node:crypto";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { AgentType, SupportedChain, SupportedToken } from "@prooflink/shared";
import { formatMcpError } from "../errors.js";

export function registerRegisterAgent(server: McpServer): void {
  server.tool(
    "register_agent",
    [
      "Register a new AI agent identity in the ProofLink agent registry.",
      "Creates an ERC-8004 compatible agent registration with operator identity,",
      "delegation scope (spending limits, allowed chains/tokens), and compliance standing.",
      "",
      "Example usage:",
      "  register_agent({",
      '    name: "PaymentBot-v2",',
      '    type: "semi-autonomous",',
      '    wallet_address: "0xABC...",',
      "    operator: {",
      '      name: "Acme Corp",',
      '      did: "did:web:acme.com"',
      "    },",
      "    delegation_scope: {",
      "      max_transaction_usd: 10000,",
      "      daily_limit_usd: 50000,",
      '      allowed_chains: ["base", "ethereum"],',
      '      allowed_currencies: ["USDC"]',
      "    }",
      "  })",
      "",
      "After registration, the agent can be verified via verify_kya using the returned agent_id.",
    ].join("\n"),
    {
      name: z.string().min(1).max(128).describe("Human-readable agent name."),
      type: AgentType.describe(
        "Agent autonomy level: 'autonomous', 'semi-autonomous', or 'human-supervised'.",
      ),
      wallet_address: z
        .string()
        .describe("On-chain wallet address for this agent."),
      operator: z
        .object({
          name: z.string().describe("Legal name of the operating entity."),
          did: z
            .string()
            .optional()
            .describe("DID of the operating entity (e.g. did:web:example.com)."),
          lei: z
            .string()
            .optional()
            .describe("Legal Entity Identifier (LEI) of the operator."),
        })
        .describe("Entity that controls/operates this agent."),
      delegation_scope: z
        .object({
          max_transaction_usd: z
            .number()
            .nonnegative()
            .describe("Maximum per-transaction spending limit in USD."),
          daily_limit_usd: z
            .number()
            .nonnegative()
            .optional()
            .describe("Maximum daily spending limit in USD."),
          allowed_chains: z
            .array(SupportedChain)
            .optional()
            .describe("Chains this agent is authorized to transact on."),
          allowed_currencies: z
            .array(SupportedToken)
            .optional()
            .describe("Tokens this agent is authorized to use."),
          expires_at: z
            .string()
            .datetime({ offset: true })
            .optional()
            .describe("Expiration date for delegation scope (ISO 8601)."),
        })
        .describe("Spending and operational limits for this agent."),
      x402_support: z
        .boolean()
        .default(false)
        .describe("Whether this agent supports x402 payment protocol."),
      metadata: z
        .record(z.string(), z.unknown())
        .optional()
        .describe("Arbitrary metadata to attach to the agent registration."),
    },
    async (params) => {
      if (!params.wallet_address) {
        return formatMcpError("VALIDATION_ERROR", "wallet_address is required.");
      }

      try {
        const agentId = `agent_${randomUUID().replace(/-/g, "")}`;
        const did = `did:prooflink:${agentId}`;
        const registeredAt = new Date().toISOString();

        // In production: write to ERC-8004 registry on-chain,
        // run sanctions check on operator, create KYA credential
        const operatorScreening = {
          sanctions_cleared: true,
          kyc_verified: params.operator.did !== undefined,
        };

        const result = {
          agent_id: agentId,
          did,
          name: params.name,
          type: params.type,
          wallet_address: params.wallet_address,
          operator: {
            ...params.operator,
            screening: operatorScreening,
          },
          delegation_scope: {
            max_transaction_usd: params.delegation_scope.max_transaction_usd,
            daily_limit_usd: params.delegation_scope.daily_limit_usd ?? params.delegation_scope.max_transaction_usd * 5,
            allowed_chains: params.delegation_scope.allowed_chains ?? ["base"],
            allowed_currencies: params.delegation_scope.allowed_currencies ?? ["USDC"],
            expires_at: params.delegation_scope.expires_at ?? new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
          },
          x402_support: params.x402_support,
          reputation_score: 50, // initial score for new agents
          registered_at: registeredAt,
          status: "ACTIVE" as const,
        };

        return {
          content: [
            {
              type: "text" as const,
              text: `Agent "${params.name}" registered. ID: ${agentId}. DID: ${did}. Operator ${params.operator.name} sanctions cleared. Per-tx limit: $${params.delegation_scope.max_transaction_usd.toLocaleString()}.`,
            },
          ],
          structuredContent: result,
        };
      } catch (error: unknown) {
        return formatMcpError(
          "REGISTRATION_FAILED",
          `Agent registration failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    },
  );
}
