<p align="center">
  <h1 align="center">ProofLink</h1>
</p>

<p align="center">
  <strong>Compliance infrastructure for AI agent payments</strong>
</p>

<p align="center">
  Real-time sanctions screening · AML risk scoring · FATF Travel Rule · Cryptographic compliance receipts
</p>

<p align="center">
  <a href="https://github.com/Flow-Link/prooflink/actions"><img src="https://img.shields.io/github/actions/workflow/status/Flow-Link/prooflink/ci.yml?branch=master&label=CI&logo=github" alt="CI" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-green" alt="License: MIT" /></a>
  <img src="https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white" alt="TypeScript strict" />
  <img src="https://img.shields.io/badge/tests-2295%20passing-brightgreen" alt="Tests: 1557+ passing" />
</p>

---

## The Problem

Six agent payment protocols shipped in 12 months. **None have compliance.**

The GENIUS Act takes effect July 2025. MiCA enforcement begins mid-2026. Ninety-nine jurisdictions already enforce the FATF Travel Rule. Every stablecoin payment an autonomous agent makes will need identity, screening, and audit trails -- and none of the protocols (x402, MPP, AP2, ACP, A2A) define how that works.

ProofLink is the shared compliance layer. One API call screens both parties, scores risk, transmits Travel Rule data, and produces a cryptographic receipt. Drop it in front of any protocol. Ship compliant from day one.

---

## How It Works

```
  Payment Request
        |
        v
+---------------+     +---------------+     +---------------+
|   Identity    | --> |  Sanctions    | --> |     AML       |
|  Resolution   |     |  Screening    |     |   Scoring     |
| (KYA / DID)   |     | (OFAC/EU/UN)  |     |   (0-100)     |
+---------------+     +---------------+     +---------------+
                                                    |
                                                    v
+---------------+     +---------------+     +---------------+
|   Receipt     | <-- |  Travel Rule  | <-- |   Decision    |
| (EAS on-chain)|     | (FATF/GENIUS) |     |    Engine     |
+---------------+     +---------------+     +---------------+
```

**Risk score thresholds:**

| Score | Decision | What happens |
|-------|----------|-------------|
| 0--49 | `APPROVED` | Payment proceeds automatically |
| 50--79 | `ESCALATED` | Flagged for manual review |
| 80--100 | `REJECTED` | Payment blocked, SAR generated |

The full pipeline completes in under 200ms.

---

## Dashboard

<p align="center">
  <img src="docs/images/dashboard.png" alt="ProofLink Dashboard — real-time compliance monitoring" width="800" />
</p>

<p align="center"><em>Real-time compliance monitoring with volume charts, activity feed, and risk overview</em></p>

<details>
<summary><strong>More screenshots</strong></summary>

<br />

**Compliance History** — Search, filter, and review every compliance decision:

<p align="center">
  <img src="docs/images/compliance-history.png" alt="Compliance decision history" width="800" />
</p>

**Sanctions Screening** — Screen any wallet address with instant OFAC/EU/UN match detection:

<p align="center">
  <img src="docs/images/sanctions-screening.png" alt="Address sanctions screening" width="800" />
</p>

**Analytics** — Transaction volume, compliance decision breakdown, risk distribution, and geographic insights:

<p align="center">
  <img src="docs/images/analytics.png" alt="Compliance analytics dashboard" width="800" />
</p>

</details>

---

## Quick Start

```bash
git clone https://github.com/Flow-Link/prooflink.git
cd prooflink
corepack enable && pnpm install

# Start Postgres + Redis
docker compose up -d postgres redis

# Configure environment
cp .env.example .env

# Run migrations and start dev servers
pnpm --filter=@prooflink/api db:migrate
pnpm dev
```

API runs on `localhost:3001`. Dashboard on `localhost:3100`.

---

## Architecture

### Monorepo Structure

```
prooflink/
├── apps/
│   ├── api/              # Hono REST API server
│   ├── dashboard/        # Next.js 15 admin dashboard
│   └── demo/             # Interactive demo scenarios
├── packages/
│   ├── core/             # Compliance decision engine
│   ├── sdk/              # TypeScript client SDK
│   ├── x402-compliance/  # x402 protocol middleware
│   ├── mcp-server/       # MCP compliance server (11 tools)
│   ├── contracts/        # Solidity smart contracts (Foundry)
│   ├── shared/           # Shared types, schemas, constants
│   └── integrations/     # Third-party bridges (Request Finance)
├── k8s/                  # Kubernetes manifests
├── docker-compose.yml    # Local development stack
└── turbo.json            # Turborepo pipeline config
```

### Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js 22, TypeScript 5.8 (strict) |
| API | Hono |
| Database | PostgreSQL 16, Drizzle ORM |
| Cache | Redis 7 |
| Frontend | Next.js 15, React 19, Tailwind CSS, Radix UI |
| Contracts | Solidity 0.8.25, Foundry, EAS |
| Build | Turborepo, pnpm workspaces |
| Lint | Biome |
| Blockchain | Base (EAS native at `0x4200...0021`) |

---

## API Reference

### Full Compliance Check

```bash
curl -X POST https://api.prooflink.io/v1/compliance/check \
  -H "Authorization: Bearer fl_live_sk_a1b2c3d4e5f6" \
  -H "Content-Type: application/json" \
  -d '{
    "sender": {
      "address": "0x742d35Cc6634C0532925a3b844Bc9e7595f2bD68",
      "chain": "base",
      "agentDID": "did:prooflink:agent:data-processor"
    },
    "receiver": {
      "address": "0x8Ba1f109551bD432803012645Ac136ddd64DBA72",
      "chain": "base"
    },
    "amount": "5000",
    "asset": "USDC",
    "protocol": "x402"
  }'
```

**Response:**

```json
{
  "id": "chk_a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "status": "APPROVED",
  "riskScore": 12,
  "sanctions": {
    "sender": { "clear": true, "lists": ["OFAC_SDN", "EU", "UN"] },
    "receiver": { "clear": true, "lists": ["OFAC_SDN", "EU", "UN"] }
  },
  "travelRule": {
    "required": true,
    "transmitted": true,
    "protocol": "TRISA"
  },
  "receipt": {
    "id": "rcpt_f47ac10b-58cc-4372-a567-0e02b2c3d479",
    "attestationUid": "0x1a2b3c4d...",
    "explorerUrl": "https://base.easscan.org/attestation/view/0x1a2b3c4d..."
  },
  "processingTimeMs": 142
}
```

### Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/v1/compliance/check` | Full compliance check (screening + AML + Travel Rule) |
| `POST` | `/v1/compliance/screen` | Sanctions screening only |
| `POST` | `/v1/compliance/batch` | Batch compliance checks |
| `GET` | `/v1/compliance/analytics` | Compliance volume and risk analytics |
| `POST` | `/v1/identity/verify` | Verify agent identity (KYA) |
| `POST` | `/v1/identity/register` | Register a new agent |
| `GET` | `/v1/identity/agents/:id` | Get agent details |
| `POST` | `/v1/invoices` | Create a compliance-stamped invoice |
| `GET` | `/v1/invoices` | List invoices |
| `GET` | `/v1/invoices/:id` | Get invoice details |
| `POST` | `/v1/travel-rule/submit` | Submit Travel Rule transfer |
| `GET` | `/v1/receipts/:id` | Get compliance receipt |
| `GET` | `/v1/receipts` | List receipts |
| `POST` | `/v1/policies` | Create compliance policy |
| `GET` | `/v1/policies` | List active policies |
| `GET` | `/v1/reports` | Generate compliance reports |
| `POST` | `/v1/disputes` | File a compliance dispute |
| `POST` | `/v1/escrow` | Create escrow with compliance gate |
| `GET` | `/v1/discovery` | Protocol discovery endpoint |
| `GET` | `/v1/webhooks` | List configured webhooks |
| `POST` | `/v1/webhooks` | Register a webhook |
| `GET` | `/health` | Health check |

Full request/response schemas: [`docs/api-reference.md`](docs/api-reference.md)

---

## SDK Usage

```bash
pnpm add @prooflink/sdk
```

```typescript
import { ProofLinkClient } from "@prooflink/sdk";

const client = new ProofLinkClient({
  apiKey: process.env.PROOFLINK_API_KEY!,
  baseUrl: "https://api.prooflink.io", // optional, defaults to production
});

// Run a compliance check
const result = await client.checkCompliance({
  sender: { address: "0xAlice", chain: "base" },
  receiver: { address: "0xBob", chain: "base" },
  amount: "5000",
  asset: "USDC",
});

console.log(result.status);     // "APPROVED"
console.log(result.riskScore);  // 12
console.log(result.receipt.id); // "rcpt_f47ac10b-..."

// Screen a single address
const screen = await client.screenAddress({
  address: "0x742d35Cc6634C0532925a3b844Bc9e7595f2bD68",
  chain: "base",
});

// Verify an agent
const agent = await client.verifyAgent({
  agentId: "did:prooflink:agent:data-processor",
  chain: "eip155:8453",
});
```

---

## MCP Server

Add compliance tools to any MCP-compatible client.

**Configuration** (MCP client config):

```json
{
  "mcpServers": {
    "prooflink-compliance": {
      "command": "npx",
      "args": ["@prooflink/mcp-server"],
      "env": {
        "PROOFLINK_API_KEY": "fl_live_your_api_key"
      }
    }
  }
}
```

**Available tools (11):**

| Tool | Description |
|------|-------------|
| `check_sanctions` | Screen addresses against OFAC, EU, UN, HMT sanctions lists |
| `verify_kya` | Verify agent identity, authorization, and compliance standing |
| `register_agent` | Register a new agent with KYA credentials |
| `create_invoice` | Generate compliance-stamped invoices for agent services |
| `list_invoices` | List and filter invoices |
| `submit_travel_rule` | Transmit FATF Travel Rule originator/beneficiary data |
| `pay_with_compliance` | End-to-end compliant payment with all checks |
| `get_receipt` | Retrieve cryptographic compliance receipt for audit |
| `get_risk_report` | Get risk assessment report for an address or entity |
| `get_metrics` | Compliance check volume, approval rates, latency stats |
| `batch_check` | Run compliance checks on multiple transactions |

---

## x402 Middleware

Drop compliance into any x402 payment server:

```bash
pnpm add @prooflink/x402-compliance
```

```typescript
import { createProofLinkCompliance } from "@prooflink/x402-compliance";

const compliance = createProofLinkCompliance({
  chainalysisApiKey: process.env.CHAINALYSIS_API_KEY!,
  policy: {
    sanctionsLists: ["OFAC_SDN", "EU", "UN"],
    maxRiskScore: 70,
    travelRuleThresholdUsd: 3000,
  },
});

// Hooks into onBeforeVerify, onBeforeSettle, onAfterSettle
compliance.register(server);
```

Three hook points fire automatically:

1. **Before verify** -- sanctions screening + AML scoring on the payer
2. **Before settle** -- Travel Rule transmission for transfers above threshold
3. **After settle** -- receipt generation + EAS attestation

---

## Smart Contracts

Solidity 0.8.25. Built with Foundry. Deployed on Base Sepolia (upgradeable via ERC-1967).

| Contract | Purpose |
|----------|---------|
| `ProofLinkRegistry.sol` | On-chain compliance receipt registry via EAS attestations |
| `ProofLinkKYA.sol` | Know Your Agent identity attestations (ERC-8004 compatible) |
| `AgentInvoice.sol` | Autonomous agent invoice management with content hash anchoring |
| `ProofLinkFacilitator.sol` | x402-compliant payment facilitator with pre-settlement compliance gate |

```bash
cd packages/contracts

# Build
forge build

# Test
forge test -vvv

# Deploy to Base Sepolia
forge script script/Deploy.s.sol --rpc-url base_sepolia --broadcast --verify
```

---

## Deployment

### Docker

```bash
docker compose up -d
```

Starts PostgreSQL, Redis, and the API server. Dashboard available via `pnpm --filter=@prooflink/dashboard build && pnpm --filter=@prooflink/dashboard start`.

### Kubernetes

```bash
kubectl apply -k k8s/base/
```

Production overlay with resource limits and autoscaling:

```bash
kubectl apply -k k8s/overlays/production/
```

---

## Testing

```bash
# All tests
pnpm test

# Unit tests only
pnpm --filter=@prooflink/core test
pnpm --filter=@prooflink/api test

# E2E tests
pnpm --filter=@prooflink/api test:e2e

# Smart contract tests
cd packages/contracts && forge test -vvv

# Type checking
pnpm typecheck

# Lint
pnpm lint
```

---

## Configuration

Key environment variables (see [`.env.example`](.env.example) for the full list):

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `REDIS_URL` | Yes | Redis connection string |
| `PORT` | Yes | API server port (default: `3001`) |
| `NODE_ENV` | Yes | `development` / `staging` / `production` |
| `API_KEY_SECRET` | Yes | Secret for signing API keys |
| `JWT_SECRET` | Yes | JWT signing secret |
| `PROOFLINK_API_KEY` | No | Self-auth API key |
| `CHAINALYSIS_API_KEY` | No | Chainalysis sanctions API key |
| `BASE_RPC_URL` | No | Base RPC endpoint |
| `ETHEREUM_RPC_URL` | No | Ethereum RPC endpoint |
| `EAS_CONTRACT_ADDRESS` | No | EAS contract (default: Base native) |
| `CORS_ORIGIN` | No | Allowed CORS origins (comma-separated) |
| `RATE_LIMIT_MAX` | No | Max requests per window (default: `100`) |
| `LOG_LEVEL` | No | `debug` / `info` / `warn` / `error` |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | No | OpenTelemetry OTLP endpoint |

---

## Supported Protocols

| Protocol | Creator | Integration | Status |
|----------|---------|-------------|--------|
| **x402** | Coinbase | Middleware hooks (`onBeforeVerify`, `onBeforeSettle`, `onAfterSettle`) | Full |
| **MCP** | Open standard | 11-tool compliance server | Full |
| **MPP** | Stripe | Session compliance via API | Adapter |
| **AP2** | Visa | Pre-authorization compliance gate | Adapter |
| **ACP** | Crossmint | Transaction-level screening | Adapter |
| **A2A** | Google | Protocol discovery endpoint | Discovery |

---

## Contributing

See [`CONTRIBUTING.md`](CONTRIBUTING.md) for guidelines.

**Quick rules:** branch naming (`feature/`, `fix/`), conventional commits, strict TypeScript, `pnpm test` must pass.

## License

[MIT](LICENSE) -- Copyright (c) 2025 ProofLink

---

<p align="center">
  <a href="docs/api-reference.md">API Reference</a> ·
  <a href="docs/sdk-reference.md">SDK</a> ·
  <a href="docs/mcp-integration.md">MCP</a> ·
  <a href="docs/x402-integration.md">x402</a> ·
  <a href="docs/kya-guide.md">KYA Guide</a> ·
  <a href="docs/architecture.md">Architecture</a>
</p>
