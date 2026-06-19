import chalk from "chalk";
import oraImport from "ora";

import {
  prooflinkLog,
  statusCleared,
  statusBlocked,
  riskScore,
  sectionHeader,
  stepHeader,
  timingDisplay,
  totalTiming,
  formatReceipt,
  sleep,
  generateReceiptId,
  type ReceiptData,
} from "../utils/display.js";

// ---------------------------------------------------------------------------
// Known addresses for demo
// ---------------------------------------------------------------------------

/** Tornado Cash deployer — known OFAC SDN entry */
const SANCTIONED_ADDRESS = "0x905b63Fff465B9fFBF41DeA908CEb12df9d1c960";

/** Vitalik's public address — known clean */
const CLEAN_ADDRESS = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";

// ---------------------------------------------------------------------------
// Sanctions Demo
// ---------------------------------------------------------------------------

export async function runSanctionsDemo(): Promise<void> {
  const ora = oraImport;

  sectionHeader("SANCTIONS SCREENING DEMO");

  console.log(
    chalk.gray(
      "  Demonstrating real-time OFAC sanctions screening against known addresses.\n" +
        "  ProofLink screens every address before payment settlement.\n",
    ),
  );

  // ── Demo 1: Sanctioned address ──────────────────────────────────────────

  stepHeader("\u{1F6A8}", "Screening a known OFAC SDN address");

  console.log(`  ${chalk.gray("Address:")} ${chalk.white(SANCTIONED_ADDRESS)}`);
  console.log(
    `  ${chalk.gray("Known as:")} ${chalk.red("Tornado Cash Deployer")} — OFAC Specially Designated National`,
  );
  console.log();

  const spinner1 = ora({
    text: chalk.gray("Screening against OFAC_SDN, EU_CONSOLIDATED, UN_CONSOLIDATED, HMT..."),
    color: "red",
    indent: 2,
  }).start();

  const blockedLatency = Math.floor(Math.random() * 40) + 70; // 70-110ms
  await sleep(blockedLatency + 200); // extra visual delay for drama
  spinner1.stop();

  statusBlocked("receiver", SANCTIONED_ADDRESS, blockedLatency, {
    list: "OFAC_SDN",
    entity: "Tornado Cash Deployer",
    confidence: 0.99,
  });
  prooflinkLog(
    `Payment ${chalk.red.bold("REJECTED")}. Compliance code: ${chalk.red("SANCTIONS_HIT")}`,
  );

  const blockedReceiptId = generateReceiptId("scr");
  prooflinkLog(`ProofLink receipt: ${chalk.white(blockedReceiptId)}`);

  console.log();
  timingDisplay("Screening latency", blockedLatency);

  // Display the blocked receipt
  const blockedReceipt: ReceiptData = {
    receiptId: blockedReceiptId,
    overallStatus: "BLOCKED",
    riskScore: 98,
    checks: [
      {
        checkType: "SANCTIONS_SCREENING",
        result: "FAILED",
        provider: "Chainalysis Free API",
        latencyMs: blockedLatency,
      },
      {
        checkType: "AML_MONITORING",
        result: "SKIPPED",
        provider: "ProofLink Engine",
        latencyMs: 0,
      },
      {
        checkType: "TRAVEL_RULE",
        result: "SKIPPED",
        provider: "N/A",
        latencyMs: 0,
      },
    ],
    travelRuleStatus: "NOT_REQUIRED",
    signature: "0x" + "e".repeat(130),
    timestamp: new Date().toISOString(),
  };

  formatReceipt(blockedReceipt);

  // ── Demo 2: Clean address ───────────────────────────────────────────────

  await sleep(800);

  stepHeader("\u{2705}", "Screening a known clean address");

  console.log(`  ${chalk.gray("Address:")} ${chalk.white(CLEAN_ADDRESS)}`);
  console.log(
    `  ${chalk.gray("Known as:")} ${chalk.green("vitalik.eth")} — Ethereum co-founder`,
  );
  console.log();

  const spinner2 = ora({
    text: chalk.gray("Screening against OFAC_SDN, EU_CONSOLIDATED, UN_CONSOLIDATED, HMT..."),
    color: "cyan",
    indent: 2,
  }).start();

  const clearedLatency = Math.floor(Math.random() * 30) + 55; // 55-85ms
  await sleep(clearedLatency + 150);
  spinner2.stop();

  statusCleared("receiver", CLEAN_ADDRESS, clearedLatency);
  riskScore(2, 85);

  const clearReceiptId = generateReceiptId("scr");
  prooflinkLog(`ProofLink receipt: ${chalk.white(clearReceiptId)}`);

  console.log();
  timingDisplay("Screening latency", clearedLatency);

  // Display the clear receipt
  const clearReceipt: ReceiptData = {
    receiptId: clearReceiptId,
    overallStatus: "COMPLIANT",
    riskScore: 2,
    checks: [
      {
        checkType: "SANCTIONS_SCREENING",
        result: "PASSED",
        provider: "Chainalysis Free API",
        latencyMs: clearedLatency,
      },
      {
        checkType: "AML_MONITORING",
        result: "PASSED",
        provider: "ProofLink Engine",
        latencyMs: 12,
      },
    ],
    travelRuleStatus: "NOT_REQUIRED",
    signature: "0x" + "a".repeat(130),
    timestamp: new Date().toISOString(),
  };

  formatReceipt(clearReceipt);

  // ── Summary ─────────────────────────────────────────────────────────────

  console.log();
  totalTiming(blockedLatency + clearedLatency);

  console.log();
  console.log(
    chalk.cyan.bold("  Result: ") +
      chalk.white("2 addresses screened against 4 sanctions lists."),
  );
  console.log(
    chalk.cyan.bold("          ") +
      chalk.red.bold("1 BLOCKED") +
      chalk.white(" | ") +
      chalk.green.bold("1 CLEARED") +
      chalk.white(" | Sub-200ms per check."),
  );
  console.log();
  console.log(
    chalk.gray(
      '  "Every x402 payment that moves without ProofLink is a compliance liability\n' +
        '   waiting to become a headline."',
    ),
  );
  console.log();
}
