/**
 * Shared service context for the ProofLink MCP server.
 *
 * Initializes a single ProofLinkEngine with default (env-based) config
 * and exposes the individual sub-engines for direct use by tool handlers.
 */

import {
  loadConfig,
  SanctionsScreener,
  AMLScorer,
  KYAVerifier,
  isKnownSanctionedAddress,
  type ProofLinkConfig,
} from "@prooflink/core";

// ---------------------------------------------------------------------------
// Config — loads from PROOFLINK_* env vars, falls back to safe defaults
// ---------------------------------------------------------------------------

const config: ProofLinkConfig = loadConfig({
  // MCP server defaults to fail-open: when external screening APIs are unreachable,
  // fall back to the offline OFAC SDN list rather than hard-failing every tool call.
  // This is safe because the offline list still catches sanctioned addresses.
  failOpen: process.env["PROOFLINK_FAIL_OPEN"] !== "false",
});

// ---------------------------------------------------------------------------
// Sub-engine singletons
// ---------------------------------------------------------------------------

/** Sanctions screener with Chainalysis provider + offline OFAC fallback. */
export const sanctionsScreener = new SanctionsScreener(config);

/** Rule-based AML risk scorer. */
export const amlScorer = new AMLScorer(config);

/** KYA (Know Your Agent) verifier against ERC-8004 + W3C VCs. */
export const kyaVerifier = new KYAVerifier(config);

/** Re-export offline check for entity-name-only screening. */
export { isKnownSanctionedAddress };

/** Re-export config for tools that need threshold values etc. */
export { config };
