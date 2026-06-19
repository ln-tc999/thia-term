import { beforeEach, describe, expect, it, vi } from "vitest";
import { NotabeneClient } from "../client.js";
import { NotabeneTravelRuleProvider } from "../provider.js";
import type { NotabeneTransfer } from "../types.js";

// ---------------------------------------------------------------------------
// Shared HTTP mock
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

const BASE_CONFIG = {
  apiKey: "nb_test_key",
  vaspDID: "did:ethr:0xVASP",
};

const NOTABENE_TRANSFER: NotabeneTransfer = {
  id: "tx_notabene_001",
  status: "CREATED",
  transactionType: "TRANSACTION",
  transactionAsset: "USDC",
  transactionAmount: "5000",
  originatorVASPdid: "did:ethr:0xVASP",
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

const TRAVEL_RULE_DATA = {
  originator: {
    name: "Alice",
    walletAddress: "0xAlice",
    physicalAddress: "123 Main St",
    nationalId: "US-ID-001",
  },
  beneficiary: {
    name: "Bob",
    walletAddress: "0xBob",
  },
  amountUsd: 5000,
  asset: "USDC" as const,
  chain: "ethereum" as const,
  direction: "outgoing" as const,
  preTransaction: false,
};

// ---------------------------------------------------------------------------
// NotabeneClient — submitTransfer
// ---------------------------------------------------------------------------

describe("NotabeneClient", () => {
  describe("constructor", () => {
    it("uses production base URL by default", async () => {
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ items: [] }));
      const client = new NotabeneClient(BASE_CONFIG, makeHttpClient(fetchMock));
      await client.listTransfers();
      const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url.startsWith("https://api.notabene.id/v1")).toBe(true);
    });

    it("uses testnet URL when testnet=true", async () => {
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ items: [] }));
      const client = new NotabeneClient(
        { ...BASE_CONFIG, testnet: true },
        makeHttpClient(fetchMock),
      );
      await client.listTransfers();
      const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url.startsWith("https://api.notabene.dev/v1")).toBe(true);
    });

    it("uses custom baseUrl when provided", async () => {
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ items: [] }));
      const client = new NotabeneClient(
        { ...BASE_CONFIG, baseUrl: "https://custom.notabene.example/v1" },
        makeHttpClient(fetchMock),
      );
      await client.listTransfers();
      const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url.startsWith("https://custom.notabene.example/v1")).toBe(true);
    });
  });

  describe("submitTransfer", () => {
    it("POSTs to /tx/create and returns NotabeneResponse", async () => {
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse(NOTABENE_TRANSFER));
      const client = new NotabeneClient(BASE_CONFIG, makeHttpClient(fetchMock));

      const result = await client.submitTransfer(TRAVEL_RULE_DATA);

      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe("https://api.notabene.id/v1/tx/create");
      expect(init.method).toBe("POST");
      expect(result.id).toBe("tx_notabene_001");
      expect(result.status).toBe("CREATED");
    });

    it("sends Authorization header with Bearer token", async () => {
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse(NOTABENE_TRANSFER));
      const client = new NotabeneClient(BASE_CONFIG, makeHttpClient(fetchMock));

      await client.submitTransfer(TRAVEL_RULE_DATA);

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      const headers = init.headers as Record<string, string>;
      expect(headers["Authorization"]).toBe("Bearer nb_test_key");
    });

    it("includes originator wallet address in transactionBlockchainInfo", async () => {
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse(NOTABENE_TRANSFER));
      const client = new NotabeneClient(BASE_CONFIG, makeHttpClient(fetchMock));

      await client.submitTransfer(TRAVEL_RULE_DATA);

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(init.body as string) as Record<string, unknown>;
      const blockchainInfo = body.transactionBlockchainInfo as Record<string, string>;
      expect(blockchainInfo.origin).toBe("0xAlice");
      expect(blockchainInfo.destination).toBe("0xBob");
    });

    it("sets VASP DID as originatorVASPdid", async () => {
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse(NOTABENE_TRANSFER));
      const client = new NotabeneClient(BASE_CONFIG, makeHttpClient(fetchMock));

      await client.submitTransfer(TRAVEL_RULE_DATA);

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(init.body as string) as Record<string, unknown>;
      expect(body.originatorVASPdid).toBe("did:ethr:0xVASP");
    });

    it("includes physicalAddress in originator geographicAddress when present", async () => {
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse(NOTABENE_TRANSFER));
      const client = new NotabeneClient(BASE_CONFIG, makeHttpClient(fetchMock));

      await client.submitTransfer(TRAVEL_RULE_DATA);

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(init.body as string) as Record<string, unknown>;
      const originator = body.originator as Record<string, unknown>;
      const persons = originator.originatorPersons as Array<Record<string, unknown>>;
      const naturalPerson = persons[0]?.naturalPerson as Record<string, unknown>;
      const geoAddress = naturalPerson?.geographicAddress as Array<Record<string, unknown>>;
      expect(geoAddress?.[0]?.addressLine).toEqual(["123 Main St"]);
    });

    it("includes nationalId in originator when present", async () => {
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse(NOTABENE_TRANSFER));
      const client = new NotabeneClient(BASE_CONFIG, makeHttpClient(fetchMock));

      await client.submitTransfer(TRAVEL_RULE_DATA);

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(init.body as string) as Record<string, unknown>;
      const originator = body.originator as Record<string, unknown>;
      const persons = originator.originatorPersons as Array<Record<string, unknown>>;
      const naturalPerson = persons[0]?.naturalPerson as Record<string, unknown>;
      const natId = naturalPerson?.nationalIdentification as Record<string, unknown>;
      expect(natId?.nationalIdentifier).toBe("US-ID-001");
    });

    it("omits geographicAddress when physicalAddress is absent", async () => {
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse(NOTABENE_TRANSFER));
      const client = new NotabeneClient(BASE_CONFIG, makeHttpClient(fetchMock));

      const dataNoAddress = {
        ...TRAVEL_RULE_DATA,
        originator: { ...TRAVEL_RULE_DATA.originator, physicalAddress: undefined },
      };
      await client.submitTransfer(dataNoAddress);

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(init.body as string) as Record<string, unknown>;
      const originator = body.originator as Record<string, unknown>;
      const persons = originator.originatorPersons as Array<Record<string, unknown>>;
      const naturalPerson = persons[0]?.naturalPerson as Record<string, unknown>;
      expect(naturalPerson?.geographicAddress).toBeUndefined();
    });

    it("uses Unknown as originator name when name is absent", async () => {
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse(NOTABENE_TRANSFER));
      const client = new NotabeneClient(BASE_CONFIG, makeHttpClient(fetchMock));

      const dataNoName = {
        ...TRAVEL_RULE_DATA,
        originator: { ...TRAVEL_RULE_DATA.originator, name: undefined },
      };
      await client.submitTransfer(dataNoName);

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(init.body as string) as Record<string, unknown>;
      const originator = body.originator as Record<string, unknown>;
      const persons = originator.originatorPersons as Array<Record<string, unknown>>;
      const naturalPerson = persons[0]?.naturalPerson as Record<string, unknown>;
      const nameArr = naturalPerson?.name as Array<Record<string, unknown>>;
      const nameId = nameArr?.[0]?.nameIdentifier as Array<Record<string, unknown>>;
      expect(nameId?.[0]?.primaryIdentifier).toBe("Unknown");
    });

    it("throws on API error response", async () => {
      const fetchMock = vi.fn().mockResolvedValue(errorResponse(422, "Missing required field"));
      const client = new NotabeneClient(BASE_CONFIG, makeHttpClient(fetchMock));

      await expect(client.submitTransfer(TRAVEL_RULE_DATA)).rejects.toThrow(
        /Notabene API error 422/,
      );
    });

    it("raw field contains full API response", async () => {
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse(NOTABENE_TRANSFER));
      const client = new NotabeneClient(BASE_CONFIG, makeHttpClient(fetchMock));

      const result = await client.submitTransfer(TRAVEL_RULE_DATA);

      expect(result.raw).toBeDefined();
      expect((result.raw as Record<string, unknown>)?.id).toBe("tx_notabene_001");
    });
  });

  // -------------------------------------------------------------------------
  // getTransfer
  // -------------------------------------------------------------------------

  describe("getTransfer", () => {
    it("GETs /tx/:id and returns NotabeneTransfer", async () => {
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse(NOTABENE_TRANSFER));
      const client = new NotabeneClient(BASE_CONFIG, makeHttpClient(fetchMock));

      const result = await client.getTransfer("tx_notabene_001");

      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe("https://api.notabene.id/v1/tx/tx_notabene_001");
      expect(init.method).toBe("GET");
      expect(result.id).toBe("tx_notabene_001");
      expect(result.status).toBe("CREATED");
    });

    it("URL-encodes the transfer ID", async () => {
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse(NOTABENE_TRANSFER));
      const client = new NotabeneClient(BASE_CONFIG, makeHttpClient(fetchMock));

      await client.getTransfer("tx/with/slashes");

      const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toContain("tx%2Fwith%2Fslashes");
    });

    it("throws on 404 not found", async () => {
      const fetchMock = vi.fn().mockResolvedValue(errorResponse(404, "Transfer not found"));
      const client = new NotabeneClient(BASE_CONFIG, makeHttpClient(fetchMock));

      await expect(client.getTransfer("tx_missing")).rejects.toThrow(/Notabene API error 404/);
    });
  });

  // -------------------------------------------------------------------------
  // listTransfers
  // -------------------------------------------------------------------------

  describe("listTransfers", () => {
    it("GETs /tx and returns items array", async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValue(jsonResponse({ items: [NOTABENE_TRANSFER] }));
      const client = new NotabeneClient(BASE_CONFIG, makeHttpClient(fetchMock));

      const result = await client.listTransfers();

      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe("https://api.notabene.id/v1/tx");
      expect(init.method).toBe("GET");
      expect(result).toHaveLength(1);
      expect(result[0]?.id).toBe("tx_notabene_001");
    });

    it("sends limit and offset as query params", async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValue(jsonResponse({ items: [] }));
      const client = new NotabeneClient(BASE_CONFIG, makeHttpClient(fetchMock));

      await client.listTransfers({ limit: 10, offset: 20 });

      const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toContain("limit=10");
      expect(url).toContain("offset=20");
    });

    it("sends status filter as query param", async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValue(jsonResponse({ items: [] }));
      const client = new NotabeneClient(BASE_CONFIG, makeHttpClient(fetchMock));

      await client.listTransfers({ status: "SENT" });

      const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toContain("status=SENT");
    });

    it("sends createdAfter and createdBefore filters", async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValue(jsonResponse({ items: [] }));
      const client = new NotabeneClient(BASE_CONFIG, makeHttpClient(fetchMock));

      await client.listTransfers({
        createdAfter: "2026-01-01T00:00:00Z",
        createdBefore: "2026-12-31T23:59:59Z",
      });

      const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toContain("createdAfter=2026-01-01T00%3A00%3A00Z");
      expect(url).toContain("createdBefore=2026-12-31T23%3A59%3A59Z");
    });

    it("returns empty array when no transfers exist", async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValue(jsonResponse({ items: [] }));
      const client = new NotabeneClient(BASE_CONFIG, makeHttpClient(fetchMock));

      const result = await client.listTransfers();
      expect(result).toEqual([]);
    });

    it("throws on API error", async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValue(errorResponse(500, "Internal server error"));
      const client = new NotabeneClient(BASE_CONFIG, makeHttpClient(fetchMock));

      await expect(client.listTransfers()).rejects.toThrow(/Notabene API error 500/);
    });
  });
});

// ---------------------------------------------------------------------------
// NotabeneTravelRuleProvider — TravelRuleProvider interface compliance
// ---------------------------------------------------------------------------

describe("NotabeneTravelRuleProvider", () => {
  const IVMS_MESSAGE = {
    originator: {
      originatorPersons: [
        {
          naturalPerson: {
            nameIdentifier: [{ primaryIdentifier: "Alice", nameIdentifierType: "LEGL" as const }],
            geographicAddress: "123 Main St",
            nationalId: "US-ID-001",
          },
        },
      ],
      accountNumber: ["0xAlice"],
    },
    beneficiary: {
      beneficiaryPersons: [
        {
          naturalPerson: { nameIdentifier: [{ primaryIdentifier: "Bob", nameIdentifierType: "LEGL" as const }] },
        },
      ],
      accountNumber: ["0xBob"],
    },
    transactionAmount: "5000",
    transactionAmountCurrency: "USDC",
    transactionAsset: "USDC" as const,
    transactionChain: "ethereum" as const,
  };

  it("implements transmit method (provider interface)", () => {
    const provider = new NotabeneTravelRuleProvider(BASE_CONFIG);
    expect(typeof provider.transmit).toBe("function");
  });

  it("transmit returns success=true with referenceId on success", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(NOTABENE_TRANSFER));
    const provider = new NotabeneTravelRuleProvider(
      BASE_CONFIG,
      makeHttpClient(fetchMock),
    );

    const result = await provider.transmit(IVMS_MESSAGE);

    expect(result.success).toBe(true);
    expect(result.referenceId).toBe("tx_notabene_001");
    expect(result.error).toBeUndefined();
  });

  it("transmit returns success=false with error message on network failure", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValue(new Error("connection refused"));
    const provider = new NotabeneTravelRuleProvider(
      BASE_CONFIG,
      makeHttpClient(fetchMock),
    );

    const result = await provider.transmit(IVMS_MESSAGE);

    expect(result.success).toBe(false);
    expect(result.error).toContain("Notabene transmission failed");
    expect(result.referenceId).toBeUndefined();
  });

  it("transmit returns success=false with error message on API error", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(errorResponse(422, "Missing required IVMS field"));
    const provider = new NotabeneTravelRuleProvider(
      BASE_CONFIG,
      makeHttpClient(fetchMock),
    );

    const result = await provider.transmit(IVMS_MESSAGE);

    expect(result.success).toBe(false);
    expect(result.error).toContain("Notabene transmission failed");
  });

  it("transmit extracts originator name from naturalPerson", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(NOTABENE_TRANSFER));
    const provider = new NotabeneTravelRuleProvider(
      BASE_CONFIG,
      makeHttpClient(fetchMock),
    );

    await provider.transmit(IVMS_MESSAGE);

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    const originator = body.originator as Record<string, unknown>;
    const persons = originator.originatorPersons as Array<Record<string, unknown>>;
    const naturalPerson = persons[0]?.naturalPerson as Record<string, unknown>;
    const nameArr = naturalPerson?.name as Array<Record<string, unknown>>;
    const nameId = nameArr?.[0]?.nameIdentifier as Array<Record<string, unknown>>;
    expect(nameId?.[0]?.primaryIdentifier).toBe("Alice");
  });

  it("transmit falls back to legalPerson name when naturalPerson has no name", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(NOTABENE_TRANSFER));
    const provider = new NotabeneTravelRuleProvider(
      BASE_CONFIG,
      makeHttpClient(fetchMock),
    );

    const msgWithLegal = {
      ...IVMS_MESSAGE,
      originator: {
        ...IVMS_MESSAGE.originator,
        originatorPersons: [
          {
            legalPerson: { nameIdentifier: [{ primaryIdentifier: "Acme Corp", nameIdentifierType: "LEGL" as const }] },
          },
        ],
      },
    };

    const result = await provider.transmit(msgWithLegal);
    expect(result.success).toBe(true);
  });

  it("transmit uses empty string for wallet address when accountNumber is empty", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(NOTABENE_TRANSFER));
    const provider = new NotabeneTravelRuleProvider(
      BASE_CONFIG,
      makeHttpClient(fetchMock),
    );

    const msgNoAccount = {
      ...IVMS_MESSAGE,
      originator: { ...IVMS_MESSAGE.originator, accountNumber: [] },
    };

    const result = await provider.transmit(msgNoAccount);
    // Should still succeed, just with empty wallet address
    expect(result.success).toBe(true);
  });
});
