import type { PaymentPayload, ChainInfo, ChainFamily } from "./types.js";

// ---------------------------------------------------------------------------
// Known chains registry
// ---------------------------------------------------------------------------

const KNOWN_CHAINS: ReadonlyMap<string, ChainInfo> = new Map([
  // EVM chains
  ["eip155:1", { family: "evm", caip2: "eip155:1", name: "Ethereum Mainnet", chainId: 1 }],
  ["eip155:8453", { family: "evm", caip2: "eip155:8453", name: "Base", chainId: 8453 }],
  ["eip155:137", { family: "evm", caip2: "eip155:137", name: "Polygon", chainId: 137 }],
  ["eip155:42161", { family: "evm", caip2: "eip155:42161", name: "Arbitrum One", chainId: 42161 }],
  ["eip155:10", { family: "evm", caip2: "eip155:10", name: "Optimism", chainId: 10 }],
  // Testnets
  ["eip155:11155111", { family: "evm", caip2: "eip155:11155111", name: "Sepolia", chainId: 11155111 }],
  ["eip155:84532", { family: "evm", caip2: "eip155:84532", name: "Base Sepolia", chainId: 84532 }],
  // Solana
  [
    "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
    { family: "solana", caip2: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp", name: "Solana Mainnet" },
  ],
  [
    "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1",
    { family: "solana", caip2: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1", name: "Solana Devnet" },
  ],
]);

/**
 * Get chain info from a CAIP-2 identifier.
 */
export function getChainInfo(caip2: string): ChainInfo | null {
  return KNOWN_CHAINS.get(caip2) ?? null;
}

/**
 * Detect the chain family from a CAIP-2 identifier.
 */
export function detectChainFamily(caip2: string): ChainFamily | null {
  if (caip2.startsWith("eip155:")) return "evm";
  if (caip2.startsWith("solana:")) return "solana";
  return null;
}

/**
 * Get chain ID from CAIP-2 identifier (EVM only).
 */
export function getEvmChainId(caip2: string): number | null {
  if (!caip2.startsWith("eip155:")) return null;
  const id = parseInt(caip2.slice(7), 10);
  return Number.isNaN(id) ? null : id;
}

/**
 * Build a CAIP-2 identifier from chain family and chain ID.
 */
export function buildCaip2(family: ChainFamily, chainId?: number | string): string {
  if (family === "evm") {
    if (chainId === undefined) throw new Error("chainId required for EVM chains");
    return `eip155:${chainId}`;
  }
  if (family === "solana") {
    // Use mainnet genesis hash if no specific reference
    return chainId
      ? `solana:${chainId}`
      : "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";
  }
  throw new Error(`Unsupported chain family: ${family}`);
}

/**
 * List all known chains, optionally filtered by family.
 */
export function listKnownChains(family?: ChainFamily): ChainInfo[] {
  const chains = Array.from(KNOWN_CHAINS.values());
  return family ? chains.filter((c) => c.family === family) : chains;
}

// ---------------------------------------------------------------------------
// Address validation
// ---------------------------------------------------------------------------

const EVM_ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const SOLANA_ADDRESS_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/**
 * Validate an address for a given chain family.
 */
export function validateAddress(address: string, family: ChainFamily): boolean {
  switch (family) {
    case "evm":
      return EVM_ADDRESS_RE.test(address);
    case "solana":
      return SOLANA_ADDRESS_RE.test(address);
    default:
      return false;
  }
}

/**
 * Validate an address for a given CAIP-2 network.
 */
export function validateAddressForNetwork(address: string, network: string): boolean {
  const family = detectChainFamily(network);
  if (!family) return false;
  return validateAddress(address, family);
}

/**
 * Normalize an address based on chain family.
 * EVM: lowercase. Solana: as-is (base58 is case-sensitive).
 */
export function normalizeAddress(address: string, family: ChainFamily): string {
  switch (family) {
    case "evm":
      return address.toLowerCase();
    case "solana":
      return address;
    default:
      return address;
  }
}

// ---------------------------------------------------------------------------
// Address extraction from payment payloads
// ---------------------------------------------------------------------------

/**
 * Registry of chain-specific address extractors.
 * Key is a CAIP-2 prefix pattern (e.g., "eip155:*", "solana:*").
 */
const extractors = new Map<string, (payload: PaymentPayload) => string | null>();

/**
 * Register a custom address extractor for a chain family.
 *
 * @example
 * registerAddressExtractor("aptos:*", (payload) => {
 *   return (payload.payload as { sender: string }).sender;
 * });
 */
export function registerAddressExtractor(
  networkPattern: string,
  extractor: (payload: PaymentPayload) => string | null,
): void {
  extractors.set(networkPattern, extractor);
}

/**
 * Extract the sender wallet address from a PaymentPayload.
 *
 * Supports:
 * - EVM EIP-3009: `authorization.from`
 * - EVM Permit2: `permit2Authorization.from`
 * - Solana: `payload.sender`
 * - Custom chains via `registerAddressExtractor()`
 */
export function extractSenderAddress(payload: PaymentPayload): string | null {
  const inner = payload.payload;

  // Check custom extractors first (exact match, then wildcard)
  for (const [pattern, extractor] of extractors) {
    if (matchNetwork(payload.network, pattern)) {
      const result = extractor(payload);
      if (result) return result;
    }
  }

  // EVM EIP-3009: authorization.from
  if (inner.authorization && typeof inner.authorization === "object") {
    const from = inner.authorization.from;
    if (typeof from === "string" && from.length > 0) return from;
  }

  // EVM Permit2: permit2Authorization.from
  if (inner.permit2Authorization && typeof inner.permit2Authorization === "object") {
    const from = inner.permit2Authorization.from;
    if (typeof from === "string" && from.length > 0) return from;
  }

  // Solana: payload.sender
  if (typeof inner.sender === "string" && inner.sender.length > 0) {
    return inner.sender;
  }

  return null;
}

function matchNetwork(network: string, pattern: string): boolean {
  if (pattern === network) return true;
  if (pattern.endsWith(":*")) {
    const prefix = pattern.slice(0, -2);
    return network.startsWith(prefix + ":");
  }
  return false;
}
