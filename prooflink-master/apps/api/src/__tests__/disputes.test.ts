import { describe, expect, it, vi, beforeEach } from "vitest";
import { createApp } from "../app.js";

// ---------------------------------------------------------------------------
// Mock services — dispute routes delegate to service layer
// ---------------------------------------------------------------------------

const mockOpenDispute = vi.fn();
const mockSubmitEvidence = vi.fn();
const mockEscalateToArbitration = vi.fn();
const mockResolveDispute = vi.fn();
const mockCloseDispute = vi.fn();

vi.mock("../services/disputes.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/disputes.js")>();
  return {
    ...actual,
    openDispute: (...args: unknown[]) => mockOpenDispute(...args),
    submitEvidence: (...args: unknown[]) => mockSubmitEvidence(...args),
    escalateToArbitration: (...args: unknown[]) => mockEscalateToArbitration(...args),
    resolveDispute: (...args: unknown[]) => mockResolveDispute(...args),
    closeDispute: (...args: unknown[]) => mockCloseDispute(...args),
  };
});

// ---------------------------------------------------------------------------
// Mock DB for list/get routes
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

// Mock screening (imported transitively by some modules)
vi.mock("../services/screening.js", () => ({
  screenAddress: vi.fn().mockResolvedValue({ matched: false }),
  getScreener: vi.fn(),
  resetScreener: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const DISPUTE_UUID = "550e8400-e29b-41d4-a716-446655440030";
const ESCROW_UUID = "550e8400-e29b-41d4-a716-446655440031";

const sampleDispute = {
  id: DISPUTE_UUID,
  escrowId: ESCROW_UUID,
  invoiceId: null,
  state: "OPEN",
  initiatorDid: "did:prooflink:agent:initiator",
  respondentDid: "did:prooflink:agent:respondent",
  reason: "Service not delivered",
  category: "NON_DELIVERY",
  evidence: [],
  resolution: null,
  resolvedBy: null,
  traceId: null,
  apiKeyId: "test-key-id",
  deadline: new Date("2026-06-01T00:00:00Z"),
  createdAt: new Date("2026-03-20T00:00:00Z"),
  updatedAt: new Date("2026-03-20T00:00:00Z"),
};

function validCreateBody() {
  return {
    escrowId: ESCROW_UUID,
    initiatorDid: "did:prooflink:agent:initiator",
    respondentDid: "did:prooflink:agent:respondent",
    reason: "Service not delivered as agreed",
    category: "NON_DELIVERY",
  };
}

function validEvidenceBody() {
  return {
    submittedBy: "did:prooflink:agent:initiator",
    type: "screenshot",
    description: "Screenshot showing service was not available",
  };
}

function validResolveBody() {
  return {
    outcome: "REFUND_FULL",
    resolvedBy: "admin@prooflink.io",
    notes: "Resolved in favor of initiator",
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

const { DisputeTransitionError, DisputeNotFoundError } = await import("../services/disputes.js");

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Disputes API", () => {
  const app = createApp();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("POST /v1/disputes", () => {
    it("returns 201 with opened dispute for valid request", async () => {
      mockOpenDispute.mockResolvedValue(sampleDispute);

      const res = await app.request("/v1/disputes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(validCreateBody()),
      });

      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.id).toBe(DISPUTE_UUID);
      expect(json.data.state).toBe("OPEN");
      expect(json.data.category).toBe("NON_DELIVERY");
    });

    it("returns 400 for missing required fields", async () => {
      const res = await app.request("/v1/disputes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: "Something wrong" }),
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error.code).toBe("VALIDATION_ERROR");
    });

    it("returns 400 when neither escrowId nor invoiceId provided", async () => {
      const res = await app.request("/v1/disputes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          initiatorDid: "did:prooflink:agent:a",
          respondentDid: "did:prooflink:agent:b",
          reason: "Problem",
          category: "OTHER",
        }),
      });

      expect(res.status).toBe(400);
    });

    it("returns 400 for invalid category", async () => {
      const res = await app.request("/v1/disputes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...validCreateBody(), category: "INVALID_CATEGORY" }),
      });

      expect(res.status).toBe(400);
    });

    it("returns 400 for invalid JSON body", async () => {
      const res = await app.request("/v1/disputes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{invalid json",
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.code).toBe("BAD_REQUEST");
    });
  });

  describe("GET /v1/disputes", () => {
    it("returns 200 with paginated list", async () => {
      buildListSelectMock([sampleDispute], 1);

      const res = await app.request("/v1/disputes?page=1&limit=10");

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.items).toBeInstanceOf(Array);
      expect(json.data.items).toHaveLength(1);
      expect(json.data.pagination.page).toBe(1);
      expect(json.data.pagination.pageSize).toBe(10);
      expect(json.data.pagination.total).toBe(1);
    });

    it("returns 200 with defaults when no query params", async () => {
      buildListSelectMock([], 0);

      const res = await app.request("/v1/disputes");

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.pagination.page).toBe(1);
      expect(json.data.pagination.pageSize).toBe(20);
      expect(json.data.pagination.total).toBe(0);
    });

    it("accepts state filter", async () => {
      buildListSelectMock([], 0);

      const res = await app.request("/v1/disputes?state=OPEN");

      expect(res.status).toBe(200);
    });

    it("accepts category filter", async () => {
      buildListSelectMock([], 0);

      const res = await app.request("/v1/disputes?category=OVERCHARGE");

      expect(res.status).toBe(200);
    });

    it("returns 400 for invalid state filter", async () => {
      const res = await app.request("/v1/disputes?state=INVALID");

      expect(res.status).toBe(400);
    });
  });

  describe("GET /v1/disputes/:id", () => {
    it("returns 200 when dispute exists", async () => {
      mockSelectFrom.mockReturnValue({
        where: () => ({
          limit: () => Promise.resolve([sampleDispute]),
        }),
      });

      const res = await app.request(`/v1/disputes/${DISPUTE_UUID}`);

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.id).toBe(DISPUTE_UUID);
    });

    it("returns 404 when dispute not found", async () => {
      mockSelectFrom.mockReturnValue({
        where: () => ({
          limit: () => Promise.resolve([]),
        }),
      });

      const res = await app.request(`/v1/disputes/${DISPUTE_UUID}`);

      expect(res.status).toBe(404);
      const json = await res.json();
      expect(json.error.code).toBe("NOT_FOUND");
    });

    it("returns 400 for non-UUID dispute id", async () => {
      const res = await app.request("/v1/disputes/not-a-uuid");

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.code).toBe("VALIDATION_ERROR");
    });
  });

  describe("POST /v1/disputes/:id/evidence", () => {
    it("returns 200 when evidence submitted successfully", async () => {
      mockSubmitEvidence.mockResolvedValue({ ...sampleDispute, state: "EVIDENCE" });

      const res = await app.request(`/v1/disputes/${DISPUTE_UUID}/evidence`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(validEvidenceBody()),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.state).toBe("EVIDENCE");
    });

    it("returns 400 for missing evidence fields", async () => {
      const res = await app.request(`/v1/disputes/${DISPUTE_UUID}/evidence`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.code).toBe("VALIDATION_ERROR");
    });

    it("returns 404 when dispute not found", async () => {
      mockSubmitEvidence.mockRejectedValue(new DisputeNotFoundError(DISPUTE_UUID));

      const res = await app.request(`/v1/disputes/${DISPUTE_UUID}/evidence`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(validEvidenceBody()),
      });

      expect(res.status).toBe(404);
      const json = await res.json();
      expect(json.error.code).toBe("NOT_FOUND");
    });

    it("returns 422 when dispute is in wrong state for evidence", async () => {
      mockSubmitEvidence.mockRejectedValue(
        new DisputeTransitionError("RESOLVED", "EVIDENCE", ["OPEN", "EVIDENCE"]),
      );

      const res = await app.request(`/v1/disputes/${DISPUTE_UUID}/evidence`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(validEvidenceBody()),
      });

      expect(res.status).toBe(422);
      const json = await res.json();
      expect(json.error.code).toBe("INVALID_TRANSITION");
    });
  });

  describe("POST /v1/disputes/:id/escalate", () => {
    it("returns 200 when escalated successfully", async () => {
      mockEscalateToArbitration.mockResolvedValue({ ...sampleDispute, state: "ARBITRATION" });

      const res = await app.request(`/v1/disputes/${DISPUTE_UUID}/escalate`, {
        method: "POST",
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.state).toBe("ARBITRATION");
    });

    it("returns 404 when dispute not found", async () => {
      mockEscalateToArbitration.mockRejectedValue(new DisputeNotFoundError(DISPUTE_UUID));

      const res = await app.request(`/v1/disputes/${DISPUTE_UUID}/escalate`, {
        method: "POST",
      });

      expect(res.status).toBe(404);
    });

    it("returns 422 when dispute is not in EVIDENCE state", async () => {
      mockEscalateToArbitration.mockRejectedValue(
        new DisputeTransitionError("OPEN", "ARBITRATION", ["EVIDENCE"]),
      );

      const res = await app.request(`/v1/disputes/${DISPUTE_UUID}/escalate`, {
        method: "POST",
      });

      expect(res.status).toBe(422);
      const json = await res.json();
      expect(json.error.code).toBe("INVALID_TRANSITION");
    });
  });

  describe("POST /v1/disputes/:id/resolve", () => {
    it("returns 200 when resolved successfully (admin-only)", async () => {
      mockResolveDispute.mockResolvedValue({ ...sampleDispute, state: "RESOLVED" });

      const res = await app.request(`/v1/disputes/${DISPUTE_UUID}/resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(validResolveBody()),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.state).toBe("RESOLVED");
    });

    it("returns 400 for missing outcome", async () => {
      const res = await app.request(`/v1/disputes/${DISPUTE_UUID}/resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resolvedBy: "admin" }),
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.code).toBe("VALIDATION_ERROR");
    });

    it("returns 400 for invalid outcome value", async () => {
      const res = await app.request(`/v1/disputes/${DISPUTE_UUID}/resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...validResolveBody(), outcome: "INVALID_OUTCOME" }),
      });

      expect(res.status).toBe(400);
    });

    it("returns 422 when dispute is not in ARBITRATION state", async () => {
      mockResolveDispute.mockRejectedValue(
        new DisputeTransitionError("OPEN", "RESOLVED", ["EVIDENCE"]),
      );

      const res = await app.request(`/v1/disputes/${DISPUTE_UUID}/resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(validResolveBody()),
      });

      expect(res.status).toBe(422);
    });
  });

  describe("State machine transitions", () => {
    it("cannot escalate from OPEN (must go through EVIDENCE first)", async () => {
      mockEscalateToArbitration.mockRejectedValue(
        new DisputeTransitionError("OPEN", "ARBITRATION", ["EVIDENCE"]),
      );

      const res = await app.request(`/v1/disputes/${DISPUTE_UUID}/escalate`, {
        method: "POST",
      });

      expect(res.status).toBe(422);
    });

    it("cannot resolve from EVIDENCE (must go through ARBITRATION first)", async () => {
      mockResolveDispute.mockRejectedValue(
        new DisputeTransitionError("EVIDENCE", "RESOLVED", ["ARBITRATION"]),
      );

      const res = await app.request(`/v1/disputes/${DISPUTE_UUID}/resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(validResolveBody()),
      });

      expect(res.status).toBe(422);
    });

    it("cannot transition from terminal state CLOSED", async () => {
      mockSubmitEvidence.mockRejectedValue(
        new DisputeTransitionError("CLOSED", "EVIDENCE", []),
      );

      const res = await app.request(`/v1/disputes/${DISPUTE_UUID}/evidence`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(validEvidenceBody()),
      });

      expect(res.status).toBe(422);
      const json = await res.json();
      expect(json.error.code).toBe("INVALID_TRANSITION");
    });
  });
});
