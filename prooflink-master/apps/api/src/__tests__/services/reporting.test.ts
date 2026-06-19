import { describe, expect, it, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mock DB layer — generateSAR / generateCTR call getDb() internally.
// ---------------------------------------------------------------------------

const mockSelectWhereLimitFn = vi.fn();
const mockInsertReturningFn = vi.fn();

vi.mock("../../db/index.js", () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({
        where: () => ({
          limit: mockSelectWhereLimitFn,
        }),
      }),
    }),
    insert: () => ({
      values: () => ({
        returning: mockInsertReturningFn,
      }),
    }),
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
  shouldAutoGenerateSAR,
  shouldAutoGenerateCTR,
  generateSAR,
  generateCTR,
} from "../../services/reporting.js";

// ---------------------------------------------------------------------------
// shouldAutoGenerateSAR
// ---------------------------------------------------------------------------

describe("shouldAutoGenerateSAR", () => {
  it("returns false when riskScore is exactly 70 (threshold is strictly > 70)", () => {
    // Source: `if (riskScore > SAR_RISK_THRESHOLD) return true` where threshold = 70
    // 70 > 70 is false — no factors → returns false
    expect(shouldAutoGenerateSAR(70, [])).toBe(false);
  });

  it("returns true when riskScore is well above threshold with no factors", () => {
    expect(shouldAutoGenerateSAR(90, [])).toBe(true);
  });

  it("returns true when factor is sanctions_match regardless of low score", () => {
    expect(shouldAutoGenerateSAR(50, ["sanctions_match"])).toBe(true);
  });

  it("returns true when factor is structuring regardless of low score", () => {
    expect(shouldAutoGenerateSAR(50, ["structuring"])).toBe(true);
  });

  it("returns true when factor is mixer_interaction regardless of low score", () => {
    expect(shouldAutoGenerateSAR(50, ["mixer_interaction"])).toBe(true);
  });

  it("returns true when factor is rapid_movement", () => {
    expect(shouldAutoGenerateSAR(50, ["rapid_movement"])).toBe(true);
  });

  it("returns true when factor is darknet_interaction", () => {
    expect(shouldAutoGenerateSAR(50, ["darknet_interaction"])).toBe(true);
  });

  it("returns false when score is below threshold and no trigger factors present", () => {
    expect(shouldAutoGenerateSAR(30, [])).toBe(false);
  });


  it("returns false when score is 69 and no factors", () => {
    expect(shouldAutoGenerateSAR(69, [])).toBe(false);
  });

  it("returns false when factors contain only non-trigger terms", () => {
    expect(shouldAutoGenerateSAR(30, ["low_activity", "normal_behavior"])).toBe(false);
  });

  it("returns true when one factor is a trigger among non-trigger factors", () => {
    expect(shouldAutoGenerateSAR(30, ["normal_behavior", "sanctions_match"])).toBe(true);
  });

  it("returns true when score is 71 with empty factors", () => {
    expect(shouldAutoGenerateSAR(71, [])).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// shouldAutoGenerateCTR
// ---------------------------------------------------------------------------

describe("shouldAutoGenerateCTR", () => {
  it("returns true when amount equals exactly $10,000", () => {
    expect(shouldAutoGenerateCTR(10_000)).toBe(true);
  });

  it("returns false when amount is $9,999.99 (below threshold)", () => {
    expect(shouldAutoGenerateCTR(9_999.99)).toBe(false);
  });

  it("returns false for Infinity (non-finite number)", () => {
    expect(shouldAutoGenerateCTR(Infinity)).toBe(false);
  });

  it("returns false for -Infinity (non-finite number)", () => {
    expect(shouldAutoGenerateCTR(-Infinity)).toBe(false);
  });

  it("returns false for NaN", () => {
    expect(shouldAutoGenerateCTR(NaN)).toBe(false);
  });

  it("returns true for amounts well above $10,000", () => {
    expect(shouldAutoGenerateCTR(50_000)).toBe(true);
    expect(shouldAutoGenerateCTR(1_000_000)).toBe(true);
  });

  it("returns false for amounts below threshold", () => {
    expect(shouldAutoGenerateCTR(0)).toBe(false);
    expect(shouldAutoGenerateCTR(5_000)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// generateSAR — DB-integrated path
// ---------------------------------------------------------------------------

describe("generateSAR", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function makeCheck(overrides: Record<string, unknown> = {}) {
    return {
      id: "check-001",
      senderAddress: "0xSENDER",
      receiverAddress: "0xRECEIVER",
      senderAgentDid: "did:web:sender.io",
      receiverAgentDid: "did:web:receiver.io",
      amount: "500.00",
      asset: "USDC",
      chain: "eip155:8453",
      protocol: "x402",
      status: "ESCALATED",
      riskScore: 75,
      checks: [],
      createdAt: new Date("2026-03-20T12:00:00Z"),
      ...overrides,
    };
  }

  function makeReport(overrides: Record<string, unknown> = {}) {
    return {
      id: "report-001",
      type: "SAR",
      status: "DRAFT",
      priority: "HIGH",
      complianceCheckId: "check-001",
      triggerReason: "Test reason",
      reportData: {},
      createdAt: new Date(),
      ...overrides,
    };
  }

  it("throws when compliance check is not found", async () => {
    mockSelectWhereLimitFn.mockResolvedValue([]);

    await expect(
      generateSAR("nonexistent-check", "manual_review", {}),
    ).rejects.toThrow("Compliance check nonexistent-check not found");
  });

  it("throws when DB insert returns empty array", async () => {
    mockSelectWhereLimitFn.mockResolvedValue([makeCheck()]);
    mockInsertReturningFn.mockResolvedValue([]);

    await expect(
      generateSAR("check-001", "manual_review", {}),
    ).rejects.toThrow("Failed to create SAR report");
  });

  it("returns the created report when DB succeeds", async () => {
    const check = makeCheck();
    const report = makeReport();
    mockSelectWhereLimitFn.mockResolvedValue([check]);
    mockInsertReturningFn.mockResolvedValue([report]);

    const result = await generateSAR("check-001", "suspicious activity", { flaggedBy: "auto" });

    expect(result).toEqual(report);
  });

  it("derives CRITICAL priority when check has sanctions_match factor", async () => {
    const check = makeCheck({
      riskScore: 60,
      checks: [{ checkType: "SANCTIONS_SCREENING", result: "FAILED" }],
    });
    const report = makeReport({ priority: "CRITICAL" });
    mockSelectWhereLimitFn.mockResolvedValue([check]);
    mockInsertReturningFn.mockResolvedValue([report]);

    const result = await generateSAR("check-001", "sanctions match", {});

    expect(result.priority).toBe("CRITICAL");
  });

  it("derives CRITICAL priority when riskScore >= 90", async () => {
    const check = makeCheck({ riskScore: 95, checks: [] });
    const report = makeReport({ priority: "CRITICAL" });
    mockSelectWhereLimitFn.mockResolvedValue([check]);
    mockInsertReturningFn.mockResolvedValue([report]);

    const result = await generateSAR("check-001", "high risk", {});

    expect(result.priority).toBe("CRITICAL");
  });
});

// ---------------------------------------------------------------------------
// generateCTR — DB-integrated path
// ---------------------------------------------------------------------------

describe("generateCTR", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function makeCheck() {
    return {
      id: "check-ctr-001",
      senderAddress: "0xSENDER",
      receiverAddress: "0xRECEIVER",
      senderAgentDid: "did:web:sender.io",
      receiverAgentDid: null,
      amount: "15000.00",
      asset: "USDC",
      chain: "eip155:8453",
      protocol: "direct",
      status: "APPROVED",
      riskScore: 20,
      checks: [],
      createdAt: new Date("2026-03-20T12:00:00Z"),
    };
  }

  it("throws when compliance check is not found", async () => {
    mockSelectWhereLimitFn.mockResolvedValue([]);

    await expect(
      generateCTR("nonexistent-check", {}),
    ).rejects.toThrow("Compliance check nonexistent-check not found");
  });

  it("throws when DB insert returns empty array", async () => {
    mockSelectWhereLimitFn.mockResolvedValue([makeCheck()]);
    mockInsertReturningFn.mockResolvedValue([]);

    await expect(generateCTR("check-ctr-001", {})).rejects.toThrow(
      "Failed to create CTR report",
    );
  });

  it("returns the created CTR report when DB succeeds", async () => {
    const report = {
      id: "report-ctr-001",
      type: "CTR",
      status: "DRAFT",
      priority: "NORMAL",
      complianceCheckId: "check-ctr-001",
      triggerReason: "Currency transaction >= $10,000 USD",
      reportData: {},
      createdAt: new Date(),
    };
    mockSelectWhereLimitFn.mockResolvedValue([makeCheck()]);
    mockInsertReturningFn.mockResolvedValue([report]);

    const result = await generateCTR("check-ctr-001", { amountUsd: 15_000 });

    expect(result).toEqual(report);
    expect(result.type).toBe("CTR");
  });
});
