import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  TRAVEL_RULE_THRESHOLDS,
  RISK_THRESHOLDS,
} from "@prooflink/shared";

/**
 * Resource: prooflink://compliance/policy
 * Exposes the current compliance policy configuration.
 */
export function registerCompliancePolicyResource(server: McpServer): void {
  server.resource(
    "compliance-policy",
    "prooflink://compliance/policy",
    {
      description:
        "Current ProofLink compliance policy — sanctions lists, risk thresholds, Travel Rule config, and fail-open/fail-closed behavior.",
      mimeType: "application/json",
    },
    async () => {
      const policy = {
        sanctions_lists: ["OFAC_SDN", "OFAC_CONS", "EU_CONSOLIDATED", "UN_CONSOLIDATED", "HMT"],
        risk_thresholds: {
          auto_reject: RISK_THRESHOLDS.REJECT,
          escalate_for_review: RISK_THRESHOLDS.ESCALATE,
          on_chain_default: RISK_THRESHOLDS.ON_CHAIN_DEFAULT,
        },
        travel_rule: {
          thresholds_usd: TRAVEL_RULE_THRESHOLDS,
          default_threshold_usd: TRAVEL_RULE_THRESHOLDS.DEFAULT,
          vasp_messaging_providers: ["notabene", "sygna_bridge"],
        },
        fail_open: false,
        allowlist: [] as string[],
        blocklist: [] as string[],
        edd_jurisdictions: ["IR", "KP", "SY", "CU", "RU"],
        last_updated: new Date().toISOString(),
      };

      return {
        contents: [
          {
            uri: "prooflink://compliance/policy",
            mimeType: "application/json",
            text: JSON.stringify(policy, null, 2),
          },
        ],
      };
    },
  );
}
