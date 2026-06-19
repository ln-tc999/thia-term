import { z } from "zod";

// ---------------------------------------------------------------------------
// Pagination
// ---------------------------------------------------------------------------

export const PaginationParams = z.object({
  page: z.number().int().positive().default(1),
  limit: z.number().int().min(1).max(100).default(20),
  sortBy: z.string().optional(),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
});
export type PaginationParams = z.infer<typeof PaginationParams>;

export const PaginatedMeta = z.object({
  page: z.number().int().positive(),
  limit: z.number().int().positive(),
  total: z.number().int().nonnegative(),
  totalPages: z.number().int().nonnegative(),
  hasNextPage: z.boolean(),
  hasPrevPage: z.boolean(),
});
export type PaginatedMeta = z.infer<typeof PaginatedMeta>;

/** Generic paginated response wrapper. Use with `.extend({ data: z.array(...) })`. */
export const PaginatedResponse = z.object({
  data: z.array(z.unknown()),
  meta: PaginatedMeta,
});
export type PaginatedResponse = z.infer<typeof PaginatedResponse>;

// ---------------------------------------------------------------------------
// API Error Response
// ---------------------------------------------------------------------------

export const APIErrorDetail = z.object({
  field: z.string().optional(),
  message: z.string(),
  code: z.string().optional(),
});
export type APIErrorDetail = z.infer<typeof APIErrorDetail>;

export const APIErrorResponse = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    statusCode: z.number().int(),
    details: z.array(APIErrorDetail).optional(),
    requestId: z.string().optional(),
    timestamp: z.string().datetime(),
  }),
});
export type APIErrorResponse = z.infer<typeof APIErrorResponse>;

// ---------------------------------------------------------------------------
// API Key
// ---------------------------------------------------------------------------

export const APIKeyScope = z.enum([
  "compliance:read",
  "compliance:write",
  "payments:read",
  "payments:write",
  "invoices:read",
  "invoices:write",
  "analytics:read",
  "webhooks:manage",
  "admin",
]);
export type APIKeyScope = z.infer<typeof APIKeyScope>;

export const APIKey = z.object({
  id: z.string(),
  name: z.string().min(1).max(128),
  /** Prefix-only representation (e.g. "flk_sk_abc...xyz"). Full key only shown on creation. */
  keyPrefix: z.string(),
  scopes: z.array(APIKeyScope).min(1),
  expiresAt: z.string().datetime().optional(),
  lastUsedAt: z.string().datetime().optional(),
  createdAt: z.string().datetime(),
  revokedAt: z.string().datetime().optional(),
});
export type APIKey = z.infer<typeof APIKey>;

// ---------------------------------------------------------------------------
// Rate Limit Info
// ---------------------------------------------------------------------------

export const RateLimitInfo = z.object({
  limit: z.number().int().positive(),
  remaining: z.number().int().nonnegative(),
  resetAt: z.string().datetime(),
  /** Window duration in seconds. */
  windowSeconds: z.number().int().positive(),
});
export type RateLimitInfo = z.infer<typeof RateLimitInfo>;

// ---------------------------------------------------------------------------
// API Success Response (generic envelope)
// ---------------------------------------------------------------------------

export const APISuccessResponse = z.object({
  data: z.unknown(),
  meta: z.record(z.string(), z.unknown()).optional(),
  requestId: z.string().optional(),
});
export type APISuccessResponse = z.infer<typeof APISuccessResponse>;
