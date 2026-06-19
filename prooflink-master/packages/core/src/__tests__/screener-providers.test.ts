import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  ChainalysisProvider,
  SanctionsScreener,
  SanctionsScreeningError,
  TRMLabsProvider,
  type SanctionsProvider,
  type SanctionsProviderResult,
} from "../sanctions/screener.js";
import type { ProofLinkConfig } from "../config.js";
import { OFAC_SDN_ETH_ADDRESSES, OFAC_SDN_BTC_ADDRESSES } from "../sanctions/lists.js";

// ---------------------------------------------------------------------------
// Global fetch mock — same pattern as the existing screener.test.ts
// ---------------------------------------------------------------------------

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

function chainalysisCleanResponse(): Response {
  return new Response(JSON.stringify({ identifications: [] }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function chainalysisSanctionedResponse(overrides?: {
  name?: string;
  category?: string;
  url?: string;
}): Response {
  const identification = {
    category: overrides?.category ?? "sanctions",
    name: overrides?.name ?? "Tornado Cash",
    description: "OFAC SDN designated entity",
    url: overrides?.url ?? "https://example.com/entry/123",
  };
  return new Response(
    JSON.stringify({ identifications: [identification] }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

function trmCleanResponse(): Response {
  return new Response(
    JSON.stringify([{ addressRiskIndicators: [] }]),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

function trmSanctionedResponse(): Response {
  return new Response(
    JSON.stringify([
      {
        addressRiskIndicators: [
          { category: "Sanctions", categoryId: "cat-001", riskType: "SANCTIONS" },
        ],
      },
    ]),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

/** Stub provider that always resolves clean. */
function makeCleanProvider(name: string): SanctionsProvider {
  return {
    name,
    screen: vi.fn().mockResolvedValue({
      matched: false,
      matchDetails: [],
      riskScore: 0,
    } satisfies SanctionsProviderResult),
  };
}

/** Stub provider that always resolves with a match. */
function makeSanctionedProvider(name: string): SanctionsProvider {
  return {
    name,
    screen: vi.fn().mockResolvedValue({
      matched: true,
      matchDetails: [
        {
          list: "OFAC_SDN" as const,
          entryId: "entry-001",
          name: "Bad Actor",
          matchConfidence: 1.0,
        },
      ],
      riskScore: 100,
    } satisfies SanctionsProviderResult),
  };
}

/** Stub provider that always rejects. */
function makeFailingProvider(name: string, message = "provider down"): SanctionsProvider {
  return {
    name,
    screen: vi.fn().mockRejectedValue(new Error(message)),
  };
}

// ---------------------------------------------------------------------------
// 1. ChainalysisProvider — direct unit tests
// ---------------------------------------------------------------------------

describe("ChainalysisProvider", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  describe("screen — clean address", () => {
    it("should return matched=false when identifications is empty", async () => {
      mockFetch.mockResolvedValue(chainalysisCleanResponse());

      const provider = new ChainalysisProvider("https://public.chainalysis.com/api/v1");
      const result = await provider.screen("0xclean", "eip155:1");

      expect(result.matched).toBe(false);
      expect(result.riskScore).toBe(0);
      expect(result.matchDetails).toHaveLength(0);
    });

    it("should build the correct URL from baseUrl and address", async () => {
      mockFetch.mockResolvedValue(chainalysisCleanResponse());

      const provider = new ChainalysisProvider("https://custom.api.example.com/v2");
      await provider.screen("0xabc", "eip155:1");

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockFetch.mock.calls[0]?.[0]).toBe(
        "https://custom.api.example.com/v2/address/0xabc",
      );
    });

    it("should send Accept: application/json header", async () => {
      mockFetch.mockResolvedValue(chainalysisCleanResponse());

      const provider = new ChainalysisProvider("https://public.chainalysis.com/api/v1");
      await provider.screen("0xtest", "eip155:1");

      const options = mockFetch.mock.calls[0]?.[1];
      expect(options?.headers?.["Accept"]).toBe("application/json");
    });

    it("should use GET method", async () => {
      mockFetch.mockResolvedValue(chainalysisCleanResponse());

      const provider = new ChainalysisProvider("https://public.chainalysis.com/api/v1");
      await provider.screen("0xtest", "eip155:1");

      expect(mockFetch.mock.calls[0]?.[1]?.method).toBe("GET");
    });
  });

  describe("screen — sanctioned address", () => {
    it("should return matched=true when identifications is non-empty", async () => {
      mockFetch.mockResolvedValue(chainalysisSanctionedResponse());

      const provider = new ChainalysisProvider("https://public.chainalysis.com/api/v1");
      const result = await provider.screen("0xbad", "eip155:1");

      expect(result.matched).toBe(true);
      expect(result.riskScore).toBe(100);
      expect(result.matchDetails).toHaveLength(1);
    });

    it("should map identification.name to matchDetails.name", async () => {
      mockFetch.mockResolvedValue(
        chainalysisSanctionedResponse({ name: "Lazarus Group" }),
      );

      const provider = new ChainalysisProvider("https://public.chainalysis.com/api/v1");
      const result = await provider.screen("0xbad", "eip155:1");

      expect(result.matchDetails[0]?.name).toBe("Lazarus Group");
    });

    it("should fall back to category when name is missing", async () => {
      const body = {
        identifications: [
          { category: "terrorism_financing", name: "", description: "", url: "" },
        ],
      };
      mockFetch.mockResolvedValue(
        new Response(JSON.stringify(body), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );

      const provider = new ChainalysisProvider("https://public.chainalysis.com/api/v1");
      const result = await provider.screen("0xbad", "eip155:1");

      // name is falsy (""), so provider uses category
      expect(result.matchDetails[0]?.name).toBe("terrorism_financing");
    });

    it("should map identification.url to matchDetails.entryId", async () => {
      mockFetch.mockResolvedValue(
        chainalysisSanctionedResponse({ url: "https://ofac.gov/entry/999" }),
      );

      const provider = new ChainalysisProvider("https://public.chainalysis.com/api/v1");
      const result = await provider.screen("0xbad", "eip155:1");

      expect(result.matchDetails[0]?.entryId).toBe("https://ofac.gov/entry/999");
    });

    it("should set matchConfidence to 1.0 for every match detail", async () => {
      const body = {
        identifications: [
          { category: "sanctions", name: "A", description: "", url: "url-a" },
          { category: "sanctions", name: "B", description: "", url: "url-b" },
        ],
      };
      mockFetch.mockResolvedValue(
        new Response(JSON.stringify(body), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );

      const provider = new ChainalysisProvider("https://public.chainalysis.com/api/v1");
      const result = await provider.screen("0xbad", "eip155:1");

      expect(result.matchDetails).toHaveLength(2);
      expect(result.matchDetails.every((d) => d.matchConfidence === 1.0)).toBe(true);
    });

    it("should tag every match detail with list OFAC_SDN", async () => {
      mockFetch.mockResolvedValue(chainalysisSanctionedResponse());

      const provider = new ChainalysisProvider("https://public.chainalysis.com/api/v1");
      const result = await provider.screen("0xbad", "eip155:1");

      expect(result.matchDetails[0]?.list).toBe("OFAC_SDN");
    });
  });

  describe("screen — API key", () => {
    it("should include X-API-Key header when apiKey is provided", async () => {
      mockFetch.mockResolvedValue(chainalysisCleanResponse());

      const provider = new ChainalysisProvider(
        "https://public.chainalysis.com/api/v1",
        "my-secret-key",
      );
      await provider.screen("0xtest", "eip155:1");

      const options = mockFetch.mock.calls[0]?.[1];
      expect(options?.headers?.["X-API-Key"]).toBe("my-secret-key");
    });

    it("should omit X-API-Key header when no apiKey is provided", async () => {
      mockFetch.mockResolvedValue(chainalysisCleanResponse());

      const provider = new ChainalysisProvider("https://public.chainalysis.com/api/v1");
      await provider.screen("0xtest", "eip155:1");

      const options = mockFetch.mock.calls[0]?.[1];
      expect(options?.headers?.["X-API-Key"]).toBeUndefined();
    });
  });

  describe("screen — HTTP errors", () => {
    it("should throw SanctionsScreeningError on HTTP 403", async () => {
      mockFetch.mockResolvedValue(
        new Response("Forbidden", { status: 403, statusText: "Forbidden" }),
      );

      const provider = new ChainalysisProvider("https://public.chainalysis.com/api/v1");

      await expect(provider.screen("0xtest", "eip155:1")).rejects.toThrow(
        SanctionsScreeningError,
      );
    });

    it("should include HTTP status in the error message", async () => {
      mockFetch.mockResolvedValue(
        new Response("Too Many Requests", { status: 429, statusText: "Too Many Requests" }),
      );

      const provider = new ChainalysisProvider("https://public.chainalysis.com/api/v1");

      await expect(provider.screen("0xtest", "eip155:1")).rejects.toThrow("429");
    });

    it("should throw SanctionsScreeningError on HTTP 500", async () => {
      mockFetch.mockResolvedValue(
        new Response("Internal Server Error", { status: 500, statusText: "Internal Server Error" }),
      );

      const provider = new ChainalysisProvider("https://public.chainalysis.com/api/v1");

      await expect(provider.screen("0xtest", "eip155:1")).rejects.toThrow(
        SanctionsScreeningError,
      );
    });

    it("should throw SanctionsScreeningError when response JSON is malformed", async () => {
      mockFetch.mockResolvedValue(
        new Response("not-json{{{", { status: 200, headers: { "Content-Type": "application/json" } }),
      );

      const provider = new ChainalysisProvider("https://public.chainalysis.com/api/v1");

      await expect(provider.screen("0xtest", "eip155:1")).rejects.toThrow(
        SanctionsScreeningError,
      );
    });

    it("should throw when fetch itself rejects (network failure)", async () => {
      mockFetch.mockRejectedValue(new Error("ECONNREFUSED"));

      const provider = new ChainalysisProvider("https://public.chainalysis.com/api/v1");

      await expect(provider.screen("0xtest", "eip155:1")).rejects.toThrow("ECONNREFUSED");
    });
  });
});

// ---------------------------------------------------------------------------
// 2. Provider health tracking
// ---------------------------------------------------------------------------

describe("SanctionsScreener — provider health tracking", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it("should report all providers as healthy initially", () => {
    const screener = new SanctionsScreener(makeConfig(), {
      providers: [makeCleanProvider("p1"), makeCleanProvider("p2")],
    });
    const health = screener.getProviderHealth();

    expect(health).toHaveLength(2);
    expect(health.every((h) => h.healthy)).toBe(true);
    expect(health.every((h) => h.consecutiveFailures === 0)).toBe(true);
    expect(health.every((h) => h.lastSuccess === null)).toBe(true);
    expect(health.every((h) => h.lastFailure === null)).toBe(true);
  });

  it("should mark provider unhealthy after maxConsecutiveFailures", async () => {
    const failing = makeFailingProvider("flaky");
    const screener = new SanctionsScreener(
      makeConfig({ failOpen: true }),
      { providers: [failing], maxConsecutiveFailures: 3 },
    );

    // Drive 3 failures — failOpen prevents throws
    await screener.screenAddress("0xa1", "eip155:1");
    await screener.screenAddress("0xa2", "eip155:1");
    await screener.screenAddress("0xa3", "eip155:1");

    const [status] = screener.getProviderHealth();
    expect(status?.consecutiveFailures).toBe(3);
    expect(status?.healthy).toBe(false);
  });

  it("should reset consecutiveFailures to 0 after a successful call", async () => {
    let callCount = 0;
    const flakyProvider: SanctionsProvider = {
      name: "flaky",
      screen: vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount < 3) throw new Error("transient");
        return Promise.resolve({ matched: false, matchDetails: [], riskScore: 0 });
      }),
    };

    // Use failOpen so early failures don't throw out of the screener
    const screener = new SanctionsScreener(
      makeConfig({ failOpen: true }),
      { providers: [flakyProvider], maxConsecutiveFailures: 5 },
    );

    // Two failures
    await screener.screenAddress("0xb1", "eip155:1");
    await screener.screenAddress("0xb2", "eip155:1");

    let [status] = screener.getProviderHealth();
    expect(status?.consecutiveFailures).toBe(2);

    // One success (callCount reaches 3)
    await screener.screenAddress("0xb3", "eip155:1");

    [status] = screener.getProviderHealth();
    expect(status?.consecutiveFailures).toBe(0);
    expect(status?.lastSuccess).not.toBeNull();
  });

  it("should skip a disabled provider and use the next healthy one", async () => {
    const failing = makeFailingProvider("first");
    const clean = makeCleanProvider("second");

    const screener = new SanctionsScreener(
      makeConfig({ failOpen: false }),
      { providers: [failing, clean], maxConsecutiveFailures: 1 },
    );

    // First call triggers failure on "first", falls through to "second"
    const result = await screener.screenAddress("0xtest", "eip155:1");

    expect(result.matched).toBe(false);
    expect(result.provider).toBe("second");

    // "first" is now disabled (1 consecutive failure = maxConsecutiveFailures)
    const health = screener.getProviderHealth();
    const firstHealth = health.find((h) => h.name === "first");
    expect(firstHealth?.healthy).toBe(false);
  });

  it("should record lastFailure timestamp after a provider fails", async () => {
    const screener = new SanctionsScreener(
      makeConfig({ failOpen: true }),
      { providers: [makeFailingProvider("p1")], maxConsecutiveFailures: 5 },
    );

    await screener.screenAddress("0xtest", "eip155:1");

    const [status] = screener.getProviderHealth();
    expect(status?.lastFailure).not.toBeNull();
    expect(() => new Date(status!.lastFailure!)).not.toThrow();
  });

  it("should record lastSuccess timestamp after a provider succeeds", async () => {
    const screener = new SanctionsScreener(
      makeConfig(),
      { providers: [makeCleanProvider("p1")] },
    );

    await screener.screenAddress("0xtest", "eip155:1");

    const [status] = screener.getProviderHealth();
    expect(status?.lastSuccess).not.toBeNull();
    expect(() => new Date(status!.lastSuccess!)).not.toThrow();
  });

  it("should preserve lastFailure after recovery", async () => {
    let calls = 0;
    const provider: SanctionsProvider = {
      name: "recovering",
      screen: vi.fn().mockImplementation(() => {
        calls++;
        if (calls === 1) throw new Error("down once");
        return Promise.resolve({ matched: false, matchDetails: [], riskScore: 0 });
      }),
    };

    const screener = new SanctionsScreener(
      makeConfig({ failOpen: true }),
      { providers: [provider], maxConsecutiveFailures: 5 },
    );

    await screener.screenAddress("0xa", "eip155:1"); // fails
    await screener.screenAddress("0xb", "eip155:1"); // succeeds (new address, no cache)

    const [status] = screener.getProviderHealth();
    expect(status?.consecutiveFailures).toBe(0);
    expect(status?.lastFailure).not.toBeNull(); // preserved from failure
    expect(status?.lastSuccess).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 3. Priority mode vs aggregate mode
// ---------------------------------------------------------------------------

describe("SanctionsScreener — priority mode", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it("should use the first healthy provider and not call subsequent ones", async () => {
    const first = makeCleanProvider("first");
    const second = makeCleanProvider("second");

    const screener = new SanctionsScreener(makeConfig(), {
      providers: [first, second],
    });

    await screener.screenAddress("0xtest", "eip155:1");

    expect(first.screen).toHaveBeenCalledTimes(1);
    expect(second.screen).toHaveBeenCalledTimes(0);
  });

  it("should report the winning provider name in result.provider", async () => {
    const screener = new SanctionsScreener(makeConfig(), {
      providers: [makeCleanProvider("alpha")],
    });

    const result = await screener.screenAddress("0xtest", "eip155:1");

    expect(result.provider).toBe("alpha");
  });

  it("should fall through to the second provider when the first fails", async () => {
    const screener = new SanctionsScreener(makeConfig(), {
      providers: [makeFailingProvider("bad"), makeCleanProvider("good")],
      maxConsecutiveFailures: 5,
    });

    const result = await screener.screenAddress("0xtest", "eip155:1");

    expect(result.provider).toBe("good");
  });

  it("should propagate a match from the first provider without calling others", async () => {
    const first = makeSanctionedProvider("first");
    const second = makeCleanProvider("second");

    const screener = new SanctionsScreener(makeConfig(), {
      providers: [first, second],
    });

    const result = await screener.screenAddress("0xbad", "eip155:1");

    expect(result.matched).toBe(true);
    expect(second.screen).toHaveBeenCalledTimes(0);
  });
});

describe("SanctionsScreener — aggregate mode", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it("should call all healthy providers in aggregate mode", async () => {
    const p1 = makeCleanProvider("p1");
    const p2 = makeCleanProvider("p2");
    const p3 = makeCleanProvider("p3");

    const screener = new SanctionsScreener(makeConfig(), {
      providers: [p1, p2, p3],
      aggregate: true,
    });

    await screener.screenAddress("0xtest", "eip155:1");

    expect(p1.screen).toHaveBeenCalledTimes(1);
    expect(p2.screen).toHaveBeenCalledTimes(1);
    expect(p3.screen).toHaveBeenCalledTimes(1);
  });

  it("should return matched=true when any provider matches in aggregate mode", async () => {
    const screener = new SanctionsScreener(makeConfig(), {
      providers: [makeCleanProvider("p1"), makeSanctionedProvider("p2"), makeCleanProvider("p3")],
      aggregate: true,
    });

    const result = await screener.screenAddress("0xtest", "eip155:1");

    expect(result.matched).toBe(true);
    expect(result.riskScore).toBe(100);
  });

  it("should return matched=false when no provider matches in aggregate mode", async () => {
    const screener = new SanctionsScreener(makeConfig(), {
      providers: [makeCleanProvider("p1"), makeCleanProvider("p2")],
      aggregate: true,
    });

    const result = await screener.screenAddress("0xtest", "eip155:1");

    expect(result.matched).toBe(false);
    expect(result.riskScore).toBe(0);
  });

  it("should set provider to multi_provider in aggregate mode", async () => {
    const screener = new SanctionsScreener(makeConfig(), {
      providers: [makeCleanProvider("p1"), makeCleanProvider("p2")],
      aggregate: true,
    });

    const result = await screener.screenAddress("0xtest", "eip155:1");

    expect(result.provider).toBe("multi_provider");
  });

  it("should merge matchDetails from all matching providers in aggregate mode", async () => {
    const screener = new SanctionsScreener(makeConfig(), {
      providers: [makeSanctionedProvider("p1"), makeSanctionedProvider("p2")],
      aggregate: true,
    });

    const result = await screener.screenAddress("0xbad", "eip155:1");

    // Each provider adds 1 matchDetail
    expect(result.matchDetails).toHaveLength(2);
  });

  it("should use the max riskScore across providers in aggregate mode", async () => {
    const lowRisk: SanctionsProvider = {
      name: "low",
      screen: vi.fn().mockResolvedValue({
        matched: true,
        matchDetails: [{ list: "OFAC_SDN" as const, entryId: "x", name: "X", matchConfidence: 0.5 }],
        riskScore: 50,
      } satisfies SanctionsProviderResult),
    };
    const highRisk = makeSanctionedProvider("high"); // riskScore: 100

    const screener = new SanctionsScreener(makeConfig(), {
      providers: [lowRisk, highRisk],
      aggregate: true,
    });

    const result = await screener.screenAddress("0xbad", "eip155:1");

    expect(result.riskScore).toBe(100);
  });

  it("should succeed in aggregate mode when only one of two providers fails", async () => {
    const screener = new SanctionsScreener(makeConfig(), {
      providers: [makeFailingProvider("bad"), makeCleanProvider("good")],
      aggregate: true,
      maxConsecutiveFailures: 5,
    });

    const result = await screener.screenAddress("0xtest", "eip155:1");

    expect(result.matched).toBe(false);
    expect(result.provider).toBe("multi_provider");
  });

  it("should throw when all providers fail in aggregate mode with failOpen=false", async () => {
    const screener = new SanctionsScreener(
      makeConfig({ failOpen: false }),
      {
        providers: [makeFailingProvider("p1"), makeFailingProvider("p2")],
        aggregate: true,
        maxConsecutiveFailures: 5,
      },
    );

    await expect(
      screener.screenAddress("0xtest", "eip155:1"),
    ).rejects.toThrow(SanctionsScreeningError);
  });
});

// ---------------------------------------------------------------------------
// 4. Offline OFAC SDN fallback when all providers fail
// ---------------------------------------------------------------------------

describe("SanctionsScreener — offline OFAC SDN fallback", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it("should detect an OFAC ETH address via offline list when failOpen=false and provider fails", async () => {
    const knownAddress = Array.from(OFAC_SDN_ETH_ADDRESSES)[0]!;

    const screener = new SanctionsScreener(
      makeConfig({ failOpen: false }),
      { providers: [makeFailingProvider("down")] },
    );

    // Should NOT throw — offline list provides a positive match
    const result = await screener.screenAddress(knownAddress, "eip155:1");

    expect(result.matched).toBe(true);
    expect(result.provider).toBe("ofac_sdn_offline");
    expect(result.riskScore).toBe(100);
    expect(result.listsChecked).toContain("OFAC_SDN");
  });

  it("should throw SanctionsScreeningError for unknown address when failOpen=false and all providers fail", async () => {
    const screener = new SanctionsScreener(
      makeConfig({ failOpen: false }),
      { providers: [makeFailingProvider("down")] },
    );

    await expect(
      screener.screenAddress("0xunknown_address_not_in_list", "eip155:1"),
    ).rejects.toThrow(SanctionsScreeningError);
  });

  it("should return clean offline result for unknown address when failOpen=true", async () => {
    const screener = new SanctionsScreener(
      makeConfig({ failOpen: true }),
      { providers: [makeFailingProvider("down")] },
    );

    const result = await screener.screenAddress("0xcompletely_unknown", "eip155:1");

    expect(result.matched).toBe(false);
    expect(result.provider).toBe("ofac_sdn_offline");
  });

  it("should detect an OFAC ETH address when failOpen=true and all providers fail", async () => {
    const knownAddress = "0x8589427373d6d84e98730d7795d8f6f8731fda16";

    const screener = new SanctionsScreener(
      makeConfig({ failOpen: true }),
      { providers: [makeFailingProvider("down")] },
    );

    const result = await screener.screenAddress(knownAddress, "eip155:1");

    expect(result.matched).toBe(true);
    expect(result.provider).toBe("ofac_sdn_offline");
  });

  it("should match a BTC address via offline list with case-sensitive Base58 lookup", async () => {
    // BTC addresses use case-sensitive matching (Base58) while EVM addresses are lowercased.
    const knownBtcAddress = Array.from(OFAC_SDN_BTC_ADDRESSES)[0]!;

    const screener = new SanctionsScreener(
      makeConfig({ failOpen: true }),
      { providers: [makeFailingProvider("down")] },
    );

    // Falls back offline — BTC addresses use case-sensitive matching and are stored in original casing
    const result = await screener.screenAddress(knownBtcAddress, "bip122:mainnet");

    expect(result.provider).toBe("ofac_sdn_offline");
    expect(result.matched).toBe(true);
  });

  it("should match OFAC address case-insensitively in offline mode", async () => {
    const upperCased = "0x8589427373D6D84E98730D7795D8F6F8731FDA16";

    const screener = new SanctionsScreener(
      makeConfig({ failOpen: true }),
      { providers: [makeFailingProvider("down")] },
    );

    const result = await screener.screenAddress(upperCased, "eip155:1");

    expect(result.matched).toBe(true);
  });

  it("should set entryId with offline- prefix for offline matches", async () => {
    const knownAddress = "0x722122df12d4e14e13ac3b6895a86e84145b6967";

    const screener = new SanctionsScreener(
      makeConfig({ failOpen: true }),
      { providers: [makeFailingProvider("down")] },
    );

    const result = await screener.screenAddress(knownAddress, "eip155:1");

    expect(result.matchDetails[0]?.entryId).toMatch(/^offline-/);
  });

  it("should fall back to offline mode when all providers are disabled by health tracker", async () => {
    // maxConsecutiveFailures=1 means a single failure disables the provider
    const screener = new SanctionsScreener(
      makeConfig({ failOpen: true }),
      { providers: [makeFailingProvider("p1"), makeFailingProvider("p2")], maxConsecutiveFailures: 1 },
    );

    // First call: both providers fail, health tracker accumulates one failure each
    await screener.screenAddress("0xa1", "eip155:1");
    // Both providers are now disabled (1 failure >= maxConsecutiveFailures=1)

    // Second call: both providers skipped → falls back offline directly
    const result = await screener.screenAddress("0xa2", "eip155:1");
    expect(result.provider).toBe("ofac_sdn_offline");
  });
});

// ---------------------------------------------------------------------------
// 5. Cache behavior
// ---------------------------------------------------------------------------

describe("SanctionsScreener — cache", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it("should return a cached result on the second call for the same address+chain", async () => {
    const provider = makeCleanProvider("p1");
    const screener = new SanctionsScreener(makeConfig(), { providers: [provider] });

    await screener.screenAddress("0xcached", "eip155:1");
    await screener.screenAddress("0xcached", "eip155:1");

    expect(provider.screen).toHaveBeenCalledTimes(1);
  });

  it("should NOT share cache across different chains for the same address", async () => {
    const provider = makeCleanProvider("p1");
    const screener = new SanctionsScreener(makeConfig(), { providers: [provider] });

    await screener.screenAddress("0xaddr", "eip155:1");
    await screener.screenAddress("0xaddr", "eip155:137");

    expect(provider.screen).toHaveBeenCalledTimes(2);
  });

  it("should NOT share cache across different addresses on the same chain", async () => {
    const provider = makeCleanProvider("p1");
    const screener = new SanctionsScreener(makeConfig(), { providers: [provider] });

    await screener.screenAddress("0xaddr1", "eip155:1");
    await screener.screenAddress("0xaddr2", "eip155:1");

    expect(provider.screen).toHaveBeenCalledTimes(2);
  });

  it("should normalize address case in cache key (0xADDR and 0xaddr are the same)", async () => {
    const provider = makeCleanProvider("p1");
    const screener = new SanctionsScreener(makeConfig(), { providers: [provider] });

    await screener.screenAddress("0xABCDEF", "eip155:1");
    await screener.screenAddress("0xabcdef", "eip155:1");

    expect(provider.screen).toHaveBeenCalledTimes(1);
  });

  it("should query provider again after invalidateCache", async () => {
    const provider = makeCleanProvider("p1");
    const screener = new SanctionsScreener(makeConfig(), { providers: [provider] });

    await screener.screenAddress("0xinvalidate", "eip155:1");
    screener.invalidateCache("0xinvalidate", "eip155:1");
    await screener.screenAddress("0xinvalidate", "eip155:1");

    expect(provider.screen).toHaveBeenCalledTimes(2);
  });

  it("should query provider again for all entries after clearCache", async () => {
    const provider = makeCleanProvider("p1");
    const screener = new SanctionsScreener(makeConfig(), { providers: [provider] });

    await screener.screenAddress("0xclear1", "eip155:1");
    await screener.screenAddress("0xclear2", "eip155:1");

    screener.clearCache();

    await screener.screenAddress("0xclear1", "eip155:1");
    await screener.screenAddress("0xclear2", "eip155:1");

    expect(provider.screen).toHaveBeenCalledTimes(4);
  });

  it("should expire cache entries after TTL and re-query the provider", async () => {
    vi.useFakeTimers();

    const provider = makeCleanProvider("p1");
    const screener = new SanctionsScreener(
      makeConfig({ sanctionsCacheTtlMs: 1_000 }), // 1 second TTL
      { providers: [provider] },
    );

    await screener.screenAddress("0xttl", "eip155:1");
    expect(provider.screen).toHaveBeenCalledTimes(1);

    // Advance past TTL
    vi.advanceTimersByTime(1_001);

    await screener.screenAddress("0xttl", "eip155:1");
    expect(provider.screen).toHaveBeenCalledTimes(2);

    vi.useRealTimers();
  });

  it("should cache failed-open (offline) results and not re-query provider", async () => {
    const failing = makeFailingProvider("down");
    const screener = new SanctionsScreener(
      makeConfig({ failOpen: true }),
      { providers: [failing], maxConsecutiveFailures: 10 },
    );

    await screener.screenAddress("0xoffline", "eip155:1");
    await screener.screenAddress("0xoffline", "eip155:1");

    // Provider was called only once; result was cached even though it came from offline mode
    expect(failing.screen).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// 6. Batch screening
// ---------------------------------------------------------------------------

describe("SanctionsScreener — screenBatch", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it("should return results for every address in the batch", async () => {
    const provider = makeCleanProvider("p1");
    const screener = new SanctionsScreener(makeConfig(), { providers: [provider] });

    const results = await screener.screenBatch([
      { address: "0xa", chain: "eip155:1" },
      { address: "0xb", chain: "eip155:1" },
      { address: "0xc", chain: "eip155:1" },
    ]);

    expect(results).toHaveLength(3);
  });

  it("should return an empty array for an empty input", async () => {
    const provider = makeCleanProvider("p1");
    const screener = new SanctionsScreener(makeConfig(), { providers: [provider] });

    const results = await screener.screenBatch([]);

    expect(results).toHaveLength(0);
    expect(provider.screen).not.toHaveBeenCalled();
  });

  it("should call the provider once per unique address+chain pair", async () => {
    const provider = makeCleanProvider("p1");
    const screener = new SanctionsScreener(makeConfig(), { providers: [provider] });

    await screener.screenBatch([
      { address: "0xa", chain: "eip155:1" },
      { address: "0xb", chain: "eip155:1" },
      { address: "0xc", chain: "eip155:137" },
    ]);

    expect(provider.screen).toHaveBeenCalledTimes(3);
  });

  it("should use cached results within a batch for duplicate addresses", async () => {
    const provider = makeCleanProvider("p1");
    const screener = new SanctionsScreener(makeConfig(), { providers: [provider] });

    // Pre-populate cache
    await screener.screenAddress("0xdup", "eip155:1");

    const results = await screener.screenBatch([
      { address: "0xdup", chain: "eip155:1" },
      { address: "0xfresh", chain: "eip155:1" },
    ]);

    // "0xdup" hits cache, only "0xfresh" calls the provider
    expect(provider.screen).toHaveBeenCalledTimes(2); // 1 pre-populate + 1 fresh
    expect(results).toHaveLength(2);
  });

  it("should correctly identify sanctioned addresses in a mixed batch", async () => {
    const p1 = makeCleanProvider("clean");
    const mixed: SanctionsProvider = {
      name: "mixed",
      screen: vi.fn()
        .mockResolvedValueOnce({ matched: false, matchDetails: [], riskScore: 0 })
        .mockResolvedValueOnce({
          matched: true,
          matchDetails: [{ list: "OFAC_SDN" as const, entryId: "e1", name: "Bad", matchConfidence: 1 }],
          riskScore: 100,
        })
        .mockResolvedValueOnce({ matched: false, matchDetails: [], riskScore: 0 }),
    };

    const screener = new SanctionsScreener(makeConfig(), { providers: [mixed] });

    const results = await screener.screenBatch([
      { address: "0xgood1", chain: "eip155:1" },
      { address: "0xbad1", chain: "eip155:1" },
      { address: "0xgood2", chain: "eip155:1" },
    ]);

    expect(results[0]?.matched).toBe(false);
    expect(results[1]?.matched).toBe(true);
    expect(results[2]?.matched).toBe(false);
  });

  it("should throw from screenBatch when a provider fails and failOpen=false", async () => {
    const screener = new SanctionsScreener(
      makeConfig({ failOpen: false }),
      { providers: [makeFailingProvider("down")] },
    );

    await expect(
      screener.screenBatch([{ address: "0xtest", chain: "eip155:1" }]),
    ).rejects.toThrow(SanctionsScreeningError);
  });

  it("should run batch entries in parallel (all providers called before any await resolves)", async () => {
    const callOrder: string[] = [];
    const provider: SanctionsProvider = {
      name: "ordered",
      screen: vi.fn().mockImplementation(async (address: string) => {
        callOrder.push(`start:${address}`);
        await Promise.resolve(); // yield
        callOrder.push(`end:${address}`);
        return { matched: false, matchDetails: [], riskScore: 0 };
      }),
    };

    const screener = new SanctionsScreener(makeConfig(), { providers: [provider] });

    await screener.screenBatch([
      { address: "0xa", chain: "eip155:1" },
      { address: "0xb", chain: "eip155:1" },
    ]);

    // With Promise.all the two starts should appear before any ends
    const startA = callOrder.indexOf("start:0xa");
    const startB = callOrder.indexOf("start:0xb");
    const endA = callOrder.indexOf("end:0xa");
    const endB = callOrder.indexOf("end:0xb");

    expect(startA).toBeLessThan(endA);
    expect(startB).toBeLessThan(endB);
    // Both tasks started before either finished
    expect(startA).toBeLessThan(endB);
    expect(startB).toBeLessThan(endA);
  });
});

// ---------------------------------------------------------------------------
// 7. addProvider / removeProvider
// ---------------------------------------------------------------------------

describe("SanctionsScreener — addProvider / removeProvider", () => {
  it("should add a provider and use it for subsequent screens", async () => {
    const screener = new SanctionsScreener(makeConfig(), { providers: [] });
    const provider = makeCleanProvider("dynamic");

    screener.addProvider(provider);

    // With no providers initially, adding one allows the screen to succeed
    const result = await screener.screenAddress("0xtest", "eip155:1");
    expect(result.provider).toBe("dynamic");
  });

  it("should return false from removeProvider when the provider does not exist", () => {
    const screener = new SanctionsScreener(makeConfig(), { providers: [makeCleanProvider("p1")] });

    expect(screener.removeProvider("nonexistent")).toBe(false);
  });

  it("should return true and stop using a removed provider", async () => {
    const removed = makeCleanProvider("remove-me");
    const remaining = makeCleanProvider("keep");

    const screener = new SanctionsScreener(makeConfig(), {
      providers: [removed, remaining],
    });

    expect(screener.removeProvider("remove-me")).toBe(true);

    const result = await screener.screenAddress("0xtest", "eip155:1");

    expect(removed.screen).not.toHaveBeenCalled();
    expect(result.provider).toBe("keep");
  });
});

// ---------------------------------------------------------------------------
// 8. TRMLabsProvider — direct unit tests
// ---------------------------------------------------------------------------

describe("TRMLabsProvider", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it("should POST to the correct endpoint", async () => {
    mockFetch.mockResolvedValue(trmCleanResponse());

    const provider = new TRMLabsProvider("api-key-123", "https://api.trmlabs.com/public/v2");
    await provider.screen("0xtest", "eip155:1");

    expect(mockFetch.mock.calls[0]?.[0]).toBe(
      "https://api.trmlabs.com/public/v2/screening/addresses",
    );
    expect(mockFetch.mock.calls[0]?.[1]?.method).toBe("POST");
  });

  it("should send Authorization Bearer header", async () => {
    mockFetch.mockResolvedValue(trmCleanResponse());

    const provider = new TRMLabsProvider("secret-key");
    await provider.screen("0xtest", "eip155:1");

    const options = mockFetch.mock.calls[0]?.[1];
    expect(options?.headers?.["Authorization"]).toBe("Bearer secret-key");
  });

  it("should include address and chain in the request body", async () => {
    mockFetch.mockResolvedValue(trmCleanResponse());

    const provider = new TRMLabsProvider("key");
    await provider.screen("0xaddr", "eip155:137");

    const body = JSON.parse(mockFetch.mock.calls[0]?.[1]?.body as string);
    expect(body).toEqual([{ address: "0xaddr", chain: "eip155:137" }]);
  });

  it("should return matched=false when addressRiskIndicators is empty", async () => {
    mockFetch.mockResolvedValue(trmCleanResponse());

    const provider = new TRMLabsProvider("key");
    const result = await provider.screen("0xclean", "eip155:1");

    expect(result.matched).toBe(false);
    expect(result.riskScore).toBe(0);
  });

  it("should return matched=true when a SANCTIONS riskType indicator is present", async () => {
    mockFetch.mockResolvedValue(trmSanctionedResponse());

    const provider = new TRMLabsProvider("key");
    const result = await provider.screen("0xbad", "eip155:1");

    expect(result.matched).toBe(true);
    expect(result.riskScore).toBe(100);
    expect(result.matchDetails[0]?.entryId).toBe("cat-001");
  });

  it("should match indicators whose category includes 'sanction' (case-insensitive)", async () => {
    const body = [
      {
        addressRiskIndicators: [
          { category: "Sanctions Evasion", categoryId: "c99", riskType: "OTHER" },
        ],
      },
    ];
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const provider = new TRMLabsProvider("key");
    const result = await provider.screen("0xbad", "eip155:1");

    expect(result.matched).toBe(true);
  });

  it("should throw SanctionsScreeningError on HTTP 401", async () => {
    mockFetch.mockResolvedValue(
      new Response("Unauthorized", { status: 401, statusText: "Unauthorized" }),
    );

    const provider = new TRMLabsProvider("bad-key");

    await expect(provider.screen("0xtest", "eip155:1")).rejects.toThrow(
      SanctionsScreeningError,
    );
  });

  it("should throw SanctionsScreeningError when response JSON is malformed", async () => {
    mockFetch.mockResolvedValue(
      new Response("{{bad", { status: 200, headers: { "Content-Type": "application/json" } }),
    );

    const provider = new TRMLabsProvider("key");

    await expect(provider.screen("0xtest", "eip155:1")).rejects.toThrow(
      SanctionsScreeningError,
    );
  });

  it("should return matched=false when response array is empty", async () => {
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify([]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const provider = new TRMLabsProvider("key");
    const result = await provider.screen("0xtest", "eip155:1");

    expect(result.matched).toBe(false);
  });

  it("should use the default baseUrl when none is provided", async () => {
    mockFetch.mockResolvedValue(trmCleanResponse());

    const provider = new TRMLabsProvider("key");
    await provider.screen("0xtest", "eip155:1");

    expect(mockFetch.mock.calls[0]?.[0]).toContain("https://api.trmlabs.com/public/v2");
  });
});
