import type {
  SettleContext,
  BeforeHookResult,
  ProofLinkConfig,
  TravelRuleTransmitRequest,
  TravelRuleTransmitResult,
  PendingDecision,
  ComplianceEventHandler,
  ScreeningResult,
} from "../types.js";
import { extractSenderAddress } from "../address.js";
import { payloadKey, type SanctionsScreener } from "./before-verify.js";

// ---------------------------------------------------------------------------
// Service interfaces
// ---------------------------------------------------------------------------

export interface TravelRuleService {
  transmit(request: TravelRuleTransmitRequest): Promise<TravelRuleTransmitResult>;
}

export interface PriceConverter {
  toUsd(amount: string, asset: string, network: string): Promise<number>;
}

// ---------------------------------------------------------------------------
// Before-settle hook factory
// ---------------------------------------------------------------------------

export interface BeforeSettleDeps {
  config: ProofLinkConfig;
  travelRuleService?: TravelRuleService;
  priceConverter: PriceConverter;
  screener: SanctionsScreener;
  pendingDecisions: Map<string, PendingDecision>;
  onEvent?: ComplianceEventHandler;
}

/**
 * Creates the onBeforeSettle hook.
 *
 * Responsibilities:
 * 1. Check Travel Rule if amount > jurisdiction threshold
 * 2. Re-verify sanctions (in case of dynamic payTo change in v2)
 * 3. Build compliance receipt context
 */
export function createBeforeSettleHook(deps: BeforeSettleDeps) {
  const { config, travelRuleService, priceConverter, screener, pendingDecisions, onEvent } = deps;

  return async function onBeforeSettle(ctx: SettleContext): Promise<BeforeHookResult> {
    const { paymentPayload, requirements } = ctx;
    const key = payloadKey(paymentPayload);
    const decision = pendingDecisions.get(key);

    const sender = extractSenderAddress(paymentPayload);
    if (!sender) {
      return {
        abort: true,
        reason: "compliance_error",
        message: "Cannot extract sender address at settle phase",
      };
    }

    // -------------------------------------------------------------------
    // 1. Re-verify sanctions on receiver (dynamic payTo may change in v2)
    // -------------------------------------------------------------------
    const receiverRecheck: ScreeningResult = await screener.screen(
      requirements.payTo,
      requirements.network,
    );

    if (!receiverRecheck.clean) {
      onEvent?.({
        type: "compliance:check:failed",
        timestamp: Date.now(),
        payload: { receiver: requirements.payTo, reason: "sanctions_receiver_recheck" },
      });
      return {
        abort: true,
        reason: "sanctions_hit",
        message: `Receiver re-check flagged: ${receiverRecheck.matchedList}`,
      };
    }

    // Clone the decision's checks array before mutating to prevent duplicate
    // entries if two concurrent settle calls for the same key race here.
    const localChecks = decision ? [...decision.checks] : undefined;

    if (decision && localChecks) {
      localChecks.push({
        type: "sanctions",
        target: requirements.payTo,
        result: "pass",
        detail: "pre-settle re-check",
        latencyMs: receiverRecheck.latencyMs,
      });
      decision.checks = localChecks;
    }

    // -------------------------------------------------------------------
    // 2. Travel Rule check if amount > threshold
    // -------------------------------------------------------------------
    if (travelRuleService) {
      const amountUsd = await priceConverter.toUsd(
        requirements.maxAmountRequired,
        requirements.asset,
        requirements.network,
      );

      if (amountUsd >= config.policy.travelRuleThresholdUsd) {
        const trResult = await travelRuleService.transmit({
          originatorAddress: sender,
          beneficiaryAddress: requirements.payTo,
          amount: requirements.maxAmountRequired,
          asset: requirements.asset,
          network: requirements.network,
        });

        if (decision) {
          // Clone checks array before mutating to avoid duplicate entries
          // if two concurrent settle calls race on the same key
          const updatedChecks = [...decision.checks, {
            type: "travel_rule" as const,
            target: sender,
            result: trResult.success ? "pass" as const : "fail" as const,
            detail: trResult.success
              ? `notabene_ref=${trResult.referenceId}`
              : `error: ${trResult.error}`,
            latencyMs: trResult.latencyMs,
          }];
          decision.checks = updatedChecks;
          if (trResult.success && trResult.referenceId) {
            decision.travelRuleRef = trResult.referenceId;
          }
        }

        if (!trResult.success) {
          onEvent?.({
            type: "compliance:check:failed",
            timestamp: Date.now(),
            payload: { sender, reason: "travel_rule_failed" },
          });
          return {
            abort: true,
            reason: "travel_rule_failed",
            message: `Travel Rule transmission failed: ${trResult.error}`,
          };
        }
      } else if (decision) {
        decision.checks = [...decision.checks, {
          type: "travel_rule" as const,
          target: sender,
          result: "skip" as const,
          detail: `amount $${amountUsd.toFixed(2)} below threshold $${config.policy.travelRuleThresholdUsd}`,
          latencyMs: 0,
        }];
      }
    }

    return; // pass — continue to facilitator settle
  };
}
