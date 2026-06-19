/**
 * Standardized MCP error response formatting for ProofLink tools.
 *
 * All tool errors should use formatMcpError() to produce consistent
 * error responses with machine-readable codes and human-readable messages.
 */

/** Standard error codes used across ProofLink MCP tools. */
export type ProofLinkMcpErrorCode =
  | "VALIDATION_ERROR"
  | "SANCTIONS_MATCH"
  | "SCREENING_FAILED"
  | "KYA_VERIFICATION_FAILED"
  | "TRAVEL_RULE_FAILED"
  | "PAYMENT_FAILED"
  | "PAYMENT_BLOCKED"
  | "INVOICE_VALIDATION_FAILED"
  | "INVOICE_LIST_FAILED"
  | "NOT_FOUND"
  | "RATE_LIMITED"
  | "UPSTREAM_ERROR"
  | "INTERNAL_ERROR"
  | "REPORT_GENERATION_FAILED"
  | "METRICS_FAILED"
  | "REGISTRATION_FAILED"
  | "RESOURCE_ERROR";

export interface McpErrorResponse {
  [key: string]: unknown;
  content: Array<{ type: "text"; text: string }>;
  structuredContent?: {
    code: ProofLinkMcpErrorCode;
    message: string;
    details?: Record<string, unknown>;
  };
  isError: true;
}

/**
 * Format a standardized MCP error response.
 * Returns an object compatible with the MCP tool response shape.
 */
export function formatMcpError(
  code: ProofLinkMcpErrorCode,
  message: string,
  details?: Record<string, unknown>,
): McpErrorResponse {
  return {
    content: [{ type: "text" as const, text: `[${code}] ${message}` }],
    structuredContent: {
      code,
      message,
      ...(details ? { details } : {}),
    },
    isError: true,
  };
}

/**
 * Wrap an unknown caught value into a formatted MCP error.
 * Extracts the message from Error instances, stringifies everything else.
 */
export function formatUnknownError(
  code: ProofLinkMcpErrorCode,
  prefix: string,
  error: unknown,
): McpErrorResponse {
  const message =
    error instanceof Error ? error.message : String(error);
  return formatMcpError(code, `${prefix}: ${message}`);
}
