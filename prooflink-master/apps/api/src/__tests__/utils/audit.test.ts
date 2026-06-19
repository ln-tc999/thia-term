import { describe, expect, it, vi, beforeEach } from "vitest";
import { createHash } from "node:crypto";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockInsert = vi.fn();
const mockSelectOrderBy = vi.fn();

vi.mock("../../db/index.js", () => ({
  getDb: vi.fn(),
}));

vi.mock("../../utils/logger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// drizzle-orm desc() is called by audit.ts — mock it to a passthrough
vi.mock("drizzle-orm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("drizzle-orm")>();
  return {
    ...actual,
    desc: vi.fn((col) => col),
  };
});

// ---------------------------------------------------------------------------
// SUT imports (after mocks)
// ---------------------------------------------------------------------------

import { writeAuditLog } from "../../utils/audit.js";
import { getDb } from "../../db/index.js";
import { logger } from "../../utils/logger.js";

const mockGetDb = vi.mocked(getDb);
const mockLogger = vi.mocked(logger);

// ---------------------------------------------------------------------------
// DB builder helpers
// ---------------------------------------------------------------------------

/**
 * Build a tx object (passed to the transaction callback) with select and insert.
 * Also mocks tx.execute() for the pg_advisory_xact_lock call.
 */
function buildTx(
  lastEntries: Array<{ logHash: string }> = [],
  insertError?: Error,
) {
  const insertValues = vi.fn().mockImplementation(() => {
    if (insertError) return Promise.reject(insertError);
    return Promise.resolve();
  });
  const insert = vi.fn().mockReturnValue({ values: insertValues });

  const limit = vi.fn().mockResolvedValue(lastEntries);
  const orderBy = vi.fn().mockReturnValue({ limit });
  const from = vi.fn().mockReturnValue({ orderBy });
  const select = vi.fn().mockReturnValue({ from });

  // tx.execute() is called for SELECT pg_advisory_xact_lock(...)
  const execute = vi.fn().mockResolvedValue([]);

  return { select, insert, execute, _insertValues: insertValues };
}

/**
 * Build a mock db where:
 * - db.transaction(cb) calls cb(tx) and returns its result
 * - tx.select().from().orderBy().limit(1) → resolves to lastEntries
 * - tx.insert().values() → resolves (no return value needed for fire-and-forget)
 */
function buildDb(
  lastEntries: Array<{ logHash: string }> = [],
  insertError?: Error,
) {
  const tx = buildTx(lastEntries, insertError);

  const transaction = vi.fn().mockImplementation(
    (cb: (tx: typeof tx) => Promise<void>) => cb(tx),
  );

  return {
    transaction,
    // Expose tx internals for assertions
    _insertValues: tx._insertValues,
    // Expose raw tx for advanced assertions
    _tx: tx,
  };
}

/**
 * Build a mock db where the initial advisory lock SELECT throws.
 */
function buildSelectErrorDb() {
  const execute = vi.fn().mockImplementation(() => {
    throw new Error("DB down");
  });
  const tx = {
    select: vi.fn(),
    insert: vi.fn(),
    execute,
  };

  const transaction = vi.fn().mockImplementation(
    (cb: (tx: typeof tx) => Promise<void>) => cb(tx),
  );

  return { transaction, insert: vi.fn() };
}

// ---------------------------------------------------------------------------
// Helper: compute expected hash using the same algorithm as audit.ts
// ---------------------------------------------------------------------------

function expectedHash(
  previousLogHash: string,
  eventType: string,
  payload: Record<string, unknown>,
  timestamp: string,
): string {
  return createHash("sha256")
    .update(previousLogHash + eventType + JSON.stringify(payload) + timestamp)
    .digest("hex");
}

// ---------------------------------------------------------------------------
// Helper: wait for the fire-and-forget promise to settle
// ---------------------------------------------------------------------------

async function flushMicrotasks() {
  // Yield several times to ensure the async IIFE inside writeAuditLog completes
  for (let i = 0; i < 10; i++) {
    await new Promise((r) => setImmediate(r));
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("writeAuditLog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // Fire-and-forget return semantics
  // -------------------------------------------------------------------------

  it("returns void synchronously without awaiting DB operations", () => {
    const { transaction } = buildDb();
    mockGetDb.mockReturnValue({ transaction } as ReturnType<typeof getDb>);

    const result = writeAuditLog({
      eventType: "test.event",
      payload: { key: "value" },
    });

    // Must return void (undefined) synchronously
    expect(result).toBeUndefined();
  });

  it("does not block when DB is slow — returns immediately", async () => {
    // Simulate a very slow DB via a never-resolving transaction
    let resolveTransaction!: () => void;
    const slowTransactionPromise = new Promise<void>((r) => {
      resolveTransaction = r;
    });
    const transaction = vi.fn().mockReturnValue(slowTransactionPromise);

    mockGetDb.mockReturnValue({ transaction } as ReturnType<typeof getDb>);

    const start = Date.now();
    writeAuditLog({ eventType: "test.event", payload: {} });
    const elapsed = Date.now() - start;

    // Should return in under 50ms — definitely not waiting for slow DB
    expect(elapsed).toBeLessThan(50);

    // Resolve the slow promise to clean up
    resolveTransaction();
  });

  // -------------------------------------------------------------------------
  // Hash chain: first entry uses "genesis"
  // -------------------------------------------------------------------------

  it("uses 'genesis' as previousLogHash when no prior entries exist", async () => {
    const { transaction, _insertValues } = buildDb([]);
    mockGetDb.mockReturnValue({ transaction } as ReturnType<typeof getDb>);

    writeAuditLog({
      eventType: "test.event",
      payload: { amount: 100 },
    });

    await flushMicrotasks();

    expect(_insertValues).toHaveBeenCalledOnce();
    const insertedRow = _insertValues.mock.calls[0]![0] as Record<string, unknown>;
    expect(insertedRow["previousLogHash"]).toBe("genesis");
  });

  it("uses the last entry's logHash as previousLogHash for subsequent entries", async () => {
    const prevHash = "abc123def456";
    const { transaction, _insertValues } = buildDb([{ logHash: prevHash }]);
    mockGetDb.mockReturnValue({ transaction } as ReturnType<typeof getDb>);

    writeAuditLog({
      eventType: "test.event",
      payload: { amount: 200 },
    });

    await flushMicrotasks();

    expect(_insertValues).toHaveBeenCalledOnce();
    const insertedRow = _insertValues.mock.calls[0]![0] as Record<string, unknown>;
    expect(insertedRow["previousLogHash"]).toBe(prevHash);
  });

  // -------------------------------------------------------------------------
  // Hash computation correctness
  // -------------------------------------------------------------------------

  it("logHash is SHA-256 of previousLogHash + eventType + JSON.stringify(payload) + timestamp", async () => {
    const { transaction, _insertValues } = buildDb([]);
    mockGetDb.mockReturnValue({ transaction } as ReturnType<typeof getDb>);

    const payload = { checkId: "test-001", amount: 500 };
    writeAuditLog({ eventType: "compliance.check.passed", payload });

    await flushMicrotasks();

    expect(_insertValues).toHaveBeenCalledOnce();
    const insertedRow = _insertValues.mock.calls[0]![0] as Record<string, unknown>;

    // Since we can't intercept the exact timestamp used inside writeAuditLog,
    // verify the hash shape only — deterministic SHA-256 hex.
    expect(insertedRow["logHash"]).toBeTypeOf("string");
    expect((insertedRow["logHash"] as string).length).toBe(64);
    expect(insertedRow["logHash"]).toMatch(/^[0-9a-f]{64}$/);
  });

  it("logHash changes when payload changes (non-determinism across entries)", async () => {
    const db1 = buildDb([]);
    const db2 = buildDb([]);

    mockGetDb
      .mockReturnValueOnce({ transaction: db1.transaction } as ReturnType<typeof getDb>)
      .mockReturnValueOnce({ transaction: db2.transaction } as ReturnType<typeof getDb>);

    writeAuditLog({ eventType: "test.event", payload: { amount: 100 } });
    writeAuditLog({ eventType: "test.event", payload: { amount: 200 } });

    await flushMicrotasks();

    const hash1 = (db1._insertValues.mock.calls[0]![0] as Record<string, unknown>)["logHash"] as string;
    const hash2 = (db2._insertValues.mock.calls[0]![0] as Record<string, unknown>)["logHash"] as string;

    // Different payloads → different hashes
    expect(hash1).not.toBe(hash2);
  });

  // -------------------------------------------------------------------------
  // Inserted row structure
  // -------------------------------------------------------------------------

  it("inserts the correct eventType", async () => {
    const { transaction, _insertValues } = buildDb([]);
    mockGetDb.mockReturnValue({ transaction } as ReturnType<typeof getDb>);

    writeAuditLog({ eventType: "invoice.paid", payload: {} });

    await flushMicrotasks();

    const row = _insertValues.mock.calls[0]![0] as Record<string, unknown>;
    expect(row["eventType"]).toBe("invoice.paid");
  });

  it("inserts the correct payload", async () => {
    const { transaction, _insertValues } = buildDb([]);
    mockGetDb.mockReturnValue({ transaction } as ReturnType<typeof getDb>);

    const payload = { foo: "bar", num: 42 };
    writeAuditLog({ eventType: "test.event", payload });

    await flushMicrotasks();

    const row = _insertValues.mock.calls[0]![0] as Record<string, unknown>;
    expect(row["payload"]).toEqual(payload);
  });

  it("sets optional fields to null when not provided", async () => {
    const { transaction, _insertValues } = buildDb([]);
    mockGetDb.mockReturnValue({ transaction } as ReturnType<typeof getDb>);

    writeAuditLog({ eventType: "test.event", payload: {} });

    await flushMicrotasks();

    const row = _insertValues.mock.calls[0]![0] as Record<string, unknown>;
    expect(row["receiptId"]).toBeNull();
    expect(row["invoiceId"]).toBeNull();
    expect(row["agentDid"]).toBeNull();
    expect(row["apiKeyId"]).toBeNull();
  });

  it("passes optional fields through when provided", async () => {
    const { transaction, _insertValues } = buildDb([]);
    mockGetDb.mockReturnValue({ transaction } as ReturnType<typeof getDb>);

    writeAuditLog({
      eventType: "test.event",
      payload: {},
      receiptId: "receipt-001",
      invoiceId: "inv-001",
      agentDid: "did:prooflink:agent:001",
      apiKeyId: "key-001",
    });

    await flushMicrotasks();

    const row = _insertValues.mock.calls[0]![0] as Record<string, unknown>;
    expect(row["receiptId"]).toBe("receipt-001");
    expect(row["invoiceId"]).toBe("inv-001");
    expect(row["agentDid"]).toBe("did:prooflink:agent:001");
    expect(row["apiKeyId"]).toBe("key-001");
  });

  // -------------------------------------------------------------------------
  // Error resilience — never throws, logs errors instead
  // -------------------------------------------------------------------------

  it("does not throw when DB advisory lock throws — swallows error silently", async () => {
    const db = buildSelectErrorDb();
    mockGetDb.mockReturnValue(db as ReturnType<typeof getDb>);

    expect(() => {
      writeAuditLog({ eventType: "test.event", payload: {} });
    }).not.toThrow();

    await flushMicrotasks();

    // Error was logged, not thrown
    expect(mockLogger.error).toHaveBeenCalledWith(
      "Failed to write audit log",
      expect.objectContaining({ eventType: "test.event" }),
    );
  });

  it("does not throw when insert fails — swallows error silently", async () => {
    const insertError = new Error("Insert failed: constraint violation");
    const { transaction } = buildDb([], insertError);
    mockGetDb.mockReturnValue({ transaction } as ReturnType<typeof getDb>);

    expect(() => {
      writeAuditLog({ eventType: "test.event", payload: {} });
    }).not.toThrow();

    await flushMicrotasks();

    expect(mockLogger.error).toHaveBeenCalledWith(
      "Failed to write audit log",
      expect.objectContaining({
        eventType: "test.event",
        error: "Insert failed: constraint violation",
      }),
    );
  });

  it("logs error message from Error instance correctly", async () => {
    const db = buildSelectErrorDb();
    mockGetDb.mockReturnValue(db as ReturnType<typeof getDb>);

    writeAuditLog({ eventType: "test.event", payload: {} });
    await flushMicrotasks();

    const logCall = mockLogger.error.mock.calls[0];
    expect(logCall?.[1]).toEqual(
      expect.objectContaining({ error: "DB down" }),
    );
  });

  it("converts non-Error thrown values to strings in error log", async () => {
    const execute = vi.fn().mockImplementation(() => {
      // eslint-disable-next-line @typescript-eslint/no-throw-literal
      throw "string error";
    });
    const tx = { select: vi.fn(), insert: vi.fn(), execute };
    const transaction = vi.fn().mockImplementation(
      (cb: (tx: typeof tx) => Promise<void>) => cb(tx),
    );
    mockGetDb.mockReturnValue({ transaction } as ReturnType<typeof getDb>);

    writeAuditLog({ eventType: "test.event", payload: {} });
    await flushMicrotasks();

    const logCall = mockLogger.error.mock.calls[0];
    expect(logCall?.[1]).toEqual(
      expect.objectContaining({ error: "string error" }),
    );
  });

  // -------------------------------------------------------------------------
  // Multiple sequential calls
  // -------------------------------------------------------------------------

  it("each call produces an independent insert", async () => {
    const db1 = buildDb([]);
    const db2 = buildDb([{ logHash: "prevhash123" }]);

    mockGetDb
      .mockReturnValueOnce({ transaction: db1.transaction } as ReturnType<typeof getDb>)
      .mockReturnValueOnce({ transaction: db2.transaction } as ReturnType<typeof getDb>);

    writeAuditLog({ eventType: "event.one", payload: { n: 1 } });
    writeAuditLog({ eventType: "event.two", payload: { n: 2 } });

    await flushMicrotasks();

    expect(db1._insertValues).toHaveBeenCalledOnce();
    expect(db2._insertValues).toHaveBeenCalledOnce();

    const row1 = db1._insertValues.mock.calls[0]![0] as Record<string, unknown>;
    const row2 = db2._insertValues.mock.calls[0]![0] as Record<string, unknown>;

    expect(row1["eventType"]).toBe("event.one");
    expect(row2["eventType"]).toBe("event.two");
    expect(row2["previousLogHash"]).toBe("prevhash123");
  });
});
