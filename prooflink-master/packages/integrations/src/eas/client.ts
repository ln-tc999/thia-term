// ---------------------------------------------------------------------------
// EAS (Ethereum Attestation Service) — client
// ---------------------------------------------------------------------------

import type { ComplianceReceipt } from "@prooflink/shared";
import type {
  AttestationData,
  AttestationResult,
  EASConfig,
  EASReader,
  EASSigner,
} from "./types.js";
import {
  encodeReceiptForAttestation,
  decodeReceiptFromAttestation,
  PROOFLINK_SCHEMA_REVOCABLE,
} from "./schema.js";

/**
 * EAS attestation client for anchoring ProofLink compliance receipts on-chain.
 *
 * Requires injectable `EASSigner` and `EASReader` implementations — this
 * avoids a hard dependency on ethers.js or viem, letting consumers pick
 * their preferred Web3 library.
 *
 * Usage:
 * ```ts
 * import { EASClient } from "@prooflink/integrations/eas";
 *
 * const client = new EASClient(config, signer, reader);
 * const result = await client.attest(receipt);
 * const verification = await client.verify(result.uid);
 * ```
 */
export class EASClient {
  private readonly config: EASConfig;
  private readonly signer: EASSigner;
  private readonly reader: EASReader;

  constructor(config: EASConfig, signer: EASSigner, reader: EASReader) {
    this.config = config;
    this.signer = signer;
    this.reader = reader;
  }

  /**
   * Create an on-chain EAS attestation for a ComplianceReceipt.
   *
   * @param receipt - The compliance receipt to attest
   * @returns AttestationResult with uid, txHash, and timestamp
   */
  async attest(receipt: ComplianceReceipt): Promise<AttestationResult> {
    const attesterAddress = await this.signer.getAddress();
    const attestationData = encodeReceiptForAttestation(receipt);
    const encodedData = JSON.stringify(attestationData);

    const { uid, txHash } = await this.signer.attest({
      schema: this.config.schemaUid,
      data: {
        recipient: attesterAddress,
        expirationTime: 0, // no expiration
        revocable: PROOFLINK_SCHEMA_REVOCABLE,
        data: encodedData,
      },
    });

    return {
      uid,
      txHash,
      timestamp: Math.floor(Date.now() / 1000),
    };
  }

  /**
   * Verify that an attestation exists on-chain and return its decoded data.
   *
   * @param uid - Attestation UID to verify
   * @returns Validity flag and decoded attestation data
   */
  async verify(uid: string): Promise<{ valid: boolean; data: AttestationData }> {
    const attestation = await this.reader.getAttestation(uid);

    if (!attestation) {
      return {
        valid: false,
        data: emptyAttestationData(),
      };
    }

    const isRevoked = attestation.revocationTime > 0;
    const parsed = JSON.parse(attestation.data) as AttestationData;

    return {
      valid: !isRevoked,
      data: parsed,
    };
  }

  /**
   * Revoke an existing attestation.
   *
   * @param uid - Attestation UID to revoke
   * @returns Transaction hash of the revocation
   */
  async revoke(uid: string): Promise<string> {
    return this.signer.revoke(this.config.schemaUid, uid);
  }

  /**
   * Retrieve all attestations for a given recipient address.
   *
   * @param address - Ethereum address of the recipient
   * @returns Array of attestation results
   */
  async getAttestationsByRecipient(address: string): Promise<AttestationResult[]> {
    const attestations = await this.reader.getAttestationsByRecipient(
      this.config.schemaUid,
      address,
    );

    return attestations.map((a) => ({
      uid: a.uid,
      txHash: "", // not stored in attestation record — requires tx lookup
      timestamp: a.time,
    }));
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function emptyAttestationData(): AttestationData {
  return {
    receiptId: "",
    paymentTxHash: "",
    chainId: 0,
    payer: "",
    payee: "",
    amount: "0",
    token: "",
    ipfsContentHash: "",
    riskScore: 0,
    sanctionsFlags: 0,
    travelRuleCompliant: false,
    flowType: 0,
    agentIdHash: "",
  };
}

export { encodeReceiptForAttestation, decodeReceiptFromAttestation };
