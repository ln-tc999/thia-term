import { and, desc, eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";

import { getDb } from "../db/index.js";
import { reports } from "../db/schema.js";
import { authMiddleware, requireScope } from "../middleware/auth.js";
import type { AuthContext } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { writeAuditLog } from "../utils/audit.js";

// ---------------------------------------------------------------------------
// Request / query schemas
// ---------------------------------------------------------------------------

const ListQuery = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  type: z.enum(["SAR", "CTR", "TRAVEL_RULE"]).optional(),
  status: z.enum(["DRAFT", "SUBMITTED", "FILED", "REJECTED"]).optional(),
  priority: z.enum(["LOW", "NORMAL", "HIGH", "CRITICAL"]).optional(),
});

const IdParams = z.object({
  id: z.string().uuid("Invalid report ID format."),
});

const UpdateBody = z.object({
  status: z.enum(["DRAFT", "SUBMITTED", "FILED", "REJECTED"]),
});

const ReviewBody = z.object({
  reviewedBy: z.string().min(1).max(256),
});

// ---------------------------------------------------------------------------
// Route group
// ---------------------------------------------------------------------------

const reportRoutes = new Hono();

// All report routes require authentication — SARs/CTRs are confidential
// regulatory documents. Read access requires at minimum the "read" scope.
reportRoutes.use("*", authMiddleware());

// GET /v1/reports — list with pagination + filters
reportRoutes.get("/", requireScope("read"), validate({ query: ListQuery }), async (c) => {
  const query = c.get("validatedQuery") as z.infer<typeof ListQuery>;
  const { page, limit, type, status, priority } = query;
  const offset = (page - 1) * limit;

  const db = getDb();
  const conditions = [];

  if (type) conditions.push(eq(reports.type, type));
  if (status) conditions.push(eq(reports.status, status));
  if (priority) conditions.push(eq(reports.priority, priority));

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const [items, countResult] = await Promise.all([
    db
      .select()
      .from(reports)
      .where(whereClause)
      .orderBy(desc(reports.createdAt))
      .limit(limit)
      .offset(offset),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(reports)
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

// GET /v1/reports/:id — single report
reportRoutes.get("/:id", requireScope("read"), validate({ params: IdParams }), async (c) => {
  const { id } = c.get("validatedParams") as z.infer<typeof IdParams>;
  const db = getDb();

  const [report] = await db
    .select()
    .from(reports)
    .where(eq(reports.id, id))
    .limit(1);

  if (!report) {
    return c.json(
      { success: false, error: { code: "NOT_FOUND", message: "Report not found." } },
      404,
    );
  }

  return c.json({ success: true, data: report });
});

// PATCH /v1/reports/:id — update status (DRAFT→SUBMITTED→FILED)
reportRoutes.patch("/:id", requireScope("admin"), validate({ params: IdParams, body: UpdateBody }), async (c) => {
  const { id } = c.get("validatedParams") as z.infer<typeof IdParams>;
  const { status } = c.get("validatedBody") as z.infer<typeof UpdateBody>;
  const db = getDb();
  const auth = c.get("auth") as AuthContext | undefined;

  const [existing] = await db
    .select()
    .from(reports)
    .where(eq(reports.id, id))
    .limit(1);

  if (!existing) {
    return c.json(
      { success: false, error: { code: "NOT_FOUND", message: "Report not found." } },
      404,
    );
  }

  // Validate state transitions
  const validTransitions: Record<string, string[]> = {
    DRAFT: ["SUBMITTED", "REJECTED"],
    SUBMITTED: ["FILED", "REJECTED"],
    FILED: [],
    REJECTED: ["DRAFT"],
  };

  const allowed = validTransitions[existing.status] ?? [];
  if (!allowed.includes(status)) {
    return c.json(
      {
        success: false,
        error: {
          code: "INVALID_TRANSITION",
          message: `Cannot transition from ${existing.status} to ${status}.`,
        },
      },
      422,
    );
  }

  const updateValues: Record<string, unknown> = {
    status,
    updatedAt: new Date(),
  };

  if (status === "FILED") {
    updateValues["filedAt"] = new Date();
  }

  // Optimistic concurrency: only update if status hasn't changed since we
  // read it — prevents two concurrent PATCHes from double-transitioning.
  const [updated] = await db
    .update(reports)
    .set(updateValues)
    .where(and(eq(reports.id, id), eq(reports.status, existing.status)))
    .returning();

  if (!updated) {
    return c.json(
      {
        success: false,
        error: {
          code: "CONFLICT",
          message: "Report status was modified concurrently. Re-fetch and retry.",
        },
      },
      409,
    );
  }

  writeAuditLog({
    eventType: "report.status.updated",
    payload: { reportId: id, from: existing.status, to: status },
    apiKeyId: auth?.apiKeyId,
  });

  return c.json({ success: true, data: updated });
});

// POST /v1/reports/:id/review — mark as reviewed
reportRoutes.post("/:id/review", requireScope("admin"), validate({ params: IdParams, body: ReviewBody }), async (c) => {
  const { id } = c.get("validatedParams") as z.infer<typeof IdParams>;
  // reviewedBy from body is accepted as a display label but the audit log
  // always records the verified auth identity (ownerId) — not the user-supplied string.
  const { reviewedBy } = c.get("validatedBody") as z.infer<typeof ReviewBody>;
  const db = getDb();
  const auth = c.get("auth") as AuthContext | undefined;
  // Bind review attribution to the verified caller identity, not the request body.
  const reviewerIdentity = auth ? `${auth.ownerId} (${reviewedBy})` : reviewedBy;

  const [existing] = await db
    .select()
    .from(reports)
    .where(eq(reports.id, id))
    .limit(1);

  if (!existing) {
    return c.json(
      { success: false, error: { code: "NOT_FOUND", message: "Report not found." } },
      404,
    );
  }

  const [updated] = await db
    .update(reports)
    .set({
      reviewedBy: reviewerIdentity,
      updatedAt: new Date(),
    })
    .where(eq(reports.id, id))
    .returning();

  writeAuditLog({
    eventType: "report.reviewed",
    payload: { reportId: id, reviewedBy: reviewerIdentity, reviewerOwnerId: auth?.ownerId },
    apiKeyId: auth?.apiKeyId,
  });

  return c.json({ success: true, data: updated });
});

export { reportRoutes };
