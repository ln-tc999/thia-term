import { createHash } from "node:crypto";
import { desc, sql } from "drizzle-orm";

import { getDb } from "../db/index.js";
import { auditLog } from "../db/schema.js";
import { logger } from "./logger.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AuditLogParams {
  eventType: string;
  payload: Record<string, unknown>;
  receiptId?: string;
  invoiceId?: string;
  agentDid?: string;
  apiKeyId?: string;
}

// ---------------------------------------------------------------------------
// Postgres advisory lock ID for hash-chain serialization (ARCH-2)
// ---------------------------------------------------------------------------

// Equivalent to SELECT hashtext('prooflink_audit_log') → deterministic int4.
// We use a fixed constant so every process/pod acquires the same lock.
const AUDIT_LOCK_ID = 749_382_056;

// ---------------------------------------------------------------------------
// In-process serialization queue (fallback when not using transactions)
// ---------------------------------------------------------------------------

// Keeps fire-and-forget semantics: callers never await this.
let _queue: Promise<void> = Promise.resolve();

// ---------------------------------------------------------------------------
// writeAuditLog — fire-and-forget audit entry with hash chain
// ---------------------------------------------------------------------------

/**
 * Append an entry to the audit_log table with a SHA-256 hash chain.
 *
 * This is intentionally fire-and-forget: it never blocks the caller and
 * swallows errors (logging them) so that a broken audit path cannot take
 * down the request path.
 *
 * Concurrency: uses a Postgres advisory lock (`pg_advisory_xact_lock`) so
 * that the SELECT-then-INSERT is atomic across ALL processes/pods, not just
 * the current one. The in-process queue is retained as a secondary guard to
 * reduce lock contention from concurrent requests within the same process.
 */
export function writeAuditLog(params: AuditLogParams): void {
  const { eventType, payload, receiptId, invoiceId, agentDid, apiKeyId } = params;

  _queue = _queue.then(async () => {
    try {
      const db = getDb();

      await db.transaction(async (tx) => {
        // Acquire a transaction-scoped advisory lock — released on COMMIT/ROLLBACK.
        await tx.execute(sql`SELECT pg_advisory_xact_lock(${AUDIT_LOCK_ID})`);

        const [lastEntry] = await tx
          .select({ logHash: auditLog.logHash })
          .from(auditLog)
          .orderBy(desc(auditLog.id))
          .limit(1);

        const previousLogHash = lastEntry?.logHash ?? "genesis";
        const timestamp = new Date().toISOString();

        const logHash = createHash("sha256")
          .update(previousLogHash + eventType + JSON.stringify(payload) + timestamp)
          .digest("hex");

        await tx.insert(auditLog).values({
          logHash,
          previousLogHash,
          eventType,
          receiptId: receiptId ?? null,
          invoiceId: invoiceId ?? null,
          agentDid: agentDid ?? null,
          apiKeyId: apiKeyId ?? null,
          payload,
        });
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error("Failed to write audit log", { eventType, error: message });
      // Swallow so the queue continues processing subsequent entries.
    }
  });

  // Detach from the caller — errors are already caught above.
  void _queue;
}

// ---------------------------------------------------------------------------
// Exposed for testing only — resets the queue to a clean state.
// ---------------------------------------------------------------------------
export function _resetAuditQueue(): void {
  _queue = Promise.resolve();
}
