import { requireScope } from "../middleware/auth.js";
import type { AuthContext } from "../middleware/auth.js";
import { and, desc, eq, gte, lte, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";

import { getDb } from "../db/index.js";
import { paymentStreams } from "../db/schema.js";
import { validate } from "../middleware/validate.js";
import {
  createStream,
  recordStreamUsage,
  pauseStream,
  resumeStream,
  settleStream,
  getStreamStatus,
  StreamNotFoundError,
  StreamTransitionError,
  StreamBudgetExceededError,
} from "../services/streaming-payments.js";

// ---------------------------------------------------------------------------
// Request / query schemas
// ---------------------------------------------------------------------------

const StreamModel = z.enum([
  "PER_REQUEST",
  "PER_SECOND",
  "PER_TOKEN",
  "PER_RESULT",
  "MILESTONE",
]);

const CreateStreamRequest = z.object({
  payerDid: z.string().min(1),
  payeeDid: z.string().min(1),
  model: StreamModel,
  ratePerUnit: z.string().min(1),
  unit: z.string().min(1).max(64),
  totalBudget: z.string().min(1),
  expiresAt: z.string().datetime(),
  traceId: z.string().optional(),
});
type CreateStreamRequest = z.infer<typeof CreateStreamRequest>;

const StreamIdParams = z.object({
  id: z.string().uuid("Invalid stream ID format."),
});

const RecordUsageRequest = z.object({
  units: z.string().min(1),
  metadata: z.record(z.unknown()).optional(),
});
type RecordUsageRequest = z.infer<typeof RecordUsageRequest>;

const ListStreamsQuery = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(["ACTIVE", "PAUSED", "SETTLED", "EXHAUSTED"]).optional(),
  model: StreamModel.optional(),
  payer: z.string().optional(),
  payee: z.string().optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});

// ---------------------------------------------------------------------------
// Error handler helper
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function handleServiceError(c: any, err: unknown) {
  if (err instanceof StreamNotFoundError) {
    return c.json(
      { success: false, error: { code: err.code, message: err.message } },
      404,
    );
  }
  if (err instanceof StreamTransitionError) {
    return c.json(
      {
        success: false,
        error: {
          code: err.code,
          message: err.message,
          currentStatus: err.currentStatus,
          targetStatus: err.targetStatus,
        },
      },
      422,
    );
  }
  if (err instanceof StreamBudgetExceededError) {
    return c.json(
      {
        success: false,
        error: {
          code: err.code,
          message: err.message,
          requested: err.requested,
          remaining: err.remaining,
        },
      },
      422,
    );
  }
  throw err;
}

// ---------------------------------------------------------------------------
// Route group
// ---------------------------------------------------------------------------

const streamRoutes = new Hono();

// POST /v1/streams — Create a payment stream (tenant-isolated)
streamRoutes.post("/", requireScope("write"), validate({ body: CreateStreamRequest }), async (c) => {
  const parsed = c.get("validatedBody") as CreateStreamRequest;
  const auth = c.get("auth") as AuthContext;

  try {
    const stream = await createStream({
      ...parsed,
      expiresAt: new Date(parsed.expiresAt),
      apiKeyId: auth.apiKeyId,
    });
    return c.json({ success: true, data: stream }, 201);
  } catch (err: unknown) {
    return handleServiceError(c, err);
  }
});

// GET /v1/streams/:id — Get stream status with computed fields (tenant-isolated)
streamRoutes.get("/:id", validate({ params: StreamIdParams }), async (c) => {
  const { id } = c.get("validatedParams") as z.infer<typeof StreamIdParams>;
  const auth = c.get("auth") as AuthContext;

  try {
    const status = await getStreamStatus(id, auth.apiKeyId);
    return c.json({ success: true, data: status }, 200);
  } catch (err: unknown) {
    return handleServiceError(c, err);
  }
});

// POST /v1/streams/:id/usage — Record usage against a stream (tenant-isolated)
streamRoutes.post(
  "/:id/usage", requireScope("write"),
  validate({ params: StreamIdParams, body: RecordUsageRequest }),
  async (c) => {
    const { id } = c.get("validatedParams") as z.infer<typeof StreamIdParams>;
    const body = c.get("validatedBody") as RecordUsageRequest;
    const auth = c.get("auth") as AuthContext;

    try {
      const stream = await recordStreamUsage(id, body, auth.apiKeyId);
      return c.json({ success: true, data: stream }, 200);
    } catch (err: unknown) {
      return handleServiceError(c, err);
    }
  },
);

// POST /v1/streams/:id/pause — Pause an active stream (tenant-isolated)
streamRoutes.post(
  "/:id/pause", requireScope("write"),
  validate({ params: StreamIdParams }),
  async (c) => {
    const { id } = c.get("validatedParams") as z.infer<typeof StreamIdParams>;
    const auth = c.get("auth") as AuthContext;

    try {
      const stream = await pauseStream(id, auth.apiKeyId);
      return c.json({ success: true, data: stream }, 200);
    } catch (err: unknown) {
      return handleServiceError(c, err);
    }
  },
);

// POST /v1/streams/:id/resume — Resume a paused stream (tenant-isolated)
streamRoutes.post(
  "/:id/resume", requireScope("write"),
  validate({ params: StreamIdParams }),
  async (c) => {
    const { id } = c.get("validatedParams") as z.infer<typeof StreamIdParams>;
    const auth = c.get("auth") as AuthContext;

    try {
      const stream = await resumeStream(id, auth.apiKeyId);
      return c.json({ success: true, data: stream }, 200);
    } catch (err: unknown) {
      return handleServiceError(c, err);
    }
  },
);

// POST /v1/streams/:id/settle — Settle and close a stream (tenant-isolated)
streamRoutes.post(
  "/:id/settle", requireScope("write"),
  validate({ params: StreamIdParams }),
  async (c) => {
    const { id } = c.get("validatedParams") as z.infer<typeof StreamIdParams>;
    const auth = c.get("auth") as AuthContext;

    try {
      const stream = await settleStream(id, auth.apiKeyId);
      return c.json({ success: true, data: stream }, 200);
    } catch (err: unknown) {
      return handleServiceError(c, err);
    }
  },
);

// GET /v1/streams — List streams with filters and pagination (tenant-isolated)
streamRoutes.get("/", validate({ query: ListStreamsQuery }), async (c) => {
  const query = c.get("validatedQuery") as z.infer<typeof ListStreamsQuery>;
  const { page, limit, status, model, payer, payee, from, to } = query;
  const offset = (page - 1) * limit;
  const auth = c.get("auth") as AuthContext;

  const db = getDb();

  const conditions = [eq(paymentStreams.apiKeyId, auth.apiKeyId)];
  if (status) conditions.push(eq(paymentStreams.status, status));
  if (model) conditions.push(eq(paymentStreams.model, model));
  if (payer) conditions.push(eq(paymentStreams.payerDid, payer));
  if (payee) conditions.push(eq(paymentStreams.payeeDid, payee));
  if (from) conditions.push(gte(paymentStreams.createdAt, new Date(from)));
  if (to) conditions.push(lte(paymentStreams.createdAt, new Date(to)));

  const whereClause = and(...conditions);

  const [items, countResult] = await Promise.all([
    db
      .select()
      .from(paymentStreams)
      .where(whereClause)
      .orderBy(desc(paymentStreams.createdAt))
      .limit(limit)
      .offset(offset),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(paymentStreams)
      .where(whereClause),
  ]);

  const total = countResult[0]?.count ?? 0;

  return c.json(
    {
      success: true,
      data: {
        items,
        pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
      },
    },
    200,
  );
});

export { streamRoutes };
