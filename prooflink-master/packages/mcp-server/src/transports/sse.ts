import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";

export interface SSETransportOptions {
  /** Port to listen on. Defaults to 3001. */
  port: number;
  /** Hostname to bind. Defaults to "0.0.0.0". */
  hostname: string;
  /** Heartbeat interval in ms. Defaults to 30_000 (30s). */
  heartbeatIntervalMs: number;
  /** Base path for the SSE endpoint. Defaults to "/sse". */
  basePath: string;
  /** Base path for the message endpoint. Defaults to "/message". */
  messagePath: string;
}

const DEFAULT_OPTIONS: SSETransportOptions = {
  port: 3001,
  hostname: "0.0.0.0",
  heartbeatIntervalMs: 30_000,
  basePath: "/sse",
  messagePath: "/message",
};

export interface SSETransportHandle {
  /** Start listening. */
  start: () => Promise<void>;
  /** Gracefully shut down all connections and the HTTP server. */
  close: () => Promise<void>;
  /** The port the server is actually listening on. */
  port: number;
}

/**
 * Create an SSE (Server-Sent Events) transport for the ProofLink MCP server.
 * Enables browser/HTTP clients to connect without stdio.
 *
 * Architecture:
 *   GET  /sse      — opens the SSE stream (one per client)
 *   POST /message  — sends JSON-RPC messages to the server
 */
export function createSSETransport(
  server: McpServer,
  userOptions: Partial<SSETransportOptions> = {},
): SSETransportHandle {
  const opts: SSETransportOptions = { ...DEFAULT_OPTIONS, ...userOptions };

  const connections = new Map<string, {
    transport: SSEServerTransport;
    heartbeatTimer: ReturnType<typeof setInterval> | null;
  }>();

  const httpServer = createServer(
    async (req: IncomingMessage, res: ServerResponse) => {
      // CORS headers for browser clients
      const corsOrigin = process.env["CORS_ORIGIN"] ?? (
        process.env["NODE_ENV"] === "production" ? "" : "*"
      );
      res.setHeader("Access-Control-Allow-Origin", corsOrigin);
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

      if (req.method === "OPTIONS") {
        res.writeHead(204);
        res.end();
        return;
      }

      const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

      // GET /sse — establish SSE connection
      if (req.method === "GET" && url.pathname === opts.basePath) {
        const transport = new SSEServerTransport(opts.messagePath, res);
        const connectionId = crypto.randomUUID();

        // Heartbeat keep-alive
        const heartbeatTimer = setInterval(() => {
          try {
            res.write(": heartbeat\n\n");
          } catch {
            // Connection closed — cleanup happens in close handler
          }
        }, opts.heartbeatIntervalMs);

        connections.set(connectionId, { transport, heartbeatTimer });

        res.on("close", () => {
          const conn = connections.get(connectionId);
          if (conn?.heartbeatTimer) {
            clearInterval(conn.heartbeatTimer);
          }
          connections.delete(connectionId);
        });

        await server.connect(transport);
        return;
      }

      // POST /message — handle JSON-RPC messages
      if (req.method === "POST" && url.pathname === opts.messagePath) {
        // The SDK's SSEServerTransport.handlePostMessage routes by sessionId
        // Find the first active connection to handle the message
        const firstConn = connections.values().next().value;
        if (!firstConn) {
          res.writeHead(404, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "No active SSE connection" }));
          return;
        }

        await firstConn.transport.handlePostMessage(req, res);
        return;
      }

      // Health check
      if (req.method === "GET" && url.pathname === "/health") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            status: "ok",
            connections: connections.size,
            uptime: process.uptime(),
          }),
        );
        return;
      }

      // 404 for everything else
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Not found" }));
    },
  );

  return {
    port: opts.port,
    async start() {
      return new Promise<void>((resolve, reject) => {
        httpServer.on("error", reject);
        httpServer.listen(opts.port, opts.hostname, () => {
          process.stderr.write(
            `[prooflink-mcp] SSE transport listening on http://${opts.hostname}:${opts.port}${opts.basePath}\n`,
          );
          resolve();
        });
      });
    },
    async close() {
      // Clear all heartbeat timers
      for (const conn of connections.values()) {
        if (conn.heartbeatTimer) {
          clearInterval(conn.heartbeatTimer);
        }
      }
      connections.clear();

      return new Promise<void>((resolve, reject) => {
        httpServer.close((err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    },
  };
}
