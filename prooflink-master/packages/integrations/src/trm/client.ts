// ---------------------------------------------------------------------------
// TRM Labs AML — API client
// ---------------------------------------------------------------------------

import type {
  TRMAddressReport,
  TRMConfig,
  TRMRiskCategory,
  TRMScreeningResult,
} from "./types.js";

const DEFAULT_BASE_URL = "https://api.trmlabs.com";
const DEFAULT_TIMEOUT_MS = 10_000;

/** HTTP client interface — allows swapping fetch for testing. */
export interface TRMHttpClient {
  fetch(url: string, init: RequestInit): Promise<Response>;
}

const defaultHttpClient: TRMHttpClient = {
  fetch: (url, init) => globalThis.fetch(url, init),
};

/**
 * TRM Labs API client for on-chain address screening and AML analysis.
 *
 * Provides wallet-level risk scoring, sanctions detection, and
 * counterparty exposure analysis via the TRM Labs REST API.
 */
export class TRMClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly http: TRMHttpClient;

  constructor(config: TRMConfig, http: TRMHttpClient = defaultHttpClient) {
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
    this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.http = http;
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Screen a single address for sanctions and risk indicators.
   *
   * @param address - Wallet address to screen
   * @param chain - Chain identifier (e.g., "ethereum", "bitcoin")
   */
  async screenAddress(
    address: string,
    chain: string,
  ): Promise<TRMScreeningResult> {
    const body = [
      {
        address,
        chain,
      },
    ];

    const results = await this.request<
      Array<{
        address: string;
        chain: string;
        addressRiskIndicators: Array<{
          category: string;
          categoryRiskScoreLevel: number;
          incomingVolumeUsd: string;
          outgoingVolumeUsd: string;
          totalVolumeUsd: string;
          riskType: string;
        }>;
        entities: Array<{
          name: string;
          url?: string;
          category: string;
          subCategory?: string;
        }>;
        addressSubmitted: string;
        externalId?: string;
      }>
    >("POST", "/public/v2/screening/addresses", body);

    const result = results[0];
    if (!result) {
      throw new Error(`TRM returned empty result for address ${address}`);
    }

    const riskScore = this.computeRiskScore(result.addressRiskIndicators);
    const isSanctioned = result.addressRiskIndicators.some(
      (i) =>
        i.category.toLowerCase().includes("sanctions") ||
        i.categoryRiskScoreLevel >= 10,
    );

    return {
      address: result.addressSubmitted ?? address,
      chain,
      riskScore,
      riskCategory: this.categorizeRisk(riskScore, isSanctioned),
      isSanctioned,
      riskIndicators: result.addressRiskIndicators.map((i) => ({
        category: i.category,
        categoryRiskScoreLevel: i.categoryRiskScoreLevel,
        incomingVolumeUsd: i.incomingVolumeUsd,
        outgoingVolumeUsd: i.outgoingVolumeUsd,
        totalVolumeUsd: i.totalVolumeUsd,
        riskType: i.riskType,
      })),
      addressOwners: (result.entities ?? []).map((e) => ({
        name: e.name,
        url: e.url,
        type: e.category,
        subtype: e.subCategory,
      })),
      screenedAt: new Date().toISOString(),
    };
  }

  /**
   * Get a detailed address report with counterparty exposure.
   *
   * @param address - Wallet address to analyze
   * @param chain - Chain identifier (default: "ethereum")
   */
  async getAddressReport(
    address: string,
    chain = "ethereum",
  ): Promise<TRMAddressReport> {
    const screening = await this.screenAddress(address, chain);

    // Fetch additional details via the account endpoint
    const details = await this.request<{
      counterpartyVolume?: Array<{
        category: string;
        inboundVolumeUsd: string;
        outboundVolumeUsd: string;
      }>;
      totalReceivedUsd?: string;
      totalSentUsd?: string;
      transactionCount?: number;
      firstTransactionDate?: string;
      lastTransactionDate?: string;
    }>(
      "GET",
      `/public/v1/accounts/${encodeURIComponent(address)}?chain=${encodeURIComponent(chain)}`,
    );

    return {
      address: screening.address,
      chain,
      riskScore: screening.riskScore,
      riskCategory: screening.riskCategory,
      isSanctioned: screening.isSanctioned,
      riskIndicators: screening.riskIndicators,
      addressOwners: screening.addressOwners,
      counterpartyExposure: (details.counterpartyVolume ?? []).map((cv) => ({
        category: cv.category,
        inboundUsd: cv.inboundVolumeUsd,
        outboundUsd: cv.outboundVolumeUsd,
      })),
      volumeStats: {
        totalInboundUsd: details.totalReceivedUsd ?? "0",
        totalOutboundUsd: details.totalSentUsd ?? "0",
        transactionCount: details.transactionCount ?? 0,
        firstSeen: details.firstTransactionDate ?? "",
        lastSeen: details.lastTransactionDate ?? "",
      },
      generatedAt: new Date().toISOString(),
    };
  }

  // -------------------------------------------------------------------------
  // Private
  // -------------------------------------------------------------------------

  private computeRiskScore(
    indicators: Array<{ categoryRiskScoreLevel: number }>,
  ): number {
    if (indicators.length === 0) return 0;
    const maxLevel = Math.max(
      ...indicators.map((i) => i.categoryRiskScoreLevel),
    );
    // TRM risk levels are 0-10; normalize to 0-100
    return Math.min(100, maxLevel * 10);
  }

  private categorizeRisk(
    score: number,
    isSanctioned: boolean,
  ): TRMRiskCategory {
    if (isSanctioned) return "sanctions";
    if (score >= 90) return "severe_risk";
    if (score >= 70) return "high_risk";
    if (score >= 40) return "medium_risk";
    if (score >= 10) return "low_risk";
    if (score > 0) return "low_risk";
    return "no_risk";
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const url = `${this.baseUrl}${path}`;
      const response = await this.http.fetch(url, {
        method,
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`TRM Labs API error ${response.status}: ${text}`);
      }

      return (await response.json()) as T;
    } finally {
      clearTimeout(timeout);
    }
  }
}
