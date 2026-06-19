import { createHash } from "node:crypto";
import type {
  ProofLinkConfig,
  X402ResourceServer,
  VerifyContext,
  SettleContext,
  SettleResultContext,
  BeforeHookResult,
  AfterHookResult,
  PendingDecision,
  ComplianceEventHandler,
  ComplianceEvent,
} from "./types.js";
import { ProofLinkConfigSchema } from "./types.js";
import {
  createBeforeVerifyHook,
  payloadKey,
  type SanctionsScreener,
  type AmlScorer,
  type KYAVerifier,
  type KYARegistry,
} from "./hooks/before-verify.js";
import { createBeforeSettleHook, type TravelRuleService, type PriceConverter } from "./hooks/before-settle.js";
import { createAfterSettleHook, type ProofLinkService, type InvoiceService } from "./hooks/after-settle.js";
import { createProofLinkExtension } from "./extension.js";

// ---------------------------------------------------------------------------
// Pending decision map with TTL-based eviction
// ---------------------------------------------------------------------------

const DECISION_TTL_MS = 5 * 60 * 1000; // 5 minutes
/** ProofLink hashes held for extension enrichment are short-lived (30s is ample). */
const PROOF_LINK_TTL_MS = 30 * 1000; // 30 seconds

function createEvictingMap<V extends { timestamp: number }>(ttlMs: number): Map<string, V> & { cleanup(): void } {
  const map = new Map<string, V>();

  const enhanced = map as Map<string, V> & { cleanup(): void };
  enhanced.cleanup = () => {
    const now = Date.now();
    for (const [key, value] of map) {
      if (now - value.timestamp > ttlMs) {
        map.delete(key);
      }
    }
  };

  return enhanced;
}

/**
 * Evicting store for settled ProofLink hashes.
 * Entries are consumed on read (in the extension) but if the extension
 * is never called (e.g., the client doesn't use enrichment), entries
 * must still be evicted to prevent unbounded growth.
 */
function createProofLinkStore(): Map<string, { hash: string; timestamp: number }> & { cleanup(): void } {
  const map = new Map<string, { hash: string; timestamp: number }>();
  const enhanced = map as Map<string, { hash: string; timestamp: number }> & { cleanup(): void };
  enhanced.cleanup = () => {
    const now = Date.now();
    for (const [key, value] of map) {
      if (now - value.timestamp > PROOF_LINK_TTL_MS) {
        map.delete(key);
      }
    }
  };
  return enhanced;
}

// ---------------------------------------------------------------------------
// Default service implementations (stubs for when real services aren't provided)
// ---------------------------------------------------------------------------

class DefaultSanctionsScreener implements SanctionsScreener {
  async screen(address: string, _network: string) {
    return { address, clean: true, latencyMs: 0 };
  }
}

class DefaultAmlScorer implements AmlScorer {
  async score(address: string, _amount: string, _network: string) {
    return { address, score: 0, latencyMs: 0, factors: [] };
  }
}

/** Whether a warning has already been emitted for default service stubs. */
let defaultStubWarningEmitted = false;

class DefaultPriceConverter implements PriceConverter {
  /**
   * Rough USD conversion for USDC/EURC (6-decimal stablecoins).
   * Real implementation should use price feeds.
   */
  async toUsd(amount: string, _asset: string, _network: string): Promise<number> {
    const raw = Number(amount);
    if (Number.isNaN(raw)) return 0;
    // Assume 6-decimal stablecoin
    return raw / 1_000_000;
  }
}

class DefaultProofLinkService implements ProofLinkService {
  computeHash(receipt: { transactionHash: string; sender: string; receiver: string; amount: string; createdAt: string }): string {
    const data = `${receipt.transactionHash}:${receipt.sender}:${receipt.receiver}:${receipt.amount}:${receipt.createdAt}`;
    return "0x" + createHash("sha256").update(data).digest("hex");
  }

  async attestOnChain(_receipt: unknown): Promise<string | null> {
    return null; // no-op without EAS config
  }

  async storeAuditRecord(_receipt: unknown): Promise<void> {
    // no-op — production should write to PostgreSQL
  }
}

// ---------------------------------------------------------------------------
// ProofLinkX402Compliance — Main middleware class
// ---------------------------------------------------------------------------

export interface ProofLinkComplianceServices {
  screener?: SanctionsScreener;
  amlScorer?: AmlScorer;
  kyaVerifier?: KYAVerifier;
  kyaRegistry?: KYARegistry;
  travelRuleService?: TravelRuleService;
  priceConverter?: PriceConverter;
  proofLinkService?: ProofLinkService;
  invoiceService?: InvoiceService;
}

export class ProofLinkX402Compliance {
  private readonly config: ProofLinkConfig;
  private readonly pendingDecisions: Map<string, PendingDecision> & { cleanup(): void };
  private readonly settledProofLinks: Map<string, { hash: string; timestamp: number }> & { cleanup(): void };
  private readonly eventHandlers: ComplianceEventHandler[] = [];
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;

  // Bound hooks (also usable standalone)
  public readonly onBeforeVerify: (ctx: VerifyContext) => Promise<BeforeHookResult>;
  public readonly onBeforeSettle: (ctx: SettleContext) => Promise<BeforeHookResult>;
  public readonly onAfterSettle: (ctx: SettleResultContext) => Promise<AfterHookResult>;

  /**
   * @param config - ProofLink compliance configuration.
   * @param services - Injected service implementations. In production you MUST
   *   provide real `screener` and `amlScorer` implementations — the built-in
   *   defaults always return "clean" / score 0 and therefore bypass compliance.
   */
  constructor(config: ProofLinkConfig, services: ProofLinkComplianceServices = {}) {
    // Validate config (logger is stripped for zod validation)
    const { logger, ...zodConfig } = config;
    ProofLinkConfigSchema.parse(zodConfig);

    this.config = config;
    this.pendingDecisions = createEvictingMap<PendingDecision>(DECISION_TTL_MS);
    this.settledProofLinks = createProofLinkStore();

    // Warn once when default stubs are used — compliance is NOT enforced without real services
    if (!defaultStubWarningEmitted && (!services.screener || !services.amlScorer)) {
      if (!services.screener) {
        config.logger?.warn(
          "DefaultSanctionsScreener in use — all addresses will pass sanctions screening. Inject a real SanctionsScreener for production.",
        );
      }
      if (!services.amlScorer) {
        config.logger?.warn(
          "DefaultAmlScorer in use — all addresses will receive risk score 0. Inject a real AmlScorer for production.",
        );
      }
      defaultStubWarningEmitted = true;
    }

    const emitEvent: ComplianceEventHandler = (event) => {
      for (const handler of this.eventHandlers) {
        try {
          handler(event);
        } catch (err) {
          config.logger?.warn(`Event handler threw: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    };

    // Build hooks with injected services (or defaults)
    this.onBeforeVerify = createBeforeVerifyHook({
      config,
      screener: services.screener ?? new DefaultSanctionsScreener(),
      amlScorer: services.amlScorer ?? new DefaultAmlScorer(),
      kyaVerifier: services.kyaVerifier,
      kyaRegistry: services.kyaRegistry,
      pendingDecisions: this.pendingDecisions,
      onEvent: emitEvent,
    });

    this.onBeforeSettle = createBeforeSettleHook({
      config,
      travelRuleService: services.travelRuleService,
      priceConverter: services.priceConverter ?? new DefaultPriceConverter(),
      screener: services.screener ?? new DefaultSanctionsScreener(),
      pendingDecisions: this.pendingDecisions,
      onEvent: emitEvent,
    });

    this.onAfterSettle = createAfterSettleHook({
      config,
      proofLinkService: services.proofLinkService ?? new DefaultProofLinkService(),
      invoiceService: services.invoiceService,
      pendingDecisions: this.pendingDecisions,
      settledProofLinks: this.settledProofLinks,
      onEvent: emitEvent,
    });

    // Start periodic cleanup of stale pending decisions and unconsumed proof link hashes
    this.cleanupInterval = setInterval(() => {
      this.pendingDecisions.cleanup();
      this.settledProofLinks.cleanup();
    }, 60_000);
    // Unref so the interval doesn't prevent Node.js from exiting
    if (typeof this.cleanupInterval === "object" && "unref" in this.cleanupInterval) {
      this.cleanupInterval.unref();
    }
  }

  /**
   * Register compliance hooks on an x402 resource server.
   * This is the primary integration point — one line to enable compliance.
   */
  register(server: X402ResourceServer): void {
    server.onBeforeVerify(this.onBeforeVerify);
    server.onBeforeSettle(this.onBeforeSettle);
    server.onAfterSettle(this.onAfterSettle);
    server.registerExtension(
      createProofLinkExtension({
        config: this.config,
        settledProofLinks: this.settledProofLinks,
      }),
    );

    this.config.logger?.info("ProofLink x402 compliance registered on resource server");
  }

  /**
   * Subscribe to compliance events.
   */
  on(handler: ComplianceEventHandler): () => void {
    this.eventHandlers.push(handler);
    return () => {
      const idx = this.eventHandlers.indexOf(handler);
      if (idx >= 0) this.eventHandlers.splice(idx, 1);
    };
  }

  /**
   * Cleanup resources (stop periodic eviction timer).
   */
  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }
}
