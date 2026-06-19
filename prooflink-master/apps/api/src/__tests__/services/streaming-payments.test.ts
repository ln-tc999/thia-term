import { describe, expect, it, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// vi.hoisted() — mock factories must be defined before module graph loads.
// The DB mock uses a two-level approach:
//   • mockSelect / mockInsert / mockUpdate are the chainable builder stubs.
//   • mockSelectLimitFn / mockInsertReturningFn / mockUpdateReturningFn carry
//     the actual resolved values set per-test.
// ---------------------------------------------------------------------------

const {
  mockSelectLimitFn,
  mockInsertReturningFn,
  mockUpdateReturningFn,
  mockUpdateSet,
  mockSelectFrom,
} = vi.hoisted(() => {
  const mockSelectLimitFn = vi.fn();
  const mockInsertReturningFn = vi.fn();
  const mockUpdateReturningFn = vi.fn();

  // Chainable stubs for update().set().where().returning()
  const mockUpdateReturningChain = {
    returning: mockUpdateReturningFn,
  };
  const mockUpdateWhereChain = {
    where: vi.fn().mockReturnValue(mockUpdateReturningChain),
  };
  const mockUpdateSet = vi.fn().mockReturnValue(mockUpdateWhereChain);

  // Chainable stubs for select().from().where().limit()
  const mockSelectWhereLimitChain = {
    limit: mockSelectLimitFn,
  };
  const mockSelectWhere = vi.fn().mockReturnValue(mockSelectWhereLimitChain);
  const mockSelectFrom = vi.fn().mockReturnValue({ where: mockSelectWhere });

  return {
    mockSelectLimitFn,
    mockInsertReturningFn,
    mockUpdateReturningFn,
    mockUpdateSet,
    mockSelectFrom,
  };
});

vi.mock("../../db/index.js", () => ({
  getDb: () => ({
    select: () => ({ from: mockSelectFrom }),
    insert: () => ({
      values: () => ({
        returning: mockInsertReturningFn,
      }),
    }),
    update: () => ({ set: mockUpdateSet }),
  }),
}));

vi.mock("../../utils/audit.js", () => ({
  writeAuditLog: vi.fn(),
}));

vi.mock("../../utils/logger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import {
  createStream,
  recordStreamUsage,
  pauseStream,
  resumeStream,
  settleStream,
  getStreamStatus,
  StreamNotFoundError,
  StreamTransitionError,
  StreamBudgetExceededError,
} from "../../services/streaming-payments.js";
import type { PaymentStream } from "../../db/schema.js";

// ---------------------------------------------------------------------------
// Fixture factory
// ---------------------------------------------------------------------------

function makeStream(overrides: Partial<PaymentStream> = {}): PaymentStream {
  const now = new Date("2025-01-01T00:00:00.000Z");
  return {
    id: "stream-uuid-1",
    payerDid: "did:web:payer.prooflink.io",
    payeeDid: "did:web:payee.prooflink.io",
    model: "PER_REQUEST",
    ratePerUnit: "1.0",
    unit: "request",
    totalBudget: "100.0",
    spent: "0",
    status: "ACTIVE",
    traceId: null,
    startedAt: now,
    expiresAt: new Date("2099-01-01T00:00:00.000Z"),
    settledAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makeCreateParams() {
  return {
    payerDid: "did:web:payer.prooflink.io",
    payeeDid: "did:web:payee.prooflink.io",
    model: "PER_REQUEST" as const,
    ratePerUnit: "1.0",
    unit: "request",
    totalBudget: "100.0",
    expiresAt: new Date("2099-01-01T00:00:00.000Z"),
  };
}

// ---------------------------------------------------------------------------
// createStream
// ---------------------------------------------------------------------------

describe("createStream", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the inserted stream row with the generated id", async () => {
    const expected = makeStream();
    mockInsertReturningFn.mockResolvedValue([expected]);

    const result = await createStream(makeCreateParams());

    expect(result.id).toBe("stream-uuid-1");
    expect(result.status).toBe("ACTIVE");
    expect(result.spent).toBe("0");
  });

  it("sets initial spent to '0'", async () => {
    const stream = makeStream({ spent: "0" });
    mockInsertReturningFn.mockResolvedValue([stream]);

    const result = await createStream(makeCreateParams());

    expect(result.spent).toBe("0");
  });

  it("propagates the model from params", async () => {
    const stream = makeStream({ model: "PER_TOKEN" });
    mockInsertReturningFn.mockResolvedValue([stream]);

    const result = await createStream({ ...makeCreateParams(), model: "PER_TOKEN" });

    expect(result.model).toBe("PER_TOKEN");
  });

  it("throws when DB insert returns no row", async () => {
    mockInsertReturningFn.mockResolvedValue([]);

    await expect(createStream(makeCreateParams())).rejects.toThrow(
      "Failed to insert payment stream row.",
    );
  });

  it("uses null traceId when not provided", async () => {
    const stream = makeStream({ traceId: null });
    mockInsertReturningFn.mockResolvedValue([stream]);

    const result = await createStream(makeCreateParams());
    expect(result.traceId).toBeNull();
  });

  it("stores the provided traceId when given", async () => {
    const stream = makeStream({ traceId: "trace-abc" });
    mockInsertReturningFn.mockResolvedValue([stream]);

    const result = await createStream({ ...makeCreateParams(), traceId: "trace-abc" });
    expect(result.traceId).toBe("trace-abc");
  });

  it("calls insert once per createStream invocation", async () => {
    mockInsertReturningFn.mockResolvedValue([makeStream()]);
    await createStream(makeCreateParams());
    expect(mockInsertReturningFn).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// recordStreamUsage
// ---------------------------------------------------------------------------

describe("recordStreamUsage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("decrements budget and returns updated stream when cost is within budget", async () => {
    const existing = makeStream({ spent: "10.0", totalBudget: "100.0", ratePerUnit: "1.0" });
    const updated = makeStream({ spent: "20.0", status: "ACTIVE" });
    mockSelectLimitFn.mockResolvedValue([existing]);
    mockUpdateReturningFn.mockResolvedValue([updated]);

    const result = await recordStreamUsage("stream-uuid-1", { units: "10" });

    expect(result.spent).toBe("20.0");
    expect(result.status).toBe("ACTIVE");
  });

  it("marks status EXHAUSTED when spend exactly reaches budget", async () => {
    // ratePerUnit=1, units=90, spent=10 → newSpent=100 === budget=100 → EXHAUSTED
    const existing = makeStream({ spent: "10.0", totalBudget: "100.0", ratePerUnit: "1.0" });
    const updated = makeStream({ spent: "100.0", status: "EXHAUSTED" });
    mockSelectLimitFn.mockResolvedValue([existing]);
    mockUpdateReturningFn.mockResolvedValue([updated]);

    const result = await recordStreamUsage("stream-uuid-1", { units: "90" });

    expect(result.status).toBe("EXHAUSTED");
    expect(result.spent).toBe("100.0");
  });

  it("throws StreamBudgetExceededError when cost would exceed budget", async () => {
    // ratePerUnit=1, units=95, spent=10 → newSpent=105 > budget=100
    // The atomic SQL WHERE clause blocks the update; service re-fetches to distinguish
    // budget-exceeded (still ACTIVE) from concurrent modification (non-ACTIVE).
    const existing = makeStream({ spent: "10.0", totalBudget: "100.0", ratePerUnit: "1.0" });
    // First call: initial fetch in getStreamOrThrow; second call: re-fetch after failed update
    mockSelectLimitFn.mockResolvedValueOnce([existing]).mockResolvedValueOnce([existing]);
    mockUpdateReturningFn.mockResolvedValue([]);

    await expect(
      recordStreamUsage("stream-uuid-1", { units: "95" }),
    ).rejects.toBeInstanceOf(StreamBudgetExceededError);
  });

  it("StreamBudgetExceededError carries code BUDGET_EXCEEDED", async () => {
    const existing = makeStream({ spent: "99.0", totalBudget: "100.0", ratePerUnit: "1.0" });
    // First call: initial fetch; second call: re-fetch after failed update (still ACTIVE = budget exceeded)
    mockSelectLimitFn.mockResolvedValueOnce([existing]).mockResolvedValueOnce([existing]);
    mockUpdateReturningFn.mockResolvedValue([]);

    const err = await recordStreamUsage("stream-uuid-1", { units: "5" }).catch((e) => e);
    expect(err.code).toBe("BUDGET_EXCEEDED");
    expect(err.streamId).toBe("stream-uuid-1");
  });

  it("throws StreamTransitionError when stream is PAUSED", async () => {
    const paused = makeStream({ status: "PAUSED" });
    mockSelectLimitFn.mockResolvedValue([paused]);

    await expect(
      recordStreamUsage("stream-uuid-1", { units: "1" }),
    ).rejects.toBeInstanceOf(StreamTransitionError);
  });

  it("throws StreamTransitionError when stream is SETTLED", async () => {
    const settled = makeStream({ status: "SETTLED" });
    mockSelectLimitFn.mockResolvedValue([settled]);

    await expect(
      recordStreamUsage("stream-uuid-1", { units: "1" }),
    ).rejects.toBeInstanceOf(StreamTransitionError);
  });

  it("throws StreamNotFoundError when stream does not exist", async () => {
    mockSelectLimitFn.mockResolvedValue([]);

    await expect(
      recordStreamUsage("nonexistent-id", { units: "1" }),
    ).rejects.toBeInstanceOf(StreamNotFoundError);
  });

  it("throws StreamTransitionError on concurrent modification (update returns no row)", async () => {
    // Simulate: stream is ACTIVE when first fetched, update fails (concurrent write),
    // re-fetch shows stream has moved to a non-ACTIVE state (e.g. SETTLED by another request).
    // The service distinguishes this from budget-exceeded by checking the re-fetched status.
    const existing = makeStream({ spent: "0", totalBudget: "100.0", ratePerUnit: "1.0" });
    const settledByOther = makeStream({ spent: "0", status: "SETTLED" });
    mockSelectLimitFn.mockResolvedValueOnce([existing]).mockResolvedValueOnce([settledByOther]);
    mockUpdateReturningFn.mockResolvedValue([]);

    await expect(
      recordStreamUsage("stream-uuid-1", { units: "5" }),
    ).rejects.toBeInstanceOf(StreamTransitionError);
  });

  it("forwards metadata to audit log (via writeAuditLog — not throws)", async () => {
    const existing = makeStream({ spent: "0", totalBudget: "100.0", ratePerUnit: "0.5" });
    const updated = makeStream({ spent: "2.5", status: "ACTIVE" });
    mockSelectLimitFn.mockResolvedValue([existing]);
    mockUpdateReturningFn.mockResolvedValue([updated]);

    // Ensure metadata does not cause an error
    await expect(
      recordStreamUsage("stream-uuid-1", { units: "5", metadata: { requestId: "req-1" } }),
    ).resolves.toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// pauseStream
// ---------------------------------------------------------------------------

describe("pauseStream", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("transitions ACTIVE → PAUSED and returns updated stream", async () => {
    const active = makeStream({ status: "ACTIVE" });
    const paused = makeStream({ status: "PAUSED" });
    mockSelectLimitFn.mockResolvedValue([active]);
    mockUpdateReturningFn.mockResolvedValue([paused]);

    const result = await pauseStream("stream-uuid-1");

    expect(result.status).toBe("PAUSED");
  });

  it("throws StreamTransitionError when stream is already PAUSED", async () => {
    const paused = makeStream({ status: "PAUSED" });
    mockSelectLimitFn.mockResolvedValue([paused]);

    const err = await pauseStream("stream-uuid-1").catch((e) => e);
    expect(err).toBeInstanceOf(StreamTransitionError);
    expect(err.code).toBe("INVALID_STREAM_TRANSITION");
    expect(err.targetStatus).toBe("PAUSED");
  });

  it("throws StreamTransitionError when stream is SETTLED", async () => {
    const settled = makeStream({ status: "SETTLED" });
    mockSelectLimitFn.mockResolvedValue([settled]);

    await expect(pauseStream("stream-uuid-1")).rejects.toBeInstanceOf(StreamTransitionError);
  });

  it("throws StreamTransitionError when stream is EXHAUSTED", async () => {
    const exhausted = makeStream({ status: "EXHAUSTED" });
    mockSelectLimitFn.mockResolvedValue([exhausted]);

    await expect(pauseStream("stream-uuid-1")).rejects.toBeInstanceOf(StreamTransitionError);
  });

  it("throws StreamNotFoundError when stream is missing", async () => {
    mockSelectLimitFn.mockResolvedValue([]);

    await expect(pauseStream("missing-id")).rejects.toBeInstanceOf(StreamNotFoundError);
  });

  it("throws StreamTransitionError on concurrent modification (update returns no row)", async () => {
    const active = makeStream({ status: "ACTIVE" });
    mockSelectLimitFn.mockResolvedValue([active]);
    mockUpdateReturningFn.mockResolvedValue([]);

    await expect(pauseStream("stream-uuid-1")).rejects.toBeInstanceOf(StreamTransitionError);
  });
});

// ---------------------------------------------------------------------------
// resumeStream
// ---------------------------------------------------------------------------

describe("resumeStream", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("transitions PAUSED → ACTIVE and returns updated stream", async () => {
    const paused = makeStream({ status: "PAUSED" });
    const active = makeStream({ status: "ACTIVE" });
    mockSelectLimitFn.mockResolvedValue([paused]);
    mockUpdateReturningFn.mockResolvedValue([active]);

    const result = await resumeStream("stream-uuid-1");

    expect(result.status).toBe("ACTIVE");
  });

  it("throws StreamTransitionError when stream is ACTIVE (cannot resume an active stream)", async () => {
    const active = makeStream({ status: "ACTIVE" });
    mockSelectLimitFn.mockResolvedValue([active]);

    const err = await resumeStream("stream-uuid-1").catch((e) => e);
    expect(err).toBeInstanceOf(StreamTransitionError);
    expect(err.currentStatus).toBe("ACTIVE");
    expect(err.targetStatus).toBe("ACTIVE");
  });

  it("throws StreamTransitionError when stream is SETTLED", async () => {
    const settled = makeStream({ status: "SETTLED" });
    mockSelectLimitFn.mockResolvedValue([settled]);

    await expect(resumeStream("stream-uuid-1")).rejects.toBeInstanceOf(StreamTransitionError);
  });

  it("throws StreamTransitionError when stream is EXHAUSTED", async () => {
    const exhausted = makeStream({ status: "EXHAUSTED" });
    mockSelectLimitFn.mockResolvedValue([exhausted]);

    await expect(resumeStream("stream-uuid-1")).rejects.toBeInstanceOf(StreamTransitionError);
  });

  it("throws StreamNotFoundError when stream is missing", async () => {
    mockSelectLimitFn.mockResolvedValue([]);

    await expect(resumeStream("missing-id")).rejects.toBeInstanceOf(StreamNotFoundError);
  });

  it("throws StreamTransitionError on concurrent modification (update returns no row)", async () => {
    const paused = makeStream({ status: "PAUSED" });
    mockSelectLimitFn.mockResolvedValue([paused]);
    mockUpdateReturningFn.mockResolvedValue([]);

    await expect(resumeStream("stream-uuid-1")).rejects.toBeInstanceOf(StreamTransitionError);
  });
});

// ---------------------------------------------------------------------------
// settleStream
// ---------------------------------------------------------------------------

describe("settleStream", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("settles an ACTIVE stream and sets status SETTLED", async () => {
    const active = makeStream({ status: "ACTIVE", spent: "42.5" });
    const settled = makeStream({ status: "SETTLED", spent: "42.5", settledAt: new Date() });
    mockSelectLimitFn.mockResolvedValue([active]);
    mockUpdateReturningFn.mockResolvedValue([settled]);

    const result = await settleStream("stream-uuid-1");

    expect(result.status).toBe("SETTLED");
  });

  it("settles a PAUSED stream", async () => {
    const paused = makeStream({ status: "PAUSED" });
    const settled = makeStream({ status: "SETTLED" });
    mockSelectLimitFn.mockResolvedValue([paused]);
    mockUpdateReturningFn.mockResolvedValue([settled]);

    const result = await settleStream("stream-uuid-1");
    expect(result.status).toBe("SETTLED");
  });

  it("settles an EXHAUSTED stream", async () => {
    const exhausted = makeStream({ status: "EXHAUSTED", spent: "100.0" });
    const settled = makeStream({ status: "SETTLED", spent: "100.0" });
    mockSelectLimitFn.mockResolvedValue([exhausted]);
    mockUpdateReturningFn.mockResolvedValue([settled]);

    const result = await settleStream("stream-uuid-1");
    expect(result.status).toBe("SETTLED");
  });

  it("throws StreamTransitionError when stream is already SETTLED", async () => {
    const settled = makeStream({ status: "SETTLED" });
    mockSelectLimitFn.mockResolvedValue([settled]);

    const err = await settleStream("stream-uuid-1").catch((e) => e);
    expect(err).toBeInstanceOf(StreamTransitionError);
    expect(err.code).toBe("INVALID_STREAM_TRANSITION");
  });

  it("throws StreamNotFoundError when stream is missing", async () => {
    mockSelectLimitFn.mockResolvedValue([]);

    await expect(settleStream("missing-id")).rejects.toBeInstanceOf(StreamNotFoundError);
  });

  it("throws StreamTransitionError on concurrent modification (update returns no row)", async () => {
    const active = makeStream({ status: "ACTIVE" });
    mockSelectLimitFn.mockResolvedValue([active]);
    mockUpdateReturningFn.mockResolvedValue([]);

    await expect(settleStream("stream-uuid-1")).rejects.toBeInstanceOf(StreamTransitionError);
  });
});

// ---------------------------------------------------------------------------
// getStreamStatus
// ---------------------------------------------------------------------------

describe("getStreamStatus", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calculates remainingBudget correctly", async () => {
    const stream = makeStream({ totalBudget: "100.0", spent: "30.0", status: "ACTIVE" });
    mockSelectLimitFn.mockResolvedValue([stream]);

    const result = await getStreamStatus("stream-uuid-1");

    expect(result.remainingBudget).toBe("70");
  });

  it("calculates usagePercent correctly (30% used)", async () => {
    const stream = makeStream({ totalBudget: "100.0", spent: "30.0", status: "ACTIVE" });
    mockSelectLimitFn.mockResolvedValue([stream]);

    const result = await getStreamStatus("stream-uuid-1");

    expect(result.usagePercent).toBe(30);
  });

  it("returns usagePercent 0 when no budget (division-by-zero guard)", async () => {
    const stream = makeStream({ totalBudget: "0", spent: "0", status: "ACTIVE" });
    mockSelectLimitFn.mockResolvedValue([stream]);

    const result = await getStreamStatus("stream-uuid-1");

    expect(result.usagePercent).toBe(0);
  });

  it("returns projectedExhaustionAt as Date when stream is ACTIVE with spend history", async () => {
    const startedAt = new Date(Date.now() - 60_000); // started 1 minute ago
    const stream = makeStream({
      status: "ACTIVE",
      totalBudget: "100.0",
      spent: "10.0",
      startedAt,
    });
    mockSelectLimitFn.mockResolvedValue([stream]);

    const result = await getStreamStatus("stream-uuid-1");

    expect(result.projectedExhaustionAt).toBeInstanceOf(Date);
  });

  it("returns projectedExhaustionAt null when spent is 0", async () => {
    const stream = makeStream({ status: "ACTIVE", spent: "0", totalBudget: "100.0" });
    mockSelectLimitFn.mockResolvedValue([stream]);

    const result = await getStreamStatus("stream-uuid-1");

    expect(result.projectedExhaustionAt).toBeNull();
  });

  it("returns projectedExhaustionAt null when stream is PAUSED", async () => {
    const stream = makeStream({ status: "PAUSED", spent: "50.0", totalBudget: "100.0" });
    mockSelectLimitFn.mockResolvedValue([stream]);

    const result = await getStreamStatus("stream-uuid-1");

    expect(result.projectedExhaustionAt).toBeNull();
  });

  it("returns projectedExhaustionAt null when remaining budget is 0", async () => {
    const startedAt = new Date(Date.now() - 60_000);
    const stream = makeStream({
      status: "ACTIVE",
      totalBudget: "100.0",
      spent: "100.0",
      startedAt,
    });
    mockSelectLimitFn.mockResolvedValue([stream]);

    const result = await getStreamStatus("stream-uuid-1");

    expect(result.projectedExhaustionAt).toBeNull();
  });

  it("includes the stream object in result", async () => {
    const stream = makeStream();
    mockSelectLimitFn.mockResolvedValue([stream]);

    const result = await getStreamStatus("stream-uuid-1");

    expect(result.stream).toBe(stream);
  });

  it("throws StreamNotFoundError when stream is missing", async () => {
    mockSelectLimitFn.mockResolvedValue([]);

    await expect(getStreamStatus("missing-id")).rejects.toBeInstanceOf(StreamNotFoundError);
  });

  it("auto-settles expired ACTIVE stream — subsequent fetch returns SETTLED", async () => {
    const expiredActive = makeStream({
      status: "ACTIVE",
      expiresAt: new Date("2000-01-01T00:00:00.000Z"), // expired in the past
    });
    const settledAfterExpiry = makeStream({
      status: "SETTLED",
      settledAt: new Date(),
    });
    // getStreamOrThrow: first select returns expired row, then update, then re-select returns settled
    mockSelectLimitFn
      .mockResolvedValueOnce([expiredActive])   // initial fetch
      .mockResolvedValueOnce([settledAfterExpiry]); // re-fetch after auto-settle
    mockUpdateReturningFn.mockResolvedValue([settledAfterExpiry]);

    const result = await getStreamStatus("stream-uuid-1");

    // projectedExhaustionAt is null because status is SETTLED (not ACTIVE)
    expect(result.projectedExhaustionAt).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Error classes
// ---------------------------------------------------------------------------

describe("StreamNotFoundError", () => {
  it("has code NOT_FOUND", () => {
    const err = new StreamNotFoundError("abc");
    expect(err.code).toBe("NOT_FOUND");
  });

  it("message includes the stream id", () => {
    const err = new StreamNotFoundError("abc");
    expect(err.message).toContain("abc");
  });

  it("name is StreamNotFoundError", () => {
    const err = new StreamNotFoundError("abc");
    expect(err.name).toBe("StreamNotFoundError");
  });
});

describe("StreamTransitionError", () => {
  it("has code INVALID_STREAM_TRANSITION", () => {
    const err = new StreamTransitionError("s1", "ACTIVE", "PAUSED");
    expect(err.code).toBe("INVALID_STREAM_TRANSITION");
  });

  it("exposes streamId, currentStatus, targetStatus", () => {
    const err = new StreamTransitionError("s1", "ACTIVE", "PAUSED");
    expect(err.streamId).toBe("s1");
    expect(err.currentStatus).toBe("ACTIVE");
    expect(err.targetStatus).toBe("PAUSED");
  });

  it("uses provided reason as message when given", () => {
    const err = new StreamTransitionError("s1", "ACTIVE", "PAUSED", "custom reason");
    expect(err.message).toBe("custom reason");
  });

  it("generates a default message when no reason provided", () => {
    const err = new StreamTransitionError("s1", "ACTIVE", "PAUSED");
    expect(err.message).toContain("s1");
    expect(err.message).toContain("ACTIVE");
    expect(err.message).toContain("PAUSED");
  });
});

describe("StreamBudgetExceededError", () => {
  it("has code BUDGET_EXCEEDED", () => {
    const err = new StreamBudgetExceededError("s1", "50", "30");
    expect(err.code).toBe("BUDGET_EXCEEDED");
  });

  it("exposes streamId, requested, remaining", () => {
    const err = new StreamBudgetExceededError("s1", "50", "30");
    expect(err.streamId).toBe("s1");
    expect(err.requested).toBe("50");
    expect(err.remaining).toBe("30");
  });

  it("message includes all key values", () => {
    const err = new StreamBudgetExceededError("s1", "50", "30");
    expect(err.message).toContain("s1");
    expect(err.message).toContain("50");
    expect(err.message).toContain("30");
  });
});
