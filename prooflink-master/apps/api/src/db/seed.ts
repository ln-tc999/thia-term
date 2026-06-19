/**
 * Seed script — populates the ProofLink database with demo data.
 *
 * Usage: DATABASE_URL=... npx tsx src/db/seed.ts
 */

import { randomUUID, createHash, createHmac } from "node:crypto";
import { closeDb, getDb } from "./index.js";
import { agents, apiKeys, complianceChecks, complianceReceipts, invoices } from "./schema.js";

const CHAINS = ["ethereum", "base", "polygon", "arbitrum"];
const ASSETS = ["USDC", "USDT", "ETH"];

function randomAddress(): string {
	const hex = "0123456789abcdef";
	let addr = "0x";
	for (let i = 0; i < 40; i++) addr += hex[Math.floor(Math.random() * 16)];
	return addr;
}

function randomDate(daysBack: number): Date {
	const d = new Date();
	d.setDate(d.getDate() - Math.floor(Math.random() * daysBack));
	d.setHours(Math.floor(Math.random() * 24), Math.floor(Math.random() * 60));
	return d;
}

async function seed() {
	const db = getDb();
	console.log("[seed] Starting...");

	// 1. Create an API key
	const rawKey = `fl_live_${randomUUID().replace(/-/g, "").slice(0, 24)}`;
	const secret = process.env["API_KEY_SECRET"] ?? "";
	const keyHash = secret
		? createHmac("sha256", secret).update(rawKey).digest("hex")
		: createHash("sha256").update(rawKey).digest("hex");

	const [apiKey] = await db.insert(apiKeys).values({
		name: "Demo Key",
		keyHash,
		keyPrefix: rawKey.slice(0, 12),
		ownerId: "demo-user",
		scopes: ["admin", "write", "read"],
		rateLimitPerMinute: 120,
		isActive: true,
	}).returning();

	if (!apiKey) throw new Error("Failed to create API key");
	console.log(`[seed] API Key created: ${rawKey}`);
	console.log(`[seed]   ID: ${apiKey.id}`);

	// 2. Create agents
	const agentData = [
		{ did: "did:web:paybot.prooflink.io", name: "PayBot Prime", type: "autonomous", wallet: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045" },
		{ did: "did:web:complianceguard.prooflink.io", name: "ComplianceGuard", type: "semi-autonomous", wallet: "0x1234567890abcdef1234567890abcdef12345678" },
		{ did: "did:web:swiftsettle.prooflink.io", name: "SwiftSettle", type: "autonomous", wallet: "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd" },
		{ did: "did:web:risklens.prooflink.io", name: "RiskLens AI", type: "human-supervised", wallet: "0x9876543210fedcba9876543210fedcba98765432" },
		{ did: "did:web:autopay.prooflink.io", name: "AutoPay Agent", type: "autonomous", wallet: "0xfedcba9876543210fedcba9876543210fedcba98" },
	];

	const createdAgents = [];
	for (const a of agentData) {
		const now = new Date();
		const expires = new Date(now);
		expires.setFullYear(expires.getFullYear() + 1);

		const [agent] = await db.insert(agents).values({
			agentDid: a.did,
			name: a.name,
			agentType: a.type,
			walletAddress: a.wallet,
			controllingEntityName: "ProofLink Inc",
			controllingEntityLei: "549300EXAMPLE",
			complianceScore: 70 + Math.floor(Math.random() * 30),
			delegationScope: {
				maxTransactionValue: 10000,
				dailyLimit: 50000,
				allowedChains: ["ethereum", "base"],
				allowedCurrencies: ["USDC", "USDT"],
				expiresAt: expires.toISOString(),
			},
			isActive: true,
			validatedAt: now,
			expiresAt: expires,
		}).returning();
		if (agent) createdAgents.push(agent);
	}
	console.log(`[seed] Created ${createdAgents.length} agents`);

	// 3. Create compliance checks (50 — mix of approved/rejected/escalated)
	const checksCreated = [];
	for (let i = 0; i < 50; i++) {
		const sender = createdAgents[Math.floor(Math.random() * createdAgents.length)]!.walletAddress;
		const receiver = randomAddress();
		const chain = CHAINS[Math.floor(Math.random() * CHAINS.length)]!;
		const asset = ASSETS[Math.floor(Math.random() * ASSETS.length)]!;
		const amount = (Math.random() * 50000 + 100).toFixed(2);

		const roll = Math.random();
		const status = roll < 0.75 ? "APPROVED" : roll < 0.9 ? "ESCALATED" : "REJECTED";
		const riskScore = status === "APPROVED" ? Math.floor(Math.random() * 30) : status === "ESCALATED" ? 50 + Math.floor(Math.random() * 30) : 80 + Math.floor(Math.random() * 20);

		const checksPerformed = [
			{ checkType: "SANCTIONS_SCREENING", target: "sender", result: status === "REJECTED" ? "FAILED" : "PASSED", provider: "ofac_sdn_offline", performedAt: new Date().toISOString(), durationMs: 2 },
			{ checkType: "SANCTIONS_SCREENING", target: "receiver", result: "PASSED", provider: "ofac_sdn_offline", performedAt: new Date().toISOString(), durationMs: 2 },
			{ checkType: "AML_MONITORING", target: "transaction", result: "PASSED", provider: "prooflink", performedAt: new Date().toISOString(), durationMs: 15 },
			{ checkType: "TRAVEL_RULE", target: "transaction", result: Number(amount) > 3000 ? "PASSED" : "SKIPPED", provider: "notabene", performedAt: new Date().toISOString(), durationMs: 5 },
		];

		const [check] = await db.insert(complianceChecks).values({
			senderAddress: sender,
			receiverAddress: receiver,
			senderAgentDid: createdAgents[Math.floor(Math.random() * createdAgents.length)]!.agentDid,
			amount,
			asset,
			chain,
			protocol: "x402",
			status,
			riskScore,
			checks: checksPerformed,
			totalDurationMs: Math.floor(Math.random() * 100) + 20,
			apiKeyId: apiKey.id,
			createdAt: randomDate(30),
		}).returning();

		if (check) {
			checksCreated.push(check);

			// Create receipt for each check
			const receiptHash = `0x${randomUUID().replace(/-/g, "")}`;
			await db.insert(complianceReceipts).values({
				checkId: check.id,
				receiptHash,
				overallStatus: status,
				riskScore,
				travelRuleStatus: Number(amount) > 3000 ? "TRANSMITTED" : "NOT_REQUIRED",
				signature: `0x${"0".repeat(128)}`,
				checksPerformed,
				ttl: 300,
			});
		}
	}
	console.log(`[seed] Created ${checksCreated.length} compliance checks with receipts`);

	// 4. Create invoices (20)
	const invoiceStates = ["DRAFT", "ISSUED", "PAID", "SETTLED", "CANCELLED"];
	let invoicesCreated = 0;
	for (let i = 0; i < 20; i++) {
		const seller = createdAgents[Math.floor(Math.random() * createdAgents.length)]!;
		const buyer = createdAgents[Math.floor(Math.random() * createdAgents.length)]!;
		const currency = Math.random() > 0.3 ? "USDC" : "USDT";
		const lineItems = [
			{ description: ["API calls", "Compute hours", "Data processing", "Content generation", "Risk analysis"][Math.floor(Math.random() * 5)]!, quantity: Math.floor(Math.random() * 100) + 1, unit: "unit", unitPrice: Math.random() * 50 + 1, total: 0, serviceCategory: "api_call" },
			{ description: "Platform fee", quantity: 1, unit: "unit", unitPrice: Math.random() * 20 + 5, total: 0, serviceCategory: "transaction_fee" },
		];
		lineItems[0]!.total = Math.round(lineItems[0]!.quantity * lineItems[0]!.unitPrice * 100) / 100;
		lineItems[1]!.total = Math.round(lineItems[1]!.unitPrice * 100) / 100;
		const totalAmount = lineItems[0]!.total + lineItems[1]!.total;

		const state = invoiceStates[Math.floor(Math.random() * invoiceStates.length)]!;
		const dueDate = new Date();
		dueDate.setDate(dueDate.getDate() + 14);

		const [inv] = await db.insert(invoices).values({
			issuerAgentDid: seller.agentDid,
			recipientAgentDid: buyer.agentDid,
			sellerWalletAddress: seller.walletAddress,
			buyerWalletAddress: buyer.walletAddress,
			currency,
			totalAmount: String(totalAmount),
			state,
			lineItems,
			paymentProtocol: "x402",
			dueDate,
			apiKeyId: apiKey.id,
			invoiceData: {
				seller: { agentId: seller.agentDid, walletAddress: seller.walletAddress },
				buyer: { agentId: buyer.agentDid, walletAddress: buyer.walletAddress },
				lineItems,
				currency,
				totalAmount,
			},
			createdAt: randomDate(30),
		}).returning();

		if (inv) invoicesCreated++;
	}
	console.log(`[seed] Created ${invoicesCreated} invoices`);

	console.log("\n[seed] Done! Summary:");
	console.log(`  API Key: ${rawKey}`);
	console.log(`  Agents: ${createdAgents.length}`);
	console.log(`  Compliance Checks: ${checksCreated.length}`);
	console.log(`  Invoices: ${invoicesCreated}`);
	console.log(`\n[seed] Use this API key to authenticate: X-API-Key: ${rawKey}`);

	await closeDb();
}

seed().catch((err) => {
	console.error("[seed] Fatal error:", err);
	process.exit(1);
});
