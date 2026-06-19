export { EASClient } from "./client.js";
export {
  PROOFLINK_SCHEMA,
  PROOFLINK_SCHEMA_DEFINITION,
  PROOFLINK_SCHEMA_NAME,
  PROOFLINK_SCHEMA_REVOCABLE,
  SCHEMA_FIELDS,
  SANCTIONS_BITS,
  buildSanctionsFlags,
  encodeReceiptForAttestation,
  decodeReceiptFromAttestation,
} from "./schema.js";
export type { SchemaField } from "./schema.js";
export type {
  EASConfig,
  AttestationData,
  AttestationResult,
  EASAttestation,
  AttestationRequest,
  EASSigner,
  EASReader,
} from "./types.js";
