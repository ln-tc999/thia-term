import type {
  PaymentPayload,
  PaymentRequirements,
  Logger,
} from "../types.js";
import type { ProofLinkX402Compliance } from "../middleware.js";

// ---------------------------------------------------------------------------
// Hono adapter types
// ---------------------------------------------------------------------------

/**
 * Minimal Hono Context shape (avoids importing hono types).
 * Hono passes a Context object instead of separate req/res.
 */
export interface HonoContext {
  req: {
    method: string;
    url: string;
    path: string;
    header(name: string): string | undefined;
    json<T = unknown>(): Promise<T>;
  };
  json(body: unknown, status?: number): Response;
  header(name: string, value: string): void;
  status(code: number): void;
  get<T = unknown>(key: string): T | undefined;
  set(key: string, value: unknown): void;
}

/** Hono-style next function */
export type HonoNextFunction = () => Promise<void>;

/** Options for the Hono compliance middleware */
export interface HonoComplianceOptions {
  /** The compliance instance */
  compliance: ProofLinkX402Compliance;
  /** Extract payment payload from Hono context */
  extractPayload?: (ctx: HonoContext) => Promise<PaymentPayload | null>;
  /** Extract payment requirements from Hono context */
  extractRequirements?: (ctx: HonoContext) => Promise<PaymentRequirements | null>;
  /** Logger */
  logger?: Logger;
}

// ---------------------------------------------------------------------------
// Hono middleware factory
// ---------------------------------------------------------------------------

/**
 * Create Hono middleware that runs x402 compliance checks.
 *
 * @example
 * ```ts
 * import { Hono } from "hono";
 * import { createProofLinkCompliance } from "@prooflink/x402-compliance";
 * import { createHonoComplianceMiddleware } from "@prooflink/x402-compliance/adapters/hono";
 *
 * const app = new Hono();
 * const compliance = createProofLinkCompliance(config);
 *
 * app.use("/api/pay/*", createHonoComplianceMiddleware({ compliance }));
 * ```
 */
export function createHonoComplianceMiddleware(
  options: HonoComplianceOptions,
): (ctx: HonoContext, next: HonoNextFunction) => Promise<Response | void> {
  const { compliance, logger } = options;

  const extractPayload =
    options.extractPayload ??
    (async (ctx: HonoContext) => {
      try {
        const body = await ctx.req.json<Record<string, unknown>>();
        return (body?.paymentPayload as PaymentPayload) ?? null;
      } catch {
        return null;
      }
    });

  const extractRequirements =
    options.extractRequirements ??
    (async (ctx: HonoContext) => {
      try {
        const body = await ctx.req.json<Record<string, unknown>>();
        return (body?.requirements as PaymentRequirements) ?? null;
      } catch {
        return null;
      }
    });

  return async (ctx: HonoContext, next: HonoNextFunction): Promise<Response | void> => {
    const payload = await extractPayload(ctx);
    const requirements = await extractRequirements(ctx);

    if (!payload || !requirements) {
      await next();
      return;
    }

    try {
      const result = await compliance.onBeforeVerify({
        paymentPayload: payload,
        requirements,
      });

      if (result && "abort" in result && result.abort) {
        logger?.warn("Compliance check blocked request", {
          reason: result.reason,
          path: ctx.req.path,
        });
        return ctx.json(
          {
            error: "compliance_blocked",
            reason: result.reason,
            message: result.message,
          },
          403,
        );
      }

      await next();
    } catch (err) {
      logger?.error("Compliance middleware error", err);
      return ctx.json({ error: "internal_compliance_error" }, 500);
    }
  };
}
