// ---------------------------------------------------------------------------
// EAS (Ethereum Attestation Service) — types
// ---------------------------------------------------------------------------

/** Configuration for the EAS client. */
export interface EASConfig {
  /** EAS SchemaRegistry contract address on the target chain */
  registryAddress: string;
  /** Schema UID for ProofLink compliance receipts */
  schemaUid: string;
  /** Private key for signing attestations (hex, with or without 0x prefix) */
  privateKey: string;
  /** JSON-RPC URL for the target chain */
  rpcUrl: string;
  /** Chain ID (Base=8453, Ethereum=1) */
  chainId: number;
  /** EAS contract address override (defaults per chain) */
  contractAddress?: string;
  /** Request timeout in milliseconds (default: 30_000) */
  timeoutMs?: number;
}

/**
 * Receipt data mapped to EAS schema fields.
 * Mirrors the on-chain ProofLink schema definition.
 */
export interface AttestationData {
  receiptId: string;
  paymentTxHash: string;
  chainId: number;
  payer: string;
  payee: string;
  amount: string;
  token: string;
  ipfsContentHash: string;
  riskScore: number;
  sanctionsFlags: number;
  travelRuleCompliant: boolean;
  flowType: number;
  agentIdHash: string;
}

/** Result of creating or querying an attestation. */
export interface AttestationResult {
  /** Attestation UID (bytes32 hex string) */
  uid: string;
  /** Transaction hash of the attestation tx */
  txHash: string;
  /** Unix timestamp of the attestation */
  timestamp: number;
}

/** EAS attestation record from on-chain. */
export interface EASAttestation {
  uid: string;
  schema: string;
  refUID?: string;
  time: number;
  expirationTime: number;
  revocationTime: number;
  recipient: string;
  attester: string;
  revocable: boolean;
  data: string;
}

/** Parameters for creating a new attestation. */
export interface AttestationRequest {
  schema: string;
  data: {
    recipient: string;
    expirationTime?: number;
    revocable?: boolean;
    refUID?: string;
    data: string;
    value?: bigint;
  };
}

/**
 * On-chain signer interface — abstract to avoid hard ethers dependency.
 * Consumers inject their own implementation using ethers.js, viem, etc.
 */
export interface EASSigner {
  /** Send an attestation transaction and return { uid, txHash }. */
  attest(request: AttestationRequest): Promise<{ uid: string; txHash: string }>;
  /** Revoke an attestation by UID. Returns the revocation tx hash. */
  revoke(schemaUid: string, attestationUid: string): Promise<string>;
  /** Get the signer's address. */
  getAddress(): Promise<string>;
}

/**
 * On-chain reader interface for verifying attestations.
 * Consumers inject their own implementation using ethers.js, viem, etc.
 */
export interface EASReader {
  /** Retrieve an attestation by UID. Returns null if not found. */
  getAttestation(uid: string): Promise<EASAttestation | null>;
  /** Check if an attestation is valid (exists and not revoked). */
  isAttestationValid(uid: string): Promise<boolean>;
  /** Retrieve all attestation UIDs for a given recipient address. */
  getAttestationsByRecipient(
    schemaUid: string,
    recipient: string,
  ): Promise<EASAttestation[]>;
}
