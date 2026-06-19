# FlowLink — Execution Plan

## Blunt Landing Page Assessment
- Headline "Enterprise Crypto Payments, Built for Compliance" = generic AI output. Stripe wouldn't write this.
- SOC 2 / ISO 27001 / HashKey Certified badges in the hero mockup = aspirational lies. Remove.
- Stats bar "$2.4M+" and "99.7%" = fake numbers for a testnet product. Replace with capability truths.
- "97/100 compliance score" dashboard card = screams demo/AI. Replace.
- "Live Demo Mode" badge in dashboard = still there.
- How it works "⚡ 0.3s per check" decimal precision = nobody writes this naturally.

## Tasks

### Task 1 — Landing Page ✅
- [x] Rewrite hero headline → specific, honest, human
- [x] Remove SOC2/ISO badges from hero mockup
- [x] Replace fake stats with capability-based truths
- [x] Replace fake "97/100" compliance dashboard in security section
- [x] Fix "How it works" timing copy

### Task 2 — Wire Compliance Vaults to real DB ✅
- [x] Replace hardcoded vaults array with API fetch
- [x] Wire CreateVaultForm to POST /api/vaults
- [x] Remove "Live Demo Mode" from dashboard-overview
- [x] Remove fake PolicyAnalytics percentages (94%/100%/87%)
- [x] Remove fake TransactionHistory entries

### Task 3 — Wire Payroll to real DB ✅
- [x] Update payroll GET to include recipient count
- [x] Replace hardcoded payrollBatches with API fetch
- [x] Wire CreatePayrollBatchForm to POST /api/payroll
- [x] Remove hardcoded audit trail timestamps
- [x] Remove fake PayrollAnalytics (country breakdown + compliance bars)

### Task 4 — Other mock data cleanup ✅
- [x] payments-table.tsx: replace mockPayments with real API
- [x] hashkey-module.tsx: remove mock transactions, remove RWA Products, fix Testnet badge
- [x] dashboard-overview.tsx: real compliance score from API data
- [x] stats-cards.tsx: real stats from API
- [x] create-link-form.tsx: fix wrong API endpoint (/api/links → /api/payment-links)
- [x] lib/hashkey.ts: fix mainnet→testnet config, add stablecoins key, add hashkeyMainnet
- [x] hooks/use-api.ts: resolve git merge conflicts, remove RWA hooks
- [x] invoices page: fix auth (useAuthStore → useSession)
- [x] hooks/use-wallet.ts: remove dead useAuthStore import, fix chain names

### Task 5 — Build verification ✅
- [x] npm run build passes clean (17 routes, 0 errors)
- [x] dashboard/page.tsx: remove duplicate module rendering (overview only shows DashboardOverview)

## Remaining / Future Work
- Remove RWA subscription module entirely (removed from hashkey-module; full module file can stay for now)
- Production: add cloud AI API (Ollama is local-only)
- Production: add domain to Google Cloud Console redirect URIs
- Production: update NEXTAUTH_URL for Vercel
- Testing: Google OAuth login end-to-end
- Testing: SIWE wallet login end-to-end
- Testing: Full payment flow (requires HSK testnet gas from faucet)
