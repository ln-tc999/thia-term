# MCP Integration Guide

ProofLink ships an MCP (Model Context Protocol) server that gives AI agents six compliance tools for sanctions screening, identity verification, invoicing, Travel Rule submission, compliant payments, and receipt retrieval.

## What is MCP?

[Model Context Protocol](https://modelcontextprotocol.io/) is an open standard for connecting AI models to external tools and data. MCP servers expose tools that AI agents (Claude, GPT, LangChain, custom agents) can discover and invoke through a standard interface.

ProofLink's MCP server (`@prooflink/mcp-server`) makes compliance an ambient tool call -- agents can screen addresses, verify counterparties, and execute compliant payments without any compliance code in your application.

## Install

```bash
npm install -g @prooflink/mcp-server
```

Or run directly:

```bash
PROOFLINK_API_KEY=fl_live_xxx npx @prooflink/mcp-server
```

---

## Setting Up the MCP Server

### Claude Desktop

Add to `~/.claude/claude_desktop_config.json`:

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

Restart Claude Desktop. The six compliance tools appear in Claude's tool list.

### Claude Code

Add to your project's `.mcp.json`:

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

### LangChain / Custom MCP Client

```ts
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const transport = new StdioClientTransport({
  command: "npx",
  args: ["@prooflink/mcp-server"],
  env: { PROOFLINK_API_KEY: "fl_live_your_api_key" },
});

const client = new Client({ name: "my-agent", version: "1.0.0" });
await client.connect(transport);

// List available tools
const tools = await client.listTools();
console.log(tools.tools.map((t) => t.name));
// ["check_sanctions", "verify_kya", "create_compliant_invoice", ...]

// Call a tool
const result = await client.callTool({
  name: "check_sanctions",
  arguments: {
    address: "0x742d35Cc6634C0532925a3b844Bc9e7595f2bD68",
    chain: "base",
  },
});
```

### OpenAI / GPT Integration

Use the MCP client SDK to bridge ProofLink tools into GPT function calling:

```ts
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import OpenAI from "openai";

// Connect to ProofLink MCP server
const transport = new StdioClientTransport({
  command: "npx",
  args: ["@prooflink/mcp-server"],
  env: { PROOFLINK_API_KEY: process.env.PROOFLINK_API_KEY! },
});
const mcpClient = new Client({ name: "gpt-agent", version: "1.0.0" });
await mcpClient.connect(transport);

// Convert MCP tools to OpenAI function definitions
const mcpTools = await mcpClient.listTools();
const openaiTools = mcpTools.tools.map((tool) => ({
  type: "function" as const,
  function: {
    name: tool.name,
    description: tool.description,
    parameters: tool.inputSchema,
  },
}));

// Use with GPT
const openai = new OpenAI();
const response = await openai.chat.completions.create({
  model: "gpt-4o",
  messages: [{ role: "user", content: "Screen 0xBob on Base for sanctions" }],
  tools: openaiTools,
});

// Execute tool calls
for (const toolCall of response.choices[0].message.tool_calls ?? []) {
  const result = await mcpClient.callTool({
    name: toolCall.function.name,
    arguments: JSON.parse(toolCall.function.arguments),
  });
  console.log(result);
}
```

---

## Available Tools

### `check_sanctions`

Screen a blockchain address or entity name against OFAC SDN, EU Consolidated, UN Consolidated, and HMT sanctions lists.

**Parameters:**

| Name               | Type    | Required | Description                                    |
|-------------------|---------|----------|------------------------------------------------|
| `address`         | string  | *        | Wallet address to screen                       |
| `entityName`      | string  | *        | Legal name to screen                           |
| `chain`           | enum    | with address | `ethereum`, `base`, `solana`, `polygon`, `arbitrum` |
| `includeIndirect` | boolean | no       | Screen addresses one hop away. Default: `false` |

*At least one of `address` or `entityName` is required.

**Returns:**

```json
{
  "cleared": true,
  "riskScore": 2,
  "matches": [],
  "listsChecked": ["OFAC_SDN", "EU_CONSOLIDATED", "UN_CONSOLIDATED", "HMT"],
  "screenedAt": "2026-03-21T12:00:00.000Z",
  "receiptId": "rcpt_abc123"
}
```

---

### `verify_kya`

Verify an AI agent's identity, authorization, and compliance standing via ERC-8004 registry.

**Parameters:**

| Name                   | Type    | Required | Description                            |
|-----------------------|---------|----------|----------------------------------------|
| `agentId`             | string  | yes      | ERC-8004 agent identifier              |
| `agentWallet`         | string  | no       | Wallet address for cross-verification  |
| `operatorDid`         | string  | no       | DID of the operating human/org         |
| `checkSpendingLimits` | boolean | no       | Return spending limits. Default: `true`|

**Returns:**

```json
{
  "verified": true,
  "trustScore": 85,
  "agentMetadata": {
    "name": "DataProcessor",
    "type": "autonomous",
    "operator": "DataCo Inc",
    "registeredAt": "2026-01-15T10:00:00.000Z",
    "x402Support": true
  },
  "operatorStatus": {
    "sanctionsCleared": true,
    "kycVerified": true
  },
  "spendingLimits": {
    "perTransactionUsd": 10000,
    "dailyUsd": 50000,
    "allowedChains": ["base", "ethereum"],
    "allowedCurrencies": ["USDC", "USDT"]
  },
  "receiptId": "rcpt_def456"
}
```

---

### `create_compliant_invoice`

Generate a machine-readable, compliance-stamped invoice for agent-to-agent services.

**Parameters:**

| Name               | Type    | Required | Description                                          |
|-------------------|---------|----------|------------------------------------------------------|
| `seller`          | object  | yes      | `{ wallet_address, agent_id?, legal_name?, tax_id? }` |
| `buyer`           | object  | yes      | `{ wallet_address, agent_id?, legal_name?, tax_id? }` |
| `line_items`      | array   | yes      | `{ description, quantity, unit_price_usd, service_category? }` |
| `currency`        | enum    | no       | `USDC`, `USDT`, `USD`, `EUR`, `GBP`. Default: `USDC`|
| `payment_protocol`| enum    | no       | `x402`, `mpp`, `ap2`, `acp`, `direct`               |
| `work_proof`      | string  | no       | URI or hash proving service delivery                 |
| `due_date`        | string  | no       | ISO-8601 due date                                    |
| `anchor_on_chain` | boolean | no       | Anchor hash via EAS. Default: `true`                 |

---

### `submit_travel_rule`

Transmit FATF Travel Rule originator/beneficiary data for transactions above the threshold.

**Parameters:**

| Name              | Type    | Required | Description                                          |
|------------------|---------|----------|------------------------------------------------------|
| `transaction`    | object  | yes      | `{ tx_hash?, amount_usd, asset, chain, direction }`  |
| `originator`     | object  | yes      | `{ wallet_address, name?, address?, agent_id?, vasp_did? }` |
| `beneficiary`    | object  | yes      | `{ wallet_address, name?, agent_id?, vasp_did? }`    |
| `pre_transaction`| boolean | no       | Submit before execution. Default: `false`            |

**Returns:**

```json
{
  "submitted": true,
  "travelRuleId": "tr_xyz789",
  "thresholdExceeded": true,
  "counterpartyVaspAcknowledged": true,
  "jurisdictionsCovered": ["US", "EU"],
  "receiptId": "rcpt_ghi012"
}
```

---

### `pay_with_compliance`

End-to-end compliant stablecoin payment. Automatically runs sanctions screening, KYA verification, Travel Rule submission, payment execution, and receipt generation.

**Parameters:**

| Name               | Type    | Required | Description                                  |
|-------------------|---------|----------|----------------------------------------------|
| `recipient`       | object  | yes      | `{ wallet_address, agent_id?, legal_name? }` |
| `amount`          | object  | yes      | `{ value, currency }` (`USDC` or `USDT`)     |
| `chain`           | enum    | no       | `base`, `ethereum`, `solana`, `polygon`. Default: `base` |
| `payment_protocol`| enum    | no       | `x402` or `direct`. Default: `x402`         |
| `memo`            | string  | no       | Payment memo (max 256 chars)                 |
| `invoice_id`      | string  | no       | Link to a ProofLink invoice                   |
| `require_kya`     | boolean | no       | Block if recipient has no KYA. Default: `false` |
| `dry_run`         | boolean | no       | Run checks without executing. Default: `false` |

**Returns:**

```json
{
  "status": "COMPLETED",
  "txHash": "0xa1b2c3...",
  "complianceSummary": {
    "sanctionsCleared": true,
    "kyaVerified": true,
    "travelRuleSubmitted": true,
    "travelRuleRequired": true
  },
  "receiptId": "rcpt_jkl345",
  "easAttestationUid": "0xattest..."
}
```

---

### `get_compliance_receipt`

Retrieve a cryptographically signed compliance proof for audit trails.

**Parameters:**

| Name                   | Type    | Required | Description                              |
|-----------------------|---------|----------|------------------------------------------|
| `txHash`              | string  | *        | Transaction hash                         |
| `receiptId`           | string  | *        | ProofLink receipt ID                      |
| `includeRawEvidence`  | boolean | no       | Include raw provider responses. Default: `false` |

*At least one of `txHash` or `receiptId` is required.

---

## Configuration

### Environment Variables

| Variable           | Required | Description                 |
|-------------------|----------|-----------------------------|
| `PROOFLINK_API_KEY` | yes      | ProofLink API key            |
| `PROOFLINK_BASE_URL`| no       | Override API base URL        |
| `LOG_LEVEL`        | no       | Log verbosity (`debug`, `info`, `warn`, `error`) |

### Programmatic Usage

Use the MCP server programmatically in your own application:

```ts
import { createProofLinkMCPServer } from "@prooflink/mcp-server";

const handle = await createProofLinkMCPServer();
await handle.start();

// Server is now running on stdio transport
// Connect an MCP client to interact with it

process.on("SIGTERM", async () => {
  await handle.close();
});
```

---

## Example Conversations

### Screening before payment

> **User:** Pay 5,000 USDC to 0xBob on Base for the data analysis job.
>
> **Agent:** I'll check compliance first.
>
> *[calls `check_sanctions` with address=0xBob, chain=base]*
>
> The address is clear -- risk score 2/100, no sanctions matches. Proceeding with payment.
>
> *[calls `pay_with_compliance` with recipient.wallet_address=0xBob, amount.value=5000, amount.currency=USDC]*
>
> Payment completed. 5,000 USDC sent to 0xBob on Base.
> - Tx: `0xa1b2c3...`
> - All compliance checks passed
> - Receipt: `rcpt_abc123`

### Agent-to-agent invoice

> **User:** Create an invoice from my agent (did:prooflink:agent:my-bot, wallet 0xAlice) to 0xBob for 2 hours of GPU compute at $50/hr.
>
> *[calls `create_compliant_invoice` with seller/buyer/line_items]*
>
> Invoice `inv_xyz789` created:
> - Total: 100 USDC
> - Both parties sanctions-cleared
> - Content hash anchored on-chain via EAS

### Dry-run compliance check

> **User:** Can I send 50,000 USDC to 0xCharlie on Ethereum? Just check, don't send.
>
> *[calls `pay_with_compliance` with dry_run=true]*
>
> Dry run passed:
> - Sanctions: cleared
> - Travel Rule: would be submitted (above $1,000 threshold)
> - KYA: skipped (recipient is not a registered agent)

---

## Next Steps

- [Quick Start](./quickstart.md) -- direct SDK usage
- [x402 Integration](./x402-integration.md) -- middleware for x402 payment servers
- [API Reference](./api-reference.md) -- full REST API documentation
- [KYA Guide](./kya-guide.md) -- deep dive into agent identity
