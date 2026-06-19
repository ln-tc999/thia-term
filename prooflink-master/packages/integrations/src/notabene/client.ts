// ---------------------------------------------------------------------------
// Notabene Travel Rule — API client
// ---------------------------------------------------------------------------

import type { TravelRuleData } from "@prooflink/shared";
import type {
  ListTransfersParams,
  NotabeneConfig,
  NotabeneResponse,
  NotabeneTransfer,
} from "./types.js";

const DEFAULT_BASE_URL = "https://api.notabene.id/v1";
const DEFAULT_TESTNET_URL = "https://api.notabene.dev/v1";
const DEFAULT_TIMEOUT_MS = 10_000;

/** HTTP client interface — allows swapping fetch for testing. */
export interface HttpClient {
  fetch(url: string, init: RequestInit): Promise<Response>;
}

const defaultHttpClient: HttpClient = {
  fetch: (url, init) => globalThis.fetch(url, init),
};

/**
 * Notabene API client for Travel Rule data exchange (IVMS101).
 *
 * All network calls go through the injectable `HttpClient`, making
 * the class fully testable without mocking globals.
 */
export class NotabeneClient {
  private readonly apiKey: string;
  private readonly vaspDID: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly http: HttpClient;

  constructor(config: NotabeneConfig, http: HttpClient = defaultHttpClient) {
    this.apiKey = config.apiKey;
    this.vaspDID = config.vaspDID;
    this.baseUrl =
      config.baseUrl ??
      (config.testnet ? DEFAULT_TESTNET_URL : DEFAULT_BASE_URL);
    this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.http = http;
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Submit a new Travel Rule transfer to Notabene.
   *
   * Converts ProofLink `TravelRuleData` into the Notabene transfer format
   * and creates a new transfer via the API.
   */
  async submitTransfer(data: TravelRuleData): Promise<NotabeneResponse> {
    const body = {
      transactionType: "TRANSACTION",
      originatorVASPdid: this.vaspDID,
      originatorEqualsBeneficiary: false,
      transactionAsset: data.asset,
      transactionAmount: data.amountUsd.toString(),
      transactionBlockchainInfo: {
        txHash: data.txHash,
        origin: data.originator.walletAddress,
        destination: data.beneficiary.walletAddress,
      },
      originator: {
        originatorPersons: [
          {
            naturalPerson: {
              name: [
                {
                  nameIdentifier: [
                    {
                      primaryIdentifier: data.originator.name ?? "Unknown",
                    },
                  ],
                },
              ],
              geographicAddress: data.originator.physicalAddress
                ? [{ addressLine: [data.originator.physicalAddress] }]
                : undefined,
              nationalIdentification: data.originator.nationalId
                ? {
                    nationalIdentifier: data.originator.nationalId,
                    nationalIdentifierType: "NATIONAL_IDENTITY_NUMBER",
                  }
                : undefined,
            },
          },
        ],
        accountNumber: [data.originator.walletAddress],
      },
      beneficiary: {
        beneficiaryPersons: [
          {
            naturalPerson: {
              name: [
                {
                  nameIdentifier: [
                    {
                      primaryIdentifier: data.beneficiary.name ?? "Unknown",
                    },
                  ],
                },
              ],
            },
          },
        ],
        accountNumber: [data.beneficiary.walletAddress],
      },
    };

    const response = await this.request<NotabeneTransfer>(
      "POST",
      "/tx/create",
      body,
    );

    return {
      id: response.id,
      status: response.status,
      raw: response as unknown as Record<string, unknown>,
    };
  }

  /**
   * Retrieve a single transfer by its Notabene ID.
   */
  async getTransfer(id: string): Promise<NotabeneTransfer> {
    return this.request<NotabeneTransfer>("GET", `/tx/${encodeURIComponent(id)}`);
  }

  /**
   * List transfers with optional pagination and filtering.
   */
  async listTransfers(
    params: ListTransfersParams = {},
  ): Promise<NotabeneTransfer[]> {
    const query = new URLSearchParams();
    if (params.limit !== undefined) query.set("limit", String(params.limit));
    if (params.offset !== undefined) query.set("offset", String(params.offset));
    if (params.status) query.set("status", params.status);
    if (params.createdAfter) query.set("createdAfter", params.createdAfter);
    if (params.createdBefore) query.set("createdBefore", params.createdBefore);

    const qs = query.toString();
    const path = qs ? `/tx?${qs}` : "/tx";

    const response = await this.request<{ items: NotabeneTransfer[] }>(
      "GET",
      path,
    );
    return response.items;
  }

  // -------------------------------------------------------------------------
  // Private
  // -------------------------------------------------------------------------

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
        throw new Error(
          `Notabene API error ${response.status}: ${text}`,
        );
      }

      return (await response.json()) as T;
    } finally {
      clearTimeout(timeout);
    }
  }
}
