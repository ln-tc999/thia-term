import { and, desc, eq, gte, ilike, lte, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";

import { getDb } from "../db/index.js";
import { invoices } from "../db/schema.js";
import type { AuthContext } from "../middleware/auth.js";
import { requireScope } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";

// ---------------------------------------------------------------------------
// Request / query schemas
// ---------------------------------------------------------------------------

const CreateInvoiceRequest = z.object({
  seller: z.object({
    agentId: z.string().optional(),
    walletAddress: z.string().min(1),
    legalName: z.string().optional(),
  }),
  buyer: z.object({
    agentId: z.string().optional(),
    walletAddress: z.string().min(1),
    legalName: z.string().optional(),
  }),
  lineItems: z
    .array(
      z.object({
        description: z.string(),
        quantity: z.number().positive(),
        unit: z.string().default("unit"),
        unitPrice: z.number().nonnegative(),
        total: z.number().nonnegative(),
        serviceCategory: z
          .enum(["compute", "data", "api_call", "content_generation", "analysis", "transaction_fee", "other"])
          .optional(),
      }),
    )
    .min(1),
  currency: z.enum(["USDC", "USDT", "USD", "EUR", "GBP", "EURC"]),
  totalAmount: z.number().nonnegative(),
  paymentProtocol: z.enum(["x402", "mpp", "ap2", "acp", "direct"]).optional(),
  dueDate: z.string().datetime().optional(),
}).superRefine((data, ctx) => {
  const lineItemsSum = data.lineItems.reduce((sum, item) => sum + item.total, 0);
  // Allow a small floating-point tolerance (0.01)
  if (Math.abs(data.totalAmount - lineItemsSum) > 0.01) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `totalAmount (${data.totalAmount}) does not match sum of line item totals (${lineItemsSum})`,
      path: ["totalAmount"],
    });
  }
});
type CreateInvoiceRequest = z.infer<typeof CreateInvoiceRequest>;

const UpdateStateRequest = z.object({
  state: z.enum(["DRAFT", "ISSUED", "PAID", "SETTLED", "DISPUTED", "CANCELLED"]),
  reason: z.string().optional(),
});
type UpdateStateRequest = z.infer<typeof UpdateStateRequest>;

const InvoiceIdParams = z.object({
  id: z.string().uuid("Invalid invoice ID format."),
});

const ListInvoicesQuery = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  state: z.enum(["DRAFT", "ISSUED", "PAID", "SETTLED", "DISPUTED", "CANCELLED"]).optional(),
  currency: z.enum(["USDC", "USDT", "USD", "EUR", "GBP", "EURC"]).optional(),
  seller: z.string().optional(),
  buyer: z.string().optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});

// Valid state transitions
const STATE_TRANSITIONS: Record<string, string[]> = {
  DRAFT: ["ISSUED", "CANCELLED"],
  ISSUED: ["PAID", "DISPUTED", "CANCELLED"],
  PAID: ["SETTLED", "DISPUTED"],
  SETTLED: [],
  DISPUTED: ["ISSUED", "CANCELLED"],
  CANCELLED: [],
};

// ---------------------------------------------------------------------------
// Route group
// ---------------------------------------------------------------------------

const invoiceRoutes = new Hono();

// POST /v1/invoices -- Create invoice
invoiceRoutes.post("/", requireScope("write"), validate({ body: CreateInvoiceRequest }), async (c) => {
  const parsed = c.get("validatedBody") as CreateInvoiceRequest;
  const auth = c.get("auth") as AuthContext | undefined;

  const db = getDb();

  const issuerDid = parsed.seller.agentId ?? parsed.seller.walletAddress;
  const recipientDid = parsed.buyer.agentId ?? parsed.buyer.walletAddress;

  const [invoice] = await db
    .insert(invoices)
    .values({
      issuerAgentDid: issuerDid,
      recipientAgentDid: recipientDid,
      sellerWalletAddress: parsed.seller.walletAddress,
      buyerWalletAddress: parsed.buyer.walletAddress,
      currency: parsed.currency,
      totalAmount: String(parsed.totalAmount),
      state: "DRAFT",
      lineItems: parsed.lineItems,
      paymentProtocol: parsed.paymentProtocol,
      dueDate: parsed.dueDate ? new Date(parsed.dueDate) : null,
      apiKeyId: auth?.apiKeyId,
      invoiceData: {
        seller: parsed.seller,
        buyer: parsed.buyer,
        lineItems: parsed.lineItems,
        currency: parsed.currency,
        totalAmount: parsed.totalAmount,
        paymentProtocol: parsed.paymentProtocol,
      },
    })
    .returning();

  if (!invoice) {
    return c.json(
      { success: false, error: { code: "INTERNAL_ERROR", message: "Failed to create invoice." } },
      500,
    );
  }

  return c.json({ success: true, data: invoice }, 201);
});

// GET /v1/invoices/:id -- Get invoice
invoiceRoutes.get("/:id", validate({ params: InvoiceIdParams }), async (c) => {
  const { id: invoiceId } = c.get("validatedParams") as z.infer<typeof InvoiceIdParams>;
  const auth = c.get("auth") as AuthContext | undefined;

  const db = getDb();

  // Scope by apiKeyId to enforce tenant isolation
  const conditions = [eq(invoices.id, invoiceId)];
  if (auth?.apiKeyId) {
    conditions.push(eq(invoices.apiKeyId, auth.apiKeyId));
  }

  const [invoice] = await db
    .select()
    .from(invoices)
    .where(and(...conditions))
    .limit(1);

  if (!invoice) {
    return c.json(
      { success: false, error: { code: "NOT_FOUND", message: "Invoice not found." } },
      404,
    );
  }

  return c.json({ success: true, data: invoice }, 200);
});

// PATCH /v1/invoices/:id/state -- Update invoice state
invoiceRoutes.patch(
  "/:id/state",
  requireScope("write"),
  validate({ params: InvoiceIdParams, body: UpdateStateRequest }),
  async (c) => {
    const { id: invoiceId } = c.get("validatedParams") as z.infer<typeof InvoiceIdParams>;
    const parsed = c.get("validatedBody") as UpdateStateRequest;
    const auth = c.get("auth") as AuthContext | undefined;

    const db = getDb();

    // Scope by apiKeyId to enforce tenant isolation
    const conditions = [eq(invoices.id, invoiceId)];
    if (auth?.apiKeyId) {
      conditions.push(eq(invoices.apiKeyId, auth.apiKeyId));
    }

    const [existing] = await db
      .select()
      .from(invoices)
      .where(and(...conditions))
      .limit(1);

    if (!existing) {
      return c.json(
        { success: false, error: { code: "NOT_FOUND", message: "Invoice not found." } },
        404,
      );
    }

    const allowedTransitions = STATE_TRANSITIONS[existing.state] ?? [];
    if (!allowedTransitions.includes(parsed.state)) {
      return c.json(
        {
          success: false,
          error: {
            code: "INVALID_STATE_TRANSITION",
            message: `Cannot transition from ${existing.state} to ${parsed.state}. Allowed: ${allowedTransitions.join(", ") || "none"}.`,
          },
        },
        422,
      );
    }

    const [updated] = await db
      .update(invoices)
      .set({ state: parsed.state, updatedAt: new Date() })
      .where(eq(invoices.id, invoiceId))
      .returning();

    return c.json({ success: true, data: updated }, 200);
  },
);

// GET /v1/invoices -- List invoices (paginated, filterable)
invoiceRoutes.get("/", validate({ query: ListInvoicesQuery }), async (c) => {
  const query = c.get("validatedQuery") as z.infer<typeof ListInvoicesQuery>;
  const { page, limit, state, currency, seller, buyer, from, to } = query;
  const offset = (page - 1) * limit;
  const auth = c.get("auth") as AuthContext | undefined;

  const db = getDb();

  const conditions = [];
  if (auth?.apiKeyId) {
    conditions.push(eq(invoices.apiKeyId, auth.apiKeyId));
  }
  if (state) conditions.push(eq(invoices.state, state));
  if (currency) conditions.push(eq(invoices.currency, currency));
  if (seller) conditions.push(ilike(invoices.sellerWalletAddress, `${seller}%`));
  if (buyer) conditions.push(ilike(invoices.buyerWalletAddress, `${buyer}%`));
  if (from) conditions.push(gte(invoices.createdAt, new Date(from)));
  if (to) conditions.push(lte(invoices.createdAt, new Date(to)));

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const [items, countResult] = await Promise.all([
    db
      .select()
      .from(invoices)
      .where(whereClause)
      .orderBy(desc(invoices.createdAt))
      .limit(limit)
      .offset(offset),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(invoices)
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

export { invoiceRoutes };
