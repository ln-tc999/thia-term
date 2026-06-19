import type {
  PaymentPayload,
  PaymentRequirements,
  Logger,
} from "../types.js";
import type { ProofLinkX402Compliance } from "../middleware.js";

// ---------------------------------------------------------------------------
// Express adapter types
// ---------------------------------------------------------------------------

/** Minimal Express Request shape (avoids importing express types) */
export interface ExpressRequest {
  method: string;
  url: string;
  path: string;
  headers: Record<string, string | string[] | undefined>;
  body?: unknown;
  ip?: string;
}

/** Minimal Express Response shape */
export interface ExpressResponse {
  status(code: number): ExpressResponse;
  json(body: unknown): ExpressResponse;
  setHeader(name: string, value: string): ExpressResponse;
}

/** Express-style next function */
export type ExpressNextFunction = (err?: unknown) => void;

/** Options for the Express compliance middleware */
export interface ExpressComplianceOptions {
  /** The compliance instance */
  compliance: ProofLinkX402Compliance;
  /** Extract payment payload from Express request (default: req.body.paymentPayload) */
  extractPayload?: (req: ExpressRequest) => PaymentPayload | null;
  /** Extract payment requirements from Express request (default: req.body.requirements) */
  extractRequirements?: (req: ExpressRequest) => PaymentRequirements | null;
  /** Logger */
  logger?: Logger;
}

// ---------------------------------------------------------------------------
// Express middleware factory
// ---------------------------------------------------------------------------

/**
 * Create Express middleware that runs x402 compliance checks
 * before allowing payment verification/settlement.
 *
 * @example
 * ```ts
 * import express from "express";
 * import { createProofLinkCompliance } from "@prooflink/x402-compliance";
 * import { createExpressComplianceMiddleware } from "@prooflink/x402-compliance/adapters/express";
 *
 * const app = express();
 * const compliance = createProofLinkCompliance(config);
 *
 * app.use("/api/pay", createExpressComplianceMiddleware({ compliance }));
 * ```
 */
export function createExpressComplianceMiddleware(
  options: ExpressComplianceOptions,
): (req: ExpressRequest, res: ExpressResponse, next: ExpressNextFunction) => void {
  const { compliance, logger } = options;

  const extractPayload =
    options.extractPayload ??
    ((req: ExpressRequest) => {
      const body = req.body as Record<string, unknown> | undefined;
      return (body?.paymentPayload as PaymentPayload) ?? null;
    });

  const extractRequirements =
    options.extractRequirements ??
    ((req: ExpressRequest) => {
      const body = req.body as Record<string, unknown> | undefined;
      return (body?.requirements as PaymentRequirements) ?? null;
    });

  return (req: ExpressRequest, res: ExpressResponse, next: ExpressNextFunction) => {
    const payload = extractPayload(req);
    const requirements = extractRequirements(req);

    if (!payload || !requirements) {
      next();
      return;
    }

    compliance
      .onBeforeVerify({ paymentPayload: payload, requirements })
      .then((result) => {
        if (result && "abort" in result && result.abort) {
          logger?.warn("Compliance check blocked request", {
            reason: result.reason,
            path: req.path,
          });
          res.status(403).json({
            error: "compliance_blocked",
            reason: result.reason,
            message: result.message,
          });
          return;
        }
        next();
      })
      .catch((err: unknown) => {
        logger?.error("Compliance middleware error", err);
        next(err);
      });
  };
}
