import type { ComplianceReceipt, ProofLinkReceipt } from "@prooflink/shared/types";
import type { RequestNetworkInvoice } from "./types.js";
import { RequestFinanceAdapter } from "./adapter.js";

// ---------------------------------------------------------------------------
// Compliance Bridge Config
// ---------------------------------------------------------------------------

export interface ComplianceBridgeConfig {
  /** ProofLink ProofLink API base URL */
  proofLinkApiUrl: string;
  /** API key for ProofLink compliance service */
  apiKey: string;
  /** Travel Rule threshold in USD — transactions above trigger IVMS101 */
  travelRuleThresholdUsd: number;
  /** When true, allow payment to proceed if compliance check is unreachable */
  failOpen: boolean;
  /** Request timeout in ms */
  timeoutMs: number;
}

// ---------------------------------------------------------------------------
// Compliance Check Result
// ---------------------------------------------------------------------------

export interface ComplianceBridgeResult {
  approved: boolean;
  receipt: ComplianceReceipt | null;
  proofLinkReceipt: ProofLinkReceipt | null;
  /** Updated RN invoice with compliance metadata attached */
  enrichedInvoice: RequestNetworkInvoice;
  blockReason?: string;
}

// ---------------------------------------------------------------------------
// Compliance Bridge Errors
// ---------------------------------------------------------------------------

export class ComplianceBridgeError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "ComplianceBridgeError";
  }
}

// ---------------------------------------------------------------------------
// ComplianceBridge
// ---------------------------------------------------------------------------

/**
 * Bridge between Request Network payment flow and ProofLink compliance.
 *
 * Workflow:
 * 1. Before Request Finance processes a payment, call `checkBeforePayment`
 * 2. ProofLink runs sanctions screening, AML scoring, Travel Rule
 * 3. If approved, ProofLink receipt is attached to RN invoice metadata
 * 4. Payment proceeds (or is blocked) based on compliance decision
 *
 * This enables any Request Network payment to get ProofLink compliance
 * without modifying the Request Network protocol itself.
 */
export class ComplianceBridge {
  private readonly config: ComplianceBridgeConfig;
  private readonly adapter: RequestFinanceAdapter;

  constructor(config: ComplianceBridgeConfig) {
    this.config = config;
    this.adapter = new RequestFinanceAdapter();
  }

  // -------------------------------------------------------------------------
  // Pre-Payment Compliance Check
  // -------------------------------------------------------------------------

  /**
   * Run ProofLink compliance check before a Request Network payment.
   *
   * This is the primary integration point: call this before executing
   * payment on the Request Network payment contracts.
   */
  async checkBeforePayment(
    rnInvoice: RequestNetworkInvoice,
  ): Promise<ComplianceBridgeResult> {
    const prooflinkInvoice = this.adapter.fromRequestNetwork(rnInvoice);

    try {
      // Call ProofLink ProofLink compliance API
      const complianceResponse = await this.callProofLink({
        sender: rnInvoice.payer.value,
        receiver: rnInvoice.payee.value,
        amount: rnInvoice.expectedAmount,
        asset: prooflinkInvoice.currency,
        chain: this.resolveCAIP2Chain(rnInvoice.currency.network),
        protocol: "DIRECT",
        invoiceId: prooflinkInvoice.invoiceId,
      });

      const approved = complianceResponse.overallStatus === "APPROVED";

      // Build ProofLink receipt if compliant
      const proofLinkReceipt: ProofLinkReceipt | null = approved
        ? {
            version: 1 as const,
            network: this.resolveCAIP2Chain(rnInvoice.currency.network),
            sender: rnInvoice.payer.value,
            receiver: rnInvoice.payee.value,
            amount: rnInvoice.expectedAmount,
            asset: prooflinkInvoice.currency,
            complianceDecision: {
              status: "APPROVED",
              riskScore: complianceResponse.riskScore,
              receiptId: complianceResponse.receiptId,
              receiptHash: complianceResponse.signature,
              checks: complianceResponse.checksPerformed,
              travelRuleStatus: complianceResponse.travelRuleStatus,
              timestamp: complianceResponse.timestamp,
              ttl: 300,
            },
            invoiceId: prooflinkInvoice.invoiceId,
            attestationUid: complianceResponse.easAttestationUid,
            ipfsCid: complianceResponse.ipfsCid,
            createdAt: new Date().toISOString(),
          }
        : null;

      // Attach compliance data to RN invoice
      const enrichedInvoice = this.attachComplianceToInvoice(
        rnInvoice,
        complianceResponse,
        approved,
      );

      return {
        approved,
        receipt: complianceResponse,
        proofLinkReceipt,
        enrichedInvoice,
        ...(approved ? {} : { blockReason: this.extractBlockReason(complianceResponse) }),
      };
    } catch (error) {
      if (this.config.failOpen) {
        return {
          approved: true,
          receipt: null,
          proofLinkReceipt: null,
          enrichedInvoice: rnInvoice,
          blockReason: undefined,
        };
      }

      throw new ComplianceBridgeError(
        "ProofLink compliance check failed and failOpen is disabled",
        error,
      );
    }
  }

  // -------------------------------------------------------------------------
  // Travel Rule Compliance
  // -------------------------------------------------------------------------

  /**
   * Submit Travel Rule (IVMS101) data for a Request Network payment.
   *
   * Call this for transactions above the Travel Rule threshold.
   * ProofLink handles VASP-to-VASP transmission via Notabene/OpenVASP.
   */
  async submitTravelRule(params: {
    rnInvoice: RequestNetworkInvoice;
    originatorName?: string;
    originatorAddress?: string;
    beneficiaryName?: string;
    beneficiaryAddress?: string;
  }): Promise<{ transmitted: boolean; travelRuleId: string }> {
    const amountUsd = this.estimateUsdAmount(params.rnInvoice);

    if (amountUsd < this.config.travelRuleThresholdUsd) {
      return { transmitted: false, travelRuleId: "" };
    }

    const response = await this.postToProofLink("/travel-rule/submit", {
      originator: {
        walletAddress: params.rnInvoice.payer.value,
        name: params.originatorName,
        physicalAddress: params.originatorAddress,
      },
      beneficiary: {
        walletAddress: params.rnInvoice.payee.value,
        name: params.beneficiaryName,
        physicalAddress: params.beneficiaryAddress,
      },
      amountUsd,
      asset: this.resolveAssetSymbol(params.rnInvoice),
      chain: this.resolveCAIP2Chain(params.rnInvoice.currency.network),
      direction: "outgoing" as const,
      preTransaction: true,
    });

    return {
      transmitted: response.status === "TRANSMITTED",
      travelRuleId: response.travelRuleId as string,
    };
  }

  // -------------------------------------------------------------------------
  // Attach ProofLink Receipt to RN Invoice
  // -------------------------------------------------------------------------

  /**
   * Attach an existing ProofLink receipt to a Request Network invoice.
   * Used to retroactively mark RN invoices as ProofLink-compliant.
   */
  attachProofLinkReceipt(
    rnInvoice: RequestNetworkInvoice,
    receipt: ProofLinkReceipt,
  ): RequestNetworkInvoice {
    return {
      ...rnInvoice,
      contentData: {
        ...rnInvoice.contentData,
        prooflinkCompliance: {
          proofLinkReceiptId: receipt.complianceDecision.receiptId,
          complianceStatus: receipt.complianceDecision.status === "APPROVED"
            ? "verified"
            : "blocked",
          sanctionsCleared: receipt.complianceDecision.checks.some(
            (c) =>
              c.checkType === "SANCTIONS_SCREENING" && c.result === "PASSED",
          ),
          travelRuleTransmitted:
            receipt.complianceDecision.travelRuleStatus === "TRANSMITTED",
          amlRiskScore: receipt.complianceDecision.riskScore,
          easAttestationUid: receipt.attestationUid,
        },
      },
    };
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private async callProofLink(params: {
    sender: string;
    receiver: string;
    amount: string;
    asset: string;
    chain: string;
    protocol: string;
    invoiceId: string;
  }): Promise<ComplianceReceipt> {
    const response = await this.postToProofLink("/compliance/check", params);
    return response as unknown as ComplianceReceipt;
  }

  private async postToProofLink(
    path: string,
    body: unknown,
  ): Promise<Record<string, unknown>> {
    const url = `${this.config.proofLinkApiUrl}${path}`;

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.config.timeoutMs),
    });

    if (!response.ok) {
      throw new ComplianceBridgeError(
        `ProofLink API ${path} failed: ${response.status} ${response.statusText}`,
      );
    }

    return response.json() as Promise<Record<string, unknown>>;
  }

  private attachComplianceToInvoice(
    rnInvoice: RequestNetworkInvoice,
    receipt: ComplianceReceipt,
    approved: boolean,
  ): RequestNetworkInvoice {
    return {
      ...rnInvoice,
      contentData: {
        ...rnInvoice.contentData,
        prooflinkCompliance: {
          proofLinkReceiptId: receipt.receiptId,
          complianceStatus: approved ? "verified" : "blocked",
          sanctionsCleared: receipt.checksPerformed.some(
            (c) =>
              c.checkType === "SANCTIONS_SCREENING" && c.result === "PASSED",
          ),
          travelRuleTransmitted:
            receipt.travelRuleStatus === "TRANSMITTED",
          amlRiskScore: receipt.riskScore,
          easAttestationUid: receipt.easAttestationUid,
        },
      },
    };
  }

  private extractBlockReason(receipt: ComplianceReceipt): string {
    const failedChecks = receipt.checksPerformed
      .filter((c) => c.result === "FAILED")
      .map((c) => `${c.checkType}: ${c.detail ?? "failed"}`)
      .join("; ");

    return failedChecks || `Blocked with risk score ${receipt.riskScore}`;
  }

  private resolveCAIP2Chain(rnChain: string): string {
    const chainMap: Record<string, string> = {
      mainnet: "eip155:1",
      gnosis: "eip155:100",
      polygon: "eip155:137",
      arbitrum: "eip155:42161",
      optimism: "eip155:10",
      base: "eip155:8453",
      bsc: "eip155:56",
      sepolia: "eip155:11155111",
    };
    return chainMap[rnChain] ?? `eip155:1`;
  }

  private estimateUsdAmount(rnInvoice: RequestNetworkInvoice): number {
    // For stablecoins, amount ≈ USD. For others, this is a rough estimate.
    const decimals = rnInvoice.currency.decimals ?? 6;
    return Number(rnInvoice.expectedAmount) / 10 ** decimals;
  }

  private resolveAssetSymbol(rnInvoice: RequestNetworkInvoice): string {
    if (rnInvoice.currency.type === "ISO4217") {
      return rnInvoice.currency.value;
    }
    // Try to resolve from contentData
    return (
      rnInvoice.contentData?.invoiceItems?.[0]?.currency ?? "USDC"
    );
  }
}
