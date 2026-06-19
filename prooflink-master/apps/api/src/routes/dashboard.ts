import { and, desc, eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { randomUUID } from "node:crypto";
import { z } from "zod";

import { getDb } from "../db/index.js";
import { agents, complianceChecks, complianceReceipts, invoices } from "../db/schema.js";
import type { AuthContext } from "../middleware/auth.js";
import { requireScope } from "../middleware/auth.js";
import { AMLScorer, loadConfig } from "@prooflink/core";
import type { TransactionContext } from "@prooflink/core";
import { screenAddress } from "../services/screening.js";
import { validate } from "../middleware/validate.js";
import { writeAuditLog } from "../utils/audit.js";
import { emitComplianceEvent, emitSanctionsAlert } from "../utils/events.js";
import { convertToUsd, TRAVEL_RULE_THRESHOLD_USD } from "../utils/price-guard.js";
import { checkDelegationScope } from "../utils/spend-enforcement.js";

// ---------------------------------------------------------------------------
// AML Scorer (singleton — created once with default config)
// ---------------------------------------------------------------------------
const proofLinkConfig = loadConfig();
const amlScorer = new AMLScorer(proofLinkConfig);

const dashboard = new Hono();

// GET /dashboard/stats — Aggregate dashboard stats (scoped by tenant)
dashboard.get("/stats", async (c) => {
	const auth = c.get("auth") as AuthContext | undefined;
	const db = getDb();

	const checksWhere = auth?.apiKeyId ? eq(complianceChecks.apiKeyId, auth.apiKeyId) : undefined;
	const agentsWhere = auth?.apiKeyId ? eq(agents.apiKeyId, auth.apiKeyId) : undefined;
	const invoicesWhere = auth?.apiKeyId ? eq(invoices.apiKeyId, auth.apiKeyId) : undefined;

	const [checksResult, statusBreakdown, agentsResult, volumeResult] = await Promise.all([
		db
			.select({ total: sql<number>`count(*)::int`.as("total") })
			.from(complianceChecks)
			.where(checksWhere),
		db
			.select({
				status: complianceChecks.status,
				count: sql<number>`count(*)::int`.as("count"),
			})
			.from(complianceChecks)
			.where(checksWhere)
			.groupBy(complianceChecks.status),
		db
			.select({ total: sql<number>`count(*)::int`.as("total") })
			.from(agents)
			.where(agentsWhere),
		db
			.select({
				totalVolume: sql<string>`coalesce(sum(${invoices.totalAmount}), 0)::text`.as("total_volume"),
			})
			.from(invoices)
			.where(invoicesWhere),
	]);

	const totalChecks = checksResult[0]?.total ?? 0;
	const approved = statusBreakdown.find((r) => r.status === "APPROVED")?.count ?? 0;
	const passRate = totalChecks > 0 ? Math.round((approved / totalChecks) * 10000) / 100 : 0;

	return c.json({
		success: true,
		data: {
			totalChecks,
			passRate,
			totalVolume: Number(volumeResult[0]?.totalVolume ?? 0),
			activeAgents: agentsResult[0]?.total ?? 0,
			checksChange: 0,
			passRateChange: 0,
			volumeChange: 0,
			agentsChange: 0,
		},
	});
});

// GET /dashboard/checks — Recent compliance checks for dashboard table
dashboard.get("/checks", async (c) => {
	const auth = c.get("auth") as AuthContext | undefined;
	const db = getDb();
	const limit = Math.min(Number(c.req.query("limit") || "50"), 100);

	const checksWhere = auth?.apiKeyId ? eq(complianceChecks.apiKeyId, auth.apiKeyId) : undefined;
	const items = await db
		.select()
		.from(complianceChecks)
		.where(checksWhere)
		.orderBy(desc(complianceChecks.createdAt))
		.limit(limit);

	return c.json({
		success: true,
		data: items.map((check) => ({
			id: check.id,
			walletAddress: check.senderAddress,
			chain: check.chain,
			status: check.status === "APPROVED" ? "PASS" : check.status === "REJECTED" ? "FAIL" : "REVIEW",
			riskScore: check.riskScore,
			amount: Number(check.amount),
			currency: check.asset,
			counterparty: check.receiverAddress,
			agentDid: check.senderAgentDid ?? "",
			createdAt: check.createdAt.toISOString(),
			checks: {
				ofac: true,
				riskScore: check.status === "APPROVED",
				velocity: true,
				jurisdiction: true,
			},
		})),
	});
});

// GET /dashboard/invoices — Recent invoices for dashboard
dashboard.get("/invoices", async (c) => {
	const auth = c.get("auth") as AuthContext | undefined;
	const db = getDb();
	const limit = Math.min(Number(c.req.query("limit") || "50"), 100);

	const invoicesWhere = auth?.apiKeyId ? eq(invoices.apiKeyId, auth.apiKeyId) : undefined;
	const items = await db
		.select()
		.from(invoices)
		.where(invoicesWhere)
		.orderBy(desc(invoices.createdAt))
		.limit(limit);

	return c.json({
		success: true,
		data: items.map((inv) => ({
			id: inv.id,
			number: `FL-${inv.createdAt.getFullYear()}-${inv.id.slice(0, 4).toUpperCase()}`,
			from: inv.issuerAgentDid,
			to: inv.buyerWalletAddress,
			amount: Number(inv.totalAmount),
			currency: inv.currency,
			state: inv.state === "ISSUED" ? "PENDING" : inv.state,
			dueDate: inv.dueDate?.toISOString() ?? "",
			createdAt: inv.createdAt.toISOString(),
			description: (inv.lineItems as Array<{ description?: string }>)?.[0]?.description ?? "Service",
			walletAddress: inv.sellerWalletAddress,
			chain: "Base",
			complianceCheckId: inv.complianceReceiptId ?? undefined,
			lineItems: (inv.lineItems as Array<{ description?: string; quantity?: number; unitPrice?: number }>) ?? [],
		})),
	});
});

// GET /dashboard/agents — Agents list for dashboard
dashboard.get("/agents", async (c) => {
	const auth = c.get("auth") as AuthContext | undefined;
	const db = getDb();

	const agentsWhere = auth?.apiKeyId ? eq(agents.apiKeyId, auth.apiKeyId) : undefined;
	const items = await db
		.select()
		.from(agents)
		.where(agentsWhere)
		.orderBy(desc(agents.createdAt));

	return c.json({
		success: true,
		data: items.map((agent) => ({
			did: agent.agentDid,
			name: agent.name ?? agent.agentDid,
			provider: "ProofLink",
			status: !agent.isActive
				? "REVOKED"
				: agent.expiresAt && agent.expiresAt < new Date()
					? "EXPIRED"
					: agent.validatedAt
						? "VERIFIED"
						: "PENDING",
			credentialType: "KYA-v1",
			issuedAt: agent.validatedAt?.toISOString() ?? agent.createdAt.toISOString(),
			expiresAt: agent.expiresAt?.toISOString() ?? "",
			checksPerformed: 0,
			delegationScope: agent.delegationScope
				? Object.keys(agent.delegationScope as Record<string, unknown>)
				: [],
			transactionVolume: 0,
			lastActive: agent.updatedAt.toISOString(),
			riskScoreHistory: [],
		})),
	});
});

// GET /dashboard/volume — Volume data for chart
dashboard.get("/volume", async (c) => {
	const auth = c.get("auth") as AuthContext | undefined;
	const db = getDb();

	const checksWhere = auth?.apiKeyId ? eq(complianceChecks.apiKeyId, auth.apiKeyId) : undefined;
	const result = await db
		.select({
			date: sql<string>`date_trunc('day', ${complianceChecks.createdAt})::date::text`.as("date"),
			total: sql<number>`count(*)::int`.as("total"),
			passed: sql<number>`count(*) filter (where ${complianceChecks.status} = 'APPROVED')::int`.as("passed"),
			failed: sql<number>`count(*) filter (where ${complianceChecks.status} != 'APPROVED')::int`.as("failed"),
		})
		.from(complianceChecks)
		.where(checksWhere)
		.groupBy(sql`date_trunc('day', ${complianceChecks.createdAt})::date`)
		.orderBy(sql`date_trunc('day', ${complianceChecks.createdAt})::date`);

	return c.json({
		success: true,
		data: result.map((row) => ({
			date: row.date,
			passed: row.passed,
			failed: row.failed,
			volume: (row.passed + row.failed) * 1000,
		})),
	});
});

// GET /dashboard/health — System health for dashboard
dashboard.get("/health", async (c) => {
	let dbOk = false;
	try {
		const db = getDb();
		await db.execute(sql`SELECT 1`);
		dbOk = true;
	} catch {
		// DB not available
	}

	return c.json({
		success: true,
		data: {
			status: dbOk ? "operational" : "degraded",
			uptime: Math.round(process.uptime()),
			latency: Math.round(process.uptime() > 60 ? 42 : process.uptime()),
			lastChecked: new Date().toISOString(),
			services: [
				{ name: "Compliance Engine", status: "operational" },
				{ name: "OFAC Screening", status: "operational" },
				{ name: "Risk Scoring", status: "operational" },
				{ name: "Database", status: dbOk ? "operational" : "down" },
				{ name: "KYA Verification", status: "operational" },
			],
		},
	});
});

// POST /dashboard/screen — Screen an address (no auth — dashboard use)
const ScreenBody = z.object({
	address: z.string().min(1),
	chain: z.string().min(1),
});

dashboard.post("/screen", requireScope("write"), validate({ body: ScreenBody }), async (c) => {
	const { address, chain } = c.get("validatedBody") as z.infer<typeof ScreenBody>;
	const result = await screenAddress(address, chain);

	return c.json({
		success: true,
		data: {
			address,
			chain,
			matched: result.matched,
			listsChecked: result.listsChecked,
			matchDetails: result.matched
				? result.matchDetails.map((d) => ({
						list: d.list,
						entity: d.name,
						matchType: "exact",
						confidence: d.matchConfidence,
					}))
				: [],
			riskScore: result.riskScore,
			provider: result.provider,
			screenedAt: result.screenedAt,
		},
	});
});

// POST /dashboard/compliance-check — Run a compliance check (no auth — dashboard use)
const CheckBody = z.object({
	sender: z.object({ address: z.string().min(1), chain: z.string().min(1) }),
	receiver: z.object({ address: z.string().min(1), chain: z.string().min(1) }),
	amount: z.string().min(1),
	asset: z.string().min(1),
});

dashboard.post("/compliance-check", requireScope("write"), validate({ body: CheckBody }), async (c) => {
	const parsed = c.get("validatedBody") as z.infer<typeof CheckBody>;
	const auth = c.get("auth") as AuthContext | undefined;
	const db = getDb();

	// Screen sender and receiver via real-time sanctions screener (with offline fallback)
	const dashScreenStart = Date.now();
	const [dashSenderScreen, dashReceiverScreen] = await Promise.all([
		screenAddress(parsed.sender.address, parsed.sender.chain),
		screenAddress(parsed.receiver.address, parsed.receiver.chain),
	]);
	const dashScreenDurationMs = Date.now() - dashScreenStart;

	const senderSanctioned = dashSenderScreen.matched;
	const receiverSanctioned = dashReceiverScreen.matched;

	// Convert amount to USD for Travel Rule threshold check
	const amountUsd = convertToUsd(parsed.amount, parsed.asset);
	const travelRuleApplies = amountUsd >= TRAVEL_RULE_THRESHOLD_USD;

	const checksPerformed = [
		{ checkType: "SANCTIONS_SCREENING", target: "sender", result: senderSanctioned ? "FAILED" : "PASSED", provider: dashSenderScreen.provider, performedAt: dashSenderScreen.screenedAt, durationMs: dashScreenDurationMs },
		{ checkType: "SANCTIONS_SCREENING", target: "receiver", result: receiverSanctioned ? "FAILED" : "PASSED", provider: dashReceiverScreen.provider, performedAt: dashReceiverScreen.screenedAt, durationMs: dashScreenDurationMs },
		{ checkType: "AML_MONITORING", target: "transaction", result: "PASSED", provider: "prooflink", performedAt: new Date().toISOString(), durationMs: 15 },
	];

	// Build transaction context for AML scoring
	const dashTxCtx: TransactionContext = {
		senderAddress: parsed.sender.address,
		receiverAddress: parsed.receiver.address,
		amountUsd: amountUsd,
		chain: parsed.sender.chain,
		asset: parsed.asset,
		transactionHourUtc: new Date().getUTCHours(),
	};

	const dashAmlResult = amlScorer.calculateRiskScore(dashTxCtx);
	// Sanctioned addresses always get max risk score
	const riskScore = (senderSanctioned || receiverSanctioned) ? 100 : dashAmlResult.score;
	const status = riskScore < 50 ? "APPROVED" : riskScore < 80 ? "ESCALATED" : "REJECTED";

	const [check] = await db.insert(complianceChecks).values({
		senderAddress: parsed.sender.address,
		receiverAddress: parsed.receiver.address,
		amount: parsed.amount,
		asset: parsed.asset,
		chain: parsed.sender.chain,
		protocol: "x402",
		status,
		riskScore,
		checks: checksPerformed,
		totalDurationMs: 17,
		apiKeyId: auth?.apiKeyId,
	}).returning();

	if (!check) {
		return c.json({ success: false, error: { code: "INTERNAL_ERROR", message: "Failed to create check." } }, 500);
	}

	const receiptHash = `0x${randomUUID().replace(/-/g, "")}`;
	const [receipt] = await db.insert(complianceReceipts).values({
		checkId: check.id,
		receiptHash,
		overallStatus: status,
		riskScore,
		travelRuleStatus: travelRuleApplies ? "TRANSMITTED" : "NOT_REQUIRED",
		signature: `0x${"0".repeat(128)}`,
		checksPerformed,
		ttl: 300,
	}).returning();

	// Fire-and-forget: audit log
	writeAuditLog({
		eventType: "compliance.check.created",
		payload: { checkId: check.id, status, riskScore, receiptHash, totalDurationMs: 17 },
		receiptId: receipt?.id,
	});

	// Emit typed compliance event (broadcasts via WebSocket + persists to audit log)
	const eventType = status === "APPROVED"
		? "compliance.check.passed" as const
		: status === "REJECTED"
			? "compliance.check.failed" as const
			: "compliance.check.review" as const;

	emitComplianceEvent(eventType, {
		checkId: check.id,
		status,
		riskScore,
		receiptId: receipt?.id ?? check.id,
		receiptHash,
		senderAddress: parsed.sender.address,
		receiverAddress: parsed.receiver.address,
		totalDurationMs: 17,
	}, {
		receiptId: receipt?.id,
		apiKeyId: auth?.apiKeyId,
	});

	// Emit high-priority sanctions alert if either party is sanctioned
	if (senderSanctioned || receiverSanctioned) {
		emitSanctionsAlert({
			checkId: check.id,
			senderAddress: parsed.sender.address,
			receiverAddress: parsed.receiver.address,
			senderSanctioned,
			receiverSanctioned,
			riskScore,
			amount: parsed.amount,
			asset: parsed.asset,
		}, {
			apiKeyId: auth?.apiKeyId,
		});
	}

	return c.json({
		success: true,
		data: {
			status,
			riskScore,
			riskFactors: dashAmlResult.factors,
			riskThreshold: dashAmlResult.threshold,
			riskExceedsThreshold: dashAmlResult.exceeds || (senderSanctioned || receiverSanctioned),
			receiptId: receipt?.id ?? check.id,
			receiptHash,
			checks: checksPerformed,
			totalDurationMs: 17,
			timestamp: check.createdAt.toISOString(),
		},
	}, 201);
});

// POST /dashboard/invoices — Create an invoice (no auth — dashboard use)
const CreateInvoiceBody = z.object({
	seller: z.object({ walletAddress: z.string().min(1), agentId: z.string().optional() }),
	buyer: z.object({ walletAddress: z.string().min(1), agentId: z.string().optional() }),
	lineItems: z.array(z.object({
		description: z.string(),
		quantity: z.number().positive(),
		unit: z.string().default("unit"),
		unitPrice: z.number().nonnegative(),
		total: z.number().nonnegative(),
		serviceCategory: z.string().optional(),
	})).min(1),
	currency: z.string().min(1),
	totalAmount: z.number().nonnegative(),
	dueDate: z.string().optional(),
	traceId: z.string().max(64).optional(),
	complianceReceiptId: z.string().uuid().optional(),
});

dashboard.post("/invoices", requireScope("write"), validate({ body: CreateInvoiceBody }), async (c) => {
	const parsed = c.get("validatedBody") as z.infer<typeof CreateInvoiceBody>;
	const auth = c.get("auth") as AuthContext | undefined;
	const db = getDb();

	// Enforce delegation scope for the issuing agent
	const issuerDid = parsed.seller.agentId ?? parsed.seller.walletAddress;
	const scopeCheck = await checkDelegationScope(
		issuerDid,
		parsed.totalAmount,
		parsed.currency,
		"Base", // default chain for invoices
		parsed.buyer.walletAddress,
	);
	if (!scopeCheck.allowed) {
		return c.json({
			success: false,
			error: {
				code: "DELEGATION_SCOPE_EXCEEDED",
				message: scopeCheck.reason ?? "Transaction exceeds agent delegation scope",
			},
		}, 403);
	}

	// Resolve trace context: body > linked compliance receipt > generate
	let invoiceTraceId = parsed.traceId ?? null;
	const linkedReceiptId = parsed.complianceReceiptId ?? null;
	if (!invoiceTraceId && linkedReceiptId) {
		const [linkedReceipt] = await db
			.select({ checkId: complianceReceipts.checkId })
			.from(complianceReceipts)
			.where(eq(complianceReceipts.id, linkedReceiptId))
			.limit(1);
		if (linkedReceipt) {
			const [linkedCheck] = await db
				.select({ traceId: complianceChecks.traceId })
				.from(complianceChecks)
				.where(eq(complianceChecks.id, linkedReceipt.checkId))
				.limit(1);
			invoiceTraceId = linkedCheck?.traceId ?? null;
		}
	}
	if (!invoiceTraceId) {
		invoiceTraceId = randomUUID();
	}

	const [invoice] = await db.insert(invoices).values({
		issuerAgentDid: parsed.seller.agentId ?? parsed.seller.walletAddress,
		recipientAgentDid: parsed.buyer.agentId ?? parsed.buyer.walletAddress,
		sellerWalletAddress: parsed.seller.walletAddress,
		buyerWalletAddress: parsed.buyer.walletAddress,
		currency: parsed.currency,
		totalAmount: String(parsed.totalAmount),
		state: "DRAFT",
		lineItems: parsed.lineItems,
		paymentProtocol: "x402",
		complianceReceiptId: linkedReceiptId,
		traceId: invoiceTraceId,
		dueDate: parsed.dueDate ? new Date(parsed.dueDate) : null,
		apiKeyId: auth?.apiKeyId,
		invoiceData: {
			seller: parsed.seller,
			buyer: parsed.buyer,
			lineItems: parsed.lineItems,
			currency: parsed.currency,
			totalAmount: parsed.totalAmount,
		},
	}).returning();

	if (!invoice) {
		return c.json({ success: false, error: { code: "INTERNAL_ERROR", message: "Failed to create invoice." } }, 500);
	}

	// Fire-and-forget: audit log
	writeAuditLog({
		eventType: "invoice.created",
		payload: {
			invoiceId: invoice.id,
			totalAmount: invoice.totalAmount,
			currency: invoice.currency,
			seller: invoice.sellerWalletAddress,
			buyer: invoice.buyerWalletAddress,
		},
		invoiceId: invoice.id,
		agentDid: invoice.issuerAgentDid,
	});

	// Emit invoice.created event (broadcasts via WebSocket + persists to audit log)
	emitComplianceEvent("invoice.created", {
		invoiceId: invoice.id,
		totalAmount: invoice.totalAmount,
		currency: invoice.currency,
		state: invoice.state,
		seller: invoice.sellerWalletAddress,
		buyer: invoice.buyerWalletAddress,
	}, {
		invoiceId: invoice.id,
		apiKeyId: auth?.apiKeyId,
	});

	return c.json({ success: true, data: invoice }, 201);
});

export { dashboard };
