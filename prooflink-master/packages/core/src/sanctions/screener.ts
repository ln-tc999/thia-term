import type {
  SanctionsCheckResult,
  SanctionsList,
} from "@prooflink/shared";
import { LRUCache } from "../cache.js";
import type { ProofLinkConfig } from "../config.js";
import { isKnownSanctionedAddress } from "./lists.js";

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class SanctionsScreeningError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "SanctionsScreeningError";
  }
}

// ---------------------------------------------------------------------------
// Provider interface
// ---------------------------------------------------------------------------

/** Result returned by a sanctions screening provider. */
export interface SanctionsProviderResult {
  matched: boolean;
  matchDetails: Array<{
    list: SanctionsList;
    entryId: string;
    name: string;
    matchConfidence: number;
  }>;
  riskScore: number;
}

/**
 * Interface for pluggable sanctions screening providers.
 * Implement this to integrate custom screening sources beyond Chainalysis.
 */
export interface SanctionsProvider {
  /** Unique provider identifier */
  readonly name: string;
  /** Screen an address. Throw on failure. */
  screen(address: string, chain: string): Promise<SanctionsProviderResult>;
}

/** Provider health status. */
export interface ProviderHealthStatus {
  name: string;
  healthy: boolean;
  lastSuccess: string | null;
  lastFailure: string | null;
  consecutiveFailures: number;
}

// ---------------------------------------------------------------------------
// Built-in providers
// ---------------------------------------------------------------------------

interface ChainalysisIdentification {
  category: string;
  name: string;
  description: string;
  url: string;
}

interface ChainalysisResponse {
  identifications: ChainalysisIdentification[];
}

/**
 * Chainalysis free sanctions API provider.
 */
export class ChainalysisProvider implements SanctionsProvider {
  readonly name = "chainalysis_free";
  private readonly baseUrl: string;
  private readonly apiKey?: string;

  constructor(baseUrl: string, apiKey?: string) {
    this.baseUrl = baseUrl;
    this.apiKey = apiKey;
  }

  async screen(address: string, _chain: string): Promise<SanctionsProviderResult> {
    const url = `${this.baseUrl}/address/${address}`;

    const headers: Record<string, string> = { Accept: "application/json" };
    if (this.apiKey) {
      headers["X-API-Key"] = this.apiKey;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5_000);

    try {
      const response = await fetch(url, {
        method: "GET",
        headers,
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new SanctionsScreeningError(
          `Chainalysis API returned ${response.status}: ${response.statusText}`,
        );
      }

      let data: ChainalysisResponse;
      try {
        data = (await response.json()) as ChainalysisResponse;
      } catch (parseError) {
        throw new SanctionsScreeningError(
          `Chainalysis API returned malformed JSON: ${parseError instanceof Error ? parseError.message : String(parseError)}`,
          parseError,
        );
      }

      if (data.identifications && data.identifications.length > 0) {
        return {
          matched: true,
          matchDetails: data.identifications.map((id) => ({
            list: "OFAC_SDN" as SanctionsList,
            entryId: id.url || "unknown",
            name: id.name || id.category,
            matchConfidence: 1.0,
          })),
          riskScore: 100,
        };
      }

      return { matched: false, matchDetails: [], riskScore: 0 };
    } finally {
      clearTimeout(timeout);
    }
  }
}

/**
 * TRM Labs sanctions screening provider (stub).
 * Replace internals with real TRM Labs API calls for production.
 */
export class TRMLabsProvider implements SanctionsProvider {
  readonly name = "trm";
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(apiKey: string, baseUrl = "https://api.trmlabs.com/public/v2") {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
  }

  async screen(address: string, chain: string): Promise<SanctionsProviderResult> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5_000);

    try {
      const response = await fetch(`${this.baseUrl}/screening/addresses`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify([{ address, chain }]),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new SanctionsScreeningError(
          `TRM Labs API returned ${response.status}: ${response.statusText}`,
        );
      }

      let data: Array<{
        addressRiskIndicators?: Array<{
          category: string;
          categoryId: string;
          riskType: string;
        }>;
      }>;
      try {
        data = (await response.json()) as typeof data;
      } catch (parseError) {
        throw new SanctionsScreeningError(
          `TRM Labs API returned malformed JSON: ${parseError instanceof Error ? parseError.message : String(parseError)}`,
          parseError,
        );
      }

      if (!Array.isArray(data) || data.length === 0) {
        return { matched: false, matchDetails: [], riskScore: 0 };
      }

      const indicators = data[0]?.addressRiskIndicators ?? [];
      const sanctionsIndicators = indicators.filter(
        (i) => i.riskType === "SANCTIONS" || i.category.toLowerCase().includes("sanction"),
      );

      if (sanctionsIndicators.length > 0) {
        return {
          matched: true,
          matchDetails: sanctionsIndicators.map((i) => ({
            list: "OFAC_SDN" as SanctionsList,
            entryId: i.categoryId,
            name: i.category,
            matchConfidence: 1.0,
          })),
          riskScore: 100,
        };
      }

      return { matched: false, matchDetails: [], riskScore: 0 };
    } finally {
      clearTimeout(timeout);
    }
  }
}

// ---------------------------------------------------------------------------
// Provider health tracker
// ---------------------------------------------------------------------------

class ProviderHealthTracker {
  private readonly health = new Map<
    string,
    {
      lastSuccess: string | null;
      lastFailure: string | null;
      consecutiveFailures: number;
    }
  >();

  private readonly maxConsecutiveFailures: number;

  constructor(maxConsecutiveFailures = 3) {
    this.maxConsecutiveFailures = maxConsecutiveFailures;
  }

  recordSuccess(providerName: string): void {
    this.health.set(providerName, {
      lastSuccess: new Date().toISOString(),
      lastFailure: this.health.get(providerName)?.lastFailure ?? null,
      consecutiveFailures: 0,
    });
  }

  recordFailure(providerName: string): void {
    const current = this.health.get(providerName);
    this.health.set(providerName, {
      lastSuccess: current?.lastSuccess ?? null,
      lastFailure: new Date().toISOString(),
      consecutiveFailures: (current?.consecutiveFailures ?? 0) + 1,
    });
  }

  isHealthy(providerName: string): boolean {
    const status = this.health.get(providerName);
    if (!status) return true; // Unknown providers are assumed healthy
    return status.consecutiveFailures < this.maxConsecutiveFailures;
  }

  getStatus(providerName: string): ProviderHealthStatus {
    const status = this.health.get(providerName);
    return {
      name: providerName,
      healthy: this.isHealthy(providerName),
      lastSuccess: status?.lastSuccess ?? null,
      lastFailure: status?.lastFailure ?? null,
      consecutiveFailures: status?.consecutiveFailures ?? 0,
    };
  }

  getAllStatuses(providerNames: string[]): ProviderHealthStatus[] {
    return providerNames.map((name) => this.getStatus(name));
  }
}

// ---------------------------------------------------------------------------
// SanctionsScreener
// ---------------------------------------------------------------------------

/**
 * Multi-provider sanctions screening module.
 *
 * Supports multiple screening providers with priority ordering, fallback chains,
 * health tracking, and result aggregation. Falls back to offline OFAC SDN list
 * when all providers are unavailable.
 *
 * Features:
 * - Provider priority chain (first healthy provider wins)
 * - Aggregate mode (query all providers and merge results)
 * - Provider health tracking with automatic skip on consecutive failures
 * - In-memory LRU caching
 * - Offline OFAC SDN fallback
 */
export class SanctionsScreener {
  private readonly cache: LRUCache<SanctionsCheckResult>;
  private readonly config: ProofLinkConfig;
  private readonly providers: SanctionsProvider[];
  private readonly healthTracker: ProviderHealthTracker;
  private readonly aggregateMode: boolean;

  constructor(
    config: ProofLinkConfig,
    options?: {
      providers?: SanctionsProvider[];
      /** If true, query all providers and aggregate results. Default: false (first-match). */
      aggregate?: boolean;
      /** Max consecutive failures before a provider is skipped. Default: 3 */
      maxConsecutiveFailures?: number;
    },
  ) {
    this.config = config;
    this.cache = new LRUCache<SanctionsCheckResult>(
      config.cacheMaxEntries,
      config.sanctionsCacheTtlMs,
    );
    this.aggregateMode = options?.aggregate ?? false;
    this.healthTracker = new ProviderHealthTracker(
      options?.maxConsecutiveFailures ?? 3,
    );

    // Default to Chainalysis if no providers given
    this.providers = options?.providers ?? [
      new ChainalysisProvider(
        config.chainalysisBaseUrl,
        config.chainalysisApiKey,
      ),
    ];
  }

  /**
   * Screen a single address against sanctions lists.
   *
   * Pipeline:
   * 1. Check LRU cache
   * 2. Query providers (priority or aggregate mode)
   * 3. Fallback to offline OFAC SDN list if all providers fail
   * 4. Cache the result
   */
  async screenAddress(
    address: string,
    chain: string,
  ): Promise<SanctionsCheckResult> {
    const cacheKey = this.buildCacheKey(address, chain);
    const cached = this.cache.get(cacheKey);
    if (cached) return cached;

    let result: SanctionsCheckResult;

    try {
      if (this.aggregateMode) {
        result = await this.screenAggregate(address, chain);
      } else {
        result = await this.screenPriority(address, chain);
      }
    } catch (error) {
      if (this.config.failOpen) {
        result = this.buildOfflineResult(address);
      } else {
        // Check offline list as fallback before throwing
        const offlineMatch = isKnownSanctionedAddress(address);
        if (offlineMatch) {
          result = this.buildSanctionedResult(address, "OFAC_SDN");
        } else {
          throw new SanctionsScreeningError(
            `Sanctions screening failed for ${address}: ${error instanceof Error ? error.message : String(error)}`,
            error,
          );
        }
      }
    }

    this.cache.set(cacheKey, result);
    return result;
  }

  /**
   * Screen multiple addresses in parallel.
   */
  async screenBatch(
    addresses: Array<{ address: string; chain: string }>,
  ): Promise<SanctionsCheckResult[]> {
    return Promise.all(
      addresses.map(({ address, chain }) =>
        this.screenAddress(address, chain),
      ),
    );
  }

  /**
   * Get health status of all registered providers.
   */
  getProviderHealth(): ProviderHealthStatus[] {
    return this.healthTracker.getAllStatuses(
      this.providers.map((p) => p.name),
    );
  }

  /**
   * Add a provider to the screening chain.
   */
  addProvider(provider: SanctionsProvider): void {
    this.providers.push(provider);
  }

  /**
   * Remove a provider by name.
   */
  removeProvider(name: string): boolean {
    const idx = this.providers.findIndex((p) => p.name === name);
    if (idx === -1) return false;
    this.providers.splice(idx, 1);
    return true;
  }

  invalidateCache(address: string, chain: string): void {
    this.cache.delete(this.buildCacheKey(address, chain));
  }

  clearCache(): void {
    this.cache.clear();
  }

  // -------------------------------------------------------------------------
  // Private — priority mode (first healthy provider wins)
  // -------------------------------------------------------------------------

  private async screenPriority(
    address: string,
    chain: string,
  ): Promise<SanctionsCheckResult> {
    const now = new Date().toISOString();
    let lastError: Error | undefined;

    for (const provider of this.providers) {
      if (!this.healthTracker.isHealthy(provider.name)) {
        continue;
      }

      try {
        const result = await provider.screen(address, chain);
        this.healthTracker.recordSuccess(provider.name);

        return {
          matched: result.matched,
          listsChecked: this.config.sanctionsLists as SanctionsList[],
          matchDetails: result.matchDetails,
          riskScore: result.riskScore,
          screenedAt: now,
          provider: provider.name as SanctionsCheckResult["provider"],
        };
      } catch (error) {
        this.healthTracker.recordFailure(provider.name);
        lastError =
          error instanceof Error ? error : new Error(String(error));
      }
    }

    // All providers failed — throw to trigger fallback
    throw lastError ?? new SanctionsScreeningError("No healthy providers available");
  }

  // -------------------------------------------------------------------------
  // Private — aggregate mode (query all, merge results)
  // -------------------------------------------------------------------------

  private async screenAggregate(
    address: string,
    chain: string,
  ): Promise<SanctionsCheckResult> {
    const now = new Date().toISOString();
    const healthyProviders = this.providers.filter((p) =>
      this.healthTracker.isHealthy(p.name),
    );

    if (healthyProviders.length === 0) {
      throw new SanctionsScreeningError("No healthy providers available");
    }

    const results = await Promise.allSettled(
      healthyProviders.map(async (provider) => {
        try {
          const result = await provider.screen(address, chain);
          this.healthTracker.recordSuccess(provider.name);
          return { provider: provider.name, result };
        } catch (error) {
          this.healthTracker.recordFailure(provider.name);
          throw error;
        }
      }),
    );

    const successful = results
      .filter(
        (r): r is PromiseFulfilledResult<{ provider: string; result: SanctionsProviderResult }> =>
          r.status === "fulfilled",
      )
      .map((r) => r.value);

    if (successful.length === 0) {
      throw new SanctionsScreeningError(
        "All provider queries failed in aggregate mode",
      );
    }

    // Merge: matched if ANY provider matched
    const matched = successful.some((s) => s.result.matched);
    const allMatchDetails = successful.flatMap((s) => s.result.matchDetails);
    const maxRiskScore = Math.max(...successful.map((s) => s.result.riskScore));

    return {
      matched,
      listsChecked: this.config.sanctionsLists as SanctionsList[],
      matchDetails: allMatchDetails,
      riskScore: maxRiskScore,
      screenedAt: now,
      provider: "multi_provider" as SanctionsCheckResult["provider"],
    };
  }

  // -------------------------------------------------------------------------
  // Private — offline fallback
  // -------------------------------------------------------------------------

  private buildOfflineResult(address: string): SanctionsCheckResult {
    const now = new Date().toISOString();
    const matched = isKnownSanctionedAddress(address);

    if (matched) {
      return this.buildSanctionedResult(address, "OFAC_SDN");
    }

    return {
      matched: false,
      listsChecked: ["OFAC_SDN"],
      matchDetails: [],
      riskScore: 0,
      screenedAt: now,
      provider: "ofac_sdn_offline" as const,
    };
  }

  private buildSanctionedResult(
    address: string,
    list: SanctionsList,
  ): SanctionsCheckResult {
    return {
      matched: true,
      listsChecked: [list],
      matchDetails: [
        {
          list,
          entryId: `offline-${address.slice(0, 10)}`,
          name: "OFAC SDN Designated Address",
          matchConfidence: 1.0,
        },
      ],
      riskScore: 100,
      screenedAt: new Date().toISOString(),
      provider: "ofac_sdn_offline" as const,
    };
  }

  private buildCacheKey(address: string, chain: string): string {
    return `sanctions:${chain}:${address.toLowerCase()}`;
  }
}
