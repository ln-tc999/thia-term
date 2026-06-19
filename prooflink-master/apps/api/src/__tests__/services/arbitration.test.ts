import { describe, expect, it, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// vi.hoisted() — mock factories defined before the module graph loads.
//
// autoArbitrate uses three DB query shapes:
//   1. select().from(disputes).where().limit(1)    → fetch dispute
//   2. select().from(escrows).where().limit(1)     → fetch associated escrow
//   3. select().from(agents).where().limit(1)      → fetch agent (UNAUTHORIZED category)
//   4. update().set().where().returning()          → persist resolution with CAS guard
//
// We track select call order to route results to the right query.
// ---------------------------------------------------------------------------

const {
  mockSelectLimitFn,
  mockUpdateReturningFn,
  mockUpdateSet,
  mockSelectFrom,
} = vi.hoisted(() => {
  const mockSelectLimitFn = vi.fn();

  // update().set().where().returning()
  // autoArbitrate uses a CAS guard: .where(and(eq(id, ...), eq(state, "ARBITRATION"))).returning()
  const mockUpdateReturningFn = vi.fn().mockResolvedValue([{ id: "dispute-uuid-1" }]);
  const mockUpdateWhereChain = { returning: mockUpdateReturningFn };
  const mockUpdateWhereFn = vi.fn().mockReturnValue(mockUpdateWhereChain);
  const mockUpdateSet = vi.fn().mockReturnValue({ where: mockUpdateWhereFn });

  // select().from().where().limit()
  const mockSelectWhereLimitChain = { limit: mockSelectLimitFn };
  const mockSelectWhere = vi.fn().mockReturnValue(mockSelectWhereLimitChain);
  const mockSelectFrom = vi.fn().mockReturnValue({ where: mockSelectWhere });

  return {
    mockSelectLimitFn,
    mockUpdateReturningFn,
    mockUpdateSet,
    mockSelectFrom,
  };
});

vi.mock("../../db/index.js", () => ({
  getDb: () => ({
    select: () => ({ from: mockSelectFrom }),
    update: () => ({ set: mockUpdateSet }),
  }),
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
  autoArbitrate,
  calculateRefundAmount,
  type ArbitrationResult,
} from "../../services/arbitration.js";
import type { Dispute, Escrow, Agent } from "../../db/schema.js";

// ---------------------------------------------------------------------------
// Fixture factories
// ---------------------------------------------------------------------------

function makeDispute(overrides: Partial<Dispute> = {}): Dispute {
  const now = new Date("2025-01-01T00:00:00.000Z");
  // Default deadline 72h in the past — i.e. deadline has passed
  const pastDeadline = new Date(now.getTime() - 72 * 60 * 60 * 1000);
  return {
    id: "dispute-uuid-1",
    escrowId: null,
    invoiceId: null,
    state: "ARBITRATION",
    initiatorDid: "did:web:initiator.prooflink.io",
    respondentDid: "did:web:respondent.prooflink.io",
    reason: "Service not delivered",
    category: "NON_DELIVERY",
    evidence: [],
    resolution: null,
    resolvedBy: null,
    traceId: null,
    apiKeyId: null,
    deadline: pastDeadline,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makeEscrow(overrides: Partial<Escrow> = {}): Escrow {
  const now = new Date("2025-01-01T00:00:00.000Z");
  return {
    id: "escrow-uuid-1",
    escrowType: "SERVICE",
    state: "DISPUTED",
    payerAgentDid: "did:web:payer.prooflink.io",
    payeeAgentDid: "did:web:payee.prooflink.io",
    payerWallet: "0xPayer000000000000000000000000000000000001",
    payeeWallet: "0xPayee000000000000000000000000000000000002",
    amount: "100",
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

function makeAgent(overrides: Partial<Agent> = {}): Agent {
  const now = new Date("2025-01-01T00:00:00.000Z");
  return {
    id: "agent-uuid-1",
    agentDid: "did:web:initiator.prooflink.io",
    erc8004Id: null,
    erc8004Registry: null,
    name: "Test Agent",
    agentType: "SERVICE",
    walletAddress: "0xAgent000000000000000000000000000000000001",
    controllingEntityName: "Acme Corp",
    controllingEntityLei: null,
    kyaCredentialHash: "0xkya-hash",
    complianceScore: 80,
    delegationScope: null,
    isActive: true,
    validatedAt: now,
    expiresAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Helper: configure mockSelectLimitFn call sequence
//
// autoArbitrate makes up to 3 selects:
//   call 1 → dispute row
//   call 2 → escrow row (if dispute.escrowId is set)
//   call 3 → agent row  (if category === "UNAUTHORIZED")
// ---------------------------------------------------------------------------

function setupSelectSequence(...rows: (unknown[] | undefined)[]) {
  let idx = 0;
  mockSelectLimitFn.mockImplementation(() => {
    const result = rows[idx] ?? [];
    idx++;
    return Promise.resolve(result);
  });
}

// ---------------------------------------------------------------------------
// Shared setup helper: after vi.clearAllMocks(), the update mock loses its
// default returning value. This restores a sensible default (success) so
// tests only need to override when testing failure paths.
// ---------------------------------------------------------------------------

function setupDefaultUpdateSuccess() {
  // mockReset clears any queued mockResolvedValueOnce entries left over from
  // previous tests (vi.clearAllMocks does NOT clear the "once" queue).
  mockUpdateReturningFn.mockReset();
  mockUpdateReturningFn.mockResolvedValue([{ id: "dispute-uuid-1", state: "ARBITRATION" }]);
}

// ---------------------------------------------------------------------------
// autoArbitrate — state guard
// ---------------------------------------------------------------------------

describe("autoArbitrate — state guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupDefaultUpdateSuccess();
  });

  it("processes a dispute in ARBITRATION state successfully", async () => {
    const dispute = makeDispute({ state: "ARBITRATION", category: "NON_DELIVERY" });
    setupSelectSequence([dispute]); // dispute (no escrow)

    const result = await autoArbitrate("dispute-uuid-1");

    expect(result.disputeId).toBe("dispute-uuid-1");
    expect(result.automated).toBe(true);
  });

  it("throws for OPEN dispute — state guard rejects non-ARBITRATION states", async () => {
    // autoArbitrate validates that dispute.state === "ARBITRATION" before proceeding.
    // Any other state is rejected with an informative error.
    const dispute = makeDispute({ state: "OPEN", category: "SERVICE_QUALITY" });
    setupSelectSequence([dispute]);

    await expect(autoArbitrate("dispute-uuid-1")).rejects.toThrow(/expected state ARBITRATION/);
  });

  it("throws for CLOSED dispute — state guard rejects non-ARBITRATION states", async () => {
    // CLOSED disputes are also rejected by the state guard.
    const dispute = makeDispute({ state: "CLOSED", category: "SERVICE_QUALITY" });
    setupSelectSequence([dispute]);

    await expect(autoArbitrate("dispute-uuid-1")).rejects.toThrow(/expected state ARBITRATION/);
  });

  it("throws on concurrent modification when CAS update returns empty (state changed between read and write)", async () => {
    // The CAS guard uses .where(and(eq(id,...), eq(state,"ARBITRATION"))).returning()
    // If another request modified the state between our read and write, the update
    // returns no row and we throw "Concurrent modification".
    const dispute = makeDispute({ state: "ARBITRATION", category: "SERVICE_QUALITY" });
    setupSelectSequence([dispute]);
    mockUpdateReturningFn.mockResolvedValueOnce([]); // CAS guard fails

    await expect(autoArbitrate("dispute-uuid-1")).rejects.toThrow(/Concurrent modification/);
  });

  it("rejects (not found) when dispute does not exist in DB", async () => {
    setupSelectSequence([]);

    await expect(autoArbitrate("nonexistent-id")).rejects.toThrow("not found");
  });
});

// ---------------------------------------------------------------------------
// autoArbitrate — NON_DELIVERY category
// ---------------------------------------------------------------------------

describe("autoArbitrate — NON_DELIVERY", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupDefaultUpdateSuccess();
  });

  it("returns REFUND_FULL when no delivery proof and deadline has passed", async () => {
    const now = new Date();
    const pastDeadline = new Date(now.getTime() - 60 * 1000); // 1 min ago
    const dispute = makeDispute({
      category: "NON_DELIVERY",
      evidence: [], // no proof
      deadline: pastDeadline,
      escrowId: "escrow-uuid-1",
    });
    const escrow = makeEscrow({ amount: "150" });

    setupSelectSequence([dispute], [escrow]);

    const result = await autoArbitrate("dispute-uuid-1");

    expect(result.outcome).toBe("REFUND_FULL");
    expect(result.refundAmount).toBe("150");
  });

  it("includes non-null refundAmount when escrow is present and REFUND_FULL", async () => {
    const now = new Date();
    const pastDeadline = new Date(now.getTime() - 60 * 1000);
    const dispute = makeDispute({
      category: "NON_DELIVERY",
      evidence: [],
      deadline: pastDeadline,
      escrowId: "escrow-uuid-1",
    });
    const escrow = makeEscrow({ amount: "200" });

    setupSelectSequence([dispute], [escrow]);

    const result = await autoArbitrate("dispute-uuid-1");

    expect(result.refundAmount).not.toBeNull();
    expect(Number(result.refundAmount)).toBe(200);
  });

  it("returns REQUIRES_HUMAN when respondent submitted delivery proof", async () => {
    const now = new Date();
    const pastDeadline = new Date(now.getTime() - 60 * 1000);
    const dispute = makeDispute({
      category: "NON_DELIVERY",
      deadline: pastDeadline,
      evidence: [
        {
          submittedBy: "did:web:respondent.prooflink.io",
          type: "delivery_proof",
          deliveryProof: true,
        },
      ],
    });

    setupSelectSequence([dispute]);

    const result = await autoArbitrate("dispute-uuid-1");

    expect(result.outcome).toBe("REQUIRES_HUMAN");
  });

  it("returns REQUIRES_HUMAN when deadline has not yet passed", async () => {
    const futureDeadline = new Date(Date.now() + 10 * 60 * 1000); // 10 min ahead
    const dispute = makeDispute({
      category: "NON_DELIVERY",
      evidence: [],
      deadline: futureDeadline,
    });

    setupSelectSequence([dispute]);

    const result = await autoArbitrate("dispute-uuid-1");

    expect(result.outcome).toBe("REQUIRES_HUMAN");
  });

  it("refundAmount is null when no escrow is associated even for REFUND_FULL", async () => {
    const now = new Date();
    const pastDeadline = new Date(now.getTime() - 60 * 1000);
    const dispute = makeDispute({
      category: "NON_DELIVERY",
      evidence: [],
      deadline: pastDeadline,
      escrowId: null, // no escrow
    });

    setupSelectSequence([dispute]);

    const result = await autoArbitrate("dispute-uuid-1");

    expect(result.outcome).toBe("REFUND_FULL");
    expect(result.refundAmount).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// autoArbitrate — OVERCHARGE category
// ---------------------------------------------------------------------------

describe("autoArbitrate — OVERCHARGE", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupDefaultUpdateSuccess();
  });

  it("returns REFUND_PARTIAL when overcharge diff exceeds 20%", async () => {
    // escrowAmount=130, agreedPrice=100 → diff=30 → diffPercent=30% > 20%
    const dispute = makeDispute({
      category: "OVERCHARGE",
      escrowId: "escrow-uuid-1",
    });
    const escrow = makeEscrow({
      amount: "130",
      conditions: { agreedPrice: 100 },
    });

    setupSelectSequence([dispute], [escrow]);

    const result = await autoArbitrate("dispute-uuid-1");

    expect(result.outcome).toBe("REFUND_PARTIAL");
    expect(result.refundAmount).toBe("30"); // diff = 130 - 100
  });

  it("refundAmount equals the difference between escrowed and agreed amount", async () => {
    const dispute = makeDispute({
      category: "OVERCHARGE",
      escrowId: "escrow-uuid-1",
    });
    const escrow = makeEscrow({
      amount: "250",
      conditions: { agreedPrice: 200 }, // diff=50, 25% > 20%
    });

    setupSelectSequence([dispute], [escrow]);

    const result = await autoArbitrate("dispute-uuid-1");

    expect(result.outcome).toBe("REFUND_PARTIAL");
    expect(Number(result.refundAmount)).toBe(50);
  });

  it("returns REQUIRES_HUMAN when overcharge diff is 20% or below", async () => {
    // escrowAmount=120, agreedPrice=100 → diff=20 → diffPercent=20% — NOT > 20
    const dispute = makeDispute({
      category: "OVERCHARGE",
      escrowId: "escrow-uuid-1",
    });
    const escrow = makeEscrow({
      amount: "120",
      conditions: { agreedPrice: 100 },
    });

    setupSelectSequence([dispute], [escrow]);

    const result = await autoArbitrate("dispute-uuid-1");

    expect(result.outcome).toBe("REQUIRES_HUMAN");
  });

  it("returns REQUIRES_HUMAN when no escrow is associated", async () => {
    const dispute = makeDispute({
      category: "OVERCHARGE",
      escrowId: null,
    });

    setupSelectSequence([dispute]);

    const result = await autoArbitrate("dispute-uuid-1");

    expect(result.outcome).toBe("REQUIRES_HUMAN");
  });

  it("returns REQUIRES_HUMAN when agreedPrice is 0 in conditions", async () => {
    const dispute = makeDispute({
      category: "OVERCHARGE",
      escrowId: "escrow-uuid-1",
    });
    const escrow = makeEscrow({
      amount: "100",
      conditions: { agreedPrice: 0 }, // agreedPrice <= 0 → cannot determine
    });

    setupSelectSequence([dispute], [escrow]);

    const result = await autoArbitrate("dispute-uuid-1");

    expect(result.outcome).toBe("REQUIRES_HUMAN");
  });

  it("returns REQUIRES_HUMAN when conditions has no agreedPrice key", async () => {
    const dispute = makeDispute({
      category: "OVERCHARGE",
      escrowId: "escrow-uuid-1",
    });
    const escrow = makeEscrow({
      amount: "100",
      conditions: {}, // no agreedPrice → defaults to 0
    });

    setupSelectSequence([dispute], [escrow]);

    const result = await autoArbitrate("dispute-uuid-1");

    expect(result.outcome).toBe("REQUIRES_HUMAN");
  });
});

// ---------------------------------------------------------------------------
// autoArbitrate — SERVICE_QUALITY category
// ---------------------------------------------------------------------------

describe("autoArbitrate — SERVICE_QUALITY", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupDefaultUpdateSuccess();
  });

  it("returns REQUIRES_HUMAN when both parties submitted evidence", async () => {
    const dispute = makeDispute({
      category: "SERVICE_QUALITY",
      evidence: [
        { submittedBy: "did:web:initiator.prooflink.io", type: "complaint" },
        { submittedBy: "did:web:respondent.prooflink.io", type: "refutation" },
      ],
    });

    setupSelectSequence([dispute]);

    const result = await autoArbitrate("dispute-uuid-1");

    expect(result.outcome).toBe("REQUIRES_HUMAN");
  });

  it("returns REQUIRES_HUMAN when only initiator submitted evidence", async () => {
    const dispute = makeDispute({
      category: "SERVICE_QUALITY",
      evidence: [{ submittedBy: "did:web:initiator.prooflink.io", type: "complaint" }],
    });

    setupSelectSequence([dispute]);

    const result = await autoArbitrate("dispute-uuid-1");

    expect(result.outcome).toBe("REQUIRES_HUMAN");
  });

  it("returns REQUIRES_HUMAN even when no evidence is submitted (subjective category)", async () => {
    const dispute = makeDispute({
      category: "SERVICE_QUALITY",
      evidence: [],
    });

    setupSelectSequence([dispute]);

    const result = await autoArbitrate("dispute-uuid-1");

    expect(result.outcome).toBe("REQUIRES_HUMAN");
  });

  it("result always has automated: true", async () => {
    const dispute = makeDispute({ category: "SERVICE_QUALITY" });

    setupSelectSequence([dispute]);

    const result = await autoArbitrate("dispute-uuid-1");

    expect(result.automated).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// autoArbitrate — result structure
// ---------------------------------------------------------------------------

describe("autoArbitrate — result structure", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupDefaultUpdateSuccess();
  });

  it("result includes disputeId, outcome, refundAmount, reasoning, automated, decidedAt", async () => {
    const dispute = makeDispute({ category: "SERVICE_QUALITY" });
    setupSelectSequence([dispute]);

    const result = await autoArbitrate("dispute-uuid-1");

    expect(result).toMatchObject({
      disputeId: "dispute-uuid-1",
      outcome: expect.any(String),
      automated: true,
      decidedAt: expect.any(String),
      reasoning: expect.any(String),
    });
    // refundAmount may be null or string
    expect("refundAmount" in result).toBe(true);
  });

  it("decidedAt is an ISO 8601 date string", async () => {
    const dispute = makeDispute({ category: "SERVICE_QUALITY" });
    setupSelectSequence([dispute]);

    const result = await autoArbitrate("dispute-uuid-1");

    expect(() => new Date(result.decidedAt)).not.toThrow();
    expect(new Date(result.decidedAt).toISOString()).toBe(result.decidedAt);
  });
});

// ---------------------------------------------------------------------------
// calculateRefundAmount — unit tests
// ---------------------------------------------------------------------------

describe("calculateRefundAmount", () => {
  function disputeWithCategory(category: string): Dispute {
    return makeDispute({ category } as Partial<Dispute>);
  }

  it("NON_DELIVERY → returns full escrow amount", () => {
    const escrow = makeEscrow({ amount: "500" });
    const result = calculateRefundAmount(disputeWithCategory("NON_DELIVERY"), escrow);
    expect(result).toBe("500");
  });

  it("UNAUTHORIZED → returns full escrow amount", () => {
    const escrow = makeEscrow({ amount: "300" });
    const result = calculateRefundAmount(disputeWithCategory("UNAUTHORIZED"), escrow);
    expect(result).toBe("300");
  });

  it("OVERCHARGE → returns difference between escrow amount and agreedPrice", () => {
    const escrow = makeEscrow({ amount: "130", conditions: { agreedPrice: 100 } });
    const result = calculateRefundAmount(disputeWithCategory("OVERCHARGE"), escrow);
    expect(result).toBe("30");
  });

  it("OVERCHARGE → returns '0' when escrow amount is not greater than agreedPrice", () => {
    const escrow = makeEscrow({ amount: "100", conditions: { agreedPrice: 120 } });
    const result = calculateRefundAmount(disputeWithCategory("OVERCHARGE"), escrow);
    expect(result).toBe("0");
  });

  it("SERVICE_QUALITY → returns 50% of escrow amount", () => {
    const escrow = makeEscrow({ amount: "200" });
    const result = calculateRefundAmount(disputeWithCategory("SERVICE_QUALITY"), escrow);
    expect(Number(result)).toBe(100);
  });

  it("OTHER → returns '0'", () => {
    const escrow = makeEscrow({ amount: "100" });
    const result = calculateRefundAmount(disputeWithCategory("OTHER"), escrow);
    expect(result).toBe("0");
  });
});
