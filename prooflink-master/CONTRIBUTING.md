# Contributing to ProofLink

## Prerequisites

- Node.js >= 22
- pnpm >= 9 (`corepack enable && corepack prepare pnpm@9.15.0 --activate`)
- Foundry (for smart contract development)
- Docker & Docker Compose (for integration tests)

## Setup

```bash
git clone https://github.com/Flow-Link/prooflink.git
cd prooflink
pnpm install
pnpm build
```

## Development Workflow

### Branching

Create a branch from `main` using the convention:

- `feature/<name>` — New features
- `fix/<name>` — Bug fixes
- `refactor/<name>` — Code restructuring
- `docs/<name>` — Documentation changes

### Common Commands

```bash
pnpm build        # Build all packages (topological order via Turbo)
pnpm dev          # Start dev servers
pnpm test         # Run all tests
pnpm lint         # Lint with Biome
pnpm typecheck    # TypeScript type checking
pnpm clean        # Remove all build artifacts
```

Filter by package:

```bash
pnpm --filter=@prooflink/core build
pnpm --filter=@prooflink/sdk test
```

### Commit Convention

Use [Conventional Commits](https://www.conventionalcommits.org/):

```
feat(core): add sanctions screening provider
fix(sdk): handle timeout in payment verification
refactor(api): extract middleware into separate module
test(contracts): add compliance receipt edge cases
docs(readme): update setup instructions
```

## Testing

### Unit Tests

```bash
pnpm test                              # All packages
pnpm --filter=@prooflink/core test      # Single package
```

### Contract Tests

```bash
cd packages/contracts
forge test -vvv
```

### Integration Tests

Require Postgres and Redis:

```bash
docker compose up -d postgres redis
pnpm --filter=@prooflink/api test
```

## Code Style

- **Linter/Formatter**: Biome (see `biome.json`)
- **TypeScript**: Strict mode everywhere, no `any`
- **Indentation**: Tabs
- **Quotes**: Single quotes
- **Semicolons**: Always
- **Line width**: 100 characters

Run `pnpm lint` before committing. CI rejects PRs that fail lint.

## Package Structure

```
packages/
  shared/           — Shared types, constants, and utilities
  core/             — ProofLink compliance decision engine
  sdk/              — TypeScript client SDK
  x402-compliance/  — x402 protocol compliance middleware
  mcp-server/       — MCP server for AI agent integration
  contracts/        — Solidity smart contracts (Foundry)
  integrations/     — External service integrations
apps/
  api/              — HTTP API server
  dashboard/        — Web dashboard (Next.js)
  demo/             — Demo application
```

## Pull Request Guidelines

1. One logical change per PR
2. Ensure all CI checks pass (lint, typecheck, tests, build)
3. Fill out the PR template
4. Flag compliance impact if your change touches payment or identity flows
5. Request review from maintainers

### Compliance-Sensitive Areas

Changes to these require extra review:

- `packages/core/src/compliance/` — Compliance engine rules
- `packages/x402-compliance/` — x402 payment protocol
- `packages/contracts/src/` — Smart contracts
- Any code handling PII, wallet addresses, or transaction data

When modifying compliance code, document the regulatory requirement and add comprehensive test coverage.

## Security

Report vulnerabilities via email to security@prooflink.dev. Do **not** open a public issue.
