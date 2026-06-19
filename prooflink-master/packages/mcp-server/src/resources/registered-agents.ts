import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

/**
 * Resource: prooflink://agents/registered
 * Exposes the list of registered agents.
 */
export function registerAgentsResource(server: McpServer): void {
  server.resource(
    "registered-agents",
    "prooflink://agents/registered",
    {
      description:
        "List of all registered AI agents in the ProofLink agent registry — IDs, operator info, delegation scopes, and reputation scores.",
      mimeType: "application/json",
    },
    async () => {
      // In production: query from ERC-8004 registry / ProofLink agent store
      const agents = [
        {
          agent_id: "agent_001",
          did: "did:prooflink:agent_001",
          name: "PaymentBot-v2",
          type: "semi-autonomous",
          wallet_address: "0x742d35Cc6634C0532925a3b844Bc9e7595f2bD68",
          operator: {
            name: "Acme Corp",
            did: "did:web:acme.com",
            sanctions_cleared: true,
            kyc_verified: true,
          },
          delegation_scope: {
            max_transaction_usd: 10_000,
            daily_limit_usd: 50_000,
            allowed_chains: ["base", "ethereum"],
            allowed_currencies: ["USDC"],
          },
          reputation_score: 87,
          x402_support: true,
          status: "ACTIVE",
          registered_at: new Date(Date.now() - 30 * 86_400_000).toISOString(),
        },
        {
          agent_id: "agent_002",
          did: "did:prooflink:agent_002",
          name: "DataPurchaser",
          type: "autonomous",
          wallet_address: "0x1234567890abcdef1234567890abcdef12345678",
          operator: {
            name: "DataCo Inc",
            did: "did:web:dataco.io",
            sanctions_cleared: true,
            kyc_verified: true,
          },
          delegation_scope: {
            max_transaction_usd: 5_000,
            daily_limit_usd: 25_000,
            allowed_chains: ["base"],
            allowed_currencies: ["USDC", "USDT"],
          },
          reputation_score: 72,
          x402_support: false,
          status: "ACTIVE",
          registered_at: new Date(Date.now() - 14 * 86_400_000).toISOString(),
        },
      ];

      const result = {
        total: agents.length,
        agents,
        generated_at: new Date().toISOString(),
      };

      return {
        contents: [
          {
            uri: "prooflink://agents/registered",
            mimeType: "application/json",
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    },
  );
}
