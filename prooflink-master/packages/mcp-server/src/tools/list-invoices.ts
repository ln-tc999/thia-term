import { randomUUID } from "node:crypto";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { InvoiceState, InvoiceCurrency } from "@prooflink/shared";
import { formatMcpError } from "../errors.js";

const MAX_PAGE_SIZE = 100;

export function registerListInvoices(server: McpServer): void {
  server.tool(
    "list_invoices",
    [
      "List invoices with filtering by status, party, date range, and currency.",
      "Returns paginated results sorted by creation date (newest first).",
      "",
      "Example usage:",
      "  list_invoices({",
      '    status: "ISSUED",',
      '    seller_wallet: "0xABC...",',
      "    limit: 20,",
      "    offset: 0",
      "  })",
      "",
      "Filters:",
      "  - status: DRAFT, ISSUED, PAID, SETTLED, DISPUTED, CANCELLED",
      "  - seller_wallet / buyer_wallet: filter by party wallet address",
      "  - currency: USDC, USDT, USD, EUR, GBP, EURC",
      "  - date_from / date_to: ISO 8601 date range",
      "  - min_amount / max_amount: USD amount range",
    ].join("\n"),
    {
      status: InvoiceState.optional().describe(
        "Filter by invoice status.",
      ),
      seller_wallet: z
        .string()
        .optional()
        .describe("Filter by seller wallet address."),
      buyer_wallet: z
        .string()
        .optional()
        .describe("Filter by buyer wallet address."),
      currency: InvoiceCurrency.optional().describe("Filter by invoice currency."),
      date_from: z
        .string()
        .datetime({ offset: true })
        .optional()
        .describe("Start of date range (ISO 8601)."),
      date_to: z
        .string()
        .datetime({ offset: true })
        .optional()
        .describe("End of date range (ISO 8601)."),
      min_amount: z
        .number()
        .nonnegative()
        .optional()
        .describe("Minimum total amount (USD)."),
      max_amount: z
        .number()
        .nonnegative()
        .optional()
        .describe("Maximum total amount (USD)."),
      limit: z
        .number()
        .int()
        .min(1)
        .max(MAX_PAGE_SIZE)
        .default(20)
        .describe(`Number of invoices per page (1-${MAX_PAGE_SIZE}).`),
      offset: z
        .number()
        .int()
        .min(0)
        .default(0)
        .describe("Pagination offset."),
    },
    async (params) => {
      try {
        // In production: query invoice store with filters
        const now = new Date();
        const sampleInvoices = Array.from({ length: Math.min(params.limit, 3) }, (_, i) => ({
          invoice_id: `inv_${randomUUID().replace(/-/g, "")}`,
          state: params.status ?? "ISSUED",
          seller: {
            wallet_address: params.seller_wallet ?? "0x742d35Cc6634C0532925a3b844Bc9e7595f2bD68",
          },
          buyer: {
            wallet_address: params.buyer_wallet ?? "0x1234567890abcdef1234567890abcdef12345678",
          },
          total_amount: 500 + i * 250,
          currency: params.currency ?? "USDC",
          created_at: new Date(now.getTime() - i * 86_400_000).toISOString(),
          compliance_stamp: {
            seller_cleared: true,
            buyer_cleared: true,
            travel_rule_required: (500 + i * 250) >= 1_000,
          },
        }));

        const result = {
          invoices: sampleInvoices,
          total: sampleInvoices.length,
          limit: params.limit,
          offset: params.offset,
          has_more: false,
          filters_applied: {
            status: params.status ?? null,
            seller_wallet: params.seller_wallet ?? null,
            buyer_wallet: params.buyer_wallet ?? null,
            currency: params.currency ?? null,
            date_from: params.date_from ?? null,
            date_to: params.date_to ?? null,
            min_amount: params.min_amount ?? null,
            max_amount: params.max_amount ?? null,
          },
        };

        return {
          content: [
            {
              type: "text" as const,
              text: `Found ${result.total} invoices (offset: ${params.offset}, limit: ${params.limit}). ${result.has_more ? "More results available." : "No more results."}`,
            },
          ],
          structuredContent: result,
        };
      } catch (error: unknown) {
        return formatMcpError(
          "INVOICE_LIST_FAILED",
          `Failed to list invoices: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    },
  );
}
