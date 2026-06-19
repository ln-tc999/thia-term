/**
 * Unit tests for ProofLink MCP server tools.
 *
 * Strategy: spin up a full MCP server with InMemoryTransport (same pattern as
 * server.test.ts) but mock the @prooflink/core service singletons exported from
 * context.ts so every test remains purely in-process with no external I/O.
 */

import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  vi,
} from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

// ── Mock context.ts BEFORE importing the server ────────────────────────────
// vi.mock() is hoisted by vitest, so the factory must be self-contained —
// no references to variables declared in module scope above the call.
// We expose the mock fns via the module itself and grab them after import.

vi.mock("../context.js", () => {
  const screenAddress = vi.fn();
  const verifyCredential = vi.fn();
  const calculateRiskScore = vi.fn();
  return {
    sanctionsScreener: { screenAddress },
    kyaVerifier: { verifyCredential },
    amlScorer: { calculateRiskScore },
    isKnownSanctionedAddress: vi.fn(() => false),
    config: {
      sanctionsLists: ["OFAC_SDN", "EU_CONSOLIDATED"],
      failOpen: true,
    },
  };
});

vi.mock("../agent-registry.js", () => {
  const lookupAgent = vi.fn();
  return { lookupAgent, registerAgent: vi.fn(), resetRegistry: vi.fn(), clearRegistry: vi.fn(), getAllAgents: vi.fn(() => []) };
});

// ── Import server AND mocked context AFTER mocks are wired ───────────────────
import { createProofLinkMCPServer } from "../server.js";
import type { ProofLinkMCPHandle } from "../server.js";
import * as ctx from "../context.js";
import * as agentRegistry from "../agent-registry.js";

// Typed handles to the mock functions — set after the module is imported.
// These are the same vi.fn() instances created inside the vi.mock() factory.
const mockScreenAddress = ctx.sanctionsScreener
  .screenAddress as ReturnType<typeof vi.fn>;
const mockVerifyCredential = ctx.kyaVerifier
  .verifyCredential as ReturnType<typeof vi.fn>;
const mockCalculateRiskScore = ctx.amlScorer
  .calculateRiskScore as ReturnType<typeof vi.fn>;
const mockLookupAgent = agentRegistry.lookupAgent as ReturnType<typeof vi.fn>;

// ── Shared fixtures ──────────────────────────────────────────────────────────

/** A clean "address not on any sanctions list" result. */
const CLEARED_SCREEN_RESULT = {
  matched: false,
  listsChecked: ["OFAC_SDN", "EU_CONSOLIDATED", "UN_CONSOLIDATED", "HMT"],
  matchDetails: [],
  riskScore: 5,
  screenedAt: new Date().toISOString(),
  provider: "ofac_sdn_offline",
};

/** A "sanctioned address" result. */
const SANCTIONED_SCREEN_RESULT = {
  matched: true,
  listsChecked: ["OFAC_SDN"],
  matchDetails: [
    {
      list: "OFAC_SDN",
      entryId: "ofac-001",
      name: "Lazarus Group",
      matchConfidence: 1.0,
    },
  ],
  riskScore: 100,
  screenedAt: new Date().toISOString(),
  provider: "ofac_sdn_offline",
};

/** KYA verification result for a valid, trusted agent. */
const VERIFIED_KYA_RESULT = {
  verified: true,
  agentDid: "did:prooflink:agent_test",
  controllingEntity: "Acme Corp",
  delegationScope: {
    maxTransactionAmount: 10_000,
    currency: "USDC",
    expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
  },
  erc8004Registered: true,
  credentialExpired: false,
  delegationValid: true,
  errors: [],
  latencyMs: 12,
};

/** KYA verification result for a failed / untrusted agent. */
const FAILED_KYA_RESULT = {
  verified: false,
  agentDid: "did:prooflink:agent_unknown",
  controllingEntity: undefined,
  delegationScope: undefined,
  erc8004Registered: false,
  credentialExpired: false,
  delegationValid: false,
  errors: ["Issuer did:web:unknown.example is not in the trusted issuers list"],
  latencyMs: 8,
};

/** Registry lookup result for a known, valid agent. */
const FOUND_AGENT_LOOKUP = {
  found: true,
  agent: {
    agentId: "agent_001",
    did: "did:prooflink:agent_001",
    name: "PaymentBot-v2",
    type: "semi-autonomous" as const,
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
      expiresAt: new Date(Date.now() + 365 * 86_400_000).toISOString(),
    },
    kyaCredentialHash: "sha256:a1b2c3d4e5f6",
    complianceScore: 87,
    x402Support: true,
    status: "ACTIVE" as const,
    registeredAt: new Date(Date.now() - 30 * 86_400_000).toISOString(),
  },
  credentialValid: true,
  errors: [],
};

/** Registry lookup result for an unknown agent. */
const NOT_FOUND_AGENT_LOOKUP = {
  found: false,
  agent: null,
  credentialValid: false,
  errors: ['Agent "agent_unknown" not found in registry'],
};

/** AML score result for a low-risk address. */
const LOW_RISK_AML_RESULT = {
  score: 12,
  factors: [
    {
      factor: "velocity_anomaly",
      weight: 0.15,
      triggered: false,
      detail: "Normal velocity: 0 tx/hour, 0 tx/24h",
    },
  ],
  threshold: 70,
  exceeds: false,
};

/** AML score result for a high-risk address. */
const HIGH_RISK_AML_RESULT = {
  score: 95,
  factors: [
    {
      factor: "sanctions_proximity",
      weight: 0.4,
      triggered: true,
      detail: "Sanctioned counterparty within 1 hop",
    },
  ],
  threshold: 70,
  exceeds: true,
};

// ── Helpers ──────────────────────────────────────────────────────────────────

type TextContent = { type: string; text: string };

function getText(result: { content: unknown }): string {
  const content = result.content as TextContent[];
  return content[0]?.text ?? "";
}

function getStructured(result: { structuredContent?: unknown }): Record<string, unknown> {
  return (result.structuredContent ?? {}) as Record<string, unknown>;
}

// ── Test suite ───────────────────────────────────────────────────────────────

describe("ProofLink MCP Tools (unit)", () => {
  let handle: ProofLinkMCPHandle;
  let client: Client;

  beforeAll(async () => {
    handle = await createProofLinkMCPServer();
    client = new Client({ name: "tools-test-client", version: "1.0.0" });

    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();

    await handle.server.connect(serverTransport);
    await client.connect(clientTransport);
  });

  afterAll(async () => {
    await client.close();
    await handle.close();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    // Sensible defaults — individual tests override as needed.
    mockScreenAddress.mockResolvedValue(CLEARED_SCREEN_RESULT);
    mockVerifyCredential.mockResolvedValue(VERIFIED_KYA_RESULT);
    mockCalculateRiskScore.mockReturnValue(LOW_RISK_AML_RESULT);
    mockLookupAgent.mockReturnValue(FOUND_AGENT_LOOKUP);
  });

  // ── register_agent ────────────────────────────────────────────────────────

  describe("register_agent", () => {
    const MINIMAL_ARGS = {
      name: "TestBot",
      type: "semi-autonomous",
      wallet_address: "0xABC123",
      operator: { name: "Acme Corp" },
      delegation_scope: { max_transaction_usd: 5000 },
    };

    it("registers a valid agent and returns agent_id, did, and status ACTIVE", async () => {
      const result = await client.callTool({
        name: "register_agent",
        arguments: MINIMAL_ARGS,
      });

      expect(result.isError).toBeFalsy();
      const data = getStructured(result);
      expect(typeof data.agent_id).toBe("string");
      expect((data.agent_id as string).startsWith("agent_")).toBe(true);
      expect(typeof data.did).toBe("string");
      expect((data.did as string).startsWith("did:prooflink:")).toBe(true);
      expect(data.name).toBe("TestBot");
      expect(data.type).toBe("semi-autonomous");
      expect(data.wallet_address).toBe("0xABC123");
      expect(data.status).toBe("ACTIVE");
      expect(data.reputation_score).toBe(50);
    });

    it("confirmation text mentions agent name and operator", async () => {
      const result = await client.callTool({
        name: "register_agent",
        arguments: MINIMAL_ARGS,
      });

      expect(result.isError).toBeFalsy();
      const text = getText(result);
      expect(text).toContain("TestBot");
      expect(text).toContain("5,000");
    });

    it("sets kyc_verified true when operator has a DID", async () => {
      const result = await client.callTool({
        name: "register_agent",
        arguments: {
          ...MINIMAL_ARGS,
          operator: { name: "Acme Corp", did: "did:web:acme.com" },
        },
      });

      expect(result.isError).toBeFalsy();
      const data = getStructured(result);
      const operator = data.operator as Record<string, unknown>;
      const screening = operator.screening as Record<string, unknown>;
      expect(screening.kyc_verified).toBe(true);
    });

    it("sets kyc_verified false when operator has no DID", async () => {
      const result = await client.callTool({
        name: "register_agent",
        arguments: MINIMAL_ARGS, // no operator.did
      });

      expect(result.isError).toBeFalsy();
      const data = getStructured(result);
      const operator = data.operator as Record<string, unknown>;
      const screening = operator.screening as Record<string, unknown>;
      expect(screening.kyc_verified).toBe(false);
    });

    it("defaults daily_limit_usd to 5x max_transaction_usd when omitted", async () => {
      const result = await client.callTool({
        name: "register_agent",
        arguments: {
          ...MINIMAL_ARGS,
          delegation_scope: { max_transaction_usd: 1000 },
        },
      });

      expect(result.isError).toBeFalsy();
      const data = getStructured(result);
      const scope = data.delegation_scope as Record<string, unknown>;
      expect(scope.daily_limit_usd).toBe(5000);
    });

    it("uses provided daily_limit_usd when supplied", async () => {
      const result = await client.callTool({
        name: "register_agent",
        arguments: {
          ...MINIMAL_ARGS,
          delegation_scope: {
            max_transaction_usd: 1000,
            daily_limit_usd: 20000,
          },
        },
      });

      expect(result.isError).toBeFalsy();
      const data = getStructured(result);
      const scope = data.delegation_scope as Record<string, unknown>;
      expect(scope.daily_limit_usd).toBe(20000);
    });

    it("defaults allowed_chains to ['base'] when omitted", async () => {
      const result = await client.callTool({
        name: "register_agent",
        arguments: MINIMAL_ARGS,
      });

      expect(result.isError).toBeFalsy();
      const data = getStructured(result);
      const scope = data.delegation_scope as Record<string, unknown>;
      expect(scope.allowed_chains).toEqual(["base"]);
    });

    it("preserves supplied allowed_chains and allowed_currencies", async () => {
      const result = await client.callTool({
        name: "register_agent",
        arguments: {
          ...MINIMAL_ARGS,
          delegation_scope: {
            max_transaction_usd: 5000,
            allowed_chains: ["ethereum", "polygon"],
            allowed_currencies: ["USDT"],
          },
        },
      });

      expect(result.isError).toBeFalsy();
      const data = getStructured(result);
      const scope = data.delegation_scope as Record<string, unknown>;
      expect(scope.allowed_chains).toEqual(["ethereum", "polygon"]);
      expect(scope.allowed_currencies).toEqual(["USDT"]);
    });

    it("registers all three agent types successfully", async () => {
      for (const agentType of [
        "autonomous",
        "semi-autonomous",
        "human-supervised",
      ]) {
        const result = await client.callTool({
          name: "register_agent",
          arguments: { ...MINIMAL_ARGS, type: agentType },
        });
        expect(result.isError).toBeFalsy();
        const data = getStructured(result);
        expect(data.type).toBe(agentType);
      }
    });

    it("stores x402_support flag", async () => {
      const result = await client.callTool({
        name: "register_agent",
        arguments: { ...MINIMAL_ARGS, x402_support: true },
      });

      expect(result.isError).toBeFalsy();
      const data = getStructured(result);
      expect(data.x402_support).toBe(true);
    });

    it("returns error when wallet_address is empty string", async () => {
      const result = await client.callTool({
        name: "register_agent",
        arguments: { ...MINIMAL_ARGS, wallet_address: "" },
      });

      expect(result.isError).toBe(true);
      const text = getText(result);
      expect(text).toContain("wallet_address");
    });

    it("rejects invalid agent type via zod validation", async () => {
      const result = await client.callTool({
        name: "register_agent",
        arguments: { ...MINIMAL_ARGS, type: "fully-evil" },
      });

      expect(result.isError).toBe(true);
    });
  });

  // ── verify_kya ────────────────────────────────────────────────────────────

  describe("verify_kya", () => {
    it("returns verified:true and trust_score 87 when kyaVerifier succeeds", async () => {
      const result = await client.callTool({
        name: "verify_kya",
        arguments: { agent_id: "erc8004:8453:0xABCDEF" },
      });

      expect(result.isError).toBeFalsy();
      const data = getStructured(result);
      expect(data.verified).toBe(true);
      expect(data.trust_score).toBe(87);
      expect(typeof data.receipt_id).toBe("string");
      expect((data.receipt_id as string).startsWith("kya_")).toBe(true);
    });

    it("includes agent_metadata with correct shape", async () => {
      const result = await client.callTool({
        name: "verify_kya",
        arguments: { agent_id: "agent_abc123" },
      });

      expect(result.isError).toBeFalsy();
      const data = getStructured(result);
      const meta = data.agent_metadata as Record<string, unknown>;
      expect(meta.type).toBe("semi-autonomous");
      expect(typeof meta.registered_at).toBe("string");
      expect(meta.x402_support).toBe(true);
      expect(meta.erc8004_registered).toBe(true);
      expect(meta.credential_expired).toBe(false);
      expect(meta.delegation_valid).toBe(true);
    });

    it("includes spending_limits when check_spending_limits is true", async () => {
      const result = await client.callTool({
        name: "verify_kya",
        arguments: {
          agent_id: "agent_xyz",
          check_spending_limits: true,
        },
      });

      expect(result.isError).toBeFalsy();
      const data = getStructured(result);
      const limits = data.spending_limits as Record<string, unknown>;
      expect(limits).toBeDefined();
      expect(typeof limits.per_transaction_usd).toBe("number");
      expect(typeof limits.daily_usd).toBe("number");
      expect(Array.isArray(limits.allowed_chains)).toBe(true);
    });

    it("omits spending_limits when check_spending_limits is false", async () => {
      const result = await client.callTool({
        name: "verify_kya",
        arguments: {
          agent_id: "agent_xyz",
          check_spending_limits: false,
        },
      });

      expect(result.isError).toBeFalsy();
      const data = getStructured(result);
      expect(data.spending_limits).toBeUndefined();
    });

    it("reflects operator_did from registry in agent_metadata", async () => {
      const result = await client.callTool({
        name: "verify_kya",
        arguments: {
          agent_id: "agent_001",
        },
      });

      expect(result.isError).toBeFalsy();
      const data = getStructured(result);
      const meta = data.agent_metadata as Record<string, unknown>;
      expect(meta.operator).toBe("did:web:acme.com");
    });

    it("returns isError:true and trust_score 0 when agent not found in registry", async () => {
      mockLookupAgent.mockReturnValueOnce(NOT_FOUND_AGENT_LOOKUP);

      const result = await client.callTool({
        name: "verify_kya",
        arguments: { agent_id: "agent_unknown" },
      });

      expect(result.isError).toBe(true);
      const data = getStructured(result);
      expect(data.verified).toBe(false);
      expect(data.trust_score).toBe(0);
      const text = getText(result);
      expect(text).toContain("FAILED");
      expect(text).toContain("agent_unknown");
    });

    it("propagates verification errors in structured output", async () => {
      mockLookupAgent.mockReturnValueOnce({
        found: true,
        agent: { ...FOUND_AGENT_LOOKUP.agent, kyaCredentialHash: null, status: "SUSPENDED" },
        credentialValid: false,
        errors: ["Agent has no KYA credential hash", "Agent status is SUSPENDED, not ACTIVE"],
      });

      const result = await client.callTool({
        name: "verify_kya",
        arguments: { agent_id: "agent_expired" },
      });

      expect(result.isError).toBe(true);
      const data = getStructured(result);
      const errors = data.verification_errors as string[];
      expect(errors).toContain("Agent has no KYA credential hash");
      expect(errors).toContain("Agent status is SUSPENDED, not ACTIVE");
    });

    it("returns error when lookupAgent throws", async () => {
      mockLookupAgent.mockImplementationOnce(() => {
        throw new Error("Connection refused");
      });

      const result = await client.callTool({
        name: "verify_kya",
        arguments: { agent_id: "agent_crasher" },
      });

      expect(result.isError).toBe(true);
      const text = getText(result);
      expect(text).toContain("KYA_VERIFICATION_FAILED");
    });
  });

  // ── create_compliant_invoice ──────────────────────────────────────────────

  describe("create_compliant_invoice", () => {
    const SELLER = { wallet_address: "0xSeller001" };
    const BUYER = { wallet_address: "0xBuyer002" };

    it("creates invoice and calculates total correctly from multiple line items", async () => {
      const result = await client.callTool({
        name: "create_compliant_invoice",
        arguments: {
          seller: SELLER,
          buyer: BUYER,
          line_items: [
            { description: "API calls", quantity: 500, unit_price_usd: 0.02 },
            { description: "Storage", quantity: 10, unit_price_usd: 1.5 },
          ],
          currency: "USDC",
        },
      });

      expect(result.isError).toBeFalsy();
      const data = getStructured(result);
      // 500*0.02 + 10*1.5 = 10 + 15 = 25
      expect(data.total_amount).toBe(25);
      expect(data.currency).toBe("USDC");
    });

    it("returns invoice_id, receipt_id, and content_hash", async () => {
      const result = await client.callTool({
        name: "create_compliant_invoice",
        arguments: {
          seller: SELLER,
          buyer: BUYER,
          line_items: [
            { description: "Compute", quantity: 1, unit_price_usd: 100 },
          ],
        },
      });

      expect(result.isError).toBeFalsy();
      const data = getStructured(result);
      expect(typeof data.invoice_id).toBe("string");
      expect((data.invoice_id as string).startsWith("inv_")).toBe(true);
      expect(typeof data.receipt_id).toBe("string");
      expect((data.receipt_id as string).startsWith("rcpt_")).toBe(true);
      expect(typeof data.content_hash).toBe("string");
      expect((data.content_hash as string)).toHaveLength(64); // sha256 hex
    });

    it("sets travel_rule_required false for amounts below $1,000", async () => {
      const result = await client.callTool({
        name: "create_compliant_invoice",
        arguments: {
          seller: SELLER,
          buyer: BUYER,
          line_items: [
            { description: "Cheap call", quantity: 1, unit_price_usd: 999 },
          ],
        },
      });

      expect(result.isError).toBeFalsy();
      const data = getStructured(result);
      const stamp = data.compliance_stamp as Record<string, unknown>;
      expect(stamp.travel_rule_required).toBe(false);
    });

    it("sets travel_rule_required true at exactly $1,000", async () => {
      const result = await client.callTool({
        name: "create_compliant_invoice",
        arguments: {
          seller: SELLER,
          buyer: BUYER,
          line_items: [
            { description: "Exact threshold", quantity: 1, unit_price_usd: 1000 },
          ],
        },
      });

      expect(result.isError).toBeFalsy();
      const data = getStructured(result);
      const stamp = data.compliance_stamp as Record<string, unknown>;
      expect(stamp.travel_rule_required).toBe(true);
    });

    it("sets travel_rule_required true for amounts above $1,000", async () => {
      const result = await client.callTool({
        name: "create_compliant_invoice",
        arguments: {
          seller: SELLER,
          buyer: BUYER,
          line_items: [
            { description: "Large job", quantity: 1, unit_price_usd: 5000 },
          ],
        },
      });

      expect(result.isError).toBeFalsy();
      const data = getStructured(result);
      const stamp = data.compliance_stamp as Record<string, unknown>;
      expect(stamp.travel_rule_required).toBe(true);
      const text = getText(result);
      expect(text).toContain("Travel Rule");
    });

    it("produces x402_endpoint in payment_instructions when protocol is x402", async () => {
      const result = await client.callTool({
        name: "create_compliant_invoice",
        arguments: {
          seller: SELLER,
          buyer: BUYER,
          line_items: [
            { description: "Service", quantity: 1, unit_price_usd: 50 },
          ],
          payment_protocol: "x402",
        },
      });

      expect(result.isError).toBeFalsy();
      const data = getStructured(result);
      const instructions = data.payment_instructions as Record<string, unknown>;
      expect(typeof instructions.x402_endpoint).toBe("string");
      expect((instructions.x402_endpoint as string)).toContain("x402");
    });

    it("omits x402_endpoint when protocol is not x402", async () => {
      const result = await client.callTool({
        name: "create_compliant_invoice",
        arguments: {
          seller: SELLER,
          buyer: BUYER,
          line_items: [
            { description: "Service", quantity: 1, unit_price_usd: 50 },
          ],
          payment_protocol: "direct",
        },
      });

      expect(result.isError).toBeFalsy();
      const data = getStructured(result);
      const instructions = data.payment_instructions as Record<string, unknown>;
      expect(instructions.x402_endpoint).toBeUndefined();
    });

    it("includes eas_attestation_uid when anchor_on_chain is true (default)", async () => {
      const result = await client.callTool({
        name: "create_compliant_invoice",
        arguments: {
          seller: SELLER,
          buyer: BUYER,
          line_items: [
            { description: "Service", quantity: 1, unit_price_usd: 10 },
          ],
          anchor_on_chain: true,
        },
      });

      expect(result.isError).toBeFalsy();
      const data = getStructured(result);
      const stamp = data.compliance_stamp as Record<string, unknown>;
      expect(stamp.eas_attestation_uid).toBeDefined();
      expect(typeof stamp.eas_attestation_uid).toBe("string");
    });

    it("omits eas_attestation_uid when anchor_on_chain is false", async () => {
      const result = await client.callTool({
        name: "create_compliant_invoice",
        arguments: {
          seller: SELLER,
          buyer: BUYER,
          line_items: [
            { description: "Service", quantity: 1, unit_price_usd: 10 },
          ],
          anchor_on_chain: false,
        },
      });

      expect(result.isError).toBeFalsy();
      const data = getStructured(result);
      const stamp = data.compliance_stamp as Record<string, unknown>;
      expect(stamp.eas_attestation_uid).toBeUndefined();
    });

    it("rejects invoice with zero line items (zod min(1))", async () => {
      const result = await client.callTool({
        name: "create_compliant_invoice",
        arguments: {
          seller: SELLER,
          buyer: BUYER,
          line_items: [],
        },
      });

      expect(result.isError).toBe(true);
    });

    it("rejects line item with negative unit_price_usd", async () => {
      const result = await client.callTool({
        name: "create_compliant_invoice",
        arguments: {
          seller: SELLER,
          buyer: BUYER,
          line_items: [
            { description: "Refund attempt", quantity: 1, unit_price_usd: -50 },
          ],
        },
      });

      expect(result.isError).toBe(true);
    });

    it("accepts all valid service_category values", async () => {
      const categories = [
        "compute",
        "data",
        "api_call",
        "content_generation",
        "analysis",
        "transaction_fee",
        "other",
      ] as const;

      for (const category of categories) {
        const result = await client.callTool({
          name: "create_compliant_invoice",
          arguments: {
            seller: SELLER,
            buyer: BUYER,
            line_items: [
              {
                description: `Test ${category}`,
                quantity: 1,
                unit_price_usd: 1,
                service_category: category,
              },
            ],
          },
        });
        expect(result.isError).toBeFalsy();
      }
    });
  });

  // ── pay_with_compliance ───────────────────────────────────────────────────

  describe("pay_with_compliance", () => {
    const RECIPIENT = { wallet_address: "0xRecipient123" };
    const AMOUNT = { value: 100, currency: "USDC" as const };

    it("completes a simulated payment when recipient is clear", async () => {
      const result = await client.callTool({
        name: "pay_with_compliance",
        arguments: {
          recipient: RECIPIENT,
          amount: AMOUNT,
          chain: "base",
        },
      });

      expect(result.isError).toBeFalsy();
      const data = getStructured(result);
      expect(data.status).toBe("COMPLETED");
      expect(data.simulated).toBe(true);
      expect(typeof data.tx_hash).toBe("string");
      expect((data.tx_hash as string).startsWith("0x")).toBe(true);
      expect(typeof data.receipt_id).toBe("string");
      expect(mockScreenAddress).toHaveBeenCalledWith(
        "0xRecipient123",
        "base",
      );
    });

    it("blocks payment when recipient matches sanctions list", async () => {
      mockScreenAddress.mockResolvedValueOnce(SANCTIONED_SCREEN_RESULT);

      const result = await client.callTool({
        name: "pay_with_compliance",
        arguments: {
          recipient: RECIPIENT,
          amount: AMOUNT,
          chain: "ethereum",
        },
      });

      expect(result.isError).toBe(true);
      const data = getStructured(result);
      expect(data.status).toBe("BLOCKED");
      expect((data.block_reason as string)).toContain("SANCTIONS_MATCH");
      expect((data.block_reason as string)).toContain("Lazarus Group");
      const text = getText(result);
      expect(text).toContain("BLOCKED");
      expect(text).toContain("sanctions");
    });

    it("returns DRY_RUN_BLOCKED when sanctions match during dry_run", async () => {
      mockScreenAddress.mockResolvedValueOnce(SANCTIONED_SCREEN_RESULT);

      const result = await client.callTool({
        name: "pay_with_compliance",
        arguments: {
          recipient: RECIPIENT,
          amount: AMOUNT,
          chain: "base",
          dry_run: true,
        },
      });

      expect(result.isError).toBe(true);
      const data = getStructured(result);
      expect(data.status).toBe("DRY_RUN_BLOCKED");
    });

    it("dry_run passes compliance without tx_hash when address is clear", async () => {
      const result = await client.callTool({
        name: "pay_with_compliance",
        arguments: {
          recipient: RECIPIENT,
          amount: AMOUNT,
          chain: "base",
          dry_run: true,
        },
      });

      expect(result.isError).toBeFalsy();
      const data = getStructured(result);
      expect(data.status).toBe("DRY_RUN_PASSED");
      expect(data.tx_hash).toBeNull();
      expect(data.simulated).toBe(true);
      const text = getText(result);
      expect(text).toContain("DRY RUN PASSED");
    });

    it("sets travel_rule_submitted true for amounts >= $1,000 in dry_run", async () => {
      const result = await client.callTool({
        name: "pay_with_compliance",
        arguments: {
          recipient: RECIPIENT,
          amount: { value: 1500, currency: "USDC" },
          chain: "base",
          dry_run: true,
        },
      });

      expect(result.isError).toBeFalsy();
      const data = getStructured(result);
      const summary = data.compliance_summary as Record<string, unknown>;
      expect(summary.travel_rule_required).toBe(true);
      expect(summary.travel_rule_submitted).toBe(true);
    });

    it("leaves travel_rule_submitted false for amounts < $1,000", async () => {
      const result = await client.callTool({
        name: "pay_with_compliance",
        arguments: {
          recipient: RECIPIENT,
          amount: { value: 500, currency: "USDT" },
          chain: "base",
          dry_run: true,
        },
      });

      expect(result.isError).toBeFalsy();
      const data = getStructured(result);
      const summary = data.compliance_summary as Record<string, unknown>;
      expect(summary.travel_rule_required).toBe(false);
      expect(summary.travel_rule_submitted).toBe(false);
    });

    it("runs KYA verification via registry when recipient has agent_id", async () => {
      const result = await client.callTool({
        name: "pay_with_compliance",
        arguments: {
          recipient: { wallet_address: "0xAgent456", agent_id: "agent_001" },
          amount: AMOUNT,
          chain: "base",
        },
      });

      expect(result.isError).toBeFalsy();
      expect(mockLookupAgent).toHaveBeenCalledTimes(1);
      expect(mockLookupAgent).toHaveBeenCalledWith("agent_001");
      const data = getStructured(result);
      const summary = data.compliance_summary as Record<string, unknown>;
      expect(summary.kya_verified).toBe(true);
    });

    it("blocks payment when KYA fails and require_kya is true", async () => {
      mockLookupAgent.mockReturnValueOnce(NOT_FOUND_AGENT_LOOKUP);

      const result = await client.callTool({
        name: "pay_with_compliance",
        arguments: {
          recipient: { wallet_address: "0xAgent789", agent_id: "agent_bad" },
          amount: AMOUNT,
          chain: "base",
          require_kya: true,
        },
      });

      expect(result.isError).toBe(true);
      const data = getStructured(result);
      expect(data.status).toBe("BLOCKED");
      expect((data.block_reason as string)).toContain("KYA_VERIFICATION_FAILED");
    });

    it("does not block payment when KYA fails but require_kya is false", async () => {
      mockLookupAgent.mockReturnValueOnce(NOT_FOUND_AGENT_LOOKUP);

      const result = await client.callTool({
        name: "pay_with_compliance",
        arguments: {
          recipient: { wallet_address: "0xAgent789", agent_id: "agent_bad" },
          amount: AMOUNT,
          chain: "base",
          require_kya: false,
        },
      });

      expect(result.isError).toBeFalsy();
      const data = getStructured(result);
      expect(data.status).toBe("COMPLETED");
      const summary = data.compliance_summary as Record<string, unknown>;
      expect(summary.kya_verified).toBe(false);
    });

    it("blocks payment when require_kya is true but recipient has no agent_id", async () => {
      const result = await client.callTool({
        name: "pay_with_compliance",
        arguments: {
          recipient: { wallet_address: "0xHuman999" }, // no agent_id
          amount: AMOUNT,
          chain: "base",
          require_kya: true,
        },
      });

      expect(result.isError).toBe(true);
      const data = getStructured(result);
      expect((data.block_reason as string)).toContain(
        "KYA_REQUIRED_NO_AGENT_ID",
      );
    });

    it("skips KYA and marks kya_verified true for non-agent recipients", async () => {
      const result = await client.callTool({
        name: "pay_with_compliance",
        arguments: {
          recipient: { wallet_address: "0xHuman999" },
          amount: AMOUNT,
          chain: "base",
        },
      });

      expect(result.isError).toBeFalsy();
      expect(mockLookupAgent).not.toHaveBeenCalled();
      const data = getStructured(result);
      const summary = data.compliance_summary as Record<string, unknown>;
      expect(summary.kya_verified).toBe(true);
    });

    it("links invoice_id in the completed payment result", async () => {
      const result = await client.callTool({
        name: "pay_with_compliance",
        arguments: {
          recipient: RECIPIENT,
          amount: AMOUNT,
          chain: "base",
          invoice_id: "inv_testinvoice123",
        },
      });

      expect(result.isError).toBeFalsy();
      const data = getStructured(result);
      expect(data.invoice_id).toBe("inv_testinvoice123");
    });

    it("returns error when sanctionsScreener throws", async () => {
      mockScreenAddress.mockRejectedValueOnce(new Error("Network timeout"));

      const result = await client.callTool({
        name: "pay_with_compliance",
        arguments: {
          recipient: RECIPIENT,
          amount: AMOUNT,
          chain: "base",
        },
      });

      expect(result.isError).toBe(true);
      const text = getText(result);
      expect(text).toContain("PAYMENT_FAILED");
    });

    it("rejects negative payment amount via zod validation", async () => {
      const result = await client.callTool({
        name: "pay_with_compliance",
        arguments: {
          recipient: RECIPIENT,
          amount: { value: -100, currency: "USDC" },
          chain: "base",
        },
      });

      expect(result.isError).toBe(true);
    });
  });

  // ── batch_compliance_check ────────────────────────────────────────────────

  describe("batch_compliance_check", () => {
    it("screens a single address and returns correct counts", async () => {
      const result = await client.callTool({
        name: "batch_compliance_check",
        arguments: {
          addresses: [{ address: "0xClean001", chain: "base" }],
        },
      });

      expect(result.isError).toBeFalsy();
      const data = getStructured(result);
      expect(data.total).toBe(1);
      expect(data.cleared).toBe(1);
      expect(data.blocked).toBe(0);
      expect(Array.isArray(data.lists_checked)).toBe(true);
      expect(typeof data.batch_id).toBe("string");
      expect((data.batch_id as string).startsWith("batch_")).toBe(true);
    });

    it("counts blocked and cleared addresses correctly in a mixed batch", async () => {
      mockScreenAddress
        .mockResolvedValueOnce(CLEARED_SCREEN_RESULT)
        .mockResolvedValueOnce(SANCTIONED_SCREEN_RESULT)
        .mockResolvedValueOnce(CLEARED_SCREEN_RESULT);

      const result = await client.callTool({
        name: "batch_compliance_check",
        arguments: {
          addresses: [
            { address: "0xClean001", chain: "base" },
            { address: "0xBad002", chain: "ethereum" },
            { address: "0xClean003", chain: "polygon" },
          ],
        },
      });

      expect(result.isError).toBeFalsy();
      const data = getStructured(result);
      expect(data.total).toBe(3);
      expect(data.cleared).toBe(2);
      expect(data.blocked).toBe(1);
    });

    it("per-address result has cleared, risk_score, and matches fields", async () => {
      const result = await client.callTool({
        name: "batch_compliance_check",
        arguments: {
          addresses: [{ address: "0xClean001", chain: "base" }],
        },
      });

      expect(result.isError).toBeFalsy();
      const data = getStructured(result);
      const results = data.results as Array<Record<string, unknown>>;
      const entry = results[0]!;
      expect(entry.address).toBe("0xClean001");
      expect(entry.chain).toBe("base");
      expect(entry.cleared).toBe(true);
      expect(typeof entry.risk_score).toBe("number");
      expect(Array.isArray(entry.matches)).toBe(true);
    });

    it("preserves optional label in per-address result", async () => {
      const result = await client.callTool({
        name: "batch_compliance_check",
        arguments: {
          addresses: [
            {
              address: "0xTreasury",
              chain: "base",
              label: "treasury-wallet",
            },
          ],
        },
      });

      expect(result.isError).toBeFalsy();
      const data = getStructured(result);
      const results = data.results as Array<Record<string, unknown>>;
      expect(results[0]?.label).toBe("treasury-wallet");
    });

    it("sets label to null when not provided", async () => {
      const result = await client.callTool({
        name: "batch_compliance_check",
        arguments: {
          addresses: [{ address: "0xNoLabel", chain: "base" }],
        },
      });

      expect(result.isError).toBeFalsy();
      const data = getStructured(result);
      const results = data.results as Array<Record<string, unknown>>;
      expect(results[0]?.label).toBeNull();
    });

    it("populates match details for a sanctioned address", async () => {
      mockScreenAddress.mockResolvedValueOnce(SANCTIONED_SCREEN_RESULT);

      const result = await client.callTool({
        name: "batch_compliance_check",
        arguments: {
          addresses: [{ address: "0xSanctioned001", chain: "ethereum" }],
        },
      });

      expect(result.isError).toBeFalsy();
      const data = getStructured(result);
      const results = data.results as Array<Record<string, unknown>>;
      const entry = results[0]!;
      expect(entry.cleared).toBe(false);
      const matches = entry.matches as Array<Record<string, unknown>>;
      expect(matches.length).toBeGreaterThan(0);
      expect(matches[0]?.name).toBe("Lazarus Group");
      expect(matches[0]?.list).toBe("OFAC_SDN");
    });

    it("accepts a batch of exactly 100 addresses (max size)", async () => {
      const addresses = Array.from({ length: 100 }, (_, i) => ({
        address: `0x${"A".repeat(39)}${i.toString(16).padStart(1, "0")}`,
        chain: "base" as const,
      }));

      const result = await client.callTool({
        name: "batch_compliance_check",
        arguments: { addresses },
      });

      expect(result.isError).toBeFalsy();
      const data = getStructured(result);
      expect(data.total).toBe(100);
    });

    it("rejects an empty addresses array via zod min(1)", async () => {
      const result = await client.callTool({
        name: "batch_compliance_check",
        arguments: { addresses: [] },
      });

      expect(result.isError).toBe(true);
    });

    it("rejects a batch exceeding 100 addresses via zod max(100)", async () => {
      const addresses = Array.from({ length: 101 }, (_, i) => ({
        address: `0x${i.toString(16).padStart(40, "0")}`,
        chain: "base" as const,
      }));

      const result = await client.callTool({
        name: "batch_compliance_check",
        arguments: { addresses },
      });

      expect(result.isError).toBe(true);
    });

    it("returns error when screener throws on any address", async () => {
      mockScreenAddress
        .mockResolvedValueOnce(CLEARED_SCREEN_RESULT)
        .mockRejectedValueOnce(new Error("Rate limit exceeded"));

      const result = await client.callTool({
        name: "batch_compliance_check",
        arguments: {
          addresses: [
            { address: "0xOk", chain: "base" },
            { address: "0xFail", chain: "base" },
          ],
        },
      });

      expect(result.isError).toBe(true);
      const text = getText(result);
      expect(text).toContain("SCREENING_FAILED");
    });

    it("summary text includes total, cleared, and blocked counts", async () => {
      mockScreenAddress
        .mockResolvedValueOnce(CLEARED_SCREEN_RESULT)
        .mockResolvedValueOnce(SANCTIONED_SCREEN_RESULT);

      const result = await client.callTool({
        name: "batch_compliance_check",
        arguments: {
          addresses: [
            { address: "0xOk", chain: "base" },
            { address: "0xBad", chain: "ethereum" },
          ],
        },
      });

      expect(result.isError).toBeFalsy();
      const text = getText(result);
      expect(text).toContain("2 addresses screened");
      expect(text).toContain("1 cleared");
      expect(text).toContain("1 blocked");
    });
  });

  // ── get_risk_report ───────────────────────────────────────────────────────

  describe("get_risk_report", () => {
    it("returns a full report with all top-level fields for a clean address", async () => {
      const result = await client.callTool({
        name: "get_risk_report",
        arguments: {
          address: "0xCleanAddr",
          chain: "ethereum",
        },
      });

      expect(result.isError).toBeFalsy();
      const data = getStructured(result);
      expect(typeof data.report_id).toBe("string");
      expect((data.report_id as string).startsWith("rr_")).toBe(true);
      expect(data.address).toBe("0xCleanAddr");
      expect(data.chain).toBe("ethereum");
      expect(data.recommendation).toBe("ALLOW");
      expect(typeof data.eas_attestation_uid).toBe("string");
      expect(mockScreenAddress).toHaveBeenCalledWith("0xCleanAddr", "ethereum");
      expect(mockCalculateRiskScore).toHaveBeenCalledTimes(1);
    });

    it("recommends BLOCK when aml score exceeds threshold", async () => {
      mockCalculateRiskScore.mockReturnValueOnce(HIGH_RISK_AML_RESULT);

      const result = await client.callTool({
        name: "get_risk_report",
        arguments: {
          address: "0xRiskyAddr",
          chain: "base",
        },
      });

      expect(result.isError).toBeFalsy();
      const data = getStructured(result);
      expect(data.recommendation).toBe("BLOCK");
      const riskScore = data.risk_score as Record<string, unknown>;
      expect(riskScore.exceeds_threshold).toBe(true);
      expect(riskScore.overall).toBe(95);
    });

    it("sanctions field reflects cleared:false when address is sanctioned", async () => {
      mockScreenAddress.mockResolvedValueOnce(SANCTIONED_SCREEN_RESULT);

      const result = await client.callTool({
        name: "get_risk_report",
        arguments: {
          address: "0xSanctionedAddr",
          chain: "ethereum",
        },
      });

      expect(result.isError).toBeFalsy();
      const data = getStructured(result);
      const sanctions = data.sanctions as Record<string, unknown>;
      expect(sanctions.cleared).toBe(false);
      const matches = sanctions.matches as Array<Record<string, unknown>>;
      expect(matches.length).toBeGreaterThan(0);
      expect(matches[0]?.name).toBe("Lazarus Group");
    });

    it("includes transaction_patterns and counterparty_exposure for standard depth", async () => {
      const result = await client.callTool({
        name: "get_risk_report",
        arguments: {
          address: "0xCleanAddr",
          chain: "base",
          depth: "standard",
        },
      });

      expect(result.isError).toBeFalsy();
      const data = getStructured(result);
      expect(data.transaction_patterns).toBeDefined();
      expect(data.counterparty_exposure).toBeDefined();
      expect(data.behavioral_flags).toBeUndefined();
    });

    it("omits transaction_patterns and counterparty_exposure for basic depth", async () => {
      const result = await client.callTool({
        name: "get_risk_report",
        arguments: {
          address: "0xCleanAddr",
          chain: "base",
          depth: "basic",
        },
      });

      expect(result.isError).toBeFalsy();
      const data = getStructured(result);
      expect(data.transaction_patterns).toBeUndefined();
      expect(data.counterparty_exposure).toBeUndefined();
      expect(data.behavioral_flags).toBeUndefined();
    });

    it("includes behavioral_flags for enhanced depth", async () => {
      const result = await client.callTool({
        name: "get_risk_report",
        arguments: {
          address: "0xCleanAddr",
          chain: "base",
          depth: "enhanced",
        },
      });

      expect(result.isError).toBeFalsy();
      const data = getStructured(result);
      expect(data.transaction_patterns).toBeDefined();
      expect(data.counterparty_exposure).toBeDefined();
      expect(data.behavioral_flags).toBeDefined();
      const flags = data.behavioral_flags as Record<string, unknown>;
      expect(typeof flags.structuring_detected).toBe("boolean");
      expect(Array.isArray(flags.cross_chain_activity)).toBe(true);
    });

    it("sanctioned_counterparties is 1 when address itself is sanctioned (standard depth)", async () => {
      mockScreenAddress.mockResolvedValueOnce(SANCTIONED_SCREEN_RESULT);

      const result = await client.callTool({
        name: "get_risk_report",
        arguments: {
          address: "0xSanctionedAddr",
          chain: "ethereum",
          depth: "standard",
        },
      });

      expect(result.isError).toBeFalsy();
      const data = getStructured(result);
      const exposure = data.counterparty_exposure as Record<string, unknown>;
      expect(exposure.sanctioned_counterparties).toBe(1);
    });

    it("uses default depth of standard when not specified", async () => {
      const result = await client.callTool({
        name: "get_risk_report",
        arguments: {
          address: "0xCleanAddr",
          chain: "base",
        },
      });

      expect(result.isError).toBeFalsy();
      const data = getStructured(result);
      expect(data.depth).toBe("standard");
      expect(data.transaction_patterns).toBeDefined();
    });

    it("uses default time_range_days of 90 when not specified", async () => {
      const result = await client.callTool({
        name: "get_risk_report",
        arguments: {
          address: "0xCleanAddr",
          chain: "base",
        },
      });

      expect(result.isError).toBeFalsy();
      const data = getStructured(result);
      expect(data.time_range_days).toBe(90);
    });

    it("passes time_range_days through to the report", async () => {
      const result = await client.callTool({
        name: "get_risk_report",
        arguments: {
          address: "0xCleanAddr",
          chain: "base",
          time_range_days: 30,
        },
      });

      expect(result.isError).toBeFalsy();
      const data = getStructured(result);
      expect(data.time_range_days).toBe(30);
    });

    it("returns error when sanctionsScreener throws", async () => {
      mockScreenAddress.mockRejectedValueOnce(new Error("Upstream timeout"));

      const result = await client.callTool({
        name: "get_risk_report",
        arguments: {
          address: "0xProblemAddr",
          chain: "base",
        },
      });

      expect(result.isError).toBe(true);
      const text = getText(result);
      expect(text).toContain("REPORT_GENERATION_FAILED");
    });

    it("rejects time_range_days of 0 via zod min(1)", async () => {
      const result = await client.callTool({
        name: "get_risk_report",
        arguments: {
          address: "0xCleanAddr",
          chain: "base",
          time_range_days: 0,
        },
      });

      expect(result.isError).toBe(true);
    });

    it("rejects time_range_days exceeding 365 via zod max(365)", async () => {
      const result = await client.callTool({
        name: "get_risk_report",
        arguments: {
          address: "0xCleanAddr",
          chain: "base",
          time_range_days: 366,
        },
      });

      expect(result.isError).toBe(true);
    });

    it("risk_score factors array has correct shape", async () => {
      const result = await client.callTool({
        name: "get_risk_report",
        arguments: {
          address: "0xCleanAddr",
          chain: "base",
        },
      });

      expect(result.isError).toBeFalsy();
      const data = getStructured(result);
      const riskScore = data.risk_score as Record<string, unknown>;
      const factors = riskScore.factors as Array<Record<string, unknown>>;
      expect(Array.isArray(factors)).toBe(true);
      if (factors.length > 0) {
        const factor = factors[0]!;
        expect("factor" in factor).toBe(true);
        expect("weight" in factor).toBe(true);
        expect("detail" in factor).toBe(true);
      }
    });
  });
});
