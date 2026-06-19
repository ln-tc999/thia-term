/**
 * ProofLink Dashboard API client
 *
 * Connects to the real ProofLink API at localhost:3001/dashboard/*.
 * Falls back to mock data when the API is unreachable (e.g., no DB running).
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ComplianceCheck {
	id: string;
	walletAddress: string;
	chain: string;
	status: 'PASS' | 'FAIL' | 'REVIEW';
	riskScore: number;
	amount: number;
	currency: string;
	counterparty: string;
	agentDid: string;
	createdAt: string;
	checks: {
		ofac: boolean;
		riskScore: boolean;
		velocity: boolean;
		jurisdiction: boolean;
	};
}

export interface Invoice {
	id: string;
	number: string;
	from: string;
	to: string;
	amount: number;
	currency: string;
	state: 'DRAFT' | 'PENDING' | 'PAID' | 'REJECTED' | 'EXPIRED';
	dueDate: string;
	createdAt: string;
	paidAt?: string;
	description: string;
	walletAddress: string;
	chain: string;
	complianceCheckId?: string;
	lineItems?: InvoiceLineItem[];
}

export interface InvoiceLineItem {
	description: string;
	quantity: number;
	unitPrice: number;
}

export interface ScreeningResult {
	address: string;
	chain: string;
	riskScore: number;
	riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
	flags: string[];
	sanctioned: boolean;
	screenedAt: string;
}

export interface Agent {
	did: string;
	name: string;
	provider: string;
	status: 'VERIFIED' | 'EXPIRED' | 'REVOKED' | 'PENDING';
	credentialType: string;
	issuedAt: string;
	expiresAt: string;
	checksPerformed: number;
	riskScoreHistory?: { date: string; score: number }[];
	delegationScope?: string[];
	transactionVolume?: number;
	lastActive?: string;
}

export interface ApiKey {
	id: string;
	name: string;
	prefix: string;
	createdAt: string;
	lastUsed: string | null;
	status: 'ACTIVE' | 'REVOKED';
}

export interface DashboardStats {
	totalChecks: number;
	passRate: number;
	totalVolume: number;
	activeAgents: number;
	checksChange: number;
	passRateChange: number;
	volumeChange: number;
	agentsChange: number;
}

export interface VolumeDataPoint {
	date: string;
	passed: number;
	failed: number;
	volume: number;
}

export interface Webhook {
	id: string;
	url: string;
	events: string[];
	status: 'ACTIVE' | 'INACTIVE';
	createdAt: string;
	lastTriggered: string | null;
}

export interface TeamMember {
	id: string;
	name: string;
	email: string;
	role: 'ADMIN' | 'MEMBER' | 'VIEWER';
	status: 'ACTIVE' | 'INVITED';
	joinedAt: string;
}

export interface CompliancePolicy {
	riskScoreThreshold: number;
	maxTransactionAmount: number;
	velocityLimit: number;
	velocityWindow: string;
	failOpen: boolean;
	blockedJurisdictions: string[];
	customWatchlist: string[];
}

export interface NotificationPreferences {
	emailOnFailedCheck: boolean;
	emailOnHighRisk: boolean;
	emailOnNewAgent: boolean;
	webhookOnAllChecks: boolean;
	dailyDigest: boolean;
	weeklyReport: boolean;
}

export interface AnalyticsData {
	volumeByPeriod: { date: string; volume: number; count: number }[];
	complianceBreakdown: { status: string; count: number; color: string }[];
	riskDistribution: { range: string; count: number }[];
	topAgents: {
		did: string;
		name: string;
		volume: number;
		checks: number;
		passRate: number;
	}[];
	geoDistribution: {
		country: string;
		count: number;
		percentage: number;
	}[];
}

export interface ActivityEvent {
	id: string;
	type:
		| 'check_pass'
		| 'check_fail'
		| 'check_review'
		| 'invoice_paid'
		| 'agent_verified'
		| 'agent_revoked'
		| 'key_created'
		| 'webhook_triggered';
	message: string;
	detail: string;
	timestamp: string;
	agentDid?: string;
	checkId?: string;
}

export interface SystemHealth {
	status: 'operational' | 'degraded' | 'down';
	uptime: number;
	latency: number;
	lastChecked: string;
	services: {
		name: string;
		status: 'operational' | 'degraded' | 'down';
	}[];
}

// ─── API Client ──────────────────────────────────────────────────────────────

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

interface ApiResponse<T> {
	success: boolean;
	data: T;
}

// Stored API key for authenticated requests (set via setApiKey)
let _apiKey = '';

export function setApiKey(key: string): void {
	_apiKey = key;
	if (typeof window !== 'undefined') {
		localStorage.setItem('prooflink_api_key', key);
	}
}

export function getApiKey(): string {
	if (!_apiKey && typeof window !== 'undefined') {
		_apiKey = localStorage.getItem('prooflink_api_key') ?? '';
	}
	return _apiKey;
}

async function fetchApi<T>(path: string): Promise<T | null> {
	try {
		const headers: Record<string, string> = { 'Content-Type': 'application/json' };
		const key = getApiKey();
		if (key) headers['X-API-Key'] = key;
		const res = await fetch(`${API_BASE}${path}`, {
			headers,
			signal: AbortSignal.timeout(3000),
		});
		if (!res.ok) return null;
		const json = (await res.json()) as ApiResponse<T>;
		if (!json.success) return null;
		return json.data;
	} catch {
		return null;
	}
}

async function postApi<T>(path: string, body: unknown): Promise<T | null> {
	try {
		const headers: Record<string, string> = { 'Content-Type': 'application/json' };
		const key = getApiKey();
		if (key) headers['X-API-Key'] = key;
		const res = await fetch(`${API_BASE}${path}`, {
			method: 'POST',
			headers,
			body: JSON.stringify(body),
			signal: AbortSignal.timeout(5000),
		});
		if (!res.ok) return null;
		const json = (await res.json()) as ApiResponse<T>;
		if (!json.success) return null;
		return json.data;
	} catch {
		return null;
	}
}

// ─── Mock Data (fallback when API unavailable) ───────────────────────────────

const CHAINS = ['Ethereum', 'Polygon', 'Base', 'Arbitrum', 'Solana'];
const STATUSES: ComplianceCheck['status'][] = ['PASS', 'PASS', 'PASS', 'PASS', 'FAIL', 'REVIEW'];

function randomDate(daysBack: number): string {
	const d = new Date();
	d.setDate(d.getDate() - Math.floor(Math.random() * Math.abs(daysBack)));
	d.setHours(
		Math.floor(Math.random() * 24),
		Math.floor(Math.random() * 60),
	);
	return d.toISOString();
}

function randomAddress(): string {
	const hex = '0123456789abcdef';
	let addr = '0x';
	for (let i = 0; i < 40; i++) addr += hex[Math.floor(Math.random() * 16)];
	return addr;
}

const mockChecks: ComplianceCheck[] = Array.from({ length: 50 }, (_, i) => {
	const status = STATUSES[Math.floor(Math.random() * STATUSES.length)];
	return {
		id: `chk_${String(i + 1).padStart(4, '0')}`,
		walletAddress: randomAddress(),
		chain: CHAINS[Math.floor(Math.random() * CHAINS.length)],
		status,
		riskScore:
			status === 'PASS'
				? Math.random() * 30
				: status === 'FAIL'
					? 70 + Math.random() * 30
					: 30 + Math.random() * 40,
		amount: Math.floor(Math.random() * 50000) + 100,
		currency: 'USDC',
		counterparty: randomAddress(),
		agentDid: `did:web:agent${Math.floor(Math.random() * 5) + 1}.prooflink.io`,
		createdAt: randomDate(30),
		checks: {
			ofac: status !== 'FAIL' || Math.random() > 0.5,
			riskScore: status === 'PASS',
			velocity: status !== 'REVIEW' || Math.random() > 0.3,
			jurisdiction: true,
		},
	};
}).sort(
	(a, b) =>
		new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
);

function generateMockVolumeData(): VolumeDataPoint[] {
	const data: VolumeDataPoint[] = [];
	for (let i = 29; i >= 0; i--) {
		const d = new Date();
		d.setDate(d.getDate() - i);
		const base = 20 + Math.floor(Math.random() * 30);
		const failRate = 0.05 + Math.random() * 0.1;
		data.push({
			date: d.toISOString().split('T')[0],
			passed: Math.floor(base * (1 - failRate)),
			failed: Math.floor(base * failRate),
			volume: Math.floor(Math.random() * 200000 + 50000),
		});
	}
	return data;
}

const mockAgents: Agent[] = [
	{
		did: 'did:web:agent1.prooflink.io',
		name: 'PayBot Prime',
		provider: 'ProofLink',
		status: 'VERIFIED',
		credentialType: 'KYA-v1',
		issuedAt: '2024-01-15T00:00:00Z',
		expiresAt: '2025-01-15T00:00:00Z',
		checksPerformed: 1247,
		delegationScope: ['payment.send', 'payment.receive', 'compliance.check'],
		transactionVolume: 2340000,
		lastActive: randomDate(1),
		riskScoreHistory: Array.from({ length: 30 }, (_, i) => ({
			date: new Date(Date.now() - (29 - i) * 86400000)
				.toISOString()
				.split('T')[0],
			score: 10 + Math.random() * 15,
		})),
	},
	{
		did: 'did:web:agent2.prooflink.io',
		name: 'ComplianceGuard',
		provider: 'TrustNet',
		status: 'VERIFIED',
		credentialType: 'KYA-v1',
		issuedAt: '2024-03-01T00:00:00Z',
		expiresAt: '2025-03-01T00:00:00Z',
		checksPerformed: 893,
		delegationScope: ['compliance.check', 'compliance.report'],
		transactionVolume: 1560000,
		lastActive: randomDate(2),
		riskScoreHistory: Array.from({ length: 30 }, (_, i) => ({
			date: new Date(Date.now() - (29 - i) * 86400000)
				.toISOString()
				.split('T')[0],
			score: 12 + Math.random() * 18,
		})),
	},
];

// ─── API Functions (real API with mock fallback) ─────────────────────────────

export async function getDashboardStats(): Promise<DashboardStats> {
	const data = await fetchApi<DashboardStats>('/dashboard/stats');
	if (data) return data;

	return {
		totalChecks: 12847,
		passRate: 94.2,
		totalVolume: 8420000,
		activeAgents: 3,
		checksChange: 12.5,
		passRateChange: 1.3,
		volumeChange: 23.1,
		agentsChange: 0,
	};
}

export async function getVolumeData(): Promise<VolumeDataPoint[]> {
	const data = await fetchApi<VolumeDataPoint[]>('/dashboard/volume');
	if (data && data.length > 0) return data;

	return generateMockVolumeData();
}

export async function getComplianceChecks(): Promise<ComplianceCheck[]> {
	const data = await fetchApi<ComplianceCheck[]>('/dashboard/checks');
	if (data && data.length > 0) return data;

	return mockChecks;
}

export async function getComplianceCheck(
	id: string,
): Promise<ComplianceCheck | null> {
	const checks = await getComplianceChecks();
	return checks.find((c) => c.id === id) ?? null;
}

export async function getInvoices(): Promise<Invoice[]> {
	const data = await fetchApi<Invoice[]>('/dashboard/invoices');
	if (data && data.length > 0) return data;

	return [];
}

export async function getInvoice(id: string): Promise<Invoice | null> {
	const invoices = await getInvoices();
	return invoices.find((inv) => inv.id === id) ?? null;
}

export async function screenAddress(
	address: string,
	chain: string,
): Promise<ScreeningResult> {
	// Try real API first
	const data = await postApi<{
		address: string;
		chain: string;
		matched: boolean;
		riskScore: number;
		matchDetails: Array<{ list: string; entity: string }>;
		screenedAt: string;
	}>('/dashboard/screen', { address, chain: chain.toLowerCase() });

	if (data) {
		const riskScore = data.riskScore;
		const riskLevel: ScreeningResult['riskLevel'] =
			riskScore < 25 ? 'LOW' : riskScore < 50 ? 'MEDIUM' : riskScore < 75 ? 'HIGH' : 'CRITICAL';
		const flags: string[] = [];
		if (data.matched) flags.push('OFAC SDN sanctions match');
		for (const m of data.matchDetails) {
			flags.push(`${m.list}: ${m.entity}`);
		}
		return {
			address: data.address,
			chain,
			riskScore,
			riskLevel,
			flags,
			sanctioned: data.matched,
			screenedAt: data.screenedAt,
		};
	}

	// Fallback to mock
	return {
		address,
		chain,
		riskScore: 0,
		riskLevel: 'LOW',
		flags: [],
		sanctioned: false,
		screenedAt: new Date().toISOString(),
	};
}

export async function runComplianceCheck(params: {
	senderAddress: string;
	receiverAddress: string;
	amount: string;
	asset: string;
	chain: string;
}): Promise<{
	status: string;
	riskScore: number;
	receiptId: string;
	checks: Array<{ checkType: string; result: string }>;
} | null> {
	return postApi('/dashboard/compliance-check', {
		sender: { address: params.senderAddress, chain: params.chain },
		receiver: { address: params.receiverAddress, chain: params.chain },
		amount: params.amount,
		asset: params.asset,
	});
}

export async function createInvoiceApi(params: {
	sellerWallet: string;
	buyerWallet: string;
	lineItems: Array<{ description: string; quantity: number; unitPrice: number; total: number }>;
	currency: string;
	totalAmount: number;
	dueDate?: string;
}): Promise<unknown> {
	return postApi('/dashboard/invoices', {
		seller: { walletAddress: params.sellerWallet },
		buyer: { walletAddress: params.buyerWallet },
		lineItems: params.lineItems.map((li) => ({
			...li,
			unit: 'unit',
			serviceCategory: 'api_call',
		})),
		currency: params.currency,
		totalAmount: params.totalAmount,
		dueDate: params.dueDate ? new Date(params.dueDate).toISOString() : undefined,
	});
}

export async function getAgents(): Promise<Agent[]> {
	const data = await fetchApi<Agent[]>('/dashboard/agents');
	if (data && data.length > 0) return data;

	return mockAgents;
}

export async function getAgent(did: string): Promise<Agent | null> {
	const agents = await getAgents();
	return agents.find((a) => a.did === did) ?? null;
}

export async function getApiKeys(): Promise<ApiKey[]> {
	return [
		{
			id: 'key_001',
			name: 'Production',
			prefix: 'fl_live_a3k9',
			createdAt: '2024-01-10T00:00:00Z',
			lastUsed: new Date().toISOString(),
			status: 'ACTIVE',
		},
		{
			id: 'key_002',
			name: 'Staging',
			prefix: 'fl_test_b7m2',
			createdAt: '2024-03-15T00:00:00Z',
			lastUsed: new Date().toISOString(),
			status: 'ACTIVE',
		},
	];
}

export async function getWebhooks(): Promise<Webhook[]> {
	return [
		{
			id: 'wh_001',
			url: 'https://api.example.com/webhooks/prooflink',
			events: ['check.completed', 'check.failed'],
			status: 'ACTIVE',
			createdAt: '2024-06-01T00:00:00Z',
			lastTriggered: new Date().toISOString(),
		},
	];
}

export async function getTeamMembers(): Promise<TeamMember[]> {
	return [
		{
			id: 'usr_001',
			name: 'Akash',
			email: 'akash@prooflink.io',
			role: 'ADMIN',
			status: 'ACTIVE',
			joinedAt: '2024-01-01T00:00:00Z',
		},
	];
}

export async function getCompliancePolicy(): Promise<CompliancePolicy> {
	return {
		riskScoreThreshold: 70,
		maxTransactionAmount: 100000,
		velocityLimit: 50,
		velocityWindow: '1h',
		failOpen: false,
		blockedJurisdictions: ['KP', 'IR', 'SY', 'CU'],
		customWatchlist: [],
	};
}

export async function getNotificationPreferences(): Promise<NotificationPreferences> {
	return {
		emailOnFailedCheck: true,
		emailOnHighRisk: true,
		emailOnNewAgent: false,
		webhookOnAllChecks: false,
		dailyDigest: true,
		weeklyReport: true,
	};
}

export async function getAnalyticsData(): Promise<AnalyticsData> {
	const volumeByPeriod = Array.from({ length: 30 }, (_, i) => {
		const d = new Date();
		d.setDate(d.getDate() - (29 - i));
		return {
			date: d.toISOString().split('T')[0],
			volume: Math.floor(Math.random() * 300000) + 50000,
			count: Math.floor(Math.random() * 60) + 10,
		};
	});

	const agents = await getAgents();

	return {
		volumeByPeriod,
		complianceBreakdown: [
			{ status: 'Approved', count: 3847, color: '#34d399' },
			{ status: 'Rejected', count: 312, color: '#f87171' },
			{ status: 'Escalated', count: 189, color: '#fbbf24' },
		],
		riskDistribution: [
			{ range: '0-10', count: 1240 },
			{ range: '11-20', count: 980 },
			{ range: '21-30', count: 720 },
			{ range: '31-40', count: 450 },
			{ range: '41-50', count: 310 },
			{ range: '51-60', count: 180 },
			{ range: '61-70', count: 120 },
			{ range: '71-80', count: 85 },
			{ range: '81-90', count: 42 },
			{ range: '91-100', count: 21 },
		],
		topAgents: agents
			.filter((a) => a.checksPerformed > 0)
			.map((a) => ({
				did: a.did,
				name: a.name,
				volume: a.transactionVolume ?? 0,
				checks: a.checksPerformed,
				passRate: 85 + Math.random() * 14,
			}))
			.sort((a, b) => b.checks - a.checks),
		geoDistribution: [
			{ country: 'United States', count: 1450, percentage: 33.4 },
			{ country: 'Germany', count: 620, percentage: 14.3 },
			{ country: 'Singapore', count: 430, percentage: 9.9 },
			{ country: 'Others', count: 638, percentage: 14.5 },
		],
	};
}

export async function getActivityFeed(): Promise<ActivityEvent[]> {
	const types: ActivityEvent['type'][] = [
		'check_pass',
		'check_fail',
		'check_review',
		'invoice_paid',
		'agent_verified',
		'webhook_triggered',
	];
	const messages: Record<string, string> = {
		check_pass: 'Compliance check passed',
		check_fail: 'Compliance check failed',
		check_review: 'Manual review required',
		invoice_paid: 'Invoice payment received',
		agent_verified: 'Agent KYA verified',
		agent_revoked: 'Agent credential revoked',
		key_created: 'New API key created',
		webhook_triggered: 'Webhook delivered',
	};

	return Array.from({ length: 30 }, (_, i) => {
		const type = types[Math.floor(Math.random() * types.length)];
		return {
			id: `evt_${String(i + 1).padStart(4, '0')}`,
			type,
			message: messages[type],
			detail: type.includes('check')
				? `${randomAddress().slice(0, 12)}... on ${CHAINS[Math.floor(Math.random() * CHAINS.length)]}`
				: `Agent ${Math.floor(Math.random() * 5) + 1}`,
			timestamp: randomDate(7),
			agentDid: `did:web:agent${Math.floor(Math.random() * 5) + 1}.prooflink.io`,
			checkId: type.includes('check')
				? `chk_${String(Math.floor(Math.random() * 50) + 1).padStart(4, '0')}`
				: undefined,
		};
	}).sort(
		(a, b) =>
			new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
	);
}

export async function getSystemHealth(): Promise<SystemHealth> {
	const data = await fetchApi<SystemHealth>('/dashboard/health');
	if (data) return data;

	return {
		status: 'operational',
		uptime: 99.97,
		latency: 42,
		lastChecked: new Date().toISOString(),
		services: [
			{ name: 'Compliance Engine', status: 'operational' },
			{ name: 'OFAC Screening', status: 'operational' },
			{ name: 'Risk Scoring', status: 'operational' },
			{ name: 'Database', status: 'down' },
			{ name: 'KYA Verification', status: 'operational' },
		],
	};
}
