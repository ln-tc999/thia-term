import { and, desc, eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import type { Context } from "hono";
import { z } from "zod";

import { getDb } from "../db/index.js";
import { disputes } from "../db/schema.js";
import { requireScope } from "../middleware/auth.js";
import type { AuthContext } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import {
  DISPUTE_CATEGORIES,
  RESOLUTION_OUTCOMES,
  DisputeNotFoundError,
  DisputeTransitionError,
  closeDispute,
  escalateToArbitration,
  openDispute,
  resolveDispute,
  submitEvidence,
} from "../services/disputes.js";

// ---------------------------------------------------------------------------
// Request / query schemas
// ---------------------------------------------------------------------------

const CreateDisputeBody = z.object({
  escrowId: z.string().uuid().optional(),
  invoiceId: z.string().uuid().optional(),
  initiatorDid: z.string().min(1).max(256),
  respondentDid: z.string().min(1).max(256),
  reason: z.string().min(1).max(2000),
  category: z.enum(DISPUTE_CATEGORIES),
  traceId: z.string().max(64).optional(),
}).refine(
  (data) => data.escrowId != null || data.invoiceId != null,
  { message: "At least one of escrowId or invoiceId is required.", path: ["escrowId"] },
);

const IdParams = z.object({
  id: z.string().uuid("Invalid dispute ID format."),
});

const EvidenceBody = z.object({
  submittedBy: z.string().min(1).max(256),
  type: z.string().min(1).max(50),
  description: z.string().min(1).max(2000),
  data: z.record(z.unknown()).optional(),
});

const ResolveBody = z.object({
  outcome: z.enum(RESOLUTION_OUTCOMES),
  resolvedBy: z.string().min(1).max(256),
  notes: z.string().max(2000).optional(),
  refundAmount: z.string().optional(),
});

const ListQuery = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  state: z.enum(["OPEN", "EVIDENCE", "ARBITRATION", "RESOLVED", "CLOSED"]).optional(),
  category: z.enum(DISPUTE_CATEGORIES).optional(),
  initiatorDid: z.string().optional(),
  respondentDid: z.string().optional(),
});

// ---------------------------------------------------------------------------
// Error response helper
// ---------------------------------------------------------------------------

function handleServiceError(c: Context, error: unknown) {
  if (error instanceof DisputeNotFoundError) {
    return c.json(
      { success: false, error: { code: error.code, message: error.message } },
      404,
    );
  }
  if (error instanceof DisputeTransitionError) {
    return c.json(
      {
        success: false,
        error: {
          code: error.code,
          message: error.message,
          allowed: error.allowed,
        },
      },
      422,
    );
  }
  throw error;
}

// ---------------------------------------------------------------------------
// Route group
// ---------------------------------------------------------------------------

const disputeRoutes = new Hono();

// POST /v1/disputes — open a new dispute (tenant-isolated)
disputeRoutes.post("/", requireScope("write"), validate({ body: CreateDisputeBody }), async (c) => {
  const body = c.get("validatedBody") as z.infer<typeof CreateDisputeBody>;
  const auth = c.get("auth") as AuthContext;

  const dispute = await openDispute({
    ...body,
    apiKeyId: auth.apiKeyId,
  });

  return c.json({ success: true, data: dispute }, 201);
});

// GET /v1/disputes — list disputes with filters + pagination (tenant-isolated)
disputeRoutes.get("/", validate({ query: ListQuery }), async (c) => {
  const query = c.get("validatedQuery") as z.infer<typeof ListQuery>;
  const { page, limit, state, category, initiatorDid, respondentDid } = query;
  const offset = (page - 1) * limit;
  const auth = c.get("auth") as AuthContext;

  const db = getDb();
  const conditions = [eq(disputes.apiKeyId, auth.apiKeyId)];

  if (state) conditions.push(eq(disputes.state, state));
  if (category) conditions.push(eq(disputes.category, category));
  if (initiatorDid) conditions.push(eq(disputes.initiatorDid, initiatorDid));
  if (respondentDid) conditions.push(eq(disputes.respondentDid, respondentDid));

  const whereClause = and(...conditions);

  const [items, countResult] = await Promise.all([
    db
      .select()
      .from(disputes)
      .where(whereClause)
      .orderBy(desc(disputes.createdAt))
      .limit(limit)
      .offset(offset),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(disputes)
      .where(whereClause),
  ]);

  const total = countResult[0]?.count ?? 0;

  return c.json({
    success: true,
    data: {
      items,
      pagination: {
        page,
        pageSize: limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    },
  });
});

// GET /v1/disputes/:id — get dispute details (tenant-isolated)
disputeRoutes.get("/:id", validate({ params: IdParams }), async (c) => {
  const { id } = c.get("validatedParams") as z.infer<typeof IdParams>;
  const auth = c.get("auth") as AuthContext;
  const db = getDb();

  const [dispute] = await db
    .select()
    .from(disputes)
    .where(and(eq(disputes.id, id), eq(disputes.apiKeyId, auth.apiKeyId)))
    .limit(1);

  if (!dispute) {
    return c.json(
      { success: false, error: { code: "NOT_FOUND", message: "Dispute not found." } },
      404,
    );
  }

  return c.json({ success: true, data: dispute });
});

// POST /v1/disputes/:id/evidence — submit evidence (tenant-isolated)
disputeRoutes.post("/:id/evidence", requireScope("write"), validate({ params: IdParams, body: EvidenceBody }), async (c) => {
  const { id } = c.get("validatedParams") as z.infer<typeof IdParams>;
  const body = c.get("validatedBody") as z.infer<typeof EvidenceBody>;
  const auth = c.get("auth") as AuthContext;

  try {
    const dispute = await submitEvidence(id, body, auth.apiKeyId);
    return c.json({ success: true, data: dispute });
  } catch (error: unknown) {
    return handleServiceError(c, error);
  }
});

// POST /v1/disputes/:id/escalate — escalate to arbitration (tenant-isolated)
disputeRoutes.post("/:id/escalate", requireScope("write"), validate({ params: IdParams }), async (c) => {
  const { id } = c.get("validatedParams") as z.infer<typeof IdParams>;
  const auth = c.get("auth") as AuthContext;

  try {
    const dispute = await escalateToArbitration(id, auth.apiKeyId);
    return c.json({ success: true, data: dispute });
  } catch (error: unknown) {
    return handleServiceError(c, error);
  }
});

// POST /v1/disputes/:id/resolve — resolve (admin scope required, tenant-isolated)
disputeRoutes.post(
  "/:id/resolve",
  requireScope("admin"),
  validate({ params: IdParams, body: ResolveBody }),
  async (c) => {
    const { id } = c.get("validatedParams") as z.infer<typeof IdParams>;
    const body = c.get("validatedBody") as z.infer<typeof ResolveBody>;
    const auth = c.get("auth") as AuthContext;

    try {
      const dispute = await resolveDispute(id, body, auth.apiKeyId);
      return c.json({ success: true, data: dispute });
    } catch (error: unknown) {
      return handleServiceError(c, error);
    }
  },
);

// POST /v1/disputes/:id/close — close after resolution executed (tenant-isolated)
disputeRoutes.post("/:id/close", requireScope("write"), validate({ params: IdParams }), async (c) => {
  const { id } = c.get("validatedParams") as z.infer<typeof IdParams>;
  const auth = c.get("auth") as AuthContext;

  try {
    const dispute = await closeDispute(id, auth.apiKeyId);
    return c.json({ success: true, data: dispute });
  } catch (error: unknown) {
    return handleServiceError(c, error);
  }
});

export { disputeRoutes };
