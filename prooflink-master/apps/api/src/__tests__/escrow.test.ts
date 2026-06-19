import { describe, expect, it, vi, beforeEach } from "vitest";
import { createApp } from "../app.js";

// ---------------------------------------------------------------------------
// Mock services — escrow routes delegate to service layer
// ---------------------------------------------------------------------------

const mockCreateEscrow = vi.fn();
const mockFundEscrow = vi.fn();
const mockActivateEscrow = vi.fn();
const mockCompleteEscrow = vi.fn();
const mockDisputeEscrow = vi.fn();
const mockRefundEscrow = vi.fn();
const mockExpireEscrow = vi.fn();

vi.mock("../services/escrow.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/escrow.js")>();
  return {
    ...actual,
    createEscrow: (...args: unknown[]) => mockCreateEscrow(...args),
    fundEscrow: (...args: unknown[]) => mockFundEscrow(...args),
    activateEscrow: (...args: unknown[]) => mockActivateEscrow(...args),
    completeEscrow: (...args: unknown[]) => mockCompleteEscrow(...args),
    disputeEscrow: (...args: unknown[]) => mockDisputeEscrow(...args),
    refundEscrow: (...args: unknown[]) => mockRefundEscrow(...args),
    expireEscrow: (...args: unknown[]) => mockExpireEscrow(...args),
  };
});

// ---------------------------------------------------------------------------
// Mock DB for list/get routes (direct DB queries in the route handler)
// ---------------------------------------------------------------------------

const mockSelectFrom = vi.fn();

vi.mock("../db/index.js", () => ({
  getDb: () => ({
    insert: () => ({
      values: () => ({
        returning: vi.fn().mockResolvedValue([]),
      }),
    }),
    select: () => ({
      from: mockSelectFrom,
    }),
    update: () => ({
      set: () => ({
        where: () => ({
          returning: vi.fn().mockResolvedValue([]),
        }),
      }),
    }),
  }),
  getPool: () => ({
    query: vi.fn().mockResolvedValue({ rows: [{ "?column?": 1 }] }),
  }),
}));

// Bypass auth
vi.mock("../middleware/auth.js", () => ({
  requireScope: () => async (_c: unknown, next: () => Promise<void>) => { await next(); },
  authMiddleware: () => {
    return async (c: { set: (k: string, v: unknown) => void }, next: () => Promise<void>) => {
      c.set("auth", { apiKeyId: "test-key-id", ownerId: "test-owner", scopes: ["admin"], rateLimitPerMinute: 60, authMethod: "api_key" });
      await next();
    };
  },
}));

// Mock screening (used by createEscrow service)
vi.mock("../services/screening.js", () => ({
  screenAddress: vi.fn().mockResolvedValue({ matched: false, listsChecked: ["OFAC_SDN"], matchDetails: [], riskScore: 0, screenedAt: new Date().toISOString(), provider: "chainalysis_free" }),
  getScreener: vi.fn(),
  resetScreener: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ESCROW_UUID = "550e8400-e29b-41d4-a716-446655440020";
const OTHER_ESCROW_UUID = "550e8400-e29b-41d4-a716-446655440021";

const sampleEscrow = {
  id: ESCROW_UUID,
  escrowType: "PAYMENT",
  state: "CREATED",
  payerAgentDid: "did:prooflink:agent:payer",
  payeeAgentDid: "did:prooflink:agent:payee",
  payerWallet: "0xPAYER123",
  payeeWallet: "0xPAYEE456",
  amount: "500.00",
  asset: "USDC",
  chain: "eip155:8453",
  conditions: { type: "api_calls", threshold: 1000 },
  evaluatorAddress: null,
  expiresAt: new Date("2026-06-01T00:00:00Z"),
  traceId: null,
  apiKeyId: "test-key-id",
  fundedAt: null,
  completedAt: null,
  disputedAt: null,
  createdAt: new Date("2026-03-20T00:00:00Z"),
  updatedAt: new Date("2026-03-20T00:00:00Z"),
};

function validCreateBody() {
  return {
    escrowType: "PAYMENT",
    payerAgentDid: "did:prooflink:agent:payer",
    payeeAgentDid: "did:prooflink:agent:payee",
    payerWallet: "0xPAYER123",
    payeeWallet: "0xPAYEE456",
    amount: "500.00",
    asset: "USDC",
    chain: "eip155:8453",
    conditions: { type: "api_calls", threshold: 1000 },
    expiresAt: "2026-06-01T00:00:00Z",
  };
}

function validCompleteBody() {
  return {
    evaluator: "0xEVALUATOR",
    signature: "0xSIG123",
    result: { passed: true },
    timestamp: "2026-04-01T00:00:00Z",
  };
}

function buildListSelectMock(items: unknown[], count: number) {
  let call = 0;
  mockSelectFrom.mockImplementation(() => {
    call++;
    if (call % 2 === 1) {
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
      where: () => Promise.resolve([{ count }]),
    };
  });
}

// ---------------------------------------------------------------------------
// Import error classes after mock setup
// ---------------------------------------------------------------------------

const { EscrowTransitionError, EscrowNotFoundError, EscrowComplianceError } = await import("../services/escrow.js");

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Escrow API", () => {
  const app = createApp();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("POST /v1/escrow", () => {
    it("returns 201 with created escrow for valid request", async () => {
      mockCreateEscrow.mockResolvedValue(sampleEscrow);

      const res = await app.request("/v1/escrow", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(validCreateBody()),
      });

      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.id).toBe(ESCROW_UUID);
      expect(json.data.state).toBe("CREATED");
      expect(json.data.escrowType).toBe("PAYMENT");
    });

    it("returns 400 for missing required fields", async () => {
      const res = await app.request("/v1/escrow", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ escrowType: "PAYMENT" }),
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error.code).toBe("VALIDATION_ERROR");
    });

    it("returns 400 for invalid escrowType", async () => {
      const res = await app.request("/v1/escrow", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...validCreateBody(), escrowType: "INVALID" }),
      });

      expect(res.status).toBe(400);
    });

    it("returns 400 for invalid asset", async () => {
      const res = await app.request("/v1/escrow", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...validCreateBody(), asset: "DOGE" }),
      });

      expect(res.status).toBe(400);
    });

    it("returns 400 for invalid JSON body", async () => {
      const res = await app.request("/v1/escrow", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{invalid json{{",
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.code).toBe("BAD_REQUEST");
    });

    it("returns 403 when compliance screening fails", async () => {
      mockCreateEscrow.mockRejectedValue(
        new EscrowComplianceError("Payer wallet flagged by sanctions screening."),
      );

      const res = await app.request("/v1/escrow", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(validCreateBody()),
      });

      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error.code).toBe("COMPLIANCE_FAILED");
    });
  });

  describe("GET /v1/escrow/:id", () => {
    it("returns 200 when escrow exists", async () => {
      mockSelectFrom.mockReturnValue({
        where: () => ({
          limit: () => Promise.resolve([sampleEscrow]),
        }),
      });

      const res = await app.request(`/v1/escrow/${ESCROW_UUID}`);

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.id).toBe(ESCROW_UUID);
      expect(json.data.state).toBe("CREATED");
    });

    it("returns 404 when escrow not found", async () => {
      mockSelectFrom.mockReturnValue({
        where: () => ({
          limit: () => Promise.resolve([]),
        }),
      });

      const res = await app.request(`/v1/escrow/${ESCROW_UUID}`);

      expect(res.status).toBe(404);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error.code).toBe("NOT_FOUND");
    });

    it("returns 400 for non-UUID escrow id", async () => {
      const res = await app.request("/v1/escrow/not-a-valid-uuid");

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.code).toBe("VALIDATION_ERROR");
    });

    it("enforces tenant isolation — only returns escrows for current tenant", async () => {
      // Return escrow belonging to a different tenant (apiKeyId mismatch)
      mockSelectFrom.mockReturnValue({
        where: () => ({
          limit: () => Promise.resolve([]),
        }),
      });

      const res = await app.request(`/v1/escrow/${OTHER_ESCROW_UUID}`);

      expect(res.status).toBe(404);
    });
  });

  describe("GET /v1/escrow", () => {
    it("returns 200 with paginated list", async () => {
      buildListSelectMock([sampleEscrow], 1);

      const res = await app.request("/v1/escrow?page=1&limit=10");

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.items).toBeInstanceOf(Array);
      expect(json.data.items).toHaveLength(1);
      expect(json.data.pagination.page).toBe(1);
      expect(json.data.pagination.limit).toBe(10);
      expect(json.data.pagination.total).toBe(1);
      expect(json.data.pagination.totalPages).toBe(1);
    });

    it("returns 200 with defaults when no query params provided", async () => {
      buildListSelectMock([], 0);

      const res = await app.request("/v1/escrow");

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.pagination.page).toBe(1);
      expect(json.data.pagination.limit).toBe(20);
      expect(json.data.pagination.total).toBe(0);
      expect(json.data.pagination.totalPages).toBe(0);
    });

    it("accepts state filter", async () => {
      buildListSelectMock([], 0);

      const res = await app.request("/v1/escrow?state=FUNDED");

      expect(res.status).toBe(200);
    });

    it("accepts escrowType filter", async () => {
      buildListSelectMock([], 0);

      const res = await app.request("/v1/escrow?escrowType=MILESTONE");

      expect(res.status).toBe(200);
    });

    it("returns 400 for invalid state filter", async () => {
      const res = await app.request("/v1/escrow?state=GARBAGE");

      expect(res.status).toBe(400);
    });

    it("returns 400 for page less than 1", async () => {
      const res = await app.request("/v1/escrow?page=0");

      expect(res.status).toBe(400);
    });

    it("returns 400 for limit above max (100)", async () => {
      const res = await app.request("/v1/escrow?limit=200");

      expect(res.status).toBe(400);
    });
  });

  describe("POST /v1/escrow/:id/fund", () => {
    it("returns 200 for successful fund", async () => {
      mockFundEscrow.mockResolvedValue({ ...sampleEscrow, state: "FUNDED" });

      const res = await app.request(`/v1/escrow/${ESCROW_UUID}/fund`, {
        method: "POST",
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.state).toBe("FUNDED");
    });

    it("returns 404 when escrow not found", async () => {
      mockFundEscrow.mockRejectedValue(new EscrowNotFoundError(ESCROW_UUID));

      const res = await app.request(`/v1/escrow/${ESCROW_UUID}/fund`, {
        method: "POST",
      });

      expect(res.status).toBe(404);
      const json = await res.json();
      expect(json.error.code).toBe("NOT_FOUND");
    });

    it("returns 422 when escrow is already funded (state machine)", async () => {
      mockFundEscrow.mockRejectedValue(
        new EscrowTransitionError(ESCROW_UUID, "FUNDED", "FUNDED", ["ACTIVE", "EXPIRED"]),
      );

      const res = await app.request(`/v1/escrow/${ESCROW_UUID}/fund`, {
        method: "POST",
      });

      expect(res.status).toBe(422);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error.code).toBe("INVALID_STATE_TRANSITION");
    });

    it("returns 400 for non-UUID escrow id", async () => {
      const res = await app.request("/v1/escrow/bad-id/fund", {
        method: "POST",
      });

      expect(res.status).toBe(400);
    });
  });

  describe("POST /v1/escrow/:id/complete", () => {
    it("returns 200 for successful completion", async () => {
      mockCompleteEscrow.mockResolvedValue({ ...sampleEscrow, state: "COMPLETED" });

      const res = await app.request(`/v1/escrow/${ESCROW_UUID}/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(validCompleteBody()),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.state).toBe("COMPLETED");
    });

    it("returns 400 for missing evaluator proof body", async () => {
      const res = await app.request(`/v1/escrow/${ESCROW_UUID}/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.code).toBe("VALIDATION_ERROR");
    });

    it("returns 422 when escrow is not in ACTIVE state (state machine)", async () => {
      mockCompleteEscrow.mockRejectedValue(
        new EscrowTransitionError(ESCROW_UUID, "CREATED", "COMPLETED", ["FUNDED", "EXPIRED"]),
      );

      const res = await app.request(`/v1/escrow/${ESCROW_UUID}/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(validCompleteBody()),
      });

      expect(res.status).toBe(422);
      const json = await res.json();
      expect(json.error.code).toBe("INVALID_STATE_TRANSITION");
    });
  });

  describe("POST /v1/escrow/:id/dispute", () => {
    it("returns 200 for successful dispute", async () => {
      mockDisputeEscrow.mockResolvedValue({ ...sampleEscrow, state: "DISPUTED" });

      const res = await app.request(`/v1/escrow/${ESCROW_UUID}/dispute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: "Service was not delivered as agreed." }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.state).toBe("DISPUTED");
    });

    it("returns 400 for missing reason", async () => {
      const res = await app.request(`/v1/escrow/${ESCROW_UUID}/dispute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.code).toBe("VALIDATION_ERROR");
    });

    it("returns 422 when escrow is not in ACTIVE state (state machine)", async () => {
      mockDisputeEscrow.mockRejectedValue(
        new EscrowTransitionError(ESCROW_UUID, "CREATED", "DISPUTED", ["FUNDED", "EXPIRED"]),
      );

      const res = await app.request(`/v1/escrow/${ESCROW_UUID}/dispute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: "Not delivered" }),
      });

      expect(res.status).toBe(422);
      const json = await res.json();
      expect(json.error.code).toBe("INVALID_STATE_TRANSITION");
    });
  });

  describe("State machine enforcement", () => {
    it("cannot fund an already-funded escrow", async () => {
      mockFundEscrow.mockRejectedValue(
        new EscrowTransitionError(ESCROW_UUID, "FUNDED", "FUNDED", ["ACTIVE", "EXPIRED"]),
      );

      const res = await app.request(`/v1/escrow/${ESCROW_UUID}/fund`, {
        method: "POST",
      });

      expect(res.status).toBe(422);
    });

    it("cannot complete an unfunded escrow", async () => {
      mockCompleteEscrow.mockRejectedValue(
        new EscrowTransitionError(ESCROW_UUID, "CREATED", "COMPLETED", ["FUNDED", "EXPIRED"]),
      );

      const res = await app.request(`/v1/escrow/${ESCROW_UUID}/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(validCompleteBody()),
      });

      expect(res.status).toBe(422);
    });

    it("cannot dispute a CREATED escrow", async () => {
      mockDisputeEscrow.mockRejectedValue(
        new EscrowTransitionError(ESCROW_UUID, "CREATED", "DISPUTED", ["FUNDED", "EXPIRED"]),
      );

      const res = await app.request(`/v1/escrow/${ESCROW_UUID}/dispute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: "Service issue" }),
      });

      expect(res.status).toBe(422);
    });

    it("cannot transition from terminal state COMPLETED", async () => {
      mockFundEscrow.mockRejectedValue(
        new EscrowTransitionError(ESCROW_UUID, "COMPLETED", "FUNDED", []),
      );

      const res = await app.request(`/v1/escrow/${ESCROW_UUID}/fund`, {
        method: "POST",
      });

      expect(res.status).toBe(422);
      const json = await res.json();
      expect(json.error.code).toBe("INVALID_STATE_TRANSITION");
    });
  });

  describe("Tenant isolation", () => {
    it("GET /v1/escrow/:id — returns 404 for escrow belonging to another tenant", async () => {
      // Simulate tenant isolation: query with apiKeyId filter returns empty
      mockSelectFrom.mockReturnValue({
        where: () => ({
          limit: () => Promise.resolve([]),
        }),
      });

      const res = await app.request(`/v1/escrow/${ESCROW_UUID}`);

      expect(res.status).toBe(404);
      const json = await res.json();
      expect(json.error.code).toBe("NOT_FOUND");
    });

    it("POST /v1/escrow/:id/fund — returns 404 for escrow belonging to another tenant", async () => {
      mockFundEscrow.mockRejectedValue(new EscrowNotFoundError(ESCROW_UUID));

      const res = await app.request(`/v1/escrow/${ESCROW_UUID}/fund`, {
        method: "POST",
      });

      expect(res.status).toBe(404);
    });
  });
});
