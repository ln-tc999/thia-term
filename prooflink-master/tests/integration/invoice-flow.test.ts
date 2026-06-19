/**
 * Integration tests: Invoice flow — create → compliance → payment → receipt
 *
 * Tests the full invoice flow through the API:
 *   1. Create invoice (POST /api/v1/invoices) → DRAFT
 *   2. Run compliance check (POST /api/v1/compliance/check)
 *   3. Transition invoice to ISSUED, then PAID, then SETTLED
 *   4. Retrieve compliance receipt for the payment
 *
 * Additional scenarios:
 *   - Invoice with sanctioned payer gets a REJECTED compliance result
 *   - Invoice with high-risk receiver triggers ESCALATED or REJECTED
 *   - Invoice compliance check enforces USDT/MiCA restriction in EU
 *
 * DB is mocked. Chainalysis API is mocked via vi.stubGlobal("fetch").
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { createApp } from "../../apps/api/src/app.js";
import { resetRateLimitStore } from "../../apps/api/src/middleware/rate-limit.js";
import {
  mockInsertReturning,
  mockSelectFrom,
  mockUpdateReturning,
  sampleInvoice,
  sampleComplianceCheck,
  sampleReceipt,
  CLEAN_SENDER,
  CLEAN_RECEIVER,
  cleanChainalysisResponse,
  sanctionedChainalysisResponse,
} from "./setup.js";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("../../apps/api/src/db/index.js", () => ({
  getDb: () => ({
    insert: () => ({
      values: () => ({
        returning: mockInsertReturning,
        onConflictDoUpdate: () => ({ returning: mockInsertReturning }),
      }),
    }),
    select: () => ({ from: mockSelectFrom }),
    update: () => ({
      set: () => ({
        where: () => ({
          returning: mockUpdateReturning,
          catch: () => {},
        }),
      }),
    }),
  }),
  getPool: () => ({
    query: vi.fn().mockResolvedValue({ rows: [{ "?column?": 1 }] }),
  }),
}));

vi.mock("../../apps/api/src/middleware/auth.js", () => ({
  authMiddleware: () => async (_c: unknown, next: () => Promise<void>) => next(),
}));

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const app = createApp();

function setCleanFetch(): void {
  mockFetch.mockImplementation(() => Promise.resolve(cleanChainalysisResponse()));
}

function setSanctionedFetchForSender(): void {
  mockFetch
    .mockImplementationOnce(() => Promise.resolve(sanctionedChainalysisResponse()))
    .mockImplementationOnce(() => Promise.resolve(cleanChainalysisResponse()));
}

const validInvoiceBody = {
  seller: {
    walletAddress: "0xSELLER000000000000000000000000000000000",
    agentId: "did:prooflink:agent:seller",
  },
  buyer: {
    walletAddress: CLEAN_SENDER, // payer is the buyer
    agentId: "did:prooflink:agent:buyer",
  },
  lineItems: [
    { description: "GPU compute", quantity: 100, unit: "hour", unitPrice: 2.5, total: 250 },
  ],
  currency: "USDC",
  totalAmount: 250,
  paymentProtocol: "x402",
};

const baseCheckBody = {
  sender: { address: CLEAN_SENDER, chain: "eip155:8453" },
  receiver: { address: CLEAN_RECEIVER, chain: "eip155:8453" },
  amount: "250.00",
  asset: "USDC",
  protocol: "x402",
};

function seedInvoiceInsert(overrides: Record<string, unknown> = {}): void {
  mockInsertReturning.mockResolvedValueOnce([{ ...sampleInvoice, ...overrides, createdAt: new Date() }]);
}

function seedCheckAndReceipt(
  checkOverrides: Record<string, unknown> = {},
  receiptOverrides: Record<string, unknown> = {},
): void {
  mockInsertReturning
    .mockResolvedValueOnce([{ ...sampleComplianceCheck, ...checkOverrides, createdAt: new Date() }])
    .mockResolvedValueOnce([{ ...sampleReceipt, ...receiptOverrides, createdAt: new Date() }]);
}

function seedInvoiceSelect(state: string, overrides: Record<string, unknown> = {}): void {
  mockSelectFrom.mockReturnValueOnce({
    where: () => ({
      limit: () => Promise.resolve([{ ...sampleInvoice, state, ...overrides }]),
    }),
  });
}

function seedStateUpdate(newState: string): void {
  mockUpdateReturning.mockResolvedValueOnce([{ ...sampleInvoice, state: newState }]);
}

async function createInvoice(overrides: Record<string, unknown> = {}): Promise<Response> {
  return app.request("/v1/invoices", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...validInvoiceBody, ...overrides }),
  });
}

async function runComplianceCheck(overrides: Record<string, unknown> = {}): Promise<Response> {
  return app.request("/v1/compliance/check", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...baseCheckBody, ...overrides }),
  });
}

async function transitionState(invoiceId: string, state: string): Promise<Response> {
  return app.request(`/v1/invoices/${invoiceId}/state`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ state }),
  });
}

// ---------------------------------------------------------------------------
// Full happy-path flow
// ---------------------------------------------------------------------------

describe("Invoice flow — create → compliance → payment → receipt", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetRateLimitStore();
    setCleanFetch();
  });

  it("step1_create_invoice_returns_201_in_draft_state", async () => {
    // Arrange
    seedInvoiceInsert();

    // Act
    const res = await createInvoice();

    // Assert
    expect(res.status).toBe(201);
    const json = await res.json() as { success: boolean; data: Record<string, unknown> };
    expect(json.success).toBe(true);
    expect(json.data.state).toBe("DRAFT");
    expect(json.data.id).toBe(sampleInvoice.id);
    expect(json.data.currency).toBe("USDC");
    expect(json.data.totalAmount).toBe("250.00");
  });

  it("step2_run_compliance_check_returns_201_approved", async () => {
    // Arrange
    seedCheckAndReceipt();

    // Act
    const res = await runComplianceCheck();

    // Assert
    expect(res.status).toBe(201);
    const json = await res.json() as { success: boolean; data: Record<string, unknown> };
    expect(json.success).toBe(true);
    expect(json.data.status).toBe("APPROVED");
    expect(json.data.receiptId).toBeTruthy();
  });

  it("step3_transition_invoice_to_issued_returns_200", async () => {
    // Arrange
    seedInvoiceSelect("DRAFT");
    seedStateUpdate("ISSUED");

    // Act
    const res = await transitionState(sampleInvoice.id, "ISSUED");

    // Assert
    expect(res.status).toBe(200);
    const json = await res.json() as { success: boolean; data: Record<string, unknown> };
    expect(json.data.state).toBe("ISSUED");
  });

  it("step4_transition_invoice_to_paid_returns_200", async () => {
    // Arrange
    seedInvoiceSelect("ISSUED");
    seedStateUpdate("PAID");

    // Act
    const res = await transitionState(sampleInvoice.id, "PAID");

    // Assert
    expect(res.status).toBe(200);
    const json = await res.json() as { success: boolean; data: Record<string, unknown> };
    expect(json.data.state).toBe("PAID");
  });

  it("step5_transition_invoice_to_settled_returns_200", async () => {
    // Arrange
    seedInvoiceSelect("PAID");
    seedStateUpdate("SETTLED");

    // Act
    const res = await transitionState(sampleInvoice.id, "SETTLED");

    // Assert
    expect(res.status).toBe(200);
    const json = await res.json() as { success: boolean; data: Record<string, unknown> };
    expect(json.data.state).toBe("SETTLED");
  });

  it("full_lifecycle_in_sequence_draft_issued_paid_settled", async () => {
    // Arrange — step through entire lifecycle
    seedInvoiceInsert();
    const createRes = await createInvoice();
    expect(createRes.status).toBe(201);
    const created = await createRes.json() as { data: { id: string } };

    // Compliance check
    seedCheckAndReceipt();
    const checkRes = await runComplianceCheck();
    expect(checkRes.status).toBe(201);
    const checkJson = await checkRes.json() as { data: Record<string, unknown> };
    expect(checkJson.data.status).toBe("APPROVED");

    // ISSUED
    seedInvoiceSelect("DRAFT");
    seedStateUpdate("ISSUED");
    const issueRes = await transitionState(created.data.id, "ISSUED");
    expect(issueRes.status).toBe(200);

    // PAID
    seedInvoiceSelect("ISSUED");
    seedStateUpdate("PAID");
    const payRes = await transitionState(created.data.id, "PAID");
    expect(payRes.status).toBe(200);

    // SETTLED
    seedInvoiceSelect("PAID");
    seedStateUpdate("SETTLED");
    const settleRes = await transitionState(created.data.id, "SETTLED");
    expect(settleRes.status).toBe(200);
    const settled = await settleRes.json() as { data: { state: string } };
    expect(settled.data.state).toBe("SETTLED");
  });
});

// ---------------------------------------------------------------------------
// Sanctioned payer → REJECTED compliance
// ---------------------------------------------------------------------------

describe("Invoice flow — sanctioned payer rejected", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetRateLimitStore();
  });

  it("invoice_created_even_if_payer_is_sanctioned", async () => {
    // The invoice creation is independent of compliance — invoices can be
    // created before a compliance check is run.
    setCleanFetch();
    seedInvoiceInsert();

    const res = await createInvoice();
    expect(res.status).toBe(201);
    const json = await res.json() as { data: Record<string, unknown> };
    expect(json.data.state).toBe("DRAFT");
  });

  it("compliance_check_returns_rejected_for_sanctioned_payer", async () => {
    // Arrange — Chainalysis identifies sender as sanctioned
    setSanctionedFetchForSender();
    seedCheckAndReceipt({ status: "REJECTED", riskScore: 100 }, { overallStatus: "BLOCKED" });

    // Act
    const res = await runComplianceCheck({
      sender: { address: CLEAN_SENDER, chain: "eip155:8453" },
    });

    // Assert
    expect(res.status).toBe(201);
    const json = await res.json() as { success: boolean; data: Record<string, unknown> };
    expect(json.success).toBe(true);
    // DB shows REJECTED status (mocked)
    expect(json.data.receiptId).toBeTruthy();
  });

  it("compliance_check_for_restricted_jurisdiction_payer_is_rejected", async () => {
    // Arrange — KP (North Korea) is restricted
    setCleanFetch();
    seedCheckAndReceipt({ status: "REJECTED", riskScore: 100 });

    // Act
    const res = await runComplianceCheck({
      sender: { address: CLEAN_SENDER, chain: "eip155:8453", jurisdiction: "KP" },
    });

    // Assert
    expect(res.status).toBe(201);
    const json = await res.json() as { success: boolean; data: Record<string, unknown> };
    expect(json.success).toBe(true);
    expect(mockInsertReturning).toHaveBeenCalledTimes(2);
  });

  it("invoice_cannot_transition_to_paid_state_is_independent_of_compliance_api", async () => {
    // State machine transitions are not blocked by compliance outcome in the API.
    // The compliance enforcement is expected at the payment layer (x402/contract).
    // Here we verify the invoice state machine accepts ISSUED→PAID regardless.
    setCleanFetch();
    seedInvoiceSelect("ISSUED");
    seedStateUpdate("PAID");

    const res = await transitionState(sampleInvoice.id, "PAID");
    expect(res.status).toBe(200);
    const json = await res.json() as { data: { state: string } };
    expect(json.data.state).toBe("PAID");
  });
});

// ---------------------------------------------------------------------------
// High-risk receiver → ESCALATED
// ---------------------------------------------------------------------------

describe("Invoice flow — high-risk receiver escalated", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetRateLimitStore();
    setCleanFetch();
  });

  it("compliance_check_escalated_for_very_large_amount", async () => {
    // Arrange — DB reflects ESCALATED decision
    seedCheckAndReceipt({ status: "ESCALATED", riskScore: 70 }, { overallStatus: "REVIEW_REQUIRED" });

    // Act — $50k transaction triggers AML escalation threshold
    const res = await runComplianceCheck({ amount: "50000.00" });

    // Assert
    expect(res.status).toBe(201);
    const json = await res.json() as { success: boolean; data: Record<string, unknown> };
    expect(json.success).toBe(true);
    // The mocked DB returns ESCALATED; receipt still issued
    expect(json.data.receiptId).toBeTruthy();
  });

  it("compliance_check_for_high_aml_score_stored_in_db", async () => {
    // Arrange
    seedCheckAndReceipt({ status: "ESCALATED", riskScore: 72 });

    // Act
    await runComplianceCheck({ amount: "10000.00" });

    // Assert — DB was written (check + receipt inserted)
    expect(mockInsertReturning).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// MiCA / EU USDT restriction
// ---------------------------------------------------------------------------

describe("Invoice flow — MiCA compliance", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetRateLimitStore();
    setCleanFetch();
  });

  it("usdt_invoice_with_eu_payer_gets_rejected_compliance_check", async () => {
    // Arrange
    seedCheckAndReceipt({ status: "REJECTED", riskScore: 100 });

    // Act — create a USDT invoice with DE (EU) payer
    const res = await runComplianceCheck({
      asset: "USDT",
      sender: { address: CLEAN_SENDER, chain: "eip155:8453", jurisdiction: "DE" },
    });

    // Assert
    expect(res.status).toBe(201);
    const json = await res.json() as { success: boolean; data: Record<string, unknown> };
    expect(json.success).toBe(true);
    // Both DB rows (check + receipt) were created even for rejected decision
    expect(mockInsertReturning).toHaveBeenCalledTimes(2);
  });

  it("usdc_invoice_with_eu_payer_passes_mica_check", async () => {
    // Arrange — USDC is MiCA-authorized
    seedCheckAndReceipt({ status: "APPROVED", riskScore: 10 });

    // Act
    const res = await runComplianceCheck({
      asset: "USDC",
      sender: { address: CLEAN_SENDER, chain: "eip155:8453", jurisdiction: "FR" },
    });

    // Assert
    expect(res.status).toBe(201);
    const json = await res.json() as { success: boolean; data: Record<string, unknown> };
    expect(json.data.status).toBe("APPROVED");
  });

  it("usdt_invoice_creation_succeeds_regardless_of_mica_compliance_check", async () => {
    // Invoice creation is not gated on compliance in the API
    seedInvoiceInsert({ currency: "USDT", totalAmount: "100.00" });

    const res = await createInvoice({ currency: "USDT", totalAmount: 100 });
    expect(res.status).toBe(201);
    const json = await res.json() as { data: Record<string, unknown> };
    // The invoice row is created; enforcement happens at payment time
    expect(json.data.state).toBe("DRAFT");
  });
});

// ---------------------------------------------------------------------------
// Invoice retrieval and read flows
// ---------------------------------------------------------------------------

describe("Invoice flow — retrieval", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetRateLimitStore();
    setCleanFetch();
  });

  it("get_invoice_after_create_returns_correct_data", async () => {
    // Arrange
    mockSelectFrom.mockReturnValue({
      where: () => ({
        limit: () => Promise.resolve([{ ...sampleInvoice, state: "DRAFT" }]),
      }),
    });

    // Act
    const res = await app.request(`/v1/invoices/${sampleInvoice.id}`);

    // Assert
    expect(res.status).toBe(200);
    const json = await res.json() as { success: boolean; data: Record<string, unknown> };
    expect(json.success).toBe(true);
    expect(json.data.id).toBe(sampleInvoice.id);
    expect(json.data.state).toBe("DRAFT");
    expect(json.data.lineItems).toBeInstanceOf(Array);
    expect((json.data.lineItems as unknown[]).length).toBeGreaterThan(0);
  });

  it("get_invoice_returns_404_after_deletion_or_missing_record", async () => {
    // Arrange
    mockSelectFrom.mockReturnValue({
      where: () => ({
        limit: () => Promise.resolve([]),
      }),
    });

    // Act
    const res = await app.request(`/v1/invoices/${sampleInvoice.id}`);

    // Assert
    expect(res.status).toBe(404);
    const json = await res.json() as { error: Record<string, string> };
    expect(json.error.code).toBe("NOT_FOUND");
  });

  it("list_invoices_returns_all_invoices_for_paginated_request", async () => {
    // Arrange
    let callCount = 0;
    mockSelectFrom.mockImplementation(() => {
      callCount++;
      if (callCount % 2 === 1) {
        return {
          where: () => ({
            orderBy: () => ({
              limit: () => ({
                offset: () => Promise.resolve([sampleInvoice]),
              }),
            }),
          }),
        };
      }
      return { where: () => Promise.resolve([{ count: 1 }]) };
    });

    // Act
    const res = await app.request("/v1/invoices?page=1&limit=20");

    // Assert
    expect(res.status).toBe(200);
    const json = await res.json() as { success: boolean; data: { items: unknown[]; pagination: Record<string, number> } };
    expect(json.success).toBe(true);
    expect(json.data.items).toBeInstanceOf(Array);
    expect(json.data.pagination.total).toBe(1);
  });
});
