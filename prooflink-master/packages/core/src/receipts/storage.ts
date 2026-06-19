// ---------------------------------------------------------------------------
// Receipt Storage Abstraction
// ---------------------------------------------------------------------------

import type { ComplianceReceipt } from "@prooflink/shared";

// ---------------------------------------------------------------------------
// Interface
// ---------------------------------------------------------------------------

/** Query options for listing receipts. */
export interface ReceiptListOptions {
  /** Maximum number of receipts to return */
  limit?: number;
  /** Offset for pagination */
  offset?: number;
  /** Filter by status */
  status?: "APPROVED" | "REJECTED" | "ESCALATED";
}

/**
 * Abstract interface for receipt persistence.
 * Implement this interface to store compliance receipts in different backends
 * (in-memory, filesystem, IPFS, Arweave, database, etc.).
 */
export interface ReceiptStorage {
  /** Save a compliance receipt. Returns the receipt ID. */
  save(receipt: ComplianceReceipt): Promise<string>;
  /** Retrieve a receipt by ID. Returns undefined if not found. */
  get(receiptId: string): Promise<ComplianceReceipt | undefined>;
  /** List receipts with optional filtering and pagination. */
  list(options?: ReceiptListOptions): Promise<ComplianceReceipt[]>;
  /** Delete a receipt by ID. Returns true if the receipt existed. */
  delete(receiptId: string): Promise<boolean>;
}

// ---------------------------------------------------------------------------
// InMemoryStorage
// ---------------------------------------------------------------------------

/**
 * In-memory receipt storage backed by a Map.
 * Suitable for development, testing, and short-lived processes.
 */
export class InMemoryStorage implements ReceiptStorage {
  private readonly store = new Map<string, ComplianceReceipt>();

  async save(receipt: ComplianceReceipt): Promise<string> {
    this.store.set(receipt.receiptId, receipt);
    return receipt.receiptId;
  }

  async get(receiptId: string): Promise<ComplianceReceipt | undefined> {
    return this.store.get(receiptId);
  }

  async list(options?: ReceiptListOptions): Promise<ComplianceReceipt[]> {
    let results = Array.from(this.store.values());

    if (options?.status) {
      results = results.filter((r) => r.overallStatus === options.status);
    }

    // Sort by timestamp descending (most recent first)
    results.sort(
      (a, b) =>
        new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
    );

    const offset = options?.offset ?? 0;
    const limit = options?.limit ?? results.length;
    return results.slice(offset, offset + limit);
  }

  async delete(receiptId: string): Promise<boolean> {
    return this.store.delete(receiptId);
  }

  /** Get the current count of stored receipts. */
  get size(): number {
    return this.store.size;
  }

  /** Clear all stored receipts. */
  clear(): void {
    this.store.clear();
  }
}

// ---------------------------------------------------------------------------
// FileStorage
// ---------------------------------------------------------------------------

/**
 * File-based receipt storage.
 * Stores each receipt as a JSON file in a directory.
 * Suitable for single-node deployments and local archival.
 */
export class FileStorage implements ReceiptStorage {
  private readonly directory: string;

  constructor(directory: string) {
    this.directory = directory;
  }

  async save(receipt: ComplianceReceipt): Promise<string> {
    const { mkdir, writeFile } = await import("node:fs/promises");
    await mkdir(this.directory, { recursive: true });

    const filePath = this.receiptPath(receipt.receiptId);
    await writeFile(filePath, JSON.stringify(receipt, null, 2), "utf-8");
    return receipt.receiptId;
  }

  async get(receiptId: string): Promise<ComplianceReceipt | undefined> {
    const { readFile } = await import("node:fs/promises");
    const filePath = this.receiptPath(receiptId);

    try {
      const content = await readFile(filePath, "utf-8");
      return JSON.parse(content) as ComplianceReceipt;
    } catch (error: unknown) {
      if (
        error instanceof Error &&
        "code" in error &&
        (error as NodeJS.ErrnoException).code === "ENOENT"
      ) {
        return undefined;
      }
      throw error;
    }
  }

  async list(options?: ReceiptListOptions): Promise<ComplianceReceipt[]> {
    const { readdir, readFile } = await import("node:fs/promises");
    const { join } = await import("node:path");

    let files: string[];
    try {
      files = await readdir(this.directory);
    } catch (error: unknown) {
      if (
        error instanceof Error &&
        "code" in error &&
        (error as NodeJS.ErrnoException).code === "ENOENT"
      ) {
        return [];
      }
      throw error;
    }

    const jsonFiles = files.filter((f) => f.endsWith(".json"));
    const receipts: ComplianceReceipt[] = [];

    for (const file of jsonFiles) {
      const content = await readFile(join(this.directory, file), "utf-8");
      const receipt = JSON.parse(content) as ComplianceReceipt;

      if (options?.status && receipt.overallStatus !== options.status) {
        continue;
      }
      receipts.push(receipt);
    }

    // Sort by timestamp descending
    receipts.sort(
      (a, b) =>
        new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
    );

    const offset = options?.offset ?? 0;
    const limit = options?.limit ?? receipts.length;
    return receipts.slice(offset, offset + limit);
  }

  async delete(receiptId: string): Promise<boolean> {
    const { unlink } = await import("node:fs/promises");
    const filePath = this.receiptPath(receiptId);

    try {
      await unlink(filePath);
      return true;
    } catch (error: unknown) {
      if (
        error instanceof Error &&
        "code" in error &&
        (error as NodeJS.ErrnoException).code === "ENOENT"
      ) {
        return false;
      }
      throw error;
    }
  }

  private receiptPath(receiptId: string): string {
    // Sanitize receiptId for filesystem safety
    const safe = receiptId.replace(/[^a-zA-Z0-9_-]/g, "_");
    return `${this.directory}/${safe}.json`;
  }
}
