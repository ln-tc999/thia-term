import { describe, it, expect } from "vitest";
import {
  isValidEvmAddress,
  isValidSolanaAddress,
  isValidAddress,
  toAddress,
  EvmAddressSchema,
  SolanaAddressSchema,
  BlockchainAddressSchema,
  parseAmount,
  formatAmount,
  getCAIP2ChainId,
  getEvmChainId,
  isSupportedChain,
  isValidDID,
  DIDSchema,
  CountryCodeSchema,
  isValidCountryCode,
  TOKEN_DECIMALS,
} from "../utils/validation.js";

// ---------------------------------------------------------------------------
// isValidEvmAddress
// ---------------------------------------------------------------------------

describe("isValidEvmAddress", () => {
  it("accepts a lowercase checksummed EVM address", () => {
    expect(
      isValidEvmAddress("0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045"),
    ).toBe(true);
  });

  it("accepts a fully lowercase address", () => {
    expect(
      isValidEvmAddress("0xabcdef1234567890abcdef1234567890abcdef12"),
    ).toBe(true);
  });

  it("accepts an all-uppercase address", () => {
    expect(
      isValidEvmAddress("0xABCDEF1234567890ABCDEF1234567890ABCDEF12"),
    ).toBe(true);
  });

  it("accepts zero address", () => {
    expect(isValidEvmAddress("0x0000000000000000000000000000000000000000")).toBe(true);
  });

  it("rejects address without 0x prefix", () => {
    expect(
      isValidEvmAddress("d8dA6BF26964aF9D7eEd9e03E53415D37aA96045"),
    ).toBe(false);
  });

  it("rejects address with fewer than 40 hex chars", () => {
    expect(isValidEvmAddress("0xabcdef")).toBe(false);
  });

  it("rejects address with more than 40 hex chars", () => {
    expect(
      isValidEvmAddress("0xabcdef1234567890abcdef1234567890abcdef1234"),
    ).toBe(false);
  });

  it("rejects address with non-hex characters", () => {
    expect(
      isValidEvmAddress("0xGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGG"),
    ).toBe(false);
  });

  it("rejects empty string", () => {
    expect(isValidEvmAddress("")).toBe(false);
  });

  it("rejects 0x prefix only", () => {
    expect(isValidEvmAddress("0x")).toBe(false);
  });

  it("rejects address with spaces", () => {
    expect(isValidEvmAddress("0xabcdef1234567890abcdef1234567890 bcdef12")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// isValidSolanaAddress
// ---------------------------------------------------------------------------

describe("isValidSolanaAddress", () => {
  it("accepts a valid Solana base58 address (44 chars)", () => {
    expect(
      isValidSolanaAddress("7nYNcAthVZnGGJEf6u7WKnQCLwiY1CJasRqfxpMgHE2T"),
    ).toBe(true);
  });

  it("accepts a valid 32-char Solana address", () => {
    expect(
      isValidSolanaAddress("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEG"),
    ).toBe(true);
  });

  it("accepts a valid 44-char mainnet USDC address", () => {
    expect(
      isValidSolanaAddress("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"),
    ).toBe(true);
  });

  it("rejects an EVM address", () => {
    expect(
      isValidSolanaAddress("0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045"),
    ).toBe(false);
  });

  it("rejects a string containing base58 confusables (0, O, I, l)", () => {
    // base58 excludes 0, O, I, l
    expect(isValidSolanaAddress("0OIl" + "A".repeat(28))).toBe(false);
  });

  it("rejects an address shorter than 32 chars", () => {
    expect(isValidSolanaAddress("7nYN")).toBe(false);
  });

  it("rejects empty string", () => {
    expect(isValidSolanaAddress("")).toBe(false);
  });

  it("rejects address longer than 44 chars", () => {
    // 45 valid base58 chars — exceeds max
    expect(isValidSolanaAddress("7nYNcAthVZnGGJEf6u7WKnQCLwiY1CJasRqfxpMgHE2Tx")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// isValidAddress (multi-chain)
// ---------------------------------------------------------------------------

describe("isValidAddress", () => {
  const validEvmAddr = "0xabcdef1234567890abcdef1234567890abcdef12";
  const validSolanaAddr = "7nYNcAthVZnGGJEf6u7WKnQCLwiY1CJasRqfxpMgHE2T";

  it("validates EVM address for ethereum", () => {
    expect(isValidAddress(validEvmAddr, "ethereum")).toBe(true);
  });

  it("validates EVM address for base", () => {
    expect(isValidAddress(validEvmAddr, "base")).toBe(true);
  });

  it("validates EVM address for polygon", () => {
    expect(isValidAddress(validEvmAddr, "polygon")).toBe(true);
  });

  it("validates EVM address for arbitrum", () => {
    expect(isValidAddress(validEvmAddr, "arbitrum")).toBe(true);
  });

  it("validates Solana address for solana chain", () => {
    expect(isValidAddress(validSolanaAddr, "solana")).toBe(true);
  });

  it("rejects Solana address for ethereum chain", () => {
    expect(isValidAddress(validSolanaAddr, "ethereum")).toBe(false);
  });

  it("rejects EVM address for solana chain", () => {
    expect(isValidAddress(validEvmAddr, "solana")).toBe(false);
  });

  it("rejects invalid EVM address for ethereum", () => {
    expect(isValidAddress("0xinvalid", "ethereum")).toBe(false);
  });

  it("rejects empty string for any chain", () => {
    for (const chain of ["ethereum", "base", "polygon", "arbitrum", "solana"] as const) {
      expect(isValidAddress("", chain)).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// toAddress
// ---------------------------------------------------------------------------

describe("toAddress", () => {
  it("returns the address as-is when valid", () => {
    const addr = "0xabcdef1234567890abcdef1234567890abcdef12";
    expect(toAddress(addr, "ethereum")).toBe(addr);
  });

  it("throws on invalid address", () => {
    expect(() => toAddress("0xinvalid", "ethereum")).toThrow();
  });

  it("throws on empty string", () => {
    expect(() => toAddress("", "ethereum")).toThrow();
  });

  it("throws on solana address for ethereum chain", () => {
    expect(() =>
      toAddress("7nYNcAthVZnGGJEf6u7WKnQCLwiY1CJasRqfxpMgHE2T", "ethereum"),
    ).toThrow();
  });

  it("accepts valid solana address for solana chain", () => {
    const addr = "7nYNcAthVZnGGJEf6u7WKnQCLwiY1CJasRqfxpMgHE2T";
    expect(toAddress(addr, "solana")).toBe(addr);
  });

  it("error message contains the invalid address", () => {
    let caught: Error | null = null;
    try {
      toAddress("0xbad", "ethereum");
    } catch (e) {
      caught = e as Error;
    }
    expect(caught).not.toBeNull();
    expect(caught!.message).toContain("0xbad");
    expect(caught!.message).toContain("ethereum");
  });
});

// ---------------------------------------------------------------------------
// EvmAddressSchema
// ---------------------------------------------------------------------------

describe("EvmAddressSchema", () => {
  it("parses a valid address", () => {
    const addr = "0xabcdef1234567890abcdef1234567890abcdef12";
    expect(EvmAddressSchema.parse(addr)).toBe(addr);
  });

  it("throws ZodError on invalid address", () => {
    expect(() => EvmAddressSchema.parse("not-an-address")).toThrow();
  });

  it("throws ZodError on empty string", () => {
    expect(() => EvmAddressSchema.parse("")).toThrow();
  });

  it("throws ZodError on Solana address", () => {
    expect(() =>
      EvmAddressSchema.parse("7nYNcAthVZnGGJEf6u7WKnQCLwiY1CJasRqfxpMgHE2T"),
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// SolanaAddressSchema
// ---------------------------------------------------------------------------

describe("SolanaAddressSchema", () => {
  it("parses a valid Solana address", () => {
    const addr = "7nYNcAthVZnGGJEf6u7WKnQCLwiY1CJasRqfxpMgHE2T";
    expect(SolanaAddressSchema.parse(addr)).toBe(addr);
  });

  it("throws ZodError on invalid Solana address", () => {
    expect(() => SolanaAddressSchema.parse("0xinvalid")).toThrow();
  });

  it("throws ZodError on too-short address", () => {
    expect(() => SolanaAddressSchema.parse("ABC")).toThrow();
  });
});

// ---------------------------------------------------------------------------
// BlockchainAddressSchema (union)
// ---------------------------------------------------------------------------

describe("BlockchainAddressSchema", () => {
  it("accepts a valid EVM address", () => {
    const addr = "0xabcdef1234567890abcdef1234567890abcdef12";
    expect(BlockchainAddressSchema.parse(addr)).toBe(addr);
  });

  it("accepts a valid Solana address", () => {
    const addr = "7nYNcAthVZnGGJEf6u7WKnQCLwiY1CJasRqfxpMgHE2T";
    expect(BlockchainAddressSchema.parse(addr)).toBe(addr);
  });

  it("rejects an address that is neither EVM nor Solana", () => {
    expect(() => BlockchainAddressSchema.parse("not_an_address")).toThrow();
  });
});

// ---------------------------------------------------------------------------
// parseAmount
// ---------------------------------------------------------------------------

describe("parseAmount", () => {
  it("parses whole number USDC amount (6 decimals)", () => {
    expect(parseAmount("100", 6)).toBe(100_000_000n);
  });

  it("parses decimal USDC amount", () => {
    expect(parseAmount("1.5", 6)).toBe(1_500_000n);
  });

  it("parses maximum precision USDC amount", () => {
    expect(parseAmount("0.000001", 6)).toBe(1n);
  });

  it("parses zero", () => {
    expect(parseAmount("0", 6)).toBe(0n);
  });

  it("parses zero with decimals", () => {
    expect(parseAmount("0.000000", 6)).toBe(0n);
  });

  it("throws when amount has more decimals than allowed", () => {
    expect(() => parseAmount("1.0000001", 6)).toThrow();
  });

  it("parses ETH amount (18 decimals)", () => {
    expect(parseAmount("1", 18)).toBe(1_000_000_000_000_000_000n);
  });

  it("parses SOL amount (9 decimals)", () => {
    expect(parseAmount("1.5", 9)).toBe(1_500_000_000n);
  });

  it("parses large whole-number amount", () => {
    expect(parseAmount("1000000", 6)).toBe(1_000_000_000_000n);
  });

  it("pads fractional part to full decimals width", () => {
    // "1.5" with 6 decimals → 1.500000 → 1500000 base units
    expect(parseAmount("1.5", 6)).toBe(1_500_000n);
  });

  it("allows exact decimal precision", () => {
    // exactly 6 decimal places for 6-decimal token
    expect(parseAmount("1.123456", 6)).toBe(1_123_456n);
  });

  it("throws for 7 decimal places with 6-decimal token", () => {
    expect(() => parseAmount("1.1234567", 6)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// formatAmount
// ---------------------------------------------------------------------------

describe("formatAmount", () => {
  it("formats whole number base units back to string", () => {
    expect(formatAmount(100_000_000n, 6)).toBe("100");
  });

  it("formats decimal base units to string", () => {
    expect(formatAmount(1_500_000n, 6)).toBe("1.5");
  });

  it("formats minimum unit (1 base unit)", () => {
    expect(formatAmount(1n, 6)).toBe("0.000001");
  });

  it("formats zero", () => {
    expect(formatAmount(0n, 6)).toBe("0");
  });

  it("round-trips parseAmount and formatAmount", () => {
    const amounts = ["1.5", "100", "0.000001", "9999.999999"];
    for (const a of amounts) {
      expect(formatAmount(parseAmount(a, 6), 6)).toBe(a);
    }
  });

  it("strips trailing zeros in fractional part", () => {
    // 1.500000 -> "1.5"
    expect(formatAmount(1_500_000n, 6)).toBe("1.5");
  });

  it("handles ETH (18 decimals)", () => {
    expect(formatAmount(1_500_000_000_000_000_000n, 18)).toBe("1.5");
  });

  it("formats large amounts correctly", () => {
    expect(formatAmount(1_000_000_000_000n, 6)).toBe("1000000");
  });

  it("formats amounts with all decimal digits", () => {
    expect(formatAmount(1_123_456n, 6)).toBe("1.123456");
  });
});

// ---------------------------------------------------------------------------
// TOKEN_DECIMALS
// ---------------------------------------------------------------------------

describe("TOKEN_DECIMALS", () => {
  it("USDC has 6 decimals", () => {
    expect(TOKEN_DECIMALS.USDC).toBe(6);
  });

  it("USDT has 6 decimals", () => {
    expect(TOKEN_DECIMALS.USDT).toBe(6);
  });

  it("EURC has 6 decimals", () => {
    expect(TOKEN_DECIMALS.EURC).toBe(6);
  });

  it("ETH has 18 decimals", () => {
    expect(TOKEN_DECIMALS.ETH).toBe(18);
  });

  it("SOL has 9 decimals", () => {
    expect(TOKEN_DECIMALS.SOL).toBe(9);
  });
});

// ---------------------------------------------------------------------------
// getCAIP2ChainId
// ---------------------------------------------------------------------------

describe("getCAIP2ChainId", () => {
  it("returns mainnet CAIP-2 for ethereum", () => {
    expect(getCAIP2ChainId("ethereum")).toBe("eip155:1");
  });

  it("returns mainnet CAIP-2 for base", () => {
    expect(getCAIP2ChainId("base")).toBe("eip155:8453");
  });

  it("returns mainnet CAIP-2 for polygon", () => {
    expect(getCAIP2ChainId("polygon")).toBe("eip155:137");
  });

  it("returns mainnet CAIP-2 for arbitrum", () => {
    expect(getCAIP2ChainId("arbitrum")).toBe("eip155:42161");
  });

  it("returns mainnet CAIP-2 for solana", () => {
    expect(getCAIP2ChainId("solana")).toBe(
      "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
    );
  });

  it("returns testnet CAIP-2 for ethereum when testnet=true", () => {
    expect(getCAIP2ChainId("ethereum", true)).toBe("eip155:11155111");
  });

  it("returns testnet CAIP-2 for base when testnet=true", () => {
    expect(getCAIP2ChainId("base", true)).toBe("eip155:84532");
  });

  it("returns testnet CAIP-2 for polygon (Amoy) when testnet=true", () => {
    expect(getCAIP2ChainId("polygon", true)).toBe("eip155:80002");
  });

  it("returns testnet CAIP-2 for arbitrum (Sepolia) when testnet=true", () => {
    expect(getCAIP2ChainId("arbitrum", true)).toBe("eip155:421614");
  });

  it("returns devnet CAIP-2 for solana when testnet=true", () => {
    expect(getCAIP2ChainId("solana", true)).toBe(
      "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1",
    );
  });

  it("mainnet and testnet CAIP-2 differ for all EVM chains", () => {
    for (const chain of ["ethereum", "base", "polygon", "arbitrum"] as const) {
      expect(getCAIP2ChainId(chain)).not.toBe(getCAIP2ChainId(chain, true));
    }
  });
});

// ---------------------------------------------------------------------------
// getEvmChainId
// ---------------------------------------------------------------------------

describe("getEvmChainId", () => {
  it("returns 1 for ethereum mainnet", () => {
    expect(getEvmChainId("ethereum")).toBe(1);
  });

  it("returns 8453 for base mainnet", () => {
    expect(getEvmChainId("base")).toBe(8453);
  });

  it("returns 137 for polygon mainnet", () => {
    expect(getEvmChainId("polygon")).toBe(137);
  });

  it("returns 42161 for arbitrum mainnet", () => {
    expect(getEvmChainId("arbitrum")).toBe(42161);
  });

  it("returns undefined for solana", () => {
    expect(getEvmChainId("solana")).toBeUndefined();
  });

  it("returns Sepolia chain id for ethereum testnet", () => {
    expect(getEvmChainId("ethereum", true)).toBe(11155111);
  });

  it("returns Base Sepolia chain id for base testnet", () => {
    expect(getEvmChainId("base", true)).toBe(84532);
  });

  it("returns Amoy chain id for polygon testnet", () => {
    expect(getEvmChainId("polygon", true)).toBe(80002);
  });

  it("returns Arbitrum Sepolia chain id for arbitrum testnet", () => {
    expect(getEvmChainId("arbitrum", true)).toBe(421614);
  });

  it("mainnet and testnet chain IDs differ for all EVM chains", () => {
    for (const chain of ["ethereum", "base", "polygon", "arbitrum"] as const) {
      expect(getEvmChainId(chain)).not.toBe(getEvmChainId(chain, true));
    }
  });
});

// ---------------------------------------------------------------------------
// isSupportedChain
// ---------------------------------------------------------------------------

describe("isSupportedChain", () => {
  it("returns true for all supported chains", () => {
    for (const chain of ["ethereum", "base", "polygon", "arbitrum", "solana"]) {
      expect(isSupportedChain(chain)).toBe(true);
    }
  });

  it("returns false for unsupported chains", () => {
    expect(isSupportedChain("avalanche")).toBe(false);
    expect(isSupportedChain("bsc")).toBe(false);
    expect(isSupportedChain("")).toBe(false);
    expect(isSupportedChain("ETHEREUM")).toBe(false); // case-sensitive
  });

  it("returns false for numeric strings", () => {
    expect(isSupportedChain("1")).toBe(false);
    expect(isSupportedChain("8453")).toBe(false);
  });

  it("returns false for CAIP-2 format strings", () => {
    expect(isSupportedChain("eip155:1")).toBe(false);
    expect(isSupportedChain("eip155:8453")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// isValidDID
// ---------------------------------------------------------------------------

describe("isValidDID", () => {
  it("accepts did:ethr:0x... format", () => {
    expect(isValidDID("did:ethr:0xABCDEF1234567890ABCDEF")).toBe(true);
  });

  it("accepts did:prooflink:agent_001 format", () => {
    expect(isValidDID("did:prooflink:agent_001")).toBe(true);
  });

  it("accepts did:web:example.com format", () => {
    expect(isValidDID("did:web:example.com")).toBe(true);
  });

  it("accepts did:key:z6Mkk format", () => {
    expect(isValidDID("did:key:z6MkkMGxByRFAD")).toBe(true);
  });

  it("accepts did with path segments", () => {
    expect(isValidDID("did:web:example.com:user:alice")).toBe(true);
  });

  it("rejects DID without did: prefix", () => {
    expect(isValidDID("ethr:0xABCDEF")).toBe(false);
  });

  it("rejects DID with method containing uppercase", () => {
    // DID method must be lowercase per spec
    expect(isValidDID("did:ETHR:0xABCDEF")).toBe(false);
  });

  it("rejects empty string", () => {
    expect(isValidDID("")).toBe(false);
  });

  it("rejects DID with only prefix and colon", () => {
    expect(isValidDID("did:")).toBe(false);
  });

  it("rejects DID with only method and no identifier", () => {
    expect(isValidDID("did:web:")).toBe(false);
  });

  it("rejects non-DID strings", () => {
    expect(isValidDID("https://example.com")).toBe(false);
    expect(isValidDID("0xAbCdEf")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// DIDSchema
// ---------------------------------------------------------------------------

describe("DIDSchema", () => {
  it("parses a valid DID", () => {
    const did = "did:prooflink:issuer";
    expect(DIDSchema.parse(did)).toBe(did);
  });

  it("throws on invalid DID", () => {
    expect(() => DIDSchema.parse("not-a-did")).toThrow();
  });

  it("throws on empty string", () => {
    expect(() => DIDSchema.parse("")).toThrow();
  });

  it("throws on DID with uppercase method", () => {
    expect(() => DIDSchema.parse("did:WEB:example.com")).toThrow();
  });
});

// ---------------------------------------------------------------------------
// CountryCodeSchema / isValidCountryCode
// ---------------------------------------------------------------------------

describe("CountryCodeSchema", () => {
  it("accepts valid ISO 3166-1 alpha-2 codes", () => {
    for (const code of ["US", "GB", "DE", "SG", "JP", "KR", "FR", "CN", "AU", "CA"]) {
      expect(CountryCodeSchema.parse(code)).toBe(code);
    }
  });

  it("rejects lowercase codes", () => {
    expect(() => CountryCodeSchema.parse("us")).toThrow();
    expect(() => CountryCodeSchema.parse("gb")).toThrow();
  });

  it("rejects 3-letter codes", () => {
    expect(() => CountryCodeSchema.parse("USA")).toThrow();
    expect(() => CountryCodeSchema.parse("GBR")).toThrow();
  });

  it("rejects numeric codes", () => {
    expect(() => CountryCodeSchema.parse("12")).toThrow();
  });

  it("rejects 1-letter codes", () => {
    expect(() => CountryCodeSchema.parse("U")).toThrow();
  });

  it("rejects empty string", () => {
    expect(() => CountryCodeSchema.parse("")).toThrow();
  });

  it("rejects codes with non-alphabetic characters", () => {
    expect(() => CountryCodeSchema.parse("U1")).toThrow();
    expect(() => CountryCodeSchema.parse("U-")).toThrow();
  });
});

describe("isValidCountryCode", () => {
  it("returns true for valid uppercase 2-letter codes", () => {
    expect(isValidCountryCode("US")).toBe(true);
    expect(isValidCountryCode("KR")).toBe(true);
    expect(isValidCountryCode("IR")).toBe(true); // sanctioned country
    expect(isValidCountryCode("KP")).toBe(true); // North Korea
  });

  it("returns false for invalid codes", () => {
    expect(isValidCountryCode("us")).toBe(false);
    expect(isValidCountryCode("USA")).toBe(false);
    expect(isValidCountryCode("1")).toBe(false);
    expect(isValidCountryCode("")).toBe(false);
    expect(isValidCountryCode("A1")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Amount parsing edge cases: boundary and cross-decimal tests
// ---------------------------------------------------------------------------

describe("parseAmount and formatAmount — boundary and cross-decimal", () => {
  it("round-trips for all supported tokens at their native decimals", () => {
    const cases: Array<[string, number]> = [
      ["100.000000", 6],   // USDC/USDT/EURC
      ["1.500000000", 9],  // SOL
      ["1.500000000000000000", 18], // ETH
    ];
    for (const [amount, decimals] of cases) {
      const baseUnits = parseAmount(amount, decimals);
      const formatted = formatAmount(baseUnits, decimals);
      // Allow trailing zero stripping
      expect(parseAmount(formatted, decimals)).toBe(baseUnits);
    }
  });

  it("fractional part shorter than decimals is padded", () => {
    // "1.5" with 6 decimals pads to 1.500000
    expect(parseAmount("1.5", 6)).toBe(1_500_000n);
  });

  it("whole-number string with no dot works", () => {
    expect(parseAmount("42", 6)).toBe(42_000_000n);
  });

  it("0.0 parses to 0n", () => {
    expect(parseAmount("0.0", 6)).toBe(0n);
  });
});
