import chalk from "chalk";
import oraImport from "ora";

import {
  prooflinkLog,
  agentLog,
  x402Log,
  statusCleared,
  riskScore,
  travelRuleStatus,
  paymentApproved,
  sectionHeader,
  stepHeader,
  timingDisplay,
  totalTiming,
  formatReceipt,
  formatJson,
  sleep,
  generateReceiptId,
  generateTxHash,
  generateEasUid,
  generateIpfsCid,
  generateSignature,
  type ReceiptData,
} from "../utils/display.js";

// ---------------------------------------------------------------------------
// Demo addresses
// ---------------------------------------------------------------------------

const SENDER_ADDRESS = "0xA1b2C3d4E5f6A7B8C9D0E1F2a3B4c5D6e7F8a9B0";
const RECEIVER_ADDRESS = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";
const AGENT_ID = "erc8004:8453:0xRegistry:42";

// ---------------------------------------------------------------------------
// Payment Demo
// ---------------------------------------------------------------------------

export async function runPaymentDemo(): Promise<void> {
  const ora = oraImport;
  const pipelineStart = Date.now();

  sectionHeader("x402 COMPLIANT PAYMENT DEMO");

  console.log(
    chalk.gray(
      "  Simulating an AI agent paying for API services via x402 protocol.\n" +
        "  ProofLink intercepts the payment and runs the full compliance pipeline.\n",
    ),
  );

  console.log(`  ${chalk.gray("Agent ID:")}   ${chalk.white(AGENT_ID)}`);
  console.log(`  ${chalk.gray("Sender:")}     ${chalk.white(SENDER_ADDRESS)}`);
  console.log(`  ${chalk.gray("Receiver:")}   ${chalk.white(RECEIVER_ADDRESS)}`);
  console.log(`  ${chalk.gray("Amount:")}     ${chalk.white("50 USDC")}`);
  console.log(`  ${chalk.gray("Chain:")}      ${chalk.white("Base")}`);
  console.log(`  ${chalk.gray("Protocol:")}   ${chalk.white("x402")}`);
  console.log();

  // ── Step 1: Intercept ───────────────────────────────────────────────────

  stepHeader("\u{1F4CB}", "Creating invoice for API services...");

  const spinner1 = ora({
    text: chalk.gray("Generating compliant invoice..."),
    color: "cyan",
    indent: 2,
  }).start();
  await sleep(300);
  spinner1.succeed(chalk.gray("Invoice INV-2026-0042 created"));

  prooflinkLog("Intercepting x402 payment...");
  await sleep(200);

  // ── Step 2: Screen sender ───────────────────────────────────────────────

  const spinnerSender = ora({
    text: chalk.gray("Screening sender address..."),
    color: "cyan",
    indent: 2,
  }).start();

  const senderLatency = Math.floor(Math.random() * 20) + 35;
  await sleep(senderLatency + 100);
  spinnerSender.stop();

  statusCleared("sender", SENDER_ADDRESS, senderLatency);

  // ── Step 3: Screen receiver ─────────────────────────────────────────────

  const spinnerReceiver = ora({
    text: chalk.gray("Screening receiver address..."),
    color: "cyan",
    indent: 2,
  }).start();

  const receiverLatency = Math.floor(Math.random() * 25) + 50;
  await sleep(receiverLatency + 100);
  spinnerReceiver.stop();

  statusCleared("receiver", RECEIVER_ADDRESS, receiverLatency);

  // ── Step 4: AML risk score ──────────────────────────────────────────────

  const spinnerAml = ora({
    text: chalk.gray("Computing AML risk score..."),
    color: "cyan",
    indent: 2,
  }).start();

  const amlLatency = Math.floor(Math.random() * 15) + 20;
  await sleep(amlLatency + 80);
  spinnerAml.stop();

  riskScore(12, 85);

  // ── Step 5: Travel Rule check ───────────────────────────────────────────

  travelRuleStatus(false, 50, 3000);

  // ── Step 6: KYA verification ────────────────────────────────────────────

  const spinnerKya = ora({
    text: chalk.gray("Verifying agent identity (ERC-8004)..."),
    color: "cyan",
    indent: 2,
  }).start();

  const kyaLatency = Math.floor(Math.random() * 20) + 40;
  await sleep(kyaLatency + 120);
  spinnerKya.stop();

  prooflinkLog(`KYA verification: ${chalk.white(AGENT_ID)}`);
  prooflinkLog(`  Agent name: ${chalk.white("inference-agent-v3")}`);
  prooflinkLog(`  Type: ${chalk.white("semi-autonomous")}`);
  prooflinkLog(`  Operator: ${chalk.white("Acme Corp")} ${chalk.gray("(LEI verified)")}`);
  prooflinkLog(`  Trust score: ${chalk.green.bold("87/100")}`);
  prooflinkLog(`  KYA status: ${chalk.green.bold("VERIFIED")}`);

  // ── Step 7: Settlement ──────────────────────────────────────────────────

  await sleep(200);
  paymentApproved();

  const spinnerSettle = ora({
    text: chalk.gray("Settling on Base via x402..."),
    color: "magenta",
    indent: 2,
  }).start();

  const txHash = generateTxHash();
  await sleep(600);
  spinnerSettle.stop();

  x402Log(`Transaction: ${chalk.white(txHash.slice(0, 10) + "..." + txHash.slice(-4))} (Base)`);

  // ── Step 8: Receipt generation ──────────────────────────────────────────

  const receiptId = generateReceiptId("pl");
  const easUid = generateEasUid();

  const spinnerReceipt = ora({
    text: chalk.gray("Generating ProofLink receipt..."),
    color: "green",
    indent: 2,
  }).start();
  await sleep(250);
  spinnerReceipt.stop();

  prooflinkLog(`ProofLink receipt generated: ${chalk.white(receiptId)}`);
  prooflinkLog(`Invoice generated: ${chalk.white("INV-2026-0042")} ${chalk.gray("(JSON + PDF)")}`);
  prooflinkLog(`EAS attestation: ${chalk.white(easUid.slice(0, 10) + "..." + easUid.slice(-4))}`);

  console.log();
  console.log(`  ${chalk.green.bold("\u{1F4B0}")} ${chalk.green.bold("Settlement authorized — payment complete!")}`);

  // ── Pipeline timing ─────────────────────────────────────────────────────

  const pipelineEnd = Date.now();

  console.log();
  console.log(chalk.gray("  Pipeline timing breakdown:"));
  timingDisplay("Sender screening", senderLatency);
  timingDisplay("Receiver screening", receiverLatency);
  timingDisplay("AML risk scoring", amlLatency);
  timingDisplay("KYA verification", kyaLatency);
  timingDisplay("x402 settlement", 600);
  timingDisplay("Receipt generation", 250);
  totalTiming(pipelineEnd - pipelineStart);

  // ── Full receipt ────────────────────────────────────────────────────────

  const ipfsCid = generateIpfsCid();
  const signature = generateSignature();

  const receipt: ReceiptData = {
    receiptId,
    overallStatus: "COMPLIANT",
    riskScore: 12,
    checks: [
      {
        checkType: "SANCTIONS_SCREENING",
        result: "PASSED",
        provider: "Chainalysis KYT",
        latencyMs: senderLatency + receiverLatency,
      },
      {
        checkType: "KYA_VERIFICATION",
        result: "PASSED",
        provider: "ERC-8004 Registry",
        latencyMs: kyaLatency,
      },
      {
        checkType: "AML_MONITORING",
        result: "PASSED",
        provider: "ProofLink Engine",
        latencyMs: amlLatency,
      },
      {
        checkType: "TRAVEL_RULE",
        result: "SKIPPED",
        provider: "N/A (below threshold)",
        latencyMs: 0,
      },
      {
        checkType: "INVOICE_VALIDATION",
        result: "PASSED",
        provider: "ProofLink Engine",
        latencyMs: 8,
      },
    ],
    travelRuleStatus: "NOT_REQUIRED",
    easAttestationUid: easUid,
    ipfsCid,
    signature,
    timestamp: new Date().toISOString(),
  };

  formatReceipt(receipt);

  // ── Raw JSON receipt ────────────────────────────────────────────────────

  formatJson("Compliance Receipt (JSON)", {
    receiptId,
    version: "1.0.0",
    overallStatus: "COMPLIANT",
    transaction: {
      sender: SENDER_ADDRESS,
      receiver: RECEIVER_ADDRESS,
      amount: "50.00",
      asset: "USDC",
      chain: "base",
      protocol: "x402",
      txHash,
    },
    compliance: {
      sanctionsCleared: true,
      kyaVerified: true,
      amlRiskScore: 12,
      travelRuleRequired: false,
      travelRuleStatus: "NOT_REQUIRED",
    },
    attestation: {
      easUid,
      verifyUrl: `https://base.easscan.org/attestation/${easUid}`,
    },
    archive: {
      ipfsCid,
      ipfsUrl: `ipfs://${ipfsCid}`,
    },
    signature,
    timestamp: new Date().toISOString(),
  });

  console.log();
  console.log(
    chalk.gray(
      '  "x402 delivers payments. ProofLink makes them legal."',
    ),
  );
  console.log();
}
