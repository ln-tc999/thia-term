import { describe, expect, it, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mocks — use vi.hoisted() so the factory closure can reference the mock fn
// before module-level variable initialization (vitest hoists vi.mock calls).
// ---------------------------------------------------------------------------

const { mockBroadcastWsEvent } = vi.hoisted(() => ({
  mockBroadcastWsEvent: vi.fn(),
}));

vi.mock("../../routes/ws.js", () => ({
  broadcastWsEvent: mockBroadcastWsEvent,
}));

vi.mock("../../utils/logger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// audit.ts is statically imported by events.ts — mock it as a no-op
vi.mock("../../utils/audit.js", () => ({
  writeAuditLog: vi.fn(),
}));

// ---------------------------------------------------------------------------
// SUT imports (after mocks are registered)
// ---------------------------------------------------------------------------

import { emitComplianceEvent, emitSanctionsAlert } from "../../utils/events.js";
import { logger } from "../../utils/logger.js";

const mockLogger = vi.mocked(logger);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

// ---------------------------------------------------------------------------
// emitComplianceEvent
// ---------------------------------------------------------------------------

describe("emitComplianceEvent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns an event object with the correct type", () => {
    const event = emitComplianceEvent("compliance.check.passed", {
      checkId: "abc",
    });
    expect(event.type).toBe("compliance.check.passed");
  });

  it("returns an event with a valid UUID v4 id", () => {
    const event = emitComplianceEvent("compliance.check.passed", {});
    expect(event.id).toMatch(UUID_RE);
  });

  it("returns an event with an ISO timestamp", () => {
    const event = emitComplianceEvent("compliance.check.passed", {});
    expect(event.timestamp).toMatch(ISO_RE);
  });

  it("timestamp is recent (within 5s of now)", () => {
    const before = Date.now();
    const event = emitComplianceEvent("invoice.created", { invoiceId: "x" });
    const after = Date.now();
    const ts = new Date(event.timestamp).getTime();
    expect(ts).toBeGreaterThanOrEqual(before - 10);
    expect(ts).toBeLessThanOrEqual(after + 10);
  });

  it("includes the provided data in the returned event", () => {
    const data = { checkId: "test-check-001", riskScore: 42 };
    const event = emitComplianceEvent("compliance.check.passed", data);
    expect(event.data).toEqual(data);
  });

  it("attaches traceId when provided in options", () => {
    const event = emitComplianceEvent(
      "compliance.check.passed",
      { checkId: "abc" },
      { traceId: "trace-xyz" },
    );
    expect(event.traceId).toBe("trace-xyz");
  });

  it("omits traceId when not provided", () => {
    const event = emitComplianceEvent("compliance.check.passed", {});
    expect(event.traceId).toBeUndefined();
  });

  it("calls broadcastWsEvent exactly once with the returned event", () => {
    const event = emitComplianceEvent("invoice.paid", { invoiceId: "inv-1" });
    expect(mockBroadcastWsEvent).toHaveBeenCalledOnce();
    expect(mockBroadcastWsEvent).toHaveBeenCalledWith(event);
  });

  it("generates a unique id for each call", () => {
    const e1 = emitComplianceEvent("compliance.check.passed", {});
    const e2 = emitComplianceEvent("compliance.check.passed", {});
    expect(e1.id).not.toBe(e2.id);
  });

  it("logs at info level after broadcasting", () => {
    emitComplianceEvent("compliance.check.failed", { reason: "sanctioned" });
    expect(mockLogger.info).toHaveBeenCalledWith(
      "Compliance event emitted",
      expect.objectContaining({ eventType: "compliance.check.failed" }),
    );
  });

  it("works for all valid compliance event types", () => {
    const types = [
      "compliance.check.passed",
      "compliance.check.failed",
      "compliance.check.review",
      "sanctions.alert",
      "invoice.created",
      "invoice.paid",
    ] as const;

    for (const type of types) {
      vi.clearAllMocks();
      const event = emitComplianceEvent(type, { test: true });
      expect(event.type).toBe(type);
      expect(mockBroadcastWsEvent).toHaveBeenCalledOnce();
    }
  });

  it("forwards receiptId, invoiceId, agentDid, apiKeyId options without error", () => {
    expect(() =>
      emitComplianceEvent(
        "compliance.check.passed",
        { checkId: "abc" },
        {
          receiptId: "receipt-001",
          invoiceId: "inv-001",
          agentDid: "did:prooflink:agent:001",
          apiKeyId: "key-001",
        },
      ),
    ).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// emitSanctionsAlert
// ---------------------------------------------------------------------------

describe("emitSanctionsAlert", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns an event with type 'sanctions.alert'", () => {
    const event = emitSanctionsAlert({ address: "0xsanctioned" });
    expect(event.type).toBe("sanctions.alert");
  });

  it("returns an event with a valid UUID v4 id", () => {
    const event = emitSanctionsAlert({ address: "0xsanctioned" });
    expect(event.id).toMatch(UUID_RE);
  });

  it("returns an event with an ISO timestamp", () => {
    const event = emitSanctionsAlert({});
    expect(event.timestamp).toMatch(ISO_RE);
  });

  it("includes the provided data in the returned event", () => {
    const data = {
      address: "0xdeadbeef",
      listMatched: "OFAC_SDN",
      country: "XX",
    };
    const event = emitSanctionsAlert(data);
    expect(event.data).toEqual(data);
  });

  it("calls broadcastWsEvent exactly once with the returned event", () => {
    const event = emitSanctionsAlert({ address: "0xbad" });
    expect(mockBroadcastWsEvent).toHaveBeenCalledOnce();
    expect(mockBroadcastWsEvent).toHaveBeenCalledWith(event);
  });

  it("logs at ERROR level with sanctions alert message", () => {
    emitSanctionsAlert({ address: "0xbad", list: "OFAC_SDN" });

    expect(mockLogger.error).toHaveBeenCalledOnce();
    expect(mockLogger.error).toHaveBeenCalledWith(
      "SANCTIONS ALERT: address matched sanctions list",
      expect.objectContaining({ address: "0xbad", list: "OFAC_SDN" }),
    );
  });

  it("error log includes the eventId", () => {
    const event = emitSanctionsAlert({ address: "0xbad" });

    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ eventId: event.id }),
    );
  });

  it("attaches traceId when provided in options", () => {
    const event = emitSanctionsAlert(
      { address: "0xbad" },
      { traceId: "trace-sanctions-001" },
    );
    expect(event.traceId).toBe("trace-sanctions-001");
  });

  it("omits traceId when not provided", () => {
    const event = emitSanctionsAlert({ address: "0xbad" });
    expect(event.traceId).toBeUndefined();
  });

  it("generates a unique id on each call", () => {
    const e1 = emitSanctionsAlert({ address: "0xa" });
    const e2 = emitSanctionsAlert({ address: "0xb" });
    expect(e1.id).not.toBe(e2.id);
  });

  it("does NOT call logger.info (error only — high priority path)", () => {
    emitSanctionsAlert({ address: "0xbad" });
    // sanctions alert logs at error, not info
    expect(mockLogger.info).not.toHaveBeenCalled();
  });
});
