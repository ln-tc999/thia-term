import { randomUUID } from "node:crypto";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { SupportedChain } from "@prooflink/shared";
import { formatMcpError } from "../errors.js";
import { sanctionsScreener } from "../context.js";

const AddressEntry = z.object({
  address: z
    .string()
    .describe("Blockchain wallet address to screen (e.g. 0x... for EVM, base58 for Solana)."),
  chain: SupportedChain.describe("Blockchain network for this address."),
  label: z
    .string()
    .optional()
    .describe("Optional human-readable label for this address (e.g. 'treasury', 'vendor-A')."),
});

const MAX_BATCH_SIZE = 100;

export function registerBatchComplianceCheck(server: McpServer): void {
  server.tool(
    "batch_compliance_check",
    [
      "Screen multiple blockchain addresses against OFAC SDN, EU Consolidated, UN Consolidated, and HMT sanctions lists in a single call.",
      "Returns per-address results with match status and risk scores.",
      "",
      "Example usage:",
      "  batch_compliance_check({",
      '    addresses: [{ address: "0xABC...", chain: "base" }, { address: "0xDEF...", chain: "ethereum" }],',
      "    include_indirect: false",
      "  })",
      "",
      `Max batch size: ${MAX_BATCH_SIZE} addresses per call.`,
      "Use this instead of calling check_sanctions repeatedly when you have multiple addresses to screen.",
    ].join("\n"),
    {
      addresses: z
        .array(AddressEntry)
        .min(1)
        .max(MAX_BATCH_SIZE)
        .describe(`Array of addresses to screen. Max ${MAX_BATCH_SIZE} per call.`),
      include_indirect: z
        .boolean()
        .default(false)
        .describe(
          "If true, screen addresses one hop away (counterparty exposure analysis) for each address.",
        ),
    },
    async (params) => {
      if (params.addresses.length === 0) {
        return formatMcpError("VALIDATION_ERROR", "At least one address is required.");
      }

      if (params.addresses.length > MAX_BATCH_SIZE) {
        return formatMcpError(
          "VALIDATION_ERROR",
          `Batch size exceeds maximum of ${MAX_BATCH_SIZE}. Got ${params.addresses.length}.`,
        );
      }

      try {
        const batchId = `batch_${randomUUID().replace(/-/g, "")}`;
        const screenedAt = new Date().toISOString();
        const listsChecked = [
          "OFAC_SDN",
          "EU_CONSOLIDATED",
          "UN_CONSOLIDATED",
          "HMT",
        ] as const;

        // Screen each address using the real SanctionsScreener from @prooflink/core
        const results = await Promise.all(
          params.addresses.map(async (entry) => {
            const screenResult = await sanctionsScreener.screenAddress(
              entry.address,
              entry.chain,
            );
            return {
              address: entry.address,
              chain: entry.chain,
              label: entry.label ?? null,
              cleared: !screenResult.matched,
              risk_score: screenResult.riskScore,
              matches: screenResult.matchDetails.map((m) => ({
                list: m.list,
                entry_id: m.entryId,
                name: m.name,
                match_confidence: m.matchConfidence,
              })),
            };
          }),
        );

        const blockedCount = results.filter((r) => !r.cleared).length;
        const result = {
          batch_id: batchId,
          total: results.length,
          cleared: results.length - blockedCount,
          blocked: blockedCount,
          lists_checked: [...listsChecked],
          screened_at: screenedAt,
          results,
        };

        return {
          content: [
            {
              type: "text" as const,
              text: `Batch screening complete. ${result.total} addresses screened: ${result.cleared} cleared, ${result.blocked} blocked. Batch ID: ${batchId}`,
            },
          ],
          structuredContent: result,
        };
      } catch (error: unknown) {
        return formatMcpError(
          "SCREENING_FAILED",
          `Batch sanctions screening failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    },
  );
}
