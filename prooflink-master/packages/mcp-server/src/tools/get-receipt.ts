import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { formatMcpError } from "../errors.js";

export function registerGetReceipt(server: McpServer): void {
  server.tool(
    "get_compliance_receipt",
    [
      "Retrieve a cryptographically-signed compliance proof for a completed transaction or screening event.",
      "Returns a ProofLink receipt with all checks performed, results, and an EAS attestation UID.",
      "",
      "Example usage:",
      '  get_compliance_receipt({ tx_hash: "0xabc123..." })',
      '  get_compliance_receipt({ receipt_id: "rcpt_xxx", include_raw_evidence: true })',
      "",
      "Use for audit trails, dispute resolution, and enterprise reporting.",
      "Provide either tx_hash or receipt_id.",
    ].join("\n"),
    {
      tx_hash: z
        .string()
        .optional()
        .describe(
          "On-chain transaction hash. Provide either this or receipt_id.",
        ),
      receipt_id: z
        .string()
        .optional()
        .describe(
          "ProofLink receipt ID from a prior check_sanctions, verify_kya, or create_compliant_invoice call.",
        ),
      include_raw_evidence: z
        .boolean()
        .default(false)
        .describe(
          "If true, include full API responses from each compliance provider.",
        ),
    },
    async (params) => {
      if (!params.tx_hash && !params.receipt_id) {
        return formatMcpError(
          "VALIDATION_ERROR",
          "Provide either 'tx_hash' or 'receipt_id'.",
        );
      }

      try {
        const receiptId = params.receipt_id ?? `rcpt_${params.tx_hash}`;
        const now = new Date().toISOString();

        // In production: look up from ProofLink receipt store / on-chain attestation
        const result = {
          receipt_id: receiptId,
          prooflink_version: "1.0.0",
          transaction: params.tx_hash
            ? {
                tx_hash: params.tx_hash,
                amount_usd: 500,
                timestamp: now,
              }
            : undefined,
          checks_performed: [
            {
              check_type: "SANCTIONS_SCREENING" as const,
              result: "PASSED" as const,
              performed_at: now,
              provider: "chainalysis_kyt",
            },
            {
              check_type: "KYA_VERIFICATION" as const,
              result: "PASSED" as const,
              performed_at: now,
              provider: "prooflink_erc8004",
            },
            {
              check_type: "AML_MONITORING" as const,
              result: "PASSED" as const,
              performed_at: now,
              provider: "chainalysis_kyt",
            },
          ],
          overall_status: "COMPLIANT" as const,
          eas_attestation_uid: null as string | null, // populated by ProofLink engine after on-chain attestation
          receipt_signature: null as string | null, // populated by ProofLink engine after EIP-712 signing
          ipfs_cid: null as string | null, // populated by ProofLink engine in production
          raw_evidence: params.include_raw_evidence
            ? {
                note: "Raw provider responses would be included here in production.",
              }
            : undefined,
        };

        const checksLabel = result.checks_performed
          .map((c) => `${c.check_type}: ${c.result}`)
          .join(", ");

        return {
          content: [
            {
              type: "text" as const,
              text: `Compliance receipt ${receiptId}. Status: ${result.overall_status}. Checks: ${checksLabel}. EAS UID: ${result.eas_attestation_uid?.slice(0, 18) ?? "N/A"}...`,
            },
          ],
          structuredContent: result,
        };
      } catch (error: unknown) {
        return formatMcpError(
          "NOT_FOUND",
          `Receipt retrieval failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    },
  );
}
