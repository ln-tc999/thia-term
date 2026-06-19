/**
 * In-memory agent registry for the MCP server.
 *
 * Provides a lookup layer so that verify_kya and pay_with_compliance can check
 * whether an agent exists with a valid credential, instead of fabricating a
 * synthetic VerifiableCredential (which was a tautological bypass — PROT-3).
 *
 * In production this would be backed by the API database; for the MCP server
 * standalone mode it uses an in-memory Map populated by register_agent calls
 * and seeded with the same demo data as the registered-agents resource.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RegisteredAgent {
  agentId: string;
  did: string;
  name: string;
  type: "autonomous" | "semi-autonomous" | "human-supervised";
  walletAddress: string;
  operator: {
    name: string;
    did?: string;
    sanctionsCleared: boolean;
    kycVerified: boolean;
  };
  delegationScope: {
    maxTransactionUsd: number;
    dailyLimitUsd: number;
    allowedChains: string[];
    allowedCurrencies: string[];
    expiresAt: string;
  };
  kyaCredentialHash: string | null;
  complianceScore: number;
  x402Support: boolean;
  status: "ACTIVE" | "SUSPENDED" | "REVOKED";
  registeredAt: string;
}

export interface RegistryLookupResult {
  found: boolean;
  agent: RegisteredAgent | null;
  credentialValid: boolean;
  errors: string[];
}

// ---------------------------------------------------------------------------
// Registry singleton
// ---------------------------------------------------------------------------

const registry = new Map<string, RegisteredAgent>();

/** Seed the registry with demo agents (matches registered-agents resource). */
function seedDefaults(): void {
  const now = Date.now();
  const agents: RegisteredAgent[] = [
    {
      agentId: "agent_001",
      did: "did:prooflink:agent_001",
      name: "PaymentBot-v2",
      type: "semi-autonomous",
      walletAddress: "0x742d35Cc6634C0532925a3b844Bc9e7595f2bD68",
      operator: {
        name: "Acme Corp",
        did: "did:web:acme.com",
        sanctionsCleared: true,
        kycVerified: true,
      },
      delegationScope: {
        maxTransactionUsd: 10_000,
        dailyLimitUsd: 50_000,
        allowedChains: ["base", "ethereum"],
        allowedCurrencies: ["USDC"],
        expiresAt: new Date(now + 365 * 86_400_000).toISOString(),
      },
      kyaCredentialHash: "sha256:a1b2c3d4e5f6",
      complianceScore: 87,
      x402Support: true,
      status: "ACTIVE",
      registeredAt: new Date(now - 30 * 86_400_000).toISOString(),
    },
    {
      agentId: "agent_002",
      did: "did:prooflink:agent_002",
      name: "DataPurchaser",
      type: "autonomous",
      walletAddress: "0x1234567890abcdef1234567890abcdef12345678",
      operator: {
        name: "DataCo Inc",
        did: "did:web:dataco.io",
        sanctionsCleared: true,
        kycVerified: true,
      },
      delegationScope: {
        maxTransactionUsd: 5_000,
        dailyLimitUsd: 25_000,
        allowedChains: ["base"],
        allowedCurrencies: ["USDC", "USDT"],
        expiresAt: new Date(now + 365 * 86_400_000).toISOString(),
      },
      kyaCredentialHash: "sha256:f6e5d4c3b2a1",
      complianceScore: 72,
      x402Support: false,
      status: "ACTIVE",
      registeredAt: new Date(now - 14 * 86_400_000).toISOString(),
    },
  ];

  for (const agent of agents) {
    registry.set(agent.agentId, agent);
    registry.set(agent.did, agent);
    registry.set(agent.walletAddress.toLowerCase(), agent);
  }
}

// Seed on module load
seedDefaults();

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Look up an agent by agentId, DID, or wallet address.
 * Validates that the agent has a valid KYA credential and is not expired.
 */
export function lookupAgent(identifier: string): RegistryLookupResult {
  const agent =
    registry.get(identifier) ??
    registry.get(identifier.toLowerCase()) ??
    null;

  if (!agent) {
    return {
      found: false,
      agent: null,
      credentialValid: false,
      errors: [`Agent "${identifier}" not found in registry`],
    };
  }

  const errors: string[] = [];

  // Check credential hash exists
  if (!agent.kyaCredentialHash) {
    errors.push("Agent has no KYA credential hash");
  }

  // Check agent is active
  if (agent.status !== "ACTIVE") {
    errors.push(`Agent status is ${agent.status}, not ACTIVE`);
  }

  // Check delegation scope expiry
  if (new Date(agent.delegationScope.expiresAt) < new Date()) {
    errors.push(
      `Delegation scope expired at ${agent.delegationScope.expiresAt}`,
    );
  }

  return {
    found: true,
    agent,
    credentialValid: errors.length === 0,
    errors,
  };
}

/**
 * Register a new agent (called by register_agent tool).
 */
export function registerAgent(agent: RegisteredAgent): void {
  registry.set(agent.agentId, agent);
  registry.set(agent.did, agent);
  registry.set(agent.walletAddress.toLowerCase(), agent);
}

/**
 * Clear registry (for tests).
 */
export function clearRegistry(): void {
  registry.clear();
}

/**
 * Re-seed default agents (for tests).
 */
export function resetRegistry(): void {
  registry.clear();
  seedDefaults();
}

/**
 * Get all registered agents (for the resource endpoint).
 */
export function getAllAgents(): RegisteredAgent[] {
  const seen = new Set<string>();
  const result: RegisteredAgent[] = [];
  for (const agent of registry.values()) {
    if (!seen.has(agent.agentId)) {
      seen.add(agent.agentId);
      result.push(agent);
    }
  }
  return result;
}
