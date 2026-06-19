// ---------------------------------------------------------------------------
// Phase 4 — Discovery service tests
// Service file does not exist yet; tests are marked with .todo() so the suite
// can be run immediately and will show as pending rather than failing.
// ---------------------------------------------------------------------------

import { describe, it } from "vitest";

// ---------------------------------------------------------------------------
// buildAgentCard
// ---------------------------------------------------------------------------

describe("buildAgentCard", () => {
  it.todo("returns a valid A2A AgentCard object with required top-level fields");
  it.todo("includes x-prooflink-compliance extension in AgentCard");
  it.todo("includes x-prooflink-streaming extension when model supports streaming");
  it.todo("sets agentDid in x-prooflink-compliance from the provided agent record");
  it.todo("returns capabilities reflecting the agent's supported protocols");
  it.todo("does not include x-prooflink-streaming when agent has no streaming config");
});

// ---------------------------------------------------------------------------
// searchAgents
// ---------------------------------------------------------------------------

describe("searchAgents", () => {
  it.todo("returns all active agents when no filters provided");
  it.todo("filters by agentType when agentType filter is supplied");
  it.todo("filters by complianceScore minimum when minScore is supplied");
  it.todo("filters by supportedProtocol when protocol filter is supplied");
  it.todo("returns empty array when no agents match the filters");
  it.todo("does not return inactive agents (isActive: false) in results");
  it.todo("respects a limit parameter and does not exceed it");
});

// ---------------------------------------------------------------------------
// importExternalCard
// ---------------------------------------------------------------------------

describe("importExternalCard", () => {
  it.todo("stores a fetched external AgentCard in the DB and returns the stored record");
  it.todo("throws when the external card URL is unreachable");
  it.todo("throws when the fetched payload fails AgentCard schema validation");
  it.todo("does not create a duplicate record when card for same DID already exists");
  it.todo("extracts agentDid from the imported card and sets it on the stored record");
});
