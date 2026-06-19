/**
 * E2E: Escrow Lifecycle
 *
 * Tests the full escrow state machine through the API at /api/v1/escrow:
 *   CREATED → FUNDED → ACTIVE → COMPLETED (happy path)
 *   ACTIVE → DISPUTED → REFUNDED
 *   Invalid transitions → 422
 *   Expired escrow → cannot complete
 *   Sanctioned wallet → 403
 *
 * DB layer is fully mocked — no Postgres required.
 * The screening service is mocked to avoid real HTTP calls.
 *
 * Route: apps/api/src/routes/escrow.ts
 * Service: apps/api/src/services/escrow.ts
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import { createApp } from "../../../apps/api/src/app.js";
import {
  TEST_SELLER_ADDRESS,
  TEST_BUYER_ADDRESS,
} from "../setup.js";

// ---------------------------------------------------------------------------
// DB mock
// ---------------------------------------------------------------------------

const mockInsertReturning = vi.fn();
const mockSelectFrom = vi.fn();
const mockUpdateReturning = vi.fn();

vi.mock("../../../apps/api/src/db/index.js", () => ({
  getDb: () => ({
    insert: () => ({
      values: () => ({
        returning: mockInsertReturning,
        onConflictDoUpdate: () => ({ returning: mockInsertReturning }),
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

vi.mock("../../../apps/api/src/routes/ws.js", async () => {
  const mod = await import("../../../apps/api/src/routes/ws.js");
  return { ...mod, broadcastWsEvent: vi.fn() };
});

// ---------------------------------------------------------------------------
// Mock screening service
// ---------------------------------------------------------------------------

const mockScreenAddress = vi.fn();

vi.mock("../../../apps/api/src/services/screening.js", () => ({
  screenAddress: (...args: unknown[]) => mockScreenAddress(...args),
  getScreener: vi.fn(),
  resetScreener: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const TEST_ESCROW_ID = "550e8400-e29b-41d4-a716-446655440010";
const FUTURE_DATE = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
const PAST_DATE = new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString();

function makeEscrowRow(overrides: Record<string, unknown> = {}) {
  return {
    id: TEST_ESCROW_ID,
    escrowType: "SERVICE",
    state: "CREATED",
    payerAgentDid: "did:prooflink:agent:payer-001",
    payeeAgentDid: "did:prooflink:agent:payee-001",
    payerWallet: TEST_BUYER_ADDRESS,
    payeeWallet: TEST_SELLER_ADDRESS,
    amount: "500.00",
    asset: "USDC",
    chain: "eip155:8453",
    conditions: { deliverable: "API integration" },
    evaluatorAddress: null,
    complianceReceiptId: null,
    traceId: null,
    expiresAt: new Date(FUTURE_DATE),
    fundedAt: null,
    completedAt: null,
    disputedAt: null,
    createdAt: new Date("2026-03-20T12:00:00Z"),
    updatedAt: new Date("2026-03-20T12:00:00Z"),
    ...overrides,
  };
}

const BASE_CREATE_ESCROW = {
  escrowType: "SERVICE",
  payerAgentDid: "did:prooflink:agent:payer-001",
  payeeAgentDid: "did:prooflink:agent:payee-001",
  payerWallet: TEST_BUYER_ADDRESS,
  payeeWallet: TEST_SELLER_ADDRESS,
  amount: "500.00",
  asset: "USDC",
  chain: "eip155:8453",
  conditions: { deliverable: "API integration" },
  expiresAt: FUTURE_DATE,
};

const VALID_EVALUATOR_PROOF = {
  evaluator: "0xEvaluator1234567890abcdef1234567890abcd",
  signature: "0x" + "a".repeat(130),
  result: { approved: true, score: 95 },
  timestamp: new Date().toISOString(),
};

function seedCleanScreen() {
  mockScreenAddress.mockResolvedValue({
    matched: false,
    listsChecked: ["OFAC_SDN"],
    matchDetails: [],
    riskScore: 0,
    screenedAt: new Date().toISOString(),
    provider: "chainalysis_free",
  });
}

function seedSanctionedScreen() {
  mockScreenAddress.mockResolvedValue({
    matched: true,
    listsChecked: ["OFAC_SDN"],
    matchDetails: [{ list: "OFAC_SDN", name: "Tornado Cash" }],
    riskScore: 100,
    screenedAt: new Date().toISOString(),
    provider: "chainalysis_free",
  });
}

function seedAuditLogSelect() {
  mockSelectFrom.mockImplementation(() => ({
    where: () => ({
      limit: () => Promise.resolve([makeEscrowRow()]),
    }),
    orderBy: () => ({ limit: () => Promise.resolve([]) }),
  }));
}

function seedEscrowSelect(row: ReturnType<typeof makeEscrowRow> | null) {
  mockSelectFrom.mockImplementation(() => ({
    where: () => ({
      limit: () => Promise.resolve(row ? [row] : []),
    }),
    orderBy: () => ({ limit: () => Promise.resolve([]) }),
  }));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("E2E: Escrow Lifecycle", () => {
  const app = createApp();

  beforeEach(() => {
    vi.resetAllMocks();
    seedCleanScreen();
    seedAuditLogSelect();
  });

  // -------------------------------------------------------------------------
  // Create escrow
  // -------------------------------------------------------------------------

  describe("POST /api/v1/escrow — create escrow", () => {
    it("should create escrow and return CREATED state with generated ID", async () => {
      mockInsertReturning.mockResolvedValue([makeEscrowRow()]);

      const res = await app.request("/api/v1/escrow", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(BASE_CREATE_ESCROW),
      });

      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.id).toBeTruthy();
      expect(json.data.state).toBe("CREATED");
      expect(json.data.escrowType).toBe("SERVICE");
      expect(json.data.payerWallet).toBe(TEST_BUYER_ADDRESS);
      expect(json.data.payeeWallet).toBe(TEST_SELLER_ADDRESS);
    });

    it("should include all submitted fields in the response", async () => {
      mockInsertReturning.mockResolvedValue([makeEscrowRow({ amount: "1000.00", asset: "USDT" })]);

      const res = await app.request("/api/v1/escrow", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...BASE_CREATE_ESCROW, amount: "1000.00", asset: "USDT" }),
      });

      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.data.asset).toBe("USDT");
      expect(json.data.amount).toBe("1000.00");
    });

    it("should return 400 when required fields are missing", async () => {
      const res = await app.request("/api/v1/escrow", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ escrowType: "SERVICE", amount: "100.00" }),
      });

      expect(res.status).toBe(400);
    });

    it("should return 400 for invalid escrowType", async () => {
      const res = await app.request("/api/v1/escrow", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...BASE_CREATE_ESCROW, escrowType: "INVALID" }),
      });

      expect(res.status).toBe(400);
    });

    it("should return 403 when payer wallet is sanctioned", async () => {
      seedSanctionedScreen();

      const res = await app.request("/api/v1/escrow", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(BASE_CREATE_ESCROW),
      });

      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.error.code).toBe("COMPLIANCE_FAILED");
    });

    it("should support optional traceId in the response", async () => {
      const traceId = "escrow-trace-create-001";
      mockInsertReturning.mockResolvedValue([makeEscrowRow({ traceId })]);

      const res = await app.request("/api/v1/escrow", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...BASE_CREATE_ESCROW, traceId }),
      });

      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.data.traceId).toBe(traceId);
    });
  });

  // -------------------------------------------------------------------------
  // Fund escrow: CREATED → FUNDED
  // -------------------------------------------------------------------------

  describe("POST /api/v1/escrow/:id/fund — fund escrow", () => {
    it("should transition CREATED → FUNDED", async () => {
      seedEscrowSelect(makeEscrowRow({ state: "CREATED" }));
      mockUpdateReturning.mockResolvedValue([makeEscrowRow({ state: "FUNDED", fundedAt: new Date() })]);

      const res = await app.request(`/api/v1/escrow/${TEST_ESCROW_ID}/fund`, {
        method: "POST",
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.state).toBe("FUNDED");
    });

    it("should return 404 when escrow does not exist", async () => {
      seedEscrowSelect(null);

      const res = await app.request(
        "/api/v1/escrow/00000000-0000-0000-0000-000000000000/fund",
        { method: "POST" },
      );

      expect(res.status).toBe(404);
      const json = await res.json();
      expect(json.error.code).toBe("NOT_FOUND");
    });

    it("should return 422 when trying to fund an already FUNDED escrow", async () => {
      seedEscrowSelect(makeEscrowRow({ state: "FUNDED" }));

      const res = await app.request(`/api/v1/escrow/${TEST_ESCROW_ID}/fund`, {
        method: "POST",
      });

      expect(res.status).toBe(422);
      const json = await res.json();
      expect(json.error.code).toBe("INVALID_STATE_TRANSITION");
    });
  });

  // -------------------------------------------------------------------------
  // Activate escrow: FUNDED → ACTIVE
  // -------------------------------------------------------------------------

  describe("POST /api/v1/escrow/:id/activate — activate escrow", () => {
    it("should transition FUNDED → ACTIVE", async () => {
      seedEscrowSelect(makeEscrowRow({ state: "FUNDED" }));
      mockUpdateReturning.mockResolvedValue([makeEscrowRow({ state: "ACTIVE" })]);

      const res = await app.request(`/api/v1/escrow/${TEST_ESCROW_ID}/activate`, {
        method: "POST",
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.state).toBe("ACTIVE");
    });

    it("should return 422 when trying to activate from CREATED (skips FUNDED)", async () => {
      seedEscrowSelect(makeEscrowRow({ state: "CREATED" }));

      const res = await app.request(`/api/v1/escrow/${TEST_ESCROW_ID}/activate`, {
        method: "POST",
      });

      expect(res.status).toBe(422);
      const json = await res.json();
      expect(json.error.code).toBe("INVALID_STATE_TRANSITION");
    });
  });

  // -------------------------------------------------------------------------
  // Complete escrow: ACTIVE → COMPLETED
  // -------------------------------------------------------------------------

  describe("POST /api/v1/escrow/:id/complete — complete with evaluator proof", () => {
    it("should transition ACTIVE → COMPLETED with valid evaluator proof", async () => {
      seedEscrowSelect(makeEscrowRow({ state: "ACTIVE" }));
      mockUpdateReturning.mockResolvedValue([
        makeEscrowRow({ state: "COMPLETED", completedAt: new Date() }),
      ]);

      const res = await app.request(`/api/v1/escrow/${TEST_ESCROW_ID}/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(VALID_EVALUATOR_PROOF),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.state).toBe("COMPLETED");
    });

    it("should return 403 when proof evaluator does not match registered evaluator", async () => {
      const registeredEvaluator = "0xRegistered00000000000000000000000000000001";
      const wrongEvaluator = "0xWrongEvaluator00000000000000000000000000";

      seedEscrowSelect(
        makeEscrowRow({ state: "ACTIVE", evaluatorAddress: registeredEvaluator }),
      );

      const res = await app.request(`/api/v1/escrow/${TEST_ESCROW_ID}/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...VALID_EVALUATOR_PROOF, evaluator: wrongEvaluator }),
      });

      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.error.code).toBe("COMPLIANCE_FAILED");
    });

    it("should return 422 when trying to complete from FUNDED state (not ACTIVE)", async () => {
      seedEscrowSelect(makeEscrowRow({ state: "FUNDED" }));

      const res = await app.request(`/api/v1/escrow/${TEST_ESCROW_ID}/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(VALID_EVALUATOR_PROOF),
      });

      expect(res.status).toBe(422);
      const json = await res.json();
      expect(json.error.code).toBe("INVALID_STATE_TRANSITION");
    });

    it("should return 400 when proof body is missing required fields", async () => {
      const res = await app.request(`/api/v1/escrow/${TEST_ESCROW_ID}/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ evaluator: "0xEval" }), // missing signature, result, timestamp
      });

      expect(res.status).toBe(400);
    });

    it("should accept proof evaluator matching registered evaluator (case-insensitive)", async () => {
      const registeredEvaluator = "0xEvaluator1234567890abcdef1234567890abcd";

      seedEscrowSelect(
        makeEscrowRow({ state: "ACTIVE", evaluatorAddress: registeredEvaluator.toLowerCase() }),
      );
      mockUpdateReturning.mockResolvedValue([
        makeEscrowRow({ state: "COMPLETED", completedAt: new Date() }),
      ]);

      const res = await app.request(`/api/v1/escrow/${TEST_ESCROW_ID}/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...VALID_EVALUATOR_PROOF,
          evaluator: registeredEvaluator, // uppercase vs lowercase stored
        }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.state).toBe("COMPLETED");
    });
  });

  // -------------------------------------------------------------------------
  // Dispute escrow: ACTIVE → DISPUTED
  // -------------------------------------------------------------------------

  describe("POST /api/v1/escrow/:id/dispute — dispute escrow", () => {
    it("should transition ACTIVE → DISPUTED with a reason", async () => {
      seedEscrowSelect(makeEscrowRow({ state: "ACTIVE" }));
      mockUpdateReturning.mockResolvedValue([
        makeEscrowRow({ state: "DISPUTED", disputedAt: new Date() }),
      ]);

      const res = await app.request(`/api/v1/escrow/${TEST_ESCROW_ID}/dispute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: "Deliverable not completed as agreed." }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.state).toBe("DISPUTED");
    });

    it("should return 400 when reason is missing", async () => {
      const res = await app.request(`/api/v1/escrow/${TEST_ESCROW_ID}/dispute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(400);
    });

    it("should return 422 when trying to dispute from COMPLETED (terminal) state", async () => {
      seedEscrowSelect(makeEscrowRow({ state: "COMPLETED" }));

      const res = await app.request(`/api/v1/escrow/${TEST_ESCROW_ID}/dispute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: "Disputed after completion." }),
      });

      expect(res.status).toBe(422);
      const json = await res.json();
      expect(json.error.code).toBe("INVALID_STATE_TRANSITION");
    });
  });

  // -------------------------------------------------------------------------
  // Refund escrow: DISPUTED → REFUNDED
  // -------------------------------------------------------------------------

  describe("POST /api/v1/escrow/:id/refund — refund after dispute", () => {
    it("should transition DISPUTED → REFUNDED", async () => {
      seedEscrowSelect(makeEscrowRow({ state: "DISPUTED" }));
      mockUpdateReturning.mockResolvedValue([makeEscrowRow({ state: "REFUNDED" })]);

      const res = await app.request(`/api/v1/escrow/${TEST_ESCROW_ID}/refund`, {
        method: "POST",
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.state).toBe("REFUNDED");
    });

    it("should transition EXPIRED → REFUNDED", async () => {
      seedEscrowSelect(makeEscrowRow({ state: "EXPIRED" }));
      mockUpdateReturning.mockResolvedValue([makeEscrowRow({ state: "REFUNDED" })]);

      const res = await app.request(`/api/v1/escrow/${TEST_ESCROW_ID}/refund`, {
        method: "POST",
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.state).toBe("REFUNDED");
    });

    it("should return 422 when trying to refund from ACTIVE (not a valid source state)", async () => {
      seedEscrowSelect(makeEscrowRow({ state: "ACTIVE" }));

      const res = await app.request(`/api/v1/escrow/${TEST_ESCROW_ID}/refund`, {
        method: "POST",
      });

      expect(res.status).toBe(422);
      const json = await res.json();
      expect(json.error.code).toBe("INVALID_STATE_TRANSITION");
    });

    it("should return 422 when trying to refund from REFUNDED (terminal state)", async () => {
      seedEscrowSelect(makeEscrowRow({ state: "REFUNDED" }));

      const res = await app.request(`/api/v1/escrow/${TEST_ESCROW_ID}/refund`, {
        method: "POST",
      });

      expect(res.status).toBe(422);
    });
  });

  // -------------------------------------------------------------------------
  // Expire escrow
  // -------------------------------------------------------------------------

  describe("POST /api/v1/escrow/:id/expire — expire escrow", () => {
    it("should return 422 when escrow has not yet expired", async () => {
      seedEscrowSelect(makeEscrowRow({ state: "ACTIVE", expiresAt: new Date(FUTURE_DATE) }));

      const res = await app.request(`/api/v1/escrow/${TEST_ESCROW_ID}/expire`, {
        method: "POST",
      });

      // expireEscrow throws EscrowTransitionError when not yet expired
      expect(res.status).toBe(422);
    });

    it("should return EXPIRED state when escrow is past expiry (auto-expires on fetch)", async () => {
      // When expiresAt is in the past:
      // 1. getEscrowOrThrow auto-transitions to EXPIRED and throws EscrowTransitionError
      // 2. expireEscrow catches it, re-fetches the (now EXPIRED) row, returns it
      // So the /expire endpoint returns 200 with state=EXPIRED
      const expiredRow = makeEscrowRow({ state: "EXPIRED" });
      let callCount = 0;
      mockSelectFrom.mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          // First call: getEscrowOrThrow returns ACTIVE with past expiry → triggers auto-expire
          return {
            where: () => ({ limit: () => Promise.resolve([makeEscrowRow({ state: "ACTIVE", expiresAt: new Date(PAST_DATE) })]) }),
            orderBy: () => ({ limit: () => Promise.resolve([]) }),
          };
        }
        // Second call: re-fetch after auto-expire returns EXPIRED row
        return {
          where: () => ({ limit: () => Promise.resolve([expiredRow]) }),
          orderBy: () => ({ limit: () => Promise.resolve([]) }),
        };
      });
      mockUpdateReturning.mockResolvedValue([expiredRow]);

      const res = await app.request(`/api/v1/escrow/${TEST_ESCROW_ID}/expire`, {
        method: "POST",
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.state).toBe("EXPIRED");
    });

    it("should return 422 when trying to expire COMPLETED escrow", async () => {
      seedEscrowSelect(makeEscrowRow({ state: "COMPLETED", expiresAt: new Date(PAST_DATE) }));

      const res = await app.request(`/api/v1/escrow/${TEST_ESCROW_ID}/expire`, {
        method: "POST",
      });

      expect(res.status).toBe(422);
    });
  });

  // -------------------------------------------------------------------------
  // Invalid state transitions
  // -------------------------------------------------------------------------

  describe("Invalid state transitions return 422", () => {
    it("should reject CREATED → COMPLETED (skips multiple states)", async () => {
      // COMPLETED cannot be reached from CREATED directly.
      // assertTransition(escrowId, current="CREATED", target="COMPLETED") throws
      // EscrowTransitionError(escrowId, from="CREATED", to="COMPLETED", allowed=["FUNDED","EXPIRED"])
      seedEscrowSelect(makeEscrowRow({ state: "CREATED" }));

      const res = await app.request(`/api/v1/escrow/${TEST_ESCROW_ID}/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(VALID_EVALUATOR_PROOF),
      });

      expect(res.status).toBe(422);
      const json = await res.json();
      expect(json.error.code).toBe("INVALID_STATE_TRANSITION");
      // error.from = current state (CREATED), error.to = rejected target state (COMPLETED)
      expect(json.error.from).toBe("CREATED");
      expect(json.error.to).toBe("COMPLETED");
    });

    it("should reject REFUNDED → FUNDED (terminal state, no outgoing transitions)", async () => {
      seedEscrowSelect(makeEscrowRow({ state: "REFUNDED" }));

      const res = await app.request(`/api/v1/escrow/${TEST_ESCROW_ID}/fund`, {
        method: "POST",
      });

      expect(res.status).toBe(422);
    });

    it("should include from/to state info in the 422 response body", async () => {
      // assertTransition(escrowId, current="CREATED", target="ACTIVE") throws
      // EscrowTransitionError(escrowId, from="CREATED", to="ACTIVE", allowed=["FUNDED","EXPIRED"])
      // The route handler maps error.from and error.to to the response body.
      seedEscrowSelect(makeEscrowRow({ state: "CREATED" }));

      const res = await app.request(`/api/v1/escrow/${TEST_ESCROW_ID}/activate`, {
        method: "POST",
      });

      expect(res.status).toBe(422);
      const json = await res.json();
      // error.from = current state (CREATED), error.to = rejected target (ACTIVE)
      expect(json.error.from).toBe("CREATED");
      expect(json.error.to).toBe("ACTIVE");
    });
  });

  // -------------------------------------------------------------------------
  // GET escrow — retrieve and list
  // -------------------------------------------------------------------------

  describe("GET /api/v1/escrow/:id — retrieve escrow", () => {
    it("should return full escrow row for a valid ID", async () => {
      seedEscrowSelect(makeEscrowRow({ state: "ACTIVE" }));

      const res = await app.request(`/api/v1/escrow/${TEST_ESCROW_ID}`);

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.id).toBe(TEST_ESCROW_ID);
      expect(json.data.state).toBe("ACTIVE");
    });

    it("should return 404 for non-existent escrow ID", async () => {
      seedEscrowSelect(null);

      const res = await app.request(
        "/api/v1/escrow/00000000-0000-0000-0000-000000000000",
      );

      expect(res.status).toBe(404);
    });

    it("should return 400 for invalid (non-UUID) escrow ID", async () => {
      const res = await app.request("/api/v1/escrow/not-a-uuid");

      expect(res.status).toBe(400);
    });
  });

  describe("GET /api/v1/escrow — list escrows with pagination", () => {
    it("should return paginated list with metadata", async () => {
      let callCount = 0;
      mockSelectFrom.mockImplementation(() => {
        callCount++;
        if (callCount % 2 === 1) {
          return {
            where: () => ({
              orderBy: () => ({
                limit: () => ({
                  offset: () => Promise.resolve([makeEscrowRow(), makeEscrowRow({ id: "550e8400-e29b-41d4-a716-446655440011" })]),
                }),
              }),
            }),
          };
        }
        return {
          where: () => Promise.resolve([{ count: 2 }]),
        };
      });

      const res = await app.request("/api/v1/escrow?page=1&limit=10");

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.items).toHaveLength(2);
      expect(json.data.pagination.total).toBe(2);
      expect(json.data.pagination.page).toBe(1);
    });

    it("should filter by state when provided", async () => {
      let callCount = 0;
      mockSelectFrom.mockImplementation(() => {
        callCount++;
        if (callCount % 2 === 1) {
          return {
            where: () => ({
              orderBy: () => ({
                limit: () => ({
                  offset: () => Promise.resolve([makeEscrowRow({ state: "ACTIVE" })]),
                }),
              }),
            }),
          };
        }
        return {
          where: () => Promise.resolve([{ count: 1 }]),
        };
      });

      const res = await app.request("/api/v1/escrow?state=ACTIVE");

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.items[0].state).toBe("ACTIVE");
    });

    it("should return 400 for invalid state filter value", async () => {
      const res = await app.request("/api/v1/escrow?state=GARBAGE");

      expect(res.status).toBe(400);
    });
  });
});
