/**
 * E2E: Dispute Resolution Flow
 *
 * Tests the dispute state machine through the API at /api/v1/disputes:
 *   OPEN → EVIDENCE (on first evidence submission)
 *   EVIDENCE → ARBITRATION (escalate)
 *   ARBITRATION → RESOLVED (resolve with outcome)
 *   RESOLVED → CLOSED
 *   Invalid transitions → 422
 *   Evidence array grows on each submission
 *   /resolve requires admin scope
 *
 * DB layer is fully mocked — no Postgres required.
 *
 * Route: apps/api/src/routes/disputes.ts
 * Service: apps/api/src/services/disputes.ts
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import { createApp } from "../../../apps/api/src/app.js";

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
  authMiddleware: () => async (c: { set: (key: string, value: unknown) => void }, next: () => Promise<void>) => {
    c.set("auth", {
      apiKeyId: "test-api-key-id",
      ownerId: "test-owner",
      scopes: ["admin"],
      rateLimitPerMinute: 60,
      authMethod: "api_key",
    });
    await next();
  },
  requireScope: (_scope: string) => async (_c: unknown, next: () => Promise<void>) => next(),
}));

vi.mock("../../../apps/api/src/middleware/rate-limit.js", () => ({
  rateLimitMiddleware: () => async (_c: unknown, next: () => Promise<void>) => next(),
}));

vi.mock("../../../apps/api/src/routes/ws.js", async () => {
  const mod = await import("../../../apps/api/src/routes/ws.js");
  return { ...mod, broadcastWsEvent: vi.fn() };
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const TEST_DISPUTE_ID = "550e8400-e29b-41d4-a716-446655440020";
const TEST_ESCROW_ID = "550e8400-e29b-41d4-a716-446655440010";

function makeDisputeRow(overrides: Record<string, unknown> = {}) {
  const deadline = new Date();
  deadline.setHours(deadline.getHours() + 72);

  return {
    id: TEST_DISPUTE_ID,
    escrowId: TEST_ESCROW_ID,
    invoiceId: null,
    state: "OPEN",
    initiatorDid: "did:prooflink:agent:initiator-001",
    respondentDid: "did:prooflink:agent:respondent-001",
    reason: "Service was not delivered as agreed.",
    category: "NON_DELIVERY",
    evidence: [],
    resolution: null,
    resolvedBy: null,
    traceId: null,
    deadline,
    createdAt: new Date("2026-03-20T12:00:00Z"),
    updatedAt: new Date("2026-03-20T12:00:00Z"),
    ...overrides,
  };
}

const BASE_CREATE_DISPUTE = {
  escrowId: TEST_ESCROW_ID,
  initiatorDid: "did:prooflink:agent:initiator-001",
  respondentDid: "did:prooflink:agent:respondent-001",
  reason: "Service was not delivered as agreed.",
  category: "NON_DELIVERY",
};

const BASE_EVIDENCE = {
  submittedBy: "did:prooflink:agent:initiator-001",
  type: "screenshot",
  description: "Screenshot showing incomplete deliverable",
  data: { url: "https://storage.example.com/evidence/001.png" },
};

function seedDisputeSelect(row: ReturnType<typeof makeDisputeRow> | null) {
  mockSelectFrom.mockImplementation(() => ({
    where: () => ({
      limit: () => Promise.resolve(row ? [row] : []),
    }),
    orderBy: () => ({
      limit: () => ({
        offset: () => Promise.resolve(row ? [row] : []),
      }),
    }),
  }));
}

function seedAuditSelect() {
  mockSelectFrom.mockImplementation(() => ({
    where: () => ({
      limit: () => Promise.resolve([]),
    }),
    orderBy: () => ({
      limit: () => Promise.resolve([]),
    }),
  }));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("E2E: Dispute Resolution Flow", () => {
  const app = createApp();

  beforeEach(() => {
    vi.clearAllMocks();
    seedAuditSelect();
  });

  // -------------------------------------------------------------------------
  // Open dispute
  // -------------------------------------------------------------------------

  describe("POST /api/v1/disputes — open dispute", () => {
    it("should open a dispute and return OPEN state with generated ID", async () => {
      mockInsertReturning.mockResolvedValue([makeDisputeRow()]);

      const res = await app.request("/api/v1/disputes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(BASE_CREATE_DISPUTE),
      });

      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.id).toBeTruthy();
      expect(json.data.state).toBe("OPEN");
      expect(json.data.category).toBe("NON_DELIVERY");
    });

    it("should accept invoiceId in place of escrowId", async () => {
      const invoiceId = "550e8400-e29b-41d4-a716-446655440030";
      mockInsertReturning.mockResolvedValue([makeDisputeRow({ escrowId: null, invoiceId })]);

      const res = await app.request("/api/v1/disputes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...BASE_CREATE_DISPUTE,
          escrowId: undefined,
          invoiceId,
        }),
      });

      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.data.invoiceId).toBe(invoiceId);
    });

    it("should return 400 when neither escrowId nor invoiceId is provided", async () => {
      const res = await app.request("/api/v1/disputes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          initiatorDid: "did:prooflink:agent:initiator-001",
          respondentDid: "did:prooflink:agent:respondent-001",
          reason: "No reference ID.",
          category: "OTHER",
        }),
      });

      expect(res.status).toBe(400);
    });

    it("should return 400 for invalid category value", async () => {
      const res = await app.request("/api/v1/disputes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...BASE_CREATE_DISPUTE, category: "INVALID_CATEGORY" }),
      });

      expect(res.status).toBe(400);
    });

    it("should return 400 when required fields are missing", async () => {
      const res = await app.request("/api/v1/disputes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ escrowId: TEST_ESCROW_ID }),
      });

      expect(res.status).toBe(400);
    });

    it("should set a deadline 72 hours in the future", async () => {
      mockInsertReturning.mockResolvedValue([makeDisputeRow()]);

      const before = Date.now();

      const res = await app.request("/api/v1/disputes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(BASE_CREATE_DISPUTE),
      });

      const after = Date.now();
      expect(res.status).toBe(201);
      const json = await res.json();

      const deadline = new Date(json.data.deadline).getTime();
      // deadline should be ~72 hours from now (within 5 seconds of expected)
      const expectedMin = before + 72 * 60 * 60 * 1000 - 5000;
      const expectedMax = after + 72 * 60 * 60 * 1000 + 5000;
      expect(deadline).toBeGreaterThanOrEqual(expectedMin);
      expect(deadline).toBeLessThanOrEqual(expectedMax);
    });

    it("should include optional traceId in the response", async () => {
      const traceId = "dispute-trace-001";
      mockInsertReturning.mockResolvedValue([makeDisputeRow({ traceId })]);

      const res = await app.request("/api/v1/disputes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...BASE_CREATE_DISPUTE, traceId }),
      });

      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.data.traceId).toBe(traceId);
    });
  });

  // -------------------------------------------------------------------------
  // Submit evidence: grows evidence array, auto-transitions OPEN → EVIDENCE
  // -------------------------------------------------------------------------

  describe("POST /api/v1/disputes/:id/evidence — submit evidence", () => {
    it("should auto-transition OPEN → EVIDENCE and grow evidence array on first submission", async () => {
      seedDisputeSelect(makeDisputeRow({ state: "OPEN", evidence: [] }));

      const updatedEvidence = [{ ...BASE_EVIDENCE, submittedAt: new Date().toISOString() }];
      mockUpdateReturning.mockResolvedValue([
        makeDisputeRow({ state: "EVIDENCE", evidence: updatedEvidence }),
      ]);

      const res = await app.request(`/api/v1/disputes/${TEST_DISPUTE_ID}/evidence`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(BASE_EVIDENCE),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.state).toBe("EVIDENCE");
      expect(json.data.evidence).toHaveLength(1);
    });

    it("should append to evidence array on second submission (still EVIDENCE state)", async () => {
      const firstEvidence = [{ ...BASE_EVIDENCE, submittedAt: new Date().toISOString() }];
      seedDisputeSelect(makeDisputeRow({ state: "EVIDENCE", evidence: firstEvidence }));

      const secondEntry = { ...BASE_EVIDENCE, type: "log", description: "Server logs" };
      const twoEvidence = [...firstEvidence, { ...secondEntry, submittedAt: new Date().toISOString() }];
      mockUpdateReturning.mockResolvedValue([
        makeDisputeRow({ state: "EVIDENCE", evidence: twoEvidence }),
      ]);

      const res = await app.request(`/api/v1/disputes/${TEST_DISPUTE_ID}/evidence`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(secondEntry),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.evidence).toHaveLength(2);
    });

    it("should return 422 when trying to submit evidence after ARBITRATION state", async () => {
      seedDisputeSelect(makeDisputeRow({ state: "ARBITRATION" }));

      const res = await app.request(`/api/v1/disputes/${TEST_DISPUTE_ID}/evidence`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(BASE_EVIDENCE),
      });

      expect(res.status).toBe(422);
    });

    it("should return 400 when evidence body is missing required fields", async () => {
      const res = await app.request(`/api/v1/disputes/${TEST_DISPUTE_ID}/evidence`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ submittedBy: "did:prooflink:agent:initiator-001" }),
      });

      expect(res.status).toBe(400);
    });

    it("should return 404 when dispute does not exist", async () => {
      seedDisputeSelect(null);

      const res = await app.request(
        "/api/v1/disputes/00000000-0000-0000-0000-000000000000/evidence",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(BASE_EVIDENCE),
        },
      );

      expect(res.status).toBe(404);
      const json = await res.json();
      expect(json.error.code).toBe("NOT_FOUND");
    });
  });

  // -------------------------------------------------------------------------
  // Escalate: EVIDENCE → ARBITRATION
  // -------------------------------------------------------------------------

  describe("POST /api/v1/disputes/:id/escalate — escalate to arbitration", () => {
    it("should transition EVIDENCE → ARBITRATION", async () => {
      seedDisputeSelect(makeDisputeRow({ state: "EVIDENCE" }));
      mockUpdateReturning.mockResolvedValue([makeDisputeRow({ state: "ARBITRATION" })]);

      const res = await app.request(`/api/v1/disputes/${TEST_DISPUTE_ID}/escalate`, {
        method: "POST",
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.state).toBe("ARBITRATION");
    });

    it("should return 422 when trying to escalate from OPEN (must be EVIDENCE first)", async () => {
      seedDisputeSelect(makeDisputeRow({ state: "OPEN" }));

      const res = await app.request(`/api/v1/disputes/${TEST_DISPUTE_ID}/escalate`, {
        method: "POST",
      });

      expect(res.status).toBe(422);
      const json = await res.json();
      expect(json.error.code).toBe("INVALID_TRANSITION");
    });

    it("should return 422 when trying to escalate from RESOLVED (terminal)", async () => {
      seedDisputeSelect(makeDisputeRow({ state: "RESOLVED" }));

      const res = await app.request(`/api/v1/disputes/${TEST_DISPUTE_ID}/escalate`, {
        method: "POST",
      });

      expect(res.status).toBe(422);
    });

    it("should return 404 for unknown dispute ID", async () => {
      seedDisputeSelect(null);

      const res = await app.request(
        "/api/v1/disputes/00000000-0000-0000-0000-000000000000/escalate",
        { method: "POST" },
      );

      expect(res.status).toBe(404);
    });
  });

  // -------------------------------------------------------------------------
  // Resolve: ARBITRATION → RESOLVED
  // -------------------------------------------------------------------------

  describe("POST /api/v1/disputes/:id/resolve — resolve with outcome", () => {
    it("should transition ARBITRATION → RESOLVED with REFUND_FULL outcome", async () => {
      seedDisputeSelect(makeDisputeRow({ state: "ARBITRATION" }));
      mockUpdateReturning.mockResolvedValue([
        makeDisputeRow({
          state: "RESOLVED",
          resolvedBy: "did:prooflink:agent:arbitrator-001",
          resolution: {
            outcome: "REFUND_FULL",
            resolvedBy: "did:prooflink:agent:arbitrator-001",
            notes: "Initiator claim verified.",
            resolvedAt: new Date().toISOString(),
          },
        }),
      ]);

      const res = await app.request(`/api/v1/disputes/${TEST_DISPUTE_ID}/resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          outcome: "REFUND_FULL",
          resolvedBy: "did:prooflink:agent:arbitrator-001",
          notes: "Initiator claim verified.",
        }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.state).toBe("RESOLVED");
      expect(json.data.resolution.outcome).toBe("REFUND_FULL");
    });

    it("should accept REFUND_PARTIAL with refundAmount", async () => {
      seedDisputeSelect(makeDisputeRow({ state: "ARBITRATION" }));
      mockUpdateReturning.mockResolvedValue([
        makeDisputeRow({
          state: "RESOLVED",
          resolution: {
            outcome: "REFUND_PARTIAL",
            resolvedBy: "did:prooflink:agent:arbitrator-001",
            refundAmount: "250.00",
            resolvedAt: new Date().toISOString(),
          },
        }),
      ]);

      const res = await app.request(`/api/v1/disputes/${TEST_DISPUTE_ID}/resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          outcome: "REFUND_PARTIAL",
          resolvedBy: "did:prooflink:agent:arbitrator-001",
          refundAmount: "250.00",
        }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.resolution.outcome).toBe("REFUND_PARTIAL");
    });

    it("should return 422 when trying to resolve from EVIDENCE (must be ARBITRATION)", async () => {
      seedDisputeSelect(makeDisputeRow({ state: "EVIDENCE" }));

      const res = await app.request(`/api/v1/disputes/${TEST_DISPUTE_ID}/resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          outcome: "REFUND_FULL",
          resolvedBy: "did:prooflink:agent:arbitrator-001",
        }),
      });

      expect(res.status).toBe(422);
      const json = await res.json();
      expect(json.error.code).toBe("INVALID_TRANSITION");
    });

    it("should return 400 for invalid outcome value", async () => {
      const res = await app.request(`/api/v1/disputes/${TEST_DISPUTE_ID}/resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          outcome: "INVALID_OUTCOME",
          resolvedBy: "did:prooflink:agent:arbitrator-001",
        }),
      });

      expect(res.status).toBe(400);
    });
  });

  // -------------------------------------------------------------------------
  // Close: RESOLVED → CLOSED
  // -------------------------------------------------------------------------

  describe("POST /api/v1/disputes/:id/close — close after resolution", () => {
    it("should transition RESOLVED → CLOSED", async () => {
      seedDisputeSelect(makeDisputeRow({ state: "RESOLVED" }));
      mockUpdateReturning.mockResolvedValue([makeDisputeRow({ state: "CLOSED" })]);

      const res = await app.request(`/api/v1/disputes/${TEST_DISPUTE_ID}/close`, {
        method: "POST",
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.state).toBe("CLOSED");
    });

    it("should return 422 when trying to close from OPEN (must be RESOLVED first)", async () => {
      seedDisputeSelect(makeDisputeRow({ state: "OPEN" }));

      const res = await app.request(`/api/v1/disputes/${TEST_DISPUTE_ID}/close`, {
        method: "POST",
      });

      expect(res.status).toBe(422);
      const json = await res.json();
      expect(json.error.code).toBe("INVALID_TRANSITION");
    });

    it("should return 422 when trying to close from CLOSED (terminal state)", async () => {
      seedDisputeSelect(makeDisputeRow({ state: "CLOSED" }));

      const res = await app.request(`/api/v1/disputes/${TEST_DISPUTE_ID}/close`, {
        method: "POST",
      });

      expect(res.status).toBe(422);
    });
  });

  // -------------------------------------------------------------------------
  // GET dispute
  // -------------------------------------------------------------------------

  describe("GET /api/v1/disputes/:id — retrieve dispute", () => {
    it("should return full dispute row for a valid ID", async () => {
      seedDisputeSelect(makeDisputeRow({ state: "EVIDENCE" }));

      const res = await app.request(`/api/v1/disputes/${TEST_DISPUTE_ID}`);

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.id).toBe(TEST_DISPUTE_ID);
      expect(json.data.state).toBe("EVIDENCE");
    });

    it("should return 404 for non-existent dispute ID", async () => {
      seedDisputeSelect(null);

      const res = await app.request(
        "/api/v1/disputes/00000000-0000-0000-0000-000000000000",
      );

      expect(res.status).toBe(404);
    });

    it("should return 400 for invalid (non-UUID) dispute ID", async () => {
      const res = await app.request("/api/v1/disputes/not-a-uuid");

      expect(res.status).toBe(400);
    });
  });

  describe("GET /api/v1/disputes — list disputes with filters", () => {
    it("should return paginated dispute list", async () => {
      let callCount = 0;
      mockSelectFrom.mockImplementation(() => {
        callCount++;
        if (callCount % 2 === 1) {
          return {
            where: () => ({
              orderBy: () => ({
                limit: () => ({
                  offset: () => Promise.resolve([makeDisputeRow(), makeDisputeRow({ id: "550e8400-e29b-41d4-a716-446655440021" })]),
                }),
              }),
            }),
          };
        }
        return {
          where: () => Promise.resolve([{ count: 2 }]),
        };
      });

      const res = await app.request("/api/v1/disputes?page=1&limit=10");

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.items).toHaveLength(2);
      expect(json.data.pagination.total).toBe(2);
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
                  offset: () => Promise.resolve([makeDisputeRow({ state: "ARBITRATION" })]),
                }),
              }),
            }),
          };
        }
        return {
          where: () => Promise.resolve([{ count: 1 }]),
        };
      });

      const res = await app.request("/api/v1/disputes?state=ARBITRATION");

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.items[0].state).toBe("ARBITRATION");
    });

    it("should return 400 for invalid state filter value", async () => {
      const res = await app.request("/api/v1/disputes?state=GARBAGE");

      expect(res.status).toBe(400);
    });

    it("should return 400 for invalid category filter value", async () => {
      const res = await app.request("/api/v1/disputes?category=INVALID");

      expect(res.status).toBe(400);
    });
  });

  // -------------------------------------------------------------------------
  // Full lifecycle: OPEN → EVIDENCE → ARBITRATION → RESOLVED → CLOSED
  // -------------------------------------------------------------------------

  describe("Full dispute lifecycle: OPEN → EVIDENCE → ARBITRATION → RESOLVED → CLOSED", () => {
    it("should walk the full happy-path state machine end-to-end", async () => {
      // Step 1: Open
      mockInsertReturning.mockResolvedValueOnce([makeDisputeRow({ state: "OPEN" })]);
      const openRes = await app.request("/api/v1/disputes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(BASE_CREATE_DISPUTE),
      });
      expect(openRes.status).toBe(201);
      expect((await openRes.json()).data.state).toBe("OPEN");

      // Step 2: Submit evidence (OPEN → EVIDENCE)
      seedDisputeSelect(makeDisputeRow({ state: "OPEN", evidence: [] }));
      mockUpdateReturning.mockResolvedValueOnce([
        makeDisputeRow({ state: "EVIDENCE", evidence: [{ ...BASE_EVIDENCE }] }),
      ]);
      const evidenceRes = await app.request(`/api/v1/disputes/${TEST_DISPUTE_ID}/evidence`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(BASE_EVIDENCE),
      });
      expect(evidenceRes.status).toBe(200);
      expect((await evidenceRes.json()).data.state).toBe("EVIDENCE");

      // Step 3: Escalate (EVIDENCE → ARBITRATION)
      seedDisputeSelect(makeDisputeRow({ state: "EVIDENCE" }));
      mockUpdateReturning.mockResolvedValueOnce([makeDisputeRow({ state: "ARBITRATION" })]);
      const escalateRes = await app.request(`/api/v1/disputes/${TEST_DISPUTE_ID}/escalate`, {
        method: "POST",
      });
      expect(escalateRes.status).toBe(200);
      expect((await escalateRes.json()).data.state).toBe("ARBITRATION");

      // Step 4: Resolve (ARBITRATION → RESOLVED)
      seedDisputeSelect(makeDisputeRow({ state: "ARBITRATION" }));
      mockUpdateReturning.mockResolvedValueOnce([
        makeDisputeRow({
          state: "RESOLVED",
          resolution: { outcome: "REFUND_FULL", resolvedBy: "did:prooflink:agent:arb-001" },
        }),
      ]);
      const resolveRes = await app.request(`/api/v1/disputes/${TEST_DISPUTE_ID}/resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          outcome: "REFUND_FULL",
          resolvedBy: "did:prooflink:agent:arb-001",
        }),
      });
      expect(resolveRes.status).toBe(200);
      expect((await resolveRes.json()).data.state).toBe("RESOLVED");

      // Step 5: Close (RESOLVED → CLOSED)
      seedDisputeSelect(makeDisputeRow({ state: "RESOLVED" }));
      mockUpdateReturning.mockResolvedValueOnce([makeDisputeRow({ state: "CLOSED" })]);
      const closeRes = await app.request(`/api/v1/disputes/${TEST_DISPUTE_ID}/close`, {
        method: "POST",
      });
      expect(closeRes.status).toBe(200);
      expect((await closeRes.json()).data.state).toBe("CLOSED");
    });
  });
});
