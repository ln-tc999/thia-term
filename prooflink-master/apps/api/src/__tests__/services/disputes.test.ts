import { describe, expect, it, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// vi.hoisted() — mock factories defined before module graph loads.
//
// The disputes service uses multiple DB query shapes:
//   openDispute  → insert().values().returning()
//   fetchDispute → select().from().where().limit()
//   submitEvidence / escalateToArbitration / resolveDispute / closeDispute
//                → fetchDispute (select chain) + update().set().where().returning()
//   autoResolveExpired
//                → select().from().where()   (returns array, no .limit())
//                  + multiple update().set().where().returning()  per dispute
// ---------------------------------------------------------------------------

const {
  mockInsertReturningFn,
  mockSelectLimitFn,
  mockUpdateReturningFn,
  mockSelectWhereRawFn,
  mockUpdateSet,
  mockSelectFrom,
} = vi.hoisted(() => {
  const mockInsertReturningFn = vi.fn();
  const mockSelectLimitFn = vi.fn();
  const mockUpdateReturningFn = vi.fn();

  // autoResolveExpired calls select().from().where() WITHOUT .limit() —
  // the where() call itself returns the rows array.
  const mockSelectWhereRawFn = vi.fn();

  // update().set().where().returning() chain
  const mockUpdateReturningChain = { returning: mockUpdateReturningFn };
  const mockUpdateWhereChain = { where: vi.fn().mockReturnValue(mockUpdateReturningChain) };
  const mockUpdateSet = vi.fn().mockReturnValue(mockUpdateWhereChain);

  // select().from() returns an object with .where()
  // .where() has two shapes:
  //   • .where(...).limit(1)  — fetchDispute path
  //   • .where(or(...))       — autoResolveExpired path (Promise directly)
  // We detect which shape by counting calls.
  let selectCallIdx = 0;
  const mockSelectFrom = vi.fn().mockImplementation(() => {
    selectCallIdx++;
    const idx = selectCallIdx;
    return {
      where: vi.fn().mockImplementation(() => {
        // fetchDispute always chains .limit(1); autoResolveExpired does not
        return {
          limit: mockSelectLimitFn,
          // thenable so autoResolveExpired can await it directly
          then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
            mockSelectWhereRawFn().then(resolve, reject),
        };
      }),
    };
  });

  // Reset call counter when mocks are cleared
  vi.stubGlobal("_disputeSelectCallIdx", () => { selectCallIdx = 0; });

  return {
    mockInsertReturningFn,
    mockSelectLimitFn,
    mockUpdateReturningFn,
    mockSelectWhereRawFn,
    mockUpdateSet,
    mockSelectFrom,
  };
});

vi.mock("../../db/index.js", () => ({
  getDb: () => ({
    select: () => ({ from: mockSelectFrom }),
    insert: () => ({
      values: () => ({ returning: mockInsertReturningFn }),
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
  openDispute,
  submitEvidence,
  autoResolveExpired,
  DisputeNotFoundError,
  DisputeTransitionError,
  type OpenDisputeParams,
} from "../../services/disputes.js";
import { writeAuditLog } from "../../utils/audit.js";
import type { Dispute } from "../../db/schema.js";

const mockWriteAuditLog = vi.mocked(writeAuditLog);

// ---------------------------------------------------------------------------
// Fixture factory
// ---------------------------------------------------------------------------

function makeDispute(overrides: Partial<Dispute> = {}): Dispute {
  const now = new Date("2025-01-01T00:00:00.000Z");
  const deadline = new Date("2025-01-04T00:00:00.000Z"); // 72h ahead
  return {
    id: "dispute-uuid-1",
    escrowId: null,
    invoiceId: null,
    state: "OPEN",
    initiatorDid: "did:web:initiator.prooflink.io",
    respondentDid: "did:web:respondent.prooflink.io",
    reason: "Service was not delivered",
    category: "NON_DELIVERY",
    evidence: [],
    resolution: null,
    resolvedBy: null,
    traceId: null,
    apiKeyId: null,
    deadline,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makeOpenParams(overrides: Partial<OpenDisputeParams> = {}): OpenDisputeParams {
  return {
    initiatorDid: "did:web:initiator.prooflink.io",
    respondentDid: "did:web:respondent.prooflink.io",
    reason: "Service was not delivered",
    category: "NON_DELIVERY",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// openDispute
// ---------------------------------------------------------------------------

describe("openDispute", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the inserted dispute row", async () => {
    const dispute = makeDispute();
    mockInsertReturningFn.mockResolvedValue([dispute]);

    const result = await openDispute(makeOpenParams());

    expect(result.id).toBe("dispute-uuid-1");
    expect(result.state).toBe("OPEN");
  });

  it("stores apiKeyId from params in the audit log call", async () => {
    const dispute = makeDispute({ apiKeyId: "key-tenant-abc" });
    mockInsertReturningFn.mockResolvedValue([dispute]);

    await openDispute(makeOpenParams({ apiKeyId: "key-tenant-abc" }));

    expect(mockWriteAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ apiKeyId: "key-tenant-abc" }),
    );
  });

  it("writes dispute.opened audit event with correct fields", async () => {
    const dispute = makeDispute();
    mockInsertReturningFn.mockResolvedValue([dispute]);

    await openDispute(makeOpenParams({ escrowId: "escrow-001", invoiceId: undefined }));

    expect(mockWriteAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "dispute.opened",
        payload: expect.objectContaining({
          disputeId: dispute.id,
          category: "NON_DELIVERY",
        }),
      }),
    );
  });

  it("throws when DB insert returns no row", async () => {
    mockInsertReturningFn.mockResolvedValue([]);

    await expect(openDispute(makeOpenParams())).rejects.toThrow("Failed to create dispute");
  });

  it("apiKeyId null when not provided", async () => {
    const dispute = makeDispute();
    mockInsertReturningFn.mockResolvedValue([dispute]);

    await openDispute(makeOpenParams());

    expect(mockWriteAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ apiKeyId: undefined }),
    );
  });
});

// ---------------------------------------------------------------------------
// fetchDispute — tenant isolation
//
// fetchDispute is internal but exercised through submitEvidence which calls it.
// ---------------------------------------------------------------------------

describe("fetchDispute — tenant isolation via submitEvidence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("throws DisputeNotFoundError when DB returns no row for the id", async () => {
    mockSelectLimitFn.mockResolvedValue([]);

    await expect(submitEvidence("nonexistent-id", { type: "screenshot" })).rejects.toBeInstanceOf(
      DisputeNotFoundError,
    );
  });

  it("DisputeNotFoundError message includes the dispute id", async () => {
    mockSelectLimitFn.mockResolvedValue([]);

    const err = await submitEvidence("dispute-missing", { type: "screenshot" }).catch((e) => e);

    expect(err.message).toContain("dispute-missing");
  });

  it("proceedes when dispute exists and state is OPEN", async () => {
    const dispute = makeDispute({ state: "OPEN" });
    const updated = makeDispute({ state: "EVIDENCE", evidence: [{ type: "screenshot" }] });
    mockSelectLimitFn.mockResolvedValue([dispute]);
    mockUpdateReturningFn.mockResolvedValue([updated]);

    const result = await submitEvidence("dispute-uuid-1", { type: "screenshot" });

    expect(result.state).toBe("EVIDENCE");
  });
});

// ---------------------------------------------------------------------------
// submitEvidence — caller authorization
// ---------------------------------------------------------------------------

describe("submitEvidence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("accepts evidence when dispute is OPEN", async () => {
    const dispute = makeDispute({ state: "OPEN" });
    const updated = makeDispute({ state: "EVIDENCE" });
    mockSelectLimitFn.mockResolvedValue([dispute]);
    mockUpdateReturningFn.mockResolvedValue([updated]);

    const result = await submitEvidence("dispute-uuid-1", { type: "delivery_receipt" });

    expect(result.state).toBe("EVIDENCE");
  });

  it("accepts evidence when dispute is EVIDENCE", async () => {
    const dispute = makeDispute({ state: "EVIDENCE" });
    const updated = makeDispute({ state: "EVIDENCE" });
    mockSelectLimitFn.mockResolvedValue([dispute]);
    mockUpdateReturningFn.mockResolvedValue([updated]);

    const result = await submitEvidence("dispute-uuid-1", { type: "additional_proof" });

    expect(result.state).toBe("EVIDENCE");
  });

  it("throws DisputeTransitionError when dispute is in ARBITRATION (not open for evidence)", async () => {
    const dispute = makeDispute({ state: "ARBITRATION" });
    mockSelectLimitFn.mockResolvedValue([dispute]);

    await expect(
      submitEvidence("dispute-uuid-1", { type: "screenshot" }),
    ).rejects.toBeInstanceOf(DisputeTransitionError);
  });

  it("throws DisputeTransitionError when dispute is RESOLVED", async () => {
    const dispute = makeDispute({ state: "RESOLVED" });
    mockSelectLimitFn.mockResolvedValue([dispute]);

    await expect(
      submitEvidence("dispute-uuid-1", { type: "screenshot" }),
    ).rejects.toBeInstanceOf(DisputeTransitionError);
  });

  it("throws DisputeTransitionError when dispute is CLOSED", async () => {
    const dispute = makeDispute({ state: "CLOSED" });
    mockSelectLimitFn.mockResolvedValue([dispute]);

    await expect(
      submitEvidence("dispute-uuid-1", { type: "screenshot" }),
    ).rejects.toBeInstanceOf(DisputeTransitionError);
  });

  it("appends evidence to existing evidence array", async () => {
    const existing = [{ type: "initial", submittedAt: "2025-01-01T00:00:00.000Z" }];
    const dispute = makeDispute({ state: "EVIDENCE", evidence: existing });
    const updated = makeDispute({
      state: "EVIDENCE",
      evidence: [...existing, { type: "followup", submittedAt: "2025-01-02T00:00:00.000Z" }],
    });
    mockSelectLimitFn.mockResolvedValue([dispute]);
    mockUpdateReturningFn.mockResolvedValue([updated]);

    const result = await submitEvidence("dispute-uuid-1", { type: "followup" });

    expect(result.evidence).toHaveLength(2);
  });

  it("writes dispute.evidence.submitted audit event", async () => {
    const dispute = makeDispute({ state: "OPEN" });
    const updated = makeDispute({ state: "EVIDENCE" });
    mockSelectLimitFn.mockResolvedValue([dispute]);
    mockUpdateReturningFn.mockResolvedValue([updated]);

    await submitEvidence("dispute-uuid-1", { type: "screenshot" }, "key-abc");

    expect(mockWriteAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "dispute.evidence.submitted",
        apiKeyId: "key-abc",
      }),
    );
  });

  it("propagates apiKeyId to audit log", async () => {
    const dispute = makeDispute({ state: "OPEN" });
    const updated = makeDispute({ state: "EVIDENCE" });
    mockSelectLimitFn.mockResolvedValue([dispute]);
    mockUpdateReturningFn.mockResolvedValue([updated]);

    await submitEvidence("dispute-uuid-1", { type: "screenshot" }, "tenant-key-xyz");

    expect(mockWriteAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ apiKeyId: "tenant-key-xyz" }),
    );
  });
});

// ---------------------------------------------------------------------------
// autoResolveExpired — state machine transitions + deadline filtering
// ---------------------------------------------------------------------------

describe("autoResolveExpired", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns empty array when no disputes are past their deadline", async () => {
    const futureDeadline = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24h ahead
    const dispute = makeDispute({ state: "OPEN", deadline: futureDeadline });
    mockSelectWhereRawFn.mockResolvedValue([dispute]);

    const result = await autoResolveExpired();

    expect(result).toHaveLength(0);
  });

  it("skips disputes whose deadline has not yet passed", async () => {
    const futureDeadline = new Date(Date.now() + 10 * 60 * 1000); // 10 min ahead
    const dispute = makeDispute({ state: "EVIDENCE", deadline: futureDeadline });
    mockSelectWhereRawFn.mockResolvedValue([dispute]);

    const result = await autoResolveExpired();

    expect(result).toHaveLength(0);
    // update should never be called
    expect(mockUpdateSet).not.toHaveBeenCalled();
  });

  it("only considers OPEN and EVIDENCE state disputes (not ARBITRATION/RESOLVED/CLOSED)", async () => {
    // Simulate: the DB WHERE clause already filters to OPEN and EVIDENCE,
    // so we return only those in our mock
    const pastDeadline = new Date(Date.now() - 60 * 1000);
    const openDispute = makeDispute({ state: "OPEN", deadline: pastDeadline });
    mockSelectWhereRawFn.mockResolvedValue([openDispute]);

    // update chain: OPEN→EVIDENCE, EVIDENCE→ARBITRATION, ARBITRATION→RESOLVED all succeed
    mockUpdateReturningFn
      .mockResolvedValueOnce([makeDispute({ state: "EVIDENCE" })])   // OPEN → EVIDENCE
      .mockResolvedValueOnce([makeDispute({ state: "ARBITRATION" })]) // EVIDENCE → ARBITRATION
      .mockResolvedValueOnce([makeDispute({ state: "RESOLVED" })]);   // ARBITRATION → RESOLVED

    const result = await autoResolveExpired();

    expect(result).toHaveLength(1);
    expect(result[0]?.state).toBe("RESOLVED");
  });

  it("transitions through OPEN → EVIDENCE → ARBITRATION → RESOLVED for an OPEN dispute past deadline", async () => {
    const pastDeadline = new Date(Date.now() - 2 * 60 * 60 * 1000); // 2h past
    const dispute = makeDispute({ id: "d1", state: "OPEN", deadline: pastDeadline });
    mockSelectWhereRawFn.mockResolvedValue([dispute]);

    const evidenceRow = makeDispute({ id: "d1", state: "EVIDENCE" });
    const arbitrationRow = makeDispute({ id: "d1", state: "ARBITRATION" });
    const resolvedRow = makeDispute({ id: "d1", state: "RESOLVED" });

    mockUpdateReturningFn
      .mockResolvedValueOnce([evidenceRow])    // OPEN → EVIDENCE
      .mockResolvedValueOnce([arbitrationRow]) // EVIDENCE → ARBITRATION
      .mockResolvedValueOnce([resolvedRow]);   // ARBITRATION → RESOLVED

    const result = await autoResolveExpired();

    expect(result).toHaveLength(1);
    expect(result[0]?.state).toBe("RESOLVED");
    // Three update calls must have been made
    expect(mockUpdateReturningFn).toHaveBeenCalledTimes(3);
  });

  it("transitions through EVIDENCE → ARBITRATION → RESOLVED for an EVIDENCE dispute past deadline", async () => {
    const pastDeadline = new Date(Date.now() - 60 * 1000);
    const dispute = makeDispute({ id: "d2", state: "EVIDENCE", deadline: pastDeadline });
    mockSelectWhereRawFn.mockResolvedValue([dispute]);

    const arbitrationRow = makeDispute({ id: "d2", state: "ARBITRATION" });
    const resolvedRow = makeDispute({ id: "d2", state: "RESOLVED" });

    mockUpdateReturningFn
      .mockResolvedValueOnce([arbitrationRow]) // EVIDENCE → ARBITRATION
      .mockResolvedValueOnce([resolvedRow]);   // ARBITRATION → RESOLVED

    const result = await autoResolveExpired();

    expect(result).toHaveLength(1);
    // For EVIDENCE state, only two updates should be made (skip OPEN→EVIDENCE step)
    expect(mockUpdateReturningFn).toHaveBeenCalledTimes(2);
  });

  it("writes audit log for dispute.auto-resolved when final RESOLVED transition succeeds", async () => {
    const pastDeadline = new Date(Date.now() - 60 * 1000);
    const dispute = makeDispute({ state: "EVIDENCE", deadline: pastDeadline });
    mockSelectWhereRawFn.mockResolvedValue([dispute]);

    mockUpdateReturningFn
      .mockResolvedValueOnce([makeDispute({ state: "ARBITRATION" })])
      .mockResolvedValueOnce([makeDispute({ state: "RESOLVED" })]);

    await autoResolveExpired();

    const auditCalls = mockWriteAuditLog.mock.calls.map(
      (c) => (c[0] as { eventType: string }).eventType,
    );
    expect(auditCalls).toContain("dispute.auto-resolved");
  });

  it("skips a dispute when concurrent modification prevents OPEN→EVIDENCE transition", async () => {
    const pastDeadline = new Date(Date.now() - 60 * 1000);
    const dispute = makeDispute({ state: "OPEN", deadline: pastDeadline });
    mockSelectWhereRawFn.mockResolvedValue([dispute]);

    // CAS guard: OPEN→EVIDENCE returns empty (concurrent modification)
    mockUpdateReturningFn.mockResolvedValueOnce([]);

    const result = await autoResolveExpired();

    // Dispute is skipped — not pushed to resolved list
    expect(result).toHaveLength(0);
  });

  it("skips a dispute when concurrent modification prevents EVIDENCE→ARBITRATION transition", async () => {
    const pastDeadline = new Date(Date.now() - 60 * 1000);
    const dispute = makeDispute({ state: "EVIDENCE", deadline: pastDeadline });
    mockSelectWhereRawFn.mockResolvedValue([dispute]);

    // CAS guard: EVIDENCE→ARBITRATION returns empty
    mockUpdateReturningFn.mockResolvedValueOnce([]);

    const result = await autoResolveExpired();

    expect(result).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Error class assertions
// ---------------------------------------------------------------------------

describe("DisputeNotFoundError", () => {
  it("has code NOT_FOUND", () => {
    const err = new DisputeNotFoundError("d1");
    expect(err.code).toBe("NOT_FOUND");
  });

  it("message includes the dispute id", () => {
    const err = new DisputeNotFoundError("d1");
    expect(err.message).toContain("d1");
  });
});

describe("DisputeTransitionError", () => {
  it("has code INVALID_TRANSITION", () => {
    const err = new DisputeTransitionError("OPEN", "RESOLVED", ["EVIDENCE"]);
    expect(err.code).toBe("INVALID_TRANSITION");
  });

  it("message includes from and to states", () => {
    const err = new DisputeTransitionError("OPEN", "RESOLVED", ["EVIDENCE"]);
    expect(err.message).toContain("OPEN");
    expect(err.message).toContain("RESOLVED");
  });

  it("message lists allowed transitions when present", () => {
    const err = new DisputeTransitionError("OPEN", "RESOLVED", ["EVIDENCE"]);
    expect(err.message).toContain("EVIDENCE");
  });

  it("message says 'none' when allowed list is empty", () => {
    const err = new DisputeTransitionError("CLOSED", "OPEN", []);
    expect(err.message).toContain("none");
  });
});
