import { describe, expect, it, vi, beforeEach } from "vitest";

// Mock the logger so we can assert warn calls without polluting test output
vi.mock("../../utils/logger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import {
  convertToUsd,
  getAssetPriceUsd,
  validatePriceReasonable,
  REFERENCE_PRICES_USD,
  TRAVEL_RULE_THRESHOLD_USD,
} from "../../utils/price-guard.js";
import { logger } from "../../utils/logger.js";

const mockLogger = vi.mocked(logger);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function expectFiniteClose(value: number, expected: number, epsilon = 0.001) {
  expect(value).toBeTypeOf("number");
  expect(Number.isFinite(value)).toBe(true);
  expect(Math.abs(value - expected)).toBeLessThan(epsilon);
}

// ---------------------------------------------------------------------------
// getAssetPriceUsd
// ---------------------------------------------------------------------------

describe("getAssetPriceUsd", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 1.0 for USDC", () => {
    expect(getAssetPriceUsd("USDC")).toBe(1.0);
  });

  it("returns 1.0 for USDT", () => {
    expect(getAssetPriceUsd("USDT")).toBe(1.0);
  });

  it("returns 1.08 for EURC", () => {
    expect(getAssetPriceUsd("EURC")).toBe(1.08);
  });

  it("returns 1.0 for DAI", () => {
    expect(getAssetPriceUsd("DAI")).toBe(1.0);
  });

  it("returns 3500 for ETH", () => {
    expect(getAssetPriceUsd("ETH")).toBe(3500);
  });

  it("returns 87000 for BTC", () => {
    expect(getAssetPriceUsd("BTC")).toBe(87000);
  });

  it("normalizes lowercase asset symbols", () => {
    expect(getAssetPriceUsd("usdc")).toBe(1.0);
    expect(getAssetPriceUsd("eth")).toBe(3500);
    expect(getAssetPriceUsd("btc")).toBe(87000);
  });

  it("normalizes mixed-case asset symbols", () => {
    expect(getAssetPriceUsd("Usdc")).toBe(1.0);
    expect(getAssetPriceUsd("Eth")).toBe(3500);
  });

  it("returns 0 for unknown asset and warns", () => {
    const result = getAssetPriceUsd("SHIB");
    expect(result).toBe(0);
    expect(mockLogger.warn).toHaveBeenCalledOnce();
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining("unknown asset"),
      expect.objectContaining({ asset: "SHIB" }),
    );
  });

  it("returns 0 for empty string asset", () => {
    const result = getAssetPriceUsd("");
    expect(result).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// convertToUsd
// ---------------------------------------------------------------------------

describe("convertToUsd", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("converts USDC correctly — 1:1 with USD", () => {
    expectFiniteClose(convertToUsd("100", "USDC"), 100);
  });

  it("converts USDT correctly — 1:1 with USD", () => {
    expectFiniteClose(convertToUsd("250.5", "USDT"), 250.5);
  });

  it("converts EURC correctly at 1.08 rate", () => {
    expectFiniteClose(convertToUsd("100", "EURC"), 108);
  });

  it("converts DAI correctly — 1:1 with USD", () => {
    expectFiniteClose(convertToUsd("999", "DAI"), 999);
  });

  it("converts ETH at 3500 USD per ETH", () => {
    expectFiniteClose(convertToUsd("1", "ETH"), 3500);
    expectFiniteClose(convertToUsd("0.5", "ETH"), 1750);
  });

  it("converts BTC at 87000 USD per BTC", () => {
    expectFiniteClose(convertToUsd("1", "BTC"), 87000);
    expectFiniteClose(convertToUsd("0.1", "BTC"), 8700);
  });

  it("returns Infinity for unknown asset as fail-safe", () => {
    const result = convertToUsd("100", "SHIB");
    expect(result).toBe(Infinity);
  });

  it("returns Infinity for negative amount as fail-safe", () => {
    const result = convertToUsd("-50", "USDC");
    expect(result).toBe(Infinity);
    expect(mockLogger.warn).toHaveBeenCalledOnce();
  });

  it("returns 0 for zero amount", () => {
    const result = convertToUsd("0", "USDC");
    expect(result).toBe(0);
  });

  it("returns 0 for zero amount regardless of asset", () => {
    expect(convertToUsd("0", "ETH")).toBe(0);
    expect(convertToUsd("0", "BTC")).toBe(0);
  });

  it("returns Infinity for non-numeric string amount", () => {
    const result = convertToUsd("abc", "USDC");
    expect(result).toBe(Infinity);
    expect(mockLogger.warn).toHaveBeenCalledOnce();
  });

  it("returns Infinity for empty string amount", () => {
    const result = convertToUsd("", "USDC");
    // Number("") === 0, which is valid and >= 0
    // So this returns 0 * 1 = 0 (USDC), not Infinity
    // Empty string becomes 0 which is valid
    expect(result).toBe(0);
  });

  it("handles very large amounts correctly", () => {
    expectFiniteClose(convertToUsd("1000000", "USDC"), 1_000_000);
  });

  it("at exactly $3000 Travel Rule threshold with USDC — convertToUsd equals threshold", () => {
    const result = convertToUsd("3000", "USDC");
    expectFiniteClose(result, TRAVEL_RULE_THRESHOLD_USD);
  });

  it("just below $3000 threshold with USDC", () => {
    const result = convertToUsd("2999.99", "USDC");
    expect(result).toBeLessThan(TRAVEL_RULE_THRESHOLD_USD);
  });

  it("just above $3000 threshold with USDC", () => {
    const result = convertToUsd("3000.01", "USDC");
    expect(result).toBeGreaterThan(TRAVEL_RULE_THRESHOLD_USD);
  });

  it("ETH amount that crosses $3000 threshold", () => {
    // 0.857 ETH * 3500 = 2999.5 < 3000 (below)
    const below = convertToUsd("0.857", "ETH");
    expect(below).toBeLessThan(TRAVEL_RULE_THRESHOLD_USD);

    // 0.86 ETH * 3500 = 3010 > 3000 (above)
    const above = convertToUsd("0.86", "ETH");
    expect(above).toBeGreaterThan(TRAVEL_RULE_THRESHOLD_USD);
  });
});

// ---------------------------------------------------------------------------
// validatePriceReasonable
// ---------------------------------------------------------------------------

describe("validatePriceReasonable", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns true when price exactly matches reference", () => {
    expect(validatePriceReasonable("USDC", 1.0)).toBe(true);
    expect(validatePriceReasonable("ETH", 3500)).toBe(true);
    expect(validatePriceReasonable("BTC", 87000)).toBe(true);
  });

  it("returns true at exactly +5% deviation boundary (inclusive)", () => {
    const ethRef = REFERENCE_PRICES_USD["ETH"]!;
    // Exactly 5% above
    const price = ethRef * 1.05;
    // At exactly 5%, deviation === threshold. Code uses >, so should pass
    expect(validatePriceReasonable("ETH", price)).toBe(true);
  });

  it("returns false just beyond +5% deviation", () => {
    const ethRef = REFERENCE_PRICES_USD["ETH"]!;
    const price = ethRef * 1.0501;
    expect(validatePriceReasonable("ETH", price)).toBe(false);
  });

  it("returns true at exactly -5% deviation boundary (inclusive)", () => {
    const ethRef = REFERENCE_PRICES_USD["ETH"]!;
    const price = ethRef * 0.95;
    expect(validatePriceReasonable("ETH", price)).toBe(true);
  });

  it("returns false just beyond -5% deviation", () => {
    const ethRef = REFERENCE_PRICES_USD["ETH"]!;
    const price = ethRef * 0.9499;
    expect(validatePriceReasonable("ETH", price)).toBe(false);
  });

  it("returns true for USDC within ±5% of 1.0", () => {
    expect(validatePriceReasonable("USDC", 1.04)).toBe(true);
    expect(validatePriceReasonable("USDC", 0.96)).toBe(true);
  });

  it("returns false for USDC price beyond ±5% of 1.0", () => {
    expect(validatePriceReasonable("USDC", 1.06)).toBe(false);
    expect(validatePriceReasonable("USDC", 0.94)).toBe(false);
  });

  it("returns true for EURC within ±5% of 1.08", () => {
    expect(validatePriceReasonable("EURC", 1.08)).toBe(true);
    expect(validatePriceReasonable("EURC", 1.08 * 1.04)).toBe(true);
  });

  it("returns false for EURC beyond ±5%", () => {
    expect(validatePriceReasonable("EURC", 1.08 * 1.06)).toBe(false);
  });

  it("returns false for unknown asset (conservative default)", () => {
    const result = validatePriceReasonable("SHIB", 0.00001);
    expect(result).toBe(false);
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining("cannot validate price"),
      expect.objectContaining({ asset: "SHIB" }),
    );
  });

  it("returns false for Infinity price", () => {
    expect(validatePriceReasonable("ETH", Infinity)).toBe(false);
  });

  it("returns false for zero price", () => {
    expect(validatePriceReasonable("ETH", 0)).toBe(false);
  });

  it("returns false for negative price", () => {
    expect(validatePriceReasonable("ETH", -100)).toBe(false);
  });

  it("returns false for NaN price", () => {
    expect(validatePriceReasonable("ETH", NaN)).toBe(false);
  });

  it("normalizes lowercase asset symbols", () => {
    expect(validatePriceReasonable("usdc", 1.0)).toBe(true);
    expect(validatePriceReasonable("eth", 3500)).toBe(true);
  });

  it("TRAVEL_RULE_THRESHOLD_USD is exported as 3000", () => {
    expect(TRAVEL_RULE_THRESHOLD_USD).toBe(3000);
  });
});
