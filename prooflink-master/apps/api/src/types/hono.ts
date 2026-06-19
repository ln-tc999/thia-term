import type { AuthContext } from "../middleware/auth.js";

/**
 * Augment Hono's ContextVariableMap so c.get("auth"), c.get("requestId"),
 * and validated request data are properly typed across all route handlers.
 */
declare module "hono" {
  interface ContextVariableMap {
    auth: AuthContext;
    requestId: string;
    /** Parsed + validated request body (set by validate middleware). */
    validatedBody: unknown;
    /** Parsed + validated query params (set by validate middleware). */
    validatedQuery: unknown;
    /** Parsed + validated path params (set by validate middleware). */
    validatedParams: unknown;
  }
}
