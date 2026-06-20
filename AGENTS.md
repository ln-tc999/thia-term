# Thia-Term — AGENTS.md

Single Next.js 14 App Router app. Package manager is **npm**.

## Quick commands

```sh
npm run dev         # next dev
npm run build       # prisma generate && next build
npm run typecheck   # tsc --noEmit
npm run lint        # next lint
```

No test framework configured.

## Setup

```sh
cp .env.example .env.local   # then fill in required values
npx prisma migrate dev       # create + apply migrations from schema changes
npm run dev
```

- `DATABASE_URL` (pooled, port 6543) + `DIRECT_URL` (direct, port 5432 for migrations) both required
- HSP credentials (`HSP_*`) are optional — app degrades gracefully
- `DEPLOYER_MNEMONIC` + `WALLET_ENCRYPTION_KEY` (64-char hex) required for managed wallet features
- AI provider priority: Moonshot → Anthropic → Ollama (local, no key needed)

## Architecture

- **Auth**: NextAuth.js JWT. 4 providers: Google OAuth, email/password (bcrypt), SIWE (wallet), Google One Tap
- **DB**: PostgreSQL via Prisma. Schema at `prisma/schema.prisma`
- **Blockchain**: HashKey Chain (mainnet ID 177). Viem + wagmi v2 + RainbowKit
- **HSP**: HMAC-SHA256 client in `lib/hsp-client.ts`. Webhook at `POST /api/webhooks/hsp`
- **AI agents**: Claude-powered. Wallets via BIP-32 from `DEPLOYER_MNEMONIC`. Engine in `lib/agent-engine.ts`
- **Managed wallets**: AES-256-GCM encrypted (`lib/wallet-crypto.ts`)
- **Rate limiting**: In-memory in `middleware.ts` — resets on restart
- **Compliance**: OFAC + velocity checks in `lib/compliance.ts`. 60s TTL cache

## Build quirks

- `next.config.js` sets `typescript.ignoreBuildErrors: true` and `eslint.ignoreDuringBuilds: true` — run `typecheck`/`lint` separately
- Webpack suppresses MetaMask SDK react-native peer dep warnings
- CSP headers: `img-src` allows `https:`

## Path conventions

- `@/*` maps to project root (e.g. `@/lib/prisma`, `@/components/ui`)
- shadcn/ui in `components/ui/`
- API routes under `app/api/`
- `prooflink-master/` is a separate standalone project

## Notes

- `.env*` files are gitignored
- `FlowLinkPayments.sol` deployed on HashKey mainnet at `0x5E0B5320F93C92032B2cEaBd05019D89cF9bddF7`; `ThiaTermPayments.sol` copy added
- `pnpm-workspace.yaml` + `turbo.json` + `docker-compose.yml` are stale — do not rely on them
- `CONTEXT.md` contains Terminal 3 ADK bounty reference
