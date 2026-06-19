import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

// Tools
import { registerCheckSanctions } from "./tools/check-sanctions.js";
import { registerVerifyKya } from "./tools/verify-kya.js";
import { registerCreateInvoice } from "./tools/create-invoice.js";
import { registerSubmitTravelRule } from "./tools/submit-travel-rule.js";
import { registerGetReceipt } from "./tools/get-receipt.js";
import { registerPayWithCompliance } from "./tools/pay-with-compliance.js";
import { registerBatchComplianceCheck } from "./tools/batch-check.js";
import { registerGetRiskReport } from "./tools/get-risk-report.js";
import { registerListInvoices } from "./tools/list-invoices.js";
import { registerGetComplianceMetrics } from "./tools/get-metrics.js";
import { registerRegisterAgent } from "./tools/register-agent.js";

// Resources
import { registerCompliancePolicyResource } from "./resources/compliance-policy.js";
import { registerComplianceStatsResource } from "./resources/compliance-stats.js";
import { registerAgentsResource } from "./resources/registered-agents.js";

// Transports
import { createSSETransport, type SSETransportOptions, type SSETransportHandle } from "./transports/sse.js";

export interface ProofLinkMCPHandle {
  server: McpServer;
  start: () => Promise<void>;
  close: () => Promise<void>;
}

export interface ProofLinkMCPOptions {
  /** Use SSE transport instead of stdio. */
  transport?: "stdio" | "sse";
  /** SSE transport options (only used when transport is "sse"). */
  sse?: Partial<SSETransportOptions>;
}

/**
 * Creates and configures the ProofLink MCP compliance server
 * with all tools and resources registered.
 */
export async function createProofLinkMCPServer(
  options: ProofLinkMCPOptions = {},
): Promise<ProofLinkMCPHandle> {
  const server = new McpServer({
    name: "prooflink-compliance",
    version: "1.0.0",
  });

  // ── Register all compliance tools ──────────────────────────────────────
  registerCheckSanctions(server);
  registerVerifyKya(server);
  registerCreateInvoice(server);
  registerSubmitTravelRule(server);
  registerGetReceipt(server);
  registerPayWithCompliance(server);
  registerBatchComplianceCheck(server);
  registerGetRiskReport(server);
  registerListInvoices(server);
  registerGetComplianceMetrics(server);
  registerRegisterAgent(server);

  // ── Register resource endpoints ────────────────────────────────────────
  registerCompliancePolicyResource(server);
  registerComplianceStatsResource(server);
  registerAgentsResource(server);

  // ── Transport selection ────────────────────────────────────────────────
  const transportMode = options.transport ?? "stdio";

  if (transportMode === "sse") {
    const sseHandle: SSETransportHandle = createSSETransport(server, options.sse);
    return {
      server,
      async start() {
        await sseHandle.start();
      },
      async close() {
        await sseHandle.close();
        await server.close();
      },
    };
  }

  // Default: stdio transport
  const transport = new StdioServerTransport();
  return {
    server,
    async start() {
      await server.connect(transport);
      process.stderr.write(
        "[prooflink-mcp] Server started on stdio transport\n",
      );
    },
    async close() {
      await server.close();
    },
  };
}
