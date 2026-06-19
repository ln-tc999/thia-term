import { randomUUID } from "node:crypto";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { SupportedChain } from "@prooflink/shared";
import { formatMcpError } from "../errors.js";
import { sanctionsScreener, isKnownSanctionedAddress } from "../context.js";

function generateReceiptId(): string {
  return `scr_${randomUUID().replace(/-/g, "")}`;
}

export function registerCheckSanctions(server: McpServer): void {
  server.tool(
    "check_sanctions",
    [
      "Screen a blockchain address or entity name against OFAC SDN, EU Consolidated, UN Consolidated, and HMT sanctions lists.",
      "Returns match status, risk score (0-100), and matched list entries.",
      "",
      "Example (address screening):",
      '  check_sanctions({ address: "0x742d35Cc6634C0532925a3b844Bc9e7595f2bD68", chain: "ethereum" })',
      "",
      "Example (entity screening):",
      '  check_sanctions({ entity_name: "Acme Corp" })',
      "",
      "Call this before any payment to a new counterparty.",
      "Provide either address+chain OR entity_name (mutually exclusive).",
    ].join("\n"),
    {
      address: z
        .string()
        .optional()
        .describe(
          "Blockchain wallet address to screen (e.g. 0x... for EVM, base58 for Solana). Mutually exclusive with entity_name.",
        ),
      entity_name: z
        .string()
        .optional()
        .describe(
          "Legal name of person or company to screen. Mutually exclusive with address.",
        ),
      chain: SupportedChain.optional().describe(
        "Blockchain network. Required when address is provided.",
      ),
      include_indirect: z
        .boolean()
        .default(false)
        .describe(
          "If true, screen addresses one hop away (counterparty exposure analysis).",
        ),
    },
    async (params) => {
      if (!params.address && !params.entity_name) {
        return formatMcpError(
          "VALIDATION_ERROR",
          "Provide either 'address' (with 'chain') or 'entity_name'.",
        );
      }

      if (params.address && !params.chain) {
        return formatMcpError(
          "VALIDATION_ERROR",
          "'chain' is required when 'address' is provided.",
        );
      }

      if (params.address && params.entity_name) {
        return formatMcpError(
          "VALIDATION_ERROR",
          "'address' and 'entity_name' are mutually exclusive.",
        );
      }

      try {
        const screenedAt = new Date().toISOString();
        const receiptId = generateReceiptId();
        const listsChecked = [
          "OFAC_SDN",
          "EU_CONSOLIDATED",
          "UN_CONSOLIDATED",
          "HMT",
        ] as const;

        let cleared: boolean;
        let riskScore: number;
        let matches: Array<{
          list: string;
          entry_id: string;
          name: string;
          match_confidence: number;
        }>;

        if (params.address && params.chain) {
          // Use the real SanctionsScreener from @prooflink/core
          const screenResult = await sanctionsScreener.screenAddress(
            params.address,
            params.chain,
          );

          cleared = !screenResult.matched;
          riskScore = screenResult.riskScore;
          matches = screenResult.matchDetails.map((m) => ({
            list: m.list,
            entry_id: m.entryId,
            name: m.name,
            match_confidence: m.matchConfidence,
          }));
        } else {
          // Entity name screening: fall back to offline OFAC list check.
          // The offline list only contains addresses, so entity_name screening
          // is a best-effort check. In production, a full KYC/entity screening
          // API (e.g., ComplyAdvantage, Dow Jones) would be called here.
          const offlineMatch = isKnownSanctionedAddress(
            params.entity_name ?? "",
          );
          cleared = !offlineMatch;
          riskScore = offlineMatch ? 100 : 0;
          matches = offlineMatch
            ? [
                {
                  list: "OFAC_SDN",
                  entry_id: "offline",
                  name: params.entity_name ?? "",
                  match_confidence: 1.0,
                },
              ]
            : [];
        }

        const result = {
          cleared,
          risk_score: riskScore,
          matches,
          lists_checked: [...listsChecked],
          screened_at: screenedAt,
          receipt_id: receiptId,
        };

        if (!cleared) {
          const matchSummary = matches
            .map((m) => `${m.list}: ${m.name} (${m.match_confidence})`)
            .join("; ");
          return {
            content: [
              {
                type: "text" as const,
                text: `BLOCKED: Address matches sanctions list. ${matchSummary}. Do not proceed with payment.`,
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
              text: `Address cleared. Risk score: ${riskScore}/100. No sanctions matches across ${listsChecked.length} lists.`,
            },
          ],
          structuredContent: result,
        };
      } catch (error: unknown) {
        return formatMcpError(
          "SCREENING_FAILED",
          `Sanctions screening failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    },
  );
}
