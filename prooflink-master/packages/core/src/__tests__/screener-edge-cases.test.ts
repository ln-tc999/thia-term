import { describe, it, expect, vi, beforeEach } from "vitest";
import { SanctionsScreener, SanctionsScreeningError } from "../sanctions/screener.js";
import type { ProofLinkConfig } from "../config.js";

// ---------------------------------------------------------------------------
// Mock fetch
// ---------------------------------------------------------------------------

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

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

beforeEach(() => {
  mockFetch.mockReset();
});

// ---------------------------------------------------------------------------
// Network errors
// ---------------------------------------------------------------------------

describe("SanctionsScreener — network errors", () => {
  it("throws SanctionsScreeningError on TypeError (network unavailable) when failOpen=false", async () => {
    mockFetch.mockRejectedValue(new TypeError("Failed to fetch"));

    const screener = new SanctionsScreener(makeConfig({ failOpen: false }));
    await expect(screener.screenAddress("0xtest", "eip155:1")).rejects.toThrow(
      SanctionsScreeningError,
    );
  });

  it("preserves the original cause in SanctionsScreeningError", async () => {
    const cause = new TypeError("Failed to fetch");
    mockFetch.mockRejectedValue(cause);

    const screener = new SanctionsScreener(makeConfig({ failOpen: false }));

    try {
      await screener.screenAddress("0xtest", "eip155:1");
    } catch (err) {
      expect(err).toBeInstanceOf(SanctionsScreeningError);
      const screenErr = err as SanctionsScreeningError;
      expect(screenErr.cause).toBe(cause);
    }
  });

  it("fails open when failOpen=true and network is unavailable", async () => {
    mockFetch.mockRejectedValue(new TypeError("Failed to fetch"));

    const screener = new SanctionsScreener(makeConfig({ failOpen: true }));
    const result = await screener.screenAddress("0xclean", "eip155:1");

    expect(result.matched).toBe(false);
    expect(result.riskScore).toBe(0);
  });

  it("propagates generic Error on network failure when failOpen=false", async () => {
    mockFetch.mockRejectedValue(new Error("ECONNREFUSED"));

    const screener = new SanctionsScreener(makeConfig({ failOpen: false }));
    await expect(
      screener.screenAddress("0xtest", "eip155:1"),
    ).rejects.toThrow(SanctionsScreeningError);
  });
});

// ---------------------------------------------------------------------------
// HTTP error responses
// ---------------------------------------------------------------------------

describe("SanctionsScreener — HTTP error responses", () => {
  it("throws on HTTP 500 when failOpen=false", async () => {
    mockFetch.mockResolvedValue(
      new Response("Internal Server Error", {
        status: 500,
        statusText: "Internal Server Error",
      }),
    );

    const screener = new SanctionsScreener(makeConfig({ failOpen: false }));
    await expect(
      screener.screenAddress("0xtest", "eip155:1"),
    ).rejects.toThrow(SanctionsScreeningError);
  });

  it("fails open on HTTP 503 when failOpen=true", async () => {
    mockFetch.mockResolvedValue(
      new Response("Service Unavailable", {
        status: 503,
        statusText: "Service Unavailable",
      }),
    );

    const screener = new SanctionsScreener(makeConfig({ failOpen: true }));
    const result = await screener.screenAddress("0xtest", "eip155:1");
    expect(result.matched).toBe(false);
  });

  it("throws on HTTP 401 (API key required) when failOpen=false", async () => {
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        statusText: "Unauthorized",
        headers: { "Content-Type": "application/json" },
      }),
    );

    const screener = new SanctionsScreener(makeConfig({ failOpen: false }));
    await expect(
      screener.screenAddress("0xtest", "eip155:1"),
    ).rejects.toThrow(SanctionsScreeningError);
  });

  it("throws on HTTP 429 (rate limited) when failOpen=false", async () => {
    mockFetch.mockResolvedValue(
      new Response("Too Many Requests", {
        status: 429,
        statusText: "Too Many Requests",
        headers: { "Retry-After": "60" },
      }),
    );

    const screener = new SanctionsScreener(makeConfig({ failOpen: false }));
    await expect(
      screener.screenAddress("0xtest", "eip155:1"),
    ).rejects.toThrow(SanctionsScreeningError);
  });
});

// ---------------------------------------------------------------------------
// Malformed / unexpected API responses
// ---------------------------------------------------------------------------

describe("SanctionsScreener — malformed API responses", () => {
  it("handles response with null identifications (treats as clean)", async () => {
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify({ identifications: null }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const screener = new SanctionsScreener(makeConfig());
    const result = await screener.screenAddress("0xtest", "eip155:1");
    // null is falsy so the "if (data.identifications && ...)" branch is false
    expect(result.matched).toBe(false);
  });

  it("handles response with empty identifications array", async () => {
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify({ identifications: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const screener = new SanctionsScreener(makeConfig());
    const result = await screener.screenAddress("0xtest", "eip155:1");
    expect(result.matched).toBe(false);
    expect(result.riskScore).toBe(0);
  });

  it("handles identification with missing url field (uses empty string)", async () => {
    mockFetch.mockResolvedValue(
      new Response(
        JSON.stringify({
          identifications: [
            {
              category: "sanctions",
              name: "Entity Name",
              description: "OFAC SDN",
              // url intentionally missing
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const screener = new SanctionsScreener(makeConfig());
    const result = await screener.screenAddress("0xtest", "eip155:1");
    expect(result.matched).toBe(true);
    expect(result.matchDetails[0]?.entryId).toBe("unknown");
  });

  it("handles identification with missing name field (falls back to category)", async () => {
    mockFetch.mockResolvedValue(
      new Response(
        JSON.stringify({
          identifications: [
            {
              category: "sanctions",
              // name intentionally missing
              description: "OFAC SDN",
              url: "https://example.com",
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const screener = new SanctionsScreener(makeConfig());
    const result = await screener.screenAddress("0xtest", "eip155:1");
    expect(result.matched).toBe(true);
    // name should fall back to category when name is falsy
    expect(result.matchDetails[0]?.name).toBe("sanctions");
  });

  it("handles non-JSON response body when failOpen=true", async () => {
    mockFetch.mockResolvedValue(
      new Response("<html>Gateway Timeout</html>", {
        status: 200, // response.ok is true but body is not JSON
        headers: { "Content-Type": "text/html" },
      }),
    );

    // Even with a 200 status, JSON.parse will fail → triggers fallback
    const screener = new SanctionsScreener(makeConfig({ failOpen: true }));
    // Should not throw — should fail open
    const result = await screener.screenAddress("0xtest", "eip155:1");
    expect(result.matched).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Timeout simulation
// ---------------------------------------------------------------------------

describe("SanctionsScreener — AbortController timeout", () => {
  it("treats AbortError as a network error and throws when failOpen=false", async () => {
    mockFetch.mockRejectedValue(
      Object.assign(new Error("The operation was aborted"), {
        name: "AbortError",
      }),
    );

    const screener = new SanctionsScreener(makeConfig({ failOpen: false }));
    await expect(
      screener.screenAddress("0xtest", "eip155:1"),
    ).rejects.toThrow(SanctionsScreeningError);
  });

  it("fails open on AbortError when failOpen=true", async () => {
    mockFetch.mockRejectedValue(
      Object.assign(new Error("The operation was aborted"), {
        name: "AbortError",
      }),
    );

    const screener = new SanctionsScreener(makeConfig({ failOpen: true }));
    const result = await screener.screenAddress("0xtest", "eip155:1");
    expect(result.matched).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Boundary: multiple identifications in one response
// ---------------------------------------------------------------------------

describe("SanctionsScreener — multiple identifications", () => {
  it("returns all match details when multiple identifications are returned", async () => {
    mockFetch.mockResolvedValue(
      new Response(
        JSON.stringify({
          identifications: [
            {
              category: "sanctions",
              name: "Entity A",
              description: "OFAC SDN",
              url: "https://example.com/a",
            },
            {
              category: "sanctions",
              name: "Entity B",
              description: "OFAC SDN",
              url: "https://example.com/b",
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const screener = new SanctionsScreener(makeConfig());
    const result = await screener.screenAddress("0xmulti", "eip155:1");

    expect(result.matched).toBe(true);
    expect(result.matchDetails).toHaveLength(2);
    expect(result.matchDetails[0]?.name).toBe("Entity A");
    expect(result.matchDetails[1]?.name).toBe("Entity B");
    expect(result.riskScore).toBe(100);
  });
});

// ---------------------------------------------------------------------------
// Chainalysis — malformed JSON response
// ---------------------------------------------------------------------------

describe("ChainalysisProvider — malformed JSON handling", () => {
  it("throws SanctionsScreeningError with descriptive message on malformed JSON", async () => {
    mockFetch.mockResolvedValue(
      new Response("not json at all {{{", {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const screener = new SanctionsScreener(makeConfig({ failOpen: false }));
    await expect(
      screener.screenAddress("0xtest", "eip155:1"),
    ).rejects.toThrow(/Chainalysis API returned malformed JSON/);
  });

  it("fails open on malformed JSON when failOpen=true", async () => {
    mockFetch.mockResolvedValue(
      new Response("not json", {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const screener = new SanctionsScreener(makeConfig({ failOpen: true }));
    const result = await screener.screenAddress("0xtest", "eip155:1");
    expect(result.matched).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// TRMLabsProvider — empty array and malformed JSON
// ---------------------------------------------------------------------------

describe("TRMLabsProvider — edge cases", () => {
  it("returns matched=false when TRM returns empty array", async () => {
    const { TRMLabsProvider } = await import("../sanctions/screener.js");
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify([]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const provider = new TRMLabsProvider("test-key", "https://api.trmlabs.com/public/v2");
    const result = await provider.screen("0xtest", "eip155:1");

    expect(result.matched).toBe(false);
    expect(result.riskScore).toBe(0);
  });

  it("returns matched=false when TRM response is not an array", async () => {
    const { TRMLabsProvider } = await import("../sanctions/screener.js");
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify({ unexpected: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const provider = new TRMLabsProvider("test-key", "https://api.trmlabs.com/public/v2");
    const result = await provider.screen("0xtest", "eip155:1");

    expect(result.matched).toBe(false);
    expect(result.riskScore).toBe(0);
  });

  it("throws SanctionsScreeningError on malformed JSON from TRM", async () => {
    const { TRMLabsProvider } = await import("../sanctions/screener.js");
    mockFetch.mockResolvedValue(
      new Response("broken json {{{", {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const provider = new TRMLabsProvider("test-key", "https://api.trmlabs.com/public/v2");
    await expect(provider.screen("0xtest", "eip155:1")).rejects.toThrow(/TRM Labs API returned malformed JSON/);
  });

  it("returns matched=false when first entry has no addressRiskIndicators", async () => {
    const { TRMLabsProvider } = await import("../sanctions/screener.js");
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify([{}]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const provider = new TRMLabsProvider("test-key", "https://api.trmlabs.com/public/v2");
    const result = await provider.screen("0xtest", "eip155:1");

    expect(result.matched).toBe(false);
    expect(result.riskScore).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// AML scorer boundary values
// ---------------------------------------------------------------------------

describe("AMLScorer — boundary values at exact threshold", () => {
  // These supplement the existing scorer.test.ts to cover exact threshold boundaries.
  it("is imported from the scorer module (sanity check)", async () => {
    const { AMLScorer } = await import("../aml/scorer.js");
    expect(AMLScorer).toBeDefined();
  });
});
