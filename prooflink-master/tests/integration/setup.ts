/**
 * Integration test setup: shared factories, mock services, and helpers.
 *
 * Every test file imports from here to ensure consistent config and mock shape.
 * External services (Chainalysis API, blockchain RPC) are mocked globally.
 * Real internal logic (ProofLinkEngine, AMLScorer, TravelRuleChecker, etc.) runs unmodified.
 */

import { vi } from "vitest";
import { createApp } from "../../apps/api/src/app.js";
import { ProofLinkEngine } from "../../packages/core/src/engine/prooflink.js";
import type { ComplianceRequest } from "../../packages/core/src/engine/prooflink.js";
import type { ProofLinkConfig } from "../../packages/core/src/config.js";
import { MockNotabeneProvider } from "../../packages/core/src/travel-rule/checker.js";
import type { TravelRuleProvider } from "../../packages/core/src/travel-rule/checker.js";
import { ProofLinkX402Compliance } from "../../packages/x402-compliance/src/middleware.js";
import type { ProofLinkConfig } from "../../packages/x402-compliance/src/types.js";
import type {
  SanctionsScreener,
  AmlScorer,
  KYAVerifier,
  KYARegistry,
} from "../../packages/x402-compliance/src/hooks/before-verify.js";
import type { TravelRuleService, PriceConverter } from "../../packages/x402-compliance/src/hooks/before-settle.js";
import type { ProofLinkService, InvoiceService } from "../../packages/x402-compliance/src/hooks/after-settle.js";
import type {
  PaymentPayload,
  PaymentRequirements,
  X402ResourceServer,
  ResourceServerExtension,
  VerifyContext,
  SettleContext,
  SettleResultContext,
  BeforeHookResult,
  ScreeningResult,
  AmlScoreResult,
  KYACredential,
  KYAVerificationResult,
  ComplianceEvent,
} from "../../packages/x402-compliance/src/types.js";

// ---------------------------------------------------------------------------
// Well-known test addresses
// ---------------------------------------------------------------------------

/** A clean address with no sanctions or AML hits. */
export const CLEAN_SENDER = "0x1111111111111111111111111111111111111111";
export const CLEAN_RECEIVER = "0x2222222222222222222222222222222222222222";

/** A Tornado Cash address that appears in the offline OFAC SDN list. */
export const KNOWN_OFAC_ADDRESS = "0x8589427373d6d84e98730d7795d8f6f8731fda16";

/** An address to use in custom sanctioned-response mocks. */
export const MOCK_SANCTIONED_ADDRESS = "0xBAD0000000000000000000000000000000000BAD";

/** An agent address for KYA tests. */
export const AGENT_ADDRESS = "0xA6E41000000000000000000000000000000A6E41";

// ---------------------------------------------------------------------------
// Chainalysis fetch mock helpers
// ---------------------------------------------------------------------------

export function cleanChainalysisResponse(): Response {
  return new Response(JSON.stringify({ identifications: [] }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

export function sanctionedChainalysisResponse(): Response {
  return new Response(
    JSON.stringify({
      identifications: [
        {
          category: "sanctions",
          name: "OFAC SDN Designated",
          description: "Tornado Cash",
          url: "https://ofac.treasury.gov/tornado-cash",
        },
      ],
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

// ---------------------------------------------------------------------------
// ProofLink engine factory
// ---------------------------------------------------------------------------

export function makeProofLinkConfig(overrides?: Partial<ProofLinkConfig>): ProofLinkConfig {
  return {
    chainalysisBaseUrl: "https://public.chainalysis.com/api/v1",
    sanctionsLists: ["OFAC_SDN"],
    maxRiskScore: 85,
    escalationThreshold: 60,
    failOpen: false,
    allowlist: [],
    blocklist: [],
    travelRuleThresholds: { US: 3000, EU: 0, SG: 1100 },
    defaultTravelRuleThresholdUsd: 3000,
    cacheMaxEntries: 1000,
    sanctionsCacheTtlMs: 300_000,
    kyaCacheTtlMs: 900_000,
    restrictedJurisdictions: ["IR", "KP", "SY", "CU", "RU"],
    ...overrides,
  };
}

export function makeComplianceRequest(overrides?: Partial<ComplianceRequest>): ComplianceRequest {
  return {
    sender: CLEAN_SENDER,
    receiver: CLEAN_RECEIVER,
    amountUsd: 100,
    asset: "USDC",
    chain: "eip155:8453",
    ...overrides,
  };
}

export function createProofLinkEngine(
  configOverrides?: Partial<ProofLinkConfig>,
  options?: { travelRuleProvider?: TravelRuleProvider; trustedIssuers?: string[] },
): ProofLinkEngine {
  return new ProofLinkEngine(makeProofLinkConfig(configOverrides), {
    travelRuleProvider: options?.travelRuleProvider ?? new MockNotabeneProvider(),
    trustedIssuers: options?.trustedIssuers,
  });
}

// ---------------------------------------------------------------------------
// x402 compliance middleware factories
// ---------------------------------------------------------------------------

export function makeX402Config(overrides?: Partial<ProofLinkConfig>): ProofLinkConfig {
  return {
    chainalysisApiKey: "test-api-key",
    policy: {
      sanctionsLists: ["OFAC_SDN", "EU", "UN"],
      maxRiskScore: 70,
      travelRuleThresholdUsd: 3000,
      blocklist: [],
      ...overrides?.policy,
    },
    ...overrides,
  };
}

export function makePaymentPayload(overrides?: Partial<PaymentPayload>): PaymentPayload {
  return {
    x402Version: 2,
    scheme: "exact",
    network: "eip155:8453",
    payload: {
      signature: "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890ab",
      authorization: {
        from: CLEAN_SENDER,
        to: CLEAN_RECEIVER,
        value: "10000",
        validAfter: "1740672089",
        validBefore: "1740672154",
        nonce: "0xf3746",
      },
    },
    ...overrides,
  };
}

export function makePaymentRequirements(overrides?: Partial<PaymentRequirements>): PaymentRequirements {
  return {
    scheme: "exact",
    network: "eip155:8453",
    maxAmountRequired: "10000",
    payTo: CLEAN_RECEIVER,
    asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// x402 mock service factories
// ---------------------------------------------------------------------------

export function createMockScreener(sanctionedAddress?: string): SanctionsScreener {
  return {
    screen: vi.fn(async (address: string): Promise<ScreeningResult> => {
      const hit = sanctionedAddress
        ? address.toLowerCase() === sanctionedAddress.toLowerCase()
        : false;
      return {
        address,
        clean: !hit,
        matchedList: hit ? "OFAC_SDN" : undefined,
        latencyMs: 5,
      };
    }),
  };
}

export function createMockAmlScorer(score = 20): AmlScorer {
  return {
    score: vi.fn(async (address: string): Promise<AmlScoreResult> => ({
      address,
      score,
      latencyMs: 3,
      factors: score > 50 ? ["velocity_anomaly"] : [],
    })),
  };
}

export function createMockKYARegistry(knownAddress?: string): KYARegistry {
  return {
    lookup: vi.fn(async (address: string): Promise<KYACredential | null> => {
      if (knownAddress && address.toLowerCase() === knownAddress.toLowerCase()) {
        return {
          agentId: "agent-001",
          issuer: "did:ethr:0xISSUER",
          issuedAt: new Date(Date.now() - 86_400_000).toISOString(),
          expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
          reputationScore: 85,
        };
      }
      return null;
    }),
  };
}

export function createMockKYAVerifier(valid = true, expired = false): KYAVerifier {
  return {
    verify: vi.fn(async (agentId: string): Promise<KYAVerificationResult> => ({
      valid,
      expired,
      agentId,
      reason: valid ? undefined : expired ? "credential expired" : "verification failed",
      latencyMs: 2,
    })),
  };
}

export function createMockTravelRuleService(success = true): TravelRuleService {
  return {
    transmit: vi.fn(async () => ({
      success,
      referenceId: success ? "tr-ref-12345" : undefined,
      error: success ? undefined : "Notabene API error",
      latencyMs: 50,
    })),
  };
}

export function createMockPriceConverter(usdAmount: number): PriceConverter {
  return {
    toUsd: vi.fn(async () => usdAmount),
  };
}

export function createMockProofLinkService(): ProofLinkService {
  return {
    computeHash: vi.fn((receipt) => `0x${receipt.transactionHash.slice(2, 18)}`),
    attestOnChain: vi.fn(async () => "eas-uid-12345"),
    storeAuditRecord: vi.fn(async () => {}),
  };
}

export function createMockInvoiceService(): InvoiceService {
  return {
    generate: vi.fn(async () => "inv-12345"),
  };
}

export function createMockX402Server(): X402ResourceServer & {
  hooks: {
    beforeVerify: Array<(ctx: VerifyContext) => Promise<BeforeHookResult>>;
    beforeSettle: Array<(ctx: SettleContext) => Promise<BeforeHookResult>>;
    afterSettle: Array<(ctx: SettleResultContext) => Promise<void>>;
  };
  extensions: ResourceServerExtension[];
} {
  const hooks = {
    beforeVerify: [] as Array<(ctx: VerifyContext) => Promise<BeforeHookResult>>,
    beforeSettle: [] as Array<(ctx: SettleContext) => Promise<BeforeHookResult>>,
    afterSettle: [] as Array<(ctx: SettleResultContext) => Promise<void>>,
  };
  const extensions: ResourceServerExtension[] = [];

  return {
    hooks,
    extensions,
    onBeforeVerify: vi.fn((hook) => { hooks.beforeVerify.push(hook); }),
    onBeforeSettle: vi.fn((hook) => { hooks.beforeSettle.push(hook); }),
    onAfterSettle: vi.fn((hook) => { hooks.afterSettle.push(hook); }),
    registerExtension: vi.fn((ext) => { extensions.push(ext); }),
  };
}

// ---------------------------------------------------------------------------
// API app + DB mock factories
// ---------------------------------------------------------------------------

export const mockInsertReturning = vi.fn();
export const mockSelectFrom = vi.fn();
export const mockUpdateReturning = vi.fn();

export const sampleInvoice = {
  id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
  issuerAgentDid: "did:prooflink:agent:seller",
  recipientAgentDid: "did:prooflink:agent:buyer",
  sellerWalletAddress: "0xSELLER000000000000000000000000000000000",
  buyerWalletAddress: "0xBUYER0000000000000000000000000000000000",
  currency: "USDC",
  totalAmount: "250.00",
  state: "DRAFT",
  lineItems: [
    { description: "API calls", quantity: 1000, unit: "call", unitPrice: 0.25, total: 250 },
  ],
  invoiceData: {},
  createdAt: new Date("2026-03-20T00:00:00Z"),
  updatedAt: new Date("2026-03-20T00:00:00Z"),
} as const;

export const sampleComplianceCheck = {
  id: "cccccccc-dddd-eeee-ffff-000000000001",
  senderAddress: CLEAN_SENDER,
  receiverAddress: CLEAN_RECEIVER,
  status: "APPROVED",
  riskScore: 12,
  checks: [],
  totalDurationMs: 85,
  createdAt: new Date("2026-03-20T00:00:00Z"),
} as const;

export const sampleReceipt = {
  id: "rrrrrrrr-eeee-cccc-eeee-iiiiiiiiiiii",
  checkId: sampleComplianceCheck.id,
  receiptHash: "0xabc123def456",
  overallStatus: "APPROVED",
  riskScore: 12,
  travelRuleStatus: "TRANSMITTED",
  signature: "0x" + "0".repeat(128),
  checksPerformed: [],
  ttl: 300,
  createdAt: new Date("2026-03-20T00:00:00Z"),
} as const;

/** Re-export createApp for integration tests that spin up the API. */
export { createApp, ProofLinkX402Compliance };
export type { ComplianceEvent };
