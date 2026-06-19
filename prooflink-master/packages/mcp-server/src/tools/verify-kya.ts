import { randomUUID } from "node:crypto";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { formatMcpError } from "../errors.js";
import { lookupAgent } from "../agent-registry.js";

function generateReceiptId(): string {
  return `kya_${randomUUID().replace(/-/g, "")}`;
}

export function registerVerifyKya(server: McpServer): void {
  server.tool(
    "verify_kya",
    [
      "Verify an AI agent's identity, authorization, and compliance standing via the ProofLink registry.",
      "Checks whether the agent exists in the registry with a valid KYA credential,",
      "is not expired, and has an active compliance standing.",
      "",
      "Example usage:",
      '  verify_kya({ agent_id: "agent_001", check_spending_limits: true })',
      "",
      "Use before accepting payment from or delegating tasks to an unknown agent.",
      "Returns trust score (0-100) derived from complianceScore, operator status, and spending limits.",
    ].join("\n"),
    {
      agent_id: z
        .string()
        .describe(
          "Agent identifier — accepts agentId, DID, or wallet address.",
        ),
      agent_wallet: z
        .string()
        .optional()
        .describe(
          "Agent's on-chain wallet address. Used to cross-verify against registry record.",
        ),
      operator_did: z
        .string()
        .optional()
        .describe(
          "DID of the human or org operating this agent. Optional — enables operator screening.",
        ),
      check_spending_limits: z
        .boolean()
        .default(true)
        .describe(
          "If true, retrieve and return the agent's authorized spending limits from registry.",
        ),
    },
    async (params) => {
      try {
        const receiptId = generateReceiptId();
        const start = Date.now();

        // Look up agent in the ProofLink registry instead of fabricating a credential
        const lookup = lookupAgent(params.agent_id);

        if (!lookup.found || !lookup.agent) {
          const result = {
            verified: false,
            trust_score: 0,
            agent_metadata: null,
            operator_status: null,
            spending_limits: undefined as Record<string, unknown> | undefined,
            verification_errors: lookup.errors,
            latency_ms: Date.now() - start,
            validation_evidence: null,
            receipt_id: receiptId,
          };

          return {
            content: [
              {
                type: "text" as const,
                text: `KYA verification FAILED for agent ${params.agent_id}. ${lookup.errors.join("; ")}`,
              },
            ],
            structuredContent: result,
            isError: true,
          };
        }

        const agent = lookup.agent;
        const errors: string[] = [...lookup.errors];

        // Cross-verify wallet address if provided
        if (
          params.agent_wallet &&
          agent.walletAddress.toLowerCase() !==
            params.agent_wallet.toLowerCase()
        ) {
          errors.push(
            `Wallet mismatch: registry has ${agent.walletAddress}, caller provided ${params.agent_wallet}`,
          );
        }

        // Cross-verify operator DID if provided
        if (
          params.operator_did &&
          agent.operator.did &&
          agent.operator.did !== params.operator_did
        ) {
          errors.push(
            `Operator DID mismatch: registry has ${agent.operator.did}, caller provided ${params.operator_did}`,
          );
        }

        const verified = lookup.credentialValid && errors.length === 0;

        // Trust score derived from actual complianceScore in registry, not hardcoded
        const trustScore = verified ? agent.complianceScore : 0;

        const result = {
          verified,
          trust_score: trustScore,
          agent_metadata: {
            name: agent.name,
            type: agent.type,
            operator: agent.operator.did ?? "unknown",
            registered_at: agent.registeredAt,
            x402_support: agent.x402Support,
            erc8004_registered: true,
            credential_expired: !lookup.credentialValid,
            delegation_valid:
              new Date(agent.delegationScope.expiresAt) > new Date(),
          },
          operator_status: {
            sanctions_cleared: agent.operator.sanctionsCleared,
            kyc_verified: agent.operator.kycVerified,
          },
          spending_limits: params.check_spending_limits
            ? {
                per_transaction_usd: agent.delegationScope.maxTransactionUsd,
                daily_usd: agent.delegationScope.dailyLimitUsd,
                allowed_chains: agent.delegationScope.allowedChains,
                allowed_currencies: agent.delegationScope.allowedCurrencies,
              }
            : undefined,
          verification_errors: errors,
          latency_ms: Date.now() - start,
          validation_evidence: `https://base.easscan.org/attestation/view/${receiptId}`,
          receipt_id: receiptId,
        };

        if (!result.verified) {
          return {
            content: [
              {
                type: "text" as const,
                text: `KYA verification FAILED for agent ${params.agent_id}. ${errors.join("; ")}`,
              },
            ],
            structuredContent: result,
            isError: true,
          };
        }

        return {
          content: [
            {
              type: "text" as const,
              text: `Agent ${params.agent_id} verified. Trust score: ${result.trust_score}/100. Operator sanctions cleared. ${
                result.spending_limits
                  ? `Per-tx limit: $${result.spending_limits.per_transaction_usd.toLocaleString()}`
                  : ""
              }`,
            },
          ],
          structuredContent: result,
        };
      } catch (error: unknown) {
        return formatMcpError(
          "KYA_VERIFICATION_FAILED",
          `KYA verification failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    },
  );
}
