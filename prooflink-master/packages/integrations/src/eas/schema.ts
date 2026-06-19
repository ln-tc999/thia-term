// ---------------------------------------------------------------------------
// EAS — ProofLink Receipt Schema Definition
// ---------------------------------------------------------------------------
//
// Maps to the architecture spec in architecture/eas_compliance_schema.md.
// Uses the exact Solidity ABI type notation required by EAS SchemaRegistry.
// ---------------------------------------------------------------------------

import type { ComplianceReceipt } from "@prooflink/shared";
import type { AttestationData } from "./types.js";

/**
 * Solidity-style schema string for EAS SchemaRegistry.register().
 *
 * Matches the on-chain ProofLink schema:
 *   bytes32 receiptId, bytes32 paymentTxHash, uint64 chainId,
 *   address payer, address payee, uint128 amount, address token,
 *   bytes32 ipfsContentHash, uint8 riskScore, uint16 sanctionsFlags,
 *   bool travelRuleCompliant, uint8 flowType, bytes32 agentIdHash
 */
export const PROOFLINK_SCHEMA =
  "bytes32 receiptId, bytes32 paymentTxHash, uint64 chainId, address payer, address payee, uint128 amount, address token, bytes32 ipfsContentHash, uint8 riskScore, uint16 sanctionsFlags, bool travelRuleCompliant, uint8 flowType, bytes32 agentIdHash";

/** Human-readable schema name. */
export const PROOFLINK_SCHEMA_NAME = "ProofLink.ProofLink.ComplianceReceipt.v1";

/** Whether the schema allows revocation. */
export const PROOFLINK_SCHEMA_REVOCABLE = true;

/** @deprecated Use PROOFLINK_SCHEMA instead. */
export const PROOFLINK_SCHEMA_DEFINITION = PROOFLINK_SCHEMA;

// ---------------------------------------------------------------------------
// Schema field definitions
// ---------------------------------------------------------------------------

export interface SchemaField {
  name: string;
  type: string;
  description: string;
}

/** Ordered field definitions matching the on-chain schema. */
export const SCHEMA_FIELDS: readonly SchemaField[] = [
  { name: "receiptId", type: "bytes32", description: "keccak256 of payment tx hash + chain ID + timestamp" },
  { name: "paymentTxHash", type: "bytes32", description: "Transaction hash of the settled payment" },
  { name: "chainId", type: "uint64", description: "CAIP-2 chain ID (Base=8453, Ethereum=1)" },
  { name: "payer", type: "address", description: "Wallet address that sent funds" },
  { name: "payee", type: "address", description: "Wallet address that received funds" },
  { name: "amount", type: "uint128", description: "Payment amount in token base units" },
  { name: "token", type: "address", description: "ERC-20 token contract address" },
  { name: "ipfsContentHash", type: "bytes32", description: "IPFS CIDv1 SHA-256 digest of the full compliance report" },
  { name: "riskScore", type: "uint8", description: "Composite AML risk score (0-100)" },
  { name: "sanctionsFlags", type: "uint16", description: "Bitmask of sanctions lists screened and match indicators" },
  { name: "travelRuleCompliant", type: "bool", description: "Whether FATF Travel Rule was satisfied" },
  { name: "flowType", type: "uint8", description: "0=H2H, 1=H2A, 2=A2H, 3=A2A" },
  { name: "agentIdHash", type: "bytes32", description: "keccak256 of agent DID + ERC-8004 token ID, or bytes32(0)" },
] as const;

// ---------------------------------------------------------------------------
// Sanctions flags bitmask helpers
// ---------------------------------------------------------------------------

/** Sanctions list bit positions (bits 0-3: screened, bits 8-11: matched). */
export const SANCTIONS_BITS = {
  OFAC_SDN_SCREENED: 0,
  EU_SCREENED: 1,
  UN_SCREENED: 2,
  HMT_SCREENED: 3,
  OFAC_SDN_MATCHED: 8,
  EU_MATCHED: 9,
  UN_MATCHED: 10,
  HMT_MATCHED: 11,
} as const;

/**
 * Build a sanctionsFlags bitmask from a ComplianceReceipt's check data.
 */
export function buildSanctionsFlags(checks: ComplianceReceipt["checksPerformed"]): number {
  let flags = 0;

  for (const check of checks) {
    if (check.checkType !== "SANCTIONS_SCREENING") continue;

    // Mark as screened based on provider/detail
    const detail = check.detail?.toUpperCase() ?? "";
    if (detail.includes("OFAC") || detail.includes("SDN")) flags |= 1 << SANCTIONS_BITS.OFAC_SDN_SCREENED;
    if (detail.includes("EU")) flags |= 1 << SANCTIONS_BITS.EU_SCREENED;
    if (detail.includes("UN")) flags |= 1 << SANCTIONS_BITS.UN_SCREENED;
    if (detail.includes("HMT")) flags |= 1 << SANCTIONS_BITS.HMT_SCREENED;

    // If the check failed, set the match bit
    if (check.result === "FAILED") {
      if (detail.includes("OFAC") || detail.includes("SDN")) flags |= 1 << SANCTIONS_BITS.OFAC_SDN_MATCHED;
      if (detail.includes("EU")) flags |= 1 << SANCTIONS_BITS.EU_MATCHED;
      if (detail.includes("UN")) flags |= 1 << SANCTIONS_BITS.UN_MATCHED;
      if (detail.includes("HMT")) flags |= 1 << SANCTIONS_BITS.HMT_MATCHED;
    }
  }

  return flags;
}

// ---------------------------------------------------------------------------
// Encoder / Decoder helpers
// ---------------------------------------------------------------------------

/**
 * Encode a ComplianceReceipt into AttestationData fields.
 *
 * The actual ABI encoding into bytes should be done by the consumer
 * using ethers.AbiCoder or viem's encodeAbiParameters — this function
 * maps the receipt fields to the schema's typed structure.
 */
export function encodeReceiptForAttestation(receipt: ComplianceReceipt): AttestationData {
  const travelRuleCompliant =
    receipt.travelRuleStatus === "NOT_REQUIRED" ||
    receipt.travelRuleStatus === "ACK_RECEIVED" ||
    receipt.travelRuleStatus === "TRANSMITTED";

  return {
    receiptId: receipt.receiptId,
    paymentTxHash: receipt.txHash ?? "0x" + "0".repeat(64),
    chainId: 0, // caller should override with actual chain ID
    payer: "0x" + "0".repeat(40), // caller should override
    payee: "0x" + "0".repeat(40), // caller should override
    amount: "0", // caller should override with token base units
    token: "0x" + "0".repeat(40), // caller should override
    ipfsContentHash: receipt.ipfsCid ?? "0x" + "0".repeat(64),
    riskScore: receipt.riskScore,
    sanctionsFlags: buildSanctionsFlags(receipt.checksPerformed),
    travelRuleCompliant,
    flowType: 0, // default H2H — caller should override if agent involved
    agentIdHash: "0x" + "0".repeat(64),
  };
}

/**
 * Decode AttestationData back to a partial receipt structure.
 *
 * Used for verification — maps on-chain data back to readable fields.
 */
export function decodeReceiptFromAttestation(data: AttestationData): {
  receiptId: string;
  riskScore: number;
  travelRuleCompliant: boolean;
  sanctionsFlags: number;
  flowType: number;
  ipfsContentHash: string;
} {
  return {
    receiptId: data.receiptId,
    riskScore: data.riskScore,
    travelRuleCompliant: data.travelRuleCompliant,
    sanctionsFlags: data.sanctionsFlags,
    flowType: data.flowType,
    ipfsContentHash: data.ipfsContentHash,
  };
}
