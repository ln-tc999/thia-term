# ProofLink -- Complete Feature Guide

## What is ProofLink

ProofLink is the compliance layer for stablecoin and AI agent payments. It sits between payment protocols (x402, MPP, AP2, ACP) and settlement rails (USDC on Base/Ethereum), providing real-time sanctions screening, FATF Travel Rule compliance, AML risk scoring, and the industry's first Know Your Agent (KYA) standard for autonomous AI transactions. Every payment through ProofLink generates a cryptographically signed, on-chain compliance receipt -- the document a CFO hands to an auditor.

### The Problem

Stablecoin transaction volume hit $33T in 2025 (up 72% YoY). Six competing agent payment protocols shipped between April 2025 and March 2026. None have built-in compliance. The GENIUS Act and MiCA make compliance legally mandatory for every stablecoin transaction above threshold. There is no neutral, cross-protocol compliance layer -- until ProofLink.

### How ProofLink Is Different

| Competitor | What They Do | What ProofLink Does Differently |
|------------|-------------|-------------------------------|
| **Request Network** | Invoice protocol for crypto payments | ProofLink adds sanctions screening, AML scoring, Travel Rule, and KYA on top of invoicing. Request has no compliance engine. |
| **Coinbase x402** | HTTP-native micropayment protocol | x402 has zero built-in compliance. ProofLink is the compliance middleware that plugs into x402 via three hooks (before-verify, before-settle, after-settle). |
| **Chainalysis / TRM Labs** | Blockchain analytics and screening APIs | These are data providers. ProofLink orchestrates them into a unified compliance pipeline with receipts, Travel Rule, and agent identity -- not just raw screening. |
| **Notabene** | Travel Rule transmission | Notabene handles one piece (IVMS101 data exchange). ProofLink integrates Notabene as a provider within a full compliance stack that also includes sanctions, AML, KYA, and receipts. |

---

## Architecture Overview

```
                                    ProofLink Architecture

    +-----------------+      +------------------+      +------------------+
    |   Dashboard     |----->|   API Server     |----->|   PostgreSQL     |
    |   (Next.js 15)  |      |   (Hono)         |      |   :5432          |
    |   :3100         |      |   :3001          |      +------------------+
    +-----------------+      +--------+---------+
                                      |
    +-----------------+      +--------+---------+      +------------------+
    |   MCP Server    |----->|   @prooflink/core |      |   Redis          |
    |   (Claude, etc) |      |   Compliance     |      |   :6379          |
    +-----------------+      |   Engine         |      +------------------+
                             +------------------+
    +-----------------+
    |   x402          |      +------------------+
    |   Middleware     |----->|   Smart          |
    |   (npm package) |      |   Contracts      |
    +-----------------+      |   (Base Sepolia) |
                             +------------------+
    +-----------------+
    |   Frontend      |      Marketing landing page (standalone)
    |   :3000         |
    +-----------------+
```

### Component List

| Component | Package | Purpose |
|-----------|---------|---------|
| **API Server** | `apps/api` | Hono REST API -- compliance checks, invoices, identity, webhooks (port 3001) |
| **Dashboard** | `apps/dashboard` | Next.js 15 admin UI -- real-time monitoring, analytics, agent management (port 3100) |
| **Core Engine** | `packages/core` | Sanctions screener, AML scorer, KYA verifier, Travel Rule checker |
| **MCP Server** | `packages/mcp-server` | 11 AI agent compliance tools via Model Context Protocol |
| **x402 Middleware** | `packages/x402-compliance` | Three-hook compliance middleware for x402 payment flows |
| **Smart Contracts** | `packages/contracts` | Solidity contracts for on-chain settlement, receipts, KYA, invoices |
| **Shared Types** | `packages/shared` | Zod schemas, TypeScript types, validation utilities |
| **SDK** | `packages/sdk` | TypeScript client SDK for ProofLink API |
| **Frontend** | `frontend/` | Marketing landing page (standalone, no API needed) |
| **Demo CLI** | `apps/demo` | Terminal demo for hackathon showcases |

### Data Flow: Payment Through the Compliance Pipeline

```
1. Payment initiated (x402 / API call / MCP tool)
       |
2. SANCTIONS SCREENING
   - Check sender against OFAC SDN, EU, UN, HMT lists
   - Check receiver against same lists
   - Multi-provider: Chainalysis -> TRM Labs -> offline OFAC SDN fallback
   - Result: PASS / FAIL (instant block)
       |
3. AML RISK SCORING
   - Evaluate 10 risk factors (velocity, amount, destination, mixer, etc.)
   - Calculate weighted composite score 0-100
   - Result: APPROVE (<50) / ESCALATE (50-79) / REJECT (>=80)
       |
4. KYA VERIFICATION (if agent DIDs present)
   - Validate W3C Verifiable Credential structure
   - Check ERC-8004 registry registration
   - Verify delegation scope (amount limits, jurisdiction, expiry)
   - Result: VERIFIED / UNVERIFIED
       |
5. TRAVEL RULE CHECK
   - Determine jurisdiction (US, EU, SG, JP, etc.)
   - Compare amount against jurisdiction threshold
   - If required: build IVMS101 message, transmit via Notabene
   - Result: NOT_REQUIRED / TRANSMITTED / FAILED
       |
6. COMPLIANCE RECEIPT GENERATED
   - SHA-256 hash of all check results
   - Signed receipt with all checks, scores, timestamps
   - Stored in PostgreSQL + optionally anchored on-chain via EAS
       |
7. SETTLEMENT PROCEEDS (or is blocked)
```

---

## Core Features

### 1. OFAC Sanctions Screening

ProofLink screens every address involved in a payment against global sanctions lists before allowing settlement.

#### How It Works

The `SanctionsScreener` class in `@prooflink/core` implements a multi-provider architecture with priority ordering, health tracking, and automatic fallback:

1. **Priority mode** (default): Query providers in order. First healthy provider that returns a result wins.
2. **Aggregate mode**: Query all providers in parallel and merge results. Matched if ANY provider matched.
3. **Offline fallback**: If all providers fail, check against the bundled OFAC SDN Ethereum address list (430+ addresses from the Specially Designated Nationals list).

#### Providers

| Provider | Integration | Notes |
|----------|-------------|-------|
| **Chainalysis** | `ChainalysisProvider` | Free sanctions screening API. Default provider. |
| **TRM Labs** | `TRMLabsProvider` | Commercial screening API. POST to `/screening/addresses`. |
| **OFAC SDN Offline** | Built-in | Bundled Ethereum addresses from OFAC SDN list. Zero-latency fallback. |

#### Lists Checked

- OFAC SDN (Specially Designated Nationals)
- EU Consolidated Sanctions List
- UN Consolidated Sanctions List
- HMT (His Majesty's Treasury) Sanctions List

#### Provider Health Tracking

Each provider has automatic health monitoring:
- Consecutive failures are tracked (default threshold: 3)
- Unhealthy providers are skipped until they recover
- Health status is queryable via `getProviderHealth()`

#### API Example

```bash
# Screen a single address
curl -X POST http://localhost:3001/v1/compliance/screen \
  -H "X-API-Key: fl_live_83433bffb7b04d87ae3981f7" \
  -H "Content-Type: application/json" \
  -d '{
    "address": "0x742d35Cc6634C0532925a3b844Bc9e7595f2bD68",
    "chain": "ethereum"
  }'

# Response (clean address):
{
  "success": true,
  "data": {
    "address": "0x742d35Cc6634C0532925a3b844Bc9e7595f2bD68",
    "chain": "ethereum",
    "matched": false,
    "listsChecked": ["OFAC_SDN"],
    "matchDetails": [],
    "riskScore": 0,
    "provider": "chainalysis_free",
    "screenedAt": "2026-03-21T12:00:00.000Z"
  }
}

# Response (sanctioned address):
{
  "success": true,
  "data": {
    "address": "0x7F367cC41522cE07553e823bf3be79A889DEbe1B",
    "chain": "ethereum",
    "matched": true,
    "listsChecked": ["OFAC_SDN"],
    "matchDetails": [
      {
        "list": "OFAC_SDN",
        "entity": "OFAC Designated Address",
        "matchType": "exact",
        "confidence": 1.0
      }
    ],
    "riskScore": 100,
    "provider": "chainalysis_free",
    "screenedAt": "2026-03-21T12:00:00.000Z"
  }
}
```

#### Dashboard Usage

Navigate to the **Screen** page (`/screen`) in the dashboard. Enter any wallet address and select the chain. The dashboard calls the screening endpoint and displays match status, risk score, and matched list entries in real time.

#### What Happens When a Sanctioned Address Is Detected

1. The compliance check returns `status: "REJECTED"` with `riskScore: 100`
2. The compliance receipt records `SANCTIONS_SCREENING: FAILED`
3. In x402 middleware: the `onBeforeVerify` hook returns `reject: true`, blocking settlement
4. In the smart contract (fail-closed mode): `SanctionsHit()` error reverts the transaction
5. The event is logged and visible in the Dashboard compliance history

---

### 2. AML Risk Scoring

ProofLink uses a deterministic, rule-based AML risk scoring engine that evaluates 10 behavioral factors and produces a composite score from 0 (no risk) to 100 (maximum risk). Designed for sub-50ms execution.

#### The 10 Risk Factors

| # | Factor | Weight | Trigger Condition |
|---|--------|--------|-------------------|
| 1 | **Velocity Anomaly** | 15% | >20 tx/hour or >100 tx/24h |
| 2 | **Amount Anomaly** | 20% | Amount >5x historical average, or >$10K with no history |
| 3 | **Destination Risk** | 15% | Receiver within 3 hops of a sanctioned address |
| 4 | **New Wallet** | 8% | Sender wallet is <30 days old |
| 5 | **Mixer Interaction** | 12% | Transaction involves a known mixer (Tornado Cash, etc.) |
| 6 | **Darknet Exposure** | 8% | Receiver has darknet marketplace exposure |
| 7 | **Indirect Exposure** | 10% | Receiver 4-6 hops from a sanctioned address |
| 8 | **Structuring** | 10% | Amount just below reporting thresholds ($3K, $10K), or pattern of sub-threshold amounts |
| 9 | **Time-of-Day Anomaly** | 5% | Transaction between 01:00-05:00 UTC |
| 10 | **Cross-Chain Correlation** | 7% | Active on 3+ chains in 24h with >$1K, or bridge activity with >$5K |

**Total weight: 110%** (normalized to 100 in scoring)

#### How the Composite Score Is Calculated

```
For each rule:
  factorScore = triggered ? 1.0 : 0.0
  totalWeightedScore += factorScore * rule.weight
  totalWeight += rule.weight

rawScore = (totalWeightedScore / totalWeight) * 100
finalScore = round(clamp(rawScore, 0, 100))
```

#### Threshold Behavior

| Score Range | Decision | Action |
|------------|----------|--------|
| 0-49 | **APPROVED** | Payment proceeds. Low risk. |
| 50-79 | **ESCALATED** | Payment held for manual review. Compliance officer notified. |
| 80-100 | **REJECTED** | Payment blocked. Sanctioned or high-risk address. |

The threshold is configurable via `ProofLinkConfig.maxRiskScore` (API) or `ProofLinkFacilitator.setRiskThreshold()` (on-chain).

#### Pluggable Rules

Custom rules can be added at runtime:

```typescript
import { AMLScorer } from "@prooflink/core";

const scorer = new AMLScorer(config);

scorer.addRule({
  factor: "custom_factor",
  weight: 0.1,
  evaluate: (ctx) => ({
    triggered: ctx.amountUsd > 50000,
    detail: `Large transaction: $${ctx.amountUsd}`,
  }),
});

scorer.removeRule("time_of_day_anomaly"); // Remove a built-in rule
```

#### API Example

```bash
# Run a full compliance check (includes AML scoring)
curl -X POST http://localhost:3001/v1/compliance/check \
  -H "X-API-Key: fl_live_83433bffb7b04d87ae3981f7" \
  -H "Content-Type: application/json" \
  -d '{
    "sender": {
      "address": "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
      "chain": "ethereum"
    },
    "receiver": {
      "address": "0x1234567890abcdef1234567890abcdef12345678",
      "chain": "ethereum"
    },
    "amount": "1000",
    "asset": "USDC"
  }'

# Response:
{
  "success": true,
  "data": {
    "status": "APPROVED",
    "riskScore": 12,
    "receiptId": "uuid-here",
    "receiptHash": "0x...",
    "checks": [
      {
        "checkType": "SANCTIONS_SCREENING",
        "target": "sender",
        "result": "PASSED",
        "provider": "ofac_sdn_offline",
        "durationMs": 1
      },
      {
        "checkType": "SANCTIONS_SCREENING",
        "target": "receiver",
        "result": "PASSED",
        "provider": "ofac_sdn_offline",
        "durationMs": 1
      },
      {
        "checkType": "KYA_VERIFICATION",
        "target": "sender",
        "result": "SKIPPED",
        "provider": "prooflink",
        "durationMs": 30
      },
      {
        "checkType": "AML_MONITORING",
        "target": "transaction",
        "result": "PASSED",
        "provider": "prooflink",
        "durationMs": 20
      },
      {
        "checkType": "TRAVEL_RULE",
        "target": "transaction",
        "result": "PASSED",
        "provider": "notabene",
        "durationMs": 5
      },
      {
        "checkType": "JURISDICTIONAL_RULES",
        "target": "transaction",
        "result": "PASSED",
        "provider": "prooflink",
        "durationMs": 3
      }
    ],
    "travelRuleStatus": "TRANSMITTED",
    "totalDurationMs": 45,
    "timestamp": "2026-03-21T12:00:00.000Z"
  }
}
```

---

### 3. Know Your Agent (KYA)

KYA is ProofLink's identity standard for AI agents participating in financial transactions. It answers the question: "Who controls this agent, what is it authorized to do, and should we trust it?"

#### What KYA Credentials Are

KYA credentials are **W3C Verifiable Credentials** (VCs) extended with ProofLink-specific fields:

```json
{
  "@context": [
    "https://www.w3.org/2018/credentials/v1",
    "https://prooflink.io/credentials/kya/v1"
  ],
  "type": ["VerifiableCredential", "KYACredential"],
  "id": "urn:uuid:agent-uuid",
  "issuer": {
    "id": "did:prooflink:issuer",
    "name": "ProofLink"
  },
  "issuanceDate": "2026-03-21T00:00:00Z",
  "expirationDate": "2027-01-01T00:00:00Z",
  "credentialSubject": {
    "id": "did:web:paybot.prooflink.io",
    "agentType": "autonomous",
    "controllingEntity": {
      "name": "ProofLink Inc",
      "lei": "5493001KJTIIGC8Y1R12",
      "kybVerified": true
    },
    "delegationScope": {
      "maxTransactionValue": 10000,
      "dailyLimit": 50000,
      "allowedChains": ["base", "ethereum"],
      "allowedCurrencies": ["USDC"],
      "expiresAt": "2027-01-01T00:00:00Z"
    },
    "walletAddress": "0x1234...",
    "erc8004RegistryAddress": "0xABC...",
    "erc8004TokenId": "42"
  },
  "proof": {
    "type": "EcdsaSecp256k1Signature2019",
    "created": "2026-03-21T00:00:00Z",
    "verificationMethod": "did:prooflink:issuer#key-1",
    "proofPurpose": "assertionMethod",
    "jws": "eyJ..."
  }
}
```

#### Agent Types

| Type | Description | Typical Use Case |
|------|-------------|-----------------|
| `autonomous` | Operates independently with no human approval per transaction | Treasury management bots, automated payment agents |
| `semi-autonomous` | Requires human approval above certain thresholds | Procurement agents, invoice-processing agents |
| `human-supervised` | Every action requires human confirmation | Customer-facing payment assistants |

#### Delegation Scopes and Spending Limits

Each agent has a delegation scope that defines its operational boundaries:

| Field | Type | Description |
|-------|------|-------------|
| `maxTransactionValue` | number | Maximum single transaction amount (USD) |
| `dailyLimit` | number | Maximum daily aggregate spending (USD) |
| `allowedCounterparties` | string[] | Whitelist of approved counterparty DIDs/addresses |
| `blockedJurisdictions` | string[] | ISO country codes where agent cannot transact |
| `allowedChains` | string[] | Blockchain networks the agent can use |
| `allowedCurrencies` | string[] | Token types the agent can transact in |
| `expiresAt` | datetime | When the delegation expires |

#### ERC-8004 Integration

ProofLink integrates with the ERC-8004 Agent Identity Registry standard:

- Agents can be registered on-chain with `erc8004RegistryAddress` and `erc8004TokenId`
- The `KYAVerifier` checks `isRegistered(walletAddress)` on the registry contract
- The `ProofLinkKYA.sol` contract manages on-chain KYA credentials with issuance, revocation, and verification

#### API: Register Agent

```bash
curl -X POST http://localhost:3001/v1/identity/agents \
  -H "X-API-Key: fl_live_83433bffb7b04d87ae3981f7" \
  -H "Content-Type: application/json" \
  -d '{
    "agentDid": "did:web:paybot.prooflink.io",
    "name": "PayBot Prime",
    "agentType": "autonomous",
    "walletAddress": "0x1234567890abcdef1234567890abcdef12345678",
    "controllingEntity": {
      "name": "ProofLink Inc",
      "lei": "5493001KJTIIGC8Y1R12"
    },
    "delegationScope": {
      "maxTransactionValue": 10000,
      "dailyLimit": 50000,
      "expiresAt": "2027-01-01T00:00:00Z"
    }
  }'
```

#### API: Verify Agent

```bash
curl -X POST http://localhost:3001/v1/identity/verify \
  -H "X-API-Key: fl_live_83433bffb7b04d87ae3981f7" \
  -H "Content-Type: application/json" \
  -d '{
    "agentId": "did:web:paybot.prooflink.io",
    "chain": "eip155:8453"
  }'

# Response:
{
  "success": true,
  "data": {
    "verified": true,
    "trustScore": 80,
    "agentMetadata": {
      "name": "PayBot Prime",
      "type": "autonomous",
      "operator": "ProofLink Inc",
      "registeredAt": "2026-03-21T00:00:00Z",
      "walletAddress": "0x1234..."
    },
    "operatorStatus": {
      "sanctionsCleared": true,
      "kycVerified": true
    },
    "delegationScope": {
      "maxTransactionValue": 10000,
      "dailyLimit": 50000,
      "expiresAt": "2027-01-01T00:00:00Z"
    }
  }
}
```

#### API: Issue KYA Credential

```bash
curl -X POST http://localhost:3001/v1/identity/kya/issue \
  -H "X-API-Key: fl_live_83433bffb7b04d87ae3981f7" \
  -H "Content-Type: application/json" \
  -d '{
    "agentDid": "did:web:paybot.prooflink.io",
    "agentType": "autonomous",
    "controllingEntity": {
      "name": "ProofLink Inc",
      "lei": "5493001KJTIIGC8Y1R12",
      "kybVerified": true
    },
    "walletAddress": "0x1234567890abcdef1234567890abcdef12345678",
    "delegationScope": {
      "maxTransactionValue": 10000,
      "dailyLimit": 50000,
      "expiresAt": "2027-01-01T00:00:00Z"
    }
  }'
```

Returns both the agent record and a W3C Verifiable Credential object.

#### API: Update Delegation Scope

```bash
curl -X PUT http://localhost:3001/v1/identity/agents/{agent-uuid}/delegation \
  -H "X-API-Key: fl_live_83433bffb7b04d87ae3981f7" \
  -H "Content-Type: application/json" \
  -d '{
    "maxTransactionValue": 25000,
    "dailyLimit": 100000,
    "blockedJurisdictions": ["KP", "IR", "CU"],
    "expiresAt": "2027-06-01T00:00:00Z"
  }'
```

---

### 4. Travel Rule Compliance

The FATF Travel Rule (Recommendation 16) requires Virtual Asset Service Providers (VASPs) to share originator and beneficiary information for transactions above jurisdiction-specific thresholds.

#### Jurisdiction-Specific Thresholds

| Jurisdiction | Threshold | Legal Basis |
|-------------|-----------|-------------|
| **United States** | $3,000 | Bank Secrecy Act (BSA) |
| **European Union** | EUR 0 (CASP-to-CASP); EUR 1,000 (self-hosted) | MiCA / Transfer of Funds Regulation |
| **Singapore** | SGD 1,500 (~$1,100 USD) | Payment Services Act |
| **Japan** | JPY 0 (no threshold) | Act on Prevention of Transfer of Criminal Proceeds |
| **Default** | $1,000 | ProofLink conservative default |

The `TravelRuleChecker` automatically resolves the most restrictive jurisdiction between originator and beneficiary.

#### IVMS101 Data Format

ProofLink constructs IVMS101-compliant messages for Travel Rule transmission:

```json
{
  "originator": {
    "originatorPersons": [{
      "naturalPerson": {
        "name": "Alice Smith",
        "geographicAddress": "123 Main St, New York, NY",
        "nationalId": "XXX-XX-1234"
      }
    }],
    "accountNumber": ["0xABC..."]
  },
  "beneficiary": {
    "beneficiaryPersons": [{
      "naturalPerson": { "name": "Bob Jones" }
    }],
    "accountNumber": ["0xDEF..."]
  },
  "originatingVASP": {
    "legalPerson": {
      "name": "ProofLink Compliance Service"
    }
  },
  "transactionAmount": "5000",
  "transactionAsset": "USDC",
  "transactionChain": "base"
}
```

#### Notabene Integration

ProofLink supports two Travel Rule transmission providers:

| Provider | Class | Usage |
|----------|-------|-------|
| **MockNotabeneProvider** | Development | Returns simulated success with mock reference IDs |
| **NotabeneProvider** | Production | Real Notabene Gateway API integration (`POST /tx/create`) |

Configure via `ProofLinkConfig.notabene`:

```typescript
{
  notabene: {
    apiKey: "your-notabene-api-key",
    vaspDID: "did:web:your-vasp.com",
    baseUrl: "https://api.notabene.id"
  }
}
```

The provider interface is pluggable -- implement `TravelRuleProvider` to integrate with Sygna Bridge, TRISA, or any other Travel Rule protocol.

---

### 5. Invoice Management (Agent Invoice Standard)

ProofLink defines a machine-readable invoice format for agent-to-agent commerce, bridging the gap between "transaction hash" and "CFO-approved invoice."

#### Invoice Lifecycle State Machine

```
  DRAFT ──────> ISSUED ──────> PAID ──────> SETTLED
    |              |             |
    |              |             v
    |              |          DISPUTED ──> ISSUED (re-issue)
    |              |             |
    v              v             v
  CANCELLED    CANCELLED     CANCELLED
```

Valid state transitions:

| From | Allowed Transitions |
|------|-------------------|
| `DRAFT` | `ISSUED`, `CANCELLED` |
| `ISSUED` | `PAID`, `DISPUTED`, `CANCELLED` |
| `PAID` | `SETTLED`, `DISPUTED` |
| `SETTLED` | (terminal state) |
| `DISPUTED` | `ISSUED`, `CANCELLED` |
| `CANCELLED` | (terminal state) |

#### Line Items and Service Categories

Each invoice contains one or more line items with optional service categorization:

| Category | Description |
|----------|-------------|
| `compute` | Cloud compute, GPU hours, inference |
| `data` | Data access, dataset licensing |
| `api_call` | API request metering |
| `content_generation` | Text, image, video generation |
| `analysis` | Data analysis, research |
| `transaction_fee` | Payment processing fees |
| `other` | Uncategorized |

#### JSON-LD Format

Invoices use JSON-LD for semantic interoperability:

```json
{
  "@context": ["https://schema.org", "https://prooflink.io/invoices/v1"],
  "@type": "Invoice",
  "invoiceId": "inv_abc123",
  "state": "ISSUED",
  "seller": {
    "agentId": "did:web:paybot.prooflink.io",
    "walletAddress": "0x1234...",
    "legalName": "ProofLink Inc"
  },
  "buyer": {
    "walletAddress": "0xDEF...",
    "legalName": "Acme Corp"
  },
  "lineItems": [
    {
      "description": "API Usage - March 2026",
      "quantity": 10000,
      "unit": "request",
      "unitPrice": 0.001,
      "total": 10,
      "serviceCategory": "api_call"
    }
  ],
  "currency": "USDC",
  "totalAmount": 10,
  "paymentProtocol": "x402",
  "complianceStamp": {
    "proofLinkReceiptId": "rcpt_xyz",
    "sanctionsCleared": true,
    "travelRuleTransmitted": true,
    "amlRiskScore": 12
  }
}
```

#### Supported Currencies

`USDC`, `USDT`, `USD`, `EUR`, `GBP`, `EURC`

#### API: Create Invoice

```bash
curl -X POST http://localhost:3001/v1/invoices \
  -H "X-API-Key: fl_live_83433bffb7b04d87ae3981f7" \
  -H "Content-Type: application/json" \
  -d '{
    "seller": {
      "walletAddress": "0x1234567890abcdef1234567890abcdef12345678",
      "agentId": "did:web:paybot.prooflink.io"
    },
    "buyer": {
      "walletAddress": "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045"
    },
    "lineItems": [
      {
        "description": "API Usage - March 2026",
        "quantity": 1000,
        "unitPrice": 0.01,
        "total": 10,
        "serviceCategory": "api_call"
      }
    ],
    "currency": "USDC",
    "totalAmount": 10,
    "paymentProtocol": "x402",
    "dueDate": "2026-04-01T00:00:00Z"
  }'
```

#### API: List Invoices

```bash
# List all ISSUED invoices in USDC
curl "http://localhost:3001/v1/invoices?state=ISSUED&currency=USDC&page=1&limit=20" \
  -H "X-API-Key: fl_live_83433bffb7b04d87ae3981f7"
```

Supports filtering by: `state`, `currency`, `seller` (wallet prefix), `buyer` (wallet prefix), `from`/`to` (date range).

#### API: Update Invoice State

```bash
curl -X PATCH http://localhost:3001/v1/invoices/{invoice-uuid}/state \
  -H "X-API-Key: fl_live_83433bffb7b04d87ae3981f7" \
  -H "Content-Type: application/json" \
  -d '{
    "state": "ISSUED",
    "reason": "Invoice approved by seller"
  }'
```

Returns `422 INVALID_STATE_TRANSITION` if the transition is not allowed by the state machine.

---

### 6. Compliance Receipts (ProofLink)

Every compliance check generates a ProofLink receipt -- a cryptographically signed record of all checks performed, their results, and the compliance decision.

#### What Receipts Contain

| Field | Description |
|-------|-------------|
| `id` | UUID of the receipt |
| `checkId` | UUID of the associated compliance check |
| `receiptHash` | SHA-256 hash of the receipt data |
| `overallStatus` | `APPROVED`, `ESCALATED`, or `REJECTED` |
| `riskScore` | Composite AML risk score (0-100) |
| `travelRuleStatus` | `TRANSMITTED`, `NOT_REQUIRED`, or `FAILED` |
| `checksPerformed` | Array of individual check results (sanctions, AML, KYA, Travel Rule, jurisdictional) |
| `signature` | Cryptographic signature (ECDSA secp256k1) |
| `ttl` | Time-to-live in seconds (default: 300) |

#### EAS Attestation on Base/Ethereum

ProofLink receipts can be anchored on-chain using the Ethereum Attestation Service (EAS):

1. The `ProofLinkRegistry.sol` contract stores receipt hashes, risk scores, and sanctions flags
2. Each receipt is linked to the payment hash, chain ID, payer, payee, amount, and token
3. Receipts can be verified on-chain via `ProofLinkRegistry.verify(receiptId)` which returns `(valid, receiptHash, status)`

#### IPFS Content Addressing

Full receipt data can be stored on IPFS with the content hash anchored in `ProofLinkRegistry`:
- The `ipfsHash` field in the registry maps receipt IDs to IPFS CIDs
- This enables immutable, tamper-proof audit trails

#### Receipt Verification

```bash
# Get a compliance receipt by ID
curl http://localhost:3001/v1/compliance/receipt/{receipt-uuid} \
  -H "X-API-Key: fl_live_83433bffb7b04d87ae3981f7"

# Response:
{
  "success": true,
  "data": {
    "id": "receipt-uuid",
    "checkId": "check-uuid",
    "receiptHash": "0x...",
    "overallStatus": "APPROVED",
    "riskScore": 12,
    "travelRuleStatus": "TRANSMITTED",
    "checksPerformed": [...],
    "signature": "0x...",
    "ttl": 300,
    "createdAt": "2026-03-21T12:00:00Z"
  }
}
```

---

### 7. x402 Protocol Integration

x402 is Coinbase's HTTP-native payment protocol that uses HTTP status code 402 (Payment Required) to gate access to resources. ProofLink adds compliance to x402 via a three-hook middleware.

#### What x402 Is

x402 enables pay-per-request access to APIs and content:
1. Client requests a resource
2. Server returns `402 Payment Required` with a payment payload
3. Client pays (USDC on Base)
4. Server verifies payment and grants access

#### Three-Hook Compliance Middleware

ProofLink's `ProofLinkX402Compliance` class registers three hooks on the x402 resource server:

| Hook | When | What It Does |
|------|------|-------------|
| `onBeforeVerify` | Before payment verification | Sanctions screening (sender + receiver), AML risk scoring, KYA verification (if agent DID present). Blocks payment if sanctioned or high-risk. |
| `onBeforeSettle` | Before payment settlement | Travel Rule check (if above jurisdiction threshold). Re-screens receiver. Converts amount to USD for threshold comparison. |
| `onAfterSettle` | After successful settlement | Generates ProofLink receipt, computes receipt hash, optionally attests on-chain via EAS, creates invoice record. |

#### How to Add ProofLink to an x402 Payment Flow

```typescript
import { ProofLinkX402Compliance } from "@prooflink/x402-compliance";

// Create compliance middleware
const compliance = new ProofLinkX402Compliance(
  {
    riskThreshold: 50,
    sanctionsLists: ["OFAC_SDN"],
    travelRuleEnabled: true,
    defaultTravelRuleThresholdUsd: 3000,
    failOpen: false,
    logger: console,
  },
  {
    // Inject real services for production
    screener: mySanctionsScreener,
    amlScorer: myAmlScorer,
    kyaVerifier: myKyaVerifier,
    travelRuleService: myTravelRuleService,
    proofLinkService: myProofLinkService,
  }
);

// Register on x402 resource server (one line)
compliance.register(x402Server);

// Subscribe to compliance events
compliance.on((event) => {
  console.log(`[${event.type}]`, event);
});

// Cleanup when done
compliance.destroy();
```

The middleware also registers a ProofLink extension on the x402 server that enriches payment responses with ProofLink receipt hashes.

---

### 8. MCP Server (AI Agent Tools)

ProofLink provides a Model Context Protocol (MCP) server with 11 compliance tools that AI agents can call as naturally as any other tool.

#### All 11 MCP Tools

| Tool | Description |
|------|-------------|
| `check_sanctions` | Screen an address or entity against OFAC SDN, EU, UN, HMT sanctions lists. Returns match status and risk score. |
| `verify_kya` | Verify an AI agent's KYA credential. Checks W3C VC structure, issuer trust, delegation scope, and ERC-8004 registration. |
| `create_compliant_invoice` | Create a compliance-stamped invoice with line items, Travel Rule check, and ProofLink receipt. |
| `submit_travel_rule` | Submit IVMS101 Travel Rule data for a transaction. Checks jurisdiction thresholds and transmits via Notabene. |
| `get_compliance_receipt` | Retrieve a ProofLink receipt by transaction hash or receipt ID. For audit trails and dispute resolution. |
| `pay_with_compliance` | End-to-end compliant payment: sanctions -> KYA -> Travel Rule -> payment -> receipt, all in one call. |
| `batch_compliance_check` | Screen up to 100 addresses in a single call. Returns per-address results. |
| `get_risk_report` | Comprehensive risk report for an address. Three depth levels: basic, standard, enhanced. |
| `list_invoices` | List and filter invoices by status, party, date range, currency, and amount range. |
| `get_compliance_metrics` | System health and compliance metrics: volume, pass/fail rates, latency percentiles. |
| `register_agent` | Register a new AI agent with operator identity, delegation scope, and ERC-8004 registration. |

#### MCP Resources (Read-Only)

| Resource | Description |
|----------|-------------|
| `compliance-policy` | Current compliance configuration (thresholds, lists, rules) |
| `compliance-stats` | Aggregated compliance statistics |
| `registered-agents` | List of all registered agents |

#### How to Connect to Claude Desktop

Add to your Claude Desktop MCP configuration (`~/.claude/mcp.json` or Claude Desktop settings):

```json
{
  "mcpServers": {
    "prooflink-compliance": {
      "command": "node",
      "args": ["path/to/prooflink/packages/mcp-server/dist/index.js"],
      "env": {
        "PROOFLINK_API_URL": "http://localhost:3001",
        "PROOFLINK_API_KEY": "fl_live_83433bffb7b04d87ae3981f7"
      }
    }
  }
}
```

The MCP server supports two transports:
- **stdio** (default): For Claude Desktop and local agents
- **SSE**: For remote/web-based agents (configurable port and CORS)

#### How to Connect to LangChain / Custom Agents

```typescript
import { createProofLinkMCPServer } from "@prooflink/mcp-server";

// Start with SSE transport for remote access
const handle = await createProofLinkMCPServer({
  transport: "sse",
  sse: { port: 3002, cors: true },
});

await handle.start();

// Connect from LangChain using MCP client SDK
// Or use the REST API directly at http://localhost:3001/v1/*
```

#### Example Tool Calls

```
User: "Screen 0x742d35Cc... on Ethereum for sanctions"
Agent calls: check_sanctions({ address: "0x742d35Cc...", chain: "ethereum" })

User: "Create an invoice for 500 USDC from my bot to 0xDEF..."
Agent calls: create_compliant_invoice({
  seller: { wallet_address: "0xABC..." },
  buyer: { wallet_address: "0xDEF..." },
  line_items: [{ description: "API usage", quantity: 500, unit_price_usd: 1 }],
  currency: "USDC"
})

User: "Run a risk report on this address"
Agent calls: get_risk_report({ address: "0x742d35Cc...", chain: "base", depth: "enhanced" })
```

---

### 9. Smart Contracts

ProofLink has four Solidity contracts deployed on Base Sepolia, built with OpenZeppelin upgradeable patterns (UUPS proxy) and Foundry.

#### ProofLinkFacilitator.sol

**Purpose:** x402 compliance-gated payment facilitator. Verifies compliance before settlement and anchors ProofLink receipts on-chain.

| Function | Description |
|----------|-------------|
| `verify(payload, compliance)` | Check sanctions, risk score, KYA, and spending limits. Returns `(isCompliant, reason)`. View function -- no state changes. |
| `settle(payload, compliance)` | Execute settlement: run compliance checks, mark nonce, record settlement, anchor receipt in ProofLinkRegistry. Only `SETTLER_ROLE`. |
| `facilitate(sender, receiver, amount, proofLinkReceipt)` | Simplified facilitation: verify ProofLink receipt, check spending limits, emit event. Only `SETTLER_ROLE`. |
| `setRiskThreshold(threshold)` | Set max AML risk score (0-100). Only `DEFAULT_ADMIN_ROLE`. |
| `setSpendingLimit(agent, limit)` | Set daily spending limit for an agent (0 = unlimited). Only `DEFAULT_ADMIN_ROLE`. |
| `setFailMode(failClosed)` | Toggle fail-open/fail-closed. Only `DEFAULT_ADMIN_ROLE`. |

**Key features:**
- UUPS upgradeable proxy pattern
- Role-based access control (SETTLER_ROLE, PAUSER_ROLE, DEFAULT_ADMIN_ROLE)
- Nonce-based replay prevention
- Daily spending limits per agent address
- Emergency pause capability
- Fail-open / fail-closed configurable mode

#### ProofLinkRegistry.sol

**Purpose:** On-chain registry of compliance receipts. Each receipt is immutably anchored with its hash, risk score, sanctions flags, and Travel Rule status.

| Function | Description |
|----------|-------------|
| `anchorReceipt(...)` | Store a compliance receipt on-chain |
| `verify(receiptId)` | Verify a receipt exists and return its status |

#### ProofLinkKYA.sol

**Purpose:** On-chain KYA (Know Your Agent) credential management.

| Function | Description |
|----------|-------------|
| `issueKYA(agent, metadataURI)` | Issue a KYA credential to an agent address |
| `revokeKYA(agent)` | Revoke an agent's KYA credential |
| `verifyKYA(agent)` | Check if an agent has a valid, non-revoked KYA credential |

#### AgentInvoice.sol

**Purpose:** On-chain invoice anchoring for agent-to-agent commerce. Stores invoice hashes for immutable audit trails.

#### Deployment

All contracts target **Base Sepolia** (testnet) with Foundry:

```bash
# Run contract tests
pnpm --filter=@prooflink/contracts test

# Deploy (requires Foundry + Base Sepolia RPC)
forge script script/Deploy.s.sol --rpc-url $BASE_SEPOLIA_RPC --broadcast
```

---

### 10. Dashboard

The ProofLink Dashboard is a Next.js 15 admin UI for real-time compliance monitoring, invoice management, and agent oversight.

#### All Pages

| Page | URL | What It Shows |
|------|-----|---------------|
| **Dashboard** | `/` | Stats cards (total checks, pass rate, volume, active agents), compliance volume chart (pass/fail over time), recent activity feed, system health status |
| **Compliance** | `/compliance` | Paginated list of all compliance checks with status (PASS/FAIL/REVIEW), risk score, amount, counterparty, and individual check results |
| **Invoices** | `/invoices` | All invoices with state, amount, currency, seller/buyer, and creation date |
| **Create Invoice** | `/invoices/new` | Form to create a new invoice with line items, seller/buyer wallets, currency selection, and due date |
| **Agents** | `/agents` | KYA-verified agents with credential status (VERIFIED/PENDING/EXPIRED/REVOKED), delegation scope, and last activity |
| **Analytics** | `/analytics` | Volume trends over time (by granularity), risk score distribution (histogram), compliance decision breakdown, top agents by volume |
| **Screen** | `/screen` | Real-time address screening -- enter a wallet address and chain, get instant sanctions check results |
| **API Keys** | `/api-keys` | Manage API keys for programmatic access |
| **Settings** | `/settings` | Compliance policy configuration, notification preferences |

#### How to Use the Screen Page

1. Navigate to `/screen`
2. Enter a blockchain address (e.g., `0x742d35Cc6634C0532925a3b844Bc9e7595f2bD68`)
3. Select the chain (Ethereum, Base, etc.)
4. Click "Screen" -- results appear instantly with match status, risk score, and matched list entries
5. Known sanctioned addresses return `matched: true` with `riskScore: 100`

#### How to Create Invoices

1. Navigate to `/invoices/new`
2. Fill in seller wallet address (and optional agent DID)
3. Fill in buyer wallet address
4. Add line items with description, quantity, unit price, and service category
5. Select currency (USDC, USDT, etc.)
6. Set optional due date
7. Submit -- invoice is created in DRAFT state

#### Dashboard Works Without Database

The dashboard falls back to mock data when the API is unreachable. This means you can run `pnpm --filter=@prooflink/dashboard dev` standalone to explore the UI without setting up PostgreSQL.

---

## API Reference (Quick)

**Base URL:** `http://localhost:3001`

### Authentication

All `/v1/*` endpoints require authentication via one of:

| Method | Header | Format |
|--------|--------|--------|
| API Key | `X-API-Key` | `fl_live_83433bffb7b04d87ae3981f7` |
| JWT Bearer | `Authorization` | `Bearer <jwt-token>` |

### Compliance Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/v1/compliance/check` | Run full compliance check (sanctions + AML + KYA + Travel Rule) |
| `POST` | `/v1/compliance/screen` | Screen a single address against sanctions lists |
| `POST` | `/v1/compliance/batch` | Batch compliance check (up to 50 transactions) |
| `GET` | `/v1/compliance/receipt/:id` | Get compliance receipt by ID |
| `GET` | `/v1/compliance/history` | Paginated compliance check history (scoped to API key) |
| `GET` | `/v1/compliance/stats` | Aggregate compliance statistics |

### Identity / KYA Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/v1/identity/agents` | Register a new agent |
| `POST` | `/v1/identity/verify` | Verify agent KYA credentials |
| `POST` | `/v1/identity/kya/issue` | Issue KYA Verifiable Credential |
| `GET` | `/v1/identity/agents` | List all agents (paginated, filterable) |
| `GET` | `/v1/identity/:agentId` | Get agent by DID |
| `PUT` | `/v1/identity/agents/:id/delegation` | Update agent delegation scope |

### Invoice Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/v1/invoices` | Create a new invoice |
| `GET` | `/v1/invoices` | List invoices (paginated, filterable) |
| `GET` | `/v1/invoices/:id` | Get invoice by ID |
| `PATCH` | `/v1/invoices/:id/state` | Update invoice state |

### Analytics Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/v1/analytics/volume` | Transaction volume over time (configurable granularity) |
| `GET` | `/v1/analytics/compliance` | Compliance decision breakdown with percentages |
| `GET` | `/v1/analytics/risk` | Risk score distribution (histogram buckets + p50/p95/median) |
| `GET` | `/v1/analytics/agents` | Top agents by transaction volume (sellers + buyers) |

### Dashboard Endpoints (No Auth)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/dashboard/stats` | Aggregate dashboard statistics |
| `GET` | `/dashboard/checks` | Recent compliance checks |
| `GET` | `/dashboard/invoices` | Recent invoices |
| `GET` | `/dashboard/agents` | All agents |
| `GET` | `/dashboard/volume` | Volume chart data |
| `GET` | `/dashboard/health` | System health status |
| `POST` | `/dashboard/screen` | Screen an address (no auth required) |
| `POST` | `/dashboard/compliance-check` | Run compliance check (no auth required) |
| `POST` | `/dashboard/invoices` | Create invoice (no auth required) |

### Health & Observability

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Full health check |
| `GET` | `/health/ready` | Readiness probe (Kubernetes) |
| `GET` | `/health/live` | Liveness probe (Kubernetes) |
| `GET` | `/metrics` | Prometheus metrics |
| `GET` | `/openapi.json` | OpenAPI specification |

### Rate Limits

Rate limits are applied per API key. Default limits are generous for development. Production deployments should configure limits based on plan tier.

### Error Codes

| Code | HTTP Status | Description |
|------|-------------|-------------|
| `VALIDATION_ERROR` | 400 | Request body/params failed Zod validation |
| `UNAUTHORIZED` | 401 | Missing or invalid API key/JWT |
| `NOT_FOUND` | 404 | Resource not found |
| `CONFLICT` | 409 | Resource already exists (e.g., duplicate agent DID) |
| `INVALID_STATE_TRANSITION` | 422 | Invoice state transition not allowed |
| `INTERNAL_ERROR` | 500 | Server error |

---

## Running Locally

### Quick Start (No Database)

The dashboard works standalone with mock data:

```bash
pnpm install
pnpm build
pnpm --filter=@prooflink/dashboard dev
```

Open http://localhost:3100 to explore the dashboard.

### Full Stack (With Database)

```bash
# Start infrastructure
docker compose up postgres redis -d
docker compose exec postgres pg_isready -U prooflink

# Configure environment
cp .env.example .env

# Run migrations and start
pnpm --filter=@prooflink/api db:migrate
pnpm --filter=@prooflink/api dev      # API on :3001
pnpm --filter=@prooflink/dashboard dev  # Dashboard on :3100 (in another terminal)
```

### Full Docker Dev

```bash
docker compose --profile dev up
```

Starts PostgreSQL, Redis, API, and Dashboard all at once.

### Environment Variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `DATABASE_URL` | `postgresql://prooflink:prooflink_dev@localhost:5432/prooflink` | PostgreSQL connection string |
| `REDIS_URL` | `redis://localhost:6379` | Redis connection string |
| `PORT` | `3001` | API server port |
| `CORS_ORIGIN` | `http://localhost:3000,http://localhost:3100` | Allowed CORS origins |
| `API_KEY_SECRET` | (auto-generated in dev) | HMAC key for API key hashing |
| `JWT_SECRET` | (optional) | HS256 key for JWT auth |
| `CHAINALYSIS_API_KEY` | (optional) | Chainalysis sanctions screening API key |
| `BASE_RPC_URL` | `https://mainnet.base.org` | Base chain RPC URL |
| `NEXT_PUBLIC_API_URL` | `http://localhost:3001` | Dashboard -> API URL |

### Seeding Demo Data

```bash
API_URL=http://localhost:3001/v1
API_KEY="fl_live_83433bffb7b04d87ae3981f7"

# 1. Register an agent
curl -X POST $API_URL/identity/agents \
  -H "X-API-Key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "agentDid": "did:web:paybot.prooflink.io",
    "name": "PayBot Prime",
    "agentType": "autonomous",
    "walletAddress": "0x1234567890abcdef1234567890abcdef12345678",
    "controllingEntity": { "name": "ProofLink Inc" },
    "delegationScope": {
      "maxTransactionValue": 10000,
      "dailyLimit": 50000,
      "expiresAt": "2027-01-01T00:00:00Z"
    }
  }'

# 2. Run a compliance check
curl -X POST $API_URL/compliance/check \
  -H "X-API-Key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "sender": { "address": "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045", "chain": "ethereum" },
    "receiver": { "address": "0x1234567890abcdef1234567890abcdef12345678", "chain": "ethereum" },
    "amount": "1000",
    "asset": "USDC"
  }'

# 3. Create an invoice
curl -X POST $API_URL/invoices \
  -H "X-API-Key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "seller": { "walletAddress": "0x1234567890abcdef1234567890abcdef12345678", "agentId": "did:web:paybot.prooflink.io" },
    "buyer": { "walletAddress": "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045" },
    "lineItems": [{ "description": "API Usage", "quantity": 1000, "unitPrice": 0.01, "total": 10 }],
    "currency": "USDC",
    "totalAmount": 10
  }'
```

### Running Tests

```bash
# All tests
pnpm test

# Individual packages
pnpm --filter=@prooflink/shared test          # 417 tests -- types, validation, crypto
pnpm --filter=@prooflink/core test            # 414 tests -- compliance engine
pnpm --filter=@prooflink/sdk test             # 111 tests -- SDK client
pnpm --filter=@prooflink/x402-compliance test # 67 tests -- middleware
pnpm --filter=@prooflink/mcp-server test      # 50 tests -- MCP tools
pnpm --filter=@prooflink/api test             # 133 tests -- API routes

# Smart contracts (requires Foundry)
pnpm --filter=@prooflink/contracts test
```

---

## For Developers

### How to Add a New Compliance Check Type

1. **Define the check type** in `packages/shared/src/types/compliance.ts`:
   ```typescript
   export const ComplianceCheckType = z.enum([
     "SANCTIONS_SCREENING",
     "AML_MONITORING",
     "KYA_VERIFICATION",
     "TRAVEL_RULE",
     "JURISDICTIONAL_RULES",
     "YOUR_NEW_CHECK",  // Add here
   ]);
   ```

2. **Implement the checker** in `packages/core/src/your-check/`:
   ```typescript
   export class YourNewChecker {
     async check(ctx: TransactionContext): Promise<CheckResult> {
       // Implementation
     }
   }
   ```

3. **Wire it into the compliance pipeline** in `apps/api/src/routes/compliance.ts` -- add a new entry to the `checksPerformed` array.

4. **Add the MCP tool** in `packages/mcp-server/src/tools/` -- register it in `server.ts`.

5. **Update the x402 middleware** if the check should run during payment flows.

### How to Add a Custom AML Rule

The `AMLScorer` supports runtime rule addition:

```typescript
import { AMLScorer, type ScoringRule } from "@prooflink/core";

const myRule: ScoringRule = {
  factor: "high_value_first_tx",
  weight: 0.15,
  evaluate: (ctx) => {
    const triggered = ctx.isNewWallet && ctx.amountUsd > 5000;
    return {
      triggered,
      detail: triggered
        ? `First transaction from new wallet is $${ctx.amountUsd}`
        : "Not a high-value first transaction",
    };
  },
};

scorer.addRule(myRule);
```

The rule interface requires:
- `factor`: Unique string identifier (use snake_case)
- `weight`: 0.0 to 1.0 (relative importance)
- `evaluate`: Function receiving `TransactionContext`, returning `{ triggered: boolean, detail: string }`

### How to Integrate with a New Payment Protocol

1. **Define the protocol** in `packages/shared/src/types/protocol.ts`:
   ```typescript
   export const PaymentProtocol = z.enum(["X402", "MPP", "AP2", "ACP", "DIRECT", "YOUR_PROTOCOL"]);
   ```

2. **Create middleware** following the pattern of `packages/x402-compliance/`:
   - Implement hooks that call the core compliance engine
   - Map protocol-specific contexts to ProofLink's `TransactionContext`
   - Generate ProofLink receipts after settlement

3. **Add protocol-specific tests** in the middleware package.

### How to Add a Custom Sanctions Provider

Implement the `SanctionsProvider` interface:

```typescript
import { SanctionsProvider, SanctionsProviderResult } from "@prooflink/core";

export class MyProvider implements SanctionsProvider {
  readonly name = "my_provider";

  async screen(address: string, chain: string): Promise<SanctionsProviderResult> {
    // Call your screening API
    const result = await fetch(`https://my-api.com/screen/${address}`);
    const data = await result.json();

    return {
      matched: data.sanctioned,
      matchDetails: data.matches.map(m => ({
        list: m.list,
        entryId: m.id,
        name: m.name,
        matchConfidence: m.confidence,
      })),
      riskScore: data.sanctioned ? 100 : 0,
    };
  }
}

// Add to screener
screener.addProvider(new MyProvider());
```

### Testing Guide

- Unit tests use Vitest across all packages
- API route tests use Hono test client
- Smart contract tests use Foundry (`forge test`)
- Run `pnpm test` from the monorepo root for all packages
- Coverage: `pnpm test -- --coverage`

---

## Roadmap

### What's Built (Current)

- Full compliance pipeline: sanctions screening, AML risk scoring, KYA verification, Travel Rule checking
- REST API with 20+ endpoints, Zod validation, tenant-scoped data isolation
- Next.js 15 dashboard with 9 pages (monitoring, analytics, invoicing, agent management, screening)
- MCP server with 11 AI agent compliance tools and 3 read-only resources
- x402 compliance middleware with three-hook architecture
- 4 Solidity smart contracts (Facilitator, ProofLinkRegistry, KYA, AgentInvoice)
- Agent Invoice Standard with JSON-LD format and state machine
- W3C Verifiable Credential-based KYA credentials
- TypeScript SDK for programmatic API access
- 1,192+ automated tests across all packages
- Docker Compose development environment

### What's Next

| Priority | Feature | Description |
|----------|---------|-------------|
| **High** | On-chain EAS attestation | Production EAS integration on Base mainnet for immutable compliance receipts |
| **High** | Real Notabene integration | Replace mock Travel Rule provider with live Notabene Gateway API |
| **High** | Production deployment | Deploy API, Dashboard, and contracts to Base mainnet |
| **Medium** | Real-time webhooks | Push compliance events to subscriber endpoints |
| **Medium** | Multi-chain support | Extend sanctions screening and settlement to Solana, Arbitrum, Optimism |
| **Medium** | KYA standard publication | Submit KYA spec to W3C Credentials Community Group as open standard |
| **Medium** | Behavioral AML models | ML-based anomaly detection trained on agent transaction patterns |
| **Low** | Dispute resolution hooks | On-chain dispute workflow for invoices |
| **Low** | Agent reputation system | Cross-platform agent reputation scoring based on compliance history |
| **Low** | Request Network integration | Import/export invoices in Request Network format |

---

*Document generated from ProofLink codebase analysis. All API examples use the development API key. For production deployments, generate a new API key via the API Keys dashboard page.*
