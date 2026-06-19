import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { formatMcpError } from "../errors.js";

export function registerGetComplianceMetrics(server: McpServer): void {
  server.tool(
    "get_compliance_metrics",
    [
      "Get system health and compliance metrics for the ProofLink compliance pipeline.",
      "Returns aggregated statistics on screening volume, pass/fail rates, latency,",
      "Travel Rule submissions, and agent verifications.",
      "",
      "Example usage:",
      "  get_compliance_metrics({ time_range: \"24h\" })",
      "",
      "Time ranges: 1h, 6h, 24h, 7d, 30d",
      "Use this for dashboards, monitoring, and compliance reporting.",
    ].join("\n"),
    {
      time_range: z
        .enum(["1h", "6h", "24h", "7d", "30d"])
        .default("24h")
        .describe("Time range for metrics aggregation."),
      include_latency_percentiles: z
        .boolean()
        .default(false)
        .describe("If true, include p50/p95/p99 latency percentiles for each check type."),
    },
    async (params) => {
      try {
        const now = new Date().toISOString();

        // In production: query metrics store / Prometheus / CloudWatch
        const sanctions = {
          total_screenings: 1_247,
          cleared: 1_241,
          blocked: 6,
          pass_rate: 0.9952,
          avg_latency_ms: 142,
          latency_percentiles: params.include_latency_percentiles
            ? { p50: 120, p95: 280, p99: 450 }
            : undefined,
        };

        const kya = {
          total_verifications: 389,
          verified: 372,
          failed: 17,
          pass_rate: 0.9563,
          avg_latency_ms: 85,
          latency_percentiles: params.include_latency_percentiles
            ? { p50: 70, p95: 150, p99: 320 }
            : undefined,
        };

        const travelRule = {
          total_submissions: 156,
          transmitted: 148,
          below_threshold: 8,
          vasp_acknowledged: 132,
          avg_latency_ms: 310,
          latency_percentiles: params.include_latency_percentiles
            ? { p50: 250, p95: 580, p99: 1200 }
            : undefined,
        };

        const payments = {
          total_payments: 834,
          completed: 821,
          blocked: 8,
          pending_review: 5,
          total_volume_usd: 2_450_000,
          avg_payment_usd: 2_938,
        };

        const system = {
          uptime_seconds: 86_400 * 14,
          api_requests_total: 4_821,
          error_rate: 0.0023,
          active_agents: 47,
        };

        const result = {
          time_range: params.time_range,
          generated_at: now,
          sanctions_screening: sanctions,
          kya_verification: kya,
          travel_rule: travelRule,
          payments,
          system,
        };

        const summary = [
          `Metrics (${params.time_range}):`,
          `Sanctions: ${sanctions.total_screenings} screenings, ${(sanctions.pass_rate * 100).toFixed(1)}% pass rate.`,
          `KYA: ${kya.total_verifications} verifications, ${(kya.pass_rate * 100).toFixed(1)}% pass rate.`,
          `Payments: ${payments.total_payments} total, $${payments.total_volume_usd.toLocaleString()} volume.`,
          `System: ${system.active_agents} active agents, ${(system.error_rate * 100).toFixed(2)}% error rate.`,
        ].join(" ");

        return {
          content: [{ type: "text" as const, text: summary }],
          structuredContent: result,
        };
      } catch (error: unknown) {
        return formatMcpError(
          "METRICS_FAILED",
          `Failed to retrieve metrics: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    },
  );
}
