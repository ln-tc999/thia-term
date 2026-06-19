// ---------------------------------------------------------------------------
// Audit Trail Types
// ---------------------------------------------------------------------------

/** Categories of auditable events in the ProofLink compliance pipeline. */
export type AuditEventType =
  | "compliance_check"
  | "sanctions_match"
  | "agent_registered"
  | "invoice_created"
  | "receipt_issued"
  | "policy_changed";

/** A single audit log entry. */
export interface AuditEvent {
  /** Unique identifier for this audit entry */
  readonly id: string;
  /** When the event occurred */
  readonly timestamp: Date;
  /** Classification of the event */
  readonly eventType: AuditEventType;
  /** Address or DID of the entity that triggered the event */
  readonly actor: string;
  /** Address or DID of the entity affected by the event */
  readonly target: string;
  /** Human-readable description of what happened */
  readonly details: string;
  /** Associated compliance receipt ID, if any */
  readonly receiptId?: string;
  /** Arbitrary structured metadata */
  readonly metadata?: Record<string, unknown>;
}

/** Filter options for querying audit events. */
export interface AuditQuery {
  /** Filter by actor address */
  actor?: string;
  /** Filter by target address */
  target?: string;
  /** Filter by event type */
  eventType?: AuditEventType;
  /** Filter by receipt ID */
  receiptId?: string;
  /** Return events on or after this date */
  from?: Date;
  /** Return events on or before this date */
  to?: Date;
  /** Maximum number of results (default: no limit) */
  limit?: number;
}

/** Configuration for the AuditTrail store. */
export interface AuditTrailConfig {
  /** Maximum number of events to retain in memory (oldest evicted first). Default: 10_000 */
  maxEntries?: number;
}
