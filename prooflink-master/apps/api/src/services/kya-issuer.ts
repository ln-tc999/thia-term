import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";

import type { KYACredentialSubject, KYAVerifiableCredential } from "./kya-schema.js";
import { KYACredentialSubjectSchema } from "./kya-schema.js";
import { logger } from "../utils/logger.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface IssueKYACredentialInput {
  agentDid: string;
  controllingEntityName: string;
  controllingEntityLEI?: string;
  walletAddress: string;
  delegationScope: KYACredentialSubject["delegationScope"];
  expiresAt: string; // ISO-8601 datetime
  agentType?: KYACredentialSubject["agentType"];
  erc8004AgentId?: string;
  allowedProtocols?: string[];
}

export interface IssuedCredential {
  credential: KYAVerifiableCredential;
  credentialHash: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PROOFLINK_ISSUER_DID = "did:web:prooflink.io";
const PROOFLINK_ISSUER_NAME = "ProofLink";
const VC_CONTEXT = [
  "https://www.w3.org/2018/credentials/v1",
  "https://prooflink.io/credentials/kya/v1",
] as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getSigningSecret(): string {
  const secret = process.env.KYA_SIGNING_SECRET;
  if (!secret) {
    throw new Error("KYA_SIGNING_SECRET environment variable is not set");
  }
  return secret;
}

/**
 * Sign payload with HMAC-SHA256.
 * In production this would be replaced with proper JWS (e.g. ES256K with a DID key).
 */
function signPayload(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

/**
 * Generate a deterministic credential hash for on-chain anchoring.
 * Hash covers the credential subject + issuance metadata (not the proof itself).
 */
function generateCredentialHash(
  credentialId: string,
  subject: Record<string, unknown>,
  issuanceDate: string,
  expirationDate: string,
): string {
  const canonical = JSON.stringify({
    id: credentialId,
    subject,
    issuanceDate,
    expirationDate,
  });
  return createHash("sha256").update(canonical).digest("hex");
}

// ---------------------------------------------------------------------------
// KYA Credential Issuer
// ---------------------------------------------------------------------------

/**
 * Issue a W3C Verifiable Credential for an agent's KYA attestation.
 *
 * Signs the credential with HMAC-SHA256 using the KYA_SIGNING_SECRET env var.
 * Returns both the signed credential and a hash suitable for on-chain anchoring.
 */
export function issueKYACredential(input: IssueKYACredentialInput): IssuedCredential {
  // Validate the credential subject through the canonical schema
  const subjectData = {
    agentDid: input.agentDid,
    controllingEntityName: input.controllingEntityName,
    controllingEntityLEI: input.controllingEntityLEI,
    walletAddress: input.walletAddress,
    delegationScope: input.delegationScope,
    agentType: input.agentType,
    erc8004AgentId: input.erc8004AgentId,
    allowedProtocols: input.allowedProtocols,
  };

  const parsed = KYACredentialSubjectSchema.parse(subjectData);

  // Warn (but don't reject) when LEI is missing
  if (!parsed.controllingEntityLEI) {
    logger.warn(
      `Issuing credential for ${input.agentDid} without controllingEntityLEI — strongly recommended for production use`,
    );
  }

  const credentialId = `urn:uuid:${randomUUID()}`;
  const now = new Date();
  const issuanceDate = now.toISOString();
  const expirationDate = input.expiresAt;

  // Build credential subject (W3C VC credentialSubject.id = agent DID)
  const credentialSubject = {
    id: parsed.agentDid,
    ...parsed,
  };

  // Generate hash for on-chain anchoring
  const credentialHash = generateCredentialHash(
    credentialId,
    credentialSubject as unknown as Record<string, unknown>,
    issuanceDate,
    expirationDate,
  );

  // Build the unsigned credential payload for signing
  const unsignedPayload = JSON.stringify({
    "@context": [...VC_CONTEXT],
    type: ["VerifiableCredential", "KYACredential"],
    id: credentialId,
    issuer: { id: PROOFLINK_ISSUER_DID, name: PROOFLINK_ISSUER_NAME },
    issuanceDate,
    expirationDate,
    credentialSubject,
    credentialHash,
  });

  // Sign with HMAC-SHA256
  const secret = getSigningSecret();
  const jws = signPayload(unsignedPayload, secret);

  const credential: KYAVerifiableCredential = {
    "@context": [...VC_CONTEXT],
    type: ["VerifiableCredential", "KYACredential"],
    id: credentialId,
    issuer: { id: PROOFLINK_ISSUER_DID, name: PROOFLINK_ISSUER_NAME },
    issuanceDate,
    expirationDate,
    credentialSubject,
    proof: {
      type: "HmacSha256Signature2024",
      created: issuanceDate,
      verificationMethod: `${PROOFLINK_ISSUER_DID}#key-1`,
      proofPurpose: "assertionMethod",
      jws,
    },
    credentialHash,
  };

  return { credential, credentialHash };
}

/**
 * Verify that a credential's HMAC signature is valid.
 * Returns true if the signature matches, false otherwise.
 */
export function verifyCredentialSignature(credential: KYAVerifiableCredential): boolean {
  const secret = getSigningSecret();

  // Reconstruct the unsigned payload (everything except proof)
  const { proof: _proof, ...rest } = credential;
  const unsignedPayload = JSON.stringify(rest);

  const expectedJws = signPayload(unsignedPayload, secret);
  const expected = Buffer.from(expectedJws);
  const actual = Buffer.from(credential.proof.jws);
  if (expected.length !== actual.length) return false;
  return timingSafeEqual(expected, actual);
}
