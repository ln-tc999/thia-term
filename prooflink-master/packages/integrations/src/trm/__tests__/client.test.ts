import { describe, expect, it, vi } from "vitest";
import { TRMClient } from "../client.js";
import { TRMSanctionsProvider } from "../provider.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeHttpClient(fetchFn: ReturnType<typeof vi.fn>) {
  return { fetch: fetchFn as unknown as (url: string, init: RequestInit) => Promise<Response> };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function errorResponse(status: number, message: string): Response {
  return new Response(JSON.stringify({ statusCode: status, message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const BASE_CONFIG = { apiKey: "trm_test_key" };

/** A clean address — no risk indicators. */
const CLEAN_ADDRESS_RESULT = [
  {
    address: "0xCleanAddress",
    chain: "ethereum",
    addressRiskIndicators: [],
    entities: [{ name: "Coinbase", url: "https://coinbase.com", category: "exchange" }],
    addressSubmitted: "0xCleanAddress",
  },
];

/** A risky address with indicators. */
const RISKY_ADDRESS_RESULT = [
  {
    address: "0xRiskyAddress",
    chain: "ethereum",
    addressRiskIndicators: [
      {
        category: "darknet_market",
        categoryRiskScoreLevel: 8,
        incomingVolumeUsd: "50000",
        outgoingVolumeUsd: "30000",
        totalVolumeUsd: "80000",
        riskType: "INDIRECT",
      },
    ],
    entities: [],
    addressSubmitted: "0xRiskyAddress",
  },
];

/** A sanctioned address. */
const SANCTIONED_ADDRESS_RESULT = [
  {
    address: "0xSanctionedAddress",
    chain: "ethereum",
    addressRiskIndicators: [
      {
        category: "sanctions",
        categoryRiskScoreLevel: 10,
        incomingVolumeUsd: "1000000",
        outgoingVolumeUsd: "500000",
        totalVolumeUsd: "1500000",
        riskType: "DIRECT",
      },
    ],
    entities: [{ name: "OFAC Sanctioned Entity", category: "sanctions" }],
    addressSubmitted: "0xSanctionedAddress",
  },
];

const ACCOUNT_DETAILS = {
  counterpartyVolume: [
    { category: "exchange", inboundVolumeUsd: "10000", outboundVolumeUsd: "5000" },
    { category: "darknet_market", inboundVolumeUsd: "500", outboundVolumeUsd: "200" },
  ],
  totalReceivedUsd: "10500",
  totalSentUsd: "5200",
  transactionCount: 42,
  firstTransactionDate: "2022-01-01T00:00:00Z",
  lastTransactionDate: "2026-01-01T00:00:00Z",
};

// ---------------------------------------------------------------------------
// TRMClient — constructor
// ---------------------------------------------------------------------------

describe("TRMClient", () => {
  describe("constructor", () => {
    it("uses production base URL by default", async () => {
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse(CLEAN_ADDRESS_RESULT));
      const client = new TRMClient(BASE_CONFIG, makeHttpClient(fetchMock));
      await client.screenAddress("0xClean", "ethereum");
      const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url.startsWith("https://api.trmlabs.com")).toBe(true);
    });

    it("uses custom base URL when provided", async () => {
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse(CLEAN_ADDRESS_RESULT));
      const client = new TRMClient(
        { ...BASE_CONFIG, baseUrl: "https://custom.trm.example" },
        makeHttpClient(fetchMock),
      );
      await client.screenAddress("0xClean", "ethereum");
      const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url.startsWith("https://custom.trm.example")).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // screenAddress — clean address
  // -------------------------------------------------------------------------

  describe("screenAddress — clean address", () => {
    it("POSTs to /public/v2/screening/addresses", async () => {
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse(CLEAN_ADDRESS_RESULT));
      const client = new TRMClient(BASE_CONFIG, makeHttpClient(fetchMock));

      await client.screenAddress("0xCleanAddress", "ethereum");

      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe("https://api.trmlabs.com/public/v2/screening/addresses");
      expect(init.method).toBe("POST");
    });

    it("sends address and chain in request body array", async () => {
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse(CLEAN_ADDRESS_RESULT));
      const client = new TRMClient(BASE_CONFIG, makeHttpClient(fetchMock));

      await client.screenAddress("0xCleanAddress", "ethereum");

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(init.body as string) as Array<Record<string, unknown>>;
      expect(body).toHaveLength(1);
      expect(body[0]?.address).toBe("0xCleanAddress");
      expect(body[0]?.chain).toBe("ethereum");
    });

    it("sends Authorization header with Bearer token", async () => {
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse(CLEAN_ADDRESS_RESULT));
      const client = new TRMClient(BASE_CONFIG, makeHttpClient(fetchMock));

      await client.screenAddress("0xCleanAddress", "ethereum");

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      const headers = init.headers as Record<string, string>;
      expect(headers["Authorization"]).toBe("Bearer trm_test_key");
    });

    it("returns riskScore=0 and riskCategory=no_risk for clean address", async () => {
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse(CLEAN_ADDRESS_RESULT));
      const client = new TRMClient(BASE_CONFIG, makeHttpClient(fetchMock));

      const result = await client.screenAddress("0xCleanAddress", "ethereum");

      expect(result.riskScore).toBe(0);
      expect(result.riskCategory).toBe("no_risk");
      expect(result.isSanctioned).toBe(false);
    });

    it("returns addressOwners with entity info", async () => {
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse(CLEAN_ADDRESS_RESULT));
      const client = new TRMClient(BASE_CONFIG, makeHttpClient(fetchMock));

      const result = await client.screenAddress("0xCleanAddress", "ethereum");

      expect(result.addressOwners).toHaveLength(1);
      expect(result.addressOwners[0]?.name).toBe("Coinbase");
      expect(result.addressOwners[0]?.type).toBe("exchange");
    });

    it("returns empty riskIndicators for clean address", async () => {
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse(CLEAN_ADDRESS_RESULT));
      const client = new TRMClient(BASE_CONFIG, makeHttpClient(fetchMock));

      const result = await client.screenAddress("0xCleanAddress", "ethereum");

      expect(result.riskIndicators).toHaveLength(0);
    });

    it("returns screenedAt as a valid ISO string", async () => {
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse(CLEAN_ADDRESS_RESULT));
      const client = new TRMClient(BASE_CONFIG, makeHttpClient(fetchMock));

      const result = await client.screenAddress("0xCleanAddress", "ethereum");

      expect(new Date(result.screenedAt).toISOString()).toBe(result.screenedAt);
    });
  });

  // -------------------------------------------------------------------------
  // screenAddress — risky address
  // -------------------------------------------------------------------------

  describe("screenAddress — risky address with indicators", () => {
    it("returns correct risk score calculated from indicators", async () => {
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse(RISKY_ADDRESS_RESULT));
      const client = new TRMClient(BASE_CONFIG, makeHttpClient(fetchMock));

      const result = await client.screenAddress("0xRiskyAddress", "ethereum");

      // categoryRiskScoreLevel=8 → 8*10=80
      expect(result.riskScore).toBe(80);
    });

    it("returns high_risk category for score 80", async () => {
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse(RISKY_ADDRESS_RESULT));
      const client = new TRMClient(BASE_CONFIG, makeHttpClient(fetchMock));

      const result = await client.screenAddress("0xRiskyAddress", "ethereum");

      expect(result.riskCategory).toBe("high_risk");
    });

    it("returns isSanctioned=false for non-sanctions risk", async () => {
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse(RISKY_ADDRESS_RESULT));
      const client = new TRMClient(BASE_CONFIG, makeHttpClient(fetchMock));

      const result = await client.screenAddress("0xRiskyAddress", "ethereum");

      expect(result.isSanctioned).toBe(false);
    });

    it("maps riskIndicators correctly", async () => {
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse(RISKY_ADDRESS_RESULT));
      const client = new TRMClient(BASE_CONFIG, makeHttpClient(fetchMock));

      const result = await client.screenAddress("0xRiskyAddress", "ethereum");

      expect(result.riskIndicators).toHaveLength(1);
      expect(result.riskIndicators[0]?.category).toBe("darknet_market");
      expect(result.riskIndicators[0]?.incomingVolumeUsd).toBe("50000");
    });
  });

  // -------------------------------------------------------------------------
  // screenAddress — sanctioned address
  // -------------------------------------------------------------------------

  describe("screenAddress — sanctioned address", () => {
    it("returns isSanctioned=true when category includes sanctions", async () => {
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse(SANCTIONED_ADDRESS_RESULT));
      const client = new TRMClient(BASE_CONFIG, makeHttpClient(fetchMock));

      const result = await client.screenAddress("0xSanctionedAddress", "ethereum");

      expect(result.isSanctioned).toBe(true);
    });

    it("returns riskCategory=sanctions when sanctioned", async () => {
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse(SANCTIONED_ADDRESS_RESULT));
      const client = new TRMClient(BASE_CONFIG, makeHttpClient(fetchMock));

      const result = await client.screenAddress("0xSanctionedAddress", "ethereum");

      expect(result.riskCategory).toBe("sanctions");
    });

    it("returns riskScore=100 for max risk level 10", async () => {
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse(SANCTIONED_ADDRESS_RESULT));
      const client = new TRMClient(BASE_CONFIG, makeHttpClient(fetchMock));

      const result = await client.screenAddress("0xSanctionedAddress", "ethereum");

      expect(result.riskScore).toBe(100);
    });

    it("returns isSanctioned=true when categoryRiskScoreLevel>=10 even if category doesn't say sanctions", async () => {
      const highLevelResult = [
        {
          address: "0xHighLevel",
          chain: "ethereum",
          addressRiskIndicators: [
            {
              category: "fraud_shop",
              categoryRiskScoreLevel: 10, // triggers isSanctioned via level >= 10
              incomingVolumeUsd: "0",
              outgoingVolumeUsd: "0",
              totalVolumeUsd: "0",
              riskType: "DIRECT",
            },
          ],
          entities: [],
          addressSubmitted: "0xHighLevel",
        },
      ];
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse(highLevelResult));
      const client = new TRMClient(BASE_CONFIG, makeHttpClient(fetchMock));

      const result = await client.screenAddress("0xHighLevel", "ethereum");

      expect(result.isSanctioned).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // screenAddress — risk categorization boundary values
  // -------------------------------------------------------------------------

  describe("screenAddress — risk category boundaries", () => {
    function buildResult(level: number, address = "0xTest") {
      return [
        {
          address,
          chain: "ethereum",
          addressRiskIndicators: level === 0 ? [] : [
            {
              category: "money_service_business",
              categoryRiskScoreLevel: level,
              incomingVolumeUsd: "1000",
              outgoingVolumeUsd: "500",
              totalVolumeUsd: "1500",
              riskType: "INDIRECT",
            },
          ],
          entities: [],
          addressSubmitted: address,
        },
      ];
    }

    it("returns no_risk for score=0", async () => {
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse(buildResult(0)));
      const client = new TRMClient(BASE_CONFIG, makeHttpClient(fetchMock));
      const result = await client.screenAddress("0xTest", "ethereum");
      expect(result.riskCategory).toBe("no_risk");
    });

    it("returns low_risk for score in range [10, 39]", async () => {
      // level=1 → score=10
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse(buildResult(1)));
      const client = new TRMClient(BASE_CONFIG, makeHttpClient(fetchMock));
      const result = await client.screenAddress("0xTest", "ethereum");
      expect(result.riskCategory).toBe("low_risk");
    });

    it("returns medium_risk for score in range [40, 69]", async () => {
      // level=4 → score=40
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse(buildResult(4)));
      const client = new TRMClient(BASE_CONFIG, makeHttpClient(fetchMock));
      const result = await client.screenAddress("0xTest", "ethereum");
      expect(result.riskCategory).toBe("medium_risk");
    });

    it("returns high_risk for score in range [70, 89]", async () => {
      // level=7 → score=70
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse(buildResult(7)));
      const client = new TRMClient(BASE_CONFIG, makeHttpClient(fetchMock));
      const result = await client.screenAddress("0xTest", "ethereum");
      expect(result.riskCategory).toBe("high_risk");
    });

    it("returns severe_risk for score>=90", async () => {
      // level=9 → score=90
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse(buildResult(9)));
      const client = new TRMClient(BASE_CONFIG, makeHttpClient(fetchMock));
      const result = await client.screenAddress("0xTest", "ethereum");
      expect(result.riskCategory).toBe("severe_risk");
    });
  });

  // -------------------------------------------------------------------------
  // screenAddress — error cases
  // -------------------------------------------------------------------------

  describe("screenAddress — error handling", () => {
    it("throws when API returns non-2xx", async () => {
      const fetchMock = vi.fn().mockResolvedValue(errorResponse(401, "Unauthorized"));
      const client = new TRMClient(BASE_CONFIG, makeHttpClient(fetchMock));
      await expect(client.screenAddress("0xTest", "ethereum")).rejects.toThrow(
        /TRM Labs API error 401/,
      );
    });

    it("throws when TRM returns empty results array", async () => {
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse([]));
      const client = new TRMClient(BASE_CONFIG, makeHttpClient(fetchMock));
      await expect(client.screenAddress("0xTest", "ethereum")).rejects.toThrow(
        /TRM returned empty result/,
      );
    });

    it("throws on network error", async () => {
      const fetchMock = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
      const client = new TRMClient(BASE_CONFIG, makeHttpClient(fetchMock));
      await expect(client.screenAddress("0xTest", "ethereum")).rejects.toThrow(TypeError);
    });
  });

  // -------------------------------------------------------------------------
  // getAddressReport
  // -------------------------------------------------------------------------

  describe("getAddressReport", () => {
    it("calls screenAddress and account endpoint, returns combined report", async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(jsonResponse(CLEAN_ADDRESS_RESULT)) // screenAddress
        .mockResolvedValueOnce(jsonResponse(ACCOUNT_DETAILS)); // account details

      const client = new TRMClient(BASE_CONFIG, makeHttpClient(fetchMock));

      const report = await client.getAddressReport("0xCleanAddress", "ethereum");

      expect(report.address).toBe("0xCleanAddress");
      expect(report.chain).toBe("ethereum");
      expect(report.riskScore).toBe(0);
      expect(report.isSanctioned).toBe(false);
      expect(report.generatedAt).toBeDefined();
    });

    it("maps counterpartyExposure correctly", async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(jsonResponse(CLEAN_ADDRESS_RESULT))
        .mockResolvedValueOnce(jsonResponse(ACCOUNT_DETAILS));

      const client = new TRMClient(BASE_CONFIG, makeHttpClient(fetchMock));

      const report = await client.getAddressReport("0xCleanAddress");

      expect(report.counterpartyExposure).toHaveLength(2);
      expect(report.counterpartyExposure[0]?.category).toBe("exchange");
      expect(report.counterpartyExposure[0]?.inboundUsd).toBe("10000");
      expect(report.counterpartyExposure[0]?.outboundUsd).toBe("5000");
    });

    it("maps volumeStats from account details", async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(jsonResponse(CLEAN_ADDRESS_RESULT))
        .mockResolvedValueOnce(jsonResponse(ACCOUNT_DETAILS));

      const client = new TRMClient(BASE_CONFIG, makeHttpClient(fetchMock));

      const report = await client.getAddressReport("0xCleanAddress");

      expect(report.volumeStats.totalInboundUsd).toBe("10500");
      expect(report.volumeStats.totalOutboundUsd).toBe("5200");
      expect(report.volumeStats.transactionCount).toBe(42);
      expect(report.volumeStats.firstSeen).toBe("2022-01-01T00:00:00Z");
      expect(report.volumeStats.lastSeen).toBe("2026-01-01T00:00:00Z");
    });

    it("defaults chain to ethereum when not specified", async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(jsonResponse(CLEAN_ADDRESS_RESULT))
        .mockResolvedValueOnce(jsonResponse(ACCOUNT_DETAILS));

      const client = new TRMClient(BASE_CONFIG, makeHttpClient(fetchMock));

      const report = await client.getAddressReport("0xCleanAddress");

      expect(report.chain).toBe("ethereum");
    });

    it("uses zero/empty defaults when account details fields are absent", async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(jsonResponse(CLEAN_ADDRESS_RESULT))
        .mockResolvedValueOnce(jsonResponse({})); // empty details

      const client = new TRMClient(BASE_CONFIG, makeHttpClient(fetchMock));

      const report = await client.getAddressReport("0xCleanAddress");

      expect(report.counterpartyExposure).toHaveLength(0);
      expect(report.volumeStats.totalInboundUsd).toBe("0");
      expect(report.volumeStats.totalOutboundUsd).toBe("0");
      expect(report.volumeStats.transactionCount).toBe(0);
      expect(report.volumeStats.firstSeen).toBe("");
      expect(report.volumeStats.lastSeen).toBe("");
    });

    it("builds correct account endpoint URL with chain param", async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(jsonResponse(CLEAN_ADDRESS_RESULT))
        .mockResolvedValueOnce(jsonResponse(ACCOUNT_DETAILS));

      const client = new TRMClient(BASE_CONFIG, makeHttpClient(fetchMock));

      await client.getAddressReport("0xCleanAddress", "bitcoin");

      const calls = fetchMock.mock.calls as Array<[string, RequestInit]>;
      const accountUrl = calls[1]?.[0];
      expect(accountUrl).toContain("/public/v1/accounts/0xCleanAddress");
      expect(accountUrl).toContain("chain=bitcoin");
    });
  });
});

// ---------------------------------------------------------------------------
// TRMSanctionsProvider — SanctionsProvider interface compliance
// ---------------------------------------------------------------------------

describe("TRMSanctionsProvider", () => {
  it("implements screenAddress method (provider interface)", () => {
    const provider = new TRMSanctionsProvider(BASE_CONFIG);
    expect(typeof provider.screenAddress).toBe("function");
  });

  it("screenAddress returns matched=false for clean address", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(CLEAN_ADDRESS_RESULT));
    const provider = new TRMSanctionsProvider(BASE_CONFIG, makeHttpClient(fetchMock));

    const result = await provider.screenAddress("0xCleanAddress", "ethereum");

    expect(result.matched).toBe(false);
    expect(result.matchDetails).toHaveLength(0);
  });

  it("screenAddress returns matched=true for sanctioned address", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(SANCTIONED_ADDRESS_RESULT));
    const provider = new TRMSanctionsProvider(BASE_CONFIG, makeHttpClient(fetchMock));

    const result = await provider.screenAddress("0xSanctionedAddress", "ethereum");

    expect(result.matched).toBe(true);
    expect(result.matchDetails).toHaveLength(1);
  });

  it("returns provider=trm", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(CLEAN_ADDRESS_RESULT));
    const provider = new TRMSanctionsProvider(BASE_CONFIG, makeHttpClient(fetchMock));

    const result = await provider.screenAddress("0xCleanAddress", "ethereum");

    expect(result.provider).toBe("trm");
  });

  it("listsChecked contains expected sanctions lists", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(CLEAN_ADDRESS_RESULT));
    const provider = new TRMSanctionsProvider(BASE_CONFIG, makeHttpClient(fetchMock));

    const result = await provider.screenAddress("0xCleanAddress", "ethereum");

    expect(result.listsChecked).toContain("OFAC_SDN");
    expect(result.listsChecked).toContain("EU_CONSOLIDATED");
    expect(result.listsChecked).toContain("UN_CONSOLIDATED");
  });

  it("matchDetails contains correct OFAC_SDN list for sanctioned address", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(SANCTIONED_ADDRESS_RESULT));
    const provider = new TRMSanctionsProvider(BASE_CONFIG, makeHttpClient(fetchMock));

    const result = await provider.screenAddress("0xSanctionedAddress", "ethereum");

    expect(result.matchDetails[0]?.list).toBe("OFAC_SDN");
    expect(result.matchDetails[0]?.matchConfidence).toBe(1); // score=100/100
  });

  it("matchDetails uses TRM-prefixed entryId", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(SANCTIONED_ADDRESS_RESULT));
    const provider = new TRMSanctionsProvider(BASE_CONFIG, makeHttpClient(fetchMock));

    const result = await provider.screenAddress("0xSanctionedAddress", "ethereum");

    expect(result.matchDetails[0]?.entryId?.startsWith("trm-")).toBe(true);
  });

  it("matchDetails uses address owner name when available", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(SANCTIONED_ADDRESS_RESULT));
    const provider = new TRMSanctionsProvider(BASE_CONFIG, makeHttpClient(fetchMock));

    const result = await provider.screenAddress("0xSanctionedAddress", "ethereum");

    expect(result.matchDetails[0]?.name).toBe("OFAC Sanctioned Entity");
  });

  it("matchDetails uses fallback name when no owner available", async () => {
    const noOwnerSanctioned = [
      {
        ...SANCTIONED_ADDRESS_RESULT[0],
        entities: [],
        addressSubmitted: "0xNoOwner",
        address: "0xNoOwner",
      },
    ];
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(noOwnerSanctioned));
    const provider = new TRMSanctionsProvider(BASE_CONFIG, makeHttpClient(fetchMock));

    const result = await provider.screenAddress("0xNoOwner", "ethereum");

    expect(result.matchDetails[0]?.name).toBe("TRM Sanctioned Entity");
  });

  it("riskScore in result matches TRM screening score", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(SANCTIONED_ADDRESS_RESULT));
    const provider = new TRMSanctionsProvider(BASE_CONFIG, makeHttpClient(fetchMock));

    const result = await provider.screenAddress("0xSanctionedAddress", "ethereum");

    expect(result.riskScore).toBe(100);
  });

  it("screenedAt is a valid ISO date string", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(CLEAN_ADDRESS_RESULT));
    const provider = new TRMSanctionsProvider(BASE_CONFIG, makeHttpClient(fetchMock));

    const result = await provider.screenAddress("0xCleanAddress", "ethereum");

    expect(new Date(result.screenedAt).toISOString()).toBe(result.screenedAt);
  });
});
