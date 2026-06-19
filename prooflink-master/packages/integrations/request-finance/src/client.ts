import type {
  RequestNetworkClientConfig,
  RequestNetworkInvoice,
  PaymentDetectionEvent,
} from "./types.js";

// ---------------------------------------------------------------------------
// Client Errors
// ---------------------------------------------------------------------------

export class RequestNetworkClientError extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "RequestNetworkClientError";
  }
}

// ---------------------------------------------------------------------------
// Request Network Client
// ---------------------------------------------------------------------------

/**
 * Wrapper around Request Network node and IPFS gateway APIs.
 *
 * This client handles:
 * - Creating payment requests on Request Network
 * - Detecting payments via the Request Network indexer (The Graph)
 * - Fetching invoice data from IPFS
 *
 * In production, this would use `@requestnetwork/request-client.js`.
 * This wrapper provides a clean interface that ProofLink controls,
 * decoupling from upstream SDK breaking changes.
 */
export class RequestNetworkClient {
  private readonly config: RequestNetworkClientConfig;

  constructor(config: RequestNetworkClientConfig) {
    this.config = config;
  }

  // -------------------------------------------------------------------------
  // Create Payment Request
  // -------------------------------------------------------------------------

  /**
   * Create a new payment request on Request Network.
   *
   * Publishes invoice data to IPFS via the Request Node gateway,
   * which anchors the CID on Gnosis Chain.
   */
  async createRequest(
    invoice: RequestNetworkInvoice,
  ): Promise<{ requestId: string; ipfsCid: string }> {
    const response = await this.post("/requests", {
      requestId: invoice.requestId,
      payee: invoice.payee,
      payer: invoice.payer,
      currency: invoice.currency,
      expectedAmount: invoice.expectedAmount,
      contentData: invoice.contentData,
      paymentDueDate: invoice.paymentDueDate,
      timestamp: invoice.timestamp,
    });

    if (!response.requestId || !response.ipfsCid) {
      throw new RequestNetworkClientError(
        "Request creation response missing requestId or ipfsCid",
      );
    }

    return {
      requestId: response.requestId as string,
      ipfsCid: response.ipfsCid as string,
    };
  }

  // -------------------------------------------------------------------------
  // Get Request by ID
  // -------------------------------------------------------------------------

  /**
   * Fetch a request by its ID from the Request Network node.
   */
  async getRequest(requestId: string): Promise<RequestNetworkInvoice> {
    const response = await this.get(`/requests/${requestId}`);
    return response as RequestNetworkInvoice;
  }

  // -------------------------------------------------------------------------
  // Payment Detection
  // -------------------------------------------------------------------------

  /**
   * Detect payments for a given request ID via the Request Network indexer.
   *
   * The indexer (powered by The Graph) watches payment contract events
   * and matches them to request IDs via payment references.
   */
  async detectPayments(
    requestId: string,
  ): Promise<PaymentDetectionEvent[]> {
    const response = await this.get(`/requests/${requestId}/payments`);

    if (!Array.isArray(response)) {
      return [];
    }

    return response as PaymentDetectionEvent[];
  }

  /**
   * Check if a request has been fully paid.
   * Compares total payment events against expectedAmount.
   */
  async isFullyPaid(requestId: string): Promise<{
    paid: boolean;
    expectedAmount: string;
    paidAmount: string;
    events: PaymentDetectionEvent[];
  }> {
    const [request, events] = await Promise.all([
      this.getRequest(requestId),
      this.detectPayments(requestId),
    ]);

    const paidAmount = events
      .filter((e) => e.name === "payment")
      .reduce((sum, e) => sum + BigInt(e.amount), 0n);

    return {
      paid: paidAmount >= BigInt(request.expectedAmount),
      expectedAmount: request.expectedAmount,
      paidAmount: paidAmount.toString(),
      events,
    };
  }

  // -------------------------------------------------------------------------
  // IPFS Data Retrieval
  // -------------------------------------------------------------------------

  /**
   * Fetch raw invoice data from IPFS by CID.
   */
  async fetchFromIPFS(cid: string): Promise<unknown> {
    const url = `${this.config.ipfsGatewayUrl}/ipfs/${cid}`;

    const response = await fetch(url, {
      signal: AbortSignal.timeout(this.config.timeoutMs),
    });

    if (!response.ok) {
      throw new RequestNetworkClientError(
        `IPFS fetch failed for CID ${cid}: ${response.status} ${response.statusText}`,
        response.status,
      );
    }

    return response.json();
  }

  /**
   * Fetch and parse invoice content data from IPFS.
   * Returns the contentData portion of a Request Network invoice.
   */
  async fetchInvoiceContent(
    cid: string,
  ): Promise<RequestNetworkInvoice["contentData"]> {
    const data = await this.fetchFromIPFS(cid);

    if (typeof data === "object" && data !== null && "contentData" in data) {
      return (data as { contentData: RequestNetworkInvoice["contentData"] })
        .contentData;
    }

    // The CID may point directly to contentData
    return data as RequestNetworkInvoice["contentData"];
  }

  // -------------------------------------------------------------------------
  // Private HTTP helpers
  // -------------------------------------------------------------------------

  private async post(
    path: string,
    body: unknown,
  ): Promise<Record<string, unknown>> {
    const url = `${this.config.nodeUrl}${path}`;

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(this.config.signerPrivateKey
          ? { Authorization: `Bearer ${this.config.signerPrivateKey}` }
          : {}),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.config.timeoutMs),
    });

    if (!response.ok) {
      throw new RequestNetworkClientError(
        `Request Network POST ${path} failed: ${response.status} ${response.statusText}`,
        response.status,
      );
    }

    return response.json() as Promise<Record<string, unknown>>;
  }

  private async get(path: string): Promise<unknown> {
    const url = `${this.config.nodeUrl}${path}`;

    const response = await fetch(url, {
      headers: {
        ...(this.config.signerPrivateKey
          ? { Authorization: `Bearer ${this.config.signerPrivateKey}` }
          : {}),
      },
      signal: AbortSignal.timeout(this.config.timeoutMs),
    });

    if (!response.ok) {
      throw new RequestNetworkClientError(
        `Request Network GET ${path} failed: ${response.status} ${response.statusText}`,
        response.status,
      );
    }

    return response.json();
  }
}
