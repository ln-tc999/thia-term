import { and, desc, eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { createHash } from "node:crypto";
import { z } from "zod";

import { getDb } from "../db/index.js";
import { complianceChecks, complianceReceipts } from "../db/schema.js";
import type { AuthContext } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";

// ---------------------------------------------------------------------------
// Request schemas
// ---------------------------------------------------------------------------

const ReceiptIdParams = z.object({
  id: z.string().uuid("Invalid receipt ID format."),
});

const ListReceiptsQuery = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(["APPROVED", "REJECTED", "ESCALATED"]).optional(),
});

// ---------------------------------------------------------------------------
// Route group
// ---------------------------------------------------------------------------

const receipts = new Hono();

// GET /v1/receipts/:id -- Get a compliance receipt by ID
receipts.get("/:id", validate({ params: ReceiptIdParams }), async (c) => {
  const { id: receiptId } = c.get("validatedParams") as z.infer<typeof ReceiptIdParams>;
  const auth = c.get("auth") as AuthContext | undefined;

  const db = getDb();

  // Join through complianceChecks to enforce tenant isolation via apiKeyId
  const conditions = [eq(complianceReceipts.id, receiptId)];
  if (auth?.apiKeyId) {
    conditions.push(eq(complianceChecks.apiKeyId, auth.apiKeyId));
  }

  const [receipt] = await db
    .select({
      id: complianceReceipts.id,
      checkId: complianceReceipts.checkId,
      receiptHash: complianceReceipts.receiptHash,
      overallStatus: complianceReceipts.overallStatus,
      riskScore: complianceReceipts.riskScore,
      travelRuleStatus: complianceReceipts.travelRuleStatus,
      easAttestationUid: complianceReceipts.easAttestationUid,
      ipfsCid: complianceReceipts.ipfsCid,
      signature: complianceReceipts.signature,
      checksPerformed: complianceReceipts.checksPerformed,
      ttl: complianceReceipts.ttl,
      createdAt: complianceReceipts.createdAt,
    })
    .from(complianceReceipts)
    .innerJoin(complianceChecks, eq(complianceReceipts.checkId, complianceChecks.id))
    .where(and(...conditions))
    .limit(1);

  if (!receipt) {
    return c.json(
      { success: false, error: { code: "NOT_FOUND", message: "Receipt not found." } },
      404,
    );
  }

  return c.json({ success: true, data: receipt }, 200);
});

// GET /v1/receipts -- List receipts with pagination
receipts.get("/", validate({ query: ListReceiptsQuery }), async (c) => {
  const query = c.get("validatedQuery") as z.infer<typeof ListReceiptsQuery>;
  const { page, limit, status } = query;
  const offset = (page - 1) * limit;
  const auth = c.get("auth") as AuthContext | undefined;

  const db = getDb();

  const conditions = [];
  if (auth?.apiKeyId) {
    conditions.push(eq(complianceChecks.apiKeyId, auth.apiKeyId));
  }
  if (status) {
    conditions.push(eq(complianceReceipts.overallStatus, status));
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const selectFields = {
    id: complianceReceipts.id,
    checkId: complianceReceipts.checkId,
    receiptHash: complianceReceipts.receiptHash,
    overallStatus: complianceReceipts.overallStatus,
    riskScore: complianceReceipts.riskScore,
    travelRuleStatus: complianceReceipts.travelRuleStatus,
    easAttestationUid: complianceReceipts.easAttestationUid,
    ipfsCid: complianceReceipts.ipfsCid,
    signature: complianceReceipts.signature,
    checksPerformed: complianceReceipts.checksPerformed,
    ttl: complianceReceipts.ttl,
    createdAt: complianceReceipts.createdAt,
  };

  const [items, countResult] = await Promise.all([
    db
      .select(selectFields)
      .from(complianceReceipts)
      .innerJoin(complianceChecks, eq(complianceReceipts.checkId, complianceChecks.id))
      .where(whereClause)
      .orderBy(desc(complianceReceipts.createdAt))
      .limit(limit)
      .offset(offset),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(complianceReceipts)
      .innerJoin(complianceChecks, eq(complianceReceipts.checkId, complianceChecks.id))
      .where(whereClause),
  ]);

  const total = countResult[0]?.count ?? 0;

  return c.json(
    {
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
    },
    200,
  );
});

// POST /v1/receipts/:id/verify -- Verify receipt integrity
receipts.post("/:id/verify", validate({ params: ReceiptIdParams }), async (c) => {
  const { id: receiptId } = c.get("validatedParams") as z.infer<typeof ReceiptIdParams>;
  const auth = c.get("auth") as AuthContext | undefined;

  const db = getDb();

  // Join through complianceChecks to enforce tenant isolation via apiKeyId
  const conditions = [eq(complianceReceipts.id, receiptId)];
  if (auth?.apiKeyId) {
    conditions.push(eq(complianceChecks.apiKeyId, auth.apiKeyId));
  }

  const [receipt] = await db
    .select({
      id: complianceReceipts.id,
      checkId: complianceReceipts.checkId,
      receiptHash: complianceReceipts.receiptHash,
      overallStatus: complianceReceipts.overallStatus,
      riskScore: complianceReceipts.riskScore,
      travelRuleStatus: complianceReceipts.travelRuleStatus,
      easAttestationUid: complianceReceipts.easAttestationUid,
      ipfsCid: complianceReceipts.ipfsCid,
      signature: complianceReceipts.signature,
      checksPerformed: complianceReceipts.checksPerformed,
      ttl: complianceReceipts.ttl,
      createdAt: complianceReceipts.createdAt,
    })
    .from(complianceReceipts)
    .innerJoin(complianceChecks, eq(complianceReceipts.checkId, complianceChecks.id))
    .where(and(...conditions))
    .limit(1);

  if (!receipt) {
    return c.json(
      { success: false, error: { code: "NOT_FOUND", message: "Receipt not found." } },
      404,
    );
  }

  // Verify integrity by recomputing hash from receipt data
  const payload = JSON.stringify({
    checkId: receipt.checkId,
    overallStatus: receipt.overallStatus,
    riskScore: receipt.riskScore,
    travelRuleStatus: receipt.travelRuleStatus,
    checksPerformed: receipt.checksPerformed,
  });

  const computedHash = `0x${createHash("sha256").update(payload).digest("hex")}`;

  // Check TTL expiration
  const createdAtMs = receipt.createdAt.getTime();
  const ttlMs = receipt.ttl * 1000;
  const isExpired = Date.now() > createdAtMs + ttlMs;

  // Check if signature is a placeholder (not yet signed with real key)
  const hasRealSignature = receipt.signature !== `0x${"0".repeat(128)}`;

  return c.json(
    {
      success: true,
      data: {
        receiptId: receipt.id,
        receiptHash: receipt.receiptHash,
        computedHash,
        hashValid: receipt.receiptHash === computedHash,
        signaturePresent: hasRealSignature,
        isExpired,
        ttl: receipt.ttl,
        createdAt: receipt.createdAt.toISOString(),
        expiresAt: new Date(createdAtMs + ttlMs).toISOString(),
        overallStatus: receipt.overallStatus,
        riskScore: receipt.riskScore,
      },
    },
    200,
  );
});

export { receipts };
