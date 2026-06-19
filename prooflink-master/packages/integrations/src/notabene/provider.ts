// ---------------------------------------------------------------------------
// Notabene — TravelRuleProvider implementation for @prooflink/core
// ---------------------------------------------------------------------------

import type { TravelRuleData } from "@prooflink/shared";
import type {
  IVMS101Message,
  TravelRuleProvider,
} from "@prooflink/core";
import { NotabeneClient, type HttpClient } from "./client.js";
import type { NotabeneConfig } from "./types.js";

/**
 * Production-grade Travel Rule provider backed by the Notabene Gateway API.
 *
 * Implements `TravelRuleProvider` from `@prooflink/core` so it can be injected
 * into `TravelRuleChecker` and `ProofLinkEngine`.
 *
 * Usage:
 * ```ts
 * import { NotabeneTravelRuleProvider } from "@prooflink/integrations/notabene";
 * import { ProofLinkEngine, loadConfig } from "@prooflink/core";
 *
 * const provider = new NotabeneTravelRuleProvider({
 *   apiKey: process.env.NOTABENE_API_KEY!,
 *   vaspDID: process.env.NOTABENE_VASP_DID!,
 * });
 * const engine = new ProofLinkEngine(loadConfig(), { travelRuleProvider: provider });
 * ```
 */
export class NotabeneTravelRuleProvider implements TravelRuleProvider {
  private readonly client: NotabeneClient;

  constructor(config: NotabeneConfig, http?: HttpClient) {
    this.client = new NotabeneClient(config, http);
  }

  /**
   * Transmit IVMS101 message via the Notabene Gateway API.
   *
   * Adapts the `@prooflink/core` IVMS101Message format to the Notabene
   * transfer payload and returns the reference ID on success.
   */
  async transmit(
    message: IVMS101Message,
  ): Promise<{ success: boolean; referenceId?: string; error?: string }> {
    try {
      // Convert IVMS101Message back to TravelRuleData shape for the client
      const extractName = (
        person?: { nameIdentifier: Array<{ primaryIdentifier: string; secondaryIdentifier?: string }> },
      ): string => {
        if (!person?.nameIdentifier[0]) return "Unknown";
        const ni = person.nameIdentifier[0];
        return ni.secondaryIdentifier
          ? `${ni.secondaryIdentifier} ${ni.primaryIdentifier}`
          : ni.primaryIdentifier;
      };

      const origPerson = message.originator.originatorPersons[0];
      const benePerson = message.beneficiary.beneficiaryPersons[0];

      const data: TravelRuleData = {
        originator: {
          name: extractName(origPerson?.naturalPerson ?? origPerson?.legalPerson),
          walletAddress: message.originator.accountNumber[0] ?? "",
          physicalAddress: origPerson?.naturalPerson?.geographicAddress,
          nationalId: origPerson?.naturalPerson?.nationalId,
        },
        beneficiary: {
          name: extractName(benePerson?.naturalPerson ?? benePerson?.legalPerson),
          walletAddress: message.beneficiary.accountNumber[0] ?? "",
        },
        amountUsd: Number.parseFloat(message.transactionAmountUsd ?? message.transactionAmount),
        asset: message.transactionAsset,
        chain: message.transactionChain,
        direction: "outgoing",
        preTransaction: false,
      };

      const response = await this.client.submitTransfer(data);

      return {
        success: true,
        referenceId: response.id,
      };
    } catch (error) {
      return {
        success: false,
        error: `Notabene transmission failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }
}
