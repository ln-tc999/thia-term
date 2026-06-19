import { describe, it, expect } from "vitest";
import {
  ProofLinkError,
  SanctionsMatchError,
  SanctionsError,
  AMLError,
  ComplianceError,
  NetworkError,
  TimeoutError,
  ValidationError,
  AuthError,
  KYAVerificationError,
  TravelRuleError,
  ComplianceCheckFailedError,
  InvoiceValidationError,
  AuthenticationError,
  RateLimitError,
  PaymentError,
  ConfigurationError,
  NotFoundError,
  UpstreamServiceError,
  ErrorCode,
} from "../errors.js";

// ---------------------------------------------------------------------------
// ProofLinkError (base)
// ---------------------------------------------------------------------------

describe("ProofLinkError", () => {
  it("sets name, message, code, statusCode and details", () => {
    const err = new ProofLinkError("bad thing", "BAD_THING" as ErrorCode, 400, {
      field: "x",
    });

    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(ProofLinkError);
    expect(err.name).toBe("ProofLinkError");
    expect(err.message).toBe("bad thing");
    expect(err.code).toBe("BAD_THING");
    expect(err.statusCode).toBe(400);
    expect(err.details).toEqual({ field: "x" });
  });

  it("defaults statusCode to 500 when omitted", () => {
    const err = new ProofLinkError("oops", "OOPS" as ErrorCode);
    expect(err.statusCode).toBe(500);
  });

  it("defaults details to empty object when omitted", () => {
    const err = new ProofLinkError("oops", "OOPS" as ErrorCode, 500);
    expect(err.details).toEqual({});
  });

  it("toJSON returns all fields", () => {
    const err = new ProofLinkError("msg", "CODE" as ErrorCode, 418, { extra: true });
    const json = err.toJSON();

    expect(json.name).toBe("ProofLinkError");
    expect(json.message).toBe("msg");
    expect(json.code).toBe("CODE");
    expect(json.statusCode).toBe(418);
    expect(json.details).toEqual({ extra: true });
  });

  it("has a stack trace", () => {
    const err = new ProofLinkError("trace test", "INTERNAL_ERROR");
    expect(err.stack).toBeDefined();
    expect(typeof err.stack).toBe("string");
  });

  it("toJSON output is JSON-serializable (no circular refs)", () => {
    const err = new ProofLinkError("serializable", "INTERNAL_ERROR", 500, { nested: { val: 1 } });
    expect(() => JSON.stringify(err.toJSON())).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// ErrorCode mapping completeness
// ---------------------------------------------------------------------------

describe("ErrorCode", () => {
  it("exports all expected error code strings", () => {
    const expectedCodes = [
      "SANCTIONS_MATCH",
      "SANCTIONS_SCREENING_FAILED",
      "AML_THRESHOLD_EXCEEDED",
      "AML_SCORING_FAILED",
      "TRAVEL_RULE_FAILED",
      "TRAVEL_RULE_TIMEOUT",
      "KYA_VERIFICATION_FAILED",
      "KYA_CREDENTIAL_EXPIRED",
      "COMPLIANCE_CHECK_FAILED",
      "COMPLIANCE_POLICY_VIOLATION",
      "INVOICE_VALIDATION_FAILED",
      "INVOICE_NOT_FOUND",
      "PAYMENT_FAILED",
      "INSUFFICIENT_FUNDS",
      "AUTHENTICATION_FAILED",
      "AUTHORIZATION_FAILED",
      "API_KEY_EXPIRED",
      "API_KEY_REVOKED",
      "RATE_LIMIT_EXCEEDED",
      "NETWORK_ERROR",
      "TIMEOUT",
      "UPSTREAM_SERVICE_ERROR",
      "VALIDATION_ERROR",
      "INVALID_ADDRESS",
      "INVALID_CHAIN",
      "CONFIGURATION_INVALID",
      "NOT_FOUND",
      "INTERNAL_ERROR",
    ];
    for (const code of expectedCodes) {
      expect(ErrorCode).toHaveProperty(code, code);
    }
  });

  it("each ErrorCode value equals its key", () => {
    for (const [k, v] of Object.entries(ErrorCode)) {
      expect(v).toBe(k);
    }
  });
});

// ---------------------------------------------------------------------------
// SanctionsError / SanctionsMatchError (deprecated alias)
// ---------------------------------------------------------------------------

describe("SanctionsError", () => {
  it("includes address and lists in message and details", () => {
    const err = new SanctionsError("0xBAD", ["OFAC_SDN", "EU_CONSOLIDATED"]);

    expect(err).toBeInstanceOf(ProofLinkError);
    expect(err.name).toBe("SanctionsError");
    expect(err.code).toBe("SANCTIONS_MATCH");
    expect(err.statusCode).toBe(403);
    expect(err.message).toContain("0xBAD");
    expect(err.message).toContain("OFAC_SDN");
    expect(err.details.address).toBe("0xBAD");
    expect(err.details.matchedLists).toEqual(["OFAC_SDN", "EU_CONSOLIDATED"]);
  });

  it("merges extra details", () => {
    const err = new SanctionsError("0xFOO", ["OFAC_SDN"], {
      txHash: "0xabc",
    });
    expect(err.details.txHash).toBe("0xabc");
  });

  it("includes all matched lists in message", () => {
    const lists = ["OFAC_SDN", "EU_CONSOLIDATED", "UN_CONSOLIDATED"];
    const err = new SanctionsError("0xADDR", lists);
    for (const list of lists) {
      expect(err.message).toContain(list);
    }
  });

  it("toJSON serializes address and matchedLists", () => {
    const err = new SanctionsError("0xBAD", ["HMT"]);
    const json = err.toJSON();
    const details = json.details as Record<string, unknown>;
    expect(details.address).toBe("0xBAD");
    expect(details.matchedLists).toEqual(["HMT"]);
  });
});

describe("SanctionsMatchError (deprecated alias)", () => {
  it("SanctionsMatchError is the same class as SanctionsError", () => {
    expect(SanctionsMatchError).toBe(SanctionsError);
  });

  it("instances created via alias are instanceof SanctionsError and ProofLinkError", () => {
    const err = new SanctionsMatchError("0xBAD", ["OFAC_SDN"]);
    expect(err).toBeInstanceOf(SanctionsError);
    expect(err).toBeInstanceOf(ProofLinkError);
    expect(err).toBeInstanceOf(Error);
  });

  it("alias produces SanctionsError name (not SanctionsMatchError)", () => {
    const err = new SanctionsMatchError("0xBAD", ["OFAC_SDN"]);
    // The class is SanctionsError, so .name is "SanctionsError"
    expect(err.name).toBe("SanctionsError");
  });
});

// ---------------------------------------------------------------------------
// AMLError
// ---------------------------------------------------------------------------

describe("AMLError", () => {
  it("sets code AML_THRESHOLD_EXCEEDED with statusCode 403", () => {
    const err = new AMLError(90, 85);

    expect(err).toBeInstanceOf(ProofLinkError);
    expect(err.name).toBe("AMLError");
    expect(err.code).toBe("AML_THRESHOLD_EXCEEDED");
    expect(err.statusCode).toBe(403);
    expect(err.message).toContain("90");
    expect(err.message).toContain("85");
    expect(err.details.riskScore).toBe(90);
    expect(err.details.threshold).toBe(85);
  });

  it("merges extra details", () => {
    const err = new AMLError(95, 85, { address: "0xRISKY" });
    expect(err.details.address).toBe("0xRISKY");
    expect(err.details.riskScore).toBe(95);
  });

  it("edge case: score exactly at threshold still encodes correctly", () => {
    const err = new AMLError(85, 85);
    expect(err.message).toContain("85");
  });
});

// ---------------------------------------------------------------------------
// ComplianceError
// ---------------------------------------------------------------------------

describe("ComplianceError", () => {
  it("formats message with checkType and reason", () => {
    const err = new ComplianceError("SANCTIONS_SCREENING", "API timeout");

    expect(err).toBeInstanceOf(ProofLinkError);
    expect(err.name).toBe("ComplianceError");
    expect(err.message).toContain("SANCTIONS_SCREENING");
    expect(err.message).toContain("API timeout");
    expect(err.code).toBe("COMPLIANCE_CHECK_FAILED");
    expect(err.statusCode).toBe(403);
    expect(err.details.checkType).toBe("SANCTIONS_SCREENING");
    expect(err.details.reason).toBe("API timeout");
  });

  it("accepts custom code and statusCode overrides", () => {
    const err = new ComplianceError(
      "AML_MONITORING",
      "provider down",
      "COMPLIANCE_POLICY_VIOLATION",
      451,
    );
    expect(err.code).toBe("COMPLIANCE_POLICY_VIOLATION");
    expect(err.statusCode).toBe(451);
  });

  it("merges extra details into the error", () => {
    const err = new ComplianceError("TRAVEL_RULE", "failed", "COMPLIANCE_CHECK_FAILED", 403, {
      country: "IR",
    });
    expect(err.details.country).toBe("IR");
    expect(err.details.checkType).toBe("TRAVEL_RULE");
  });
});

// ---------------------------------------------------------------------------
// KYAVerificationError
// ---------------------------------------------------------------------------

describe("KYAVerificationError", () => {
  it("sets code KYA_VERIFICATION_FAILED with statusCode 403", () => {
    const err = new KYAVerificationError("agent-001", "credential expired");

    expect(err.name).toBe("KYAVerificationError");
    expect(err.code).toBe("KYA_VERIFICATION_FAILED");
    expect(err.statusCode).toBe(403);
    expect(err.message).toContain("agent-001");
    expect(err.message).toContain("credential expired");
    expect(err.details.agentId).toBe("agent-001");
    expect(err.details.reason).toBe("credential expired");
  });

  it("merges extra details", () => {
    const err = new KYAVerificationError("agent-002", "untrusted issuer", {
      issuer: "did:web:untrusted.example.com",
    });
    expect(err.details.issuer).toBe("did:web:untrusted.example.com");
  });

  it("is instanceof ProofLinkError", () => {
    const err = new KYAVerificationError("a", "b");
    expect(err).toBeInstanceOf(ProofLinkError);
  });
});

// ---------------------------------------------------------------------------
// TravelRuleError
// ---------------------------------------------------------------------------

describe("TravelRuleError", () => {
  it("sets code TRAVEL_RULE_FAILED with statusCode 502", () => {
    const err = new TravelRuleError("Notabene API returned 503");

    expect(err.name).toBe("TravelRuleError");
    expect(err.code).toBe("TRAVEL_RULE_FAILED");
    expect(err.statusCode).toBe(502);
    expect(err.message).toContain("Notabene API returned 503");
  });

  it("stores reason in details", () => {
    const err = new TravelRuleError("timeout after 10s");
    expect(err.details.reason).toBe("timeout after 10s");
  });

  it("merges extra details", () => {
    const err = new TravelRuleError("fail", { provider: "notabene", retries: 3 });
    expect(err.details.provider).toBe("notabene");
    expect(err.details.retries).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// ComplianceCheckFailedError
// ---------------------------------------------------------------------------

describe("ComplianceCheckFailedError", () => {
  it("encodes checkType and reason into message", () => {
    const err = new ComplianceCheckFailedError(
      "SANCTIONS_SCREENING",
      "API timeout",
    );

    expect(err.name).toBe("ComplianceCheckFailedError");
    expect(err.code).toBe("COMPLIANCE_CHECK_FAILED");
    expect(err.statusCode).toBe(403);
    expect(err.message).toContain("SANCTIONS_SCREENING");
    expect(err.message).toContain("API timeout");
    expect(err.details.checkType).toBe("SANCTIONS_SCREENING");
  });

  it("is instanceof ComplianceError and ProofLinkError", () => {
    const err = new ComplianceCheckFailedError("AML_MONITORING", "scorer failed");
    expect(err).toBeInstanceOf(ComplianceError);
    expect(err).toBeInstanceOf(ProofLinkError);
    expect(err).toBeInstanceOf(Error);
  });

  it("merges extra details", () => {
    const err = new ComplianceCheckFailedError("KYA_VERIFICATION", "reason", {
      agentId: "agent-007",
    });
    expect(err.details.agentId).toBe("agent-007");
  });
});

// ---------------------------------------------------------------------------
// NetworkError
// ---------------------------------------------------------------------------

describe("NetworkError", () => {
  it("sets code NETWORK_ERROR with statusCode 502", () => {
    const err = new NetworkError("ECONNREFUSED");

    expect(err.name).toBe("NetworkError");
    expect(err.code).toBe("NETWORK_ERROR");
    expect(err.statusCode).toBe(502);
    expect(err.message).toContain("ECONNREFUSED");
    expect(err.details.reason).toBe("ECONNREFUSED");
  });

  it("is instanceof ProofLinkError", () => {
    const err = new NetworkError("ETIMEDOUT");
    expect(err).toBeInstanceOf(ProofLinkError);
    expect(err).toBeInstanceOf(Error);
  });

  it("merges extra details", () => {
    const err = new NetworkError("DNS failure", { host: "api.chainalysis.com" });
    expect(err.details.host).toBe("api.chainalysis.com");
  });
});

// ---------------------------------------------------------------------------
// TimeoutError
// ---------------------------------------------------------------------------

describe("TimeoutError", () => {
  it("sets code TIMEOUT with statusCode 504 and exposes timeoutMs", () => {
    const err = new TimeoutError("sanctions-screen", 5000);

    expect(err.name).toBe("TimeoutError");
    expect(err.code).toBe("TIMEOUT");
    expect(err.statusCode).toBe(504);
    expect(err.timeoutMs).toBe(5000);
    expect(err.message).toContain("sanctions-screen");
    expect(err.message).toContain("5000ms");
    expect(err.details.operation).toBe("sanctions-screen");
    expect(err.details.timeoutMs).toBe(5000);
  });

  it("is instanceof ProofLinkError", () => {
    const err = new TimeoutError("op", 1000);
    expect(err).toBeInstanceOf(ProofLinkError);
    expect(err).toBeInstanceOf(Error);
  });

  it("merges extra details", () => {
    const err = new TimeoutError("kya-verify", 3000, { agentId: "agent-42" });
    expect(err.details.agentId).toBe("agent-42");
  });
});

// ---------------------------------------------------------------------------
// ValidationError
// ---------------------------------------------------------------------------

describe("ValidationError", () => {
  it("summarizes single field error correctly", () => {
    const err = new ValidationError([{ field: "amount", message: "must be positive" }]);

    expect(err.name).toBe("ValidationError");
    expect(err.code).toBe("VALIDATION_ERROR");
    expect(err.statusCode).toBe(400);
    expect(err.message).toContain("amount");
    expect(err.message).toContain("must be positive");
    expect(err.fieldErrors).toHaveLength(1);
    expect(err.fieldErrors[0]).toEqual({ field: "amount", message: "must be positive" });
  });

  it("uses generic summary when multiple fields fail", () => {
    const errors = [
      { field: "amount", message: "must be positive" },
      { field: "chain", message: "unsupported" },
      { field: "asset", message: "unknown token" },
    ];
    const err = new ValidationError(errors);

    expect(err.message).toContain("3");
    expect(err.fieldErrors).toHaveLength(3);
  });

  it("stores fieldErrors on details", () => {
    const fieldErrors = [{ field: "sender", message: "required" }];
    const err = new ValidationError(fieldErrors);
    expect(err.details.fieldErrors).toEqual(fieldErrors);
  });

  it("merges extra details", () => {
    const err = new ValidationError(
      [{ field: "url", message: "invalid" }],
      { endpoint: "/api/v1/invoices" },
    );
    expect(err.details.endpoint).toBe("/api/v1/invoices");
  });

  it("is instanceof ProofLinkError", () => {
    const err = new ValidationError([{ field: "f", message: "m" }]);
    expect(err).toBeInstanceOf(ProofLinkError);
    expect(err).toBeInstanceOf(Error);
  });
});

// ---------------------------------------------------------------------------
// AuthError
// ---------------------------------------------------------------------------

describe("AuthError", () => {
  it("defaults to AUTHENTICATION_FAILED code and 401 statusCode", () => {
    const err = new AuthError("bad token");

    expect(err.name).toBe("AuthError");
    expect(err.code).toBe("AUTHENTICATION_FAILED");
    expect(err.statusCode).toBe(401);
    expect(err.message).toContain("bad token");
    expect(err.details.reason).toBe("bad token");
  });

  it("uses 403 statusCode when code is AUTHORIZATION_FAILED", () => {
    const err = new AuthError("insufficient scopes", "AUTHORIZATION_FAILED");
    expect(err.code).toBe("AUTHORIZATION_FAILED");
    expect(err.statusCode).toBe(403);
  });

  it("accepts API_KEY_EXPIRED code", () => {
    const err = new AuthError("key expired", "API_KEY_EXPIRED");
    expect(err.code).toBe("API_KEY_EXPIRED");
    expect(err.statusCode).toBe(401);
  });

  it("merges extra details", () => {
    const err = new AuthError("revoked", "API_KEY_REVOKED", { keyId: "key_abc" });
    expect(err.details.keyId).toBe("key_abc");
  });
});

// ---------------------------------------------------------------------------
// AuthenticationError (deprecated alias for AuthError)
// ---------------------------------------------------------------------------

describe("AuthenticationError", () => {
  it("sets statusCode 401 and code AUTHENTICATION_FAILED", () => {
    const err = new AuthenticationError("invalid API key");

    expect(err.name).toBe("AuthenticationError");
    expect(err.code).toBe("AUTHENTICATION_FAILED");
    expect(err.statusCode).toBe(401);
    expect(err.message).toContain("invalid API key");
  });

  it("is instanceof AuthError and ProofLinkError", () => {
    const err = new AuthenticationError("reason");
    expect(err).toBeInstanceOf(AuthError);
    expect(err).toBeInstanceOf(ProofLinkError);
    expect(err).toBeInstanceOf(Error);
  });

  it("merges extra details", () => {
    const err = new AuthenticationError("expired", { expiredAt: "2026-01-01T00:00:00Z" });
    expect(err.details.expiredAt).toBe("2026-01-01T00:00:00Z");
  });
});

// ---------------------------------------------------------------------------
// InvoiceValidationError
// ---------------------------------------------------------------------------

describe("InvoiceValidationError", () => {
  it("includes invoiceId in message when provided", () => {
    const err = new InvoiceValidationError("inv_001", "negative amount");

    expect(err.name).toBe("InvoiceValidationError");
    expect(err.code).toBe("INVOICE_VALIDATION_FAILED");
    expect(err.statusCode).toBe(400);
    expect(err.message).toContain("inv_001");
    expect(err.message).toContain("negative amount");
  });

  it("omits invoiceId from message when undefined", () => {
    const err = new InvoiceValidationError(undefined, "missing seller");

    expect(err.message).not.toContain("undefined");
    expect(err.message).toContain("missing seller");
  });

  it("stores invoiceId and reason in details", () => {
    const err = new InvoiceValidationError("inv_999", "currency not supported");
    expect(err.details.invoiceId).toBe("inv_999");
    expect(err.details.reason).toBe("currency not supported");
  });

  it("stores undefined invoiceId in details when not provided", () => {
    const err = new InvoiceValidationError(undefined, "bad line items");
    expect(err.details.invoiceId).toBeUndefined();
  });

  it("merges extra details", () => {
    const err = new InvoiceValidationError("inv_555", "bad currency", { currency: "XYZ" });
    expect(err.details.currency).toBe("XYZ");
  });
});

// ---------------------------------------------------------------------------
// RateLimitError
// ---------------------------------------------------------------------------

describe("RateLimitError", () => {
  it("exposes retryAfterSeconds and statusCode 429", () => {
    const err = new RateLimitError(30);

    expect(err.name).toBe("RateLimitError");
    expect(err.code).toBe("RATE_LIMIT_EXCEEDED");
    expect(err.statusCode).toBe(429);
    expect(err.retryAfterSeconds).toBe(30);
    expect(err.message).toContain("30s");
  });

  it("stores retryAfterSeconds in details", () => {
    const err = new RateLimitError(60);
    expect(err.details.retryAfterSeconds).toBe(60);
  });

  it("works for very short retry windows", () => {
    const err = new RateLimitError(1);
    expect(err.retryAfterSeconds).toBe(1);
    expect(err.message).toContain("1s");
  });

  it("merges extra details", () => {
    const err = new RateLimitError(15, { limit: 100, window: "1m" });
    expect(err.details.limit).toBe(100);
    expect(err.details.window).toBe("1m");
  });
});

// ---------------------------------------------------------------------------
// PaymentError
// ---------------------------------------------------------------------------

describe("PaymentError", () => {
  it("includes protocol in message and statusCode 402", () => {
    const err = new PaymentError("insufficient funds", "x402");

    expect(err.name).toBe("PaymentError");
    expect(err.code).toBe("PAYMENT_FAILED");
    expect(err.statusCode).toBe(402);
    expect(err.message).toContain("x402");
    expect(err.message).toContain("insufficient funds");
    expect(err.details.protocol).toBe("x402");
  });

  it("stores reason in details", () => {
    const err = new PaymentError("gas limit exceeded", "direct");
    expect(err.details.reason).toBe("gas limit exceeded");
    expect(err.details.protocol).toBe("direct");
  });

  it("merges extra details", () => {
    const err = new PaymentError("tx failed", "mpp", { txHash: "0xfailed" });
    expect(err.details.txHash).toBe("0xfailed");
  });
});

// ---------------------------------------------------------------------------
// ConfigurationError
// ---------------------------------------------------------------------------

describe("ConfigurationError", () => {
  it("encodes field and reason, statusCode 500", () => {
    const err = new ConfigurationError("rpcUrl", "must be a valid URL");

    expect(err.name).toBe("ConfigurationError");
    expect(err.code).toBe("CONFIGURATION_INVALID");
    expect(err.statusCode).toBe(500);
    expect(err.message).toContain("rpcUrl");
    expect(err.message).toContain("must be a valid URL");
    expect(err.details.field).toBe("rpcUrl");
  });

  it("stores reason in details", () => {
    const err = new ConfigurationError("chainalysisKey", "must be non-empty");
    expect(err.details.reason).toBe("must be non-empty");
  });

  it("merges extra details", () => {
    const err = new ConfigurationError("travelRuleThreshold", "negative value", {
      value: -1,
    });
    expect(err.details.value).toBe(-1);
  });
});

// ---------------------------------------------------------------------------
// NotFoundError
// ---------------------------------------------------------------------------

describe("NotFoundError", () => {
  it("sets statusCode 404 and NOT_FOUND code", () => {
    const err = new NotFoundError("Receipt", "rcpt_abc123");

    expect(err.name).toBe("NotFoundError");
    expect(err.code).toBe("NOT_FOUND");
    expect(err.statusCode).toBe(404);
    expect(err.message).toContain("Receipt");
    expect(err.message).toContain("rcpt_abc123");
    expect(err.details.resource).toBe("Receipt");
    expect(err.details.id).toBe("rcpt_abc123");
  });

  it("works for any resource type", () => {
    for (const [resource, id] of [
      ["Invoice", "inv_001"],
      ["Agent", "agent-007"],
      ["WebhookConfig", "wh_abc"],
    ]) {
      const err = new NotFoundError(resource, id);
      expect(err.message).toContain(resource);
      expect(err.message).toContain(id);
      expect(err.details.resource).toBe(resource);
      expect(err.details.id).toBe(id);
    }
  });

  it("merges extra details", () => {
    const err = new NotFoundError("Invoice", "inv_404", { ownerId: "owner-001" });
    expect(err.details.ownerId).toBe("owner-001");
  });
});

// ---------------------------------------------------------------------------
// UpstreamServiceError
// ---------------------------------------------------------------------------

describe("UpstreamServiceError", () => {
  it("sets statusCode 502 and UPSTREAM_SERVICE_ERROR code", () => {
    const err = new UpstreamServiceError("chainalysis", "connection refused");

    expect(err.name).toBe("UpstreamServiceError");
    expect(err.code).toBe("UPSTREAM_SERVICE_ERROR");
    expect(err.statusCode).toBe(502);
    expect(err.message).toContain("chainalysis");
    expect(err.message).toContain("connection refused");
    expect(err.details.service).toBe("chainalysis");
  });

  it("stores reason in details", () => {
    const err = new UpstreamServiceError("notabene", "rate limited");
    expect(err.details.reason).toBe("rate limited");
  });

  it("merges extra details", () => {
    const err = new UpstreamServiceError("ofac_api", "503 response", { statusCode: 503 });
    expect(err.details.statusCode).toBe(503);
  });
});

// ---------------------------------------------------------------------------
// instanceof hierarchy
// ---------------------------------------------------------------------------

describe("error instanceof chain", () => {
  it("all subclasses are instanceof ProofLinkError and Error", () => {
    const errors = [
      new SanctionsError("0x1", ["OFAC_SDN"]),
      new SanctionsMatchError("0x1", ["OFAC_SDN"]), // alias
      new AMLError(90, 85),
      new ComplianceError("CHECK", "reason"),
      new NetworkError("fail"),
      new TimeoutError("op", 1000),
      new ValidationError([{ field: "f", message: "m" }]),
      new AuthError("reason"),
      new KYAVerificationError("agent", "reason"),
      new TravelRuleError("fail"),
      new ComplianceCheckFailedError("check", "reason"),
      new InvoiceValidationError("inv", "reason"),
      new AuthenticationError("reason"),
      new RateLimitError(10),
      new PaymentError("reason", "x402"),
      new ConfigurationError("field", "reason"),
      new NotFoundError("Resource", "id"),
      new UpstreamServiceError("svc", "reason"),
    ];

    for (const err of errors) {
      expect(err).toBeInstanceOf(Error);
      expect(err).toBeInstanceOf(ProofLinkError);
    }
  });

  it("ComplianceCheckFailedError is instanceof ComplianceError", () => {
    const err = new ComplianceCheckFailedError("CHECK", "reason");
    expect(err).toBeInstanceOf(ComplianceError);
  });

  it("AuthenticationError is instanceof AuthError", () => {
    const err = new AuthenticationError("reason");
    expect(err).toBeInstanceOf(AuthError);
  });

  it("SanctionsMatchError (alias) instances are instanceof SanctionsError", () => {
    const err = new SanctionsMatchError("0xBAD", ["OFAC_SDN"]);
    expect(err).toBeInstanceOf(SanctionsError);
  });
});

// ---------------------------------------------------------------------------
// toJSON round-trip
// ---------------------------------------------------------------------------

describe("error toJSON serialization", () => {
  it("toJSON output for all error classes contains expected keys", () => {
    const errors: ProofLinkError[] = [
      new SanctionsError("0xADDR", ["OFAC_SDN"]),
      new AMLError(95, 85),
      new TravelRuleError("timeout"),
      new KYAVerificationError("agent-001", "expired"),
      new ComplianceCheckFailedError("SANCTIONS", "api down"),
      new InvoiceValidationError("inv_001", "bad state"),
      new AuthenticationError("bad key"),
      new RateLimitError(30),
      new PaymentError("fail", "x402"),
      new ConfigurationError("rpc", "invalid"),
      new NotFoundError("Agent", "agent-001"),
      new UpstreamServiceError("chainalysis", "down"),
    ];

    for (const err of errors) {
      const json = err.toJSON();
      expect(json).toHaveProperty("name");
      expect(json).toHaveProperty("message");
      expect(json).toHaveProperty("code");
      expect(json).toHaveProperty("statusCode");
      expect(json).toHaveProperty("details");
      expect(typeof json.statusCode).toBe("number");
      expect(() => JSON.stringify(json)).not.toThrow();
    }
  });
});
