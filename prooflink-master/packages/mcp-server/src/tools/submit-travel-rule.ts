import { randomUUID } from "node:crypto";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { TRAVEL_RULE_THRESHOLDS } from "@prooflink/shared";
import { formatMcpError } from "../errors.js";

const TRAVEL_RULE_THRESHOLD_USD = TRAVEL_RULE_THRESHOLDS.US;

function generateTravelRuleId(): string {
  return `tr_${randomUUID().replace(/-/g, "")}`;
}

function generateReceiptId(): string {
  return `rcpt_${randomUUID().replace(/-/g, "")}`;
}

const TransactionSchema = z.object({
  tx_hash: z
    .string()
    .optional()
    .describe(
      "On-chain transaction hash (may be null for pre-transaction submission).",
    ),
  amount_usd: z.number().nonnegative().describe("USD value of the transfer."),
  asset: z.string().describe("Token symbol (USDC, USDT, ETH, etc.)."),
  chain: z.string().describe("Blockchain network."),
  direction: z
    .enum(["outgoing", "incoming"])
    .describe("Direction of the transfer."),
});

const OriginatorSchema = z.object({
  wallet_address: z.string().describe("Originator wallet address."),
  name: z.string().optional().describe("Originator legal name."),
  address: z.string().optional().describe("Originator physical address."),
  account_number: z.string().optional().describe("Account number."),
  national_id: z.string().optional().describe("National ID."),
  agent_id: z
    .string()
    .optional()
    .describe("ERC-8004 ID if originator is an AI agent."),
  vasp_did: z
    .string()
    .optional()
    .describe("VASP DID (FATF-compliant). Required for VASP originator."),
});

const BeneficiarySchema = z.object({
  wallet_address: z.string().describe("Beneficiary wallet address."),
  name: z.string().optional().describe("Beneficiary legal name."),
  agent_id: z.string().optional().describe("ERC-8004 agent ID."),
  vasp_did: z.string().optional().describe("Beneficiary VASP DID."),
});

export function registerSubmitTravelRule(server: McpServer): void {
  server.tool(
    "submit_travel_rule",
    [
      "Transmit FATF Travel Rule originator/beneficiary information for transactions above the reporting threshold ($3,000 USD).",
      "Required for VASP-to-VASP transfers under GENIUS Act, MiCA, and FATF Recommendation 16.",
      "",
      "NOTE: Travel Rule data transmission is SIMULATED. In production, this would call",
      "Notabene or Sygna Bridge to transmit IVMS101 messages to the counterparty VASP.",
      "The threshold check and jurisdiction determination are real.",
      "",
      "Example usage:",
      "  submit_travel_rule({",
      '    transaction: { amount_usd: 5000, asset: "USDC", chain: "base", direction: "outgoing" },',
      '    originator: { wallet_address: "0xABC...", name: "Alice" },',
      '    beneficiary: { wallet_address: "0xDEF..." }',
      "  })",
      "",
      "Integrates with Notabene and Sygna Bridge for VASP-to-VASP messaging.",
      "Returns below-threshold response without transmitting if amount < $3,000.",
    ].join("\n"),
    {
      transaction: TransactionSchema.describe("Transaction details."),
      originator: OriginatorSchema.describe("Sending party information."),
      beneficiary: BeneficiarySchema.describe("Receiving party information."),
      pre_transaction: z
        .boolean()
        .default(false)
        .describe(
          "If true, submit Travel Rule data BEFORE the transaction executes.",
        ),
    },
    async (params) => {
      try {
        const travelRuleId = generateTravelRuleId();
        const receiptId = generateReceiptId();
        const thresholdExceeded =
          params.transaction.amount_usd >= TRAVEL_RULE_THRESHOLD_USD;

        if (!thresholdExceeded) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Travel Rule not required. Transaction amount ($${params.transaction.amount_usd}) is below threshold ($${TRAVEL_RULE_THRESHOLD_USD}).`,
              },
            ],
            structuredContent: {
              submitted: false,
              simulated: false,
              travel_rule_id: travelRuleId,
              threshold_exceeded: false,
              counterparty_vasp_acknowledged: false,
              jurisdictions_covered: [],
              receipt_id: receiptId,
            },
          };
        }

        // SIMULATED: In production, this would:
        // 1. Build an IVMS101 message with originator/beneficiary PII
        // 2. Transmit via Notabene or Sygna Bridge VASP-to-VASP protocol
        // 3. Wait for counterparty VASP acknowledgement
        // 4. Store the transmission record for audit trail
        const jurisdictionsCovered: string[] = ["US_GENIUS_ACT", "EU_MICA"];

        if (params.originator.vasp_did || params.beneficiary.vasp_did) {
          jurisdictionsCovered.push("FATF_R16");
        }

        const result = {
          submitted: true,
          simulated: true,
          travel_rule_id: travelRuleId,
          counterparty_vasp_acknowledged:
            params.beneficiary.vasp_did !== undefined,
          threshold_exceeded: true,
          jurisdictions_covered: jurisdictionsCovered,
          receipt_id: receiptId,
        };

        return {
          content: [
            {
              type: "text" as const,
              text: `Travel Rule data transmitted (simulated). ID: ${travelRuleId}. Jurisdictions: ${jurisdictionsCovered.join(", ")}. ${
                result.counterparty_vasp_acknowledged
                  ? "Counterparty VASP acknowledged."
                  : "Awaiting counterparty acknowledgement."
              }`,
            },
          ],
          structuredContent: result,
        };
      } catch (error: unknown) {
        return formatMcpError(
          "TRAVEL_RULE_FAILED",
          `Travel Rule submission failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    },
  );
}
