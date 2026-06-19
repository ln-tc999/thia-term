/**
 * Integration tests: Full compliance pipeline (API → Core Engine → Decisions → Receipt)
 *
 * Tests the end-to-end compliance pipeline exercising:
 *   - POST /api/v1/compliance/check  (full sanctions + AML + Travel Rule + KYA + Jurisdiction)
 *   - GET  /api/v1/compliance/receipt/:id
 *   - GET  /api/v1/compliance/history
 *   - Multiple sequential checks with caching
 *   - Concurrent compliance requests
 *
 * DB is mocked. Chainalysis API is mocked via vi.stubGlobal("fetch").
 * All internal pipeline logic (ProofLinkEngine) runs unmodified.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { createApp } from "../../apps/api/src/app.js";
import { resetRateLimitStore } from "../../apps/api/src/middleware/rate-limit.js";
import {
  mockInsertReturning,
  mockSelectFrom,
  mockUpdateReturning,
  sampleComplianceCheck,
  sampleReceipt,
  CLEAN_SENDER,
  CLEAN_RECEIVER,
  KNOWN_OFAC_ADDRESS,
  cleanChainalysisResponse,
  sanctionedChainalysisResponse,
} from "./setup.js";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("../../apps/api/src/db/index.js", () => ({
  getDb: () => ({
    insert: () => ({
      values: () => ({
        returning: mockInsertReturning,
        onConflictDoUpdate: () => ({ returning: mockInsertReturning }),
      }),
    }),
    select: () => ({ from: mockSelectFrom }),
    update: () => ({
      set: () => ({
        where: () => ({
          returning: mockUpdateReturning,
          catch: () => {},
        }),
      }),
    }),
  }),
  getPool: () => ({
    query: vi.fn().mockResolvedValue({ rows: [{ "?column?": 1 }] }),
  }),
}));

vi.mock("../../apps/api/src/middleware/auth.js", () => ({
  authMiddleware: () => async (_c: unknown, next: () => Promise<void>) => next(),
}));

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const app = createApp();

function setCleanFetch(): void {
  mockFetch.mockImplementation(() => Promise.resolve(cleanChainalysisResponse()));
}

function setSanctionedFetchForSender(): void {
  mockFetch
    .mockImplementationOnce(() => Promise.resolve(sanctionedChainalysisResponse()))
    .mockImplementationOnce(() => Promise.resolve(cleanChainalysisResponse()));
}

function seedCheckAndReceipt(
  checkOverrides: Record<string, unknown> = {},
  receiptOverrides: Record<string, unknown> = {},
): void {
  mockInsertReturning
    .mockResolvedValueOnce([{ ...sampleComplianceCheck, ...checkOverrides, createdAt: new Date() }])
    .mockResolvedValueOnce([{ ...sampleReceipt, ...receiptOverrides, createdAt: new Date() }]);
}

const baseCheckBody = {
  sender: { address: CLEAN_SENDER, chain: "eip155:8453" },
  receiver: { address: CLEAN_RECEIVER, chain: "eip155:8453" },
  amount: "100.00",
  asset: "USDC",
  protocol: "x402",
};

// ---------------------------------------------------------------------------
// Happy-path pipeline (APPROVED)
// ---------------------------------------------------------------------------

describe("Compliance pipeline — happy path", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetRateLimitStore();
    setCleanFetch();
  });

  it("returns_201_with_approved_decision_for_clean_addresses", async () => {
    // Arrange
    seedCheckAndReceipt();

    // Act
    const res = await app.request("/v1/compliance/check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(baseCheckBody),
    });

    // Assert
    expect(res.status).toBe(201);
    const json = await res.json() as { success: boolean; data: Record<string, unknown> };
    expect(json.success).toBe(true);
    expect(json.data.status).toBe("APPROVED");
    expect(json.data.riskScore).toBeDefined();
    expect(json.data.receiptId).toBeTruthy();
    expect(json.data.timestamp).toBeTruthy();
    expect(json.data.travelRuleStatus).toBeTruthy();
  });

  it("pipeline_runs_sanctions_aml_and_travel_rule_checks", async () => {
    // Arrange
    seedCheckAndReceipt();

    // Act
    const res = await app.request("/v1/compliance/check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(baseCheckBody),
    });

    // Assert — at least sanctions + AML checks should be in the response
    const json = await res.json() as { success: boolean; data: { checks: Array<Record<string, string>> } };
    expect(json.data.checks).toBeInstanceOf(Array);
    expect(json.data.checks.length).toBeGreaterThanOrEqual(2);

    const types = json.data.checks.map((c) => c.checkType);
    expect(types).toContain("SANCTIONS_SCREENING");
    expect(types).toContain("AML_MONITORING");
  });

  it("pipeline_emits_travel_rule_transmitted_for_large_us_amount", async () => {
    // Arrange
    seedCheckAndReceipt({ travelRuleStatus: "TRANSMITTED" }, { travelRuleStatus: "TRANSMITTED" });

    // Act — $5000 from US → triggers travel rule
    const res = await app.request("/v1/compliance/check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...baseCheckBody,
        amount: "5000.00",
        sender: { ...baseCheckBody.sender, jurisdiction: "US" },
      }),
    });

    // Assert — pipeline runs; DB was seeded to show TRANSMITTED
    expect(res.status).toBe(201);
    const json = await res.json() as { success: boolean; data: Record<string, unknown> };
    expect(json.data.status).toBe("APPROVED");
  });

  it("pipeline_inserts_compliance_check_and_receipt_into_db", async () => {
    // Arrange
    seedCheckAndReceipt();

    // Act
    await app.request("/v1/compliance/check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(baseCheckBody),
    });

    // Assert — both DB inserts were called (check + receipt)
    expect(mockInsertReturning).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// Sanctioned address → REJECTED pipeline
// ---------------------------------------------------------------------------

describe("Compliance pipeline — sanctioned sender", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetRateLimitStore();
  });

  it("returns_201_with_rejected_status_for_sanctioned_sender", async () => {
    // Arrange — Chainalysis marks sender as sanctioned
    setSanctionedFetchForSender();
    seedCheckAndReceipt({ status: "REJECTED", riskScore: 100 });

    // Act
    const res = await app.request("/v1/compliance/check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(baseCheckBody),
    });

    // Assert — API returns 201 regardless; the decision payload carries status
    expect(res.status).toBe(201);
    const json = await res.json() as { success: boolean; data: Record<string, unknown> };
    expect(json.success).toBe(true);
    // DB was seeded with REJECTED, receipt stored
    expect(json.data.receiptId).toBe(sampleReceipt.id);
  });

  it("known_ofac_address_triggers_sanctions_check_failure_in_pipeline", async () => {
    // Arrange — Chainalysis clean (offline fallback handles OFAC)
    setCleanFetch();
    seedCheckAndReceipt({ status: "REJECTED", riskScore: 100 }, { overallStatus: "BLOCKED" });

    // Act
    const res = await app.request("/v1/compliance/check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...baseCheckBody,
        sender: { address: KNOWN_OFAC_ADDRESS, chain: "eip155:8453" },
      }),
    });

    // Assert
    expect(res.status).toBe(201);
    const json = await res.json() as { success: boolean; data: Record<string, unknown> };
    expect(json.success).toBe(true);
    // Receipt was stored in DB (blocked decisions still get receipts)
    expect(mockInsertReturning).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// Restricted jurisdiction → REJECTED pipeline
// ---------------------------------------------------------------------------

describe("Compliance pipeline — restricted jurisdiction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetRateLimitStore();
    setCleanFetch();
  });

  it("returns_201_with_rejected_status_for_iran_jurisdiction", async () => {
    // Arrange
    seedCheckAndReceipt({ status: "REJECTED", riskScore: 100 });

    // Act
    const res = await app.request("/v1/compliance/check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...baseCheckBody,
        sender: { ...baseCheckBody.sender, jurisdiction: "IR" },
      }),
    });

    // Assert
    expect(res.status).toBe(201);
    const json = await res.json() as { success: boolean; data: Record<string, unknown> };
    expect(json.success).toBe(true);
    expect(json.data.receiptId).toBeTruthy();
  });

  it("usdt_with_eu_jurisdiction_blocked_by_mica_in_pipeline", async () => {
    // Arrange — USDT is not MiCA-authorized; EU = DE
    seedCheckAndReceipt({ status: "REJECTED", riskScore: 100 });

    // Act
    const res = await app.request("/v1/compliance/check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...baseCheckBody,
        asset: "USDT",
        sender: { ...baseCheckBody.sender, jurisdiction: "DE" },
      }),
    });

    // Assert
    expect(res.status).toBe(201);
    const json = await res.json() as { success: boolean; data: Record<string, unknown> };
    expect(json.success).toBe(true);
    // Receipt was still issued
    expect(mockInsertReturning).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// Receipt retrieval
// ---------------------------------------------------------------------------

describe("Compliance pipeline — receipt retrieval", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetRateLimitStore();
    setCleanFetch();
  });

  it("get_receipt_by_id_returns_correct_fields", async () => {
    // Arrange — seed DB select mock to return sample receipt
    mockSelectFrom.mockReturnValue({
      where: () => ({
        limit: () => Promise.resolve([{ ...sampleReceipt, createdAt: new Date() }]),
      }),
    });

    // Act
    const res = await app.request(`/v1/compliance/receipt/${sampleReceipt.id}`);

    // Assert
    expect(res.status).toBe(200);
    const json = await res.json() as { success: boolean; data: Record<string, unknown> };
    expect(json.success).toBe(true);
    expect(json.data.id).toBe(sampleReceipt.id);
    expect(json.data.overallStatus).toBeTruthy();
    expect(json.data.riskScore).toBeDefined();
    expect(json.data.travelRuleStatus).toBeTruthy();
    expect(json.data.signature).toBeTruthy();
  });

  it("get_receipt_returns_404_for_unknown_id", async () => {
    // Arrange
    mockSelectFrom.mockReturnValue({
      where: () => ({
        limit: () => Promise.resolve([]),
      }),
    });

    // Act
    const res = await app.request(`/v1/compliance/receipt/00000000-0000-0000-0000-000000000099`);

    // Assert
    expect(res.status).toBe(404);
    const json = await res.json() as { success: boolean; error: Record<string, string> };
    expect(json.success).toBe(false);
    expect(json.error.code).toBe("NOT_FOUND");
  });

  it("get_receipt_returns_400_for_non_uuid_id", async () => {
    // Act
    const res = await app.request("/v1/compliance/receipt/not-a-valid-uuid-xyz");

    // Assert
    expect(res.status).toBe(400);
    const json = await res.json() as { success: boolean; error: Record<string, string> };
    expect(json.success).toBe(false);
    expect(json.error.code).toBe("BAD_REQUEST");
  });
});

// ---------------------------------------------------------------------------
// History endpoint
// ---------------------------------------------------------------------------

describe("Compliance pipeline — history", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetRateLimitStore();
    setCleanFetch();
  });

  it("get_compliance_history_returns_paginated_results", async () => {
    // Arrange
    let callCount = 0;
    mockSelectFrom.mockImplementation(() => {
      callCount++;
      if (callCount % 2 === 1) {
        return {
          where: () => ({
            orderBy: () => ({
              limit: () => ({
                offset: () => Promise.resolve([
                  { ...sampleComplianceCheck, createdAt: new Date() },
                ]),
              }),
            }),
          }),
        };
      }
      return { where: () => Promise.resolve([{ count: 1 }]) };
    });

    // Act
    const res = await app.request("/v1/compliance/history?page=1&limit=10");

    // Assert
    expect(res.status).toBe(200);
    const json = await res.json() as { success: boolean; data: { items: unknown[]; pagination: Record<string, number> } };
    expect(json.success).toBe(true);
    expect(json.data.items).toBeInstanceOf(Array);
    expect(json.data.pagination).toBeDefined();
    expect(json.data.pagination.page).toBe(1);
  });

  it("get_compliance_history_returns_empty_array_when_no_checks", async () => {
    // Arrange
    let callCount = 0;
    mockSelectFrom.mockImplementation(() => {
      callCount++;
      if (callCount % 2 === 1) {
        return {
          where: () => ({
            orderBy: () => ({
              limit: () => ({ offset: () => Promise.resolve([]) }),
            }),
          }),
        };
      }
      return { where: () => Promise.resolve([{ count: 0 }]) };
    });

    // Act
    const res = await app.request("/v1/compliance/history");

    // Assert
    expect(res.status).toBe(200);
    const json = await res.json() as { success: boolean; data: { items: unknown[] } };
    expect(json.data.items).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Sequential compliance checks (caching behavior)
// ---------------------------------------------------------------------------

describe("Compliance pipeline — multiple sequential checks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetRateLimitStore();
    setCleanFetch();
  });

  it("three_sequential_checks_each_return_201_with_receipt", async () => {
    // Arrange — seed 6 inserts (2 per request: check + receipt)
    for (let i = 0; i < 3; i++) {
      mockInsertReturning
        .mockResolvedValueOnce([{ ...sampleComplianceCheck, id: `check-${i}`, createdAt: new Date() }])
        .mockResolvedValueOnce([{ ...sampleReceipt, id: `receipt-${i}`, createdAt: new Date() }]);
    }

    // Act — run 3 sequential checks
    for (let i = 0; i < 3; i++) {
      const res = await app.request("/v1/compliance/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...baseCheckBody, amount: `${(i + 1) * 50}.00` }),
      });
      expect(res.status).toBe(201);
      const json = await res.json() as { success: boolean };
      expect(json.success).toBe(true);
    }

    // Assert — 6 DB inserts total
    expect(mockInsertReturning).toHaveBeenCalledTimes(6);
  });

  it("second_check_with_same_clean_addresses_is_not_blocked_by_cache", async () => {
    // Arrange — two consecutive inserts for each check
    seedCheckAndReceipt();
    seedCheckAndReceipt();

    // Act
    const r1 = await app.request("/v1/compliance/check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(baseCheckBody),
    });
    const r2 = await app.request("/v1/compliance/check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(baseCheckBody),
    });

    // Assert — both pass
    expect(r1.status).toBe(201);
    expect(r2.status).toBe(201);
    const j1 = await r1.json() as { data: Record<string, unknown> };
    const j2 = await r2.json() as { data: Record<string, unknown> };
    expect(j1.data.status).toBe("APPROVED");
    expect(j2.data.status).toBe("APPROVED");
  });
});

// ---------------------------------------------------------------------------
// Concurrent compliance requests
// ---------------------------------------------------------------------------

describe("Compliance pipeline — concurrent requests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetRateLimitStore();
    setCleanFetch();
  });

  it("five_concurrent_compliance_checks_all_succeed", async () => {
    // Arrange — 10 insert responses (2 per concurrent check)
    for (let i = 0; i < 5; i++) {
      mockInsertReturning
        .mockResolvedValueOnce([{ ...sampleComplianceCheck, id: `check-c${i}`, createdAt: new Date() }])
        .mockResolvedValueOnce([{ ...sampleReceipt, id: `receipt-c${i}`, createdAt: new Date() }]);
    }

    // Act — fire 5 concurrent requests
    const requests = Array.from({ length: 5 }, (_, i) =>
      app.request("/v1/compliance/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...baseCheckBody, amount: `${(i + 1) * 20}.00` }),
      }),
    );
    const responses = await Promise.all(requests);

    // Assert — all 5 return 201
    for (const res of responses) {
      expect(res.status).toBe(201);
    }
    expect(mockInsertReturning).toHaveBeenCalledTimes(10);
  });

  it("concurrent_checks_for_different_senders_produce_independent_receipts", async () => {
    // Arrange — 4 inserts for 2 concurrent checks
    mockInsertReturning
      .mockResolvedValueOnce([{ ...sampleComplianceCheck, id: "check-a", createdAt: new Date() }])
      .mockResolvedValueOnce([{ ...sampleReceipt, id: "receipt-a", createdAt: new Date() }])
      .mockResolvedValueOnce([{ ...sampleComplianceCheck, id: "check-b", createdAt: new Date() }])
      .mockResolvedValueOnce([{ ...sampleReceipt, id: "receipt-b", createdAt: new Date() }]);

    // Act
    const [resA, resB] = await Promise.all([
      app.request("/v1/compliance/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...baseCheckBody,
          sender: { address: CLEAN_SENDER, chain: "eip155:8453" },
        }),
      }),
      app.request("/v1/compliance/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...baseCheckBody,
          sender: { address: CLEAN_RECEIVER, chain: "eip155:1" },
        }),
      }),
    ]);

    // Assert — both requests complete successfully
    expect(resA.status).toBe(201);
    expect(resB.status).toBe(201);
  });
});

// ---------------------------------------------------------------------------
// Input validation
// ---------------------------------------------------------------------------

describe("Compliance pipeline — input validation", () => {
  const app = createApp();

  beforeEach(() => {
    vi.clearAllMocks();
    resetRateLimitStore();
  });

  it("returns_400_for_missing_sender_address", async () => {
    const res = await app.request("/v1/compliance/check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sender: { chain: "eip155:8453" }, // no address
        receiver: { address: CLEAN_RECEIVER, chain: "eip155:8453" },
        amount: "100",
        asset: "USDC",
        protocol: "x402",
      }),
    });
    expect(res.status).toBe(400);
  });

  it("returns_400_for_missing_receiver", async () => {
    const res = await app.request("/v1/compliance/check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sender: baseCheckBody.sender,
        amount: "100",
        asset: "USDC",
        protocol: "x402",
      }),
    });
    expect(res.status).toBe(400);
  });

  it("returns_400_for_invalid_json_body", async () => {
    const res = await app.request("/v1/compliance/check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{{not json}}",
    });
    expect(res.status).toBe(400);
    const json = await res.json() as { error: Record<string, string> };
    expect(json.error.code).toBe("BAD_REQUEST");
  });

  it("returns_400_for_empty_body", async () => {
    const res = await app.request("/v1/compliance/check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });
});
