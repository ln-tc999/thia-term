import type { ErrorHandler } from "hono";
import { HTTPException } from "hono/http-exception";
import { ZodError } from "zod";

import { logger } from "../utils/logger.js";

export interface ApiErrorResponse {
  success: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

/**
 * Map common error types to structured JSON responses.
 */
export const globalErrorHandler: ErrorHandler = (err, c) => {
  const requestId = c.get("requestId") as string | undefined;

  // Zod validation errors
  if (err instanceof ZodError) {
    const details = err.issues.map((issue) => ({
      path: issue.path.join("."),
      message: issue.message,
    }));

    return c.json<ApiErrorResponse>(
      {
        success: false,
        error: {
          code: "VALIDATION_ERROR",
          message: "Request validation failed.",
          details,
        },
      },
      400,
    );
  }

  // Hono HTTP exceptions (thrown by built-in validators, etc.)
  if (err instanceof HTTPException) {
    return c.json<ApiErrorResponse>(
      {
        success: false,
        error: {
          code: `HTTP_${err.status}`,
          message: err.message,
        },
      },
      err.status,
    );
  }

  // Catch-all for unexpected errors
  const message = err instanceof Error ? err.message : String(err);
  logger.error("Unhandled error", { requestId, error: message, stack: err instanceof Error ? err.stack : undefined });

  return c.json<ApiErrorResponse>(
    {
      success: false,
      error: {
        code: "INTERNAL_ERROR",
        message:
          process.env["NODE_ENV"] === "production"
            ? "An internal error occurred."
            : message,
      },
    },
    500,
  );
};
