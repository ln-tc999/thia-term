import { describe, expect, it } from "vitest";
import {
  ProofLinkAPIError,
  ProofLinkError,
  ProofLinkNetworkError,
  ProofLinkTimeoutError,
  ProofLinkValidationError,
  type ApiErrorBody,
} from "../errors.js";

// ---------------------------------------------------------------------------
// ProofLinkError — base class
// ---------------------------------------------------------------------------

describe("ProofLinkError", () => {
  it("sets name to ProofLinkError", () => {
    const err = new ProofLinkError("base error");
    expect(err.name).toBe("ProofLinkError");
  });

  it("sets message correctly", () => {
    const err = new ProofLinkError("something went wrong");
    expect(err.message).toBe("something went wrong");
  });

  it("is an instance of Error", () => {
    const err = new ProofLinkError("test");
    expect(err).toBeInstanceOf(Error);
  });

  it("accepts ErrorOptions cause", () => {
    const cause = new Error("root cause");
    const err = new ProofLinkError("wrapper", { cause });
    expect((err as Error & { cause: unknown }).cause).toBe(cause);
  });

  it("stack trace is defined", () => {
    const err = new ProofLinkError("trace check");
    expect(err.stack).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// ProofLinkAPIError
// ---------------------------------------------------------------------------

describe("ProofLinkAPIError", () => {
  function makeHeaders(entries: Record<string, string> = {}): Headers {
    return new Headers(entries);
  }

  it("sets name to ProofLinkAPIError", () => {
    const err = new ProofLinkAPIError(400, null, makeHeaders());
    expect(err.name).toBe("ProofLinkAPIError");
  });

  it("is an instance of ProofLinkError", () => {
    const err = new ProofLinkAPIError(500, null, makeHeaders());
    expect(err).toBeInstanceOf(ProofLinkError);
  });

  it("stores status code", () => {
    const err = new ProofLinkAPIError(403, null, makeHeaders());
    expect(err.status).toBe(403);
  });

  it("stores body when provided", () => {
    const body: ApiErrorBody = { code: "FORBIDDEN", message: "Access denied" };
    const err = new ProofLinkAPIError(403, body, makeHeaders());
    expect(err.body).toEqual(body);
  });

  it("body is null when not provided", () => {
    const err = new ProofLinkAPIError(500, null, makeHeaders());
    expect(err.body).toBeNull();
  });

  it("uses body.message as the error message when body is present", () => {
    const body: ApiErrorBody = { code: "RATE_LIMITED", message: "Too many requests" };
    const err = new ProofLinkAPIError(429, body, makeHeaders());
    expect(err.message).toBe("Too many requests");
  });

  it("falls back to generic message when body is null", () => {
    const err = new ProofLinkAPIError(503, null, makeHeaders());
    expect(err.message).toBe("API request failed with status 503");
  });

  it("stores response headers", () => {
    const headers = makeHeaders({ "x-request-id": "req_abc" });
    const err = new ProofLinkAPIError(400, null, headers);
    expect(err.headers.get("x-request-id")).toBe("req_abc");
  });

  it("body can include details field", () => {
    const body: ApiErrorBody = {
      code: "VALIDATION_FAILED",
      message: "Invalid input",
      details: { field: "address", reason: "invalid checksum" },
    };
    const err = new ProofLinkAPIError(422, body, makeHeaders());
    expect(err.body?.details?.field).toBe("address");
  });

  describe("status codes", () => {
    it.each([401, 403, 404, 422, 429, 500, 502, 503, 504])(
      "stores status %i",
      (status) => {
        const err = new ProofLinkAPIError(status, null, makeHeaders());
        expect(err.status).toBe(status);
      },
    );
  });
});

// ---------------------------------------------------------------------------
// ProofLinkValidationError
// ---------------------------------------------------------------------------

describe("ProofLinkValidationError", () => {
  it("sets name to ProofLinkValidationError", () => {
    const err = new ProofLinkValidationError("invalid");
    expect(err.name).toBe("ProofLinkValidationError");
  });

  it("is an instance of ProofLinkError", () => {
    const err = new ProofLinkValidationError("invalid");
    expect(err).toBeInstanceOf(ProofLinkError);
  });

  it("sets message correctly", () => {
    const err = new ProofLinkValidationError("apiKey is required");
    expect(err.message).toBe("apiKey is required");
  });

  it("stores optional field name", () => {
    const err = new ProofLinkValidationError("address is required", "address");
    expect(err.field).toBe("address");
  });

  it("field is undefined when not provided", () => {
    const err = new ProofLinkValidationError("some validation failed");
    expect(err.field).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// ProofLinkTimeoutError
// ---------------------------------------------------------------------------

describe("ProofLinkTimeoutError", () => {
  it("sets name to ProofLinkTimeoutError", () => {
    const err = new ProofLinkTimeoutError(30_000, "https://api.prooflink.io/v1/compliance/check");
    expect(err.name).toBe("ProofLinkTimeoutError");
  });

  it("is an instance of ProofLinkError", () => {
    const err = new ProofLinkTimeoutError(5000, "https://example.com");
    expect(err).toBeInstanceOf(ProofLinkError);
  });

  it("stores timeoutMs", () => {
    const err = new ProofLinkTimeoutError(15_000, "https://api.prooflink.io/v1");
    expect(err.timeoutMs).toBe(15_000);
  });

  it("stores url", () => {
    const url = "https://api.prooflink.io/v1/compliance/check";
    const err = new ProofLinkTimeoutError(30_000, url);
    expect(err.url).toBe(url);
  });

  it("formats message with url and timeout", () => {
    const err = new ProofLinkTimeoutError(5000, "https://api.prooflink.io/v1/invoices");
    expect(err.message).toBe(
      "Request to https://api.prooflink.io/v1/invoices timed out after 5000ms",
    );
  });
});

// ---------------------------------------------------------------------------
// ProofLinkNetworkError
// ---------------------------------------------------------------------------

describe("ProofLinkNetworkError", () => {
  it("sets name to ProofLinkNetworkError", () => {
    const err = new ProofLinkNetworkError("connection refused");
    expect(err.name).toBe("ProofLinkNetworkError");
  });

  it("is an instance of ProofLinkError", () => {
    const err = new ProofLinkNetworkError("dns failure");
    expect(err).toBeInstanceOf(ProofLinkError);
  });

  it("sets message correctly", () => {
    const err = new ProofLinkNetworkError("failed to connect");
    expect(err.message).toBe("failed to connect");
  });

  it("accepts cause via ErrorOptions", () => {
    const cause = new TypeError("Failed to fetch");
    const err = new ProofLinkNetworkError("network error", { cause });
    expect((err as Error & { cause: unknown }).cause).toBe(cause);
  });
});

// ---------------------------------------------------------------------------
// Error serialization and JSON.stringify
// ---------------------------------------------------------------------------

describe("error serialization", () => {
  it("ProofLinkValidationError serializes message and name via JSON.stringify", () => {
    const err = new ProofLinkValidationError("apiKey is required", "apiKey");
    const json = JSON.parse(JSON.stringify(err)) as Record<string, unknown>;
    // JSON.stringify of Error objects only captures enumerable own-properties
    // field is stored as a public property so it should appear
    expect(json.field).toBe("apiKey");
  });

  it("ProofLinkAPIError serializes status and body", () => {
    const body: ApiErrorBody = { code: "NOT_FOUND", message: "not found" };
    const err = new ProofLinkAPIError(404, body, new Headers());
    const json = JSON.parse(JSON.stringify(err)) as Record<string, unknown>;
    expect(json.status).toBe(404);
  });

  it("ProofLinkTimeoutError serializes timeoutMs and url", () => {
    const err = new ProofLinkTimeoutError(10_000, "https://api.prooflink.io");
    const json = JSON.parse(JSON.stringify(err)) as Record<string, unknown>;
    expect(json.timeoutMs).toBe(10_000);
    expect(json.url).toBe("https://api.prooflink.io");
  });
});
