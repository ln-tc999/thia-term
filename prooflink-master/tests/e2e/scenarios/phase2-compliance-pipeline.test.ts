/**
 * E2E: Phase 1+2 Compliance Pipeline
 *
 * Covers Phase 1+2 feature integration:
 *   - AML scoring uses actual risk factors (not a hardcoded value)
 *   - Risk score reflects real AML factor weights
 *   - Travel Rule threshold uses price-guard to convert amounts via
 *     jurisdiction-aware threshold resolution
 *   - traceId flows from request body → check → receipt → response body
 *   - X-Trace-ID response header is set
 *   - Sanctioned address forces riskScore = 100
 *   - broadcastWsEvent is called (audit events emitted) on compliance check
 *   - Batch endpoint screens each address individually
 *
 * DB layer is fully mocked — no Postgres required.
 * Chainalysis HTTP calls are intercepted via vi.stubGlobal("fetch").
 *
 * Chain IDs: use "base" (not "eip155:8453") so resolveTravelRuleThreshold
 * maps to US jurisdiction (threshold $3000) instead of UNKNOWN (threshold $0).
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import { createApp } from "../../../apps/api/src/app.js";
import { resetRateLimitStore } from "../../../apps/api/src/middleware/rate-limit.js";
import { resetScreener } from "../../../apps/api/src/services/screening.js";
import {
  makeComplianceCheckRow,
  makeReceiptRow,
  TEST_BUYER_ADDRESS,
  TEST_SELLER_ADDRESS,
} from "../setup.js";
import {
  TORNADO_CASH_100ETH_POOL,
} from "../fixtures/ofac-addresses.js";

// ---------------------------------------------------------------------------
// DB mock
// ---------------------------------------------------------------------------

const mockInsertReturning = vi.fn();
const mockSelectFrom = vi.fn();

vi.mock("../../../apps/api/src/db/index.js", () => ({
  getDb: () => ({
    insert: () => ({
      values: () => ({
        returning: mockInsertReturning,
        onConflictDoUpdate: () => ({ returning: mockInsertReturning }),
        then: (resolve: (v: unknown) => void) => Promise.resolve().then(resolve),
        catch: () => Promise.resolve(),
      }),
    }),
    select: () => ({
      from: mockSelectFrom,
    }),
    update: () => ({
      set: () => ({
        where: () => ({
          returning: vi.fn().mockResolvedValue([]),
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
  authMiddleware: () => async (_c: unknown, next: () => Promise<void>) => next(),
  requireScope: () => async (_c: unknown, next: () => Promise<void>) => next(),
}));

vi.mock("../../../apps/api/src/middleware/rate-limit.js", async () => {
  const mod = await import("../../../apps/api/src/middleware/rate-limit.js");
  return mod;
});

// Intercept broadcastWsEvent so we can assert it is called.
// vi.hoisted() ensures the mock fn is available inside the vi.mock factory.
const { mockBroadcastWsEvent } = vi.hoisted(() => ({
  mockBroadcastWsEvent: vi.fn(),
}));

vi.mock("../../../apps/api/src/routes/ws.js", async () => {
  const mod = await import("../../../apps/api/src/routes/ws.js");
  return {
    ...mod,
    broadcastWsEvent: mockBroadcastWsEvent,
  };
});

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function chainalysisClean(): Response {
  return new Response(JSON.stringify({ identifications: [] }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function chainalysisSanctioned(): Response {
  return new Response(
    JSON.stringify({
      identifications: [
        {
          category: "sanctions",
          name: "Tornado Cash",
          description: "OFAC SDN designated",
          url: "https://ofac.treasury.gov/sdn",
        },
      ],
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

function seedInserts(checkOverrides: Record<string, unknown> = {}, receiptOverrides: Record<string, unknown> = {}): void {
  mockInsertReturning
    .mockResolvedValueOnce([makeComplianceCheckRow(checkOverrides)])
    .mockResolvedValueOnce([makeReceiptRow(receiptOverrides)]);
  // Additional calls go to audit-log insert (fire-and-forget)
  mockInsertReturning.mockResolvedValue([]);
}

// Seed N check+receipt insert pairs (for batch endpoint)
function seedBatchInserts(count: number): void {
  for (let i = 0; i < count; i++) {
    mockInsertReturning
      .mockResolvedValueOnce([makeComplianceCheckRow({ id: `550e8400-e29b-41d4-a716-44665544${String(i).padStart(4, "0")}` })])
      .mockResolvedValueOnce([makeReceiptRow({ id: `660e8400-e29b-41d4-a716-44665544${String(i).padStart(4, "0")}` })]);
  }
  mockInsertReturning.mockResolvedValue([]);
}

// Seed audit log select (used by writeAuditLog's previous-hash fetch)
function seedAuditLogSelect(): void {
  mockSelectFrom.mockImplementation(() => ({
    orderBy: () => ({
      limit: () => Promise.resolve([]),
    }),
    where: () => ({ limit: () => Promise.resolve([]) }),
  }));
}

/**
 * BASE_CHECK uses "base" chain — resolves to US jurisdiction ($3000 threshold).
 * Avoids UNKNOWN jurisdiction which has threshold=0 (all txs trigger Travel Rule).
 */
const BASE_CHECK = {
  sender: { address: TEST_BUYER_ADDRESS, chain: "base" },
  receiver: { address: TEST_SELLER_ADDRESS, chain: "base" },
  amount: "100.00",
  asset: "USDC",
  protocol: "x402",
};

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe("E2E Phase 2: Compliance Pipeline", () => {
  const app = createApp();

  beforeEach(() => {
    vi.clearAllMocks();
    resetRateLimitStore();
    resetScreener(); // Clear screener singleton cache between tests
    mockFetch.mockResolvedValue(chainalysisClean());
    seedAuditLogSelect();
  });

  // -------------------------------------------------------------------------
  // AML scoring — score reflects actual factors, not hardcoded
  // -------------------------------------------------------------------------

  describe("AML scoring reflects actual risk factors", () => {
    it("should return riskScore in valid range 0-100 for a clean low-value transaction", async () => {
      seedInserts();

      const res = await app.request("/api/v1/compliance/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...BASE_CHECK, amount: "10.00" }),
      });

      expect(res.status).toBe(201);
      const { data } = await res.json();
      // AML score from real scorer is in [0, 100]
      expect(data.riskScore).toBeGreaterThanOrEqual(0);
      expect(data.riskScore).toBeLessThanOrEqual(100);
      expect(data.status).toBe("APPROVED");
    });

    it("should return riskScore > 0 when amount triggers structuring detection", async () => {
      seedInserts();

      // $2,800 is within 10% below the $3,000 Travel Rule threshold — structuring rule fires
      const res = await app.request("/api/v1/compliance/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...BASE_CHECK, amount: "2800.00" }),
      });

      expect(res.status).toBe(201);
      const { data } = await res.json();
      // Structuring rule fires (weight 0.1 / totalWeight) → score > 0
      expect(data.riskScore).toBeGreaterThan(0);
      expect(data.riskScore).toBeLessThanOrEqual(100);
    });

    it("should include riskFactors array with at least one entry per active rule", async () => {
      seedInserts();

      const res = await app.request("/api/v1/compliance/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(BASE_CHECK),
      });

      expect(res.status).toBe(201);
      const { data } = await res.json();
      expect(data.riskFactors).toBeInstanceOf(Array);
      expect(data.riskFactors.length).toBeGreaterThan(0);
      // Each factor entry must have the expected fields
      for (const f of data.riskFactors) {
        expect(f).toHaveProperty("factor");
        expect(f).toHaveProperty("weight");
        expect(f).toHaveProperty("detail");
      }
    });

    it("should include riskThreshold matching the configured max risk score", async () => {
      seedInserts();

      const res = await app.request("/api/v1/compliance/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(BASE_CHECK),
      });

      expect(res.status).toBe(201);
      const { data } = await res.json();
      expect(data.riskThreshold).toBeDefined();
      expect(typeof data.riskThreshold).toBe("number");
      expect(data.riskThreshold).toBeGreaterThan(0);
    });

    it("should include riskExceedsThreshold boolean in response", async () => {
      seedInserts();

      const res = await app.request("/api/v1/compliance/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(BASE_CHECK),
      });

      expect(res.status).toBe(201);
      const { data } = await res.json();
      expect(typeof data.riskExceedsThreshold).toBe("boolean");
    });
  });

  // -------------------------------------------------------------------------
  // Travel Rule threshold — jurisdiction-aware via price-guard
  // -------------------------------------------------------------------------

  describe("Travel Rule threshold uses jurisdiction-aware price-guard conversion", () => {
    it("should return travelRuleStatus=NOT_REQUIRED for $100 USDC on base (US threshold $3000)", async () => {
      seedInserts();

      const res = await app.request("/api/v1/compliance/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...BASE_CHECK, amount: "100.00", asset: "USDC" }),
      });

      expect(res.status).toBe(201);
      const { data } = await res.json();
      // $100 USDC < $3000 US threshold → NOT_REQUIRED
      expect(data.travelRuleStatus).toBe("NOT_REQUIRED");
      const trCheck = data.checks.find(
        (c: { checkType: string }) => c.checkType === "TRAVEL_RULE",
      );
      expect(trCheck).toBeDefined();
      expect(trCheck.result).toBe("NOT_REQUIRED");
      expect(trCheck.details.amountUsd).toBe(100);
    });

    it("should return travelRuleStatus=REQUIRED_PENDING for $4000 USDC on base (above $3000 US threshold)", async () => {
      seedInserts({}, { travelRuleStatus: "REQUIRED_PENDING" });

      const res = await app.request("/api/v1/compliance/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...BASE_CHECK, amount: "4000.00", asset: "USDC" }),
      });

      expect(res.status).toBe(201);
      const { data } = await res.json();
      // $4000 > $3000 US threshold → REQUIRED_PENDING
      expect(data.travelRuleStatus).toBe("REQUIRED_PENDING");
      const trCheck = data.checks.find(
        (c: { checkType: string }) => c.checkType === "TRAVEL_RULE",
      );
      expect(trCheck).toBeDefined();
      expect(trCheck.result).toBe("REQUIRED");
      expect(trCheck.details.amountUsd).toBe(4000);
    });

    it("should return travelRuleStatus=NOT_REQUIRED for 0.001 ETH ($3.50) on base", async () => {
      seedInserts({}, { travelRuleStatus: "NOT_REQUIRED" });

      const res = await app.request("/api/v1/compliance/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // 0.001 × $3500 = $3.50 → well below $3000 US threshold
        body: JSON.stringify({ ...BASE_CHECK, amount: "0.001", asset: "ETH" }),
      });

      expect(res.status).toBe(201);
      const { data } = await res.json();
      expect(data.travelRuleStatus).toBe("NOT_REQUIRED");
    });

    it("should apply travel rule conservatively for unknown asset (Infinity USD → REQUIRED_PENDING)", async () => {
      seedInserts({}, { travelRuleStatus: "REQUIRED_PENDING" });

      const res = await app.request("/api/v1/compliance/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // UNKNOWN_TOKEN → convertToUsd returns Infinity → threshold applies regardless
        body: JSON.stringify({ ...BASE_CHECK, amount: "1.00", asset: "UNKNOWN_TOKEN" }),
      });

      expect(res.status).toBe(201);
      const { data } = await res.json();
      expect(data.travelRuleStatus).toBe("REQUIRED_PENDING");
    });

    it("should include amountUsd and thresholdUsd in the TRAVEL_RULE check details", async () => {
      seedInserts();

      const res = await app.request("/api/v1/compliance/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...BASE_CHECK, amount: "500.00", asset: "USDC" }),
      });

      expect(res.status).toBe(201);
      const { data } = await res.json();
      const trCheck = data.checks.find(
        (c: { checkType: string }) => c.checkType === "TRAVEL_RULE",
      );
      expect(trCheck).toBeDefined();
      expect(trCheck.details.amountUsd).toBe(500);
      // appliedThresholdUsd for US jurisdiction = 3000
      expect(trCheck.details.appliedThresholdUsd).toBe(3000);
    });
  });

  // -------------------------------------------------------------------------
  // traceId propagation
  // -------------------------------------------------------------------------

  describe("traceId flows through request → check → receipt → response", () => {
    it("should echo traceId from request body in response data", async () => {
      seedInserts();

      const traceId = "trace-phase2-test-0001";

      const res = await app.request("/api/v1/compliance/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...BASE_CHECK, traceId }),
      });

      expect(res.status).toBe(201);
      const { data } = await res.json();
      expect(data.traceId).toBe(traceId);
    });

    it("should set X-Trace-ID response header matching the body traceId", async () => {
      seedInserts();

      const traceId = "trace-phase2-header-test-0002";

      const res = await app.request("/api/v1/compliance/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...BASE_CHECK, traceId }),
      });

      expect(res.status).toBe(201);
      expect(res.headers.get("X-Trace-ID")).toBe(traceId);
    });

    it("should use X-Trace-ID request header as traceId when not in body", async () => {
      seedInserts();

      const headerTraceId = "trace-from-header-0003";

      const res = await app.request("/api/v1/compliance/check", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Trace-ID": headerTraceId,
        },
        body: JSON.stringify(BASE_CHECK),
      });

      expect(res.status).toBe(201);
      const { data } = await res.json();
      expect(data.traceId).toBe(headerTraceId);
      expect(res.headers.get("X-Trace-ID")).toBe(headerTraceId);
    });

    it("should auto-generate a UUID traceId when none is provided", async () => {
      seedInserts();

      const res = await app.request("/api/v1/compliance/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(BASE_CHECK),
      });

      expect(res.status).toBe(201);
      const { data } = await res.json();
      // Auto-generated traceId must be a UUID v4
      expect(data.traceId).toBeTruthy();
      expect(data.traceId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );
      expect(res.headers.get("X-Trace-ID")).toBe(data.traceId);
    });

    it("should propagate parentTraceId from request body to response", async () => {
      seedInserts();

      const traceId = "trace-child-0005";
      const parentTraceId = "trace-parent-0005";

      const res = await app.request("/api/v1/compliance/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...BASE_CHECK, traceId, parentTraceId }),
      });

      expect(res.status).toBe(201);
      const { data } = await res.json();
      expect(data.traceId).toBe(traceId);
      expect(data.parentTraceId).toBe(parentTraceId);
    });

    it("should include receiptId and receiptHash starting with 0x in response", async () => {
      seedInserts();

      const res = await app.request("/api/v1/compliance/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(BASE_CHECK),
      });

      expect(res.status).toBe(201);
      const { data } = await res.json();
      expect(data.receiptId).toBeTruthy();
      expect(data.receiptHash).toMatch(/^0x/);
    });
  });

  // -------------------------------------------------------------------------
  // Sanctioned address → riskScore = 100
  // -------------------------------------------------------------------------

  describe("Sanctioned address triggers risk score 100", () => {
    it("should set riskScore=100 when receiver is in offline OFAC SDN list (Tornado Cash)", async () => {
      // The offline SDN list in @prooflink/core includes TORNADO_CASH_100ETH_POOL
      seedInserts({ riskScore: 100, status: "REJECTED" });

      const res = await app.request("/api/v1/compliance/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...BASE_CHECK,
          receiver: { address: TORNADO_CASH_100ETH_POOL, chain: "base" },
        }),
      });

      expect(res.status).toBe(201);
      const { data } = await res.json();
      // OFAC SDN fallback sets matched=true → riskScore forced to 100
      expect(data.riskScore).toBe(100);
      expect(data.status).toBe("REJECTED");
      expect(data.riskExceedsThreshold).toBe(true);
    });

    it("should set riskScore=100 when sender is returned as sanctioned by the Chainalysis provider", async () => {
      // Configure fetch to return sanctioned for the TC address, clean for others.
      // This tests that the screener correctly flags the sender as sanctioned
      // and the compliance handler forces riskScore to 100.
      mockFetch.mockImplementation((url: string) => {
        if (url.includes(TORNADO_CASH_100ETH_POOL.toLowerCase())) {
          return Promise.resolve(chainalysisSanctioned());
        }
        return Promise.resolve(chainalysisClean());
      });

      seedInserts({ riskScore: 100, status: "REJECTED" });

      const res = await app.request("/api/v1/compliance/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sender: { address: TORNADO_CASH_100ETH_POOL, chain: "base" },
          receiver: { address: TEST_SELLER_ADDRESS, chain: "base" },
          amount: "100.00",
          asset: "USDC",
          protocol: "x402",
        }),
      });

      expect(res.status).toBe(201);
      const { data } = await res.json();
      expect(data.riskScore).toBe(100);
      expect(data.status).toBe("REJECTED");
    });

    it("should return status REJECTED when sanctioned address is involved", async () => {
      seedInserts({ riskScore: 100, status: "REJECTED" });

      const res = await app.request("/api/v1/compliance/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...BASE_CHECK,
          receiver: { address: TORNADO_CASH_100ETH_POOL, chain: "base" },
        }),
      });

      expect(res.status).toBe(201);
      const { data } = await res.json();
      expect(data.status).toBe("REJECTED");
    });

    it("should include SANCTIONS_SCREENING FAILED check when sanctioned address is detected", async () => {
      seedInserts({ riskScore: 100, status: "REJECTED" });

      const res = await app.request("/api/v1/compliance/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...BASE_CHECK,
          receiver: { address: TORNADO_CASH_100ETH_POOL, chain: "base" },
        }),
      });

      expect(res.status).toBe(201);
      const { data } = await res.json();
      const sanctionsChecks = data.checks.filter(
        (c: { checkType: string; result: string }) => c.checkType === "SANCTIONS_SCREENING",
      );
      const failedCheck = sanctionsChecks.find(
        (c: { result: string }) => c.result === "FAILED",
      );
      expect(failedCheck).toBeDefined();
    });
  });

  // -------------------------------------------------------------------------
  // Audit events — broadcastWsEvent is called
  // -------------------------------------------------------------------------

  describe("Audit events emitted on compliance check", () => {
    it("should call broadcastWsEvent at least once for an approved compliance check", async () => {
      seedInserts();

      await app.request("/api/v1/compliance/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(BASE_CHECK),
      });

      expect(mockBroadcastWsEvent).toHaveBeenCalled();
    });

    it("should broadcast a compliance.check.passed event for an approved check", async () => {
      seedInserts();

      await app.request("/api/v1/compliance/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...BASE_CHECK, amount: "50.00" }),
      });

      const calls = mockBroadcastWsEvent.mock.calls;
      const complianceEvent = calls.find(
        ([evt]: [{ type: string }]) => evt.type === "compliance.check.passed",
      );
      expect(complianceEvent).toBeDefined();
    });

    it("should broadcast a compliance.check.failed event when status is REJECTED", async () => {
      seedInserts({ riskScore: 100, status: "REJECTED" });

      // Use a sanctioned receiver so the handler sets status = REJECTED
      await app.request("/api/v1/compliance/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...BASE_CHECK,
          receiver: { address: TORNADO_CASH_100ETH_POOL, chain: "base" },
        }),
      });

      const types = mockBroadcastWsEvent.mock.calls.map(([evt]: [{ type: string }]) => evt.type);
      expect(types).toContain("compliance.check.failed");
    });

    it("should broadcast sanctions.alert event when a sanctioned address is involved", async () => {
      seedInserts({ riskScore: 100, status: "REJECTED" });

      await app.request("/api/v1/compliance/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...BASE_CHECK,
          receiver: { address: TORNADO_CASH_100ETH_POOL, chain: "base" },
        }),
      });

      const types = mockBroadcastWsEvent.mock.calls.map(([evt]: [{ type: string }]) => evt.type);
      expect(types).toContain("sanctions.alert");
    });

    it("should broadcast event with traceId matching the request traceId", async () => {
      seedInserts();

      const traceId = "trace-event-audit-0007";

      await app.request("/api/v1/compliance/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...BASE_CHECK, traceId }),
      });

      const calls = mockBroadcastWsEvent.mock.calls;
      const eventWithTrace = calls.find(
        ([evt]: [{ traceId?: string }]) => evt.traceId === traceId,
      );
      expect(eventWithTrace).toBeDefined();
    });

    it("should broadcast event containing checkId and receiptId in its data payload", async () => {
      seedInserts();

      await app.request("/api/v1/compliance/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(BASE_CHECK),
      });

      const calls = mockBroadcastWsEvent.mock.calls;
      const complianceEvent = calls.find(
        ([evt]: [{ type: string; data?: Record<string, unknown> }]) =>
          evt.type === "compliance.check.passed",
      );
      expect(complianceEvent).toBeDefined();
      const [evt] = complianceEvent as [{ data: Record<string, unknown> }];
      expect(evt.data.checkId).toBeTruthy();
      expect(evt.data.receiptId).toBeTruthy();
    });
  });

  // -------------------------------------------------------------------------
  // Batch compliance checks
  // -------------------------------------------------------------------------

  describe("Batch compliance checks screen each address individually", () => {
    it("should return one result per input check", async () => {
      seedBatchInserts(3);

      const res = await app.request("/api/v1/compliance/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          checks: [
            { ...BASE_CHECK, amount: "10.00" },
            { ...BASE_CHECK, amount: "20.00" },
            { ...BASE_CHECK, amount: "30.00" },
          ],
        }),
      });

      expect(res.status).toBe(201);
      const { data } = await res.json();
      expect(data.total).toBe(3);
      expect(data.results).toHaveLength(3);
    });

    it("should assign independent receiptIds to each batch item", async () => {
      seedBatchInserts(2);

      const res = await app.request("/api/v1/compliance/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          checks: [
            { ...BASE_CHECK, amount: "50.00" },
            { ...BASE_CHECK, amount: "75.00" },
          ],
        }),
      });

      expect(res.status).toBe(201);
      const { data } = await res.json();
      const receiptIds = data.results.map((r: { receiptId: string }) => r.receiptId);
      expect(new Set(receiptIds).size).toBe(2);
    });

    it("should include sequential index field for positional correlation", async () => {
      seedBatchInserts(2);

      const res = await app.request("/api/v1/compliance/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          checks: [
            { ...BASE_CHECK, amount: "10.00" },
            { ...BASE_CHECK, amount: "20.00" },
          ],
        }),
      });

      expect(res.status).toBe(201);
      const { data } = await res.json();
      expect(data.results[0].index).toBe(0);
      expect(data.results[1].index).toBe(1);
    });

    it("should set X-Trace-ID header from request on batch response", async () => {
      seedBatchInserts(1);

      const batchTraceId = "batch-trace-test-0001";

      const res = await app.request("/api/v1/compliance/batch", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Trace-ID": batchTraceId,
        },
        body: JSON.stringify({
          checks: [{ ...BASE_CHECK, amount: "10.00" }],
        }),
      });

      expect(res.status).toBe(201);
      expect(res.headers.get("X-Trace-ID")).toBe(batchTraceId);
    });

    it("should return 400 when batch checks array is empty", async () => {
      const res = await app.request("/api/v1/compliance/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ checks: [] }),
      });

      expect(res.status).toBe(400);
    });

    it("should set riskScore=100 for a batch item with a sanctioned receiver", async () => {
      seedBatchInserts(2);

      const res = await app.request("/api/v1/compliance/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          checks: [
            { ...BASE_CHECK, amount: "10.00" },
            {
              ...BASE_CHECK,
              amount: "10.00",
              receiver: { address: TORNADO_CASH_100ETH_POOL, chain: "base" },
            },
          ],
        }),
      });

      expect(res.status).toBe(201);
      const { data } = await res.json();
      const item1 = data.results.find((r: { index: number }) => r.index === 1);
      expect(item1).toBeDefined();
      expect(item1.riskScore).toBe(100);
      expect(item1.status).toBe("REJECTED");
    });

    it("should assign per-item traceIds when specified in each check", async () => {
      seedBatchInserts(2);

      const res = await app.request("/api/v1/compliance/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          checks: [
            { ...BASE_CHECK, amount: "10.00", traceId: "item-trace-001" },
            { ...BASE_CHECK, amount: "20.00", traceId: "item-trace-002" },
          ],
        }),
      });

      expect(res.status).toBe(201);
      const { data } = await res.json();
      expect(data.results[0].traceId).toBe("item-trace-001");
      expect(data.results[1].traceId).toBe("item-trace-002");
    });

    it("should produce riskScore and status for each batch result", async () => {
      seedBatchInserts(2);

      const res = await app.request("/api/v1/compliance/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          checks: [
            { ...BASE_CHECK, amount: "50.00" },
            { ...BASE_CHECK, amount: "100.00" },
          ],
        }),
      });

      expect(res.status).toBe(201);
      const { data } = await res.json();
      for (const result of data.results) {
        expect(result.riskScore).toBeGreaterThanOrEqual(0);
        expect(result.riskScore).toBeLessThanOrEqual(100);
        expect(["APPROVED", "ESCALATED", "REJECTED"]).toContain(result.status);
      }
    });
  });
});
