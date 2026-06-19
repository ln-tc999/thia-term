import chalk from "chalk";
import oraImport from "ora";

import {
  prooflinkLog,
  agentLog,
  x402Log,
  statusCleared,
  statusBlocked,
  riskScore,
  travelRuleStatus,
  paymentApproved,
  paymentRejected,
  sectionHeader,
  stepHeader,
  timingDisplay,
  totalTiming,
  formatReceipt,
  formatInvoice,
  summaryBox,
  sleep,
  generateReceiptId,
  generateTxHash,
  generateEasUid,
  generateIpfsCid,
  generateSignature,
  truncateAddress,
  type ReceiptData,
  type InvoiceDisplay,
} from "../utils/display.js";

// ---------------------------------------------------------------------------
// Addresses
// ---------------------------------------------------------------------------

const SENDER_WALLET = "0xA1b2C3d4E5f6A7B8C9D0E1F2a3B4c5D6e7F8a9B0";
const SELLER_WALLET = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";
const SANCTIONED_ADDRESS = "0x905b63Fff465B9fFBF41DeA908CEb12df9d1c960";
const AGENT_ID = "erc8004:8453:0xRegistry:42";

// ---------------------------------------------------------------------------
// Full Demo — 3 minute hackathon flow
// ---------------------------------------------------------------------------

export async function runFullDemo(): Promise<void> {
  const ora = oraImport;
  const demoStart = Date.now();

  sectionHeader("PROOFLINK FULL DEMO");

  console.log(chalk.gray("  The complete compliance pipeline for agentic payments."));
  console.log(chalk.gray("  This demo covers: invoice creation, sanctions screening,"));
  console.log(chalk.gray("  KYA verification, AML scoring, payment settlement, and"));
  console.log(chalk.gray("  ProofLink receipt generation with on-chain attestation."));
  console.log();
  console.log(
    chalk.yellow.bold("  Scenario: ") +
      chalk.white("An AI agent needs to pay $45 USDC for 15,000 API inference calls."),
  );
  console.log();

  await sleep(500);

  // ═══════════════════════════════════════════════════════════════════════
  // ACT 1: BLOCKED PAYMENT (the "wow moment")
  // ═══════════════════════════════════════════════════════════════════════

  sectionHeader("ACT 1: THE BLOCK MOMENT");

  console.log(
    chalk.gray("  First, the agent attempts to pay a sanctioned address.\n"),
  );

  console.log(
    `  ${chalk.gray("$")} ${chalk.white("node agent-pay.js")} ${chalk.yellow(`--to ${SANCTIONED_ADDRESS}`)} ${chalk.white("--amount 50 --chain base")}`,
  );
  console.log();

  await sleep(400);

  prooflinkLog("Intercepting x402 payment...");
  await sleep(200);

  // Screen sender (cached)
  const spinnerS1 = ora({
    text: chalk.gray("Screening sender..."),
    color: "cyan",
    indent: 2,
  }).start();
  const senderLatency1 = 3;
  await sleep(150);
  spinnerS1.stop();
  statusCleared("sender", SENDER_WALLET, senderLatency1, true);

  // Screen receiver — BLOCKED
  const spinnerR1 = ora({
    text: chalk.gray("Screening receiver..."),
    color: "red",
    indent: 2,
  }).start();
  const blockedLatency = Math.floor(Math.random() * 20) + 80;
  await sleep(blockedLatency + 300);
  spinnerR1.stop();

  statusBlocked("receiver", SANCTIONED_ADDRESS, blockedLatency, {
    list: "OFAC_SDN",
    entity: "Tornado Cash Deployer",
    confidence: 0.99,
  });

  paymentRejected("SANCTIONS_HIT");

  const blockedReceiptId = generateReceiptId("pl");
  prooflinkLog(`ProofLink receipt: ${chalk.white(blockedReceiptId)}`);

  await sleep(300);
  agentLog(
    `Received 402 rejection with compliance reason. ${chalk.yellow("Selecting alternate payee...")}`,
  );

  console.log();
  console.log(
    `  ${chalk.red.bold("\u{1F6D1}")} ${chalk.white.bold(`Blocked in ${blockedLatency}ms.`)} ${chalk.gray("The agent received a structured rejection and can self-correct.")}`,
  );

  // Show blocked receipt
  const blockedReceipt: ReceiptData = {
    receiptId: blockedReceiptId,
    overallStatus: "BLOCKED",
    riskScore: 98,
    checks: [
      { checkType: "SANCTIONS_SCREENING", result: "PASSED", provider: "Chainalysis (sender)", latencyMs: senderLatency1 },
      { checkType: "SANCTIONS_SCREENING", result: "FAILED", provider: "Chainalysis (receiver)", latencyMs: blockedLatency },
    ],
    travelRuleStatus: "NOT_REQUIRED",
    signature: generateSignature(),
    timestamp: new Date().toISOString(),
  };
  formatReceipt(blockedReceipt);

  await sleep(1000);

  // ═══════════════════════════════════════════════════════════════════════
  // ACT 2: CLEAN PAYMENT (invoice → compliance → settlement → receipt)
  // ═══════════════════════════════════════════════════════════════════════

  sectionHeader("ACT 2: COMPLIANT PAYMENT FLOW");

  console.log(
    chalk.gray("  Now the agent pays a clean address with full compliance pipeline.\n"),
  );

  console.log(
    `  ${chalk.gray("$")} ${chalk.white("node agent-pay.js")} ${chalk.green(`--to ${truncateAddress(SELLER_WALLET)}`)} ${chalk.white("--amount 45 --chain base")}`,
  );
  console.log();

  await sleep(400);

  // ── Step 1: Create invoice ──────────────────────────────────────────────

  stepHeader("\u{1F4CB}", "Creating compliant invoice...");

  const spinnerInv = ora({
    text: chalk.gray("Generating JSON-LD invoice with compliance stamp..."),
    color: "cyan",
    indent: 2,
  }).start();
  await sleep(350);
  spinnerInv.succeed(chalk.gray("Invoice INV-2026-0042 created"));

  const invoice: InvoiceDisplay = {
    invoiceId: "INV-2026-0042",
    seller: `inference-agent-v3 (${truncateAddress(SELLER_WALLET)})`,
    buyer: `Acme Corp (${truncateAddress(SENDER_WALLET)})`,
    lineItems: [
      {
        description: "API inference calls — GPT-4 equivalent",
        quantity: 15000,
        unitPrice: 0.003,
        total: 45.0,
      },
    ],
    totalAmount: 45.0,
    currency: "USDC",
    chain: "Base",
    status: "ISSUED",
  };

  formatInvoice(invoice);

  await sleep(500);

  // ── Step 2: Compliance pipeline ─────────────────────────────────────────

  stepHeader("\u{1F50D}", "Running compliance pipeline...");

  prooflinkLog(`Invoice ${chalk.white("INV-2026-0042")} payment initiated`);
  await sleep(200);

  // Screen sender (cached)
  const spinnerS2 = ora({
    text: chalk.gray("Screening sender address..."),
    color: "cyan",
    indent: 2,
  }).start();
  const senderLatency2 = Math.floor(Math.random() * 5) + 2;
  await sleep(100);
  spinnerS2.stop();
  statusCleared("sender", SENDER_WALLET, senderLatency2, true);

  // Screen receiver
  const spinnerR2 = ora({
    text: chalk.gray("Screening receiver address..."),
    color: "cyan",
    indent: 2,
  }).start();
  const receiverLatency = Math.floor(Math.random() * 20) + 55;
  await sleep(receiverLatency + 100);
  spinnerR2.stop();
  statusCleared("receiver", SELLER_WALLET, receiverLatency);

  // AML
  const spinnerAml = ora({
    text: chalk.gray("Computing AML risk score..."),
    color: "cyan",
    indent: 2,
  }).start();
  const amlLatency = Math.floor(Math.random() * 10) + 18;
  await sleep(amlLatency + 80);
  spinnerAml.stop();
  riskScore(8, 85);

  // Travel Rule
  prooflinkLog(`Amount $45.00 below Travel Rule threshold ($3,000)`);
  travelRuleStatus(false, 45, 3000);

  // KYA
  const spinnerKya = ora({
    text: chalk.gray("Verifying agent identity (ERC-8004)..."),
    color: "cyan",
    indent: 2,
  }).start();
  const kyaLatency = Math.floor(Math.random() * 20) + 40;
  await sleep(kyaLatency + 100);
  spinnerKya.stop();

  prooflinkLog(`KYA verification: ${chalk.white(AGENT_ID)}`);
  prooflinkLog(`  Agent: ${chalk.white("inference-agent-v3")} | Type: ${chalk.white("semi-autonomous")}`);
  prooflinkLog(`  Operator: ${chalk.white("Acme Corp")} ${chalk.gray("(LEI verified, sanctions cleared)")}`);
  prooflinkLog(`  Trust score: ${chalk.green.bold("87/100")} | Spending: ${chalk.white("$150 < $10,000 limit")}`);
  prooflinkLog(`  KYA status: ${chalk.green.bold("VERIFIED")}`);

  await sleep(300);

  // ── Step 3: Settlement ──────────────────────────────────────────────────

  stepHeader("\u{1F4B0}", "Settling payment...");

  paymentApproved();

  const spinnerSettle = ora({
    text: chalk.gray("Submitting x402 payment on Base..."),
    color: "magenta",
    indent: 2,
  }).start();

  const txHash = generateTxHash();
  await sleep(800);
  spinnerSettle.stop();

  x402Log(`Transaction: ${chalk.white(txHash.slice(0, 10) + "..." + txHash.slice(-4))} (Base)`);

  // ── Step 4: Receipt + attestation ───────────────────────────────────────

  stepHeader("\u{1F9FE}", "Generating ProofLink receipt...");

  const receiptId = generateReceiptId("pl");
  const easUid = generateEasUid();
  const ipfsCid = generateIpfsCid();
  const signature = generateSignature();

  const spinnerReceipt = ora({
    text: chalk.gray("Anchoring compliance attestation on-chain via EAS..."),
    color: "green",
    indent: 2,
  }).start();
  await sleep(400);
  spinnerReceipt.stop();

  prooflinkLog(`ProofLink receipt: ${chalk.white(receiptId)}`);
  prooflinkLog(`Invoice ${chalk.white("INV-2026-0042")} marked ${chalk.green.bold("PAID")}`);
  prooflinkLog(`EAS attestation: ${chalk.white(easUid.slice(0, 10) + "..." + easUid.slice(-4))}`);
  prooflinkLog(`IPFS archive: ${chalk.white(ipfsCid.slice(0, 10) + "..." + ipfsCid.slice(-6))}`);
  prooflinkLog(`ERP webhook fired: ${chalk.gray("quickbooks.acme.com/webhooks/invoices")}`);

  console.log();
  console.log(`  ${chalk.green.bold("\u{2705}")} ${chalk.green.bold("Payment complete. Full compliance pipeline executed.")}`);

  // ── Pipeline timing ─────────────────────────────────────────────────────

  console.log();
  console.log(chalk.gray("  Pipeline timing breakdown:"));
  timingDisplay("Sender screening", senderLatency2);
  timingDisplay("Receiver screening", receiverLatency);
  timingDisplay("AML risk scoring", amlLatency);
  timingDisplay("KYA verification", kyaLatency);
  timingDisplay("x402 settlement", 800);
  timingDisplay("Receipt + EAS attestation", 400);

  const pipelineMs = senderLatency2 + receiverLatency + amlLatency + kyaLatency + 800 + 400;
  totalTiming(pipelineMs);

  // ── Full receipt ────────────────────────────────────────────────────────

  const receipt: ReceiptData = {
    receiptId,
    overallStatus: "COMPLIANT",
    riskScore: 8,
    checks: [
      { checkType: "SANCTIONS_SCREENING", result: "PASSED", provider: "Chainalysis KYT", latencyMs: senderLatency2 + receiverLatency },
      { checkType: "KYA_VERIFICATION", result: "PASSED", provider: "ERC-8004 Registry", latencyMs: kyaLatency },
      { checkType: "AML_MONITORING", result: "PASSED", provider: "ProofLink Engine", latencyMs: amlLatency },
      { checkType: "TRAVEL_RULE", result: "SKIPPED", provider: "N/A (below $3,000)", latencyMs: 0 },
      { checkType: "INVOICE_VALIDATION", result: "PASSED", provider: "ProofLink Engine", latencyMs: 8 },
    ],
    travelRuleStatus: "NOT_REQUIRED",
    easAttestationUid: easUid,
    ipfsCid,
    signature,
    timestamp: new Date().toISOString(),
  };

  formatReceipt(receipt);

  await sleep(500);

  // ═══════════════════════════════════════════════════════════════════════
  // ACT 3: TECHNICAL DEPTH
  // ═══════════════════════════════════════════════════════════════════════

  sectionHeader("ACT 3: HOW IT WORKS");

  console.log(chalk.white.bold("  Integration — one line of code:"));
  console.log();
  console.log(chalk.gray("  ┌──────────────────────────────────────────────────┐"));
  console.log(chalk.gray("  │ ") + chalk.cyan("compliance") + chalk.white(".register(") + chalk.green("server") + chalk.white(");") + chalk.gray(" // That's it.") + chalk.gray("  │"));
  console.log(chalk.gray("  └──────────────────────────────────────────────────┘"));
  console.log();

  console.log(chalk.white("  ProofLink registers hooks into the x402 ResourceServer lifecycle:"));
  console.log();
  console.log(`  ${chalk.cyan("\u{25B6}")} ${chalk.white("Before verify:")}  sanctions screen + AML risk score`);
  console.log(`  ${chalk.cyan("\u{25B6}")} ${chalk.white("Before settle:")}  FATF Travel Rule (>$3,000)`);
  console.log(`  ${chalk.cyan("\u{25B6}")} ${chalk.white("After settle:")}   ProofLink receipt + EAS attestation`);
  console.log();
  console.log(chalk.gray("  Hook-based, not proxy-based. Zero additional network hops."));
  console.log(chalk.gray("  Sub-200ms overhead on cached addresses. Protocol-agnostic."));

  await sleep(500);

  // ═══════════════════════════════════════════════════════════════════════
  // FINAL SUMMARY
  // ═══════════════════════════════════════════════════════════════════════

  sectionHeader("DEMO SUMMARY");

  const demoEnd = Date.now();
  const totalDemoMs = demoEnd - demoStart;

  summaryBox("ProofLink Compliance Pipeline Results", [
    { label: "Addresses screened", value: chalk.white("3 (1 blocked, 2 cleared)") },
    { label: "Sanctions lists", value: chalk.white("OFAC_SDN, EU, UN, HMT") },
    { label: "Payments processed", value: chalk.white("2 (1 rejected, 1 settled)") },
    { label: "KYA verifications", value: chalk.white("1 (trust score 87/100)") },
    { label: "AML risk score", value: chalk.green("8/100 (LOW RISK)") },
    { label: "Travel Rule", value: chalk.gray("Not required (<$3,000)") },
    { label: "Compliance receipts", value: chalk.white("2 ProofLink receipts") },
    { label: "On-chain attestation", value: chalk.white("EAS on Base") },
    { label: "Total demo time", value: chalk.cyan(`${(totalDemoMs / 1000).toFixed(1)}s`) },
  ]);

  console.log();
  console.log(chalk.white.bold("  What ProofLink provides that nobody else does:"));
  console.log();
  console.log(`  ${chalk.green("\u{2713}")} Pre-payment sanctions enforcement (not post-hoc monitoring)`);
  console.log(`  ${chalk.green("\u{2713}")} Know Your Agent (KYA) via ERC-8004 identity resolution`);
  console.log(`  ${chalk.green("\u{2713}")} Cryptographic compliance receipts (ProofLink)`);
  console.log(`  ${chalk.green("\u{2713}")} On-chain attestation via Ethereum Attestation Service`);
  console.log(`  ${chalk.green("\u{2713}")} Machine-readable invoices with compliance stamps`);
  console.log(`  ${chalk.green("\u{2713}")} Multi-protocol support: x402, ACP, AP2, MPP`);
  console.log();

  console.log(chalk.cyan("  ─────────────────────────────────────────────────────────"));
  console.log();
  console.log(
    chalk.white.bold(
      '  "x402 delivers payments. ProofLink makes them legal.\n' +
        '   We are the trust layer the agentic economy does not know it needs yet."',
    ),
  );
  console.log();
  console.log(chalk.gray("  Live at: ") + chalk.cyan.underline("https://v0-prooflink.vercel.app"));
  console.log(chalk.gray("  GitHub:  ") + chalk.cyan.underline("https://github.com/prooflink-protocol/prooflink"));
  console.log();
}
