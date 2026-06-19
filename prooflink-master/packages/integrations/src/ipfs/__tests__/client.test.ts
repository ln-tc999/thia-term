import { describe, expect, it, vi } from "vitest";
import { IPFSClient } from "../client.js";
import type { PinMetadata } from "../types.js";

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

function textResponse(text: string, status: number): Response {
  return new Response(text, { status, headers: { "Content-Type": "text/plain" } });
}

function noContentResponse(): Response {
  return new Response(null, { status: 200 });
}

// ---------------------------------------------------------------------------
// Pinata provider tests
// ---------------------------------------------------------------------------

describe("IPFSClient — Pinata provider", () => {
  const BASE_CONFIG = {
    pinningService: "pinata" as const,
    gateway: "https://gateway.pinata.cloud/ipfs",
    apiKey: "pinata_jwt_token",
  };

  const PINATA_PIN_RESPONSE = {
    IpfsHash: "QmPinataHash123",
    PinSize: 256,
    Timestamp: "2026-01-01T00:00:00Z",
  };

  describe("constructor", () => {
    it("uses Pinata base URL by default", async () => {
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse(PINATA_PIN_RESPONSE));
      const client = new IPFSClient(BASE_CONFIG, makeHttpClient(fetchMock));
      await client.pin({ test: "data" });
      const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url.startsWith("https://api.pinata.cloud")).toBe(true);
    });

    it("uses custom baseUrl when provided", async () => {
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse(PINATA_PIN_RESPONSE));
      const client = new IPFSClient(
        { ...BASE_CONFIG, baseUrl: "https://custom.pinata.example" },
        makeHttpClient(fetchMock),
      );
      await client.pin({ test: "data" });
      const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url.startsWith("https://custom.pinata.example")).toBe(true);
    });
  });

  describe("pin", () => {
    it("POSTs to /pinning/pinJSONToIPFS and returns PinResult", async () => {
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse(PINATA_PIN_RESPONSE));
      const client = new IPFSClient(BASE_CONFIG, makeHttpClient(fetchMock));

      const result = await client.pin({ receiptId: "rcpt_001" });

      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe("https://api.pinata.cloud/pinning/pinJSONToIPFS");
      expect(init.method).toBe("POST");
      expect(result.cid).toBe("QmPinataHash123");
      expect(result.size).toBe(256);
      expect(result.timestamp).toBe("2026-01-01T00:00:00Z");
    });

    it("sends Authorization header with Bearer token", async () => {
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse(PINATA_PIN_RESPONSE));
      const client = new IPFSClient(BASE_CONFIG, makeHttpClient(fetchMock));

      await client.pin({ test: "data" });

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      const headers = init.headers as Record<string, string>;
      expect(headers["Authorization"]).toBe("Bearer pinata_jwt_token");
    });

    it("wraps data in pinataContent field", async () => {
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse(PINATA_PIN_RESPONSE));
      const client = new IPFSClient(BASE_CONFIG, makeHttpClient(fetchMock));

      const data = { complianceReceipt: "test", riskScore: 5 };
      await client.pin(data);

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(init.body as string) as Record<string, unknown>;
      expect(body.pinataContent).toEqual(data);
    });

    it("includes pinataMetadata when name is provided", async () => {
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse(PINATA_PIN_RESPONSE));
      const client = new IPFSClient(BASE_CONFIG, makeHttpClient(fetchMock));

      await client.pin({ data: "test" }, "compliance-receipt-001");

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(init.body as string) as Record<string, unknown>;
      const pinMeta = body.pinataMetadata as Record<string, unknown>;
      expect(pinMeta?.name).toBe("compliance-receipt-001");
    });

    it("omits pinataMetadata when name is not provided", async () => {
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse(PINATA_PIN_RESPONSE));
      const client = new IPFSClient(BASE_CONFIG, makeHttpClient(fetchMock));

      await client.pin({ data: "test" });

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(init.body as string) as Record<string, unknown>;
      expect(body.pinataMetadata).toBeUndefined();
    });

    it("throws on API error", async () => {
      const fetchMock = vi.fn().mockResolvedValue(textResponse("Unauthorized", 401));
      const client = new IPFSClient(BASE_CONFIG, makeHttpClient(fetchMock));

      await expect(client.pin({ data: "test" })).rejects.toThrow(/IPFS API error 401/);
    });
  });

  describe("get", () => {
    const SAMPLE_CONTENT = { receiptId: "rcpt_001", status: "COMPLIANT" };

    it("GETs from configured gateway URL", async () => {
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse(SAMPLE_CONTENT));
      const client = new IPFSClient(BASE_CONFIG, makeHttpClient(fetchMock));

      await client.get("QmTestCID");

      const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe("https://gateway.pinata.cloud/ipfs/QmTestCID");
    });

    it("returns parsed JSON object", async () => {
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse(SAMPLE_CONTENT));
      const client = new IPFSClient(BASE_CONFIG, makeHttpClient(fetchMock));

      const result = await client.get("QmTestCID");

      expect(result).toEqual(SAMPLE_CONTENT);
    });

    it("sends Accept: application/json header", async () => {
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse(SAMPLE_CONTENT));
      const client = new IPFSClient(BASE_CONFIG, makeHttpClient(fetchMock));

      await client.get("QmTestCID");

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      const headers = init.headers as Record<string, string>;
      expect(headers["Accept"]).toBe("application/json");
    });

    it("sends GET method", async () => {
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse(SAMPLE_CONTENT));
      const client = new IPFSClient(BASE_CONFIG, makeHttpClient(fetchMock));

      await client.get("QmTestCID");

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(init.method).toBe("GET");
    });

    it("throws on gateway error", async () => {
      const fetchMock = vi.fn().mockResolvedValue(textResponse("Not Found", 404));
      const client = new IPFSClient(BASE_CONFIG, makeHttpClient(fetchMock));

      await expect(client.get("QmMissing")).rejects.toThrow(/IPFS gateway error 404/);
    });
  });

  describe("unpin", () => {
    it("sends DELETE to /pinning/unpin/:cid for Pinata", async () => {
      const fetchMock = vi.fn().mockResolvedValue(noContentResponse());
      const client = new IPFSClient(BASE_CONFIG, makeHttpClient(fetchMock));

      await client.unpin("QmCIDToUnpin");

      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe("https://api.pinata.cloud/pinning/unpin/QmCIDToUnpin");
      expect(init.method).toBe("DELETE");
    });

    it("URL-encodes the CID when unpinning", async () => {
      const fetchMock = vi.fn().mockResolvedValue(noContentResponse());
      const client = new IPFSClient(BASE_CONFIG, makeHttpClient(fetchMock));

      await client.unpin("Qm/special/cid");

      const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toContain("Qm%2Fspecial%2Fcid");
    });

    it("throws on unpin error", async () => {
      const fetchMock = vi.fn().mockResolvedValue(textResponse("Not Found", 404));
      const client = new IPFSClient(BASE_CONFIG, makeHttpClient(fetchMock));

      await expect(client.unpin("QmMissing")).rejects.toThrow(/IPFS API error 404/);
    });
  });

  describe("list", () => {
    it("GETs /data/pinList and returns PinResult array", async () => {
      const listResponse = {
        rows: [
          { ipfs_pin_hash: "QmHash1", size: 100, date_pinned: "2026-01-01T00:00:00Z" },
          { ipfs_pin_hash: "QmHash2", size: 200, date_pinned: "2026-01-02T00:00:00Z" },
        ],
      };
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse(listResponse));
      const client = new IPFSClient(BASE_CONFIG, makeHttpClient(fetchMock));

      const result = await client.list();

      expect(result).toHaveLength(2);
      expect(result[0]?.cid).toBe("QmHash1");
      expect(result[1]?.cid).toBe("QmHash2");
    });

    it("returns empty array when no pins exist", async () => {
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ rows: [] }));
      const client = new IPFSClient(BASE_CONFIG, makeHttpClient(fetchMock));

      const result = await client.list();
      expect(result).toEqual([]);
    });
  });
});

// ---------------------------------------------------------------------------
// web3.storage provider tests
// ---------------------------------------------------------------------------

describe("IPFSClient — web3.storage provider", () => {
  const BASE_CONFIG = {
    pinningService: "web3storage" as const,
    gateway: "https://w3s.link/ipfs",
    apiKey: "w3s_token",
  };

  const W3S_PIN_RESPONSE = { cid: "QmW3StorageHash456" };

  describe("constructor", () => {
    it("uses web3.storage base URL by default", async () => {
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse(W3S_PIN_RESPONSE));
      const client = new IPFSClient(BASE_CONFIG, makeHttpClient(fetchMock));
      await client.pin({ test: "data" });
      const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url.startsWith("https://api.web3.storage")).toBe(true);
    });
  });

  describe("pin", () => {
    it("POSTs to /upload endpoint for web3.storage", async () => {
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse(W3S_PIN_RESPONSE));
      const client = new IPFSClient(BASE_CONFIG, makeHttpClient(fetchMock));

      const result = await client.pin({ data: "w3s test" });

      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe("https://api.web3.storage/upload");
      expect(init.method).toBe("POST");
      expect(result.cid).toBe("QmW3StorageHash456");
    });

    it("sends Authorization header with Bearer token", async () => {
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse(W3S_PIN_RESPONSE));
      const client = new IPFSClient(BASE_CONFIG, makeHttpClient(fetchMock));

      await client.pin({ data: "test" });

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      const headers = init.headers as Record<string, string>;
      expect(headers["Authorization"]).toBe("Bearer w3s_token");
    });

    it("throws on upload error", async () => {
      const fetchMock = vi.fn().mockResolvedValue(textResponse("Storage limit exceeded", 402));
      const client = new IPFSClient(BASE_CONFIG, makeHttpClient(fetchMock));

      await expect(client.pin({ data: "test" })).rejects.toThrow(
        /web3.storage API error 402/,
      );
    });
  });

  describe("get", () => {
    it("GETs from configured gateway URL", async () => {
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ data: "test" }));
      const client = new IPFSClient(BASE_CONFIG, makeHttpClient(fetchMock));

      await client.get("QmTestW3S");

      const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe("https://w3s.link/ipfs/QmTestW3S");
    });
  });

  describe("unpin", () => {
    it("sends DELETE to /pins/:cid for web3.storage", async () => {
      const fetchMock = vi.fn().mockResolvedValue(noContentResponse());
      const client = new IPFSClient(BASE_CONFIG, makeHttpClient(fetchMock));

      await client.unpin("QmW3SToUnpin");

      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe("https://api.web3.storage/pins/QmW3SToUnpin");
      expect(init.method).toBe("DELETE");
    });
  });

  describe("list", () => {
    it("GETs /user/uploads and returns PinResult array", async () => {
      const listResponse = {
        results: [
          {
            cid: "QmW3S1",
            created: "2026-01-01T00:00:00Z",
            pins: [{ status: "pinned" }],
          },
        ],
      };
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse(listResponse));
      const client = new IPFSClient(BASE_CONFIG, makeHttpClient(fetchMock));

      const result = await client.list();

      expect(result).toHaveLength(1);
      expect(result[0]?.cid).toBe("QmW3S1");
      // web3.storage doesn't return size
      expect(result[0]?.size).toBe(0);
    });
  });
});

// ---------------------------------------------------------------------------
// Infura provider tests
// ---------------------------------------------------------------------------

describe("IPFSClient — Infura provider", () => {
  const BASE_CONFIG = {
    pinningService: "infura" as const,
    gateway: "https://my-project.infura-ipfs.io/ipfs",
    apiKey: "infura_project_id",
    apiSecret: "infura_project_secret",
  };

  describe("constructor", () => {
    it("uses Infura base URL by default", async () => {
      const infuraPinResponse = { Hash: "QmInfuraHash", Size: "1024" };
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse(infuraPinResponse));
      const client = new IPFSClient(BASE_CONFIG, makeHttpClient(fetchMock));
      await client.pin({ test: "data" });
      const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url.startsWith("https://ipfs.infura.io:5001/api/v0")).toBe(true);
    });
  });

  describe("pin", () => {
    it("POSTs to /add endpoint for Infura", async () => {
      const infuraPinResponse = { Hash: "QmInfuraHash789", Size: "512" };
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse(infuraPinResponse));
      const client = new IPFSClient(BASE_CONFIG, makeHttpClient(fetchMock));

      const result = await client.pin({ data: "infura test" });

      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toContain("/add?pin=true");
      expect(init.method).toBe("POST");
      expect(result.cid).toBe("QmInfuraHash789");
      expect(result.size).toBe(512);
    });

    it("sends Basic Authorization header for Infura", async () => {
      const infuraPinResponse = { Hash: "QmInfuraHash789", Size: "512" };
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse(infuraPinResponse));
      const client = new IPFSClient(BASE_CONFIG, makeHttpClient(fetchMock));

      await client.pin({ data: "test" });

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      const headers = init.headers as Record<string, string>;
      expect(headers["Authorization"]).toMatch(/^Basic /);
    });

    it("throws on Infura upload error", async () => {
      const fetchMock = vi.fn().mockResolvedValue(textResponse("Unauthorized", 401));
      const client = new IPFSClient(BASE_CONFIG, makeHttpClient(fetchMock));

      await expect(client.pin({ data: "test" })).rejects.toThrow(
        /Infura IPFS API error 401/,
      );
    });
  });

  describe("unpin", () => {
    it("sends POST to /pin/rm for Infura", async () => {
      const fetchMock = vi.fn().mockResolvedValue(noContentResponse());
      const client = new IPFSClient(BASE_CONFIG, makeHttpClient(fetchMock));

      await client.unpin("QmInfuraToUnpin");

      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toContain("/pin/rm");
      expect(url).toContain("QmInfuraToUnpin");
      expect(init.method).toBe("POST");
    });

    it("throws on Infura unpin error", async () => {
      const fetchMock = vi.fn().mockResolvedValue(textResponse("Not Found", 404));
      const client = new IPFSClient(BASE_CONFIG, makeHttpClient(fetchMock));

      await expect(client.unpin("QmMissing")).rejects.toThrow(/Infura IPFS unpin error 404/);
    });
  });

  describe("get", () => {
    it("GETs from configured gateway URL for Infura", async () => {
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ data: "test" }));
      const client = new IPFSClient(BASE_CONFIG, makeHttpClient(fetchMock));

      await client.get("QmInfuraGet");

      const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe("https://my-project.infura-ipfs.io/ipfs/QmInfuraGet");
    });
  });
});
