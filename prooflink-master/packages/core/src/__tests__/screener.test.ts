import { describe, expect, it, vi, beforeEach } from "vitest";
import { SanctionsScreener, SanctionsScreeningError } from "../sanctions/screener.js";
import type { ProofLinkConfig } from "../config.js";
import { OFAC_SDN_ETH_ADDRESSES } from "../sanctions/lists.js";

// ---------------------------------------------------------------------------
// Mock fetch
// ---------------------------------------------------------------------------

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

/** Create a fresh Response for each call — Response bodies can only be read once. */
function cleanResponse() {
  return new Response(JSON.stringify({ identifications: [] }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function sanctionedResponse() {
  return new Response(
    JSON.stringify({
      identifications: [
        {
          category: "sanctions",
          name: "Tornado Cash",
          description: "OFAC SDN",
          url: "https://example.com",
        },
      ],
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

function makeConfig(overrides?: Partial<ProofLinkConfig>): ProofLinkConfig {
  return {
    chainalysisBaseUrl: "https://public.chainalysis.com/api/v1",
    sanctionsLists: ["OFAC_SDN"],
    maxRiskScore: 85,
    escalationThreshold: 60,
    failOpen: false,
    allowlist: [],
    blocklist: [],
    travelRuleThresholds: { US: 3000 },
    defaultTravelRuleThresholdUsd: 3000,
    cacheMaxEntries: 100,
    sanctionsCacheTtlMs: 300_000,
    kyaCacheTtlMs: 900_000,
    restrictedJurisdictions: [],
    ...overrides,
  };
}

describe("SanctionsScreener", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  describe("screenAddress — clean address", () => {
    it("should return matched=false for a clean address", async () => {
      mockFetch.mockImplementation(() => Promise.resolve(cleanResponse()));

      const screener = new SanctionsScreener(makeConfig());
      const result = await screener.screenAddress("0xcleanaddress", "eip155:1");

      expect(result.matched).toBe(false);
      expect(result.riskScore).toBe(0);
      expect(result.provider).toBe("chainalysis_free");
      expect(result.listsChecked).toContain("OFAC_SDN");
    });

    it("should call Chainalysis API with correct URL", async () => {
      mockFetch.mockImplementation(() => Promise.resolve(cleanResponse()));

      const screener = new SanctionsScreener(makeConfig());
      await screener.screenAddress("0xabc123", "eip155:1");

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const callUrl = mockFetch.mock.calls[0]?.[0];
      expect(callUrl).toBe(
        "https://public.chainalysis.com/api/v1/address/0xabc123",
      );
    });
  });

  describe("screenAddress — sanctioned address", () => {
    it("should return matched=true for a sanctioned address", async () => {
      mockFetch.mockImplementation(() => Promise.resolve(sanctionedResponse()));

      const screener = new SanctionsScreener(makeConfig());
      const result = await screener.screenAddress("0xsanctioned", "eip155:1");

      expect(result.matched).toBe(true);
      expect(result.riskScore).toBe(100);
      expect(result.matchDetails.length).toBe(1);
      expect(result.matchDetails[0]?.name).toBe("Tornado Cash");
    });
  });

  describe("screenAddress — caching", () => {
    it("should cache results and not call API on second request", async () => {
      mockFetch.mockImplementation(() => Promise.resolve(cleanResponse()));

      const screener = new SanctionsScreener(makeConfig());
      await screener.screenAddress("0xcached", "eip155:1");
      const secondResult = await screener.screenAddress("0xcached", "eip155:1");

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(secondResult.matched).toBe(false);
    });

    it("should differentiate cache by chain", async () => {
      mockFetch.mockImplementation(() => Promise.resolve(cleanResponse()));

      const screener = new SanctionsScreener(makeConfig());
      await screener.screenAddress("0xmultichain", "eip155:1");
      await screener.screenAddress("0xmultichain", "eip155:8453");

      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it("should respect cache invalidation", async () => {
      mockFetch.mockImplementation(() => Promise.resolve(cleanResponse()));

      const screener = new SanctionsScreener(makeConfig());
      await screener.screenAddress("0xinvalidate", "eip155:1");

      screener.invalidateCache("0xinvalidate", "eip155:1");
      await screener.screenAddress("0xinvalidate", "eip155:1");

      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
  });

  describe("screenAddress — API failure", () => {
    it("should throw SanctionsScreeningError when API fails and failOpen is false", async () => {
      mockFetch.mockRejectedValue(new Error("Network error"));

      const screener = new SanctionsScreener(makeConfig({ failOpen: false }));

      await expect(
        screener.screenAddress("0xunknown", "eip155:1"),
      ).rejects.toThrow(SanctionsScreeningError);
    });

    it("should fallback to offline list when API fails and failOpen is true", async () => {
      mockFetch.mockRejectedValue(new Error("Network error"));

      const screener = new SanctionsScreener(makeConfig({ failOpen: true }));
      const result = await screener.screenAddress("0xunknown", "eip155:1");

      expect(result.matched).toBe(false);
    });

    it("should detect known OFAC address in offline mode when API fails", async () => {
      mockFetch.mockRejectedValue(new Error("Network error"));

      const knownAddress = Array.from(OFAC_SDN_ETH_ADDRESSES)[0]!;
      const screener = new SanctionsScreener(makeConfig({ failOpen: false }));

      // Should NOT throw because the offline list catches it
      const result = await screener.screenAddress(knownAddress, "eip155:1");
      expect(result.matched).toBe(true);
    });
  });

  describe("screenAddress — API key header", () => {
    it("should include X-API-Key header when chainalysisApiKey is set", async () => {
      mockFetch.mockImplementation(() => Promise.resolve(cleanResponse()));

      const screener = new SanctionsScreener(
        makeConfig({ chainalysisApiKey: "test-key-123" }),
      );
      await screener.screenAddress("0xwithkey", "eip155:1");

      const callOptions = mockFetch.mock.calls[0]?.[1];
      expect(callOptions?.headers?.["X-API-Key"]).toBe("test-key-123");
    });

    it("should not include X-API-Key header when no key is set", async () => {
      mockFetch.mockImplementation(() => Promise.resolve(cleanResponse()));

      const screener = new SanctionsScreener(makeConfig());
      await screener.screenAddress("0xnokey", "eip155:1");

      const callOptions = mockFetch.mock.calls[0]?.[1];
      expect(callOptions?.headers?.["X-API-Key"]).toBeUndefined();
    });
  });

  describe("screenBatch", () => {
    it("should screen multiple addresses in parallel", async () => {
      mockFetch.mockImplementation(() => Promise.resolve(cleanResponse()));

      const screener = new SanctionsScreener(makeConfig());
      const results = await screener.screenBatch([
        { address: "0xaddr1", chain: "eip155:1" },
        { address: "0xaddr2", chain: "eip155:1" },
        { address: "0xaddr3", chain: "eip155:8453" },
      ]);

      expect(results.length).toBe(3);
      expect(results.every((r) => !r.matched)).toBe(true);
      expect(mockFetch).toHaveBeenCalledTimes(3);
    });
  });

  describe("screenBatch — mixed results", () => {
    it("should handle a mix of sanctioned and clean addresses in a batch", async () => {
      mockFetch
        .mockImplementationOnce(() => Promise.resolve(cleanResponse()))
        .mockImplementationOnce(() => Promise.resolve(sanctionedResponse()))
        .mockImplementationOnce(() => Promise.resolve(cleanResponse()));

      const screener = new SanctionsScreener(makeConfig());
      const results = await screener.screenBatch([
        { address: "0xclean1", chain: "eip155:1" },
        { address: "0xbad", chain: "eip155:1" },
        { address: "0xclean2", chain: "eip155:1" },
      ]);

      expect(results[0]?.matched).toBe(false);
      expect(results[1]?.matched).toBe(true);
      expect(results[2]?.matched).toBe(false);
    });

    it("should return empty array for empty batch input", async () => {
      const screener = new SanctionsScreener(makeConfig());
      const results = await screener.screenBatch([]);

      expect(results).toHaveLength(0);
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe("clearCache", () => {
    it("should clear all cached entries", async () => {
      mockFetch.mockImplementation(() => Promise.resolve(cleanResponse()));

      const screener = new SanctionsScreener(makeConfig());
      await screener.screenAddress("0xclear1", "eip155:1");
      await screener.screenAddress("0xclear2", "eip155:1");

      screener.clearCache();
      await screener.screenAddress("0xclear1", "eip155:1");
      await screener.screenAddress("0xclear2", "eip155:1");

      // 2 initial + 2 after clear = 4
      expect(mockFetch).toHaveBeenCalledTimes(4);
    });
  });

  describe("screenAddress — offline list (fail-open)", () => {
    it("should detect known OFAC ETH address in offline mode", async () => {
      mockFetch.mockRejectedValue(new Error("Network error"));

      // 0x8589427373d6d84e98730d7795d8f6f8731fda16 is in the offline list
      const knownAddress = "0x8589427373d6d84e98730d7795d8f6f8731fda16";
      const screener = new SanctionsScreener(makeConfig({ failOpen: true }));
      const result = await screener.screenAddress(knownAddress, "eip155:1");

      expect(result.matched).toBe(true);
      expect(result.provider).toBe("ofac_sdn_offline");
    });

    it("should detect known OFAC ETH address as uppercase in offline mode (case-insensitive)", async () => {
      mockFetch.mockRejectedValue(new Error("Network error"));

      const knownAddress = "0x8589427373D6D84E98730D7795D8F6F8731FDA16";
      const screener = new SanctionsScreener(makeConfig({ failOpen: true }));
      const result = await screener.screenAddress(knownAddress, "eip155:1");

      expect(result.matched).toBe(true);
    });
  });

  describe("screenAddress — response screenedAt timestamp", () => {
    it("should return a valid ISO-8601 screenedAt timestamp", async () => {
      mockFetch.mockImplementation(() => Promise.resolve(cleanResponse()));

      const screener = new SanctionsScreener(makeConfig());
      const result = await screener.screenAddress("0xts", "eip155:1");

      expect(() => new Date(result.screenedAt)).not.toThrow();
      expect(result.screenedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    });
  });
});
