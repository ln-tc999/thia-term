import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

/**
 * Resource: prooflink://compliance/stats
 * Exposes real-time compliance statistics.
 */
export function registerComplianceStatsResource(server: McpServer): void {
  server.resource(
    "compliance-stats",
    "prooflink://compliance/stats",
    {
      description:
        "Real-time compliance statistics — screening volumes, pass rates, Travel Rule submissions, and system health.",
      mimeType: "application/json",
    },
    async () => {
      // In production: aggregated from metrics store
      const stats = {
        period: "last_24h",
        generated_at: new Date().toISOString(),
        sanctions_screening: {
          total: 1_247,
          cleared: 1_241,
          blocked: 6,
          pass_rate: 0.9952,
        },
        kya_verification: {
          total: 389,
          verified: 372,
          failed: 17,
          pass_rate: 0.9563,
        },
        travel_rule: {
          total_submissions: 156,
          transmitted: 148,
          below_threshold: 8,
          vasp_acknowledged: 132,
        },
        payments: {
          total: 834,
          completed: 821,
          blocked: 8,
          pending_review: 5,
          total_volume_usd: 2_450_000,
        },
        system: {
          uptime_seconds: Math.floor(process.uptime()),
          error_rate: 0.0023,
          active_agents: 47,
        },
      };

      return {
        contents: [
          {
            uri: "prooflink://compliance/stats",
            mimeType: "application/json",
            text: JSON.stringify(stats, null, 2),
          },
        ],
      };
    },
  );
}
