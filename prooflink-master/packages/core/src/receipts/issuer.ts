import { createHash } from "node:crypto";
import type {
  CheckPerformed,
  ComplianceDecision,
  ComplianceReceipt,
  TravelRuleStatus,
} from "@prooflink/shared";
import type { ProofLinkConfig } from "../config.js";

// ---------------------------------------------------------------------------
// EIP-712 Typed Data for Compliance Receipt
// ---------------------------------------------------------------------------

const COMPLIANCE_RECEIPT_TYPES = {
  ComplianceReceipt: [
    { name: "receiptId", type: "string" },
    { name: "txHash", type: "string" },
    { name: "overallStatus", type: "string" },
    { name: "riskScore", type: "uint256" },
    { name: "travelRuleStatus", type: "string" },
    { name: "timestamp", type: "string" },
    { name: "proofLinkVersion", type: "string" },
  ],
} as const;

const COMPLIANCE_RECEIPT_DOMAIN = {
  name: "ProofLink",
  version: "1",
  // chainId is set dynamically from config
} as const;

// ---------------------------------------------------------------------------
// Receipt ID generation
// ---------------------------------------------------------------------------

/**
 * Generate a deterministic receipt ID from transaction context.
 * Uses a hash of sender + receiver + amount + chain + timestamp components.
 */
export function generateReceiptId(params: {
  senderAddress: string;
  receiverAddress: string;
  amountUsd: number;
  chain: string;
  timestamp: string;
}): string {
  // Deterministic ID from transaction context
  const input = [
    params.senderAddress.toLowerCase(),
    params.receiverAddress.toLowerCase(),
    params.amountUsd.toFixed(6),
    params.chain,
    params.timestamp,
  ].join(":");

  // Simple deterministic hash using built-in crypto
  return `pl-${hashString(input)}`;
}

/**
 * Compute a SHA-256 hash of the input string, returning a hex digest.
 * Uses Node.js built-in crypto for a proper cryptographic hash.
 */
function hashString(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

// ---------------------------------------------------------------------------
// IPFS CID generation (mock — real implementation would use IPFS client)
// ---------------------------------------------------------------------------

/**
 * Generate a content-addressable URI for the receipt.
 * In production, this would upload to IPFS and return the real CID.
 * Returns a sha256: URI that is honest about what it is.
 */
function generateContentHash(receiptJson: string): string {
  const hash = hashString(receiptJson);
  return `sha256:${hash}`;
}

// ---------------------------------------------------------------------------
// ReceiptIssuer
// ---------------------------------------------------------------------------

/**
 * Compliance receipt generation and signing.
 *
 * Produces cryptographically signed compliance receipts that serve as
 * auditable proof that all compliance checks were performed at transaction time.
 *
 * Features:
 * - Deterministic receipt ID from transaction context
 * - EIP-712 typed data signing (when signer key is configured)
 * - IPFS CID generation for future on-chain anchoring
 * - Structured receipt format compatible with EAS attestations
 */
export class ReceiptIssuer {
  private readonly config: ProofLinkConfig;

  constructor(config: ProofLinkConfig) {
    this.config = config;
  }

  /**
   * Issue a compliance receipt for a completed compliance decision.
   *
   * @param decision - The compliance decision to receipt
   * @param txContext - Transaction context for receipt ID generation
   * @returns Signed compliance receipt
   */
  async issueReceipt(
    decision: ComplianceDecision,
    txContext: {
      senderAddress: string;
      receiverAddress: string;
      amountUsd: number;
      chain: string;
      txHash?: string;
    },
  ): Promise<ComplianceReceipt> {
    const now = new Date().toISOString();

    const receiptId = generateReceiptId({
      senderAddress: txContext.senderAddress,
      receiverAddress: txContext.receiverAddress,
      amountUsd: txContext.amountUsd,
      chain: txContext.chain,
      timestamp: now,
    });

    // Build the receipt
    const receipt: ComplianceReceipt = {
      receiptId,
      txHash: txContext.txHash,
      checksPerformed: decision.checks,
      overallStatus: this.mapDecisionStatus(decision.status),
      riskScore: decision.riskScore,
      travelRuleStatus: decision.travelRuleStatus,
      signature: "", // Filled below
      timestamp: now,
      ttl: decision.ttl,
      proofLinkVersion: "1.0.0",
    };

    // Generate content-addressable hash (replaced by real IPFS CID in production)
    const receiptJson = JSON.stringify(receipt);
    receipt.ipfsCid = generateContentHash(receiptJson);

    // Sign with EIP-712 if signer key is available
    try {
      receipt.signature = await this.signReceipt(receipt);
    } catch (error) {
      // Gracefully degrade: return unsigned receipt instead of crashing the
      // compliance decision pipeline. The signature field signals the failure.
      const reason = error instanceof Error ? error.message : String(error);
      receipt.signature = `unsigned:signing-failed:${hashString(JSON.stringify(receipt))}`;
      (receipt as ComplianceReceipt & { signingWarning?: string }).signingWarning =
        `EIP-712 signing failed: ${reason}`;
    }

    return receipt;
  }

  /**
   * Compute a deterministic hash of a compliance receipt.
   * Uses keccak256 for EVM compatibility.
   */
  async computeReceiptHash(receipt: ComplianceReceipt): Promise<string> {
    const { keccak256, toBytes } = await import("viem");
    const payload = JSON.stringify({
      receiptId: receipt.receiptId,
      overallStatus: receipt.overallStatus,
      riskScore: receipt.riskScore,
      travelRuleStatus: receipt.travelRuleStatus,
      timestamp: receipt.timestamp,
    });
    return keccak256(toBytes(payload));
  }

  // -------------------------------------------------------------------------
  // Private
  // -------------------------------------------------------------------------

  private async signReceipt(receipt: ComplianceReceipt): Promise<string> {
    if (!this.config.signerPrivateKey) {
      // No signer configured — return a deterministic placeholder
      return `unsigned:${hashString(JSON.stringify(receipt))}`;
    }

    try {
      const { createWalletClient, http } = await import("viem");
      const { privateKeyToAccount } = await import("viem/accounts");
      const { mainnet } = await import("viem/chains");

      const account = privateKeyToAccount(
        this.config.signerPrivateKey as `0x${string}`,
      );

      const client = createWalletClient({
        account,
        chain: mainnet,
        transport: http(),
      });

      const signature = await client.signTypedData({
        domain: {
          ...COMPLIANCE_RECEIPT_DOMAIN,
          chainId: this.config.chainId ?? 1,
        },
        types: COMPLIANCE_RECEIPT_TYPES,
        primaryType: "ComplianceReceipt",
        message: {
          receiptId: receipt.receiptId,
          txHash: receipt.txHash ?? "",
          overallStatus: receipt.overallStatus,
          riskScore: BigInt(receipt.riskScore),
          travelRuleStatus: receipt.travelRuleStatus,
          timestamp: receipt.timestamp,
          proofLinkVersion: receipt.proofLinkVersion,
        },
      });

      return signature;
    } catch (error) {
      // Re-throw so callers are aware signing failed rather than silently
      // producing a receipt that appears signed but is not.
      throw new Error(
        `Failed to sign compliance receipt: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private mapDecisionStatus(
    status: ComplianceDecision["status"],
  ): ComplianceReceipt["overallStatus"] {
    switch (status) {
      case "APPROVED":
        return "APPROVED";
      case "REJECTED":
        return "REJECTED";
      case "ESCALATED":
        return "ESCALATED";
      default:
        return "ESCALATED";
    }
  }
}
