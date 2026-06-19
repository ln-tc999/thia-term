/**
 * E2E test infrastructure for ProofLink.
 *
 * Strategy: the API is a Hono app with no persistent server process.
 * Hono's `app.request()` method calls the handler in-process — same approach
 * used by the existing unit tests in apps/api/src/__tests__/.
 *
 * Database: mocked in-memory using vi.mock so tests never need a real Postgres
 * instance. Each test suite seeds its own data via the mock factory.
 *
 * No port binding, no network, no cleanup needed — pure in-process isolation.
 */

import type { Hono } from "hono";

// ---------------------------------------------------------------------------
// In-process DB mock helpers — re-exported for test suites
// ---------------------------------------------------------------------------

export type MockInsertFn = ReturnType<typeof vi.fn>;
export type MockSelectFn = ReturnType<typeof vi.fn>;
export type MockUpdateFn = ReturnType<typeof vi.fn>;

/**
 * Build a Drizzle-compatible insert mock.
 * Returns a chainable object: insert().values().returning() and
 * insert().values().onConflictDoUpdate().returning()
 */
export function makeInsertMock(insertFn: MockInsertFn) {
  return () => ({
    values: () => ({
      returning: insertFn,
      onConflictDoUpdate: () => ({
        returning: insertFn,
      }),
    }),
  });
}

/**
 * Build a Drizzle-compatible select mock.
 * Returns a chainable object: select().from().<chain>
 */
export function makeSelectMock(selectFn: MockSelectFn) {
  return () => ({
    from: selectFn,
  });
}

/**
 * Build a Drizzle-compatible update mock.
 * Returns a chainable object: update().set().where().returning()
 */
export function makeUpdateMock(updateFn: MockUpdateFn) {
  return () => ({
    set: () => ({
      where: () => ({
        returning: updateFn,
        catch: () => Promise.resolve(),
      }),
    }),
  });
}

// ---------------------------------------------------------------------------
// Standard mock Chainalysis responses
// ---------------------------------------------------------------------------

/**
 * Mock Chainalysis free API response for a clean address.
 */
export function chainalysisCleanResponse(): Response {
  return new Response(JSON.stringify({ identifications: [] }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * Mock Chainalysis free API response for a sanctioned address.
 * Mirrors real Chainalysis response shape for Tornado Cash addresses.
 */
export function chainalysisSanctionedResponse(entityName = "Tornado Cash"): Response {
  return new Response(
    JSON.stringify({
      identifications: [
        {
          category: "sanctions",
          name: entityName,
          description: "OFAC SDN designated",
          url: "https://ofac.treasury.gov/sdn",
        },
      ],
    }),
    {
      status: 200,
      headers: { "Content-Type": "application/json" },
    },
  );
}

// ---------------------------------------------------------------------------
// Standard test fixtures
// ---------------------------------------------------------------------------

export const TEST_API_KEY = "fl_test_e2e_key_123";
export const TEST_CHAIN = "eip155:8453"; // Base
export const TEST_CLEAN_ADDRESS = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045"; // vitalik.eth
export const TEST_SANCTIONED_ADDRESS = "0xd90e2f925da726b50c4ed8d0fb90ad053324f31b"; // TC 100 ETH pool
export const TEST_SELLER_ADDRESS = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
export const TEST_BUYER_ADDRESS = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";

export const BASE_INVOICE_PAYLOAD = {
  seller: {
    walletAddress: TEST_SELLER_ADDRESS,
    agentId: "did:prooflink:agent:seller-001",
    legalName: "Acme Corp Compute",
  },
  buyer: {
    walletAddress: TEST_BUYER_ADDRESS,
    agentId: "did:prooflink:agent:buyer-001",
    legalName: "ProofLink Test Client",
  },
  lineItems: [
    {
      description: "API inference calls",
      quantity: 15000,
      unit: "call",
      unitPrice: 0.003,
      total: 45.0,
      serviceCategory: "api_call",
    },
  ],
  currency: "USDC" as const,
  totalAmount: 45.0,
  paymentProtocol: "x402" as const,
};

export const BASE_COMPLIANCE_CHECK_PAYLOAD = {
  sender: { address: TEST_BUYER_ADDRESS, chain: TEST_CHAIN },
  receiver: { address: TEST_SELLER_ADDRESS, chain: TEST_CHAIN },
  amount: "45.00",
  asset: "USDC",
  protocol: "x402",
};

// ---------------------------------------------------------------------------
// Fixture factories
// ---------------------------------------------------------------------------

export function makeInvoiceRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "550e8400-e29b-41d4-a716-446655440001",
    issuerAgentDid: "did:prooflink:agent:seller-001",
    recipientAgentDid: "did:prooflink:agent:buyer-001",
    sellerWalletAddress: TEST_SELLER_ADDRESS,
    buyerWalletAddress: TEST_BUYER_ADDRESS,
    currency: "USDC",
    totalAmount: "45.00",
    state: "DRAFT",
    lineItems: BASE_INVOICE_PAYLOAD.lineItems,
    paymentProtocol: "x402",
    invoiceData: {},
    createdAt: new Date("2026-03-20T12:00:00Z"),
    updatedAt: new Date("2026-03-20T12:00:00Z"),
    ...overrides,
  };
}

export function makeComplianceCheckRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "550e8400-e29b-41d4-a716-446655440002",
    senderAddress: TEST_BUYER_ADDRESS,
    receiverAddress: TEST_SELLER_ADDRESS,
    amount: "45.00",
    asset: "USDC",
    chain: TEST_CHAIN,
    protocol: "x402",
    status: "APPROVED",
    riskScore: 12,
    checks: [],
    totalDurationMs: 150,
    createdAt: new Date("2026-03-20T12:00:00Z"),
    ...overrides,
  };
}

export function makeReceiptRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "550e8400-e29b-41d4-a716-446655440003",
    checkId: "550e8400-e29b-41d4-a716-446655440002",
    receiptHash: `0x${"a".repeat(64)}`,
    overallStatus: "APPROVED",
    riskScore: 12,
    travelRuleStatus: "NOT_REQUIRED",
    signature: `0x${"0".repeat(128)}`,
    checksPerformed: [],
    ttl: 300,
    createdAt: new Date("2026-03-20T12:00:00Z"),
    ...overrides,
  };
}

export function makeAgentRow(overrides: Record<string, unknown> = {}) {
  const futureDate = new Date();
  futureDate.setFullYear(futureDate.getFullYear() + 1);

  return {
    id: "550e8400-e29b-41d4-a716-446655440004",
    agentDid: "did:prooflink:agent:inference-v3",
    name: "inference-agent-v3",
    agentType: "semi-autonomous",
    walletAddress: "0xAgentWallet1234567890abcdef1234567890ab",
    controllingEntityName: "Acme Corp",
    controllingEntityLei: "549300ABCDEF123456AB",
    erc8004Id: 42,
    erc8004Registry: "0xRegistry1234567890abcdef1234567890abcd",
    complianceScore: 87,
    delegationScope: {
      maxTransactionValue: 10000,
      dailyLimit: 50000,
      allowedChains: ["eip155:8453", "eip155:1"],
      allowedCurrencies: ["USDC", "USDT"],
      expiresAt: futureDate.toISOString(),
    },
    isActive: true,
    validatedAt: new Date("2026-03-01T00:00:00Z"),
    expiresAt: futureDate,
    createdAt: new Date("2026-03-01T00:00:00Z"),
    updatedAt: new Date("2026-03-01T00:00:00Z"),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Standard auth mock — bypass API key validation
// ---------------------------------------------------------------------------

export const AUTH_BYPASS_MOCK = {
  authMiddleware: () => {
    return async (_c: unknown, next: () => Promise<void>) => {
      await next();
    };
  },
};

// ---------------------------------------------------------------------------
// Timing helper
// ---------------------------------------------------------------------------

/**
 * Record elapsed milliseconds for a response.
 * Uses the response Date header if available, falls back to wall-clock.
 */
export async function measureResponseTime(
  app: Hono,
  path: string,
  init: RequestInit,
): Promise<{ response: Response; elapsedMs: number }> {
  const start = Date.now();
  const response = await app.request(path, init);
  const elapsedMs = Date.now() - start;
  return { response, elapsedMs };
}

// ---------------------------------------------------------------------------
// Re-export vi from vitest so setup helpers can be called inside vi.mock scope
// ---------------------------------------------------------------------------
import { vi } from "vitest";
export { vi };
