/**
 * Sprint 2: KYA registry lookup tests.
 *
 * Verifies that verify_kya and pay_with_compliance no longer build synthetic
 * VerifiableCredentials (PROT-3 bypass). All KYA checks now go through the
 * in-memory agent registry (agent-registry.ts).
 */

import { describe, it, expect, beforeEach } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import {
  clearRegistry,
  resetRegistry,
  registerAgent,
  type RegisteredAgent,
} from "../agent-registry.js";
import { createProofLinkMCPServer } from "../server.js";
import type { ProofLinkMCPHandle } from "../server.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type TextContent = { type: string; text: string };

function getText(result: { content: unknown }): string {
  const contents = result.content as TextContent[];
  return contents.map((c) => c.text).join("\n");
}

function getStructured(result: { structuredContent?: unknown }): Record<string, unknown> {
  return (result.structuredContent ?? {}) as Record<string, unknown>;
}

/** A fully valid registered agent for use in tests. */
function makeRegisteredAgent(overrides: Partial<RegisteredAgent> = {}): RegisteredAgent {
  const now = Date.now();
  return {
    agentId: "agent_sprint2_test",
    did: "did:prooflink:agent_sprint2_test",
    name: "Sprint2TestBot",
    type: "semi-autonomous",
    walletAddress: "0xSprint2TestWallet001",
    operator: {
      name: "TestCorp",
      did: "did:web:testcorp.example",
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
    kyaCredentialHash: "sha256:sprint2testcred",
    complianceScore: 90,
    x402Support: true,
    status: "ACTIVE",
    registeredAt: new Date(now - 7 * 86_400_000).toISOString(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("Sprint 2: verify_kya — no synthetic credentials", () => {
  let handle: ProofLinkMCPHandle;
  let client: Client;

  beforeEach(async () => {
    // Fresh server + registry for each test
    resetRegistry();
    handle = await createProofLinkMCPServer();
    client = new Client({ name: "sprint2-kya-test", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await handle.server.connect(serverTransport);
    await client.connect(clientTransport);
  });

  it("returns isError:true with trust_score 0 for an agent NOT in the registry", async () => {
    clearRegistry(); // empty registry — no agents

    const result = await client.callTool({
      name: "verify_kya",
      arguments: { agent_id: "nonexistent_agent_xyz" },
    });

    expect(result.isError).toBe(true);
    const data = getStructured(result);
    expect(data.verified).toBe(false);
    // trust_score must be 0 for unknown agents (not a hardcoded synthetic 87)
    expect(data.trust_score).toBe(0);
  });

  it("verification_errors contains 'not found in registry' for an unknown agent", async () => {
    clearRegistry();

    const result = await client.callTool({
      name: "verify_kya",
      arguments: { agent_id: "ghost_agent" },
    });

    const data = getStructured(result);
    const errors = data.verification_errors as string[];
    expect(errors.some((e) => e.toLowerCase().includes("not found"))).toBe(true);
  });

  it("returns verified:true for a registered ACTIVE agent with valid credential", async () => {
    const agent = makeRegisteredAgent();
    registerAgent(agent);

    const result = await client.callTool({
      name: "verify_kya",
      arguments: { agent_id: agent.agentId },
    });

    expect(result.isError).toBeFalsy();
    const data = getStructured(result);
    expect(data.verified).toBe(true);
    // Trust score comes from real complianceScore (90), not a hardcoded 87
    expect(data.trust_score).toBe(agent.complianceScore);
  });

  it("returns verified:false for a SUSPENDED agent (registry-driven, not synthetic)", async () => {
    const agent = makeRegisteredAgent({ status: "SUSPENDED", agentId: "agent_suspended_001" });
    registerAgent(agent);

    const result = await client.callTool({
      name: "verify_kya",
      arguments: { agent_id: "agent_suspended_001" },
    });

    expect(result.isError).toBe(true);
    const data = getStructured(result);
    expect(data.verified).toBe(false);
    const errors = data.verification_errors as string[];
    expect(errors.some((e) => e.includes("SUSPENDED"))).toBe(true);
  });

  it("returns verified:false for an agent with expired delegation scope", async () => {
    const agent = makeRegisteredAgent({
      agentId: "agent_expired_scope",
      delegationScope: {
        maxTransactionUsd: 1_000,
        dailyLimitUsd: 5_000,
        allowedChains: ["base"],
        allowedCurrencies: ["USDC"],
        expiresAt: new Date(Date.now() - 86_400_000).toISOString(), // yesterday
      },
    });
    registerAgent(agent);

    const result = await client.callTool({
      name: "verify_kya",
      arguments: { agent_id: "agent_expired_scope" },
    });

    expect(result.isError).toBe(true);
    const data = getStructured(result);
    expect(data.verified).toBe(false);
    const errors = data.verification_errors as string[];
    expect(errors.some((e) => e.toLowerCase().includes("expired"))).toBe(true);
  });

  it("spending_limits reflect real registry data, not hardcoded defaults", async () => {
    const agent = makeRegisteredAgent({
      delegationScope: {
        maxTransactionUsd: 7_500,
        dailyLimitUsd: 30_000,
        allowedChains: ["polygon"],
        allowedCurrencies: ["USDT"],
        expiresAt: new Date(Date.now() + 365 * 86_400_000).toISOString(),
      },
    });
    registerAgent(agent);

    const result = await client.callTool({
      name: "verify_kya",
      arguments: { agent_id: agent.agentId, check_spending_limits: true },
    });

    expect(result.isError).toBeFalsy();
    const data = getStructured(result);
    const limits = data.spending_limits as Record<string, unknown>;
    expect(limits.per_transaction_usd).toBe(7_500);
    expect(limits.daily_usd).toBe(30_000);
    expect(limits.allowed_chains).toEqual(["polygon"]);
    expect(limits.allowed_currencies).toEqual(["USDT"]);
  });

  it("verifies agent by wallet address (not just agentId)", async () => {
    const agent = makeRegisteredAgent({ walletAddress: "0xWalletLookupTest123" });
    registerAgent(agent);

    const result = await client.callTool({
      name: "verify_kya",
      // Look up by wallet address instead of agentId
      arguments: { agent_id: "0xWalletLookupTest123" },
    });

    expect(result.isError).toBeFalsy();
    const data = getStructured(result);
    expect(data.verified).toBe(true);
  });

  it("detects wallet address mismatch when agent_wallet is provided", async () => {
    const agent = makeRegisteredAgent({ walletAddress: "0xCorrectWallet" });
    registerAgent(agent);

    const result = await client.callTool({
      name: "verify_kya",
      arguments: {
        agent_id: agent.agentId,
        agent_wallet: "0xWrongWallet",
      },
    });

    // Wallet mismatch should fail verification
    expect(result.isError).toBe(true);
    const data = getStructured(result);
    expect(data.verified).toBe(false);
    const errors = data.verification_errors as string[];
    expect(errors.some((e) => e.toLowerCase().includes("mismatch"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Sprint 2: pay_with_compliance — KYA uses registry, not kyaVerifier
// ---------------------------------------------------------------------------

describe("Sprint 2: pay_with_compliance — KYA via registry (no synthetic VC)", () => {
  let handle: ProofLinkMCPHandle;
  let client: Client;

  beforeEach(async () => {
    resetRegistry();
    handle = await createProofLinkMCPServer();
    client = new Client({ name: "sprint2-pay-test", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await handle.server.connect(serverTransport);
    await client.connect(clientTransport);
  });

  it("blocks payment when require_kya:true and recipient agent is not in registry", async () => {
    clearRegistry();

    const result = await client.callTool({
      name: "pay_with_compliance",
      arguments: {
        recipient: {
          wallet_address: "0xUnknownAgent",
          agent_id: "unregistered_agent_abc",
        },
        amount: { value: 500, currency: "USDC" },
        chain: "base",
        require_kya: true,
        dry_run: true,
      },
    });

    expect(result.isError).toBe(true);
    const data = getStructured(result);
    expect(data.status).toBe("DRY_RUN_BLOCKED");
    expect((data.block_reason as string)).toContain("KYA_VERIFICATION_FAILED");
  });

  it("allows payment when require_kya:false even if agent is not in registry", async () => {
    clearRegistry();

    const result = await client.callTool({
      name: "pay_with_compliance",
      arguments: {
        recipient: {
          wallet_address: "0xUnknownAgent",
          agent_id: "unregistered_agent_abc",
        },
        amount: { value: 100, currency: "USDC" },
        chain: "base",
        require_kya: false,
        dry_run: true,
      },
    });

    expect(result.isError).toBeFalsy();
    const data = getStructured(result);
    expect(data.status).toBe("DRY_RUN_PASSED");
  });

  it("marks kya_verified:true for a registered ACTIVE agent", async () => {
    const agent = makeRegisteredAgent({ agentId: "agent_kya_pass" });
    registerAgent(agent);

    const result = await client.callTool({
      name: "pay_with_compliance",
      arguments: {
        recipient: {
          wallet_address: agent.walletAddress,
          agent_id: "agent_kya_pass",
        },
        amount: { value: 100, currency: "USDC" },
        chain: "base",
        dry_run: true,
      },
    });

    expect(result.isError).toBeFalsy();
    const data = getStructured(result);
    const summary = data.compliance_summary as Record<string, unknown>;
    expect(summary.kya_verified).toBe(true);
  });

  it("marks kya_verified:false for a REVOKED agent when require_kya:false", async () => {
    const agent = makeRegisteredAgent({
      agentId: "agent_revoked_001",
      status: "REVOKED",
    });
    registerAgent(agent);

    const result = await client.callTool({
      name: "pay_with_compliance",
      arguments: {
        recipient: {
          wallet_address: agent.walletAddress,
          agent_id: "agent_revoked_001",
        },
        amount: { value: 100, currency: "USDC" },
        chain: "base",
        require_kya: false,
        dry_run: true,
      },
    });

    // require_kya is false, so payment is not blocked — but kya_verified is false
    expect(result.isError).toBeFalsy();
    const data = getStructured(result);
    const summary = data.compliance_summary as Record<string, unknown>;
    expect(summary.kya_verified).toBe(false);
  });
});
