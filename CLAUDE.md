# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Thia-Term is a compliance-first payment infrastructure platform for AI agents, built for the Terminal 3 Agent Dev Kit (ADK) Bounty Challenge. It provides invoicing, payment links, payroll, and autonomous AI agent payments using **Terminal 3 TEE enclaves** (Intel TDX) for confidential execution and credential management.

**Tech Stack:** Next.js 15 (App Router), TypeScript, Prisma, PostgreSQL, Terminal 3 T3N SDK, shadcn/ui, Tailwind CSS

**Live Deployment:** https://thia-term.vercel.app

---

## Development Commands

```bash
# Install dependencies (uses pnpm)
pnpm install

# Development server
pnpm dev              # → http://localhost:3000

# Build
pnpm build            # Runs prisma generate + next build

# Type checking
pnpm typecheck        # tsc --noEmit

# Linting
pnpm lint             # next lint
```

### Database Commands

```bash
# Generate Prisma Client (required after schema changes)
npx prisma generate

# Create new migration
npx prisma migrate dev --name <migration_name>

# Apply migrations in production
npx prisma migrate deploy

# Open Prisma Studio
npx prisma studio

# Reset database (development only)
npx prisma migrate reset
```

**Important:** Always run `prisma generate` after pulling schema changes or changing `prisma/schema.prisma`.

---

## Architecture Overview

### Terminal 3 (T3N) Integration

This is the **core differentiator** of Thia-Term. All sensitive operations run inside TEE enclaves.

**Key T3N Components:**

1. **DID System (`did:t3n`)** — Every user and agent gets a cryptographic identity
2. **TEE Contracts** — WASM components (`wasm32-wasip2`) run in Intel TDX enclaves
   - `vendor-contracts`: Vendor verification and payment execution
   - `credential-contracts`: Cross-tenant credential verification
   - `agent-contracts`: Agent-to-agent payments (optional)
3. **KV Store** — Encrypted key-value storage: `z:<tenant_id>:<namespace>`
4. **Cross-Tenant Calls** — `executeBusinessContract()` for inter-tenant verification

**T3N Client Initialization Pattern:**

```typescript
// lib/t3n-client.ts provides singleton instances
import { getT3nClient, getTenantClient } from '@/lib/t3n-client'

// Get T3N client (handles WASM loading, handshake)
const t3n = await getT3nClient()

// Get authenticated tenant client (has DID)
const { tenant, did } = await getTenantClient()

// Execute contract
const result = await t3n.executeAndDecode({
  script_name: `z:${tenantId}:vendor-contracts`,
  script_version: scriptVersion,
  function_name: 'verify-vendor',
  input: { ... }
})
```

**Critical:** T3N clients are singletons. Never instantiate multiple `T3nClient` instances — always use `getT3nClient()`.

### Vendor Verification Flow

**Location:** `lib/vendor-verify.ts`

Two-step process:
1. **Credential Verification** — Cross-tenant call to supplier's `credential-contracts`
2. **Vendor Verification** — Execute `verify-vendor` in buyer's TEE contract with supplier's proof

```typescript
// Step 1: Cross-tenant credential fetch (may fail gracefully)
const supplierProof = await tenant.executeBusinessContract(t3n, {
  tenant: supplierDid,
  contract: 'credential-contracts',
  functionName: 'prove-credential',
  input: { buyerDID: tenantDid }
})

// Step 2: Execute verification in buyer's TEE
const result = await t3n.executeAndDecode({
  script_name: `z:${tenantId}:vendor-contracts`,
  function_name: 'verify-vendor',
  input: {
    supplierDid,
    supplierStatus: supplierProof?.status ?? null,
    supplierSignature: supplierProof?.didSignature ?? null,
    ...
  }
})
```

### Agent Wallet System

**Location:** `lib/agent-wallet.ts`

Uses **BIP-32 deterministic derivation** (no viem/wagmi) for agent wallets:

```typescript
// Derive agent wallet from DEPLOYER_MNEMONIC
const { privateKey, address } = deriveAgentWallet(agentIndex)
// Path: m/44'/60'/0'/0/<agentIndex>
```

**Payment Execution:**
- Agent payments route through T3N TEE contracts
- Falls back: `agent-contracts` → `vendor-contracts`
- T3N handles gas internally — no manual funding needed

**Dependencies:** `@scure/bip32`, `@scure/bip39`, `@noble/curves`, `@noble/hashes`

### Compliance Pipeline

**Location:** `lib/compliance.ts`

Every payment runs through:
1. **OFAC Sanctions Check** — `api.ofac.dev` + hardcoded sanctions list
2. **Velocity Check** — 24h volume limit ($50,000 USD)
3. **Compliance Score** — 0-100 scale (< 60 blocks payment)

**Usage:**

```typescript
const result = await runComplianceCheck(address)
// { kycOk, sanctionsOk, complianceScore, detail? }

const canPay = canProcessPayment(result, requireKYC, checkSanctions)
```

**Note:** OFAC check has 5s timeout and fails open (non-blocking on network errors).

### Database Schema Patterns

**Key Models:**

- **User** — Has `t3nDid`, `walletAddress`, `encryptedMnemonic`, `encryptedPrivateKey`
- **Agent** — Autonomous agents with `t3nDid`, `walletAddress`, `capabilities` (JSON)
- **Payment** — All payment records, linked to `User`, `Agent`, or `PaymentLink`
- **Invoice** — Supports both H2H and H2A invoicing
- **AuditLog** — All actions logged with metadata

**Wallet Encryption:** Managed wallets use AES-256-GCM encryption (`lib/wallet-crypto.ts`). Key stored in `WALLET_ENCRYPTION_KEY` env var.

---

## File Structure & Key Locations

```
app/
  api/                    # API routes
    agents/               # Agent management + payments
    invoices/             # Invoice CRUD
    payment-links/        # Payment link CRUD
    vendor-verify/        # T3N vendor verification
    vendor-pay/           # T3N vendor payment
    compliance/preflight/ # Pre-payment compliance check
    t3n-usage/            # T3N usage stats
  dashboard/              # Main dashboard
  invoices/               # Invoice management UI
  links/                  # Payment links UI
  l/[code]/               # Public payment link page
  pay/invoice/[id]/       # Public invoice payment page

lib/
  t3n-client.ts           # T3N SDK singleton clients
  vendor-verify.ts        # Vendor verification + payment via T3N
  agent-wallet.ts         # BIP-32 wallet derivation + T3N payments
  compliance.ts           # OFAC + velocity checks
  wallet-crypto.ts        # AES-256-GCM encryption for wallets
  auth-config.ts          # NextAuth configuration
  agent-engine.ts         # Claude-powered AI agents
  audit.ts                # Audit logging utilities

components/
  ui/                     # shadcn/ui primitives
  landing/                # Landing page sections
  dashboard-layout.tsx    # Dashboard shell + sidebar
  vendors-module.tsx      # Vendor verification UI
  agent-payment-widget.tsx # Agent payment UI

prisma/
  schema.prisma           # Database schema
```

---

## Environment Variables

**Required for T3N:**
- `T3N_API_KEY` — Terminal 3 API key (Ethereum private key format)
- `T3N_ENVIRONMENT` — `testnet` or `production`
- `T3N_DID` — Your tenant DID (format: `did:t3n:<hex>`)

**Required for Core:**
- `DATABASE_URL` — Neon pooled PostgreSQL connection
- `DIRECT_URL` — Neon direct connection (for migrations)
- `NEXTAUTH_SECRET` — NextAuth encryption secret
- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` — Google OAuth
- `DEPLOYER_MNEMONIC` — BIP-39 mnemonic for agent wallet derivation
- `WALLET_ENCRYPTION_KEY` — 64-char hex string for AES-256-GCM

**Optional (AI Features):**
- `NVIDIA_API_KEY` — NVIDIA API Catalog (primary, has FREE tier at build.nvidia.com)
- `MOONSHOT_API_KEY` — Moonshot AI (secondary AI provider)
- `ANTHROPIC_API_KEY` — Claude (tertiary fallback AI provider)

**See `.env.example` for full list.**

---

## Important Development Patterns

### 1. T3N Contract Execution

Always fetch latest script version before execution:

```typescript
const scriptName = `z:${tenantId}:vendor-contracts`
const scriptVersion = await getScriptVersion(getNodeUrl(), scriptName)

const result = await t3n.executeAndDecode({
  script_name: scriptName,
  script_version: scriptVersion,
  function_name: 'process-payment',
  input: { ... }
})
```

### 2. Tenant ID Extraction

T3N DIDs have format `did:t3n:<hex>`. Extract tenant ID:

```typescript
function extractTid(did: string): string {
  return did.slice('did:t3n:'.length)
}
```

### 3. Agent Wallet Indexing

Agents are indexed sequentially from 0:

```typescript
// First agent → index 0 → m/44'/60'/0'/0/0
// Second agent → index 1 → m/44'/60'/0'/0/1
const wallet = deriveAgentWallet(agentIndex)
```

**Note:** Agent index is NOT stored in DB — derived from agent creation order.

### 4. Error Handling with T3N

T3N calls may fail due to:
- Missing WASM contract deployment
- Network timeout
- Insufficient credits
- Invalid input format

Always wrap T3N calls in try-catch and provide fallback:

```typescript
try {
  const result = await t3n.executeAndDecode(...)
  return { success: true, data: result }
} catch (err) {
  console.error('T3N execution failed:', err)
  return { success: false, error: err.message }
}
```

### 5. NextAuth Session Management

Session includes user data + wallet info:

```typescript
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth-config'

const session = await getServerSession(authOptions)
if (!session?.user?.id) {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
}
```

---

## Testing & Debugging

**No test suite currently implemented** — testing done manually via:
- Development server (`pnpm dev`)
- Prisma Studio for database inspection
- Browser DevTools for frontend
- T3N testnet for TEE contract testing

**T3N Debugging:**
- Check T3N usage: `GET /api/t3n-usage`
- View T3N logs at: https://www.terminal3.io/usage
- Testnet sandbox: 20,000 test tokens

**Common Issues:**

1. **"WASM component not loaded"** — T3N client not initialized. Always use `getT3nClient()`.
2. **"Script not found"** — Contract not deployed to T3N. Deploy WASM contracts first.
3. **Prisma Client errors** — Run `npx prisma generate` after schema changes.

---

## Key Differences from Standard Next.js Apps

1. **T3N SDK Requires Server-Only Execution** — `@terminal3/t3n-sdk` is marked as `serverExternalPackages` in Next.js config. Never import in client components.

2. **No Web3 Wallet Connection** — Agent wallets are server-side BIP-32 derivations. No MetaMask/WalletConnect integration.

3. **Confidential Execution Model** — Payment logic runs in TEE, not directly in Next.js. API routes coordinate, contracts execute.

4. **Cross-Tenant Communication** — Uses T3N's `executeBusinessContract()` for inter-tenant calls (unique to T3N).

5. **Encrypted Storage** — Mnemonics/keys never stored in plaintext. Always use `lib/wallet-crypto.ts` for encryption.

---

## Security Considerations

- **Never log T3N_API_KEY or DEPLOYER_MNEMONIC**
- **Never return private keys in API responses**
- **Always encrypt before storing credentials** (use `lib/wallet-crypto.ts`)
- **Validate all inputs before T3N execution** (contract calls are irreversible)
- **Check compliance before processing payments** (runComplianceCheck)
- **Use DIRECT_URL for migrations only** (not for queries — causes connection pooling issues)

---

## Deployment Notes

**Platform:** Vercel (optimized for Next.js 15)

**Build Configuration:**
- TypeScript errors ignored in build (`ignoreBuildErrors: true`)
- ESLint errors ignored in build (`ignoreDuringBuilds: true`)
- Prisma Client auto-generated during build

**Environment:**
- Set all env vars in Vercel dashboard
- Use Neon PostgreSQL (supports connection pooling)
- T3N testnet for staging, production for prod

**Migrations:**
- Run `npx prisma migrate deploy` in build command
- Or use `npm run build` (includes `prisma generate`)

---

## Design System

**Brand Color:** Sky Blue (`#0ea5e9` / `sky-500`)

The UI uses a **dark-first design** with sky blue as the primary brand color:

- **Primary:** `sky-500` (#0ea5e9) — buttons, links, highlights
- **Hover:** `sky-600` (#0284c7) — hover states
- **Soft backgrounds:** `sky-500/10` with `sky-400` text
- **Gradients:** `from-sky-600 to-sky-500`
- **Utility classes:** `.btn-sky`, `.badge-sky`, `.bg-brand-gradient`

**Font:** DM Sans (sans-serif) + Geist Mono (monospace)

**Key Utilities:**
- `.bg-glass` — Glassmorphism background with backdrop blur
- `.card-surface` — Standard card with subtle border
- `.field-glass` — Glass-style input field with sky focus border
- `.icon-well` — Icon container with sky gradient background

---

## Additional Resources

- **Terminal 3 Docs:** https://docs.terminal3.io
- **T3N SDK:** https://www.npmjs.com/package/@terminal3/t3n-sdk
- **Project README:** See `README.md` for detailed feature overview
- **Implementation Plan:** See `docs/T3-IMPLEMENTATION-PLAN.md` for T3N integration details
