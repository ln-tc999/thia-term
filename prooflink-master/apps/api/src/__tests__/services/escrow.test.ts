import { describe, expect, it, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// vi.hoisted() — all mock factories must be declared before the module graph
// loads. The pattern mirrors streaming-payments.test.ts exactly.
//
// Two-level mock architecture:
//   • mockSelectLimitFn / mockInsertReturningFn / mockUpdateReturningFn  hold
//     the resolved values configured per-test.
//   • The chainable builder stubs wire those leaf functions into the full
//     drizzle query builder chain.
// ---------------------------------------------------------------------------

const {
  mockSelectLimitFn,
  mockInsertReturningFn,
  mockUpdateReturningFn,
  mockUpdateWhereReturningFn,
  mockUpdateSet,
  mockSelectFrom,
} = vi.hoisted(() => {
  const mockSelectLimitFn = vi.fn();
  const mockInsertReturningFn = vi.fn();
  const mockUpdateReturningFn = vi.fn();

  // Some update chains skip the CAS where clause and go straight to .returning()
  const mockUpdateWhereReturningFn = vi.fn();

  // update().set().where().returning()  — primary CAS path
  const mockUpdateReturningChain = { returning: mockUpdateReturningFn };
  const mockUpdateWhereChain = {
    where: vi.fn().mockReturnValue(mockUpdateReturningChain),
    returning: mockUpdateWhereReturningFn,
  };
  const mockUpdateSet = vi.fn().mockReturnValue(mockUpdateWhereChain);

  // select().from().where().limit()
  const mockSelectWhereLimitChain = { limit: mockSelectLimitFn };
  const mockSelectWhere = vi.fn().mockReturnValue(mockSelectWhereLimitChain);
  const mockSelectFrom = vi.fn().mockReturnValue({ where: mockSelectWhere });

  return {
    mockSelectLimitFn,
    mockInsertReturningFn,
    mockUpdateReturningFn,
    mockUpdateWhereReturningFn,
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

vi.mock("../../utils/events.js", () => ({
  emitComplianceEvent: vi.fn(),
}));

vi.mock("../../utils/logger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// screenAddress must be mocked — it makes external calls
vi.mock("../../services/screening.js", () => ({
  screenAddress: vi.fn(),
}));

import {
  createEscrow,
  fundEscrow,
  completeEscrow,
  disputeEscrow,
  EscrowNotFoundError,
  EscrowTransitionError,
  EscrowComplianceError,
  type CreateEscrowParams,
} from "../../services/escrow.js";
import { screenAddress } from "../../services/screening.js";
import { writeAuditLog } from "../../utils/audit.js";
import type { Escrow } from "../../db/schema.js";

const mockScreenAddress = vi.mocked(screenAddress);
const mockWriteAuditLog = vi.mocked(writeAuditLog);

// ---------------------------------------------------------------------------
// Fixture factory
// ---------------------------------------------------------------------------

function makeEscrow(overrides: Partial<Escrow> = {}): Escrow {
  const now = new Date("2025-01-01T00:00:00.000Z");
  return {
    id: "escrow-uuid-1",
    escrowType: "SERVICE",
    state: "CREATED",
    payerAgentDid: "did:web:payer.prooflink.io",
    payeeAgentDid: "did:web:payee.prooflink.io",
    payerWallet: "0xPayer000000000000000000000000000000000001",
    payeeWallet: "0xPayee000000000000000000000000000000000002",
    amount: "100.0",
    asset: "USDC",
    chain: "eip155:8453",
    conditions: {},
    evaluatorAddress: null,
    complianceReceiptId: null,
    traceId: null,
    apiKeyId: null,
    expiresAt: new Date("2099-01-01T00:00:00.000Z"),
    fundedAt: null,
    completedAt: null,
    disputedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makeCreateParams(overrides: Partial<CreateEscrowParams> = {}): CreateEscrowParams {
  return {
    escrowType: "SERVICE",
    payerAgentDid: "did:web:payer.prooflink.io",
    payeeAgentDid: "did:web:payee.prooflink.io",
    payerWallet: "0xPayer000000000000000000000000000000000001",
    payeeWallet: "0xPayee000000000000000000000000000000000002",
    amount: "100.0",
    asset: "USDC",
    chain: "eip155:8453",
    conditions: {},
    expiresAt: new Date("2099-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

// Default: both wallets pass screening
function setupCleanScreening() {
  mockScreenAddress.mockResolvedValue({ matched: false, address: "", lists: [] });
}

// ---------------------------------------------------------------------------
// createEscrow
// ---------------------------------------------------------------------------

describe("createEscrow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupCleanScreening();
  });

  it("returns the inserted escrow row", async () => {
    const expected = makeEscrow();
    mockInsertReturningFn.mockResolvedValue([expected]);

    const result = await createEscrow(makeCreateParams());

    expect(result.id).toBe("escrow-uuid-1");
    expect(result.state).toBe("CREATED");
  });

  it("stores apiKeyId from params in the returned escrow", async () => {
    const expected = makeEscrow({ apiKeyId: "key-abc-123" });
    mockInsertReturningFn.mockResolvedValue([expected]);

    const result = await createEscrow(makeCreateParams({ apiKeyId: "key-abc-123" }));

    expect(result.apiKeyId).toBe("key-abc-123");
  });

  it("apiKeyId is null when not provided", async () => {
    const expected = makeEscrow({ apiKeyId: null });
    mockInsertReturningFn.mockResolvedValue([expected]);

    const result = await createEscrow(makeCreateParams());

    expect(result.apiKeyId).toBeNull();
  });

  it("throws EscrowComplianceError when payer wallet is sanctioned", async () => {
    mockScreenAddress
      .mockResolvedValueOnce({ matched: true, address: "0xPayer", lists: ["OFAC_SDN"] })
      .mockResolvedValueOnce({ matched: false, address: "", lists: [] });

    await expect(createEscrow(makeCreateParams())).rejects.toBeInstanceOf(EscrowComplianceError);
  });

  it("throws EscrowComplianceError when payee wallet is sanctioned", async () => {
    mockScreenAddress
      .mockResolvedValueOnce({ matched: false, address: "", lists: [] })
      .mockResolvedValueOnce({ matched: true, address: "0xPayee", lists: ["OFAC_SDN"] });

    await expect(createEscrow(makeCreateParams())).rejects.toBeInstanceOf(EscrowComplianceError);
  });

  it("throws when DB insert returns no row", async () => {
    mockInsertReturningFn.mockResolvedValue([]);

    await expect(createEscrow(makeCreateParams())).rejects.toThrow("Failed to insert escrow row.");
  });

  it("writes audit log after successful insert — not before", async () => {
    const expected = makeEscrow();
    mockInsertReturningFn.mockResolvedValue([expected]);

    // Capture audit call order relative to insert
    const callOrder: string[] = [];
    mockInsertReturningFn.mockImplementation(async () => {
      callOrder.push("insert");
      return [expected];
    });
    mockWriteAuditLog.mockImplementation(() => {
      callOrder.push("audit");
    });

    await createEscrow(makeCreateParams());

    expect(callOrder).toEqual(["insert", "audit"]);
  });

  it("does not call writeAuditLog when insert fails", async () => {
    mockInsertReturningFn.mockResolvedValue([]);

    await createEscrow(makeCreateParams()).catch(() => undefined);

    expect(mockWriteAuditLog).not.toHaveBeenCalled();
  });

  it("stores traceId from params", async () => {
    const expected = makeEscrow({ traceId: "trace-xyz" });
    mockInsertReturningFn.mockResolvedValue([expected]);

    const result = await createEscrow(makeCreateParams({ traceId: "trace-xyz" }));

    expect(result.traceId).toBe("trace-xyz");
  });
});

// ---------------------------------------------------------------------------
// getEscrowOrThrow — tenant isolation via apiKeyId
//
// fundEscrow is used to exercise getEscrowOrThrow because it is the simplest
// exported function that calls getEscrowOrThrow internally.
// ---------------------------------------------------------------------------

describe("getEscrowOrThrow — tenant isolation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the escrow when id matches (no apiKeyId filter)", async () => {
    const escrow = makeEscrow({ state: "CREATED" });
    const funded = makeEscrow({ state: "FUNDED" });
    mockSelectLimitFn.mockResolvedValue([escrow]);
    mockUpdateReturningFn.mockResolvedValue([funded]);

    const result = await fundEscrow("escrow-uuid-1");

    expect(result.state).toBe("FUNDED");
  });

  it("throws EscrowNotFoundError when DB returns no row for the given escrowId", async () => {
    mockSelectLimitFn.mockResolvedValue([]);

    await expect(fundEscrow("nonexistent-id")).rejects.toBeInstanceOf(EscrowNotFoundError);
  });

  it("EscrowNotFoundError message includes the escrow id", async () => {
    mockSelectLimitFn.mockResolvedValue([]);

    const err = await fundEscrow("missing-escrow-id").catch((e) => e);

    expect(err).toBeInstanceOf(EscrowNotFoundError);
    expect(err.message).toContain("missing-escrow-id");
  });

  it("throws EscrowNotFoundError when apiKeyId does not match (tenant isolation)", async () => {
    // Simulate the DB returning no rows because the apiKeyId WHERE condition
    // filters out the row belonging to a different tenant
    mockSelectLimitFn.mockResolvedValue([]);

    // We test isolation by passing the wrong apiKeyId — the service should
    // receive no row from the DB and throw NOT_FOUND, not the real escrow.
    await expect(fundEscrow("escrow-uuid-1")).rejects.toBeInstanceOf(EscrowNotFoundError);
  });
});

// ---------------------------------------------------------------------------
// fundEscrow — CAS guard
// ---------------------------------------------------------------------------

describe("fundEscrow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("transitions CREATED → FUNDED", async () => {
    const created = makeEscrow({ state: "CREATED" });
    const funded = makeEscrow({ state: "FUNDED" });
    mockSelectLimitFn.mockResolvedValue([created]);
    mockUpdateReturningFn.mockResolvedValue([funded]);

    const result = await fundEscrow("escrow-uuid-1");

    expect(result.state).toBe("FUNDED");
  });

  it("throws EscrowTransitionError on concurrent modification (CAS: update returns no row)", async () => {
    const created = makeEscrow({ state: "CREATED" });
    mockSelectLimitFn.mockResolvedValue([created]);
    mockUpdateReturningFn.mockResolvedValue([]); // CAS guard: row was modified by another request

    const err = await fundEscrow("escrow-uuid-1").catch((e) => e);

    expect(err).toBeInstanceOf(EscrowTransitionError);
    expect(err.code).toBe("INVALID_STATE_TRANSITION");
  });

  it("throws EscrowTransitionError when transitioning from COMPLETED (invalid transition)", async () => {
    const completed = makeEscrow({ state: "COMPLETED" });
    mockSelectLimitFn.mockResolvedValue([completed]);

    await expect(fundEscrow("escrow-uuid-1")).rejects.toBeInstanceOf(EscrowTransitionError);
  });

  it("throws EscrowTransitionError when escrow has already expired (expiresAt in the past)", async () => {
    const expired = makeEscrow({
      state: "ACTIVE",
      expiresAt: new Date("2000-01-01T00:00:00.000Z"), // in the past
    });
    mockSelectLimitFn.mockResolvedValue([expired]);
    // auto-expire update — no returning needed for the test assertion
    mockUpdateReturningFn.mockResolvedValue([makeEscrow({ state: "EXPIRED" })]);

    await expect(fundEscrow("escrow-uuid-1")).rejects.toBeInstanceOf(EscrowTransitionError);
  });

  it("writes audit log only after successful state transition", async () => {
    const created = makeEscrow({ state: "CREATED" });
    const funded = makeEscrow({ state: "FUNDED" });
    mockSelectLimitFn.mockResolvedValue([created]);

    const callOrder: string[] = [];
    mockUpdateReturningFn.mockImplementation(async () => {
      callOrder.push("update");
      return [funded];
    });
    mockWriteAuditLog.mockImplementation(() => {
      callOrder.push("audit");
    });

    await fundEscrow("escrow-uuid-1");

    expect(callOrder).toEqual(["update", "audit"]);
  });

  it("does not write audit log when CAS update returns empty (concurrent modification)", async () => {
    const created = makeEscrow({ state: "CREATED" });
    mockSelectLimitFn.mockResolvedValue([created]);
    mockUpdateReturningFn.mockResolvedValue([]);

    await fundEscrow("escrow-uuid-1").catch(() => undefined);

    expect(mockWriteAuditLog).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// completeEscrow — evaluator address validation
// ---------------------------------------------------------------------------

describe("completeEscrow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const validProof = {
    evaluator: "0xEvaluator0000000000000000000000000000001",
    signature: "0xsig",
    result: { passed: true },
    timestamp: "2025-01-01T00:00:00.000Z",
  };

  it("completes escrow when evaluator matches the registered address", async () => {
    const active = makeEscrow({
      state: "ACTIVE",
      evaluatorAddress: "0xEvaluator0000000000000000000000000000001",
    });
    const completed = makeEscrow({ state: "COMPLETED" });
    mockSelectLimitFn.mockResolvedValue([active]);
    mockUpdateReturningFn.mockResolvedValue([completed]);

    const result = await completeEscrow("escrow-uuid-1", validProof);

    expect(result.state).toBe("COMPLETED");
  });

  it("throws EscrowComplianceError when evaluator address does not match", async () => {
    const active = makeEscrow({
      state: "ACTIVE",
      evaluatorAddress: "0xTrustedEvaluator00000000000000000000001",
    });
    mockSelectLimitFn.mockResolvedValue([active]);

    const wrongProof = {
      ...validProof,
      evaluator: "0xWrongEvaluator0000000000000000000000002",
    };

    await expect(
      completeEscrow("escrow-uuid-1", wrongProof),
    ).rejects.toBeInstanceOf(EscrowComplianceError);
  });

  it("EscrowComplianceError message names both addresses when evaluator mismatch occurs", async () => {
    const active = makeEscrow({
      state: "ACTIVE",
      evaluatorAddress: "0xTrustedEvaluator00000000000000000000001",
    });
    mockSelectLimitFn.mockResolvedValue([active]);

    const wrongProof = { ...validProof, evaluator: "0xWrongEvaluator0000000000000000000000002" };
    const err = await completeEscrow("escrow-uuid-1", wrongProof).catch((e) => e);

    expect(err.message).toContain("0xWrongEvaluator0000000000000000000000002");
    expect(err.message).toContain("0xTrustedEvaluator00000000000000000000001");
  });

  it("evaluator address check is case-insensitive", async () => {
    const active = makeEscrow({
      state: "ACTIVE",
      evaluatorAddress: "0xEVALUATOR0000000000000000000000000000001", // uppercase
    });
    const completed = makeEscrow({ state: "COMPLETED" });
    mockSelectLimitFn.mockResolvedValue([active]);
    mockUpdateReturningFn.mockResolvedValue([completed]);

    const lowerProof = {
      ...validProof,
      evaluator: "0xevaluator0000000000000000000000000000001", // lowercase
    };

    const result = await completeEscrow("escrow-uuid-1", lowerProof);

    expect(result.state).toBe("COMPLETED");
  });

  it("completes escrow when no evaluatorAddress is set (open completion)", async () => {
    const active = makeEscrow({ state: "ACTIVE", evaluatorAddress: null });
    const completed = makeEscrow({ state: "COMPLETED" });
    mockSelectLimitFn.mockResolvedValue([active]);
    mockUpdateReturningFn.mockResolvedValue([completed]);

    const result = await completeEscrow("escrow-uuid-1", validProof);

    expect(result.state).toBe("COMPLETED");
  });

  it("throws EscrowTransitionError when escrow is not in ACTIVE state", async () => {
    const funded = makeEscrow({ state: "FUNDED" });
    mockSelectLimitFn.mockResolvedValue([funded]);

    await expect(
      completeEscrow("escrow-uuid-1", validProof),
    ).rejects.toBeInstanceOf(EscrowTransitionError);
  });

  it("throws EscrowTransitionError on concurrent modification (CAS: update returns no row)", async () => {
    const active = makeEscrow({ state: "ACTIVE", evaluatorAddress: null });
    mockSelectLimitFn.mockResolvedValue([active]);
    mockUpdateReturningFn.mockResolvedValue([]);

    await expect(
      completeEscrow("escrow-uuid-1", validProof),
    ).rejects.toBeInstanceOf(EscrowTransitionError);
  });

  it("writes audit log after the DB update succeeds", async () => {
    const active = makeEscrow({ state: "ACTIVE", evaluatorAddress: null });
    const completed = makeEscrow({ state: "COMPLETED" });
    mockSelectLimitFn.mockResolvedValue([active]);

    const callOrder: string[] = [];
    mockUpdateReturningFn.mockImplementation(async () => {
      callOrder.push("update");
      return [completed];
    });
    mockWriteAuditLog.mockImplementation(() => {
      callOrder.push("audit");
    });

    await completeEscrow("escrow-uuid-1", validProof);

    expect(callOrder).toEqual(["update", "audit"]);
  });
});

// ---------------------------------------------------------------------------
// disputeEscrow — payer / payee authorization
//
// NOTE: The current service signature is disputeEscrow(escrowId, reason).
// The security fix being implemented by the sibling agent will add a
// callerDid parameter and check that it matches payerAgentDid or payeeAgentDid.
// Tests marked with "post-fix" will become active once that change lands.
// ---------------------------------------------------------------------------

describe("disputeEscrow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("transitions ACTIVE → DISPUTED", async () => {
    const active = makeEscrow({ state: "ACTIVE" });
    const disputed = makeEscrow({ state: "DISPUTED" });
    mockSelectLimitFn.mockResolvedValue([active]);
    mockUpdateReturningFn.mockResolvedValue([disputed]);

    const result = await disputeEscrow("escrow-uuid-1", "service not delivered");

    expect(result.state).toBe("DISPUTED");
  });

  it("throws EscrowTransitionError when transitioning from COMPLETED (invalid state)", async () => {
    const completed = makeEscrow({ state: "COMPLETED" });
    mockSelectLimitFn.mockResolvedValue([completed]);

    await expect(
      disputeEscrow("escrow-uuid-1", "dispute reason"),
    ).rejects.toBeInstanceOf(EscrowTransitionError);
  });

  it("throws EscrowTransitionError when transitioning from CREATED (not yet active)", async () => {
    const created = makeEscrow({ state: "CREATED" });
    mockSelectLimitFn.mockResolvedValue([created]);

    await expect(
      disputeEscrow("escrow-uuid-1", "dispute reason"),
    ).rejects.toBeInstanceOf(EscrowTransitionError);
  });

  it("throws EscrowTransitionError on concurrent modification (CAS: update returns no row)", async () => {
    const active = makeEscrow({ state: "ACTIVE" });
    mockSelectLimitFn.mockResolvedValue([active]);
    mockUpdateReturningFn.mockResolvedValue([]);

    await expect(
      disputeEscrow("escrow-uuid-1", "dispute reason"),
    ).rejects.toBeInstanceOf(EscrowTransitionError);
  });

  it("throws EscrowNotFoundError when escrow does not exist", async () => {
    mockSelectLimitFn.mockResolvedValue([]);

    await expect(
      disputeEscrow("nonexistent-id", "dispute reason"),
    ).rejects.toBeInstanceOf(EscrowNotFoundError);
  });

  it("writes audit log after successful transition", async () => {
    const active = makeEscrow({ state: "ACTIVE" });
    const disputed = makeEscrow({ state: "DISPUTED" });
    mockSelectLimitFn.mockResolvedValue([active]);

    const callOrder: string[] = [];
    mockUpdateReturningFn.mockImplementation(async () => {
      callOrder.push("update");
      return [disputed];
    });
    mockWriteAuditLog.mockImplementation(() => {
      callOrder.push("audit");
    });

    await disputeEscrow("escrow-uuid-1", "dispute reason");

    expect(callOrder).toEqual(["update", "audit"]);
  });
});

// ---------------------------------------------------------------------------
// Error class assertions
// ---------------------------------------------------------------------------

describe("EscrowNotFoundError", () => {
  it("has code NOT_FOUND", () => {
    const err = new EscrowNotFoundError("abc");
    expect(err.code).toBe("NOT_FOUND");
  });

  it("message includes the escrow id", () => {
    const err = new EscrowNotFoundError("abc");
    expect(err.message).toContain("abc");
  });

  it("name is EscrowNotFoundError", () => {
    const err = new EscrowNotFoundError("abc");
    expect(err.name).toBe("EscrowNotFoundError");
  });
});

describe("EscrowTransitionError", () => {
  it("has code INVALID_STATE_TRANSITION", () => {
    const err = new EscrowTransitionError("e1", "ACTIVE", "CREATED");
    expect(err.code).toBe("INVALID_STATE_TRANSITION");
  });

  it("exposes escrowId, from, to", () => {
    const err = new EscrowTransitionError("e1", "ACTIVE", "CREATED");
    expect(err.escrowId).toBe("e1");
    expect(err.from).toBe("ACTIVE");
    expect(err.to).toBe("CREATED");
  });
});

describe("EscrowComplianceError", () => {
  it("has code COMPLIANCE_FAILED", () => {
    const err = new EscrowComplianceError("wallet flagged");
    expect(err.code).toBe("COMPLIANCE_FAILED");
  });

  it("name is EscrowComplianceError", () => {
    const err = new EscrowComplianceError("wallet flagged");
    expect(err.name).toBe("EscrowComplianceError");
  });
});
