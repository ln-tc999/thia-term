// ---------------------------------------------------------------------------
// IPFS Pinning — types
// ---------------------------------------------------------------------------

/** Supported pinning service providers. */
export type PinningService = "pinata" | "web3storage" | "infura";

/** Configuration for the IPFS pinning client. */
export interface IPFSConfig {
  /** IPFS gateway URL for reading content (e.g., "https://gateway.pinata.cloud/ipfs") */
  gateway: string;
  /** Pinning service provider */
  pinningService: PinningService;
  /** API key / JWT token for the pinning service */
  apiKey: string;
  /** API secret (required for Infura) */
  apiSecret?: string;
  /** Base URL override for the pinning API */
  baseUrl?: string;
  /** Request timeout in milliseconds (default: 30_000) */
  timeoutMs?: number;
}

/** Result of a pin operation. */
export interface PinResult {
  /** Content Identifier (CID) */
  cid: string;
  /** Size in bytes */
  size: number;
  /** ISO 8601 timestamp of pinning */
  timestamp: string;
}

/** Metadata attached to a pinned object. */
export interface PinMetadata {
  name?: string;
  keyvalues?: Record<string, string>;
}

/** Pin status information. */
export interface PinStatus {
  cid: string;
  status: "pinned" | "pinning" | "unpinned" | "failed";
  name?: string;
  size?: number;
  createdAt: string;
}

/** HTTP client interface for IPFS operations (injectable for testing). */
export interface IPFSHttpClient {
  fetch(url: string, init: RequestInit): Promise<Response>;
}
