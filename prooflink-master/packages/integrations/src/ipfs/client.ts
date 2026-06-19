// ---------------------------------------------------------------------------
// IPFS Pinning — client (Pinata / web3.storage / Infura)
// ---------------------------------------------------------------------------

import type {
  IPFSConfig,
  IPFSHttpClient,
  PinMetadata,
  PinResult,
} from "./types.js";

const PINATA_BASE_URL = "https://api.pinata.cloud";
const W3S_BASE_URL = "https://api.web3.storage";
const INFURA_BASE_URL = "https://ipfs.infura.io:5001/api/v0";
const DEFAULT_TIMEOUT_MS = 30_000;

const defaultHttpClient: IPFSHttpClient = {
  fetch: (url, init) => globalThis.fetch(url, init),
};

/**
 * IPFS pinning client supporting Pinata, web3.storage, and Infura.
 *
 * Provides a unified interface for pinning JSON data to IPFS and
 * retrieving it by CID. Used to anchor full compliance reports
 * alongside on-chain EAS attestations.
 *
 * Usage:
 * ```ts
 * import { IPFSClient } from "@prooflink/integrations/ipfs";
 *
 * const client = new IPFSClient({
 *   gateway: "https://gateway.pinata.cloud/ipfs",
 *   pinningService: "pinata",
 *   apiKey: process.env.PINATA_JWT!,
 * });
 *
 * const result = await client.pin({ report: "..." }, "compliance-report");
 * const data = await client.get<MyType>(result.cid);
 * ```
 */
export class IPFSClient {
  private readonly config: IPFSConfig;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly http: IPFSHttpClient;

  constructor(config: IPFSConfig, http: IPFSHttpClient = defaultHttpClient) {
    this.config = config;
    this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.http = http;

    switch (config.pinningService) {
      case "pinata":
        this.baseUrl = config.baseUrl ?? PINATA_BASE_URL;
        break;
      case "web3storage":
        this.baseUrl = config.baseUrl ?? W3S_BASE_URL;
        break;
      case "infura":
        this.baseUrl = config.baseUrl ?? INFURA_BASE_URL;
        break;
    }
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Pin a JSON object to IPFS.
   *
   * @param data - JSON-serializable object to pin
   * @param name - Optional human-readable name for the pin
   * @returns PinResult with cid, size, and timestamp
   */
  async pin(data: object, name?: string): Promise<PinResult> {
    const metadata: PinMetadata | undefined = name ? { name } : undefined;

    switch (this.config.pinningService) {
      case "pinata":
        return this.pinToPinata(data, metadata);
      case "web3storage":
        return this.pinToWeb3Storage(data);
      case "infura":
        return this.pinToInfura(data);
    }
  }

  /**
   * Retrieve a JSON object from IPFS by CID.
   *
   * @param cid - Content Identifier
   * @returns The parsed JSON object
   */
  async get<T = unknown>(cid: string): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const url = `${this.config.gateway}/${cid}`;
      const response = await this.http.fetch(url, {
        method: "GET",
        headers: { Accept: "application/json" },
        signal: controller.signal,
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`IPFS gateway error ${response.status}: ${text}`);
      }

      return (await response.json()) as T;
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Unpin content from the pinning service.
   *
   * @param cid - Content Identifier to unpin
   */
  async unpin(cid: string): Promise<void> {
    switch (this.config.pinningService) {
      case "pinata":
        await this.unpinPinata(cid);
        break;
      case "web3storage":
        await this.unpinW3S(cid);
        break;
      case "infura":
        await this.unpinInfura(cid);
        break;
    }
  }

  /**
   * List all pinned items from the pinning service.
   *
   * @returns Array of PinResult entries
   */
  async list(): Promise<PinResult[]> {
    switch (this.config.pinningService) {
      case "pinata":
        return this.listPinata();
      case "web3storage":
        return this.listW3S();
      case "infura":
        return this.listInfura();
    }
  }

  // -------------------------------------------------------------------------
  // Private — Pinata
  // -------------------------------------------------------------------------

  private async pinToPinata(
    data: object,
    metadata?: PinMetadata,
  ): Promise<PinResult> {
    const body: Record<string, unknown> = {
      pinataContent: data,
    };

    if (metadata) {
      body.pinataMetadata = {
        name: metadata.name,
        keyvalues: metadata.keyvalues,
      };
    }

    const result = await this.request<{
      IpfsHash: string;
      PinSize: number;
      Timestamp: string;
    }>("POST", "/pinning/pinJSONToIPFS", body);

    return {
      cid: result.IpfsHash,
      size: result.PinSize,
      timestamp: result.Timestamp,
    };
  }

  private async unpinPinata(cid: string): Promise<void> {
    await this.request("DELETE", `/pinning/unpin/${encodeURIComponent(cid)}`);
  }

  private async listPinata(): Promise<PinResult[]> {
    const result = await this.request<{
      rows: Array<{
        ipfs_pin_hash: string;
        size: number;
        date_pinned: string;
      }>;
    }>("GET", "/data/pinList?status=pinned&pageLimit=1000");

    return result.rows.map((row) => ({
      cid: row.ipfs_pin_hash,
      size: row.size,
      timestamp: row.date_pinned,
    }));
  }

  // -------------------------------------------------------------------------
  // Private — web3.storage
  // -------------------------------------------------------------------------

  private async pinToWeb3Storage(data: object): Promise<PinResult> {
    const blob = new Blob([JSON.stringify(data)], {
      type: "application/json",
    });

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await this.http.fetch(`${this.baseUrl}/upload`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
        },
        body: blob,
        signal: controller.signal,
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`web3.storage API error ${response.status}: ${text}`);
      }

      const result = (await response.json()) as { cid: string };
      return {
        cid: result.cid,
        size: blob.size,
        timestamp: new Date().toISOString(),
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  private async unpinW3S(cid: string): Promise<void> {
    await this.request("DELETE", `/pins/${encodeURIComponent(cid)}`);
  }

  private async listW3S(): Promise<PinResult[]> {
    const result = await this.request<{
      results: Array<{
        cid: string;
        created: string;
        pins: Array<{ status: string }>;
      }>;
    }>("GET", "/user/uploads?size=1000");

    return result.results.map((item) => ({
      cid: item.cid,
      size: 0, // web3.storage doesn't return size in list
      timestamp: item.created,
    }));
  }

  // -------------------------------------------------------------------------
  // Private — Infura
  // -------------------------------------------------------------------------

  private async pinToInfura(data: object): Promise<PinResult> {
    const json = JSON.stringify(data);
    const blob = new Blob([json], { type: "application/json" });
    const formData = new FormData();
    formData.append("file", blob, "data.json");

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const auth = btoa(`${this.config.apiKey}:${this.config.apiSecret ?? ""}`);
      const response = await this.http.fetch(`${this.baseUrl}/add?pin=true`, {
        method: "POST",
        headers: {
          Authorization: `Basic ${auth}`,
        },
        body: formData,
        signal: controller.signal,
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Infura IPFS API error ${response.status}: ${text}`);
      }

      const result = (await response.json()) as {
        Hash: string;
        Size: string;
      };

      return {
        cid: result.Hash,
        size: parseInt(result.Size, 10),
        timestamp: new Date().toISOString(),
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  private async unpinInfura(cid: string): Promise<void> {
    const auth = btoa(`${this.config.apiKey}:${this.config.apiSecret ?? ""}`);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await this.http.fetch(
        `${this.baseUrl}/pin/rm?arg=${encodeURIComponent(cid)}`,
        {
          method: "POST",
          headers: { Authorization: `Basic ${auth}` },
          signal: controller.signal,
        },
      );

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Infura IPFS unpin error ${response.status}: ${text}`);
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  private async listInfura(): Promise<PinResult[]> {
    const auth = btoa(`${this.config.apiKey}:${this.config.apiSecret ?? ""}`);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await this.http.fetch(`${this.baseUrl}/pin/ls?type=recursive`, {
        method: "POST",
        headers: { Authorization: `Basic ${auth}` },
        signal: controller.signal,
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Infura IPFS list error ${response.status}: ${text}`);
      }

      const result = (await response.json()) as {
        Keys: Record<string, { Type: string }>;
      };

      return Object.keys(result.Keys).map((cid) => ({
        cid,
        size: 0,
        timestamp: new Date().toISOString(),
      }));
    } finally {
      clearTimeout(timeout);
    }
  }

  // -------------------------------------------------------------------------
  // Private — HTTP (for Pinata / web3.storage standard REST)
  // -------------------------------------------------------------------------

  private async request<T = unknown>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const url = `${this.baseUrl}${path}`;
      const headers: Record<string, string> = {
        Accept: "application/json",
        Authorization: `Bearer ${this.config.apiKey}`,
      };

      if (body) {
        headers["Content-Type"] = "application/json";
      }

      const response = await this.http.fetch(url, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`IPFS API error ${response.status}: ${text}`);
      }

      // DELETE responses may have no body
      if (method === "DELETE") {
        return undefined as T;
      }

      return (await response.json()) as T;
    } finally {
      clearTimeout(timeout);
    }
  }
}
