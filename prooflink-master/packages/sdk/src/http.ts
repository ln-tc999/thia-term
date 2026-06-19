import {
  ProofLinkAPIError,
  ProofLinkNetworkError,
  ProofLinkTimeoutError,
  type ApiErrorBody,
} from "./errors.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

interface RequestOptions {
  method: HttpMethod;
  path: string;
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined>;
}

export interface HttpClientConfig {
  baseUrl: string;
  apiKey: string;
  timeoutMs: number;
  maxRetries: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const RETRYABLE_STATUS_CODES = new Set([408, 429, 500, 502, 503, 504]);

function buildQueryString(
  params: Record<string, string | number | boolean | undefined>,
): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) {
      parts.push(
        `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`,
      );
    }
  }
  return parts.length > 0 ? `?${parts.join("&")}` : "";
}

function isRetryable(status: number): boolean {
  return RETRYABLE_STATUS_CODES.has(status);
}

function backoffMs(attempt: number): number {
  // Exponential backoff: 500ms, 1s, 2s, ... capped at 8s, with jitter
  // Jitter is applied within the cap, not on top of it, to keep worst-case predictable
  const base = Math.min(500 * 2 ** attempt, 8000);
  const jitter = Math.random() * base * 0.25;
  return Math.min(base + jitter, 8000);
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// HTTP client
// ---------------------------------------------------------------------------

/**
 * Thin HTTP transport for the ProofLink API.
 *
 * - Attaches the API-key header to every request.
 * - Automatically retries transient failures with exponential backoff.
 * - Parses JSON responses and surfaces structured errors.
 * - Distinguishes timeout errors from generic network errors.
 */
export class HttpClient {
  private readonly config: HttpClientConfig;

  constructor(config: HttpClientConfig) {
    this.config = config;
  }

  /** Issue a GET request. */
  async get<T>(path: string, query?: RequestOptions["query"]): Promise<T> {
    return this.request<T>({ method: "GET", path, query });
  }

  /** Issue a POST request. */
  async post<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>({ method: "POST", path, body });
  }

  /** Issue a PUT request. */
  async put<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>({ method: "PUT", path, body });
  }

  /** Issue a PATCH request. */
  async patch<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>({ method: "PATCH", path, body });
  }

  /** Issue a DELETE request. */
  async delete<T>(path: string): Promise<T> {
    return this.request<T>({ method: "DELETE", path });
  }

  // -------------------------------------------------------------------------
  // Internal
  // -------------------------------------------------------------------------

  private async request<T>(opts: RequestOptions): Promise<T> {
    const url = `${this.config.baseUrl}${opts.path}${
      opts.query ? buildQueryString(opts.query) : ""
    }`;

    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.config.apiKey}`,
      Accept: "application/json",
    };

    if (opts.body !== undefined) {
      headers["Content-Type"] = "application/json";
    }

    const bodyStr =
      opts.body !== undefined ? JSON.stringify(opts.body) : undefined;

    let lastError: unknown;

    for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
      if (attempt > 0) {
        await sleep(backoffMs(attempt - 1));
      }

      // Rebuild fetchInit each attempt so each gets a fresh AbortSignal.
      const fetchInit: RequestInit = {
        method: opts.method,
        headers,
        body: bodyStr,
        signal: AbortSignal.timeout(this.config.timeoutMs),
      };

      let response: Response;
      try {
        response = await fetch(url, fetchInit);
      } catch (err: unknown) {
        lastError = err;

        // Distinguish timeout from other network errors
        if (
          err instanceof DOMException &&
          err.name === "TimeoutError"
        ) {
          if (attempt < this.config.maxRetries) continue;
          throw new ProofLinkTimeoutError(this.config.timeoutMs, url);
        }

        // Generic network error — retryable
        if (attempt < this.config.maxRetries) continue;
        throw new ProofLinkNetworkError(
          `Network error after ${attempt + 1} attempt(s): ${String(err)}`,
          { cause: err },
        );
      }

      if (response.ok) {
        // 204 No Content
        if (response.status === 204) return undefined as T;
        return (await response.json()) as T;
      }

      // Non-retryable failure
      if (!isRetryable(response.status)) {
        const body = await this.tryParseErrorBody(response);
        throw new ProofLinkAPIError(response.status, body, response.headers);
      }

      // Retryable failure — respect Retry-After if present
      const retryAfterHeader = response.headers.get("Retry-After");
      if (retryAfterHeader !== null) {
        const retryAfterSeconds = Number(retryAfterHeader);
        if (!Number.isNaN(retryAfterSeconds)) {
          await sleep(retryAfterSeconds * 1000);
        }
      }
      lastError = new ProofLinkAPIError(
        response.status,
        await this.tryParseErrorBody(response),
        response.headers,
      );
    }

    // All retries exhausted
    if (lastError instanceof ProofLinkAPIError) throw lastError;
    throw new ProofLinkNetworkError(
      `Request failed after ${this.config.maxRetries + 1} attempt(s)`,
      { cause: lastError },
    );
  }

  private async tryParseErrorBody(
    res: Response,
  ): Promise<ApiErrorBody | null> {
    try {
      const json = (await res.json()) as Record<string, unknown>;
      if (typeof json.code === "string" && typeof json.message === "string") {
        return json as unknown as ApiErrorBody;
      }
      return { code: "UNKNOWN", message: JSON.stringify(json) };
    } catch {
      return null;
    }
  }
}
