import { z } from "zod";

// ---------------------------------------------------------------------------
// Plugin Lifecycle
// ---------------------------------------------------------------------------

export const PluginLifecycle = z.enum([
  "registered",
  "initializing",
  "active",
  "suspended",
  "error",
  "unregistered",
]);
export type PluginLifecycle = z.infer<typeof PluginLifecycle>;

// ---------------------------------------------------------------------------
// Plugin Hook Point
// ---------------------------------------------------------------------------

export const PluginHookPoint = z.enum([
  "pre_compliance_check",
  "post_compliance_check",
  "pre_sanctions_screening",
  "post_sanctions_screening",
  "pre_travel_rule",
  "post_travel_rule",
  "pre_payment",
  "post_payment",
  "pre_invoice_validation",
  "post_invoice_validation",
  "pre_kya_verification",
  "post_kya_verification",
  "on_error",
  "on_receipt_created",
]);
export type PluginHookPoint = z.infer<typeof PluginHookPoint>;

// ---------------------------------------------------------------------------
// Plugin Hook
// ---------------------------------------------------------------------------

export const PluginHook = z.object({
  point: PluginHookPoint,
  /** Execution priority — lower values run first. */
  priority: z.number().int().min(0).max(1000).default(100),
  /** If true, a failure in this hook aborts the pipeline. */
  critical: z.boolean().default(false),
  /** Maximum execution time in milliseconds. */
  timeoutMs: z.number().int().positive().default(5_000),
});
export type PluginHook = z.infer<typeof PluginHook>;

// ---------------------------------------------------------------------------
// Plugin Manifest (registration descriptor)
// ---------------------------------------------------------------------------

export const PluginManifest = z.object({
  id: z.string().min(1).max(128),
  name: z.string().min(1).max(256),
  version: z.string().regex(/^\d+\.\d+\.\d+$/, "Must be semver (x.y.z)"),
  description: z.string().max(1024).optional(),
  author: z.string().optional(),
  hooks: z.array(PluginHook).min(1),
  /** Plugin-specific configuration schema (JSON Schema as a plain object). */
  configSchema: z.record(z.string(), z.unknown()).optional(),
  /** Required API scopes. */
  requiredScopes: z.array(z.string()).optional(),
});
export type PluginManifest = z.infer<typeof PluginManifest>;

// ---------------------------------------------------------------------------
// Plugin Registration (runtime state)
// ---------------------------------------------------------------------------

export const PluginRegistration = z.object({
  manifest: PluginManifest,
  state: PluginLifecycle,
  config: z.record(z.string(), z.unknown()).optional(),
  registeredAt: z.string().datetime(),
  lastActiveAt: z.string().datetime().optional(),
  errorMessage: z.string().optional(),
});
export type PluginRegistration = z.infer<typeof PluginRegistration>;

// ---------------------------------------------------------------------------
// Plugin Hook Context (passed to hook handlers)
// ---------------------------------------------------------------------------

export const PluginHookContext = z.object({
  hookPoint: PluginHookPoint,
  pluginId: z.string(),
  requestId: z.string(),
  timestamp: z.string().datetime(),
  payload: z.record(z.string(), z.unknown()),
});
export type PluginHookContext = z.infer<typeof PluginHookContext>;

// ---------------------------------------------------------------------------
// Plugin Hook Result (returned from hook handlers)
// ---------------------------------------------------------------------------

export const PluginHookResult = z.object({
  pluginId: z.string(),
  hookPoint: PluginHookPoint,
  success: z.boolean(),
  /** Modified payload to pass downstream (if any). */
  modifiedPayload: z.record(z.string(), z.unknown()).optional(),
  /** Abort reason when success=false and hook is critical. */
  abortReason: z.string().optional(),
  durationMs: z.number().nonnegative(),
});
export type PluginHookResult = z.infer<typeof PluginHookResult>;
