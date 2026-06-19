/**
 * Integration tests: Full invoice lifecycle (apps/api)
 *
 * Tests the complete invoice state machine:
 *   DRAFT → ISSUED → PAID → SETTLED
 *   DRAFT → ISSUED → DISPUTED → ISSUED → CANCELLED
 *   Invalid transitions → 422
 *
 * DB layer is mocked. All state machine logic (STATE_TRANSITIONS) is real
 * (enforced by the route handler).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { createApp } from "../../apps/api/src/app.js";
import { resetRateLimitStore } from "../../apps/api/src/middleware/rate-limit.js";
import {
  mockInsertReturning,
  mockSelectFrom,
  mockUpdateReturning,
  sampleInvoice,
} from "./setup.js";

// ---------------------------------------------------------------------------
// DB mock
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const app = createApp();

const INVOICE_ID = sampleInvoice.id;

async function createInvoice() {
  mockInsertReturning.mockResolvedValueOnce([sampleInvoice]);
  const res = await app.request("/api/v1/invoices", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      seller: { walletAddress: "0xSELLER000000000000000000000000000000000" },
      buyer: { walletAddress: "0xBUYER0000000000000000000000000000000000" },
      lineItems: [{ description: "Service", quantity: 1, unitPrice: 100, total: 100 }],
      currency: "USDC",
      totalAmount: 100,
    }),
  });
  return res;
}

function mockInvoiceWithState(state: string) {
  mockSelectFrom.mockReturnValueOnce({
    where: () => ({
      limit: () => Promise.resolve([{ ...sampleInvoice, state }]),
    }),
  });
}

function mockStateUpdate(newState: string) {
  mockUpdateReturning.mockResolvedValueOnce([{ ...sampleInvoice, state: newState }]);
}

async function transitionState(invoiceId: string, state: string) {
  return app.request(`/api/v1/invoices/${invoiceId}/state`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ state }),
  });
}

// ---------------------------------------------------------------------------
// Invoice creation
// ---------------------------------------------------------------------------

describe("Invoice lifecycle — creation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetRateLimitStore();
  });

  it("create_invoice_initial_state_is_draft", async () => {
    // Arrange + Act
    const res = await createInvoice();

    // Assert
    expect(res.status).toBe(201);
    const json = await res.json() as { success: boolean; data: { state: string } };
    expect(json.success).toBe(true);
    expect(json.data.state).toBe("DRAFT");
  });

  it("created_invoice_has_required_fields", async () => {
    // Arrange + Act
    const res = await createInvoice();

    // Assert
    const json = await res.json() as { success: boolean; data: Record<string, unknown> };
    expect(json.data.id).toBeTruthy();
    expect(json.data.currency).toBe("USDC");
    expect(json.data.lineItems).toBeInstanceOf(Array);
    expect(json.data.createdAt).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Valid state transitions
// ---------------------------------------------------------------------------

describe("Invoice lifecycle — valid transitions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetRateLimitStore();
  });

  it("draft_transitions_to_issued", async () => {
    // Arrange
    mockInvoiceWithState("DRAFT");
    mockStateUpdate("ISSUED");

    // Act
    const res = await transitionState(INVOICE_ID, "ISSUED");

    // Assert
    expect(res.status).toBe(200);
    const json = await res.json() as { success: boolean; data: { state: string } };
    expect(json.data.state).toBe("ISSUED");
  });

  it("issued_transitions_to_paid", async () => {
    // Arrange
    mockInvoiceWithState("ISSUED");
    mockStateUpdate("PAID");

    // Act
    const res = await transitionState(INVOICE_ID, "PAID");

    // Assert
    expect(res.status).toBe(200);
    const json = await res.json() as { success: boolean; data: { state: string } };
    expect(json.data.state).toBe("PAID");
  });

  it("paid_transitions_to_settled", async () => {
    // Arrange
    mockInvoiceWithState("PAID");
    mockStateUpdate("SETTLED");

    // Act
    const res = await transitionState(INVOICE_ID, "SETTLED");

    // Assert
    expect(res.status).toBe(200);
    const json = await res.json() as { success: boolean; data: { state: string } };
    expect(json.data.state).toBe("SETTLED");
  });

  it("issued_transitions_to_disputed", async () => {
    // Arrange
    mockInvoiceWithState("ISSUED");
    mockStateUpdate("DISPUTED");

    // Act
    const res = await transitionState(INVOICE_ID, "DISPUTED");

    // Assert
    expect(res.status).toBe(200);
    const json = await res.json() as { success: boolean; data: { state: string } };
    expect(json.data.state).toBe("DISPUTED");
  });

  it("disputed_transitions_back_to_issued", async () => {
    // Arrange
    mockInvoiceWithState("DISPUTED");
    mockStateUpdate("ISSUED");

    // Act
    const res = await transitionState(INVOICE_ID, "ISSUED");

    // Assert
    expect(res.status).toBe(200);
    const json = await res.json() as { success: boolean; data: { state: string } };
    expect(json.data.state).toBe("ISSUED");
  });

  it("draft_transitions_to_cancelled", async () => {
    // Arrange
    mockInvoiceWithState("DRAFT");
    mockStateUpdate("CANCELLED");

    // Act
    const res = await transitionState(INVOICE_ID, "CANCELLED");

    // Assert
    expect(res.status).toBe(200);
    const json = await res.json() as { success: boolean; data: { state: string } };
    expect(json.data.state).toBe("CANCELLED");
  });

  it("issued_transitions_to_cancelled", async () => {
    // Arrange
    mockInvoiceWithState("ISSUED");
    mockStateUpdate("CANCELLED");

    // Act
    const res = await transitionState(INVOICE_ID, "CANCELLED");

    // Assert
    expect(res.status).toBe(200);
    const json = await res.json() as { success: boolean; data: { state: string } };
    expect(json.data.state).toBe("CANCELLED");
  });

  it("paid_transitions_to_disputed", async () => {
    // Arrange
    mockInvoiceWithState("PAID");
    mockStateUpdate("DISPUTED");

    // Act
    const res = await transitionState(INVOICE_ID, "DISPUTED");

    // Assert
    expect(res.status).toBe(200);
    const json = await res.json() as { success: boolean; data: { state: string } };
    expect(json.data.state).toBe("DISPUTED");
  });
});

// ---------------------------------------------------------------------------
// Invalid state transitions (422)
// ---------------------------------------------------------------------------

describe("Invoice lifecycle — invalid transitions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetRateLimitStore();
  });

  const invalidTransitions: Array<[string, string]> = [
    ["DRAFT", "PAID"],
    ["DRAFT", "SETTLED"],
    ["DRAFT", "DISPUTED"],
    ["ISSUED", "DRAFT"],
    ["PAID", "DRAFT"],
    ["PAID", "ISSUED"],
    ["PAID", "CANCELLED"],
    ["SETTLED", "DRAFT"],
    ["SETTLED", "ISSUED"],
    ["SETTLED", "PAID"],
    ["SETTLED", "DISPUTED"],
    ["SETTLED", "CANCELLED"],
    ["CANCELLED", "DRAFT"],
    ["CANCELLED", "ISSUED"],
    ["CANCELLED", "PAID"],
    ["CANCELLED", "SETTLED"],
    ["CANCELLED", "DISPUTED"],
  ];

  for (const [from, to] of invalidTransitions) {
    it(`invalid_transition_from_${from}_to_${to}_returns_422`, async () => {
      // Arrange
      mockInvoiceWithState(from);

      // Act
      const res = await transitionState(INVOICE_ID, to);

      // Assert
      expect(res.status).toBe(422);
      const json = await res.json() as { success: boolean; error: Record<string, string> };
      expect(json.success).toBe(false);
      expect(json.error.code).toBe("INVALID_STATE_TRANSITION");
      expect(json.error.message).toContain(from);
      expect(json.error.message).toContain(to);
    });
  }
});

// ---------------------------------------------------------------------------
// Terminal states
// ---------------------------------------------------------------------------

describe("Invoice lifecycle — terminal states", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetRateLimitStore();
  });

  it("settled_invoice_has_no_allowed_transitions", async () => {
    // Arrange
    mockInvoiceWithState("SETTLED");

    // Act — try to move SETTLED → CANCELLED (not allowed)
    const res = await transitionState(INVOICE_ID, "CANCELLED");

    // Assert
    expect(res.status).toBe(422);
    const json = await res.json() as { success: boolean; error: Record<string, string> };
    expect(json.error.message).toContain("none");
  });

  it("cancelled_invoice_has_no_allowed_transitions", async () => {
    // Arrange
    mockInvoiceWithState("CANCELLED");

    // Act
    const res = await transitionState(INVOICE_ID, "ISSUED");

    // Assert
    expect(res.status).toBe(422);
    const json = await res.json() as { success: boolean; error: Record<string, string> };
    expect(json.error.message).toContain("none");
  });
});

// ---------------------------------------------------------------------------
// Full happy-path lifecycle
// ---------------------------------------------------------------------------

describe("Invoice lifecycle — full happy-path sequence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetRateLimitStore();
  });

  it("invoice_goes_through_full_lifecycle_draft_issued_paid_settled", async () => {
    // Arrange + Act: STEP 1 — Create → DRAFT
    mockInsertReturning.mockResolvedValueOnce([{ ...sampleInvoice, state: "DRAFT" }]);
    const createRes = await app.request("/api/v1/invoices", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        seller: { walletAddress: "0xSELLER000000000000000000000000000000000" },
        buyer: { walletAddress: "0xBUYER0000000000000000000000000000000000" },
        lineItems: [{ description: "Compute", quantity: 10, unitPrice: 10, total: 100 }],
        currency: "USDC",
        totalAmount: 100,
        paymentProtocol: "x402",
      }),
    });
    expect(createRes.status).toBe(201);
    const created = await createRes.json() as { data: { id: string; state: string } };
    expect(created.data.state).toBe("DRAFT");

    // STEP 2 — Issue
    mockInvoiceWithState("DRAFT");
    mockStateUpdate("ISSUED");
    const issueRes = await transitionState(created.data.id, "ISSUED");
    expect(issueRes.status).toBe(200);
    const issued = await issueRes.json() as { data: { state: string } };
    expect(issued.data.state).toBe("ISSUED");

    // STEP 3 — Pay
    mockInvoiceWithState("ISSUED");
    mockStateUpdate("PAID");
    const payRes = await transitionState(created.data.id, "PAID");
    expect(payRes.status).toBe(200);
    const paid = await payRes.json() as { data: { state: string } };
    expect(paid.data.state).toBe("PAID");

    // STEP 4 — Settle
    mockInvoiceWithState("PAID");
    mockStateUpdate("SETTLED");
    const settleRes = await transitionState(created.data.id, "SETTLED");
    expect(settleRes.status).toBe(200);
    const settled = await settleRes.json() as { data: { state: string } };
    expect(settled.data.state).toBe("SETTLED");
  });

  it("invoice_can_be_disputed_and_then_cancelled", async () => {
    // Arrange + Act: Create → ISSUED → DISPUTED → CANCELLED

    // ISSUED state
    mockInvoiceWithState("ISSUED");
    mockStateUpdate("DISPUTED");
    const disputeRes = await transitionState(INVOICE_ID, "DISPUTED");
    expect(disputeRes.status).toBe(200);
    const disputed = await disputeRes.json() as { data: { state: string } };
    expect(disputed.data.state).toBe("DISPUTED");

    // CANCELLED from DISPUTED
    mockInvoiceWithState("DISPUTED");
    mockStateUpdate("CANCELLED");
    const cancelRes = await transitionState(INVOICE_ID, "CANCELLED");
    expect(cancelRes.status).toBe(200);
    const cancelled = await cancelRes.json() as { data: { state: string } };
    expect(cancelled.data.state).toBe("CANCELLED");
  });
});
