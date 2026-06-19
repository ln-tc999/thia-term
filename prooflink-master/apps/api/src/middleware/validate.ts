import type { Context, MiddlewareHandler } from "hono";
import type { ZodSchema, ZodError } from "zod";

// ---------------------------------------------------------------------------
// Validation targets
// ---------------------------------------------------------------------------

interface ValidateOptions {
  /** Validate JSON request body. */
  body?: ZodSchema;
  /** Validate query parameters. */
  query?: ZodSchema;
  /** Validate path parameters. */
  params?: ZodSchema;
}

// ---------------------------------------------------------------------------
// Error formatting
// ---------------------------------------------------------------------------

interface ValidationIssue {
  path: string;
  message: string;
}

function formatZodError(error: ZodError, prefix: string): ValidationIssue[] {
  return error.issues.map((issue) => ({
    path: prefix ? `${prefix}.${issue.path.join(".")}` : issue.path.join("."),
    message: issue.message,
  }));
}

// ---------------------------------------------------------------------------
// Middleware factory
// ---------------------------------------------------------------------------

/**
 * Request validation middleware using Zod schemas.
 *
 * Validates body, query params, and/or path params. On failure returns
 * 400 with structured validation errors. On success, stores the parsed
 * (coerced + defaulted) values on the context via `c.set()`.
 *
 * @example
 * ```ts
 * app.post('/items', validate({ body: CreateItemSchema }), handler);
 * app.get('/items', validate({ query: ListQuerySchema }), handler);
 * app.get('/items/:id', validate({ params: z.object({ id: z.string().uuid() }) }), handler);
 * ```
 *
 * Parsed values are accessible via:
 * - `c.get("validatedBody")`
 * - `c.get("validatedQuery")`
 * - `c.get("validatedParams")`
 */
export function validate(options: ValidateOptions): MiddlewareHandler {
  return async (c: Context, next) => {
    const errors: ValidationIssue[] = [];

    // --- Body validation ---
    if (options.body) {
      let rawBody: unknown;
      try {
        rawBody = await c.req.json();
      } catch {
        return c.json(
          {
            success: false,
            error: {
              code: "BAD_REQUEST",
              message: "Request body must be valid JSON.",
            },
          },
          400,
        );
      }

      const result = options.body.safeParse(rawBody);
      if (!result.success) {
        errors.push(...formatZodError(result.error, "body"));
      } else {
        c.set("validatedBody", result.data);
      }
    }

    // --- Query validation ---
    if (options.query) {
      const rawQuery = c.req.query();
      const result = options.query.safeParse(rawQuery);
      if (!result.success) {
        errors.push(...formatZodError(result.error, "query"));
      } else {
        c.set("validatedQuery", result.data);
      }
    }

    // --- Params validation ---
    if (options.params) {
      const rawParams = c.req.param();
      const result = options.params.safeParse(rawParams);
      if (!result.success) {
        errors.push(...formatZodError(result.error, "params"));
      } else {
        c.set("validatedParams", result.data);
      }
    }

    // --- Return errors or continue ---
    if (errors.length > 0) {
      return c.json(
        {
          success: false,
          error: {
            code: "VALIDATION_ERROR",
            message: "Request validation failed.",
            details: errors,
          },
        },
        400,
      );
    }

    await next();
  };
}
