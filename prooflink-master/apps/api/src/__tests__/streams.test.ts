import { describe, expect, it, vi, beforeEach } from "vitest";
import { createApp } from "../app.js";

// ---------------------------------------------------------------------------
// Mock services — stream routes delegate to service layer
// ---------------------------------------------------------------------------

const mockCreateStream = vi.fn();
const mockRecordStreamUsage = vi.fn();
const mockPauseStream = vi.fn();
const mockResumeStream = vi.fn();
const mockSettleStream = vi.fn();
const mockGetStreamStatus = vi.fn();

vi.mock("../services/streaming-payments.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/streaming-payments.js")>();
  return {
    ...actual,
    createStream: (...args: unknown[]) => mockCreateStream(...args),
    recordStreamUsage: (...args: unknown[]) => mockRecordStreamUsage(...args),
    pauseStream: (...args: unknown[]) => mockPauseStream(...args),
    resumeStream: (...args: unknown[]) => mockResumeStream(...args),
    settleStream: (...args: unknown[]) => mockSettleStream(...args),
    getStreamStatus: (...args: unknown[]) => mockGetStreamStatus(...args),
  };
});

// ---------------------------------------------------------------------------
// Mock DB for list routes
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

// Mock screening (imported transitively)
vi.mock("../services/screening.js", () => ({
  screenAddress: vi.fn().mockResolvedValue({ matched: false }),
  getScreener: vi.fn(),
  resetScreener: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const STREAM_UUID = "550e8400-e29b-41d4-a716-446655440040";

const sampleStream = {
  id: STREAM_UUID,
  payerDid: "did:prooflink:agent:payer",
  payeeDid: "did:prooflink:agent:payee",
  model: "PER_REQUEST",
  ratePerUnit: "0.01",
  unit: "request",
  totalBudget: "100.00",
  spent: "0",
  status: "ACTIVE",
  traceId: null,
  apiKeyId: "test-key-id",
  startedAt: new Date("2026-03-20T00:00:00Z"),
  settledAt: null,
  expiresAt: new Date("2026-06-01T00:00:00Z"),
  createdAt: new Date("2026-03-20T00:00:00Z"),
  updatedAt: new Date("2026-03-20T00:00:00Z"),
};

function validCreateBody() {
  return {
    payerDid: "did:prooflink:agent:payer",
    payeeDid: "did:prooflink:agent:payee",
    model: "PER_REQUEST",
    ratePerUnit: "0.01",
    unit: "request",
    totalBudget: "100.00",
    expiresAt: "2026-06-01T00:00:00Z",
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

const { StreamNotFoundError, StreamTransitionError, StreamBudgetExceededError } = await import("../services/streaming-payments.js");

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Streams API", () => {
  const app = createApp();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("POST /v1/streams", () => {
    it("returns 201 with created stream for valid request", async () => {
      mockCreateStream.mockResolvedValue(sampleStream);

      const res = await app.request("/v1/streams", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(validCreateBody()),
      });

      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.id).toBe(STREAM_UUID);
      expect(json.data.status).toBe("ACTIVE");
      expect(json.data.model).toBe("PER_REQUEST");
    });

    it("returns 400 for missing required fields", async () => {
      const res = await app.request("/v1/streams", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: "PER_REQUEST" }),
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error.code).toBe("VALIDATION_ERROR");
    });

    it("returns 400 for invalid model", async () => {
      const res = await app.request("/v1/streams", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...validCreateBody(), model: "INVALID_MODEL" }),
      });

      expect(res.status).toBe(400);
    });

    it("returns 400 for invalid JSON body", async () => {
      const res = await app.request("/v1/streams", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{bad json{{",
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.code).toBe("BAD_REQUEST");
    });
  });

  describe("GET /v1/streams/:id", () => {
    it("returns 200 with stream status when found", async () => {
      mockGetStreamStatus.mockResolvedValue({
        stream: sampleStream,
        remainingBudget: "100.00",
        usagePercent: 0,
        projectedExhaustionAt: null,
      });

      const res = await app.request(`/v1/streams/${STREAM_UUID}`);

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.stream.id).toBe(STREAM_UUID);
      expect(json.data.remainingBudget).toBe("100.00");
    });

    it("returns 404 when stream not found", async () => {
      mockGetStreamStatus.mockRejectedValue(new StreamNotFoundError(STREAM_UUID));

      const res = await app.request(`/v1/streams/${STREAM_UUID}`);

      expect(res.status).toBe(404);
      const json = await res.json();
      expect(json.error.code).toBe("NOT_FOUND");
    });

    it("returns 400 for non-UUID stream id", async () => {
      const res = await app.request("/v1/streams/not-a-uuid");

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.code).toBe("VALIDATION_ERROR");
    });
  });

  describe("POST /v1/streams/:id/usage", () => {
    it("returns 200 when usage recorded successfully", async () => {
      mockRecordStreamUsage.mockResolvedValue({ ...sampleStream, spent: "10.00" });

      const res = await app.request(`/v1/streams/${STREAM_UUID}/usage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ units: "1000" }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.spent).toBe("10.00");
    });

    it("returns 400 for missing units", async () => {
      const res = await app.request(`/v1/streams/${STREAM_UUID}/usage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.code).toBe("VALIDATION_ERROR");
    });

    it("returns 422 when budget is exceeded", async () => {
      mockRecordStreamUsage.mockRejectedValue(
        new StreamBudgetExceededError(STREAM_UUID, "200.00", "50.00"),
      );

      const res = await app.request(`/v1/streams/${STREAM_UUID}/usage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ units: "20000" }),
      });

      expect(res.status).toBe(422);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error.code).toBe("BUDGET_EXCEEDED");
      expect(json.error.requested).toBe("200.00");
      expect(json.error.remaining).toBe("50.00");
    });

    it("returns 422 when stream is not ACTIVE", async () => {
      mockRecordStreamUsage.mockRejectedValue(
        new StreamTransitionError(STREAM_UUID, "PAUSED", "ACTIVE", "Cannot record usage on a PAUSED stream."),
      );

      const res = await app.request(`/v1/streams/${STREAM_UUID}/usage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ units: "100" }),
      });

      expect(res.status).toBe(422);
      const json = await res.json();
      expect(json.error.code).toBe("INVALID_STREAM_TRANSITION");
    });

    it("returns 404 when stream not found", async () => {
      mockRecordStreamUsage.mockRejectedValue(new StreamNotFoundError(STREAM_UUID));

      const res = await app.request(`/v1/streams/${STREAM_UUID}/usage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ units: "100" }),
      });

      expect(res.status).toBe(404);
    });
  });

  describe("POST /v1/streams/:id/settle", () => {
    it("returns 200 when settled successfully", async () => {
      mockSettleStream.mockResolvedValue({ ...sampleStream, status: "SETTLED" });

      const res = await app.request(`/v1/streams/${STREAM_UUID}/settle`, {
        method: "POST",
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.status).toBe("SETTLED");
    });

    it("returns 422 when stream is already settled", async () => {
      mockSettleStream.mockRejectedValue(
        new StreamTransitionError(STREAM_UUID, "SETTLED", "SETTLED", "Stream is already settled."),
      );

      const res = await app.request(`/v1/streams/${STREAM_UUID}/settle`, {
        method: "POST",
      });

      expect(res.status).toBe(422);
    });

    it("returns 404 when stream not found", async () => {
      mockSettleStream.mockRejectedValue(new StreamNotFoundError(STREAM_UUID));

      const res = await app.request(`/v1/streams/${STREAM_UUID}/settle`, {
        method: "POST",
      });

      expect(res.status).toBe(404);
    });
  });

  describe("POST /v1/streams/:id/pause", () => {
    it("returns 200 when paused successfully", async () => {
      mockPauseStream.mockResolvedValue({ ...sampleStream, status: "PAUSED" });

      const res = await app.request(`/v1/streams/${STREAM_UUID}/pause`, {
        method: "POST",
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.status).toBe("PAUSED");
    });

    it("returns 422 when stream is not ACTIVE", async () => {
      mockPauseStream.mockRejectedValue(
        new StreamTransitionError(STREAM_UUID, "SETTLED", "PAUSED", "Can only pause ACTIVE streams."),
      );

      const res = await app.request(`/v1/streams/${STREAM_UUID}/pause`, {
        method: "POST",
      });

      expect(res.status).toBe(422);
    });
  });

  describe("POST /v1/streams/:id/resume", () => {
    it("returns 200 when resumed successfully", async () => {
      mockResumeStream.mockResolvedValue({ ...sampleStream, status: "ACTIVE" });

      const res = await app.request(`/v1/streams/${STREAM_UUID}/resume`, {
        method: "POST",
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.status).toBe("ACTIVE");
    });

    it("returns 422 when stream is not PAUSED", async () => {
      mockResumeStream.mockRejectedValue(
        new StreamTransitionError(STREAM_UUID, "ACTIVE", "ACTIVE", "Can only resume PAUSED streams."),
      );

      const res = await app.request(`/v1/streams/${STREAM_UUID}/resume`, {
        method: "POST",
      });

      expect(res.status).toBe(422);
    });
  });

  describe("GET /v1/streams", () => {
    it("returns 200 with paginated list", async () => {
      buildListSelectMock([sampleStream], 1);

      const res = await app.request("/v1/streams?page=1&limit=10");

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.items).toBeInstanceOf(Array);
      expect(json.data.items).toHaveLength(1);
      expect(json.data.pagination.page).toBe(1);
      expect(json.data.pagination.limit).toBe(10);
      expect(json.data.pagination.total).toBe(1);
    });

    it("returns 200 with defaults when no query params", async () => {
      buildListSelectMock([], 0);

      const res = await app.request("/v1/streams");

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.pagination.page).toBe(1);
      expect(json.data.pagination.limit).toBe(20);
    });

    it("accepts status filter", async () => {
      buildListSelectMock([], 0);

      const res = await app.request("/v1/streams?status=PAUSED");

      expect(res.status).toBe(200);
    });

    it("accepts model filter", async () => {
      buildListSelectMock([], 0);

      const res = await app.request("/v1/streams?model=PER_TOKEN");

      expect(res.status).toBe(200);
    });

    it("returns 400 for invalid status filter", async () => {
      const res = await app.request("/v1/streams?status=INVALID");

      expect(res.status).toBe(400);
    });

    it("returns 400 for limit above max (100)", async () => {
      const res = await app.request("/v1/streams?limit=200");

      expect(res.status).toBe(400);
    });
  });

  describe("Budget enforcement", () => {
    it("returns 422 with remaining budget info when exceeded", async () => {
      mockRecordStreamUsage.mockRejectedValue(
        new StreamBudgetExceededError(STREAM_UUID, "150.00", "25.00"),
      );

      const res = await app.request(`/v1/streams/${STREAM_UUID}/usage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ units: "15000" }),
      });

      expect(res.status).toBe(422);
      const json = await res.json();
      expect(json.error.code).toBe("BUDGET_EXCEEDED");
      expect(json.error.requested).toBe("150.00");
      expect(json.error.remaining).toBe("25.00");
    });
  });
});
