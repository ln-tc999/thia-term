# ProofLink Production Blitz — 5-Hour Multi-Agent Orchestration Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Take ProofLink from a well-tested monorepo to a production-grade, deployed, open-source compliance platform — rebrand from ProofLink, fix all security issues, add missing infrastructure, harden everything, create a polished public presence, and ship it.

**Architecture:** Massively parallel agent orchestration across 8 workstreams, each with independent sub-tasks that can run concurrently. A coordinator session monitors progress, runs verification sweeps, and handles cross-stream dependencies.

**Tech Stack:** TypeScript (strict), Hono, PostgreSQL + Drizzle, Solidity 0.8.25 (Foundry), Next.js 15, Docker, GitHub Actions, Vitest

---

## Orchestration Architecture

```
COORDINATOR (this session)
  - Dispatches workstreams as parallel subagents
  - Monitors via ralph loop (every 10min)
  - Runs verification sweeps between phases
  - Handles cross-stream merge conflicts

     WS-0       WS-1       WS-2      WS-3      WS-4
    REBRAND   SECURITY    INFRA      API     FRONTEND

     WS-5       WS-6       WS-7
    TESTING   DOCS/README  DEPLOY
```

### Phase Schedule (5 hours)

| Phase | Time | Workstreams | What Happens |
|-------|------|-------------|--------------|
| **Phase 0** | 0:00-0:30 | WS-0 (Rebrand) | ProofLink to ProofLink rename across entire codebase |
| **Phase 1** | 0:30-2:00 | WS-1, WS-2, WS-3, WS-4 (parallel) | Security fixes, infra, API hardening, frontend polish |
| **Checkpoint 1** | 2:00-2:15 | Coordinator | Build + test verification, merge conflict resolution |
| **Phase 2** | 2:15-3:30 | WS-5, WS-6 (parallel) + continued WS-1-4 | Testing expansion, documentation + README |
| **Checkpoint 2** | 3:30-3:45 | Coordinator | Full test suite, security re-scan |
| **Phase 3** | 3:45-4:30 | WS-7 (Deploy) + WS-6 (README finalize) | Repo creation, push, CI verification |
| **Final** | 4:30-5:00 | Coordinator | Final verification, cleanup, ship |

---

## Workstream 0: Rebrand ProofLink to ProofLink

**Agent:** `executor` (model: sonnet)
**Priority:** BLOCKING — must complete before all other workstreams
**Estimated time:** 20-30 minutes
**Isolation:** worktree (to avoid blocking other work during rename)

### Task 0.1: Bulk Content Replacement

**Files:** ~1400 files across entire codebase (excluding node_modules, .git, dist, .turbo, .next, .claude/worktrees)

- [ ] **Step 1: Clean build artifacts**

```bash
rm -rf apps/dashboard/.next packages/contracts/out
```

- [ ] **Step 2: Bulk sed replacement in all source files**

```bash
find . -not -path '*/node_modules/*' -not -path '*/.git/*' -not -path '*/.turbo/*' \
  -not -path '*/dist/*' -not -path '*/.next/*' -not -path '*/.claude/worktrees/*' \
  -not -path '*/packages/contracts/out/*' -type f \
  \( -name '*.ts' -o -name '*.tsx' -o -name '*.js' -o -name '*.jsx' -o -name '*.json' \
  -o -name '*.md' -o -name '*.sol' -o -name '*.toml' -o -name '*.yaml' -o -name '*.yml' \
  -o -name '*.css' -o -name '*.html' -o -name '*.mjs' -o -name '*.cjs' -o -name '.env*' \
  -o -name '*.txt' \) \
  -exec sed -i 's/@prooflink\//@prooflink\//g; s/ProofLink/ProofLink/g; s/prooflink/prooflink/g; s/PROOFLINK/PROOFLINK/g' {} +
```

- [ ] **Step 3: Fix markdown-specific patterns**

```bash
find . -not -path '*/node_modules/*' -not -path '*/.git/*' -not -path '*/.turbo/*' \
  -not -path '*/.claude/worktrees/*' -type f -name '*.md' \
  -exec sed -i 's/prooflink/prooflink/g; s/prooflink/prooflink/g' {} +
```

- [ ] **Step 4: Fix GitHub URL references specifically**

Update clone URLs and repo references in docs to point to `github.com/Flow-Link/prooflink`.

### Task 0.2: Rename Solidity Files

**Files:**
- Rename: `packages/contracts/src/ProofLinkKYA.sol` to `ProofLinkKYA.sol`
- Rename: `packages/contracts/src/ProofLinkFacilitator.sol` to `ProofLinkFacilitator.sol`
- Rename: `packages/contracts/src/interfaces/IProofLinkKYA.sol` to `IProofLinkKYA.sol`
- Rename: `packages/contracts/src/interfaces/IProofLinkFacilitator.sol` to `IProofLinkFacilitator.sol`
- Rename: `packages/contracts/test/ProofLinkKYA.t.sol` to `ProofLinkKYA.t.sol`
- Rename: `packages/contracts/test/ProofLinkFacilitator.t.sol` to `ProofLinkFacilitator.t.sol`

- [ ] **Step 1: Rename all Solidity files**

```bash
mv packages/contracts/src/ProofLinkKYA.sol packages/contracts/src/ProofLinkKYA.sol
mv packages/contracts/src/ProofLinkFacilitator.sol packages/contracts/src/ProofLinkFacilitator.sol
mv packages/contracts/src/interfaces/IProofLinkKYA.sol packages/contracts/src/interfaces/IProofLinkKYA.sol
mv packages/contracts/src/interfaces/IProofLinkFacilitator.sol packages/contracts/src/interfaces/IProofLinkFacilitator.sol
mv packages/contracts/test/ProofLinkKYA.t.sol packages/contracts/test/ProofLinkKYA.t.sol
mv packages/contracts/test/ProofLinkFacilitator.t.sol packages/contracts/test/ProofLinkFacilitator.t.sol
```

- [ ] **Step 2: Verify no remaining old import paths in Solidity**

```bash
grep -r "ProofLink" packages/contracts/src/ packages/contracts/test/ 2>/dev/null
```

Expected: zero results.

### Task 0.3: Update Git Remote

- [ ] **Step 1: Update the git remote URL**

```bash
git remote set-url origin https://github.com/Flow-Link/prooflink.git
```

### Task 0.4: Verify Rename

- [ ] **Step 1: Grep for any remaining prooflink references**

```bash
grep -ri "prooflink" --include='*.ts' --include='*.tsx' --include='*.json' \
  --include='*.sol' --include='*.md' --include='*.toml' --include='*.yaml' \
  . 2>/dev/null | grep -v node_modules | grep -v .turbo | grep -v dist | \
  grep -v .git | grep -v '.claude/worktrees' | head -20
```

Expected: zero results (or only in lock files which are fine).

- [ ] **Step 2: Install dependencies (regenerate lockfile)**

```bash
pnpm install
```

- [ ] **Step 3: Build all packages**

```bash
pnpm build
```

Expected: all 11 packages build successfully.

- [ ] **Step 4: Run tests**

```bash
pnpm test
```

Expected: 1500+ tests pass.

- [ ] **Step 5: Commit the rebrand**

```bash
git add -A
git commit -m "chore: rebrand ProofLink to ProofLink across entire codebase

- Renamed all package scopes from @prooflink/* to @prooflink/*
- Renamed Solidity contracts and interfaces
- Updated all documentation, configs, and references
- Updated git remote to Flow-Link/prooflink"
```

---

## Workstream 1: Security Hardening

**Agent:** `executor` (model: opus) — security-critical work needs highest quality
**Priority:** HIGH
**Estimated time:** 90 minutes
**Dependencies:** WS-0 complete (works on renamed codebase)

### Task 1.1: Fix WebSocket Cross-Tenant Data Leak (CRITICAL)

**Files:**
- Modify: `apps/api/src/routes/ws.ts`
- Create: `apps/api/src/__tests__/ws.test.ts`

- [ ] **Step 1: Write failing test for tenant isolation**

```typescript
// apps/api/src/__tests__/ws.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { broadcastWsEvent, clients } from "../routes/ws";

describe("WebSocket tenant isolation", () => {
  beforeEach(() => {
    clients.clear();
  });

  it("should only send events to the matching tenant", () => {
    const sentToA: string[] = [];
    const sentToB: string[] = [];

    clients.set("a", {
      ws: { send: (msg: string) => sentToA.push(msg) } as any,
      apiKeyId: "tenant-a",
      subscriptions: new Set(["compliance.check.passed"]),
      lastPing: Date.now(),
    });
    clients.set("b", {
      ws: { send: (msg: string) => sentToB.push(msg) } as any,
      apiKeyId: "tenant-b",
      subscriptions: new Set(["compliance.check.passed"]),
      lastPing: Date.now(),
    });

    broadcastWsEvent({
      type: "compliance.check.passed",
      data: { checkId: "123" },
      apiKeyId: "tenant-a",
    });

    expect(sentToA).toHaveLength(1);
    expect(sentToB).toHaveLength(0);
  });

  it("should broadcast events with no apiKeyId to all subscribers", () => {
    const sentToA: string[] = [];
    const sentToB: string[] = [];

    clients.set("a", {
      ws: { send: (msg: string) => sentToA.push(msg) } as any,
      apiKeyId: "tenant-a",
      subscriptions: new Set(["system.health"]),
      lastPing: Date.now(),
    });
    clients.set("b", {
      ws: { send: (msg: string) => sentToB.push(msg) } as any,
      apiKeyId: "tenant-b",
      subscriptions: new Set(["system.health"]),
      lastPing: Date.now(),
    });

    broadcastWsEvent({ type: "system.health", data: {} });

    expect(sentToA).toHaveLength(1);
    expect(sentToB).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd apps/api && pnpm vitest run src/__tests__/ws.test.ts
```

Expected: FAIL

- [ ] **Step 3: Fix broadcastWsEvent to filter by tenant**

Update `WsEvent` interface to include optional `apiKeyId`. In `broadcastWsEvent`, strip `apiKeyId` from the payload before sending and skip clients that don't match:

```typescript
export function broadcastWsEvent(event: WsEvent): void {
  const { apiKeyId, ...eventPayload } = event;
  const payload = JSON.stringify(eventPayload);
  for (const client of clients.values()) {
    if (apiKeyId && client.apiKeyId !== apiKeyId) continue;
    if (client.subscriptions.size === 0 || client.subscriptions.has(event.type)) {
      client.ws.send(payload);
    }
  }
}
```

- [ ] **Step 4: Update all callers of broadcastWsEvent to pass apiKeyId**

Search all files calling `broadcastWsEvent` and add `apiKeyId: auth.apiKeyId` to the event object.

- [ ] **Step 5: Run test to verify it passes**
- [ ] **Step 6: Commit**

```bash
git commit -m "fix(security): add tenant isolation to WebSocket event broadcast

CRITICAL: Previously all tenants received all events regardless of ownership.
Now broadcastWsEvent filters events by apiKeyId, only sending tenant-scoped
events to the originating tenant. System events (no apiKeyId) still broadcast
to all subscribers."
```

### Task 1.2: Add Tenant Isolation to Identity Routes

**Files:**
- Modify: `apps/api/src/routes/identity.ts`
- Modify: `apps/api/src/__tests__/identity.test.ts`

- [ ] **Step 1: Write failing test for tenant-scoped agent listing**

Test that agents registered by tenant-a are invisible when queried by tenant-b.

- [ ] **Step 2: Run test to verify it fails**

- [ ] **Step 3: Add apiKeyId filtering to all identity route queries**

For every query that hits the `agents` table, add `.where(eq(agents.apiKeyId, auth.apiKeyId))`. For inserts, add `apiKeyId: auth.apiKeyId` to the values.

- [ ] **Step 4: Run test to verify it passes**
- [ ] **Step 5: Commit**

```bash
git commit -m "fix(security): add tenant isolation to identity routes

All identity endpoints now scope queries by apiKeyId, preventing
cross-tenant access to agent data, KYA credentials, and delegation scopes."
```

### Task 1.3: Add Tenant Isolation to Analytics and Dashboard Routes

**Files:**
- Modify: `apps/api/src/routes/analytics.ts`
- Modify: `apps/api/src/routes/dashboard.ts`

- [ ] **Step 1: Write failing tests for tenant-scoped analytics**
- [ ] **Step 2: Run tests to verify they fail**
- [ ] **Step 3: Add apiKeyId filtering to all analytics and dashboard queries**

Add `where(eq(complianceChecks.apiKeyId, auth.apiKeyId))` to all aggregation queries. Add auth middleware to dashboard routes.

- [ ] **Step 4: Run tests to verify they pass**
- [ ] **Step 5: Commit**

```bash
git commit -m "fix(security): add tenant isolation to analytics and dashboard routes"
```

### Task 1.4: Add Scope Enforcement to All Mutating Routes

**Files:**
- Modify: `apps/api/src/routes/compliance.ts`
- Modify: `apps/api/src/routes/invoices.ts`
- Modify: `apps/api/src/routes/identity.ts`
- Modify: `apps/api/src/routes/webhooks.ts`

- [ ] **Step 1: Write failing tests for scope enforcement**

For each route, test that a read-only API key gets 403 on mutating endpoints.

- [ ] **Step 2: Run tests to verify they fail**

- [ ] **Step 3: Add requireScope("write") to all POST/PATCH/DELETE handlers**

Apply `requireScope("write")` middleware to all mutating endpoints in compliance, invoices, identity, and webhooks routes.

- [ ] **Step 4: Run tests to verify they pass**
- [ ] **Step 5: Commit**

```bash
git commit -m "fix(security): enforce scope requirements on all mutating endpoints

Read-only API keys can no longer create compliance checks, invoices,
register agents, or manage webhooks. All POST/PATCH/DELETE endpoints
now require write scope minimum."
```

### Task 1.5: Implement Redis-Backed Rate Limiter

**Files:**
- Modify: `apps/api/src/middleware/rate-limit.ts`
- Create: `apps/api/src/__tests__/rate-limit.test.ts`

- [ ] **Step 1: Write tests for rate limiting behavior**

Test requests within limit succeed, requests exceeding limit return 429, different keys have independent limits.

- [ ] **Step 2: Implement RedisStore using sorted-set sliding window**

Replace the stub `RedisStore` with a real implementation using `ZREMRANGEBYSCORE`, `ZADD`, `ZCARD`, `PEXPIRE` in a pipeline.

- [ ] **Step 3: Update rate-limit middleware to use Redis when REDIS_URL is set**

```typescript
const store = process.env.REDIS_URL
  ? new RedisStore(process.env.REDIS_URL)
  : new MapStore();
```

- [ ] **Step 4: Run tests**
- [ ] **Step 5: Commit**

```bash
git commit -m "feat(security): implement Redis-backed rate limiter for multi-pod deployment

Replaces the stub RedisStore with a working sorted-set implementation.
Falls back to MapStore when REDIS_URL is not configured."
```

### Task 1.6: Fix JWT Validation Gaps

**Files:**
- Modify: `apps/api/src/middleware/auth.ts`
- Modify: `apps/api/src/__tests__/auth.test.ts`

- [ ] **Step 1: Write failing tests for iss/aud validation**
- [ ] **Step 2: Add iss/aud validation to JWT verifier**

After signature verification, check `payload.iss` against `JWT_ISSUER` env var (default "prooflink") and `payload.aud` against `JWT_AUDIENCE` env var (default "prooflink-api").

- [ ] **Step 3: Run tests**
- [ ] **Step 4: Commit**

```bash
git commit -m "fix(security): validate JWT issuer and audience claims"
```

### Task 1.7: Remove Default Database Password Fallback

**Files:**
- Modify: `apps/api/src/db/index.ts`

- [ ] **Step 1: Remove the hardcoded password fallback**

Change `password: process.env["DB_PASSWORD"] ?? "prooflink"` to `password: process.env["DB_PASSWORD"]`. The `DATABASE_URL` is already required at startup.

- [ ] **Step 2: Commit**

```bash
git commit -m "fix(security): remove hardcoded database password fallback"
```

---

## Workstream 2: Infrastructure and DevOps

**Agent:** `executor` (model: sonnet)
**Priority:** HIGH
**Estimated time:** 90 minutes
**Dependencies:** WS-0 complete

### Task 2.1: Create Kubernetes Manifests

**Files:**
- Create: `k8s/base/namespace.yaml`
- Create: `k8s/base/api-deployment.yaml`
- Create: `k8s/base/api-service.yaml`
- Create: `k8s/base/api-hpa.yaml`
- Create: `k8s/base/postgres-statefulset.yaml`
- Create: `k8s/base/redis-deployment.yaml`
- Create: `k8s/base/configmap.yaml`
- Create: `k8s/base/secrets.yaml`
- Create: `k8s/base/kustomization.yaml`
- Create: `k8s/overlays/staging/kustomization.yaml`
- Create: `k8s/overlays/production/kustomization.yaml`

- [ ] **Step 1: Create namespace**

```yaml
# k8s/base/namespace.yaml
apiVersion: v1
kind: Namespace
metadata:
  name: prooflink
  labels:
    app.kubernetes.io/name: prooflink
```

- [ ] **Step 2: Create API deployment with health probes, resource limits**

Deployment with 2 replicas, liveness/readiness probes on `/health/live` and `/health/ready`, resource requests (250m CPU, 256Mi RAM) and limits (1000m CPU, 512Mi RAM).

- [ ] **Step 3: Create Service and HPA**

ClusterIP service on port 80 targeting 3001. HPA scaling 2-10 replicas based on CPU (70%) and memory (80%).

- [ ] **Step 4: Create ConfigMap and Secrets templates**

ConfigMap for non-secret config (NODE_ENV, PORT, LOG_LEVEL, CORS_ORIGIN, JWT_ISSUER, JWT_AUDIENCE). Secret template with placeholder values for DATABASE_URL, REDIS_URL, API_KEY_SECRET, JWT_SECRET, CHAINALYSIS_API_KEY.

- [ ] **Step 5: Create PostgreSQL StatefulSet**

StatefulSet with PVC (10Gi), health check via `pg_isready`, resource limits.

- [ ] **Step 6: Create Redis deployment**

Deployment with `redis:7-alpine`, maxmemory 256mb, allkeys-lru eviction, ClusterIP service.

- [ ] **Step 7: Create Kustomize overlays for staging and production**

Staging: 1 replica. Production: 3 replicas + ingress.

- [ ] **Step 8: Commit**

```bash
git add k8s/
git commit -m "feat(infra): add Kubernetes manifests with Kustomize overlays

Includes API deployment, PostgreSQL StatefulSet, Redis, HPA,
ConfigMap/Secrets templates, and staging/production overlays."
```

### Task 2.2: Add Security Scanning to CI

**Files:**
- Create: `.github/workflows/security.yml`
- Modify: `.github/workflows/ci.yml`

- [ ] **Step 1: Create security scanning workflow**

Three jobs: CodeQL analysis (javascript-typescript), dependency audit (pnpm audit), secrets scan (trufflehog). Trigger on push to main, PRs, and weekly schedule.

- [ ] **Step 2: Add license compliance check to CI**

Add job using `license-checker --failOn "GPL-3.0;AGPL-3.0"`.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/
git commit -m "feat(ci): add security scanning — CodeQL, dependency audit, secrets scan"
```

### Task 2.3: Add Docker Resource Limits and Production Compose

**Files:**
- Modify: `docker-compose.yml`
- Create: `docker-compose.production.yml`

- [ ] **Step 1: Add resource limits and logging config to docker-compose.yml**

Add `deploy.resources` (limits: 2 CPU, 1G RAM) and `logging` (json-file, 10m max, 3 files) to each service.

- [ ] **Step 2: Create production compose override**

```yaml
# docker-compose.production.yml
services:
  api:
    restart: always
    environment:
      NODE_ENV: production
    deploy:
      replicas: 2
      resources:
        limits:
          cpus: "4.0"
          memory: 2G
  postgres:
    restart: always
    command: >
      postgres
      -c shared_buffers=256MB
      -c effective_cache_size=768MB
      -c max_connections=200
```

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(infra): add resource limits, logging, and production compose override"
```

### Task 2.4: Create Makefile for Developer Experience

**Files:**
- Create: `Makefile`

- [ ] **Step 1: Create comprehensive Makefile**

Targets: help, install, build, test, test-unit, test-e2e, lint, typecheck, clean, dev, docker-up, docker-down, docker-prod, db-migrate, db-seed, contracts-build, contracts-test, contracts-deploy.

- [ ] **Step 2: Commit**

```bash
git add Makefile
git commit -m "feat(dx): add Makefile for common development tasks"
```

### Task 2.5: Add Pre-commit Hooks

**Files:**
- Create: `.husky/pre-commit`
- Modify: `package.json`

- [ ] **Step 1: Install husky and lint-staged**

```bash
pnpm add -Dw husky lint-staged
npx husky init
```

- [ ] **Step 2: Configure pre-commit hook to run lint-staged**

lint-staged config: `*.{ts,tsx,js,jsx}` runs `biome check --write`, `*.sol` runs `forge fmt`.

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(dx): add pre-commit hooks with husky + lint-staged"
```

### Task 2.6: Update .env.example with All Required Variables

**Files:**
- Modify: `.env.example`

- [ ] **Step 1: Update .env.example with comprehensive documentation**

All variables grouped by category: Required, Auth, Redis, Compliance Providers, Blockchain, CORS, Rate Limiting, Logging. Each with description comments.

- [ ] **Step 2: Commit**

```bash
git commit -m "docs: update .env.example with all configuration variables"
```

---

## Workstream 3: API Hardening and Production Polish

**Agent:** `executor` (model: sonnet)
**Priority:** MEDIUM-HIGH
**Estimated time:** 60 minutes
**Dependencies:** WS-0 complete

### Task 3.1: Add OpenTelemetry Distributed Tracing

**Files:**
- Create: `apps/api/src/telemetry.ts`
- Modify: `apps/api/src/index.ts`
- Modify: `apps/api/package.json`

- [ ] **Step 1: Install OpenTelemetry dependencies**

```bash
cd apps/api && pnpm add @opentelemetry/api @opentelemetry/sdk-node \
  @opentelemetry/auto-instrumentations-node @opentelemetry/exporter-trace-otlp-http \
  @opentelemetry/exporter-metrics-otlp-http @opentelemetry/resources \
  @opentelemetry/semantic-conventions
```

- [ ] **Step 2: Create telemetry bootstrap module**

`apps/api/src/telemetry.ts`: Initialize NodeSDK with resource name "prooflink-api", OTLP trace exporter, OTLP metric exporter (30s interval), HTTP and PG auto-instrumentation. Only activates when `OTEL_EXPORTER_OTLP_ENDPOINT` is set.

- [ ] **Step 3: Import telemetry at the very top of index.ts**

Must be the first import to capture all downstream instrumentation. Add `await telemetrySdk?.shutdown()` to the shutdown handler.

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(observability): add OpenTelemetry distributed tracing and metrics

Auto-instruments HTTP and PostgreSQL. Exports to OTLP endpoint when
OTEL_EXPORTER_OTLP_ENDPOINT is configured. No-op when not configured."
```

### Task 3.2: Add Request Timeout Middleware

**Files:**
- Create: `apps/api/src/middleware/timeout.ts`
- Modify: `apps/api/src/app.ts`

- [ ] **Step 1: Create timeout middleware**

Hono middleware that aborts request processing after 30s (configurable). Returns 408 on timeout.

- [ ] **Step 2: Apply in app.ts after CORS, before routes**

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(api): add request timeout middleware (30s default)"
```

### Task 3.3: Add Graceful Shutdown for WebSocket Connections

**Files:**
- Modify: `apps/api/src/routes/ws.ts`
- Modify: `apps/api/src/index.ts`

- [ ] **Step 1: Add shutdownWebSockets function**

Iterate all clients, send close frame with code 1001 "Server shutting down", clear the clients map.

- [ ] **Step 2: Call shutdownWebSockets in the SIGTERM handler in index.ts**

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(api): graceful WebSocket shutdown on SIGTERM"
```

### Task 3.4: Add Request Body Size Limits

**Files:**
- Modify: `apps/api/src/app.ts`

- [ ] **Step 1: Add hono/body-limit middleware**

1MB limit, returns 413 with structured error on exceed.

- [ ] **Step 2: Commit**

```bash
git commit -m "feat(api): add 1MB request body size limit"
```

---

## Workstream 4: Frontend Production Polish

**Agent:** `designer` (model: sonnet) — specialized for UI work
**Priority:** MEDIUM
**Estimated time:** 60 minutes
**Dependencies:** WS-0 complete

### Task 4.1: Add Authentication Flow to Dashboard

**Files:**
- Create: `apps/dashboard/src/components/auth-gate.tsx`
- Modify: `apps/dashboard/src/app/layout.tsx`

- [ ] **Step 1: Create auth gate component**

Client component that checks localStorage for API key, validates against `/health/ready` endpoint, shows login form if not authenticated. Dark theme matching existing design.

- [ ] **Step 2: Wrap layout children with AuthGate**

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(dashboard): add API key authentication gate"
```

### Task 4.2: Add Logout Button

**Files:**
- Modify: sidebar/nav component

- [ ] **Step 1: Add disconnect button to sidebar**

Clear localStorage key and reload page.

- [ ] **Step 2: Commit**

```bash
git commit -m "feat(dashboard): add logout/disconnect button"
```

### Task 4.3: Replace Mock Data Fallbacks with Error States

**Files:**
- Modify: dashboard pages using mock data

- [ ] **Step 1: Audit and replace mock data patterns**

Replace `apiResponse ?? MOCK_DATA` patterns with proper error/empty state components.

- [ ] **Step 2: Commit**

```bash
git commit -m "fix(dashboard): replace mock data fallbacks with proper error states"
```

### Task 4.4: Add Loading Skeletons

**Files:**
- Create: `apps/dashboard/src/components/skeleton.tsx`

- [ ] **Step 1: Create reusable skeleton components**

StatCardSkeleton, TableSkeleton with configurable row count. Animate-pulse style.

- [ ] **Step 2: Apply to dashboard pages**

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(dashboard): add loading skeletons for better perceived performance"
```

---

## Workstream 5: Test Coverage Expansion

**Agent:** `test-writer` (model: sonnet)
**Priority:** MEDIUM
**Estimated time:** 60 minutes
**Dependencies:** WS-0 and WS-1 (security fixes) complete

### Task 5.1: Add Route Integration Tests for Escrow

**Files:**
- Create: `apps/api/src/__tests__/escrow.test.ts`

- [ ] **Step 1: Write comprehensive escrow route tests**

Happy path: create, fund, activate, complete.
Dispute path: create, fund, activate, dispute, resolve, close.
Tenant isolation: escrows from one tenant invisible to another.
State machine guards: can't fund already-funded escrow, can't complete unfunded.
Scope enforcement: read-only key can't create escrow.

- [ ] **Step 2: Run tests**
- [ ] **Step 3: Commit**

```bash
git commit -m "test(api): add route integration tests for escrow lifecycle"
```

### Task 5.2: Add Route Integration Tests for Disputes

**Files:**
- Create: `apps/api/src/__tests__/disputes.test.ts`

- [ ] **Step 1: Write dispute route tests**

Full lifecycle: open, submit evidence, escalate, resolve (admin), close.
Auth: only admin scope can resolve.
Tenant isolation.

- [ ] **Step 2: Run tests and commit**

```bash
git commit -m "test(api): add route integration tests for dispute lifecycle"
```

### Task 5.3: Add Route Integration Tests for Sagas

**Files:**
- Create: `apps/api/src/__tests__/sagas.test.ts`

- [ ] **Step 1: Write saga route tests**

Create, execute, completion tracking. Cancellation. Compensation on step failure.

- [ ] **Step 2: Run tests and commit**

```bash
git commit -m "test(api): add route integration tests for saga orchestration"
```

### Task 5.4: Add Route Integration Tests for Streams

**Files:**
- Create: `apps/api/src/__tests__/streams.test.ts`

- [ ] **Step 1: Write streaming payment tests**

Create, record usage, settle. Budget enforcement. Pause/resume.

- [ ] **Step 2: Run tests and commit**

```bash
git commit -m "test(api): add route integration tests for streaming payments"
```

### Task 5.5: Add Rate Limiting Tests

**Files:**
- Create: `apps/api/src/__tests__/rate-limit.test.ts`

- [ ] **Step 1: Write rate limit tests**

Requests within limit succeed. Exceeding limit returns 429 with Retry-After header. Different keys have independent limits. Rate limit headers present.

- [ ] **Step 2: Run tests and commit**

```bash
git commit -m "test(api): add rate limiting integration tests"
```

### Task 5.6: Add Error Scenario Tests

**Files:**
- Create: `apps/api/src/__tests__/error-handling.test.ts`

- [ ] **Step 1: Write error scenario tests**

Invalid JSON body returns 400. Missing required fields returns 400 with field errors. Invalid API key returns 401. Expired JWT returns 401. Insufficient scope returns 403. Non-existent resource returns 404. Rate limited returns 429.

- [ ] **Step 2: Run tests and commit**

```bash
git commit -m "test(api): add comprehensive error scenario tests"
```

---

## Workstream 6: Documentation and README

**Agent:** `writer` (model: sonnet)
**Priority:** HIGH (needed for public repo)
**Estimated time:** 60 minutes
**Dependencies:** WS-0 complete

### Task 6.1: Create Production README

**Files:**
- Rewrite: `README.md`

- [ ] **Step 1: Write the full README**

Structure:
1. Header with logo/title, tagline, badges (CI, license, TypeScript, tests)
2. Problem statement (6 protocols, zero compliance, regulation coming)
3. How it works — compliance pipeline diagram
4. Quick start (clone, install, docker, migrate, dev)
5. Architecture diagram (monorepo structure, tech stack table)
6. API reference with curl examples and response samples
7. SDK usage code example
8. MCP server integration (config JSON)
9. x402 middleware usage
10. Smart contracts table + build/test/deploy commands
11. Deployment section (Docker, Kubernetes)
12. Testing commands
13. Configuration table (key env vars)
14. Supported protocols table
15. Contributing link
16. License (MIT)

No mention of AI-generated code anywhere.

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: rewrite README for public launch"
```

### Task 6.2: Create Architecture Diagram

**Files:**
- Create: `docs/architecture-diagram.md`

- [ ] **Step 1: Create Mermaid diagram**

Show: AI Agents (x402, MCP, SDK) connecting to ProofLink Platform (Ingress, Compliance Engine, Business Logic, Data Layer) connecting to External Services (Chainalysis, Notabene, EAS).

- [ ] **Step 2: Commit**

```bash
git commit -m "docs: add architecture diagram"
```

### Task 6.3: Create LICENSE File

**Files:**
- Create: `LICENSE`

- [ ] **Step 1: Create MIT license file**

Copyright 2025 ProofLink.

- [ ] **Step 2: Commit**

```bash
git add LICENSE
git commit -m "docs: add MIT license"
```

---

## Workstream 7: Repository Creation and Deployment

**Agent:** `git-manager` + `executor`
**Priority:** HIGH (final step)
**Estimated time:** 30 minutes
**Dependencies:** ALL other workstreams complete

### Task 7.1: Create GitHub Repository

- [ ] **Step 1: Ensure on Akasxh account**

```bash
gh auth switch --user Akasxh
```

- [ ] **Step 2: Create the repo**

```bash
gh repo create Flow-Link/prooflink --private \
  --description "Compliance infrastructure for AI agent payments. Real-time sanctions screening, AML scoring, FATF Travel Rule, and cryptographic compliance receipts."
```

- [ ] **Step 3: Set topics**

```bash
gh repo edit Flow-Link/prooflink --add-topic compliance,stablecoin,ai-agents,sanctions-screening,travel-rule,aml,web3,defi,fintech,ethereum
```

### Task 7.2: Push and Protect

- [ ] **Step 1: Push all code**

```bash
git remote set-url origin https://github.com/Flow-Link/prooflink.git
git push -u origin master
```

- [ ] **Step 2: Enable branch protection**

Require status checks (lint, typecheck, test-unit, test-integration, build). Require 1 approving review.

### Task 7.3: Verify CI Passes

- [ ] **Step 1: Check CI status**

```bash
gh run list --repo Flow-Link/prooflink --limit 5
```

- [ ] **Step 2: Wait for CI and verify all green**

### Task 7.4: Create Initial Release

- [ ] **Step 1: Tag the release**

```bash
git tag -a v0.1.0 -m "Initial release — ProofLink compliance infrastructure"
git push origin v0.1.0
```

- [ ] **Step 2: Verify release workflow triggers**

---

## Agent Dispatch Matrix

| WS | Workstream | Agent Type | Model | Mode | Isolation | Runtime |
|----|-----------|------------|-------|------|-----------|---------|
| 0 | Rebrand | `executor` | sonnet | auto | worktree | 20 min |
| 1 | Security | `executor` | opus | auto | main | 90 min |
| 2 | Infrastructure | `executor` | sonnet | auto | worktree | 90 min |
| 3 | API Hardening | `executor` | sonnet | auto | worktree | 60 min |
| 4 | Frontend | `designer` | sonnet | auto | worktree | 60 min |
| 5 | Testing | `test-writer` | sonnet | auto | worktree | 60 min |
| 6 | Documentation | `writer` | sonnet | auto | worktree | 60 min |
| 7 | Deploy and Repo | `git-manager` | sonnet | auto | main | 30 min |

### Parallelism Map

```
Time 0:00                                                     5:00
  |                                                             |
  | [WS-0: REBRAND]---+                                        |
  |                    |                                        |
  |                    +--[WS-1: SECURITY]----------------+     |
  |                    +--[WS-2: INFRA]------------------+|     |
  |                    +--[WS-3: API]---------------+    ||     |
  |                    +--[WS-4: FRONTEND]-----+    |    ||     |
  |                    |                       |    |    ||     |
  |                    |  [CHECKPOINT 1]-------+----+----++     |
  |                    |                       |    |    ||     |
  |                    +--[WS-5: TESTING]------+    |    ||     |
  |                    +--[WS-6: DOCS]---------+    |    ||     |
  |                    |                       |    |    ||     |
  |                    |  [CHECKPOINT 2]-------+----+----++     |
  |                    |                       |    |    ||     |
  |                    +--[WS-7: DEPLOY]-------+----+----++     |
  |                                                             |
  |                      [FINAL VERIFICATION]                   |
```

### Coordinator Loop (Ralph)

The coordinator session runs a monitoring loop every 10 minutes:

At each check:
1. Read task list for completion status
2. If WS-0 is done: dispatch WS-1 through WS-4
3. If WS-1 through WS-4 are done: run checkpoint (build + test)
4. If checkpoint passes: dispatch WS-5 and WS-6
5. After all complete: dispatch WS-7

### Checkpoint Commands

```bash
# Checkpoint 1: Build + basic tests
pnpm build && pnpm test

# Checkpoint 2: Full test + security scan
pnpm build && pnpm test && pnpm lint && pnpm typecheck
```

---

## Success Criteria

At the end of 5 hours, ALL of these must be true:

- [ ] All references to "ProofLink" renamed to "ProofLink"
- [ ] Zero critical or high security vulnerabilities
- [ ] WebSocket tenant isolation working
- [ ] Identity/analytics/dashboard routes tenant-isolated
- [ ] Scope enforcement on all mutating endpoints
- [ ] Redis rate limiter implemented
- [ ] Kubernetes manifests created
- [ ] CI security scanning (CodeQL, dependency audit, secrets scan)
- [ ] Docker production compose with resource limits
- [ ] Makefile + pre-commit hooks
- [ ] OpenTelemetry tracing wired up
- [ ] Dashboard auth gate working
- [ ] Route integration tests for escrow, disputes, sagas, streams
- [ ] Error scenario tests comprehensive
- [ ] Rate limiting tests passing
- [ ] README rewritten for public launch
- [ ] LICENSE file present
- [ ] GitHub repo created at Flow-Link/prooflink
- [ ] All code pushed
- [ ] CI passing
- [ ] All 1557+ tests still passing
- [ ] Zero TypeScript errors
- [ ] Build succeeds for all packages
