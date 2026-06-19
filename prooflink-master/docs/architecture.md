# Architecture Guide

This guide covers ProofLink's system architecture, package dependencies, data flow, and decision pipeline.

## System Architecture

```
                                    ProofLink System Architecture
                                    ============================

    +-----------+     +-----------+     +-----------+     +-----------+
    | AI Agent  |     | AI Agent  |     | x402      |     | Dashboard |
    | (Claude)  |     | (Custom)  |     | Server    |     | (Next.js) |
    +-----+-----+     +-----+-----+     +-----+-----+     +-----+-----+
          |                 |                 |                 |
          |  MCP Protocol   |  REST API       |  Hooks          |  REST API
          v                 v                 v                 v
    +-----+-----+     +--------------------------------------------+
    | MCP Server |     |              ProofLink API                  |
    | (stdio)    +---->|         (Hono on port 3001)                |
    +------------+     |                                            |
                       |  /compliance  /invoices  /identity         |
                       |  /webhooks    /analytics /health           |
                       +-----+---------+---------+------------------+
                             |         |         |
                             v         v         v
                       +-----+---------+---------+------------------+
                       |           @prooflink/core                   |
                       |       ProofLink Decision Engine            |
                       |                                            |
                       |  +------------+  +-----------+  +--------+ |
                       |  | Sanctions  |  | AML       |  | Travel | |
                       |  | Screener   |  | Scorer    |  | Rule   | |
                       |  +------+-----+  +-----+-----+  +---+----+ |
                       |         |              |             |      |
                       |  +------+-----+  +-----+-----+  +---+----+ |
                       |  | KYA        |  | Receipt   |  | Cache  | |
                       |  | Verifier   |  | Issuer    |  | (LRU)  | |
                       |  +------------+  +-----------+  +--------+ |
                       +----+----------------+-----+----------------+
                            |                |     |
                            v                v     v
                       +----+----+     +-----+--+  +--------+
                       |Postgres |     | Redis  |  | EAS    |
                       |  (DB)   |     | (Cache)|  | (Chain)|
                       +---------+     +--------+  +--------+

                       +--------------------------------------------+
                       |        @prooflink/x402-compliance           |
                       |    (Intercepts x402 payment flow)          |
                       |                                            |
                       |  onBeforeVerify --> Sanctions + AML        |
                       |  onBeforeSettle --> Travel Rule            |
                       |  onAfterSettle  --> ProofLink Receipt      |
                       +--------------------------------------------+
```

---

## Package Dependency Graph

```
@prooflink/shared          (Zod schemas, types, constants, errors)
    |
    +---> @prooflink/core             (ProofLink engine, sanctions, AML, travel rule, KYA)
    |         |
    |         +---> @prooflink/x402-compliance   (x402 middleware hooks)
    |         +---> @prooflink/api               (Hono REST API server)
    |         +---> @prooflink/demo              (Terminal-based hackathon demo)
    |
    +---> @prooflink/sdk              (TypeScript client SDK)
    +---> @prooflink/mcp-server       (MCP compliance server for AI agents)
    +---> @prooflink/request-finance  (Request Network integration)
    +---> @prooflink/api              (also depends on shared directly)
    +---> @prooflink/demo

@prooflink/contracts  (standalone -- Foundry/Solidity, no TS dependencies)
```

### Package descriptions

| Package                       | Description                                    |
|-------------------------------|------------------------------------------------|
| `@prooflink/shared`            | Shared Zod schemas, TypeScript types, constants, error classes, utilities |
| `@prooflink/core`              | ProofLink compliance decision engine -- sanctions, AML, Travel Rule, KYA, receipts |
| `@prooflink/x402-compliance`   | x402 HTTP 402 payment protocol compliance middleware |
| `@prooflink/mcp-server`        | Model Context Protocol server exposing compliance tools for AI agents |
| `@prooflink/sdk`               | TypeScript client SDK for the ProofLink REST API |
| `@prooflink/request-finance`   | Request Network / Request Finance compliance integration |
| `@prooflink/api`               | Hono-based REST API server (port 3001)          |
| `@prooflink/dashboard`         | Next.js 15 admin dashboard (port 3100)          |
| `@prooflink/demo`              | Terminal-based hackathon demo                   |
| `@prooflink/contracts`         | Solidity smart contracts (Foundry)              |

### Smart contracts

| Contract                     | Purpose                                |
|------------------------------|----------------------------------------|
| `ProofLinkRegistry.sol`      | On-chain compliance receipt registry   |
| `ProofLinkKYA.sol`            | Know Your Agent identity attestations  |
| `AgentInvoice.sol`           | Autonomous agent invoice management    |
| `ProofLinkFacilitator.sol`    | x402 compliant payment facilitator     |

---

## Data Flow Diagrams

### Compliance check flow

```
Client                    API                     Core Engine
  |                        |                          |
  |  POST /compliance/check|                          |
  |----------------------->|                          |
  |                        |  checkCompliance(req)     |
  |                        |------------------------->|
  |                        |                          |
  |                        |   [1] Sanctions screen   |
  |                        |       sender + receiver  |
  |                        |          |               |
  |                        |   [2] KYA verify         |
  |                        |       (if agentDID)      |
  |                        |          |               |
  |                        |   [3] AML risk score     |
  |                        |          |               |
  |                        |   [4] Travel Rule        |
  |                        |       (if above threshold)|
  |                        |          |               |
  |                        |   [5] Jurisdictional     |
  |                        |       rules check        |
  |                        |          |               |
  |                        |   [6] Generate receipt   |
  |                        |<-------------------------|
  |                        |                          |
  |                        |  Store check + receipt   |
  |                        |  in Postgres             |
  |                        |                          |
  |  201 { decision }      |                          |
  |<-----------------------|                          |
```

### x402 payment flow with compliance

```
Client          x402 Server       ProofLink Middleware       Chainalysis
  |                 |                     |                      |
  |  GET /resource  |                     |                      |
  |---------------->|                     |                      |
  |  402 + payment  |                     |                      |
  |  requirements   |                     |                      |
  |<----------------|                     |                      |
  |                 |                     |                      |
  |  GET /resource  |                     |                      |
  |  + payment      |                     |                      |
  |---------------->|                     |                      |
  |                 |  onBeforeVerify     |                      |
  |                 |------------------->|                      |
  |                 |                     |  screen(address)     |
  |                 |                     |--------------------->|
  |                 |                     |  { clean: true }     |
  |                 |                     |<---------------------|
  |                 |                     |  AML score(addr)     |
  |                 |                     |  -> score: 12        |
  |                 |  { allow: true }    |                      |
  |                 |<--------------------|                      |
  |                 |                     |                      |
  |                 |  verify payment     |                      |
  |                 |  (x402 facilitator) |                      |
  |                 |                     |                      |
  |                 |  onBeforeSettle     |                      |
  |                 |------------------->|                      |
  |                 |                     |  Travel Rule check   |
  |                 |                     |  (if above threshold)|
  |                 |  { allow: true }    |                      |
  |                 |<--------------------|                      |
  |                 |                     |                      |
  |                 |  settle payment     |                      |
  |                 |  (on-chain)         |                      |
  |                 |                     |                      |
  |                 |  onAfterSettle      |                      |
  |                 |------------------->|                      |
  |                 |                     |  Generate ProofLink  |
  |                 |                     |  receipt             |
  |                 |                     |  Attest via EAS      |
  |                 |  { receipt }        |  (optional)          |
  |                 |<--------------------|                      |
  |                 |                     |                      |
  |  200 + content  |                     |                      |
  |<----------------|                     |                      |
```

### Invoice lifecycle

```
DRAFT -----> ISSUED -----> PAID -----> SETTLED
  |             |            |
  |             |            +-------> DISPUTED -----> ISSUED
  |             |                                  |
  |             +-------> DISPUTED                 +---> CANCELLED
  |             |
  |             +-------> CANCELLED
  |
  +-----------> CANCELLED
```

---

## Decision Pipeline

The ProofLink engine processes compliance requests through a sequential pipeline. Each stage can approve, reject, or escalate.

### Pipeline stages

```
+-------------------------------------------------------------------+
|                    ProofLink Decision Pipeline                     |
+-------------------------------------------------------------------+
|                                                                   |
|  Stage 1: SANCTIONS SCREENING                                    |
|  +---------------------------------------------------------+     |
|  | Screen sender against OFAC_SDN, EU, UN, HMT             |     |
|  | Screen receiver against OFAC_SDN, EU, UN, HMT           |     |
|  | Provider: Chainalysis (free or KYT tier)                 |     |
|  | Cache: Redis (clean=1h, flagged=5min)                    |     |
|  | Failure mode: fail-closed (configurable to fail-open)    |     |
|  +---------------------------------------------------------+     |
|       | MATCH -> REJECTED                                         |
|       | CLEAR -> continue                                         |
|                                                                   |
|  Stage 2: KYA VERIFICATION (if agentDID present)                 |
|  +---------------------------------------------------------+     |
|  | Look up agent in registry                                |     |
|  | Validate W3C VC structure and issuer trust               |     |
|  | Check credential expiration                              |     |
|  | Validate delegation scope (amount, chains, currencies)   |     |
|  | Check ERC-8004 registration (if configured)              |     |
|  | Compute trust score (0-100)                              |     |
|  +---------------------------------------------------------+     |
|       | FAILED -> ESCALATED                                       |
|       | SKIPPED (no DID) -> continue                              |
|       | PASSED -> continue                                        |
|                                                                   |
|  Stage 3: AML RISK SCORING                                       |
|  +---------------------------------------------------------+     |
|  | Evaluate transaction context against risk factors        |     |
|  | Factors: velocity, destination, amount anomaly, mixer,   |     |
|  |   darknet, structuring, cross-chain correlation          |     |
|  | Output: score (0-100) + contributing factors             |     |
|  +---------------------------------------------------------+     |
|       | Score >= 80 -> REJECTED                                   |
|       | Score 50-79 -> ESCALATED                                  |
|       | Score < 50 -> continue                                    |
|                                                                   |
|  Stage 4: TRAVEL RULE                                             |
|  +---------------------------------------------------------+     |
|  | Check if amount exceeds jurisdiction threshold           |     |
|  | Format IVMS101 originator/beneficiary data               |     |
|  | Transmit via Notabene (VASP-to-VASP messaging)           |     |
|  | Record transmission status                               |     |
|  +---------------------------------------------------------+     |
|       | FAILED -> ESCALATED                                       |
|       | NOT_REQUIRED -> continue                                  |
|       | TRANSMITTED -> continue                                   |
|                                                                   |
|  Stage 5: JURISDICTIONAL RULES                                    |
|  +---------------------------------------------------------+     |
|  | Apply GENIUS Act rules (US counterparties)               |     |
|  | Apply MiCA rules (EU counterparties)                     |     |
|  | Check enhanced due diligence jurisdictions               |     |
|  | Validate against blocked jurisdiction lists              |     |
|  +---------------------------------------------------------+     |
|       | VIOLATION -> REJECTED                                     |
|       | PASSED -> continue                                        |
|                                                                   |
|  Stage 6: RECEIPT GENERATION                                      |
|  +---------------------------------------------------------+     |
|  | Aggregate all check results                              |     |
|  | Compute receipt hash                                     |     |
|  | Sign with issuer key                                     |     |
|  | Store in database                                        |     |
|  | Attest on-chain via EAS (optional)                       |     |
|  | Pin to IPFS (optional)                                   |     |
|  +---------------------------------------------------------+     |
|                                                                   |
|  OUTPUT: ComplianceDecision                                       |
|  { status, riskScore, receiptId, checks[], travelRuleStatus }    |
+-------------------------------------------------------------------+
```

---

## Infrastructure

### Database (PostgreSQL 16)

| Table                | Purpose                          |
|---------------------|----------------------------------|
| `compliance_checks` | Compliance check records          |
| `compliance_receipts` | ProofLink receipts              |
| `agents`            | Registered agent identities       |
| `invoices`          | Agent-to-agent invoices           |
| `api_keys`          | API key management                |

ORM: Drizzle ORM with type-safe schema definitions.

### Cache (Redis 7)

- Sanctions screening result cache (clean: 1h TTL, flagged: 5min TTL)
- Rate limiting counters
- Session data

### On-chain (Base + Ethereum)

| Component                  | Network       | Purpose                   |
|---------------------------|---------------|---------------------------|
| `ProofLinkRegistry`       | Base mainnet  | Compliance receipt registry|
| `ProofLinkKYA`             | Base mainnet  | Agent identity attestations|
| `AgentInvoice`            | Base mainnet  | Invoice anchoring          |
| `ProofLinkFacilitator`     | Base mainnet  | x402 payment facilitator   |
| EAS attestations          | Base mainnet  | Compliance proof anchoring |

---

## Technology Stack

| Layer          | Technology                              |
|---------------|----------------------------------------|
| Runtime        | Node.js >= 22                          |
| Language       | TypeScript (strict mode, ES2022)       |
| API framework  | Hono                                   |
| Database       | PostgreSQL 16 + Drizzle ORM            |
| Cache          | Redis 7                                |
| Validation     | Zod                                    |
| Smart contracts| Solidity 0.8.25 + Foundry              |
| MCP server     | @modelcontextprotocol/sdk              |
| Build system   | Turborepo                              |
| Linting        | Biome                                  |
| Testing        | Vitest                                 |
| Container      | Docker + Docker Compose                |
| Chains         | Base (mainnet + Sepolia), Ethereum     |
| Dashboard      | Next.js 15, React 19, Radix UI, Recharts |

---

## Next Steps

- [API Reference](./api-reference.md) -- endpoint documentation
- [Compliance Concepts](./compliance-concepts.md) -- understand each check type
- [x402 Integration](./x402-integration.md) -- middleware hook details
- [SDK Reference](./sdk-reference.md) -- client SDK methods
