import type {
  AgentIdentity,
  AMLRiskScore,
  ComplianceDecision,
  ComplianceReceipt,
  KYACredential,
  KYAVerificationResult,
  SanctionsCheckResult,
  TravelRuleData,
} from "@prooflink/shared/types";
import type { AgentInvoice, InvoiceState } from "@prooflink/shared/types";
import type { CheckPerformed } from "@prooflink/shared/types";

import { ProofLinkValidationError } from "./errors.js";
import { HttpClient } from "./http.js";
import type {
  AgentRegistration,
  ComplianceCheckParams,
  ComplianceHistoryParams,
  CreateInvoiceParams,
  ProofLinkClientConfig,
  IssueKYAParams,
  ListInvoicesParams,
  PaginatedResponse,
  PaginationParams,
  TransactionContext,
  TravelRuleResult,
} from "./types.js";

const DEFAULT_BASE_URL = "https://api.prooflink.io/v1";
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_RETRIES = 3;

/**
 * ProofLink client SDK.
 *
 * Provides typed methods for every ProofLink API endpoint: compliance checks,
 * sanctions screening, AML risk scoring, travel-rule transmission,
 * invoice management, and agent identity / KYA operations.
 *
 * @example
 * ```ts
 * import { ProofLinkClient } from "@prooflink/sdk";
 *
 * const client = new ProofLinkClient({ apiKey: "fl_live_..." });
 *
 * const decision = await client.checkCompliance({
 *   sender: { address: "0xAlice", chain: "base" },
 *   receiver: { address: "0xBob", chain: "base" },
 *   amount: "5000",
 *   asset: "USDC",
 * });
 * ```
 */
export class ProofLinkClient {
  private readonly http: HttpClient;

  constructor(config: ProofLinkClientConfig) {
    if (!config.apiKey) {
      throw new ProofLinkValidationError("apiKey is required", "apiKey");
    }

    this.http = new HttpClient({
      baseUrl: config.baseUrl ?? DEFAULT_BASE_URL,
      apiKey: config.apiKey,
      timeoutMs: config.timeout ?? DEFAULT_TIMEOUT_MS,
      maxRetries: config.maxRetries ?? DEFAULT_MAX_RETRIES,
    });
  }

  // -----------------------------------------------------------------------
  // Compliance
  // -----------------------------------------------------------------------

  /**
   * Run the full compliance pipeline for a proposed transfer.
   *
   * Executes sanctions screening, AML scoring, travel-rule transmission,
   * and jurisdictional checks, returning a single {@link ComplianceDecision}.
   */
  async checkCompliance(
    params: ComplianceCheckParams,
  ): Promise<ComplianceDecision> {
    return this.http.post<ComplianceDecision>("/compliance/check", params);
  }

  /**
   * Screen a single wallet address against all configured sanctions lists.
   */
  async screenAddress(
    address: string,
    chain: string,
  ): Promise<SanctionsCheckResult> {
    if (!address) {
      throw new ProofLinkValidationError(
        "address is required",
        "address",
      );
    }
    if (!chain) {
      throw new ProofLinkValidationError("chain is required", "chain");
    }
    return this.http.post<SanctionsCheckResult>("/compliance/screen", {
      address,
      chain,
    });
  }

  /**
   * Calculate the AML risk score for a transaction context.
   *
   * Returns the risk score, contributing factors, and whether
   * the configured threshold is exceeded.
   */
  async calculateRiskScore(
    context: TransactionContext,
  ): Promise<AMLRiskScore> {
    return this.http.post<AMLRiskScore>("/compliance/risk-score", context);
  }

  /**
   * Submit travel-rule data for a transfer and check transmission status.
   *
   * Handles IVMS101 payload formatting and VASP-to-VASP messaging
   * via the configured travel-rule provider.
   */
  async checkTravelRule(data: TravelRuleData): Promise<TravelRuleResult> {
    return this.http.post<TravelRuleResult>("/compliance/travel-rule", data);
  }

  /**
   * Retrieve a previously issued compliance receipt by its ID.
   */
  async getComplianceReceipt(receiptId: string): Promise<ComplianceReceipt> {
    if (!receiptId) {
      throw new ProofLinkValidationError(
        "receiptId is required",
        "receiptId",
      );
    }
    return this.http.get<ComplianceReceipt>(
      `/compliance/receipt/${encodeURIComponent(receiptId)}`,
    );
  }

  /**
   * List historical compliance checks with optional filters.
   */
  async getComplianceHistory(
    params: ComplianceHistoryParams = {},
  ): Promise<PaginatedResponse<CheckPerformed>> {
    return this.http.get<PaginatedResponse<CheckPerformed>>(
      "/compliance/history",
      {
        page: params.page,
        limit: params.limit,
        status: params.status,
        from: params.from,
        to: params.to,
      },
    );
  }

  // -----------------------------------------------------------------------
  // Invoices
  // -----------------------------------------------------------------------

  /**
   * Create a new agent-to-agent invoice.
   *
   * The invoice starts in `DRAFT` state.
   */
  async createInvoice(params: CreateInvoiceParams): Promise<AgentInvoice> {
    return this.http.post<AgentInvoice>("/invoices", params);
  }

  /**
   * Fetch an invoice by its unique ID.
   */
  async getInvoice(id: string): Promise<AgentInvoice> {
    if (!id) {
      throw new ProofLinkValidationError("id is required", "id");
    }
    return this.http.get<AgentInvoice>(
      `/invoices/${encodeURIComponent(id)}`,
    );
  }

  /**
   * List invoices with optional filters.
   */
  async listInvoices(
    params: ListInvoicesParams = {},
  ): Promise<PaginatedResponse<AgentInvoice>> {
    return this.http.get<PaginatedResponse<AgentInvoice>>("/invoices", {
      page: params.page,
      limit: params.limit,
      state: params.state,
      currency: params.currency,
      seller: params.seller,
      buyer: params.buyer,
      from: params.from,
      to: params.to,
    });
  }

  /**
   * Transition an invoice to a new state.
   *
   * Valid transitions: `DRAFT -> ISSUED -> PAID -> SETTLED`,
   * `DRAFT | ISSUED -> CANCELLED`, `PAID -> DISPUTED`.
   */
  async updateInvoiceState(
    invoiceId: string,
    state: InvoiceState,
    reason?: string,
  ): Promise<AgentInvoice> {
    if (!invoiceId) {
      throw new ProofLinkValidationError(
        "invoiceId is required",
        "invoiceId",
      );
    }
    return this.http.patch<AgentInvoice>(
      `/invoices/${encodeURIComponent(invoiceId)}/state`,
      { state, reason },
    );
  }

  // -----------------------------------------------------------------------
  // Identity / KYA
  // -----------------------------------------------------------------------

  /**
   * Verify an agent's KYA credential and return its trust score.
   */
  async verifyAgent(agentId: string): Promise<KYAVerificationResult> {
    if (!agentId) {
      throw new ProofLinkValidationError(
        "agentId is required",
        "agentId",
      );
    }
    return this.http.post<KYAVerificationResult>("/identity/verify", {
      agentId,
    });
  }

  /**
   * Register a new agent and issue a KYA credential.
   *
   * Creates the agent record and returns the agent identity
   * along with a W3C Verifiable Credential.
   */
  async registerAgent(
    agent: AgentRegistration,
  ): Promise<AgentIdentity> {
    return this.http.post<AgentIdentity>("/identity/kya/issue", agent);
  }

  /**
   * Retrieve the full identity profile of a registered agent.
   */
  async getAgentIdentity(agentId: string): Promise<AgentIdentity> {
    if (!agentId) {
      throw new ProofLinkValidationError(
        "agentId is required",
        "agentId",
      );
    }
    return this.http.get<AgentIdentity>(
      `/identity/${encodeURIComponent(agentId)}`,
    );
  }

  /**
   * List all registered agents with optional pagination.
   */
  async listAgents(
    params: PaginationParams = {},
  ): Promise<PaginatedResponse<AgentIdentity>> {
    return this.http.get<PaginatedResponse<AgentIdentity>>(
      "/identity/agents",
      {
        page: params.page,
        limit: params.limit,
      },
    );
  }

  /**
   * Issue a new KYA (Know Your Agent) verifiable credential.
   */
  async issueKYA(params: IssueKYAParams): Promise<KYACredential> {
    return this.http.post<KYACredential>("/identity/kya/issue", params);
  }
}
