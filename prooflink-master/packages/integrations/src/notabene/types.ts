// ---------------------------------------------------------------------------
// Notabene Travel Rule — API types
// ---------------------------------------------------------------------------

/** Configuration for the Notabene API client. */
export interface NotabeneConfig {
  /** Notabene API key */
  apiKey: string;
  /** VASP DID registered with Notabene */
  vaspDID: string;
  /** Base URL for the Notabene API */
  baseUrl?: string;
  /** Use testnet endpoints */
  testnet?: boolean;
  /** Request timeout in milliseconds (default: 10_000) */
  timeoutMs?: number;
}

/** Status of a Notabene transfer. */
export type NotabeneTransferStatus =
  | "CREATED"
  | "SENT"
  | "ACK"
  | "REJECTED"
  | "CANCELLED"
  | "INCOMPLETE"
  | "ACCEPTED";

/** A Notabene transfer object as returned by the API. */
export interface NotabeneTransfer {
  id: string;
  status: NotabeneTransferStatus;
  transactionType: string;
  transactionAsset: string;
  transactionAmount: string;
  originatorVASPdid: string;
  beneficiaryVASPdid?: string;
  originatorProof?: Record<string, unknown>;
  beneficiaryProof?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

/** API response wrapper for transfer creation. */
export interface NotabeneResponse {
  id: string;
  status: NotabeneTransferStatus;
  /** Raw API response for debugging */
  raw?: Record<string, unknown>;
}

/** Pagination and filter parameters for listing transfers. */
export interface ListTransfersParams {
  /** Number of results per page (default: 20, max: 100) */
  limit?: number;
  /** Pagination offset */
  offset?: number;
  /** Filter by transfer status */
  status?: NotabeneTransferStatus;
  /** ISO 8601 start date filter */
  createdAfter?: string;
  /** ISO 8601 end date filter */
  createdBefore?: string;
}

/** Shape of errors returned by the Notabene API. */
export interface NotabeneApiError {
  statusCode: number;
  message: string;
  error?: string;
}
