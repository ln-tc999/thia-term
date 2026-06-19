#!/usr/bin/env node

/**
 * ProofLink MCP Compliance Server — entry point.
 *
 * Supports two transport modes:
 *   stdio (default): PROOFLINK_API_KEY=fl_live_xxx npx @prooflink/mcp-server
 *   SSE:             PROOFLINK_TRANSPORT=sse npx @prooflink/mcp-server
 */

export { createProofLinkMCPServer } from "./server.js";
export type { ProofLinkMCPHandle, ProofLinkMCPOptions } from "./server.js";
export type { SSETransportOptions, SSETransportHandle } from "./transports/sse.js";
export { createSSETransport } from "./transports/sse.js";
export { formatMcpError, formatUnknownError } from "./errors.js";
export type { ProofLinkMcpErrorCode, McpErrorResponse } from "./errors.js";

import { createProofLinkMCPServer } from "./server.js";

async function main(): Promise<void> {
  const transport = process.env["PROOFLINK_TRANSPORT"] === "sse" ? "sse" : "stdio";
  const port = process.env["PROOFLINK_SSE_PORT"]
    ? parseInt(process.env["PROOFLINK_SSE_PORT"], 10)
    : 3001;

  const handle = await createProofLinkMCPServer({
    transport,
    sse: { port },
  });
  await handle.start();
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`[prooflink-mcp] Fatal: ${message}\n`);
  process.exit(1);
});
