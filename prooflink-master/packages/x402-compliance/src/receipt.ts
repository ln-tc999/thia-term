import { createHash, createHmac } from "node:crypto";
import type {
  ProofLinkReceipt,
  ComplianceCheckEntry,
  SettleResponse,
  PaymentRequirements,
  Logger,
} from "./types.js";

// ---------------------------------------------------------------------------
// Receipt builder
// ---------------------------------------------------------------------------

export interface ReceiptBuilderOptions {
  /** Hex-encoded private key for HMAC-SHA256 signing (without 0x prefix internally) */
  providerKeyHex: string;
  logger?: Logger;
}

/**
 * Builds and signs ProofLink compliance receipts after settlement.
 */
export class ProofLinkReceiptBuilder {
  private readonly keyBuffer: Buffer;
  private readonly logger?: Logger;

  constructor(options: ReceiptBuilderOptions) {
    const hex = options.providerKeyHex.startsWith("0x")
      ? options.providerKeyHex.slice(2)
      : options.providerKeyHex;
    this.keyBuffer = Buffer.from(hex, "hex");
    this.logger = options.logger;
  }

  /**
   * Build a ProofLink receipt from settlement context.
   */
  build(params: {
    result: SettleResponse;
    requirements: PaymentRequirements;
    sender: string;
    checks: ComplianceCheckEntry[];
    riskScore: number;
    travelRuleRef?: string;
  }): ProofLinkReceipt {
    const receipt: ProofLinkReceipt = {
      version: 1,
      transactionHash: params.result.transaction,
      network: params.result.network,
      sender: params.sender,
      receiver: params.requirements.payTo,
      amount: params.requirements.maxAmountRequired,
      asset: params.requirements.asset,
      complianceChecks: params.checks,
      riskScore: params.riskScore,
      proofLinkHash: "", // computed below
      travelRuleRef: params.travelRuleRef,
      createdAt: new Date().toISOString(),
    };

    receipt.proofLinkHash = this.computeHash(receipt);
    receipt.signature = this.sign(receipt);

    this.logger?.debug("ProofLink receipt built", {
      hash: receipt.proofLinkHash,
      tx: receipt.transactionHash,
    });

    return receipt;
  }

  /**
   * Compute deterministic SHA-256 hash of receipt contents.
   */
  computeHash(receipt: ProofLinkReceipt): string {
    const canonicalData = canonicalize(receipt);
    return "0x" + createHash("sha256").update(canonicalData).digest("hex");
  }

  /**
   * Sign receipt with provider key using HMAC-SHA256.
   */
  sign(receipt: ProofLinkReceipt): string {
    const canonicalData = canonicalize(receipt);
    return "0x" + createHmac("sha256", this.keyBuffer).update(canonicalData).digest("hex");
  }

  /**
   * Verify a receipt signature.
   */
  verify(receipt: ProofLinkReceipt): boolean {
    if (!receipt.signature) return false;
    const expected = this.sign({ ...receipt, signature: undefined });
    return constantTimeEqual(receipt.signature, expected);
  }
}

// ---------------------------------------------------------------------------
// Receipt store interface
// ---------------------------------------------------------------------------

/**
 * Interface for persisting ProofLink receipts.
 * Implementations can use PostgreSQL, Redis, S3, etc.
 */
export interface ReceiptStore {
  /** Store a receipt, keyed by proofLinkHash */
  save(receipt: ProofLinkReceipt): Promise<void>;
  /** Retrieve a receipt by proofLinkHash */
  get(hash: string): Promise<ProofLinkReceipt | null>;
  /** List receipts for a given sender address */
  listBySender(sender: string, limit?: number): Promise<ProofLinkReceipt[]>;
  /** List receipts for a given transaction hash */
  getByTransaction(txHash: string): Promise<ProofLinkReceipt | null>;
}

/**
 * In-memory receipt store for development and testing.
 * Not suitable for production — receipts are lost on restart.
 */
export class InMemoryReceiptStore implements ReceiptStore {
  private readonly receipts = new Map<string, ProofLinkReceipt>();

  async save(receipt: ProofLinkReceipt): Promise<void> {
    this.receipts.set(receipt.proofLinkHash, receipt);
  }

  async get(hash: string): Promise<ProofLinkReceipt | null> {
    return this.receipts.get(hash) ?? null;
  }

  async listBySender(sender: string, limit = 50): Promise<ProofLinkReceipt[]> {
    const results: ProofLinkReceipt[] = [];
    const senderNorm = sender.toLowerCase();
    for (const receipt of this.receipts.values()) {
      if (receipt.sender.toLowerCase() === senderNorm) {
        results.push(receipt);
        if (results.length >= limit) break;
      }
    }
    return results;
  }

  async getByTransaction(txHash: string): Promise<ProofLinkReceipt | null> {
    for (const receipt of this.receipts.values()) {
      if (receipt.transactionHash === txHash) return receipt;
    }
    return null;
  }

  /** Get total count of stored receipts */
  get size(): number {
    return this.receipts.size;
  }

  /** Clear all receipts */
  clear(): void {
    this.receipts.clear();
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Canonical serialization of a receipt for hashing/signing.
 * Excludes `signature` and `proofLinkHash` to avoid circular dependencies.
 */
function canonicalize(receipt: ProofLinkReceipt): string {
  const ordered = {
    version: receipt.version,
    transactionHash: receipt.transactionHash,
    network: receipt.network,
    sender: receipt.sender,
    receiver: receipt.receiver,
    amount: receipt.amount,
    asset: receipt.asset,
    complianceChecks: receipt.complianceChecks.map((c) => ({
      type: c.type,
      target: c.target,
      result: c.result,
      detail: c.detail,
      latencyMs: c.latencyMs,
    })),
    riskScore: receipt.riskScore,
    travelRuleRef: receipt.travelRuleRef,
    createdAt: receipt.createdAt,
  };
  return JSON.stringify(ordered);
}

/**
 * Constant-time string comparison to prevent timing attacks.
 */
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}
