import { and, desc, eq, gte, lte, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";

import { getDb } from "../db/index.js";
import { escrows } from "../db/schema.js";
import { requireScope } from "../middleware/auth.js";
import type { AuthContext } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import {
  createEscrow,
  fundEscrow,
  activateEscrow,
  completeEscrow,
  disputeEscrow,
  refundEscrow,
  expireEscrow,
  EscrowTransitionError,
  EscrowNotFoundError,
  EscrowComplianceError,
} from "../services/escrow.js";

// ---------------------------------------------------------------------------
// Request / query schemas
// ---------------------------------------------------------------------------

const CreateEscrowRequest = z.object({
  escrowType: z.enum(["PAYMENT", "SERVICE", "MILESTONE"]),
  payerAgentDid: z.string().min(1),
  payeeAgentDid: z.string().min(1),
  payerWallet: z.string().min(1),
  payeeWallet: z.string().min(1),
  amount: z.string().min(1),
  asset: z.enum(["USDC", "USDT", "EURC", "DAI", "ETH", "WETH"]),
  chain: z.string().min(1),
  conditions: z.record(z.unknown()),
  evaluatorAddress: z.string().optional(),
  expiresAt: z.string().datetime(),
  traceId: z.string().optional(),
});
type CreateEscrowRequest = z.infer<typeof CreateEscrowRequest>;

const EscrowIdParams = z.object({
  id: z.string().uuid("Invalid escrow ID format."),
});

const CompleteEscrowRequest = z.object({
  evaluator: z.string().min(1),
  signature: z.string().min(1),
  result: z.record(z.unknown()),
  timestamp: z.string().datetime(),
});
type CompleteEscrowRequest = z.infer<typeof CompleteEscrowRequest>;

const DisputeEscrowRequest = z.object({
  reason: z.string().min(1).max(2000),
});
type DisputeEscrowRequest = z.infer<typeof DisputeEscrowRequest>;

const ListEscrowsQuery = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  state: z
    .enum(["CREATED", "FUNDED", "ACTIVE", "COMPLETED", "DISPUTED", "REFUNDED", "EXPIRED"])
    .optional(),
  escrowType: z.enum(["PAYMENT", "SERVICE", "MILESTONE"]).optional(),
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
  if (err instanceof EscrowNotFoundError) {
    return c.json(
      { success: false, error: { code: err.code, message: err.message } },
      404,
    );
  }
  if (err instanceof EscrowTransitionError) {
    return c.json(
      {
        success: false,
        error: {
          code: err.code,
          message: err.message,
          from: err.from,
          to: err.to,
          allowed: err.allowed,
          reason: err.reason,
        },
      },
      422,
    );
  }
  if (err instanceof EscrowComplianceError) {
    return c.json(
      { success: false, error: { code: err.code, message: err.message } },
      403,
    );
  }
  throw err;
}

// ---------------------------------------------------------------------------
// Route group
// ---------------------------------------------------------------------------

const escrowRoutes = new Hono();

// POST /v1/escrow — Create escrow
escrowRoutes.post("/", requireScope("write"), validate({ body: CreateEscrowRequest }), async (c) => {
  const parsed = c.get("validatedBody") as CreateEscrowRequest;
  const auth = c.get("auth") as AuthContext;

  try {
    const escrow = await createEscrow({
      ...parsed,
      expiresAt: new Date(parsed.expiresAt),
      apiKeyId: auth.apiKeyId,
    });
    return c.json({ success: true, data: escrow }, 201);
  } catch (err: unknown) {
    return handleServiceError(c, err);
  }
});

// GET /v1/escrow/:id — Get escrow details (tenant-isolated)
escrowRoutes.get("/:id", validate({ params: EscrowIdParams }), async (c) => {
  const { id } = c.get("validatedParams") as z.infer<typeof EscrowIdParams>;
  const auth = c.get("auth") as AuthContext;

  const db = getDb();
  const [escrow] = await db
    .select()
    .from(escrows)
    .where(and(eq(escrows.id, id), eq(escrows.apiKeyId, auth.apiKeyId)))
    .limit(1);

  if (!escrow) {
    return c.json(
      { success: false, error: { code: "NOT_FOUND", message: "Escrow not found." } },
      404,
    );
  }

  return c.json({ success: true, data: escrow }, 200);
});

// POST /v1/escrow/:id/fund — Fund escrow (payer only)
escrowRoutes.post("/:id/fund", requireScope("write"), validate({ params: EscrowIdParams }), async (c) => {
  const { id } = c.get("validatedParams") as z.infer<typeof EscrowIdParams>;
  const auth = c.get("auth") as AuthContext;

  try {
    const escrow = await fundEscrow(id, auth.apiKeyId);
    return c.json({ success: true, data: escrow }, 200);
  } catch (err: unknown) {
    return handleServiceError(c, err);
  }
});

// POST /v1/escrow/:id/activate — Activate escrow (tenant-isolated)
escrowRoutes.post("/:id/activate", requireScope("write"), validate({ params: EscrowIdParams }), async (c) => {
  const { id } = c.get("validatedParams") as z.infer<typeof EscrowIdParams>;
  const auth = c.get("auth") as AuthContext;

  try {
    const escrow = await activateEscrow(id, auth.apiKeyId);
    return c.json({ success: true, data: escrow }, 200);
  } catch (err: unknown) {
    return handleServiceError(c, err);
  }
});

// POST /v1/escrow/:id/complete — Complete with evaluator proof (tenant-isolated)
escrowRoutes.post(
  "/:id/complete",
  requireScope("write"),
  validate({ params: EscrowIdParams, body: CompleteEscrowRequest }),
  async (c) => {
    const { id } = c.get("validatedParams") as z.infer<typeof EscrowIdParams>;
    const proof = c.get("validatedBody") as CompleteEscrowRequest;
    const auth = c.get("auth") as AuthContext;

    try {
      const escrow = await completeEscrow(id, proof, auth.apiKeyId);
      return c.json({ success: true, data: escrow }, 200);
    } catch (err: unknown) {
      return handleServiceError(c, err);
    }
  },
);

// POST /v1/escrow/:id/dispute — Initiate dispute (tenant-isolated)
escrowRoutes.post(
  "/:id/dispute",
  requireScope("write"),
  validate({ params: EscrowIdParams, body: DisputeEscrowRequest }),
  async (c) => {
    const { id } = c.get("validatedParams") as z.infer<typeof EscrowIdParams>;
    const { reason } = c.get("validatedBody") as DisputeEscrowRequest;
    const auth = c.get("auth") as AuthContext;

    try {
      const escrow = await disputeEscrow(id, reason, auth.apiKeyId);
      return c.json({ success: true, data: escrow }, 200);
    } catch (err: unknown) {
      return handleServiceError(c, err);
    }
  },
);

// POST /v1/escrow/:id/refund — Refund after dispute/expiry (tenant-isolated)
escrowRoutes.post("/:id/refund", requireScope("write"), validate({ params: EscrowIdParams }), async (c) => {
  const { id } = c.get("validatedParams") as z.infer<typeof EscrowIdParams>;
  const auth = c.get("auth") as AuthContext;

  try {
    const escrow = await refundEscrow(id, auth.apiKeyId);
    return c.json({ success: true, data: escrow }, 200);
  } catch (err: unknown) {
    return handleServiceError(c, err);
  }
});

// POST /v1/escrow/:id/expire — Check expiry and transition (tenant-isolated)
escrowRoutes.post("/:id/expire", requireScope("write"), validate({ params: EscrowIdParams }), async (c) => {
  const { id } = c.get("validatedParams") as z.infer<typeof EscrowIdParams>;
  const auth = c.get("auth") as AuthContext;

  try {
    const escrow = await expireEscrow(id, auth.apiKeyId);
    return c.json({ success: true, data: escrow }, 200);
  } catch (err: unknown) {
    return handleServiceError(c, err);
  }
});

// GET /v1/escrow — List escrows with pagination (tenant-isolated)
escrowRoutes.get("/", validate({ query: ListEscrowsQuery }), async (c) => {
  const query = c.get("validatedQuery") as z.infer<typeof ListEscrowsQuery>;
  const { page, limit, state, escrowType, payer, payee, from, to } = query;
  const offset = (page - 1) * limit;
  const auth = c.get("auth") as AuthContext;

  const db = getDb();

  const conditions = [eq(escrows.apiKeyId, auth.apiKeyId)];
  if (state) conditions.push(eq(escrows.state, state));
  if (escrowType) conditions.push(eq(escrows.escrowType, escrowType));
  if (payer) conditions.push(eq(escrows.payerWallet, payer));
  if (payee) conditions.push(eq(escrows.payeeWallet, payee));
  if (from) conditions.push(gte(escrows.createdAt, new Date(from)));
  if (to) conditions.push(lte(escrows.createdAt, new Date(to)));

  const whereClause = and(...conditions);

  const [items, countResult] = await Promise.all([
    db
      .select()
      .from(escrows)
      .where(whereClause)
      .orderBy(desc(escrows.createdAt))
      .limit(limit)
      .offset(offset),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(escrows)
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

export { escrowRoutes };
