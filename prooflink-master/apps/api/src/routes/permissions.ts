// ---------------------------------------------------------------------------
// Permission Translation Routes (Gap 13)
//
// REST endpoints for cross-protocol permission translation, validation,
// and merging. Wraps the pure functions from permission-translator.ts.
// ---------------------------------------------------------------------------

import { Hono } from "hono";
import { z } from "zod";

import { validate } from "../middleware/validate.js";
import {
  translatePermission,
  validatePermission,
  mergePermissions,
  translateToProtocol,
  type PermissionProtocol,
  type UnifiedPermission,
} from "../services/permission-translator.js";

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const VALID_PROTOCOLS = ["x402", "ap2", "mpp", "acp", "erc7715", "erc7710"] as const;

const TranslateRequest = z.object({
  protocol: z.enum(VALID_PROTOCOLS),
  permission: z.record(z.unknown()),
  targetProtocol: z.enum(VALID_PROTOCOLS).optional(),
});

const ValidateRequest = z.object({
  protocol: z.enum(VALID_PROTOCOLS),
  grantedTo: z.string().min(1),
  grantedBy: z.string().min(1),
  maxAmountUsd: z.number(),
  allowedAssets: z.array(z.string()),
  allowedChains: z.array(z.string()),
  expiresAt: z.number(),
  scope: z.string(),
  revocable: z.boolean(),
  originalPermission: z.unknown().optional(),
});

const MergeRequest = z.object({
  permissions: z.array(
    z.object({
      protocol: z.enum(VALID_PROTOCOLS),
      grantedTo: z.string().min(1),
      grantedBy: z.string().min(1),
      maxAmountUsd: z.number(),
      allowedAssets: z.array(z.string()),
      allowedChains: z.array(z.string()),
      expiresAt: z.number(),
      scope: z.string(),
      revocable: z.boolean(),
      originalPermission: z.unknown().optional(),
    }),
  ).min(1).max(20),
});

// ---------------------------------------------------------------------------
// Route group
// ---------------------------------------------------------------------------

const permissionRoutes = new Hono();

// POST /v1/permissions/translate
permissionRoutes.post("/translate", validate({ body: TranslateRequest }), async (c) => {
  const body = c.get("validatedBody") as z.infer<typeof TranslateRequest>;

  try {
    const unified = translatePermission(
      body.protocol as PermissionProtocol,
      body.permission,
    );

    // If targetProtocol is specified, also translate to that format
    let targetFormat: Record<string, unknown> | undefined;
    if (body.targetProtocol) {
      targetFormat = translateToProtocol(unified, body.targetProtocol as PermissionProtocol);
    }

    const validation = validatePermission(unified);

    return c.json({
      success: true,
      data: {
        unified,
        validation,
        ...(targetFormat ? { targetFormat } : {}),
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Translation failed";
    return c.json(
      { success: false, error: { code: "TRANSLATION_ERROR", message } },
      400,
    );
  }
});

// POST /v1/permissions/validate
permissionRoutes.post("/validate", validate({ body: ValidateRequest }), async (c) => {
  const body = c.get("validatedBody") as z.infer<typeof ValidateRequest>;

  const unified: UnifiedPermission = {
    protocol: body.protocol as PermissionProtocol,
    grantedTo: body.grantedTo,
    grantedBy: body.grantedBy,
    maxAmountUsd: body.maxAmountUsd,
    allowedAssets: body.allowedAssets,
    allowedChains: body.allowedChains,
    expiresAt: body.expiresAt,
    scope: body.scope,
    revocable: body.revocable,
    originalPermission: body.originalPermission ?? null,
  };

  const result = validatePermission(unified);

  return c.json({
    success: true,
    data: result,
  });
});

// POST /v1/permissions/merge
permissionRoutes.post("/merge", validate({ body: MergeRequest }), async (c) => {
  const body = c.get("validatedBody") as z.infer<typeof MergeRequest>;

  const permissions: UnifiedPermission[] = body.permissions.map((p) => ({
    protocol: p.protocol as PermissionProtocol,
    grantedTo: p.grantedTo,
    grantedBy: p.grantedBy,
    maxAmountUsd: p.maxAmountUsd,
    allowedAssets: p.allowedAssets,
    allowedChains: p.allowedChains,
    expiresAt: p.expiresAt,
    scope: p.scope,
    revocable: p.revocable,
    originalPermission: p.originalPermission ?? null,
  }));

  try {
    const merged = mergePermissions(permissions);
    const validation = validatePermission(merged);

    return c.json({
      success: true,
      data: {
        merged,
        validation,
        inputCount: permissions.length,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Merge failed";
    return c.json(
      { success: false, error: { code: "MERGE_ERROR", message } },
      400,
    );
  }
});

export { permissionRoutes };
