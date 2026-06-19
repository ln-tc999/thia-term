/**
 * Known OFAC SDN sanctioned Ethereum addresses for E2E testing.
 *
 * All addresses are publicly designated by OFAC and published on the SDN list.
 * Sources:
 *   - https://ofac.treasury.gov/specially-designated-nationals-list-data-formats-data-integrity
 *   - https://public.chainalysis.com/api/v1/address/<address>  (free API)
 *
 * These are used ONLY for testing the sanctions screening pipeline.
 * Do NOT send real funds to these addresses.
 */

// ---------------------------------------------------------------------------
// Sanctioned addresses (OFAC SDN list)
// ---------------------------------------------------------------------------

/**
 * Tornado Cash core contract — OFAC designated August 8 2022.
 * SDN entry: TORNADO CASH
 * Category: Blocking Sanctions — Executive Order 13694
 */
export const TORNADO_CASH_ROUTER = "0x905b63Fff465B9fFBF41DeA908CEb12df9d1c960";

/**
 * Tornado Cash 100 ETH pool — OFAC designated August 8 2022.
 * One of the ten primary Tornado Cash smart contracts on the SDN list.
 */
export const TORNADO_CASH_100ETH_POOL = "0xd90e2f925da726b50c4ed8d0fb90ad053324f31b";

/**
 * Tornado Cash 1 ETH pool — OFAC designated August 8 2022.
 */
export const TORNADO_CASH_1ETH_POOL = "0x722122df12d4e14e13ac3b6895a86e84145b6967";

/**
 * Tornado Cash 0.1 ETH pool — OFAC designated August 8 2022.
 */
export const TORNADO_CASH_01ETH_POOL = "0xd4b88df4d29f5cedd6857912842cff3b20c8cfa3";

/**
 * Garantex exchange — OFAC designated April 5 2022.
 * Russian virtual currency exchange used for ransomware proceeds.
 */
export const GARANTEX_EXCHANGE = "0x6acdfba02d390b97ac2b2d42a63e85293bcc160e";

/**
 * Blender.io bitcoin mixer — OFAC designated May 6 2022.
 * First virtual currency mixer sanctioned by OFAC.
 */
export const BLENDER_IO = "0x94c9eb5b4e49faac0e44b7e5ef1f57ce71c0b724";

/**
 * Lazarus Group (DPRK state-sponsored hackers) associated address.
 * OFAC SDN: Democratic People's Republic of Korea
 */
export const LAZARUS_GROUP_1 = "0x098b716b8aaf21512996dc57eb0615e2383e2f96";

/**
 * Lazarus Group associated — linked to Ronin bridge hack ($625M, March 2022).
 */
export const LAZARUS_GROUP_RONIN = "0x098b716b8aaf21512996dc57eb0615e2383e2f96";

/** All sanctioned test addresses as an array for iteration */
export const ALL_SANCTIONED_ADDRESSES: readonly string[] = [
  TORNADO_CASH_ROUTER,
  TORNADO_CASH_100ETH_POOL,
  TORNADO_CASH_1ETH_POOL,
  TORNADO_CASH_01ETH_POOL,
  GARANTEX_EXCHANGE,
  BLENDER_IO,
  LAZARUS_GROUP_1,
];

// ---------------------------------------------------------------------------
// Clean / known-legitimate addresses
// ---------------------------------------------------------------------------

/**
 * Vitalik Buterin's public ENS address (vitalik.eth).
 * Publicly known, frequently used in documentation and demos.
 * Risk: ~0. Not on any sanctions list.
 */
export const VITALIK_ENS_WALLET = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";

/**
 * Coinbase cold wallet (Exchange deposit address — public on-chain).
 * Publicly attributed, extremely high entity reputation.
 */
export const COINBASE_COLD_WALLET = "0x71660c4005BA85c37ccec55d0C4493E66Fe775d3";

/**
 * Uniswap v3: Universal Router — audited, public protocol contract.
 * Not on any sanctions list. Used as a known-clean contract address.
 */
export const UNISWAP_UNIVERSAL_ROUTER = "0x3fC91A3afd70395Cd496C647d5a6CC9D4B2b7FAD";

/**
 * USDC token contract on Ethereum mainnet (Circle's issuer address).
 * Foundational DeFi infrastructure, not on any sanctions list.
 */
export const USDC_CONTRACT_MAINNET = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";

/** All clean test addresses as an array for iteration */
export const ALL_CLEAN_ADDRESSES: readonly string[] = [
  VITALIK_ENS_WALLET,
  COINBASE_COLD_WALLET,
  UNISWAP_UNIVERSAL_ROUTER,
  USDC_CONTRACT_MAINNET,
];

// ---------------------------------------------------------------------------
// Address metadata (for assertions)
// ---------------------------------------------------------------------------

export interface AddressMetadata {
  address: string;
  expectedSanctioned: boolean;
  description: string;
  sdnEntity?: string;
}

export const ADDRESS_METADATA: AddressMetadata[] = [
  {
    address: TORNADO_CASH_ROUTER,
    expectedSanctioned: true,
    description: "Tornado Cash Router",
    sdnEntity: "TORNADO CASH",
  },
  {
    address: TORNADO_CASH_100ETH_POOL,
    expectedSanctioned: true,
    description: "Tornado Cash 100 ETH Pool",
    sdnEntity: "TORNADO CASH",
  },
  {
    address: GARANTEX_EXCHANGE,
    expectedSanctioned: true,
    description: "Garantex Exchange",
    sdnEntity: "GARANTEX",
  },
  {
    address: LAZARUS_GROUP_1,
    expectedSanctioned: true,
    description: "Lazarus Group wallet",
    sdnEntity: "LAZARUS GROUP",
  },
  {
    address: VITALIK_ENS_WALLET,
    expectedSanctioned: false,
    description: "vitalik.eth — known clean address",
  },
  {
    address: COINBASE_COLD_WALLET,
    expectedSanctioned: false,
    description: "Coinbase cold wallet — known clean exchange address",
  },
];
