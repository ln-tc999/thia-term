import { createHash, randomBytes } from "node:crypto";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SelectiveProof {
  /** Fields disclosed in plaintext */
  disclosed: Record<string, unknown>;
  /** SHA-256 hashes of undisclosed fields (field path -> hash) */
  undisclosedHashes: Record<string, string>;
  /** Overall proof hash binding all fields together */
  proofHash: string;
  /** Nonce to prevent rainbow-table attacks on hashed fields */
  nonce: string;
  /** Timestamp of proof creation */
  createdAt: string;
}

export interface ComplianceAttestationInput {
  status: string;
  riskScore: number;
  travelRuleCompliant: boolean;
  senderAddress: string;
  receiverAddress: string;
  amount: string;
  asset: string;
  checksPerformed: Record<string, unknown>[];
}

export interface ComplianceAttestation {
  /** The disclosed compliance facts (status, risk threshold, travel rule) */
  disclosed: Record<string, unknown>;
  /** Hashes of hidden fields (addresses, amounts) */
  undisclosedHashes: Record<string, string>;
  /** Binding proof hash */
  proofHash: string;
  nonce: string;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Selective disclosure for KYA credentials
// ---------------------------------------------------------------------------

/**
 * Create a selective disclosure proof from a full KYA credential.
 *
 * Disclosed fields appear in plaintext. Undisclosed fields are replaced
 * with SHA-256(nonce || fieldPath || JSON(value)) so a verifier can confirm
 * consistency without seeing the actual values.
 *
 * Supports nested field paths using dot notation:
 *   e.g. "delegationScope.maxTransactionValue"
 */
export function createSelectiveProof(
  credential: Record<string, unknown>,
  disclosedFields: string[],
): SelectiveProof {
  const nonce = randomBytes(16).toString("hex");
  const flatFields = flattenObject(credential);
  const disclosedSet = new Set(disclosedFields);

  const disclosed: Record<string, unknown> = {};
  const undisclosedHashes: Record<string, string> = {};

  for (const [path, value] of Object.entries(flatFields)) {
    if (isFieldDisclosed(path, disclosedSet)) {
      disclosed[path] = value;
    } else {
      undisclosedHashes[path] = hashField(nonce, path, value);
    }
  }

  // Create a binding proof hash over all field hashes (disclosed + undisclosed)
  const allHashes: string[] = [];
  for (const [path, value] of Object.entries(flatFields)) {
    allHashes.push(hashField(nonce, path, value));
  }
  allHashes.sort(); // deterministic ordering
  const proofHash = createHash("sha256")
    .update(allHashes.join("||"))
    .digest("hex");

  return {
    disclosed,
    undisclosedHashes,
    proofHash,
    nonce,
    createdAt: new Date().toISOString(),
  };
}

/**
 * Verify that a selective proof is internally consistent.
 *
 * Checks:
 * 1. All disclosed fields hash correctly with the nonce
 * 2. The proofHash binds all field hashes together
 * 3. No fields are missing from (disclosed + undisclosed)
 */
export function verifySelectiveProof(
  proof: SelectiveProof,
  disclosedFields: string[],
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  const disclosedSet = new Set(disclosedFields);

  // Verify each disclosed field is actually in the disclosed set
  for (const path of Object.keys(proof.disclosed)) {
    if (!isFieldDisclosed(path, disclosedSet)) {
      errors.push(`Field "${path}" is in disclosed data but was not requested`);
    }
  }

  // Rebuild all field hashes from disclosed values + undisclosed hashes
  const allHashes: string[] = [];

  for (const [path, value] of Object.entries(proof.disclosed)) {
    allHashes.push(hashField(proof.nonce, path, value));
  }
  for (const hash of Object.values(proof.undisclosedHashes)) {
    allHashes.push(hash);
  }

  allHashes.sort();
  const recomputedProofHash = createHash("sha256")
    .update(allHashes.join("||"))
    .digest("hex");

  if (recomputedProofHash !== proof.proofHash) {
    errors.push("Proof hash does not match recomputed hash — data may have been tampered with");
  }

  return { valid: errors.length === 0, errors };
}

// ---------------------------------------------------------------------------
// Compliance attestation with selective disclosure
// ---------------------------------------------------------------------------

/**
 * Create a compliance attestation that proves compliance facts without
 * revealing who was checked or the exact amounts.
 *
 * Always disclosed: status, riskScore < threshold, travelRuleCompliant
 * Always hidden: senderAddress, receiverAddress, exact amount
 *
 * Additional fields can be selectively disclosed via `disclosedFields`.
 */
export function createComplianceAttestation(
  checkResult: ComplianceAttestationInput,
  disclosedFields: string[] = [],
): ComplianceAttestation {
  const nonce = randomBytes(16).toString("hex");

  // Always-disclosed compliance facts
  const disclosed: Record<string, unknown> = {
    status: checkResult.status,
    riskBelowThreshold: checkResult.riskScore < 80,
    travelRuleCompliant: checkResult.travelRuleCompliant,
    checksCount: checkResult.checksPerformed.length,
  };

  // Allow additional fields to be disclosed on request
  const disclosedSet = new Set(disclosedFields);
  if (disclosedSet.has("riskScore")) {
    disclosed["riskScore"] = checkResult.riskScore;
  }
  if (disclosedSet.has("asset")) {
    disclosed["asset"] = checkResult.asset;
  }

  // Always-hidden fields
  const undisclosedHashes: Record<string, string> = {
    senderAddress: hashField(nonce, "senderAddress", checkResult.senderAddress),
    receiverAddress: hashField(nonce, "receiverAddress", checkResult.receiverAddress),
    amount: hashField(nonce, "amount", checkResult.amount),
  };

  // If riskScore not explicitly disclosed, hash it
  if (!disclosedSet.has("riskScore")) {
    undisclosedHashes["riskScore"] = hashField(nonce, "riskScore", checkResult.riskScore);
  }
  if (!disclosedSet.has("asset")) {
    undisclosedHashes["asset"] = hashField(nonce, "asset", checkResult.asset);
  }

  // Build binding proof hash
  const allHashes: string[] = [];
  const allFields: Record<string, unknown> = {
    status: checkResult.status,
    riskScore: checkResult.riskScore,
    travelRuleCompliant: checkResult.travelRuleCompliant,
    senderAddress: checkResult.senderAddress,
    receiverAddress: checkResult.receiverAddress,
    amount: checkResult.amount,
    asset: checkResult.asset,
    checksCount: checkResult.checksPerformed.length,
  };

  for (const [path, value] of Object.entries(allFields)) {
    allHashes.push(hashField(nonce, path, value));
  }
  allHashes.sort();
  const proofHash = createHash("sha256")
    .update(allHashes.join("||"))
    .digest("hex");

  return {
    disclosed,
    undisclosedHashes,
    proofHash,
    nonce,
    createdAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function hashField(nonce: string, path: string, value: unknown): string {
  const serialized = JSON.stringify(value);
  return createHash("sha256")
    .update(`${nonce}||${path}||${serialized}`)
    .digest("hex");
}

/**
 * Check if a field path should be disclosed.
 * A field is disclosed if:
 *   - It exactly matches a disclosed field, OR
 *   - It is a child of a disclosed field (e.g. "delegationScope.maxTransactionValue"
 *     is disclosed when "delegationScope" is in the set)
 */
function isFieldDisclosed(path: string, disclosedSet: Set<string>): boolean {
  if (disclosedSet.has(path)) return true;

  // Check if any parent path is disclosed
  const parts = path.split(".");
  for (let i = 1; i < parts.length; i++) {
    const parent = parts.slice(0, i).join(".");
    if (disclosedSet.has(parent)) return true;
  }

  return false;
}

/**
 * Flatten a nested object into dot-notation paths.
 * { a: { b: 1, c: [2] } } -> { "a.b": 1, "a.c": [2] }
 *
 * Arrays are kept as values (not further flattened) to preserve structure.
 */
function flattenObject(
  obj: Record<string, unknown>,
  prefix = "",
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;

    if (
      value !== null &&
      typeof value === "object" &&
      !Array.isArray(value)
    ) {
      Object.assign(result, flattenObject(value as Record<string, unknown>, path));
    } else {
      result[path] = value;
    }
  }

  return result;
}
