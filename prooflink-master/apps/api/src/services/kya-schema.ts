import { z } from "zod";

// ---------------------------------------------------------------------------
// LEI validation (ISO 17442): exactly 20 alphanumeric characters
// ---------------------------------------------------------------------------

const LEI_REGEX = /^[A-Z0-9]{20}$/;

// ---------------------------------------------------------------------------
// KYA-1 Credential Subject Schema (canonical definition)
// ---------------------------------------------------------------------------

/**
 * Delegation scope embedded in a KYA credential.
 * `expiresAt` is always required — a credential without expiry is invalid.
 */
export const KYADelegationScopeSchema = z.object({
  maxTransactionValue: z.number().nonnegative(),
  dailyLimit: z.number().nonnegative().optional(),
  allowedCounterparties: z.array(z.string()).optional(),
  blockedJurisdictions: z.array(z.string()).optional(),
  allowedChains: z.array(z.string()).optional(),
  allowedCurrencies: z.array(z.string()).optional(),
  expiresAt: z.string().datetime({ message: "expiresAt is required and must be an ISO-8601 datetime" }),
});

/**
 * Canonical KYA-1 credential subject schema.
 *
 * Required: agentDid, controllingEntityName, walletAddress, delegationScope
 * Strongly recommended: controllingEntityLEI (ISO 17442)
 * Optional: erc8004AgentId, agentType, allowedProtocols
 */
export const KYACredentialSubjectSchema = z.object({
  // Required
  agentDid: z
    .string()
    .min(1)
    .regex(/^did:[a-z]+:/, "agentDid must be a valid DID (did:method:...)"),
  controllingEntityName: z.string().min(1, "controllingEntityName is required"),
  walletAddress: z.string().min(1, "walletAddress is required"),
  delegationScope: KYADelegationScopeSchema,

  // Strongly recommended
  controllingEntityLEI: z
    .string()
    .regex(LEI_REGEX, "controllingEntityLEI must be exactly 20 alphanumeric characters (ISO 17442)")
    .optional(),

  // Optional
  erc8004AgentId: z.string().optional(),
  agentType: z.enum(["autonomous", "semi-autonomous", "human-supervised"]).optional(),
  allowedProtocols: z.array(z.string()).optional(),
});

export type KYACredentialSubject = z.infer<typeof KYACredentialSubjectSchema>;
export type KYADelegationScope = z.infer<typeof KYADelegationScopeSchema>;

// ---------------------------------------------------------------------------
// Full W3C VC envelope schema for a KYA credential
// ---------------------------------------------------------------------------

export const KYAVerifiableCredentialSchema = z.object({
  "@context": z.array(z.string()).min(1),
  type: z.array(z.string()).min(1),
  id: z.string().min(1),
  issuer: z.union([
    z.string().min(1),
    z.object({ id: z.string().min(1), name: z.string().optional() }),
  ]),
  issuanceDate: z.string().datetime(),
  expirationDate: z.string().datetime(),
  credentialSubject: KYACredentialSubjectSchema.extend({
    id: z.string().min(1),
  }),
  proof: z.object({
    type: z.string().min(1),
    created: z.string().datetime(),
    verificationMethod: z.string().min(1),
    proofPurpose: z.string().min(1),
    jws: z.string().min(1),
  }),
  credentialHash: z.string().optional(),
});

export type KYAVerifiableCredential = z.infer<typeof KYAVerifiableCredentialSchema>;
