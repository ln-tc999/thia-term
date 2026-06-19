// ---------------------------------------------------------------------------
// @prooflink/integrations — Optional external service integrations
// ---------------------------------------------------------------------------
//
// Each integration is independently importable via subpath exports:
//   import { NotabeneClient } from "@prooflink/integrations/notabene"
//   import { TRMClient } from "@prooflink/integrations/trm"
//   import { EASClient } from "@prooflink/integrations/eas"
//   import { IPFSClient } from "@prooflink/integrations/ipfs"
//   import { SlackNotifier } from "@prooflink/integrations/slack"
//
// This barrel export provides convenience access to all integrations.
// Heavy modules use lazy dynamic imports — importing this module does
// NOT eagerly load any external SDK code.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Notabene Travel Rule
// ---------------------------------------------------------------------------
export { NotabeneClient, NotabeneTravelRuleProvider } from "./notabene/index.js";
export type {
  NotabeneConfig,
  NotabeneTransfer,
  NotabeneTransferStatus,
  NotabeneResponse,
  ListTransfersParams,
} from "./notabene/index.js";

// ---------------------------------------------------------------------------
// TRM Labs AML
// ---------------------------------------------------------------------------
export { TRMClient, TRMSanctionsProvider } from "./trm/index.js";
export type {
  TRMConfig,
  TRMScreeningResult,
  TRMAddressReport,
  TRMRiskCategory,
  SanctionsProvider,
} from "./trm/index.js";

// ---------------------------------------------------------------------------
// EAS (Ethereum Attestation Service)
// ---------------------------------------------------------------------------
export { EASClient } from "./eas/index.js";
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
} from "./eas/index.js";
export type {
  EASConfig,
  AttestationData,
  AttestationResult,
  EASAttestation,
  AttestationRequest,
  EASSigner,
  EASReader,
  SchemaField,
} from "./eas/index.js";

// ---------------------------------------------------------------------------
// IPFS Pinning
// ---------------------------------------------------------------------------
export { IPFSClient } from "./ipfs/index.js";
export type {
  IPFSConfig,
  PinResult,
  PinMetadata,
  PinStatus,
  PinningService,
  IPFSHttpClient,
} from "./ipfs/index.js";

// ---------------------------------------------------------------------------
// Slack Notifications
// ---------------------------------------------------------------------------
export { SlackNotifier, SlackWebhook } from "./slack/index.js";
export type {
  SlackConfig,
  SlackMessage,
  SlackBlock,
  SlackAttachment,
  SlackHttpClient,
} from "./slack/index.js";

// ---------------------------------------------------------------------------
// Lazy loaders — use these to avoid importing modules until needed
// ---------------------------------------------------------------------------

/** Lazily load the EAS integration module. */
export async function loadEAS() {
  return import("./eas/index.js");
}

/** Lazily load the IPFS integration module. */
export async function loadIPFS() {
  return import("./ipfs/index.js");
}

/** Lazily load the Slack integration module. */
export async function loadSlack() {
  return import("./slack/index.js");
}

/** Lazily load the Notabene integration module. */
export async function loadNotabene() {
  return import("./notabene/index.js");
}

/** Lazily load the TRM integration module. */
export async function loadTRM() {
  return import("./trm/index.js");
}
