import { z } from "zod";
import { SupportedChain, SupportedToken } from "./protocol.js";

// ---------------------------------------------------------------------------
// Branded types
// ---------------------------------------------------------------------------

export type AgentId = string & { readonly __brand: "AgentId" };
export type DID = string & { readonly __brand: "DID" };

// ---------------------------------------------------------------------------
// Agent Type
// ---------------------------------------------------------------------------

export const AgentType = z.enum([
  "autonomous",
  "semi-autonomous",
  "human-supervised",
]);
export type AgentType = z.infer<typeof AgentType>;

// ---------------------------------------------------------------------------
// Delegation Scope
// ---------------------------------------------------------------------------

export const DelegationScope = z.object({
  maxTransactionValue: z.number().nonnegative(),
  dailyLimit: z.number().nonnegative().optional(),
  allowedCounterparties: z.array(z.string()).optional(),
  blockedJurisdictions: z.array(z.string()).optional(),
  /** Restricts to specific chains. Use SupportedChain values. */
  allowedChains: z.array(SupportedChain).optional(),
  /** Restricts to specific tokens. Use SupportedToken values. */
  allowedCurrencies: z.array(SupportedToken).optional(),
  expiresAt: z.string().datetime(),
});
export type DelegationScope = z.infer<typeof DelegationScope>;

// ---------------------------------------------------------------------------
// Agent Identity
// ---------------------------------------------------------------------------

export const AgentIdentity = z.object({
  agentId: z.string(),
  did: z.string(),
  name: z.string().optional(),
  type: AgentType,
  principalEntity: z.object({
    name: z.string(),
    lei: z.string().optional(),
    did: z.string().optional(),
    kycVerified: z.boolean(),
    sanctionsCleared: z.boolean(),
  }),
  walletAddress: z.string(),
  reputationScore: z.number().int().min(0).max(100),
  delegationScope: DelegationScope,
  registeredAt: z.string().datetime(),
  x402Support: z.boolean().default(false),
});
export type AgentIdentity = z.infer<typeof AgentIdentity>;

// ---------------------------------------------------------------------------
// KYA Verifiable Credential (W3C VC + ProofLink extensions)
// ---------------------------------------------------------------------------

export const KYACredentialSubject = z.object({
  id: z.string(), // agent DID
  agentDid: z.string(),
  agentType: AgentType.optional(),
  controllingEntityName: z.string(),
  controllingEntityLEI: z.string().optional(),
  delegationScope: DelegationScope,
  walletAddress: z.string(),
  erc8004AgentId: z.string().optional(),
  allowedProtocols: z.array(z.string()).optional(),
  validationEvidence: z.string().optional(), // URI to TEE attestation / auditor report
});
export type KYACredentialSubject = z.infer<typeof KYACredentialSubject>;

export const KYACredential = z.object({
  "@context": z.array(z.string()).default([
    "https://www.w3.org/2018/credentials/v1",
    "https://prooflink.io/credentials/kya/v1",
  ]),
  type: z.array(z.string()).default([
    "VerifiableCredential",
    "KYACredential",
  ]),
  id: z.string(), // credential URI
  issuer: z.object({
    id: z.string(), // ProofLink DID
    name: z.string().default("ProofLink"),
  }),
  issuanceDate: z.string().datetime(),
  expirationDate: z.string().datetime(),
  credentialSubject: KYACredentialSubject,
  proof: z.object({
    type: z.string().default("EcdsaSecp256k1Signature2019"),
    created: z.string().datetime(),
    verificationMethod: z.string(),
    proofPurpose: z.string().default("assertionMethod"),
    jws: z.string(),
  }),
});
export type KYACredential = z.infer<typeof KYACredential>;

// ---------------------------------------------------------------------------
// KYA Verification Result
// ---------------------------------------------------------------------------

export const KYAVerificationResult = z.object({
  verified: z.boolean(),
  trustScore: z.number().int().min(0).max(100),
  agentMetadata: z.object({
    name: z.string().optional(),
    type: AgentType,
    operator: z.string().optional(),
    registeredAt: z.string().datetime().optional(),
    x402Support: z.boolean().optional(),
  }),
  operatorStatus: z
    .object({
      sanctionsCleared: z.boolean(),
      kycVerified: z.boolean(),
    })
    .optional(),
  spendingLimits: z
    .object({
      perTransactionUsd: z.number().nonnegative(),
      dailyUsd: z.number().nonnegative(),
      allowedChains: z.array(SupportedChain),
      allowedCurrencies: z.array(SupportedToken),
    })
    .optional(),
  validationEvidence: z.string().optional(),
  receiptId: z.string(),
});
export type KYAVerificationResult = z.infer<typeof KYAVerificationResult>;
