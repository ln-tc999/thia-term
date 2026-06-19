import type {
  VerifyContext,
  BeforeHookResult,
  ProofLinkConfig,
  ScreeningResult,
  AmlScoreResult,
  KYACredential,
  KYAVerificationResult,
  ComplianceCheckEntry,
  PendingDecision,
  ComplianceEventHandler,
} from "../types.js";
import { extractSenderAddress } from "../address.js";

// ---------------------------------------------------------------------------
// Service interfaces (injected, not implemented here)
// ---------------------------------------------------------------------------

export interface SanctionsScreener {
  screen(address: string, network: string): Promise<ScreeningResult>;
}

export interface AmlScorer {
  score(address: string, amount: string, network: string): Promise<AmlScoreResult>;
}

export interface KYAVerifier {
  verify(agentId: string): Promise<KYAVerificationResult>;
}

export interface KYARegistry {
  lookup(address: string): Promise<KYACredential | null>;
}

// ---------------------------------------------------------------------------
// Before-verify hook factory
// ---------------------------------------------------------------------------

export interface BeforeVerifyDeps {
  config: ProofLinkConfig;
  screener: SanctionsScreener;
  amlScorer: AmlScorer;
  kyaVerifier?: KYAVerifier;
  kyaRegistry?: KYARegistry;
  pendingDecisions: Map<string, PendingDecision>;
  onEvent?: ComplianceEventHandler;
}

/**
 * Creates the onBeforeVerify hook.
 *
 * Responsibilities:
 * 1. Extract sender address from PaymentPayload
 * 2. Extract receiver address from PaymentRequirements
 * 3. Run parallel sanctions screening on both addresses
 * 4. Check KYA credential if sender is a known agent
 * 5. Calculate AML risk score
 * 6. If any check fails -> abort with structured reason
 * 7. Cache results for the settle phase
 */
export function createBeforeVerifyHook(deps: BeforeVerifyDeps) {
  const { config, screener, amlScorer, kyaVerifier, kyaRegistry, pendingDecisions, onEvent } =
    deps;

  return async function onBeforeVerify(ctx: VerifyContext): Promise<BeforeHookResult> {
    const startTime = Date.now();
    const { paymentPayload, requirements } = ctx;

    const sender = extractSenderAddress(paymentPayload);
    const receiver = requirements.payTo;

    if (!sender) {
      return {
        abort: true,
        reason: "compliance_error",
        message: "Cannot extract sender address from payment payload",
      };
    }

    onEvent?.({
      type: "compliance:check:started",
      timestamp: Date.now(),
      payload: { sender, receiver, network: requirements.network, amount: requirements.maxAmountRequired },
    });

    // -----------------------------------------------------------------------
    // 1. Allowlist short-circuit (zero latency)
    // -----------------------------------------------------------------------
    const senderNorm = sender.toLowerCase();
    const receiverNorm = receiver.toLowerCase();
    const allowlist = config.policy.allowlist?.map((a) => a.toLowerCase()) ?? [];

    if (allowlist.includes(senderNorm) && allowlist.includes(receiverNorm)) {
      const decision: PendingDecision = {
        pass: true,
        riskScore: 0,
        checks: [
          { type: "allowlist", target: sender, result: "pass", detail: "sender on allowlist", latencyMs: 0 },
          { type: "allowlist", target: receiver, result: "pass", detail: "receiver on allowlist", latencyMs: 0 },
        ],
        timestamp: Date.now(),
        latencyMs: Date.now() - startTime,
      };
      pendingDecisions.set(payloadKey(paymentPayload), decision);
      onEvent?.({
        type: "compliance:check:passed",
        timestamp: Date.now(),
        payload: { sender, receiver, riskScore: 0, network: requirements.network },
      });
      return;
    }

    // -----------------------------------------------------------------------
    // 2. Blocklist check (zero latency)
    // -----------------------------------------------------------------------
    const blocklist = config.policy.blocklist?.map((a) => a.toLowerCase()) ?? [];

    if (blocklist.includes(senderNorm)) {
      onEvent?.({
        type: "compliance:check:failed",
        timestamp: Date.now(),
        payload: { sender, reason: "blocklist_sender" },
      });
      return { abort: true, reason: "compliance_blocked", message: "Sender address is blocklisted" };
    }
    if (blocklist.includes(receiverNorm)) {
      onEvent?.({
        type: "compliance:check:failed",
        timestamp: Date.now(),
        payload: { receiver, reason: "blocklist_receiver" },
      });
      return { abort: true, reason: "compliance_blocked", message: "Receiver address is blocklisted" };
    }

    // -----------------------------------------------------------------------
    // 2b. EVM address format validation (after blocklist so known-bad
    //     addresses are rejected with the correct reason code).
    //     Non-EVM addresses (e.g. Solana base58) skip this check.
    // -----------------------------------------------------------------------
    if (sender.startsWith("0x") && !/^0x[0-9a-fA-F]{40}$/.test(sender)) {
      return {
        abort: true,
        reason: "compliance_error",
        message: `Invalid EVM sender address format: ${sender}`,
      };
    }

    // -----------------------------------------------------------------------
    // 3. Parallel: sanctions screening + AML risk scoring + KYA lookup
    // -----------------------------------------------------------------------
    const checks: ComplianceCheckEntry[] = [];

    let senderScreen: ScreeningResult;
    let receiverScreen: ScreeningResult;
    let amlScore: AmlScoreResult;
    let kyaCredential: KYACredential | null;

    try {
      [senderScreen, receiverScreen, amlScore, kyaCredential] = await Promise.all([
        screener.screen(sender, requirements.network),
        screener.screen(receiver, requirements.network),
        amlScorer.score(sender, requirements.maxAmountRequired, requirements.network),
        kyaRegistry ? kyaRegistry.lookup(sender) : Promise.resolve(null),
      ]);
    } catch (err) {
      onEvent?.({
        type: "compliance:check:failed",
        timestamp: Date.now(),
        payload: { sender, reason: "compliance_service_error" },
      });
      return {
        abort: true,
        reason: "compliance_error",
        message: `Compliance service error: ${err instanceof Error ? err.message : String(err)}`,
      };
    }

    // Sanctions — sender
    checks.push({
      type: "sanctions",
      target: sender,
      result: senderScreen.clean ? "pass" : "fail",
      detail: senderScreen.matchedList ? `matched: ${senderScreen.matchedList}` : undefined,
      latencyMs: senderScreen.latencyMs,
    });

    if (!senderScreen.clean) {
      onEvent?.({
        type: "compliance:check:failed",
        timestamp: Date.now(),
        payload: { sender, reason: "sanctions_sender", riskScore: 100 },
      });
      return {
        abort: true,
        reason: "sanctions_hit",
        message: `Sender address flagged: ${senderScreen.matchedList}`,
      };
    }

    // Sanctions — receiver
    checks.push({
      type: "sanctions",
      target: receiver,
      result: receiverScreen.clean ? "pass" : "fail",
      detail: receiverScreen.matchedList ? `matched: ${receiverScreen.matchedList}` : undefined,
      latencyMs: receiverScreen.latencyMs,
    });

    if (!receiverScreen.clean) {
      onEvent?.({
        type: "compliance:check:failed",
        timestamp: Date.now(),
        payload: { receiver, reason: "sanctions_receiver", riskScore: 100 },
      });
      return {
        abort: true,
        reason: "sanctions_hit",
        message: `Receiver address flagged: ${receiverScreen.matchedList}`,
      };
    }

    // AML risk score
    checks.push({
      type: "aml",
      target: sender,
      result: amlScore.score <= config.policy.maxRiskScore ? "pass" : "fail",
      detail: `score=${amlScore.score}, factors=[${amlScore.factors.join(",")}]`,
      latencyMs: amlScore.latencyMs,
    });

    if (amlScore.score > config.policy.maxRiskScore) {
      onEvent?.({
        type: "compliance:check:failed",
        timestamp: Date.now(),
        payload: { sender, reason: "aml_risk_exceeded", riskScore: amlScore.score },
      });
      return {
        abort: true,
        reason: "aml_risk_exceeded",
        message: `Risk score ${amlScore.score} exceeds threshold ${config.policy.maxRiskScore}`,
      };
    }

    // -----------------------------------------------------------------------
    // 4. KYA verification (if sender is a known agent)
    // -----------------------------------------------------------------------
    if (kyaCredential && kyaVerifier) {
      const kyaResult = await kyaVerifier.verify(kyaCredential.agentId);

      checks.push({
        type: "kya",
        target: kyaCredential.agentId,
        result: kyaResult.valid ? "pass" : "fail",
        detail: kyaResult.expired
          ? "credential expired"
          : kyaResult.reason ?? (kyaResult.valid ? "valid" : "invalid"),
        latencyMs: kyaResult.latencyMs,
      });

      if (!kyaResult.valid) {
        onEvent?.({
          type: "compliance:check:failed",
          timestamp: Date.now(),
          payload: { sender, reason: "kya_invalid", riskScore: amlScore.score },
        });
        return {
          abort: true,
          reason: "kya_verification_failed",
          message: kyaResult.expired
            ? `Agent credential expired for ${kyaCredential.agentId}`
            : `Agent verification failed for ${kyaCredential.agentId}: ${kyaResult.reason}`,
        };
      }
    } else if (!kyaCredential && kyaRegistry) {
      // Sender is not a known agent — skip KYA check
      checks.push({
        type: "kya",
        target: sender,
        result: "skip",
        detail: "no agent credential found",
        latencyMs: 0,
      });
    }

    // -----------------------------------------------------------------------
    // 5. Cache decision for settle phase
    // -----------------------------------------------------------------------
    const decision: PendingDecision = {
      pass: true,
      riskScore: amlScore.score,
      checks,
      timestamp: Date.now(),
      latencyMs: Date.now() - startTime,
    };
    pendingDecisions.set(payloadKey(paymentPayload), decision);

    onEvent?.({
      type: "compliance:check:passed",
      timestamp: Date.now(),
      payload: { sender, receiver, riskScore: amlScore.score, network: requirements.network },
    });

    return; // pass — continue to facilitator verify
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Deterministic key for a payment payload (used to correlate verify ↔ settle).
 *
 * Uses the full signature (up to 128 chars / 64 bytes) to avoid prefix collisions
 * between different payloads that share the same short prefix.
 */
export function payloadKey(payload: { payload: { signature: string } }): string {
  // Take the full signature; signatures are at least 65 bytes (130 hex chars) for
  // ECDSA. Slice to 128 to cap key length while avoiding prefix collisions.
  return payload.payload.signature.slice(0, 128);
}
