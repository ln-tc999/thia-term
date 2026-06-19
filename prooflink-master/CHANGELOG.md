# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/), and this project adheres to [Semantic Versioning](https://semver.org/).

## [0.1.0] — 2026-03-21

Initial release of ProofLink — compliance-as-infrastructure for stablecoin and AI agent payments.

### Added

- **@prooflink/shared** — Shared types, constants, and utilities across all packages
- **@prooflink/core** — ProofLink compliance decision engine (sanctions screening, KYC, AML)
- **@prooflink/sdk** — TypeScript client SDK for the ProofLink compliance API
- **@prooflink/x402-compliance** — Compliance middleware for x402 payment protocol (sanctions, AML, Travel Rule, ProofLink receipts, rate limiting, multi-chain)
- **@prooflink/mcp-server** — MCP compliance server for AI agent integration (sanctions screening, KYA, travel rule, compliant payments)
- **@prooflink/contracts** — Solidity smart contracts for compliance receipts, KYA, invoices, and x402 facilitator (Foundry)
- **@prooflink/integrations** — Optional external service integrations for compliance infrastructure
- **apps/api** — HTTP API server
- **apps/dashboard** — Web dashboard (Next.js)
- **apps/demo** — Demo application
- Monorepo setup with pnpm workspaces and Turborepo
- Biome for linting and formatting
- Docker Compose for local development (Postgres, Redis)
