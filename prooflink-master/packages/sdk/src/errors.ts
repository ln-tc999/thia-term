// ---------------------------------------------------------------------------
// Error hierarchy
// ---------------------------------------------------------------------------

/**
 * Base error class for all ProofLink SDK errors.
 *
 * Consumers can catch `ProofLinkError` to handle any SDK-originated error.
 */
export class ProofLinkError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ProofLinkError";
  }
}

/** Structured error body returned by the ProofLink API. */
export interface ApiErrorBody {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

/**
 * Thrown when the ProofLink API returns a non-2xx HTTP response.
 *
 * Includes the parsed error body when the response was valid JSON.
 */
export class ProofLinkAPIError extends ProofLinkError {
  constructor(
    public readonly status: number,
    public readonly body: ApiErrorBody | null,
    public readonly headers: Headers,
  ) {
    const msg = body?.message ?? `API request failed with status ${status}`;
    super(msg);
    this.name = "ProofLinkAPIError";
  }
}

/**
 * Thrown when request parameters fail client-side validation
 * before a network call is made.
 */
export class ProofLinkValidationError extends ProofLinkError {
  constructor(
    message: string,
    public readonly field?: string,
  ) {
    super(message);
    this.name = "ProofLinkValidationError";
  }
}

/**
 * Thrown when a request exceeds the configured timeout.
 */
export class ProofLinkTimeoutError extends ProofLinkError {
  constructor(
    public readonly timeoutMs: number,
    public readonly url: string,
  ) {
    super(`Request to ${url} timed out after ${timeoutMs}ms`);
    this.name = "ProofLinkTimeoutError";
  }
}

/**
 * Thrown on network-level failures (DNS resolution, connection refused, etc.)
 * after all retry attempts are exhausted.
 */
export class ProofLinkNetworkError extends ProofLinkError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ProofLinkNetworkError";
  }
}
