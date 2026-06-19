// ---------------------------------------------------------------------------
// Error Codes
// ---------------------------------------------------------------------------

export const ErrorCode = {
  // Sanctions
  SANCTIONS_MATCH: "SANCTIONS_MATCH",
  SANCTIONS_SCREENING_FAILED: "SANCTIONS_SCREENING_FAILED",

  // AML
  AML_THRESHOLD_EXCEEDED: "AML_THRESHOLD_EXCEEDED",
  AML_SCORING_FAILED: "AML_SCORING_FAILED",

  // Travel Rule
  TRAVEL_RULE_FAILED: "TRAVEL_RULE_FAILED",
  TRAVEL_RULE_TIMEOUT: "TRAVEL_RULE_TIMEOUT",

  // KYA
  KYA_VERIFICATION_FAILED: "KYA_VERIFICATION_FAILED",
  KYA_CREDENTIAL_EXPIRED: "KYA_CREDENTIAL_EXPIRED",

  // Compliance (generic)
  COMPLIANCE_CHECK_FAILED: "COMPLIANCE_CHECK_FAILED",
  COMPLIANCE_POLICY_VIOLATION: "COMPLIANCE_POLICY_VIOLATION",

  // Invoice
  INVOICE_VALIDATION_FAILED: "INVOICE_VALIDATION_FAILED",
  INVOICE_NOT_FOUND: "INVOICE_NOT_FOUND",

  // Payment
  PAYMENT_FAILED: "PAYMENT_FAILED",
  INSUFFICIENT_FUNDS: "INSUFFICIENT_FUNDS",

  // Auth
  AUTHENTICATION_FAILED: "AUTHENTICATION_FAILED",
  AUTHORIZATION_FAILED: "AUTHORIZATION_FAILED",
  API_KEY_EXPIRED: "API_KEY_EXPIRED",
  API_KEY_REVOKED: "API_KEY_REVOKED",

  // Rate Limiting
  RATE_LIMIT_EXCEEDED: "RATE_LIMIT_EXCEEDED",

  // Network
  NETWORK_ERROR: "NETWORK_ERROR",
  TIMEOUT: "TIMEOUT",
  UPSTREAM_SERVICE_ERROR: "UPSTREAM_SERVICE_ERROR",

  // Validation
  VALIDATION_ERROR: "VALIDATION_ERROR",
  INVALID_ADDRESS: "INVALID_ADDRESS",
  INVALID_CHAIN: "INVALID_CHAIN",

  // Configuration
  CONFIGURATION_INVALID: "CONFIGURATION_INVALID",

  // Generic
  NOT_FOUND: "NOT_FOUND",
  INTERNAL_ERROR: "INTERNAL_ERROR",
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

// ---------------------------------------------------------------------------
// Base Error
// ---------------------------------------------------------------------------

export class ProofLinkError extends Error {
  public readonly code: ErrorCode;
  public readonly statusCode: number;
  public readonly details: Record<string, unknown>;

  constructor(
    message: string,
    code: ErrorCode,
    statusCode: number = 500,
    details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "ProofLinkError";
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;

    // Maintain proper stack trace in V8
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }

  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      statusCode: this.statusCode,
      details: this.details,
    };
  }
}

// ---------------------------------------------------------------------------
// Compliance Errors
// ---------------------------------------------------------------------------

export class ComplianceError extends ProofLinkError {
  constructor(
    checkType: string,
    reason: string,
    code: ErrorCode = ErrorCode.COMPLIANCE_CHECK_FAILED,
    statusCode: number = 403,
    details: Record<string, unknown> = {},
  ) {
    super(
      `Compliance check '${checkType}' failed: ${reason}`,
      code,
      statusCode,
      { checkType, reason, ...details },
    );
    this.name = "ComplianceError";
  }
}

export class SanctionsError extends ProofLinkError {
  constructor(
    address: string,
    matchedLists: string[],
    details: Record<string, unknown> = {},
  ) {
    super(
      `Sanctions match detected for address ${address} on lists: ${matchedLists.join(", ")}`,
      ErrorCode.SANCTIONS_MATCH,
      403,
      { address, matchedLists, ...details },
    );
    this.name = "SanctionsError";
  }
}

/** @deprecated Use SanctionsError instead. */
export const SanctionsMatchError = SanctionsError;

export class AMLError extends ProofLinkError {
  constructor(
    riskScore: number,
    threshold: number,
    details: Record<string, unknown> = {},
  ) {
    super(
      `AML risk score ${riskScore} exceeds threshold ${threshold}`,
      ErrorCode.AML_THRESHOLD_EXCEEDED,
      403,
      { riskScore, threshold, ...details },
    );
    this.name = "AMLError";
  }
}

export class TravelRuleError extends ProofLinkError {
  constructor(
    reason: string,
    details: Record<string, unknown> = {},
  ) {
    super(
      `Travel Rule transmission failed: ${reason}`,
      ErrorCode.TRAVEL_RULE_FAILED,
      502,
      { reason, ...details },
    );
    this.name = "TravelRuleError";
  }
}

// ---------------------------------------------------------------------------
// KYA Verification
// ---------------------------------------------------------------------------

export class KYAVerificationError extends ProofLinkError {
  constructor(
    agentId: string,
    reason: string,
    details: Record<string, unknown> = {},
  ) {
    super(
      `KYA verification failed for agent ${agentId}: ${reason}`,
      ErrorCode.KYA_VERIFICATION_FAILED,
      403,
      { agentId, reason, ...details },
    );
    this.name = "KYAVerificationError";
  }
}

// ---------------------------------------------------------------------------
// Compliance Check Failed (generic pipeline failure)
// ---------------------------------------------------------------------------

export class ComplianceCheckFailedError extends ComplianceError {
  constructor(
    checkType: string,
    reason: string,
    details: Record<string, unknown> = {},
  ) {
    super(checkType, reason, ErrorCode.COMPLIANCE_CHECK_FAILED, 403, details);
    this.name = "ComplianceCheckFailedError";
  }
}

// ---------------------------------------------------------------------------
// Network Errors
// ---------------------------------------------------------------------------

export class NetworkError extends ProofLinkError {
  constructor(
    reason: string,
    details: Record<string, unknown> = {},
  ) {
    super(
      `Network error: ${reason}`,
      ErrorCode.NETWORK_ERROR,
      502,
      { reason, ...details },
    );
    this.name = "NetworkError";
  }
}

export class TimeoutError extends ProofLinkError {
  public readonly timeoutMs: number;

  constructor(
    operation: string,
    timeoutMs: number,
    details: Record<string, unknown> = {},
  ) {
    super(
      `Operation '${operation}' timed out after ${timeoutMs}ms`,
      ErrorCode.TIMEOUT,
      504,
      { operation, timeoutMs, ...details },
    );
    this.name = "TimeoutError";
    this.timeoutMs = timeoutMs;
  }
}

// ---------------------------------------------------------------------------
// Validation Error
// ---------------------------------------------------------------------------

export class ValidationError extends ProofLinkError {
  public readonly fieldErrors: Array<{ field: string; message: string }>;

  constructor(
    fieldErrors: Array<{ field: string; message: string }>,
    details: Record<string, unknown> = {},
  ) {
    const summary =
      fieldErrors.length === 1
        ? `Validation failed: ${fieldErrors[0].field} — ${fieldErrors[0].message}`
        : `Validation failed on ${fieldErrors.length} fields`;
    super(summary, ErrorCode.VALIDATION_ERROR, 400, {
      fieldErrors,
      ...details,
    });
    this.name = "ValidationError";
    this.fieldErrors = fieldErrors;
  }
}

// ---------------------------------------------------------------------------
// Auth Errors
// ---------------------------------------------------------------------------

export class AuthError extends ProofLinkError {
  constructor(
    reason: string,
    code: ErrorCode = ErrorCode.AUTHENTICATION_FAILED,
    details: Record<string, unknown> = {},
  ) {
    super(
      `Authentication failed: ${reason}`,
      code,
      code === ErrorCode.AUTHORIZATION_FAILED ? 403 : 401,
      { reason, ...details },
    );
    this.name = "AuthError";
  }
}

/** @deprecated Use AuthError instead. */
export class AuthenticationError extends AuthError {
  constructor(reason: string, details: Record<string, unknown> = {}) {
    super(reason, ErrorCode.AUTHENTICATION_FAILED, details);
    this.name = "AuthenticationError";
  }
}

// ---------------------------------------------------------------------------
// Invoice Validation
// ---------------------------------------------------------------------------

export class InvoiceValidationError extends ProofLinkError {
  constructor(
    invoiceId: string | undefined,
    reason: string,
    details: Record<string, unknown> = {},
  ) {
    super(
      `Invoice validation failed${invoiceId ? ` for ${invoiceId}` : ""}: ${reason}`,
      ErrorCode.INVOICE_VALIDATION_FAILED,
      400,
      { invoiceId, reason, ...details },
    );
    this.name = "InvoiceValidationError";
  }
}

// ---------------------------------------------------------------------------
// Rate Limiting
// ---------------------------------------------------------------------------

export class RateLimitError extends ProofLinkError {
  public readonly retryAfterSeconds: number;

  constructor(
    retryAfterSeconds: number,
    details: Record<string, unknown> = {},
  ) {
    super(
      `Rate limit exceeded. Retry after ${retryAfterSeconds}s.`,
      ErrorCode.RATE_LIMIT_EXCEEDED,
      429,
      { retryAfterSeconds, ...details },
    );
    this.name = "RateLimitError";
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

// ---------------------------------------------------------------------------
// Payment
// ---------------------------------------------------------------------------

export class PaymentError extends ProofLinkError {
  constructor(
    reason: string,
    protocol: string,
    details: Record<string, unknown> = {},
  ) {
    super(
      `Payment failed via ${protocol}: ${reason}`,
      ErrorCode.PAYMENT_FAILED,
      402,
      { reason, protocol, ...details },
    );
    this.name = "PaymentError";
  }
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export class ConfigurationError extends ProofLinkError {
  constructor(field: string, reason: string, details: Record<string, unknown> = {}) {
    super(
      `Invalid configuration for '${field}': ${reason}`,
      ErrorCode.CONFIGURATION_INVALID,
      500,
      { field, reason, ...details },
    );
    this.name = "ConfigurationError";
  }
}

// ---------------------------------------------------------------------------
// Not Found
// ---------------------------------------------------------------------------

export class NotFoundError extends ProofLinkError {
  constructor(resource: string, id: string, details: Record<string, unknown> = {}) {
    super(
      `${resource} not found: ${id}`,
      ErrorCode.NOT_FOUND,
      404,
      { resource, id, ...details },
    );
    this.name = "NotFoundError";
  }
}

// ---------------------------------------------------------------------------
// Upstream / External Service
// ---------------------------------------------------------------------------

export class UpstreamServiceError extends ProofLinkError {
  constructor(
    service: string,
    reason: string,
    details: Record<string, unknown> = {},
  ) {
    super(
      `Upstream service '${service}' error: ${reason}`,
      ErrorCode.UPSTREAM_SERVICE_ERROR,
      502,
      { service, reason, ...details },
    );
    this.name = "UpstreamServiceError";
  }
}
