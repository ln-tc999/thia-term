// ---------------------------------------------------------------------------
// Typed Event Emitter for ProofLink
// ---------------------------------------------------------------------------

import { EventEmitter } from "node:events";

import type {
  AMLRiskScore,
  ComplianceDecision,
  SanctionsCheckResult,
} from "@prooflink/shared";
import type { TransactionContext } from "../aml/scorer.js";
import type { ComplianceRequest } from "../engine/prooflink.js";

// ---------------------------------------------------------------------------
// Event Map
// ---------------------------------------------------------------------------

/** All typed events emitted by the ProofLink engine. */
export interface ProofLinkEvents {
  "compliance:decision": {
    request: ComplianceRequest;
    decision: ComplianceDecision;
  };
  "compliance:approved": {
    request: ComplianceRequest;
    decision: ComplianceDecision;
  };
  "compliance:rejected": {
    request: ComplianceRequest;
    decision: ComplianceDecision;
    reason: string;
  };
  "compliance:escalated": {
    request: ComplianceRequest;
    decision: ComplianceDecision;
  };
  "sanctions:match": {
    address: string;
    result: SanctionsCheckResult;
  };
  "sanctions:clean": {
    address: string;
  };
  "aml:high_risk": {
    context: TransactionContext;
    score: AMLRiskScore;
  };
  "travel_rule:required": {
    amount: number;
    jurisdiction: string;
  };
  error: {
    source: string;
    error: Error;
  };
}

// ---------------------------------------------------------------------------
// Type helpers
// ---------------------------------------------------------------------------

/** Valid event name from the ProofLinkEvents map. */
export type ProofLinkEventName = keyof ProofLinkEvents;

/** Listener callback type for a given event. */
export type ProofLinkEventListener<K extends ProofLinkEventName> = (
  payload: ProofLinkEvents[K],
) => void;

// ---------------------------------------------------------------------------
// TypedEventEmitter
// ---------------------------------------------------------------------------

/**
 * Type-safe event emitter wrapping Node.js EventEmitter.
 *
 * Provides compile-time enforcement of event names and payload shapes.
 * All ProofLink subsystems should use this instead of raw EventEmitter.
 */
export class TypedEventEmitter<
  TEvents extends { [K in keyof TEvents]: unknown } = ProofLinkEvents,
> {
  private readonly ee = new EventEmitter();

  constructor() {
    // Raise the default limit — compliance pipelines may have many listeners
    this.ee.setMaxListeners(50);
  }

  /**
   * Register a listener for the given event.
   * Returns `this` for chaining.
   */
  on<K extends keyof TEvents & string>(
    event: K,
    listener: (payload: TEvents[K]) => void,
  ): this {
    this.ee.on(event, listener as (...args: unknown[]) => void);
    return this;
  }

  /**
   * Register a one-time listener for the given event.
   * The listener is automatically removed after the first invocation.
   */
  once<K extends keyof TEvents & string>(
    event: K,
    listener: (payload: TEvents[K]) => void,
  ): this {
    this.ee.once(event, listener as (...args: unknown[]) => void);
    return this;
  }

  /**
   * Remove a previously registered listener.
   */
  off<K extends keyof TEvents & string>(
    event: K,
    listener: (payload: TEvents[K]) => void,
  ): this {
    this.ee.off(event, listener as (...args: unknown[]) => void);
    return this;
  }

  /**
   * Emit an event with the corresponding typed payload.
   * Returns `true` if the event had listeners, `false` otherwise.
   */
  emit<K extends keyof TEvents & string>(
    event: K,
    payload: TEvents[K],
  ): boolean {
    return this.ee.emit(event, payload);
  }

  /**
   * Remove all listeners for a specific event, or all events if none specified.
   */
  removeAllListeners<K extends keyof TEvents & string>(event?: K): this {
    if (event) {
      this.ee.removeAllListeners(event);
    } else {
      this.ee.removeAllListeners();
    }
    return this;
  }

  /**
   * Get the count of listeners for a given event.
   */
  listenerCount<K extends keyof TEvents & string>(event: K): number {
    return this.ee.listenerCount(event);
  }
}
