import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Use vi.hoisted() so mock factory can reference these variables before the
// module graph is evaluated (vi.mock calls are hoisted to the top of the file).
// ---------------------------------------------------------------------------

const { mockScreenAddressFn, MockSanctionsScreener } = vi.hoisted(() => {
  const mockScreenAddressFn = vi.fn();
  const MockSanctionsScreener = vi.fn().mockImplementation(() => ({
    screenAddress: mockScreenAddressFn,
  }));
  return { mockScreenAddressFn, MockSanctionsScreener };
});

vi.mock("@prooflink/core", () => ({
  SanctionsScreener: MockSanctionsScreener,
  ChainalysisProvider: vi.fn().mockImplementation(() => ({})),
  TRMLabsProvider: vi.fn().mockImplementation(() => ({})),
  loadConfig: vi.fn().mockReturnValue({
    failOpen: true,
    chainalysisBaseUrl: "https://api.chainalysis.com",
  }),
  OFAC_SDN_ETH_ADDRESSES: new Set([
    "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
  ]),
}));

import {
  screenAddress,
  getScreener,
  resetScreener,
} from "../../services/screening.js";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("getScreener", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetScreener();
  });

  afterEach(() => {
    resetScreener();
  });

  it("returns a SanctionsScreener instance", () => {
    const screener = getScreener();
    expect(screener).toBeDefined();
    expect(screener).toHaveProperty("screenAddress");
  });

  it("returns the same instance on multiple calls (singleton)", () => {
    const first = getScreener();
    const second = getScreener();
    expect(first).toBe(second);
  });

  it("constructs a new instance after resetScreener is called", () => {
    getScreener();
    resetScreener();
    getScreener();
    // Two separate construction calls
    expect(MockSanctionsScreener).toHaveBeenCalledTimes(2);
  });

  it("does not construct more than one SanctionsScreener without a reset", () => {
    getScreener();
    getScreener();
    getScreener();
    expect(MockSanctionsScreener).toHaveBeenCalledTimes(1);
  });
});

describe("resetScreener", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetScreener();
  });

  afterEach(() => {
    resetScreener();
  });

  it("clears the singleton so next getScreener() creates a fresh instance", () => {
    getScreener(); // initialise
    resetScreener(); // clear
    getScreener(); // re-initialise

    expect(MockSanctionsScreener).toHaveBeenCalledTimes(2);
  });

  it("can be called multiple times without throwing", () => {
    expect(() => {
      resetScreener();
      resetScreener();
      resetScreener();
    }).not.toThrow();
  });
});

describe("screenAddress", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetScreener();
  });

  afterEach(() => {
    resetScreener();
  });

  // -------------------------------------------------------------------------
  // Clean address
  // -------------------------------------------------------------------------

  it("returns matched: false for a clean address", async () => {
    mockScreenAddressFn.mockResolvedValue({
      matched: false,
      listsChecked: ["OFAC_SDN", "EU_SANCTIONS"],
      matchDetails: [],
      riskScore: 5,
      screenedAt: new Date().toISOString(),
      provider: "chainalysis",
    });

    const result = await screenAddress("0xCLEAN000000000000000000000000000000000", "ethereum");

    expect(result.matched).toBe(false);
    expect(result.riskScore).toBe(5);
    expect(mockScreenAddressFn).toHaveBeenCalledWith(
      "0xCLEAN000000000000000000000000000000000",
      "ethereum",
    );
  });

  // -------------------------------------------------------------------------
  // Sanctioned address
  // -------------------------------------------------------------------------

  it("returns matched: true and riskScore: 100 for a sanctioned address", async () => {
    mockScreenAddressFn.mockResolvedValue({
      matched: true,
      listsChecked: ["OFAC_SDN"],
      matchDetails: [
        {
          list: "OFAC_SDN",
          entryId: "SDN-12345",
          name: "Sanctioned Entity",
          matchConfidence: 1.0,
        },
      ],
      riskScore: 100,
      screenedAt: new Date().toISOString(),
      provider: "chainalysis",
    });

    const result = await screenAddress("0xSANCTIONED0000000000000000000000000000", "ethereum");

    expect(result.matched).toBe(true);
    expect(result.riskScore).toBe(100);
    expect(result.matchDetails).toHaveLength(1);
    expect(result.matchDetails[0].list).toBe("OFAC_SDN");
  });

  // -------------------------------------------------------------------------
  // Screener throws — fallback to offline OFAC list
  // -------------------------------------------------------------------------

  it("falls back to offline OFAC list when screener throws — non-sanctioned address returns matched: false", async () => {
    mockScreenAddressFn.mockRejectedValue(new Error("API timeout"));

    const result = await screenAddress("0xREGULAR00000000000000000000000000000000", "ethereum");

    expect(result.matched).toBe(false);
    expect(result.provider).toBe("ofac_sdn_offline");
    expect(result.listsChecked).toEqual(["OFAC_SDN"]);
  });

  it("falls back to offline OFAC list and returns matched: true for a known OFAC SDN address", async () => {
    mockScreenAddressFn.mockRejectedValue(new Error("network error"));

    // This address is in the mocked OFAC_SDN_ETH_ADDRESSES set
    const sanctionedAddr = "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef";
    const result = await screenAddress(sanctionedAddr, "ethereum");

    expect(result.matched).toBe(true);
    expect(result.riskScore).toBe(100);
    expect(result.provider).toBe("ofac_sdn_offline");
  });

  it("offline fallback: matched address has matchDetails with OFAC_SDN entry", async () => {
    mockScreenAddressFn.mockRejectedValue(new Error("service unavailable"));

    const sanctionedAddr = "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef";
    const result = await screenAddress(sanctionedAddr, "ethereum");

    expect(result.matchDetails).toHaveLength(1);
    expect(result.matchDetails[0].list).toBe("OFAC_SDN");
    expect(result.matchDetails[0].matchConfidence).toBe(1.0);
  });

  it("offline fallback: non-matched address has empty matchDetails and riskScore 0", async () => {
    mockScreenAddressFn.mockRejectedValue(new Error("timeout"));

    const cleanAddr = "0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
    const result = await screenAddress(cleanAddr, "ethereum");

    expect(result.matched).toBe(false);
    expect(result.matchDetails).toHaveLength(0);
    expect(result.riskScore).toBe(0);
  });

  it("offline fallback: screenedAt is a valid ISO timestamp", async () => {
    mockScreenAddressFn.mockRejectedValue(new Error("down"));

    const result = await screenAddress("0xANY", "ethereum");

    expect(result.screenedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  it("offline fallback: OFAC SDN match is case-insensitive (address lowercased)", async () => {
    mockScreenAddressFn.mockRejectedValue(new Error("error"));

    // Same address but uppercase — the fallback does toLowerCase()
    const upperAddr = "0xDEADBEEFDEADBEEFDEADBEEFDEADBEEFDEADBEEF";
    const result = await screenAddress(upperAddr, "ethereum");

    expect(result.matched).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Chain parameter is forwarded
  // -------------------------------------------------------------------------

  it("forwards the chain parameter to the underlying screener", async () => {
    mockScreenAddressFn.mockResolvedValue({
      matched: false,
      listsChecked: [],
      matchDetails: [],
      riskScore: 0,
      screenedAt: new Date().toISOString(),
      provider: "chainalysis",
    });

    await screenAddress("0xADDR", "eip155:8453");

    expect(mockScreenAddressFn).toHaveBeenCalledWith("0xADDR", "eip155:8453");
  });
});

// ---------------------------------------------------------------------------
// Sprint 2: failOpen behaviour is NODE_ENV-driven
//
// The fix: getScreener() now derives failOpen from NODE_ENV rather than
// hardcoding failOpen:true. Production must be fail-closed so that a
// screening API outage blocks payments rather than silently passing them.
// ---------------------------------------------------------------------------

// Grab the mocked loadConfig so we can assert on its call arguments.
// Because vi.mock is hoisted, we import the mocked module after the mock block.
import { loadConfig as _mockLoadConfig } from "@prooflink/core";
const mockLoadConfig = _mockLoadConfig as ReturnType<typeof vi.fn>;

describe("Sprint 2: getScreener failOpen — NODE_ENV-driven", () => {
  const originalNodeEnv = process.env.NODE_ENV;

  beforeEach(() => {
    vi.clearAllMocks();
    resetScreener();
  });

  afterEach(() => {
    resetScreener();
    // Restore original NODE_ENV after each test
    if (originalNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = originalNodeEnv;
    }
  });

  it("calls loadConfig with failOpen:false when NODE_ENV=production", () => {
    process.env.NODE_ENV = "production";
    getScreener();

    expect(mockLoadConfig).toHaveBeenCalledWith(
      expect.objectContaining({ failOpen: false }),
    );
  });

  it("calls loadConfig with failOpen:true when NODE_ENV=development", () => {
    process.env.NODE_ENV = "development";
    getScreener();

    expect(mockLoadConfig).toHaveBeenCalledWith(
      expect.objectContaining({ failOpen: true }),
    );
  });

  it("calls loadConfig with failOpen:true when NODE_ENV=test", () => {
    process.env.NODE_ENV = "test";
    getScreener();

    expect(mockLoadConfig).toHaveBeenCalledWith(
      expect.objectContaining({ failOpen: true }),
    );
  });

  it("calls loadConfig with failOpen:true when NODE_ENV is undefined", () => {
    delete process.env.NODE_ENV;
    getScreener();

    expect(mockLoadConfig).toHaveBeenCalledWith(
      expect.objectContaining({ failOpen: true }),
    );
  });

  // -------------------------------------------------------------------------
  // Behavioural: the screenAddress wrapper always falls back to offline OFAC
  // regardless of NODE_ENV, because our catch block is independent of failOpen.
  // failOpen in config affects the screener's internal retry logic; our wrapper
  // is a safety net on top.
  // -------------------------------------------------------------------------

  it("production mode: screenAddress still uses offline OFAC fallback when screener throws", async () => {
    mockScreenAddressFn.mockRejectedValue(new Error("Provider unreachable in production"));

    process.env.NODE_ENV = "production";
    resetScreener();

    const result = await screenAddress("0xPROD_ADDR", "ethereum");

    // Screener threw but wrapper caught it — falls back to offline OFAC
    expect(result.provider).toBe("ofac_sdn_offline");
    // Unknown address → not matched
    expect(result.matched).toBe(false);
  });

  it("production mode: offline fallback still matches OFAC SDN addresses", async () => {
    mockScreenAddressFn.mockRejectedValue(new Error("API down"));

    process.env.NODE_ENV = "production";
    resetScreener();

    // 0xdeadbeef... is in the mocked OFAC_SDN_ETH_ADDRESSES set
    const result = await screenAddress(
      "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
      "ethereum",
    );

    expect(result.matched).toBe(true);
    expect(result.riskScore).toBe(100);
    expect(result.provider).toBe("ofac_sdn_offline");
  });

  it("non-production mode: screener error also falls back to offline OFAC (consistent behaviour)", async () => {
    mockScreenAddressFn.mockRejectedValue(new Error("dev API error"));

    process.env.NODE_ENV = "development";
    resetScreener();

    const result = await screenAddress("0xDEV_CLEAN_ADDR", "ethereum");
    expect(result.provider).toBe("ofac_sdn_offline");
    expect(result.matched).toBe(false);
  });
});
