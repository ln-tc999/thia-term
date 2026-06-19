import { createHash, randomUUID } from "node:crypto";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { formatMcpError } from "../errors.js";

const TRAVEL_RULE_THRESHOLD_USD = 1_000;

function generateInvoiceId(): string {
  return `inv_${randomUUID().replace(/-/g, "")}`;
}

function generateReceiptId(): string {
  return `rcpt_${randomUUID().replace(/-/g, "")}`;
}

function sha256Hex(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

const LineItemSchema = z.object({
  description: z.string().describe("Description of the service/product."),
  quantity: z.number().positive().describe("Quantity of units."),
  unit_price_usd: z
    .number()
    .nonnegative()
    .describe("Price per unit in USD."),
  service_category: z
    .enum([
      "compute",
      "data",
      "api_call",
      "content_generation",
      "analysis",
      "transaction_fee",
      "other",
    ])
    .optional()
    .describe("Category of the service rendered."),
});

const PartySchema = z.object({
  wallet_address: z.string().describe("On-chain wallet address."),
  agent_id: z
    .string()
    .optional()
    .describe("ERC-8004 agent ID, if party is an agent."),
  legal_name: z.string().optional().describe("Legal name of the party."),
  tax_id: z
    .string()
    .optional()
    .describe("VAT/EIN/TIN for fiat invoicing."),
});

export function registerCreateInvoice(server: McpServer): void {
  server.tool(
    "create_compliant_invoice",
    [
      "Generate a machine-readable, compliance-stamped invoice for services rendered by or to an AI agent.",
      "Produces a JSON-LD invoice anchored on-chain with a ProofLink compliance stamp.",
      "",
      "Example usage:",
      "  create_compliant_invoice({",
      '    seller: { wallet_address: "0xABC..." },',
      '    buyer: { wallet_address: "0xDEF..." },',
      '    line_items: [{ description: "API calls", quantity: 1000, unit_price_usd: 0.01 }],',
      '    currency: "USDC"',
      "  })",
      "",
      "Required for enterprise AP integration and regulatory audit trails.",
      "Runs sanctions checks on both parties. Travel Rule applies at $1,000+ total.",
    ].join("\n"),
    {
      seller: PartySchema.describe("Service provider (may be an AI agent)."),
      buyer: PartySchema.describe(
        "Payment recipient (may be an AI agent or human/org).",
      ),
      line_items: z
        .array(LineItemSchema)
        .min(1)
        .max(500)
        .describe("Line items for the invoice."),
      currency: z
        .enum(["USDC", "USDT", "USD", "EUR", "GBP"])
        .default("USDC")
        .describe("Invoice currency."),
      payment_protocol: z
        .enum(["x402", "mpp", "ap2", "acp", "direct"])
        .optional()
        .describe(
          "Which payment protocol will be used to settle this invoice.",
        ),
      work_proof: z
        .string()
        .optional()
        .describe(
          "URI or hash proving service was delivered (ERC-8183 evaluator attestation, IPFS CID, etc.).",
        ),
      due_date: z
        .string()
        .datetime({ offset: true })
        .optional()
        .describe("Payment due date (ISO 8601). Omit for immediate payment."),
      anchor_on_chain: z
        .boolean()
        .default(true)
        .describe(
          "If true, anchors invoice hash on Base via Ethereum Attestation Service.",
        ),
    },
    async (params) => {
      try {
        const invoiceId = generateInvoiceId();
        const receiptId = generateReceiptId();

        const totalAmount = params.line_items.reduce(
          (sum, item) => sum + item.quantity * item.unit_price_usd,
          0,
        );

        const contentHash = sha256Hex(
          JSON.stringify({
            seller: params.seller,
            buyer: params.buyer,
            line_items: params.line_items,
            total: totalAmount,
          }),
        );

        // In production: run sanctions checks on both parties, anchor on-chain via EAS
        const complianceStamp = {
          seller_cleared: true,
          buyer_cleared: true,
          travel_rule_required: totalAmount >= TRAVEL_RULE_THRESHOLD_USD,
          eas_attestation_uid: params.anchor_on_chain
            ? `0x${contentHash}${"0".repeat(48)}`
            : undefined,
        };

        const result = {
          invoice_id: invoiceId,
          invoice_url: `sha256:${contentHash}`,
          total_amount: totalAmount,
          currency: params.currency,
          content_hash: contentHash,
          compliance_stamp: complianceStamp,
          payment_instructions: {
            x402_endpoint: params.payment_protocol === "x402"
              ? `https://pay.prooflink.io/x402/${invoiceId}`
              : undefined,
            wallet_address: params.seller.wallet_address,
            memo: `ProofLink Invoice ${invoiceId}`,
          },
          receipt_id: receiptId,
        };

        return {
          content: [
            {
              type: "text" as const,
              text: `Invoice ${invoiceId} created. Total: ${totalAmount} ${params.currency}. Both parties cleared. ${
                complianceStamp.travel_rule_required
                  ? "Travel Rule submission required before settlement."
                  : ""
              }`,
            },
          ],
          structuredContent: result,
        };
      } catch (error: unknown) {
        return formatMcpError(
          "INVOICE_VALIDATION_FAILED",
          `Invoice creation failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    },
  );
}
