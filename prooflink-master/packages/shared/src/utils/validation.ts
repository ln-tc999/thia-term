import { z } from "zod";
import type { Address, CAIP2ChainId, SupportedToken } from "../types/protocol.js";
import { CHAIN_IDS, EVM_CHAIN_IDS } from "../constants.js";

// ---------------------------------------------------------------------------
// Address validation
// ---------------------------------------------------------------------------

const EVM_ADDRESS_REGEX = /^0x[0-9a-fA-F]{40}$/;
const SOLANA_ADDRESS_REGEX = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/** Validate an EVM address (checksummed or lowercase). */
export function isValidEvmAddress(address: string): boolean {
  return EVM_ADDRESS_REGEX.test(address);
}

/** Validate a Solana base58 address. */
export function isValidSolanaAddress(address: string): boolean {
  return SOLANA_ADDRESS_REGEX.test(address);
}

/** Validate a blockchain address for a given chain. */
export function isValidAddress(
  address: string,
  chain: "ethereum" | "base" | "polygon" | "arbitrum" | "solana",
): boolean {
  if (chain === "solana") {
    return isValidSolanaAddress(address);
  }
  return isValidEvmAddress(address);
}

/** Cast a validated string to the branded Address type. Throws on invalid. */
export function toAddress(
  address: string,
  chain: "ethereum" | "base" | "polygon" | "arbitrum" | "solana",
): Address {
  if (!isValidAddress(address, chain)) {
    throw new Error(
      `Invalid ${chain} address: ${address}`,
    );
  }
  return address as Address;
}

// ---------------------------------------------------------------------------
// Zod schemas for addresses
// ---------------------------------------------------------------------------

export const EvmAddressSchema = z
  .string()
  .regex(EVM_ADDRESS_REGEX, "Invalid EVM address");

export const SolanaAddressSchema = z
  .string()
  .regex(SOLANA_ADDRESS_REGEX, "Invalid Solana address");

export const BlockchainAddressSchema = z.union([
  EvmAddressSchema,
  SolanaAddressSchema,
]);

// ---------------------------------------------------------------------------
// Amount parsing
// ---------------------------------------------------------------------------

/**
 * Parse a decimal amount string to the smallest unit (e.g., USDC has 6 decimals).
 * Returns a bigint representing base units.
 */
export function parseAmount(amount: string, decimals: number): bigint {
  const parts = amount.split(".");
  const whole = parts[0] ?? "0";
  let fractional = parts[1] ?? "";

  if (fractional.length > decimals) {
    throw new Error(
      `Amount ${amount} has more than ${decimals} decimal places`,
    );
  }

  fractional = fractional.padEnd(decimals, "0");
  return BigInt(whole) * BigInt(10 ** decimals) + BigInt(fractional);
}

/**
 * Format a base unit bigint amount to a human-readable decimal string.
 */
export function formatAmount(baseUnits: bigint, decimals: number): string {
  const divisor = BigInt(10 ** decimals);
  const whole = baseUnits / divisor;
  const fractional = baseUnits % divisor;

  if (fractional === 0n) {
    return whole.toString();
  }

  const fractionalStr = fractional.toString().padStart(decimals, "0").replace(/0+$/, "");
  return `${whole}.${fractionalStr}`;
}

/** Token decimal places, keyed by SupportedToken. */
export const TOKEN_DECIMALS: Record<SupportedToken, number> = {
  USDC: 6,
  USDT: 6,
  EURC: 6,
  ETH: 18,
  SOL: 9,
};

// ---------------------------------------------------------------------------
// Chain ID helpers
// ---------------------------------------------------------------------------

/** Get the CAIP-2 chain ID for a named chain. */
export function getCAIP2ChainId(
  chain: "ethereum" | "base" | "polygon" | "arbitrum" | "solana",
  testnet = false,
): CAIP2ChainId {
  const map: Record<string, string> = testnet
    ? {
        ethereum: CHAIN_IDS.ETHEREUM_SEPOLIA,
        base: CHAIN_IDS.BASE_SEPOLIA,
        polygon: CHAIN_IDS.POLYGON_AMOY,
        arbitrum: CHAIN_IDS.ARBITRUM_SEPOLIA,
        solana: CHAIN_IDS.SOLANA_DEVNET,
      }
    : {
        ethereum: CHAIN_IDS.ETHEREUM_MAINNET,
        base: CHAIN_IDS.BASE_MAINNET,
        polygon: CHAIN_IDS.POLYGON_MAINNET,
        arbitrum: CHAIN_IDS.ARBITRUM_MAINNET,
        solana: CHAIN_IDS.SOLANA_MAINNET,
      };

  const id = map[chain];
  if (!id) {
    throw new Error(`Unknown chain: ${chain}`);
  }
  return id as CAIP2ChainId;
}

/** Get the numeric EVM chain ID. Returns undefined for non-EVM chains. */
export function getEvmChainId(
  chain: "ethereum" | "base" | "polygon" | "arbitrum" | "solana",
  testnet = false,
): number | undefined {
  if (chain === "solana") return undefined;

  // Polygon's testnet is "POLYGON_AMOY", not "POLYGON_SEPOLIA", so we use an
  // explicit lookup instead of a mechanical string template.
  const lookup: Record<string, keyof typeof EVM_CHAIN_IDS> = testnet
    ? {
        ethereum: "ETHEREUM_SEPOLIA",
        base: "BASE_SEPOLIA",
        polygon: "POLYGON_AMOY",
        arbitrum: "ARBITRUM_SEPOLIA",
      }
    : {
        ethereum: "ETHEREUM_MAINNET",
        base: "BASE_MAINNET",
        polygon: "POLYGON_MAINNET",
        arbitrum: "ARBITRUM_MAINNET",
      };

  const chainKey = lookup[chain];
  if (!chainKey) return undefined;
  return EVM_CHAIN_IDS[chainKey];
}

/** Check if a chain name is a supported chain. */
export function isSupportedChain(
  chain: string,
): chain is "ethereum" | "base" | "polygon" | "arbitrum" | "solana" {
  return ["ethereum", "base", "polygon", "arbitrum", "solana"].includes(chain);
}

// ---------------------------------------------------------------------------
// DID validation
// ---------------------------------------------------------------------------

const DID_REGEX = /^did:[a-z]+:[a-zA-Z0-9._:%-]+$/;

export function isValidDID(did: string): boolean {
  return DID_REGEX.test(did);
}

export const DIDSchema = z.string().regex(DID_REGEX, "Invalid DID format");

// ---------------------------------------------------------------------------
// ISO 3166-1 alpha-2 country code
// ---------------------------------------------------------------------------

const ISO3166_REGEX = /^[A-Z]{2}$/;

export const CountryCodeSchema = z
  .string()
  .regex(ISO3166_REGEX, "Invalid ISO 3166-1 alpha-2 country code");

export function isValidCountryCode(code: string): boolean {
  return ISO3166_REGEX.test(code);
}
