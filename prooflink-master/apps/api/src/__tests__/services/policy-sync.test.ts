// ---------------------------------------------------------------------------
// Phase 4 — Policy sync service tests
// Service file does not exist yet; tests are marked with .todo() so the suite
// can be run immediately and will show as pending rather than failing.
// ---------------------------------------------------------------------------

import { describe, it } from "vitest";

// ---------------------------------------------------------------------------
// getAgentPolicy
// ---------------------------------------------------------------------------

describe("getAgentPolicy", () => {
  it.todo("returns the policy record from DB when it exists for the given agentDid");
  it.todo("throws a PolicyNotFoundError when no record exists for agentDid");
  it.todo("returns the correct policy version number");
  it.todo("merges global defaults into the returned policy object");
  it.todo("returns syncStatus alongside the policy object");
});

// ---------------------------------------------------------------------------
// validateCrossChainSpend
// ---------------------------------------------------------------------------

describe("validateCrossChainSpend", () => {
  it.todo("returns { allowed: true } when aggregate spend is below global limit");
  it.todo("returns { allowed: false, reason: 'GLOBAL_LIMIT_EXCEEDED' } when spend exceeds limit");
  it.todo("returns { allowed: false } when spend equals the global limit (boundary — limit is exclusive)");
  it.todo("considers spend across all chains when evaluating the global limit");
  it.todo("returns { allowed: true } when the agent has no prior spend on any chain");
  it.todo("applies per-chain limits before the global limit check");
  it.todo("returns { allowed: false, reason: 'CHAIN_LIMIT_EXCEEDED' } when per-chain limit exceeded");
});

// ---------------------------------------------------------------------------
// aggregateSpendAcrossChains
// ---------------------------------------------------------------------------

describe("aggregateSpendAcrossChains", () => {
  it.todo("returns 0 when the agent has no spend records on any chain");
  it.todo("sums spend from a single chain correctly");
  it.todo("sums spend across multiple chains correctly");
  it.todo("converts spend amounts from different assets to a common denomination before summing");
  it.todo("handles numeric precision correctly for large spend amounts");
  it.todo("returns the correct sum when the same chain has multiple spend records");
});
