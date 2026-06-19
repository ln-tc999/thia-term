import type {
  IVMS101Person,
  TravelRuleData,
  TravelRuleStatus,
} from "@prooflink/shared";
import type { ProofLinkConfig } from "../config.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Result of a Travel Rule compliance check. */
export interface TravelRuleResult {
  /** Whether Travel Rule was required for this transaction */
  required: boolean;
  /** Current status of the Travel Rule transmission */
  status: TravelRuleStatus;
  /** Jurisdiction that triggered the requirement */
  triggeringJurisdiction?: string;
  /** Applicable threshold in USD */
  thresholdUsd?: number;
  /** Notabene or protocol reference ID (if transmitted) */
  referenceId?: string;
  /** Error message if transmission failed */
  error?: string;
  /** Latency of the check in milliseconds */
  latencyMs: number;
}

/** IVMS101 §7.1 name identifier structure. */
export interface IVMS101NameIdentifier {
  primaryIdentifier: string;
  secondaryIdentifier?: string;
  nameIdentifierType: "LEGL" | "BIRT" | "MAID" | "TRAD";
}

/** IVMS101 message structure for Travel Rule transmission. */
export interface IVMS101Message {
  originator: {
    originatorPersons: Array<{
      naturalPerson?: {
        nameIdentifier: IVMS101NameIdentifier[];
        geographicAddress?: string;
        nationalId?: string;
      };
      legalPerson?: {
        nameIdentifier: IVMS101NameIdentifier[];
        lei?: string;
      };
    }>;
    accountNumber: string[];
  };
  beneficiary: {
    beneficiaryPersons: Array<{
      naturalPerson?: {
        nameIdentifier: IVMS101NameIdentifier[];
      };
      legalPerson?: {
        nameIdentifier: IVMS101NameIdentifier[];
      };
    }>;
    accountNumber: string[];
  };
  originatingVASP?: {
    legalPerson: {
      nameIdentifier: IVMS101NameIdentifier[];
      lei?: string;
    };
  };
  /** Native asset amount (not USD-converted). */
  transactionAmount: string;
  /** Currency/token of transactionAmount. */
  transactionAmountCurrency: string;
  /** USD equivalent for threshold checks. */
  transactionAmountUsd?: string;
  transactionAsset: string;
  transactionChain: string;
}

/**
 * Interface for Travel Rule transmission providers.
 * Implement this interface to integrate with Notabene, Sygna, TRISA, etc.
 */
export interface TravelRuleProvider {
  /**
   * Transmit IVMS101 data to counterparty VASP.
   * @returns Reference ID for tracking
   */
  transmit(message: IVMS101Message): Promise<{
    success: boolean;
    referenceId?: string;
    error?: string;
  }>;
}

// ---------------------------------------------------------------------------
// Notabene Mock Provider
// ---------------------------------------------------------------------------

/**
 * Mock Notabene API provider for development and testing.
 * Replace with real Notabene integration for production.
 */
export class MockNotabeneProvider implements TravelRuleProvider {
  private readonly shouldSucceed: boolean;

  constructor(shouldSucceed = true) {
    this.shouldSucceed = shouldSucceed;
  }

  async transmit(
    _message: IVMS101Message,
  ): Promise<{ success: boolean; referenceId?: string; error?: string }> {
    // Simulate network latency
    await new Promise((resolve) => setTimeout(resolve, 10));

    if (this.shouldSucceed) {
      return {
        success: true,
        referenceId: `nb-mock-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      };
    }
    return {
      success: false,
      error: "Mock Notabene transmission failure",
    };
  }
}

// ---------------------------------------------------------------------------
// Notabene Real Provider
// ---------------------------------------------------------------------------

/**
 * Real Notabene API provider for Travel Rule transmission.
 * Requires Notabene API credentials in config.
 */
export class NotabeneProvider implements TravelRuleProvider {
  private readonly apiKey: string;
  private readonly vaspDID: string;
  private readonly baseUrl: string;

  constructor(config: { apiKey: string; vaspDID: string; baseUrl: string }) {
    this.apiKey = config.apiKey;
    this.vaspDID = config.vaspDID;
    this.baseUrl = config.baseUrl;
  }

  /**
   * Transmit IVMS101 message via Notabene Gateway API.
   */
  async transmit(
    message: IVMS101Message,
  ): Promise<{ success: boolean; referenceId?: string; error?: string }> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);

    try {
      const response = await fetch(`${this.baseUrl}/tx/create`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          transactionType: "TRANSACTION",
          originatorVASPdid: this.vaspDID,
          originatorEqualsBeneficiary: false,
          transactionAsset: message.transactionAsset,
          transactionAmount: message.transactionAmount,
          originatorProof: {
            type: "TravelRule",
            proof: message.originator,
          },
          beneficiary: message.beneficiary,
          beneficiaryProof: {
            type: "TravelRule",
          },
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const body = await response.text();
        return {
          success: false,
          error: `Notabene API error ${response.status}: ${body}`,
        };
      }

      const data = (await response.json()) as { id?: string };
      return {
        success: true,
        referenceId: data.id ?? `nb-${Date.now()}`,
      };
    } catch (error) {
      return {
        success: false,
        error: `Notabene transmission failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    } finally {
      clearTimeout(timeout);
    }
  }
}

// ---------------------------------------------------------------------------
// TravelRuleChecker
// ---------------------------------------------------------------------------

/**
 * Travel Rule compliance checker.
 *
 * Determines whether a transaction requires Travel Rule data transmission
 * based on jurisdiction-specific thresholds, constructs IVMS101 messages,
 * and transmits via the configured provider (Notabene or mock).
 *
 * Jurisdiction thresholds:
 * - US: $3,000 (BSA)
 * - EU: EUR 0 (CASP-to-CASP); EUR 1,000 for self-hosted
 * - Singapore: SGD 1,500
 * - Japan: JPY 0 (no threshold)
 */
export class TravelRuleChecker {
  private readonly config: ProofLinkConfig;
  private readonly provider: TravelRuleProvider;

  constructor(config: ProofLinkConfig, provider?: TravelRuleProvider) {
    this.config = config;

    if (provider) {
      this.provider = provider;
    } else if (config.notabene) {
      this.provider = new NotabeneProvider({
        apiKey: config.notabene.apiKey,
        vaspDID: config.notabene.vaspDID,
        baseUrl: config.notabene.baseUrl,
      });
    } else {
      this.provider = new MockNotabeneProvider();
    }
  }

  /**
   * Check Travel Rule requirements and transmit if necessary.
   *
   * @param data - Travel Rule data including originator, beneficiary, and amount
   * @returns Travel Rule check result with status and reference
   */
  async checkTravelRule(data: TravelRuleData): Promise<TravelRuleResult> {
    const start = Date.now();

    // Determine applicable jurisdiction and threshold
    const jurisdiction = this.resolveJurisdiction(data);
    const threshold = this.getThresholdForJurisdiction(jurisdiction);

    // Check if Travel Rule applies
    if (data.amountUsd < threshold) {
      return {
        required: false,
        status: "NOT_REQUIRED",
        triggeringJurisdiction: jurisdiction,
        thresholdUsd: threshold,
        latencyMs: Date.now() - start,
      };
    }

    // Build IVMS101 message
    const message = this.buildIVMS101Message(data);

    // Transmit via provider
    const transmitResult = await this.provider.transmit(message);

    if (transmitResult.success) {
      return {
        required: true,
        status: "TRANSMITTED",
        triggeringJurisdiction: jurisdiction,
        thresholdUsd: threshold,
        referenceId: transmitResult.referenceId,
        latencyMs: Date.now() - start,
      };
    }

    return {
      required: true,
      status: "FAILED",
      triggeringJurisdiction: jurisdiction,
      thresholdUsd: threshold,
      error: transmitResult.error,
      latencyMs: Date.now() - start,
    };
  }

  /**
   * Get the Travel Rule threshold for a specific jurisdiction.
   *
   * @param jurisdiction - ISO 3166-1 alpha-2 country code
   * @returns Threshold in USD equivalent
   */
  getThresholdForJurisdiction(jurisdiction: string): number {
    const thresholds = this.config.travelRuleThresholds;
    return thresholds[jurisdiction] ?? this.config.defaultTravelRuleThresholdUsd;
  }

  // -------------------------------------------------------------------------
  // Private
  // -------------------------------------------------------------------------

  private resolveJurisdiction(data: TravelRuleData): string {
    // Apply the most restrictive jurisdiction between originator and beneficiary.
    // We resolve all candidate jurisdictions and return the one with the lowest
    // threshold (i.e., the most demanding compliance requirement).
    const candidates: string[] = [];

    if (data.originator.vaspDid) {
      // DID-based jurisdiction resolution would go here (e.g., did:web:vasp.eu → "DE")
      // For now, extract country hint from DID if present (e.g., did:web:vasp.de)
      const didMatch = /\.([a-z]{2})$/.exec(data.originator.vaspDid);
      if (didMatch?.[1]) {
        candidates.push(didMatch[1].toUpperCase());
      }
    }

    if (data.beneficiary.vaspDid) {
      const didMatch = /\.([a-z]{2})$/.exec(data.beneficiary.vaspDid);
      if (didMatch?.[1]) {
        candidates.push(didMatch[1].toUpperCase());
      }
    }

    // Default to US if no jurisdiction can be resolved
    if (candidates.length === 0) {
      return "US";
    }

    // Return the jurisdiction with the lowest (most restrictive) threshold
    const thresholds = this.config.travelRuleThresholds;
    const defaultThreshold = this.config.defaultTravelRuleThresholdUsd;
    return candidates.reduce((mostRestrictive, candidate) => {
      const currentThreshold = thresholds[mostRestrictive] ?? defaultThreshold;
      const candidateThreshold = thresholds[candidate] ?? defaultThreshold;
      return candidateThreshold < currentThreshold ? candidate : mostRestrictive;
    });
  }

  /**
   * Build an IVMS101-compliant message from TravelRuleData.
   *
   * Per IVMS101 §7.1, names use structured `nameIdentifier` arrays rather
   * than flat strings. Transaction amount is expressed in the native asset
   * currency, with a separate USD field for threshold reference.
   */
  buildIVMS101Message(data: TravelRuleData): IVMS101Message {
    const vaspName = process.env["PROOFLINK_VASP_NAME"] ?? "ProofLink Compliance Service";
    const vaspLei = process.env["PROOFLINK_VASP_LEI"];

    const parseNameIdentifier = (fullName: string | undefined): IVMS101NameIdentifier[] => {
      if (!fullName || fullName === "Unknown") {
        return [{ primaryIdentifier: "Unknown", nameIdentifierType: "LEGL" }];
      }
      const parts = fullName.trim().split(/\s+/);
      const primaryIdentifier = parts.length > 1 ? parts[parts.length - 1]! : parts[0]!;
      const secondaryIdentifier = parts.length > 1 ? parts.slice(0, -1).join(" ") : undefined;
      return [{
        primaryIdentifier,
        secondaryIdentifier,
        nameIdentifierType: "LEGL",
      }];
    };

    return {
      originator: {
        originatorPersons: [
          {
            naturalPerson: {
              nameIdentifier: parseNameIdentifier(data.originator.name),
              geographicAddress: data.originator.physicalAddress,
              nationalId: data.originator.nationalId,
            },
          },
        ],
        accountNumber: [data.originator.walletAddress],
      },
      beneficiary: {
        beneficiaryPersons: [
          {
            naturalPerson: {
              nameIdentifier: parseNameIdentifier(data.beneficiary.name),
            },
          },
        ],
        accountNumber: [data.beneficiary.walletAddress],
      },
      originatingVASP: {
        legalPerson: {
          nameIdentifier: [{ primaryIdentifier: vaspName, nameIdentifierType: "LEGL" }],
          lei: vaspLei,
        },
      },
      transactionAmount: data.nativeAmount ?? data.amountUsd.toString(),
      transactionAmountCurrency: data.asset,
      transactionAmountUsd: data.amountUsd.toString(),
      transactionAsset: data.asset,
      transactionChain: data.chain,
    };
  }
}
