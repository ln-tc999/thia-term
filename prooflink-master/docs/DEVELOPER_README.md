# ProofLink Developer Guide

Compliance-as-infrastructure for stablecoin and AI agent payments -- neutral middleware that makes every payment protocol legal, auditable, and enterprise-safe.

---

## Architecture

```
prooflink/
├── packages/
│   ├── shared/                  @prooflink/shared         Shared types, constants, errors, utilities
│   ├── core/                    @prooflink/core           ProofLink compliance decision engine
│   ├── x402-compliance/         @prooflink/x402-compliance  x402 protocol compliance middleware
│   ├── mcp-server/              @prooflink/mcp-server     MCP compliance server for AI agents
│   ├── sdk/                     @prooflink/sdk            TypeScript client SDK
│   ├── contracts/               @prooflink/contracts      Solidity smart contracts (Foundry)
│   └── integrations/
│       └── request-finance/     @prooflink/request-finance  Request Network integration
│
├── apps/
│   ├── api/                     @prooflink/api            Hono REST API server (port 3001)
│   ├── dashboard/               @prooflink/dashboard      Next.js 15 admin dashboard (port 3100)
│   └── demo/                    @prooflink/demo           Terminal-based hackathon demo
│
├── tests/
│   ├── unit/                    Per-package unit tests (vitest)
│   ├── integration/             Cross-package integration tests
│   └── e2e/                     End-to-end scenario tests
│
├── docs/                        API reference, integration guides
├── docker-compose.yml           Postgres 16 + Redis 7 + API + Dashboard
├── turbo.json                   Turborepo task pipeline
├── biome.json                   Linter and formatter config
└── tsconfig.base.json           Shared TypeScript config (ES2022, strict)
```

### Dependency Graph

```
@prooflink/shared
    |
    +---> @prooflink/core
    |         |
    |         +---> @prooflink/x402-compliance
    |         +---> @prooflink/api
    |         +---> @prooflink/demo
    |
    +---> @prooflink/sdk
    +---> @prooflink/mcp-server
    +---> @prooflink/request-finance
    +---> @prooflink/api
    +---> @prooflink/demo

@prooflink/contracts  (standalone -- Foundry/Solidity)
```

---

## Packages

### `@prooflink/shared`

Shared types, Zod schemas, constants, error classes, and utility functions consumed by every other package.

- **Exports:** `.`, `./types`, `./constants`, `./errors`, `./utils`
- **Key deps:** `zod`

### `@prooflink/core`

ProofLink compliance decision engine. Sanctions screening, AML checks, Travel Rule validation, and compliance receipt generation.

- **Key deps:** `@prooflink/shared`, `viem`, `zod`

### `@prooflink/x402-compliance`

Compliance middleware for the x402 HTTP 402 payment protocol. Intercepts payment requests, runs compliance checks, attests results, and forwards compliant payments.

- **License:** Apache-2.0
- **Exports:** `.`, `./hooks`, `./types`
- **Key deps:** `@prooflink/core`, `@prooflink/shared`

### `@prooflink/mcp-server`

Model Context Protocol compliance server. Exposes sanctions screening, KYA (Know Your Agent), Travel Rule, and compliant payment tools as MCP tool calls for AI agents.

- **Binary:** `prooflink-mcp`
- **Exports:** `.`, `./server`
- **Key deps:** `@prooflink/shared`, `@modelcontextprotocol/sdk`

### `@prooflink/sdk`

TypeScript client SDK for the ProofLink compliance REST API. Lightweight wrapper with full type coverage.

- **Key deps:** `@prooflink/shared`

### `@prooflink/request-finance`

Request Network / Request Finance compliance integration. Wraps Request Network invoice flows with ProofLink compliance checks.

- **Key deps:** `@prooflink/shared`, `zod`

### `@prooflink/contracts` (Smart Contracts)

Solidity contracts built with Foundry. Targets Solidity 0.8.25 with via-IR optimization.

| Contract | Purpose |
|---|---|
| `ProofLinkRegistry.sol` | On-chain compliance receipt registry |
| `ProofLinkKYA.sol` | Know Your Agent identity attestations |
| `AgentInvoice.sol` | Autonomous agent invoice management |
| `ProofLinkFacilitator.sol` | x402 compliant payment facilitator |

- **Chains:** Base (mainnet + Sepolia), Ethereum (mainnet + Sepolia)
- **Dependencies:** OpenZeppelin Contracts, OpenZeppelin Contracts Upgradeable

---

## Apps

### API Server (`@prooflink/api`)

Hono-based REST API on port 3001. Drizzle ORM with Postgres. Serves as the primary backend for compliance operations.

- **Stack:** Hono, Drizzle ORM, pg, Zod validation
- **Dev command:** `tsx watch src/index.ts`
- **DB migrations:** `pnpm --filter=@prooflink/api db:migrate`

### Dashboard (`@prooflink/dashboard`)

Next.js 15 admin dashboard on port 3100. React 19, Radix UI components, TanStack Query, Recharts, Tailwind CSS.

### Demo (`@prooflink/demo`)

Terminal-based hackathon demo with interactive compliance scenarios. Chalk, Ora spinners, CLI tables.

- **Modes:** `--sanctions`, `--payment`, `--full`

---

## Quick Start

### Prerequisites

- **Node.js** >= 22.0.0
- **pnpm** 9.15.0 (auto-activated via `corepack enable`)
- **Docker** and **Docker Compose** (for Postgres and Redis)
- **Foundry** (for smart contracts only -- `curl -L https://foundry.paradigm.xyz | bash`)

### Install Dependencies

```bash
corepack enable
pnpm install
```

### Set Up Environment Variables

```bash
cp .env.example .env
# Edit .env with your values:
#   DATABASE_URL     - Postgres connection string
#   REDIS_URL        - Redis connection string
#   CHAINALYSIS_API_KEY - Optional, free tier works without
#   BASE_RPC_URL     - Base chain RPC
#   ETHEREUM_RPC_URL - Ethereum RPC
```

### Start Infrastructure

```bash
docker compose up -d postgres redis
```

### Run the API Server

```bash
# Run DB migrations first
pnpm --filter=@prooflink/api db:migrate

# Start in dev mode (hot reload)
pnpm --filter=@prooflink/api dev
# -> http://localhost:3001
```

### Run the Dashboard

```bash
pnpm --filter=@prooflink/dashboard dev
# -> http://localhost:3100
```

### Run the Demo

```bash
# Full demo
pnpm --filter=@prooflink/demo dev

# Specific scenarios
pnpm --filter=@prooflink/demo demo:sanctions
pnpm --filter=@prooflink/demo demo:payment
pnpm --filter=@prooflink/demo demo:full
```

### Run Tests

```bash
# All tests across all packages
pnpm test

# Specific package
pnpm --filter=@prooflink/core test

# Smart contract tests
cd packages/contracts && forge test -vvv

# Integration tests
pnpm --filter=integration test

# Watch mode (API example)
pnpm --filter=@prooflink/api test:watch
```

---

## Development

### Turborepo Pipeline

All top-level scripts are orchestrated by Turborepo:

| Command | Description |
|---|---|
| `pnpm build` | Build all packages (respects dependency order) |
| `pnpm dev` | Start all dev servers in parallel |
| `pnpm test` | Run all tests (builds first) |
| `pnpm lint` | Lint all packages with Biome |
| `pnpm typecheck` | Type-check all packages |
| `pnpm clean` | Remove all `dist/` directories |

### Adding a New Package

1. Create directory under `packages/` (or `packages/integrations/` for integrations).
2. Add a `package.json` with name `@prooflink/<name>`, `"type": "module"`.
3. Extend `tsconfig.base.json`:
   ```json
   {
     "extends": "../../tsconfig.base.json",
     "compilerOptions": { "outDir": "dist", "rootDir": "src" },
     "include": ["src"]
   }
   ```
4. The `pnpm-workspace.yaml` already globs `packages/*` and `packages/integrations/*` -- no changes needed.
5. Add workspace dependency references: `"@prooflink/shared": "workspace:*"`.

### Running Specific Tests

```bash
# Single test file
pnpm --filter=@prooflink/core exec vitest run src/prooflink.test.ts

# With pattern matching
pnpm --filter=@prooflink/core exec vitest run -t "sanctions"

# Contract tests with gas report
cd packages/contracts && forge test -vvv --gas-report
```

### Building for Production

```bash
# Build everything
pnpm build

# Build a specific package and its dependencies
pnpm build --filter=@prooflink/api...

# Start API in production mode
cd apps/api && node dist/index.js
```

### Linting and Formatting

```bash
# Lint
pnpm lint

# Format (Biome)
npx @biomejs/biome format --write .

# Contract formatting
cd packages/contracts && forge fmt
```

### Docker Usage

```bash
# Full stack (Postgres + Redis + API + Dashboard)
docker compose up -d

# Infrastructure only
docker compose up -d postgres redis

# Rebuild after code changes
docker compose up -d --build api

# View logs
docker compose logs -f api
```

The Dockerfile uses a 3-stage build (deps -> builder -> production) with a non-root `prooflink` user. Production image is `node:22-alpine` with `dumb-init`.

### Smart Contracts

```bash
cd packages/contracts

# Build
forge build

# Test
forge test -vvv

# Gas snapshot
forge snapshot

# Deploy to Base Sepolia
forge script script/Deploy.s.sol --rpc-url base_sepolia --broadcast --verify

# Format
forge fmt
```

---

## API Documentation

Detailed API and integration guides are in the `docs/` directory:

- [API Reference](api-reference.md) -- REST endpoint documentation
- [Quick Start](quickstart.md) -- Getting started with the SDK and API
- [SDK Reference](sdk-reference.md) -- ProofLinkClient methods, types, error handling
- [x402 Integration](x402-integration.md) -- x402 middleware setup
- [MCP Integration](mcp-integration.md) -- MCP server configuration for AI agents
- [KYA Guide](kya-guide.md) -- Know Your Agent identity framework
- [Compliance Concepts](compliance-concepts.md) -- ProofLink, sanctions, AML, Travel Rule
- [Architecture Guide](architecture.md) -- System design, package dependencies, data flow
- [Request Finance Integration](request-finance-integration.md) -- Request Network setup

---

## Deployment

### Docker Production

```bash
docker compose up -d
```

Services:
- **postgres** -- PostgreSQL 16 Alpine with health checks
- **redis** -- Redis 7 Alpine with health checks
- **api** -- ProofLink API on port 3001 (waits for healthy postgres + redis)
- **dashboard** -- Next.js dashboard on port 3100 (depends on api)

The API container includes a health check at `GET /health`.

### CI/CD

The monorepo uses Turborepo for incremental builds. Recommended CI pipeline:

```yaml
steps:
  - pnpm install --frozen-lockfile
  - pnpm lint
  - pnpm typecheck
  - pnpm test
  - pnpm build
  # Contract CI (separate job)
  - cd packages/contracts && forge test --profile ci  # 256 fuzz runs
```

### Environment Variables (Production)

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `REDIS_URL` | Yes | Redis connection string |
| `CHAINALYSIS_API_KEY` | No | Sanctions screening API key |
| `PROOFLINK_API_KEY` | No | Self-authentication key |
| `BASE_RPC_URL` | Yes | Base chain RPC endpoint |
| `ETHEREUM_RPC_URL` | Yes | Ethereum RPC endpoint |
| `EAS_CONTRACT_ADDRESS` | No | EAS contract (defaults to Base mainnet) |
| `PROOFLINK_REGISTRY_ADDRESS` | No | Deployed ProofLink registry address |

---

## Contributing

1. **Branch naming:** `feature/`, `fix/`, `refactor/`, `docs/` prefixes.
2. **Commits:** Conventional commits -- `type(scope): description` (e.g., `feat(core): add travel rule validation`).
3. **Type safety:** Strict TypeScript everywhere. No `any` without justification.
4. **Testing:** Add tests for new functionality. Run `pnpm test` before pushing.
5. **Linting:** `pnpm lint` must pass. Biome handles formatting and linting.
6. **One logical change per commit.** Do not mix features with refactors.
7. **Contract changes:** Run `forge fmt --check` and `forge test -vvv` before submitting.
