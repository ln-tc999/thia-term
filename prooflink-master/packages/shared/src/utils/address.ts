/**
 * Extended address utilities for multi-chain wallet validation and normalization.
 *
 * Core validators (isValidEvmAddress, isValidSolanaAddress, isValidAddress, toAddress)
 * live in validation.ts. This module provides additional helpers.
 */

import type { SupportedChain } from "../types/protocol.js";
import { isValidEvmAddress, isValidSolanaAddress } from "./validation.js";

// ---------------------------------------------------------------------------
// Additional chain address regexes
// ---------------------------------------------------------------------------

const BITCOIN_P2PKH_REGEX = /^[13][a-km-zA-HJ-NP-Z1-9]{25,34}$/;
const BITCOIN_BECH32_REGEX = /^bc1[a-zA-HJ-NP-Z0-9]{25,90}$/;

// ---------------------------------------------------------------------------
// Bitcoin validator
// ---------------------------------------------------------------------------

export function isValidBitcoinAddress(address: string): boolean {
  return BITCOIN_P2PKH_REGEX.test(address) || BITCOIN_BECH32_REGEX.test(address);
}

// ---------------------------------------------------------------------------
// Normalization
// ---------------------------------------------------------------------------

/** Normalize an EVM address to lowercase. */
export function normalizeEvmAddress(address: string): string {
  if (!isValidEvmAddress(address)) {
    throw new Error(`Invalid EVM address: ${address}`);
  }
  return address.toLowerCase();
}

/** Normalize address based on chain conventions. */
export function normalizeAddress(address: string, chain: SupportedChain): string {
  // EVM chains: lowercase normalization
  if (chain !== "solana") {
    if (!isValidEvmAddress(address)) {
      throw new Error(`Invalid ${chain} address: ${address}`);
    }
    return address.toLowerCase();
  }

  // Solana: case-sensitive base58, validate only
  if (!isValidSolanaAddress(address)) {
    throw new Error(`Invalid solana address: ${address}`);
  }
  return address;
}

// ---------------------------------------------------------------------------
// Address truncation (for display)
// ---------------------------------------------------------------------------

/** Truncate address for display: 0x1234...abcd */
export function truncateAddress(address: string, prefixLen = 6, suffixLen = 4): string {
  if (address.length <= prefixLen + suffixLen) {
    return address;
  }
  return `${address.slice(0, prefixLen)}...${address.slice(-suffixLen)}`;
}

// ---------------------------------------------------------------------------
// Chain detection from address format
// ---------------------------------------------------------------------------

/** Best-effort detection of chain type from address format. */
export function detectAddressChain(address: string): "evm" | "solana" | "bitcoin" | "unknown" {
  if (isValidEvmAddress(address)) return "evm";
  if (isValidSolanaAddress(address)) return "solana";
  if (isValidBitcoinAddress(address)) return "bitcoin";
  return "unknown";
}
