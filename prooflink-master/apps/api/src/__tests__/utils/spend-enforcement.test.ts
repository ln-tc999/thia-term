import { describe, expect, it, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mock DB — controlled per test via mockDbSetup
// ---------------------------------------------------------------------------

const mockAgentSelect = vi.fn();
const mockInvoiceSelect = vi.fn();

// Track which .from() call we're on to route to agents vs invoices query
let dbSelectCallCount = 0;

vi.mock("../../db/index.js", () => ({
  getDb: () => ({
    select: () => {
      dbSelectCallCount++;
      const callNum = dbSelectCallCount;
      return {
        from: (table: unknown) => ({
          where: (condition: unknown) => {
            // Agents query uses .limit(1)
            // Invoices query uses .where(and(...)) directly returning the result
            // We distinguish by checking which call number this is
            return {
              limit: () => mockAgentSelect(),
              // for invoices aggregation that doesn't chain .limit()
              then: (resolve: (v: unknown) => unknown) =>
                mockInvoiceSelect().then(resolve),
            };
          },
        }),
      };
    },
  }),
}));

// We need a smarter mock because the two queries have different chain shapes.
// Let's override with a factory approach instead.

vi.mock("../../db/index.js", () => {
  return {
    getDb: vi.fn(),
  };
});

import { checkDelegationScope } from "../../utils/spend-enforcement.js";
import { getDb } from "../../db/index.js";

const mockGetDb = vi.mocked(getDb);

// ---------------------------------------------------------------------------
// DB builder helpers
// ---------------------------------------------------------------------------

/** Build a mock db that returns the given agent row (or undefined) from the agents query. */
function buildDb(
  agentRow: { delegationScope: Record<string, unknown> | null } | undefined,
  dailyTotal = "0",
) {
  let selectCallIdx = 0;

  return {
    select: vi.fn().mockImplementation(() => {
      selectCallIdx++;
      const idx = selectCallIdx;
      return {
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockImplementation(() => {
            if (idx === 1) {
              // agents query — chains .limit(1)
              return {
                limit: vi.fn().mockResolvedValue(
                  agentRow !== undefined ? [agentRow] : [],
                ),
              };
            }
            // invoices aggregation — returns array directly
            return Promise.resolve([{ dailyTotal }]);
          }),
        }),
      };
    }),
  };
}

/** Build a mock db where the agents query throws. */
function buildErrorDb() {
  return {
    select: vi.fn().mockImplementation(() => {
      throw new Error("DB connection refused");
    }),
  };
}

/** Build a mock db where agents query succeeds but invoices query throws. */
function buildDailyErrorDb(
  agentRow: { delegationScope: Record<string, unknown> | null },
) {
  let selectCallIdx = 0;
  return {
    select: vi.fn().mockImplementation(() => {
      selectCallIdx++;
      const idx = selectCallIdx;
      return {
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockImplementation(() => {
            if (idx === 1) {
              return {
                limit: vi.fn().mockResolvedValue([agentRow]),
              };
            }
            return Promise.reject(new Error("Invoice DB error"));
          }),
        }),
      };
    }),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("checkDelegationScope", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // Agent not found
  // -------------------------------------------------------------------------

  it("returns allowed:true when no agent record exists for the DID", async () => {
    mockGetDb.mockReturnValue(buildDb(undefined) as ReturnType<typeof getDb>);

    const result = await checkDelegationScope(
      "did:prooflink:agent:unknown",
      500,
      "USDC",
      "eip155:8453",
      "0xabc",
    );

    expect(result.allowed).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // Agent found but no delegationScope
  // -------------------------------------------------------------------------

  it("returns allowed:true when agent has null delegationScope", async () => {
    mockGetDb.mockReturnValue(
      buildDb({ delegationScope: null }) as ReturnType<typeof getDb>,
    );

    const result = await checkDelegationScope(
      "did:prooflink:agent:001",
      9999,
      "USDC",
      "eip155:8453",
      "0xabc",
    );

    expect(result.allowed).toBe(true);
  });

  it("returns allowed:true when agent has empty object delegationScope", async () => {
    mockGetDb.mockReturnValue(
      buildDb({ delegationScope: {} }) as ReturnType<typeof getDb>,
    );

    const result = await checkDelegationScope(
      "did:prooflink:agent:001",
      9999,
      "USDC",
      "eip155:8453",
      "0xabc",
    );

    expect(result.allowed).toBe(true);
  });

  // -------------------------------------------------------------------------
  // maxTransactionUsd
  // -------------------------------------------------------------------------

  it("returns allowed:false when amount exceeds maxTransactionUsd", async () => {
    mockGetDb.mockReturnValue(
      buildDb({
        delegationScope: { maxTransactionUsd: 100 },
      }) as ReturnType<typeof getDb>,
    );

    const result = await checkDelegationScope(
      "did:prooflink:agent:001",
      150,
      "USDC",
      "eip155:8453",
      "0xabc",
    );

    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/exceeds max per-transaction limit/);
    expect(result.reason).toContain("150");
    expect(result.reason).toContain("100");
  });

  it("returns allowed:true when amount equals maxTransactionUsd (boundary — not exceeded)", async () => {
    mockGetDb.mockReturnValue(
      buildDb({
        delegationScope: { maxTransactionUsd: 100 },
      }) as ReturnType<typeof getDb>,
    );

    const result = await checkDelegationScope(
      "did:prooflink:agent:001",
      100,
      "USDC",
      "eip155:8453",
      "0xabc",
    );

    expect(result.allowed).toBe(true);
  });

  it("returns allowed:true when amount is below maxTransactionUsd", async () => {
    mockGetDb.mockReturnValue(
      buildDb({
        delegationScope: { maxTransactionUsd: 1000 },
      }) as ReturnType<typeof getDb>,
    );

    const result = await checkDelegationScope(
      "did:prooflink:agent:001",
      500,
      "USDC",
      "eip155:8453",
      "0xabc",
    );

    expect(result.allowed).toBe(true);
  });

  it("returns allowed:true when maxTransactionUsd is 0 (unlimited)", async () => {
    mockGetDb.mockReturnValue(
      buildDb({
        delegationScope: { maxTransactionUsd: 0 },
      }) as ReturnType<typeof getDb>,
    );

    const result = await checkDelegationScope(
      "did:prooflink:agent:001",
      1_000_000,
      "USDC",
      "eip155:8453",
      "0xabc",
    );

    expect(result.allowed).toBe(true);
  });

  // -------------------------------------------------------------------------
  // allowedChains
  // -------------------------------------------------------------------------

  it("returns allowed:false when chain is not in allowedChains", async () => {
    mockGetDb.mockReturnValue(
      buildDb({
        delegationScope: { allowedChains: ["eip155:1", "eip155:137"] },
      }) as ReturnType<typeof getDb>,
    );

    const result = await checkDelegationScope(
      "did:prooflink:agent:001",
      50,
      "USDC",
      "eip155:8453",
      "0xabc",
    );

    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/not in the agent's allowed chains/);
    expect(result.reason).toContain("eip155:8453");
  });

  it("chain check is case-insensitive", async () => {
    mockGetDb.mockReturnValue(
      buildDb({
        delegationScope: { allowedChains: ["EIP155:8453"] },
      }) as ReturnType<typeof getDb>,
    );

    const result = await checkDelegationScope(
      "did:prooflink:agent:001",
      50,
      "USDC",
      "eip155:8453", // lowercase
      "0xabc",
    );

    expect(result.allowed).toBe(true);
  });

  it("returns allowed:true when allowedChains is empty (any chain permitted)", async () => {
    mockGetDb.mockReturnValue(
      buildDb({
        delegationScope: { allowedChains: [] },
      }) as ReturnType<typeof getDb>,
    );

    const result = await checkDelegationScope(
      "did:prooflink:agent:001",
      50,
      "USDC",
      "eip155:99999",
      "0xabc",
    );

    expect(result.allowed).toBe(true);
  });

  it("returns allowed:true when chain is in allowedChains", async () => {
    mockGetDb.mockReturnValue(
      buildDb({
        delegationScope: { allowedChains: ["eip155:8453", "eip155:1"] },
      }) as ReturnType<typeof getDb>,
    );

    const result = await checkDelegationScope(
      "did:prooflink:agent:001",
      50,
      "USDC",
      "eip155:8453",
      "0xabc",
    );

    expect(result.allowed).toBe(true);
  });

  // -------------------------------------------------------------------------
  // allowedAssets
  // -------------------------------------------------------------------------

  it("returns allowed:false when asset is not in allowedAssets", async () => {
    mockGetDb.mockReturnValue(
      buildDb({
        delegationScope: { allowedAssets: ["USDC", "DAI"] },
      }) as ReturnType<typeof getDb>,
    );

    const result = await checkDelegationScope(
      "did:prooflink:agent:001",
      50,
      "ETH",
      "eip155:8453",
      "0xabc",
    );

    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/not in the agent's allowed assets/);
    expect(result.reason).toContain("ETH");
  });

  it("asset check is case-insensitive", async () => {
    mockGetDb.mockReturnValue(
      buildDb({
        delegationScope: { allowedAssets: ["USDC"] },
      }) as ReturnType<typeof getDb>,
    );

    const result = await checkDelegationScope(
      "did:prooflink:agent:001",
      50,
      "usdc", // lowercase
      "eip155:8453",
      "0xabc",
    );

    expect(result.allowed).toBe(true);
  });

  it("returns allowed:true when allowedAssets is empty (any asset permitted)", async () => {
    mockGetDb.mockReturnValue(
      buildDb({
        delegationScope: { allowedAssets: [] },
      }) as ReturnType<typeof getDb>,
    );

    const result = await checkDelegationScope(
      "did:prooflink:agent:001",
      50,
      "PEPE",
      "eip155:8453",
      "0xabc",
    );

    expect(result.allowed).toBe(true);
  });

  // -------------------------------------------------------------------------
  // allowedCounterparties
  // -------------------------------------------------------------------------

  it("returns allowed:false when counterparty not in allowedCounterparties", async () => {
    mockGetDb.mockReturnValue(
      buildDb({
        delegationScope: {
          allowedCounterparties: [
            "0xdeadbeef00000000000000000000000000000001",
          ],
        },
      }) as ReturnType<typeof getDb>,
    );

    const result = await checkDelegationScope(
      "did:prooflink:agent:001",
      50,
      "USDC",
      "eip155:8453",
      "0x000000000000000000000000000000000000dead",
    );

    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/not in the agent's allowed counterparties/);
  });

  it("counterparty check is case-insensitive", async () => {
    mockGetDb.mockReturnValue(
      buildDb({
        delegationScope: {
          allowedCounterparties: ["0xABC123"],
        },
      }) as ReturnType<typeof getDb>,
    );

    const result = await checkDelegationScope(
      "did:prooflink:agent:001",
      50,
      "USDC",
      "eip155:8453",
      "0xabc123", // lowercase
    );

    expect(result.allowed).toBe(true);
  });

  it("returns allowed:true when allowedCounterparties is empty (any counterparty permitted)", async () => {
    mockGetDb.mockReturnValue(
      buildDb({
        delegationScope: { allowedCounterparties: [] },
      }) as ReturnType<typeof getDb>,
    );

    const result = await checkDelegationScope(
      "did:prooflink:agent:001",
      50,
      "USDC",
      "eip155:8453",
      "0xrandom",
    );

    expect(result.allowed).toBe(true);
  });

  // -------------------------------------------------------------------------
  // dailyLimitUsd
  // -------------------------------------------------------------------------

  it("returns allowed:false when adding amount would exceed dailyLimitUsd", async () => {
    // dailyTotal already at 800, limit is 1000, new tx is 300 → 1100 > 1000
    mockGetDb.mockReturnValue(
      buildDb(
        { delegationScope: { dailyLimitUsd: 1000 } },
        "800",
      ) as ReturnType<typeof getDb>,
    );

    const result = await checkDelegationScope(
      "did:prooflink:agent:001",
      300,
      "USDC",
      "eip155:8453",
      "0xabc",
    );

    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/would exceed daily limit/);
    expect(result.reason).toContain("1000");
    expect(result.reason).toContain("800");
  });

  it("returns allowed:true when dailyTotal + amount exactly equals dailyLimitUsd", async () => {
    // 700 + 300 = 1000 — not strictly greater than 1000
    mockGetDb.mockReturnValue(
      buildDb(
        { delegationScope: { dailyLimitUsd: 1000 } },
        "700",
      ) as ReturnType<typeof getDb>,
    );

    const result = await checkDelegationScope(
      "did:prooflink:agent:001",
      300,
      "USDC",
      "eip155:8453",
      "0xabc",
    );

    expect(result.allowed).toBe(true);
  });

  it("returns allowed:true when dailyLimitUsd is 0 (unlimited)", async () => {
    mockGetDb.mockReturnValue(
      buildDb(
        { delegationScope: { dailyLimitUsd: 0 } },
        "999999",
      ) as ReturnType<typeof getDb>,
    );

    const result = await checkDelegationScope(
      "did:prooflink:agent:001",
      1_000_000,
      "USDC",
      "eip155:8453",
      "0xabc",
    );

    expect(result.allowed).toBe(true);
  });

  it("blocks transaction when invoices DB query fails (fail-closed)", async () => {
    // Daily limit check fails closed: if the DB is unavailable we cannot verify
    // whether the agent has headroom, so we block to prevent limit bypass.
    mockGetDb.mockReturnValue(
      buildDailyErrorDb({
        delegationScope: { dailyLimitUsd: 100 },
      }) as ReturnType<typeof getDb>,
    );

    const result = await checkDelegationScope(
      "did:prooflink:agent:001",
      9999,
      "USDC",
      "eip155:8453",
      "0xabc",
    );

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("unavailable");
  });

  // -------------------------------------------------------------------------
  // DB error — fails closed
  // -------------------------------------------------------------------------

  it("returns allowed:false when DB throws during agent lookup (fail-closed)", async () => {
    mockGetDb.mockReturnValue(
      buildErrorDb() as ReturnType<typeof getDb>,
    );

    const result = await checkDelegationScope(
      "did:prooflink:agent:001",
      50,
      "USDC",
      "eip155:8453",
      "0xabc",
    );

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("unavailable");
  });

  // -------------------------------------------------------------------------
  // Combined scope checks — checks are applied in order
  // -------------------------------------------------------------------------

  it("maxTransactionUsd check fires before allowedChains check", async () => {
    mockGetDb.mockReturnValue(
      buildDb({
        delegationScope: {
          maxTransactionUsd: 10,
          allowedChains: ["eip155:1"],
        },
      }) as ReturnType<typeof getDb>,
    );

    // Exceeds both limits — should fail on maxTransactionUsd first
    const result = await checkDelegationScope(
      "did:prooflink:agent:001",
      999,
      "USDC",
      "eip155:8453",
      "0xabc",
    );

    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/exceeds max per-transaction limit/);
  });

  it("all checks pass → allowed:true", async () => {
    mockGetDb.mockReturnValue(
      buildDb(
        {
          delegationScope: {
            maxTransactionUsd: 1000,
            allowedChains: ["eip155:8453"],
            allowedAssets: ["USDC"],
            allowedCounterparties: ["0xrecipient"],
            dailyLimitUsd: 5000,
          },
        },
        "100",
      ) as ReturnType<typeof getDb>,
    );

    const result = await checkDelegationScope(
      "did:prooflink:agent:001",
      500,
      "USDC",
      "eip155:8453",
      "0xrecipient",
    );

    expect(result.allowed).toBe(true);
  });
});
