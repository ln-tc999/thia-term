import { and, desc, eq, gte, lte, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";

import { getDb } from "../db/index.js";
import { complianceChecks, invoices } from "../db/schema.js";
import type { AuthContext } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";

// ---------------------------------------------------------------------------
// Query schemas
// ---------------------------------------------------------------------------

const TimeRangeQuery = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  /** Granularity: "hour", "day", "week", "month" */
  granularity: z.enum(["hour", "day", "week", "month"]).default("day"),
});

const AgentsQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(10),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});

// ---------------------------------------------------------------------------
// Granularity to Postgres date_trunc interval
// ---------------------------------------------------------------------------

function toDateTrunc(granularity: string): string {
  switch (granularity) {
    case "hour":
      return "hour";
    case "day":
      return "day";
    case "week":
      return "week";
    case "month":
      return "month";
    default:
      return "day";
  }
}

// ---------------------------------------------------------------------------
// Route group
// ---------------------------------------------------------------------------

const analytics = new Hono();

// GET /v1/analytics/volume -- Transaction volume over time
analytics.get("/volume", validate({ query: TimeRangeQuery }), async (c) => {
  const query = c.get("validatedQuery") as z.infer<typeof TimeRangeQuery>;
  const { from, to, granularity } = query;
  const truncInterval = toDateTrunc(granularity);
  const auth = c.get("auth") as AuthContext | undefined;

  const db = getDb();

  const conditions = [];
  if (auth?.apiKeyId) conditions.push(eq(invoices.apiKeyId, auth.apiKeyId));
  if (from) conditions.push(gte(invoices.createdAt, new Date(from)));
  if (to) conditions.push(lte(invoices.createdAt, new Date(to)));

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const result = await db
    .select({
      period: sql<string>`date_trunc(${sql.raw(`'${truncInterval}'`)}, ${invoices.createdAt})::text`.as("period"),
      count: sql<number>`count(*)::int`.as("count"),
      totalAmount: sql<string>`coalesce(sum(${invoices.totalAmount}), 0)::text`.as("total_amount"),
      currency: invoices.currency,
    })
    .from(invoices)
    .where(whereClause)
    .groupBy(
      sql`date_trunc(${sql.raw(`'${truncInterval}'`)}, ${invoices.createdAt})`,
      invoices.currency,
    )
    .orderBy(sql`date_trunc(${sql.raw(`'${truncInterval}'`)}, ${invoices.createdAt})`);

  return c.json(
    {
      success: true,
      data: {
        granularity,
        buckets: result,
      },
    },
    200,
  );
});

// GET /v1/analytics/compliance -- Compliance decision breakdown
analytics.get("/compliance", validate({ query: TimeRangeQuery }), async (c) => {
  const query = c.get("validatedQuery") as z.infer<typeof TimeRangeQuery>;
  const { from, to } = query;
  const auth = c.get("auth") as AuthContext | undefined;

  const db = getDb();

  const conditions = [];
  if (auth?.apiKeyId) conditions.push(eq(complianceChecks.apiKeyId, auth.apiKeyId));
  if (from) conditions.push(gte(complianceChecks.createdAt, new Date(from)));
  if (to) conditions.push(lte(complianceChecks.createdAt, new Date(to)));

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const [breakdown, totalResult] = await Promise.all([
    db
      .select({
        status: complianceChecks.status,
        count: sql<number>`count(*)::int`.as("count"),
        avgRiskScore: sql<number>`round(avg(${complianceChecks.riskScore}))::int`.as("avg_risk_score"),
        avgDurationMs: sql<number>`round(avg(${complianceChecks.totalDurationMs}))::int`.as("avg_duration_ms"),
      })
      .from(complianceChecks)
      .where(whereClause)
      .groupBy(complianceChecks.status),
    db
      .select({
        total: sql<number>`count(*)::int`.as("total"),
      })
      .from(complianceChecks)
      .where(whereClause),
  ]);

  const total = totalResult[0]?.total ?? 0;

  return c.json(
    {
      success: true,
      data: {
        total,
        breakdown: breakdown.map((row) => ({
          ...row,
          percentage: total > 0 ? Math.round((row.count / total) * 10000) / 100 : 0,
        })),
      },
    },
    200,
  );
});

// GET /v1/analytics/risk -- Risk score distribution
analytics.get("/risk", validate({ query: TimeRangeQuery }), async (c) => {
  const query = c.get("validatedQuery") as z.infer<typeof TimeRangeQuery>;
  const { from, to } = query;
  const auth = c.get("auth") as AuthContext | undefined;

  const db = getDb();

  const conditions = [];
  if (auth?.apiKeyId) conditions.push(eq(complianceChecks.apiKeyId, auth.apiKeyId));
  if (from) conditions.push(gte(complianceChecks.createdAt, new Date(from)));
  if (to) conditions.push(lte(complianceChecks.createdAt, new Date(to)));

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  // Bucket risk scores into ranges: 0-20, 21-40, 41-60, 61-80, 81-100
  const distribution = await db
    .select({
      bucket: sql<string>`
        case
          when ${complianceChecks.riskScore} between 0 and 20 then '0-20'
          when ${complianceChecks.riskScore} between 21 and 40 then '21-40'
          when ${complianceChecks.riskScore} between 41 and 60 then '41-60'
          when ${complianceChecks.riskScore} between 61 and 80 then '61-80'
          when ${complianceChecks.riskScore} between 81 and 100 then '81-100'
        end
      `.as("bucket"),
      count: sql<number>`count(*)::int`.as("count"),
    })
    .from(complianceChecks)
    .where(whereClause)
    .groupBy(sql`
      case
        when ${complianceChecks.riskScore} between 0 and 20 then '0-20'
        when ${complianceChecks.riskScore} between 21 and 40 then '21-40'
        when ${complianceChecks.riskScore} between 41 and 60 then '41-60'
        when ${complianceChecks.riskScore} between 61 and 80 then '61-80'
        when ${complianceChecks.riskScore} between 81 and 100 then '81-100'
      end
    `)
    .orderBy(sql`bucket`);

  // Summary stats
  const [stats] = await db
    .select({
      avg: sql<number>`round(avg(${complianceChecks.riskScore}))::int`.as("avg"),
      min: sql<number>`min(${complianceChecks.riskScore})::int`.as("min"),
      max: sql<number>`max(${complianceChecks.riskScore})::int`.as("max"),
      median: sql<number>`percentile_cont(0.5) within group (order by ${complianceChecks.riskScore})::int`.as("median"),
      p95: sql<number>`percentile_cont(0.95) within group (order by ${complianceChecks.riskScore})::int`.as("p95"),
    })
    .from(complianceChecks)
    .where(whereClause);

  return c.json(
    {
      success: true,
      data: {
        distribution,
        summary: stats ?? { avg: 0, min: 0, max: 0, median: 0, p95: 0 },
      },
    },
    200,
  );
});

// GET /v1/analytics/agents -- Top agents by transaction volume
analytics.get("/agents", validate({ query: AgentsQuery }), async (c) => {
  const query = c.get("validatedQuery") as z.infer<typeof AgentsQuery>;
  const { limit, from, to } = query;
  const auth = c.get("auth") as AuthContext | undefined;

  const db = getDb();

  const conditions = [];
  if (auth?.apiKeyId) conditions.push(eq(invoices.apiKeyId, auth.apiKeyId));
  if (from) conditions.push(gte(invoices.createdAt, new Date(from)));
  if (to) conditions.push(lte(invoices.createdAt, new Date(to)));

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  // Top sellers
  const topSellers = await db
    .select({
      agentDid: invoices.issuerAgentDid,
      role: sql<string>`'seller'`.as("role"),
      invoiceCount: sql<number>`count(*)::int`.as("invoice_count"),
      totalVolume: sql<string>`coalesce(sum(${invoices.totalAmount}), 0)::text`.as("total_volume"),
    })
    .from(invoices)
    .where(whereClause)
    .groupBy(invoices.issuerAgentDid)
    .orderBy(desc(sql`sum(${invoices.totalAmount})`))
    .limit(limit);

  // Top buyers
  const topBuyers = await db
    .select({
      agentDid: invoices.recipientAgentDid,
      role: sql<string>`'buyer'`.as("role"),
      invoiceCount: sql<number>`count(*)::int`.as("invoice_count"),
      totalVolume: sql<string>`coalesce(sum(${invoices.totalAmount}), 0)::text`.as("total_volume"),
    })
    .from(invoices)
    .where(whereClause)
    .groupBy(invoices.recipientAgentDid)
    .orderBy(desc(sql`sum(${invoices.totalAmount})`))
    .limit(limit);

  return c.json(
    {
      success: true,
      data: {
        topSellers,
        topBuyers,
      },
    },
    200,
  );
});

export { analytics };
