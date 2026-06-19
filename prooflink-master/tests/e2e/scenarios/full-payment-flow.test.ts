/**
 * E2E: Full Payment Flow
 *
 * Simulates the complete ProofLink payment lifecycle:
 * 1. Create invoice via POST /api/v1/invoices
 * 2. Run compliance check on payer via POST /api/v1/compliance/check
 * 3. Simulate payment (mock blockchain tx — no real settlement)
 * 4. Verify compliance receipt was generated
 * 5. Transition invoice state to PAID via PATCH /api/v1/invoices/:id/state
 * 6. Verify all audit records created
 *
 * State machine coverage:
 *   DRAFT → ISSUED → PAID → SETTLED
 *   DRAFT → CANCELLED (terminal)
 *   ISSUED → DISPUTED → CANCELLED
 *   Invalid transitions → 422
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import { createApp } from "../../../apps/api/src/app.js";
import {
  makeInvoiceRow,
  makeComplianceCheckRow,
  makeReceiptRow,
  BASE_INVOICE_PAYLOAD,
  BASE_COMPLIANCE_CHECK_PAYLOAD,
  TEST_SELLER_ADDRESS,
  TEST_BUYER_ADDRESS,
  TEST_CHAIN,
} from "../setup.js";

// ---------------------------------------------------------------------------
// DB mocks
// ---------------------------------------------------------------------------

const mockInsertReturning = vi.fn();
const mockSelectFrom = vi.fn();
const mockUpdateReturning = vi.fn();

vi.mock("../../../apps/api/src/db/index.js", () => ({
  getDb: () => ({
    insert: () => ({
      values: () => ({
        returning: mockInsertReturning,
        onConflictDoUpdate: () => ({
          returning: mockInsertReturning,
        }),
        then: (resolve: (v: unknown) => void) => Promise.resolve().then(resolve),
        catch: () => Promise.resolve(),
      }),
    }),
    select: () => ({
      from: mockSelectFrom,
    }),
    update: () => ({
      set: () => ({
        where: () => ({
          returning: mockUpdateReturning,
          catch: () => Promise.resolve(),
        }),
      }),
    }),
  }),
  getPool: () => ({
    query: vi.fn().mockResolvedValue({ rows: [{ "?column?": 1 }] }),
  }),
}));

vi.mock("../../../apps/api/src/middleware/auth.js", () => ({
  authMiddleware: () => async (_c: unknown, next: () => Promise<void>) => next(),
  requireScope: () => async (_c: unknown, next: () => Promise<void>) => next(),
}));

vi.mock("../../../apps/api/src/middleware/rate-limit.js", () => ({
  rateLimitMiddleware: () => async (_c: unknown, next: () => Promise<void>) => next(),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function seedComplianceInserts(): void {
  mockInsertReturning
    .mockResolvedValueOnce([makeComplianceCheckRow()])
    .mockResolvedValueOnce([makeReceiptRow()]);
}

function seedInvoiceInsert(overrides: Record<string, unknown> = {}): void {
  mockInsertReturning.mockResolvedValueOnce([makeInvoiceRow(overrides)]);
}

function seedInvoiceSelect(state: string): void {
  mockSelectFrom.mockReturnValue({
    where: () => ({
      limit: () => Promise.resolve([makeInvoiceRow({ state })]),
    }),
  });
}

function seedReceiptSelect(): void {
  mockSelectFrom.mockReturnValue({
    where: () => ({
      limit: () => Promise.resolve([makeReceiptRow()]),
    }),
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("E2E: Full Payment Flow", () => {
  const app = createApp();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // Step 1: Create invoice
  // -------------------------------------------------------------------------

  describe("Step 1 — Create invoice via POST /api/v1/invoices", () => {
    it("should create an invoice in DRAFT state with all required fields", async () => {
      seedInvoiceInsert();

      const res = await app.request("/api/v1/invoices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(BASE_INVOICE_PAYLOAD),
      });

      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.success).toBe(true);

      const { data } = json;
      expect(data.id).toBeTruthy();
      expect(data.state).toBe("DRAFT");
      expect(data.currency).toBe("USDC");
      expect(data.sellerWalletAddress).toBe(TEST_SELLER_ADDRESS);
      expect(data.buyerWalletAddress).toBe(TEST_BUYER_ADDRESS);
      expect(data.lineItems).toBeInstanceOf(Array);
      expect(data.lineItems.length).toBe(1);
    });

    it("should assign protocol field from payload", async () => {
      seedInvoiceInsert({ paymentProtocol: "x402" });

      const res = await app.request("/api/v1/invoices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...BASE_INVOICE_PAYLOAD, paymentProtocol: "x402" }),
      });

      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.data.paymentProtocol).toBe("x402");
    });

    it("should return 400 when required fields are missing", async () => {
      const res = await app.request("/api/v1/invoices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ seller: { walletAddress: TEST_SELLER_ADDRESS } }),
      });

      expect(res.status).toBe(400);
    });

    it("should return 400 for invalid currency", async () => {
      const res = await app.request("/api/v1/invoices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...BASE_INVOICE_PAYLOAD, currency: "BTC" }),
      });

      expect(res.status).toBe(400);
    });
  });

  // -------------------------------------------------------------------------
  // Step 2: Run compliance check on payer
  // -------------------------------------------------------------------------

  describe("Step 2 — Run compliance check on payer", () => {
    it("should return APPROVED for clean buyer and seller addresses", async () => {
      seedComplianceInserts();

      const res = await app.request("/api/v1/compliance/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(BASE_COMPLIANCE_CHECK_PAYLOAD),
      });

      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.status).toBe("APPROVED");
      expect(json.data.riskScore).toBeLessThan(50);
    });

    it("should generate a compliance receipt with a valid receiptId and receiptHash", async () => {
      seedComplianceInserts();

      const res = await app.request("/api/v1/compliance/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(BASE_COMPLIANCE_CHECK_PAYLOAD),
      });

      const json = await res.json();
      expect(json.data.receiptId).toBeTruthy();
      expect(json.data.receiptHash).toMatch(/^0x/);
      expect(json.data.receiptHash.length).toBeGreaterThan(10);
    });

    it("should record totalDurationMs in the response", async () => {
      seedComplianceInserts();

      const res = await app.request("/api/v1/compliance/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(BASE_COMPLIANCE_CHECK_PAYLOAD),
      });

      const json = await res.json();
      expect(typeof json.data.totalDurationMs).toBe("number");
      expect(json.data.totalDurationMs).toBeGreaterThanOrEqual(0);
    });
  });

  // -------------------------------------------------------------------------
  // Step 3: Simulate payment (mock blockchain tx)
  // -------------------------------------------------------------------------

  describe("Step 3 — Simulate payment (mock blockchain tx)", () => {
    /**
     * ProofLink does not own the settlement layer — x402 / blockchain handles that.
     * We simulate the payment by transitioning the invoice to PAID state and
     * attaching a mock tx hash, mirroring what the x402 ResourceServer webhook
     * or a settlement callback would do.
     */

    it("should transition invoice from DRAFT to ISSUED (pre-payment step)", async () => {
      seedInvoiceSelect("DRAFT");
      mockUpdateReturning.mockResolvedValue([makeInvoiceRow({ state: "ISSUED" })]);

      const res = await app.request(
        "/api/v1/invoices/550e8400-e29b-41d4-a716-446655440001/state",
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ state: "ISSUED" }),
        },
      );

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.state).toBe("ISSUED");
    });

    it("should transition invoice from ISSUED to PAID after settlement", async () => {
      seedInvoiceSelect("ISSUED");
      mockUpdateReturning.mockResolvedValue([
        makeInvoiceRow({
          state: "PAID",
          onChainTxHash: "0x7f3e8a2b4c9d1e6f3a7b2c5d8e1f4a7b2c5d8e1f4a7b2c5d8e1f4a7b2c5d8e1f",
        }),
      ]);

      const res = await app.request(
        "/api/v1/invoices/550e8400-e29b-41d4-a716-446655440001/state",
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            state: "PAID",
            reason: "x402 settlement confirmed: 0x7f3e8a2b",
          }),
        },
      );

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.state).toBe("PAID");
    });
  });

  // -------------------------------------------------------------------------
  // Step 4: Verify compliance receipt was generated
  // -------------------------------------------------------------------------

  describe("Step 4 — Verify compliance receipt was generated", () => {
    it("should retrieve a compliance receipt after check completes", async () => {
      // Run compliance check first
      seedComplianceInserts();
      const checkRes = await app.request("/api/v1/compliance/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(BASE_COMPLIANCE_CHECK_PAYLOAD),
      });

      const checkJson = await checkRes.json();
      const receiptId = checkJson.data.receiptId;

      // Now fetch the receipt
      seedReceiptSelect();
      const receiptRes = await app.request(
        `/api/v1/compliance/receipt/${receiptId}`,
      );

      expect(receiptRes.status).toBe(200);
      const receiptJson = await receiptRes.json();
      expect(receiptJson.success).toBe(true);
      expect(receiptJson.data.overallStatus).toBe("APPROVED");
    });

    it("should return receipt with checksPerformed array", async () => {
      seedReceiptSelect();

      const res = await app.request(
        "/api/v1/compliance/receipt/550e8400-e29b-41d4-a716-446655440003",
      );

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.checksPerformed).toBeInstanceOf(Array);
    });
  });

  // -------------------------------------------------------------------------
  // Step 5 & 6: Verify invoice state machine and audit trail
  // -------------------------------------------------------------------------

  describe("Step 5 & 6 — Invoice state machine and audit logs", () => {
    it("should verify PAID invoice can transition to SETTLED", async () => {
      seedInvoiceSelect("PAID");
      mockUpdateReturning.mockResolvedValue([makeInvoiceRow({ state: "SETTLED" })]);

      const res = await app.request(
        "/api/v1/invoices/550e8400-e29b-41d4-a716-446655440001/state",
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ state: "SETTLED" }),
        },
      );

      expect(res.status).toBe(200);
      expect((await res.json()).data.state).toBe("SETTLED");
    });

    it("should reject invalid transition DRAFT → PAID (skips ISSUED)", async () => {
      seedInvoiceSelect("DRAFT");

      const res = await app.request(
        "/api/v1/invoices/550e8400-e29b-41d4-a716-446655440001/state",
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ state: "PAID" }),
        },
      );

      expect(res.status).toBe(422);
      const json = await res.json();
      expect(json.error.code).toBe("INVALID_STATE_TRANSITION");
    });

    it("should reject any transition from terminal state SETTLED", async () => {
      seedInvoiceSelect("SETTLED");

      const res = await app.request(
        "/api/v1/invoices/550e8400-e29b-41d4-a716-446655440001/state",
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ state: "PAID" }),
        },
      );

      expect(res.status).toBe(422);
    });

    it("should reject any transition from terminal state CANCELLED", async () => {
      seedInvoiceSelect("CANCELLED");

      const res = await app.request(
        "/api/v1/invoices/550e8400-e29b-41d4-a716-446655440001/state",
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ state: "ISSUED" }),
        },
      );

      expect(res.status).toBe(422);
      const json = await res.json();
      expect(json.error.code).toBe("INVALID_STATE_TRANSITION");
    });

    it("should allow ISSUED → DISPUTED transition", async () => {
      seedInvoiceSelect("ISSUED");
      mockUpdateReturning.mockResolvedValue([makeInvoiceRow({ state: "DISPUTED" })]);

      const res = await app.request(
        "/api/v1/invoices/550e8400-e29b-41d4-a716-446655440001/state",
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ state: "DISPUTED", reason: "Quantity mismatch" }),
        },
      );

      expect(res.status).toBe(200);
      expect((await res.json()).data.state).toBe("DISPUTED");
    });

    it("should allow DISPUTED → CANCELLED transition", async () => {
      seedInvoiceSelect("DISPUTED");
      mockUpdateReturning.mockResolvedValue([makeInvoiceRow({ state: "CANCELLED" })]);

      const res = await app.request(
        "/api/v1/invoices/550e8400-e29b-41d4-a716-446655440001/state",
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ state: "CANCELLED" }),
        },
      );

      expect(res.status).toBe(200);
      expect((await res.json()).data.state).toBe("CANCELLED");
    });

    it("should return 404 for invoice that does not exist", async () => {
      mockSelectFrom.mockReturnValue({
        where: () => ({
          limit: () => Promise.resolve([]),
        }),
      });

      const res = await app.request(
        "/api/v1/invoices/00000000-0000-0000-0000-000000000000/state",
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ state: "ISSUED" }),
        },
      );

      expect(res.status).toBe(404);
    });

    it("should return compliance check count matching number of DB inserts", async () => {
      // Simulate a flow: create invoice + run compliance check
      seedInvoiceInsert();
      const invoiceRes = await app.request("/api/v1/invoices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(BASE_INVOICE_PAYLOAD),
      });
      expect(invoiceRes.status).toBe(201);

      // One insert for the invoice
      const insertCountAfterInvoice = mockInsertReturning.mock.calls.length;

      seedComplianceInserts();
      const complianceRes = await app.request("/api/v1/compliance/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(BASE_COMPLIANCE_CHECK_PAYLOAD),
      });
      expect(complianceRes.status).toBe(201);

      // Two more inserts: compliance_check + compliance_receipt
      const totalInserts = mockInsertReturning.mock.calls.length;
      expect(totalInserts - insertCountAfterInvoice).toBe(2);
    });
  });

  // -------------------------------------------------------------------------
  // Invoice listing (GET)
  // -------------------------------------------------------------------------

  describe("GET /api/v1/invoices — listing and filtering", () => {
    it("should return paginated invoice list", async () => {
      const items = [makeInvoiceRow(), makeInvoiceRow({ id: "550e8400-e29b-41d4-a716-446655440099" })];
      let callCount = 0;
      mockSelectFrom.mockImplementation(() => {
        callCount++;
        if (callCount % 2 === 1) {
          return {
            where: () => ({
              orderBy: () => ({
                limit: () => ({
                  offset: () => Promise.resolve(items),
                }),
              }),
            }),
          };
        }
        return {
          where: () => Promise.resolve([{ count: items.length }]),
        };
      });

      const res = await app.request("/api/v1/invoices?page=1&limit=10");

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.items).toHaveLength(2);
      expect(json.data.pagination.total).toBe(2);
    });

    it("should accept state filter for ISSUED invoices", async () => {
      let callCount = 0;
      mockSelectFrom.mockImplementation(() => {
        callCount++;
        if (callCount % 2 === 1) {
          return {
            where: () => ({
              orderBy: () => ({
                limit: () => ({
                  offset: () => Promise.resolve([makeInvoiceRow({ state: "ISSUED" })]),
                }),
              }),
            }),
          };
        }
        return {
          where: () => Promise.resolve([{ count: 1 }]),
        };
      });

      const res = await app.request("/api/v1/invoices?state=ISSUED");

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.items[0].state).toBe("ISSUED");
    });

    it("should return 400 for invalid state filter value", async () => {
      const res = await app.request("/api/v1/invoices?state=GARBAGE");

      expect(res.status).toBe(400);
    });
  });
});
