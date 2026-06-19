# ProofLink Agent Team Configuration

## Parallel Agent Dispatch Protocol

When working on any task in this repository, spawn up to 8 relevant agents in parallel based on the personas defined in `.claude/team/personas/`. Each agent should be given the context from its persona file and assigned work relevant to its expertise.

## Agent Personas

### 1. Compliance & AML Architect
- **File**: `.claude/team/personas/01-compliance-architect.md`
- **Owns Gaps**: 1 (AML screening), 3 (cross-protocol compliance), 6 (KYA standard), 17 (SAR/CTR), 18 (sanctions list)
- **Trigger**: Any work touching sanctions, AML, Travel Rule, KYC, compliance checks, or regulatory reporting

### 2. Smart Contract & Solidity Engineer
- **File**: `.claude/team/personas/02-smart-contract-engineer.md`
- **Owns Gaps**: 4 (atomicity), 5 (disputes), 9 (spend enforcement), 20 (streaming payments)
- **Trigger**: Any work touching smart contracts, ERC-8004, ERC-8183, escrow, on-chain enforcement

### 3. Cryptography & ZK Engineer
- **File**: `.claude/team/personas/03-cryptography-zk-engineer.md`
- **Owns Gaps**: 15 (ProofLink privacy), 22 (KYA selective disclosure), 12 (prompt injection crypto defense)
- **Trigger**: Any work touching ZK proofs, privacy, selective disclosure, TEE, key management

### 4. Protocol & Standards Engineer
- **File**: `.claude/team/personas/04-protocol-standards-engineer.md`
- **Owns Gaps**: 3 (cross-protocol), 13 (permissions), 19 (discovery), 16 (saga orchestrator)
- **Trigger**: Any work touching x402, AP2, MCP, A2A integration, protocol abstraction

### 5. Security & Threat Researcher
- **File**: `.claude/team/personas/05-security-researcher.md`
- **Owns Gaps**: 7 (oracle manipulation), 8 (HMAC fix), 12 (prompt injection), 25 (collusion)
- **Trigger**: Any work touching security, auth, MEV, key management, vulnerability assessment

### 6. Full-Stack TypeScript Engineer
- **File**: `.claude/team/personas/06-fullstack-typescript-engineer.md`
- **Owns Gaps**: 2 (audit log), 10 (risk scoring), 23 (OTel)
- **Trigger**: Any work touching API routes, dashboard, MCP server, testing, database schema

### 7. Blockchain & Multi-Chain Engineer
- **File**: `.claude/team/personas/07-blockchain-multichain-engineer.md`
- **Owns Gaps**: 21 (cross-chain policy), 20 (streaming), 24 (volume)
- **Trigger**: Any work touching cross-chain, Solana, bridges, L2 optimization, multi-chain wallets

### 8. DevOps & Observability Engineer
- **File**: `.claude/team/personas/08-devops-observability-engineer.md`
- **Owns Gaps**: 11 (distributed tracing), 23 (OTel)
- **Trigger**: Any work touching monitoring, tracing, CI/CD, deployment, observability

### 9. Product & Economics Strategist
- **File**: `.claude/team/personas/09-product-economics-strategist.md`
- **Owns Gaps**: 14 (arbitration), 24 (x402 volume), 25 (collusion)
- **Trigger**: Any work touching pricing, billing, tokenomics, market strategy, competitive analysis

### 10. Legal & Regulatory Advisor
- **File**: `.claude/team/personas/10-legal-regulatory-advisor.md`
- **Owns Gaps**: 1 (AML), 6 (KYA), 17 (SAR/CTR), 25 (collusion)
- **Trigger**: Any work touching regulation, legal structure, compliance requirements, liability

## Dispatch Rules

1. **Always read MASTER_GAP_LIST.md** before starting work — it contains the prioritized roadmap
2. **Match task to personas** — select 3-8 personas whose expertise is most relevant
3. **Spawn agents in parallel** — use the Agent tool with each persona's context
4. **Include persona file as context** — read the persona file and pass its content to the agent
5. **Coordinate results** — synthesize outputs from all agents before presenting to user

## Research Corpus Location
Raw research data from 25 agents (6.5MB+): `/tmp/claude-1000/-home-akash-PROJECTS-prooflink/*/tasks/`
