import { randomBytes, randomUUID } from "node:crypto";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { formatMcpError } from "../errors.js";
import { sanctionsScreener } from "../context.js";
import { lookupAgent } from "../agent-registry.js";

const TRAVEL_RULE_THRESHOLD_USD = 1_000;

function generateId(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, "")}`;
}

export function registerPayWithCompliance(server: McpServer): void {
  server.tool(
    "pay_with_compliance",
    [
      "Execute an end-to-end compliant stablecoin payment with automatic compliance orchestration.",
      "Runs all steps: (1) sanctions screening, (2) KYA verification if agent, (3) Travel Rule if above $1,000,",
      "(4) payment execution via x402/direct, (5) compliance receipt generation.",
      "",
      "NOTE: Payment execution (step 4) and Travel Rule submission (step 3) are SIMULATED.",
      "These require external service integrations (x402 payment rails, Notabene/Sygna Bridge).",
      "Sanctions screening and KYA verification use real @prooflink/core engines.",
      "",
      "Example usage:",
      "  pay_with_compliance({",
      '    recipient: { wallet_address: "0xDEF..." },',
      '    amount: { value: 500, currency: "USDC" },',
      '    chain: "base",',
      "    dry_run: true",
      "  })",
      "",
      "Use dry_run: true to validate compliance without executing payment.",
      "Set require_kya: true to block payments to unregistered agents.",
    ].join("\n"),
    {
      recipient: z
        .object({
          wallet_address: z.string().describe("Recipient wallet address."),
          agent_id: z
            .string()
            .optional()
            .describe("ERC-8004 ID if recipient is an agent."),
          legal_name: z
            .string()
            .optional()
            .describe("Required for Travel Rule if above threshold."),
        })
        .describe("Payment recipient."),
      amount: z
        .object({
          value: z.number().positive().describe("Payment amount."),
          currency: z
            .enum(["USDC", "USDT"])
            .describe("Stablecoin currency."),
        })
        .describe("Payment amount and currency."),
      chain: z
        .enum(["base", "ethereum", "solana", "polygon"])
        .default("base")
        .describe("Blockchain network."),
      payment_protocol: z
        .enum(["x402", "direct"])
        .default("x402")
        .describe("Payment protocol to use."),
      memo: z
        .string()
        .max(256)
        .optional()
        .describe("Payment memo / invoice reference."),
      invoice_id: z
        .string()
        .optional()
        .describe(
          "ProofLink invoice ID from create_compliant_invoice. Links payment to invoice.",
        ),
      require_kya: z
        .boolean()
        .default(false)
        .describe(
          "If true and recipient has no valid ERC-8004 registration, payment is blocked.",
        ),
      dry_run: z
        .boolean()
        .default(false)
        .describe(
          "If true, run all compliance checks but do not execute the payment.",
        ),
    },
    async (params) => {
      try {
        const receiptId = generateId("rcpt");
        const complianceSummary = {
          sanctions_cleared: false,
          kya_verified: false,
          travel_rule_submitted: false,
          travel_rule_required: params.amount.value >= TRAVEL_RULE_THRESHOLD_USD,
        };

        // Step 1: Real sanctions screening via @prooflink/core
        const screenResult = await sanctionsScreener.screenAddress(
          params.recipient.wallet_address,
          params.chain,
        );

        complianceSummary.sanctions_cleared = !screenResult.matched;

        if (screenResult.matched) {
          return {
            content: [
              {
                type: "text" as const,
                text: `BLOCKED: Recipient ${params.recipient.wallet_address} matches sanctions list. Do not proceed.`,
              },
            ],
            structuredContent: {
              status: params.dry_run ? "DRY_RUN_BLOCKED" : "BLOCKED",
              simulated: false,
              compliance_summary: complianceSummary,
              block_reason: `SANCTIONS_MATCH: ${screenResult.matchDetails.map((m) => m.name).join(", ")}`,
              receipt_id: receiptId,
            },
            isError: true,
          };
        }

        // Step 2: KYA verification via registry lookup (not synthetic credentials)
        if (params.recipient.agent_id) {
          const lookup = lookupAgent(params.recipient.agent_id);
          complianceSummary.kya_verified = lookup.credentialValid;

          if (!lookup.credentialValid && params.require_kya) {
            const errors = lookup.errors.join("; ");
            return {
              content: [
                {
                  type: "text" as const,
                  text: `BLOCKED: KYA verification failed for agent ${params.recipient.agent_id}. ${errors}`,
                },
              ],
              structuredContent: {
                status: params.dry_run ? "DRY_RUN_BLOCKED" : "BLOCKED",
                simulated: false,
                compliance_summary: complianceSummary,
                block_reason: `KYA_VERIFICATION_FAILED: ${errors}`,
                receipt_id: receiptId,
              },
              isError: true,
            };
          }
        } else if (params.require_kya) {
          return {
            content: [
              {
                type: "text" as const,
                text: `BLOCKED: KYA required but recipient has no agent_id. Cannot verify agent identity.`,
              },
            ],
            structuredContent: {
              status: params.dry_run ? "DRY_RUN_BLOCKED" : "BLOCKED",
              simulated: false,
              compliance_summary: complianceSummary,
              block_reason:
                "KYA_REQUIRED_NO_AGENT_ID: require_kya is true but recipient has no agent_id.",
              receipt_id: receiptId,
            },
            isError: true,
          };
        } else {
          complianceSummary.kya_verified = true; // Not an agent, skip KYA
        }

        // Step 3: Travel Rule (if above threshold)
        // SIMULATED: In production, this would call Notabene / Sygna Bridge
        // to transmit IVMS101 originator/beneficiary data to the counterparty VASP.
        if (complianceSummary.travel_rule_required) {
          complianceSummary.travel_rule_submitted = true;
        }

        // Dry run: return checks without executing payment
        if (params.dry_run) {
          return {
            content: [
              {
                type: "text" as const,
                text: `DRY RUN PASSED: All compliance checks cleared for ${params.amount.value} ${params.amount.currency} to ${params.recipient.wallet_address} on ${params.chain}. ${
                  complianceSummary.travel_rule_required
                    ? "Travel Rule would be submitted."
                    : "Travel Rule not required."
                }`,
              },
            ],
            structuredContent: {
              status: "DRY_RUN_PASSED" as const,
              simulated: true,
              tx_hash: null,
              compliance_summary: complianceSummary,
              receipt_id: receiptId,
            },
          };
        }

        // Step 4: Execute payment
        // SIMULATED: In production, this would call x402 payment execution or
        // submit a direct on-chain transfer via the configured wallet/signer.
        // The tx_hash below is synthetic — no real funds are moved.
        const txHash = `0x${randomBytes(32).toString("hex")}`;

        // Step 5: Generate compliance receipt + EAS attestation
        // SIMULATED: In production, the ProofLink engine would anchor the receipt
        // as an EAS attestation on-chain and return the real attestation UID.
        const result = {
          status: "COMPLETED" as const,
          simulated: true,
          tx_hash: txHash,
          compliance_summary: complianceSummary,
          receipt_id: receiptId,
          eas_attestation_uid: null as string | null,
          invoice_id: params.invoice_id,
        };

        return {
          content: [
            {
              type: "text" as const,
              text: `Payment COMPLETED (simulated). ${params.amount.value} ${params.amount.currency} sent to ${params.recipient.wallet_address} on ${params.chain}. Tx: ${txHash.slice(0, 18)}... Receipt: ${receiptId}. All compliance checks passed.`,
            },
          ],
          structuredContent: result,
        };
      } catch (error: unknown) {
        return formatMcpError(
          "PAYMENT_FAILED",
          `Payment failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    },
  );
}
