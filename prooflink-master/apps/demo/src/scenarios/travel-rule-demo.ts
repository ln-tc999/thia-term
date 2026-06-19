import chalk from "chalk";
import oraImport from "ora";
import Table from "cli-table3";

import {
  prooflinkLog,
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
  sleep,
  generateReceiptId,
  generateTxHash,
  generateEasUid,
  generateSignature,
  truncateAddress,
  type ReceiptData,
} from "../utils/display.js";
import { demoConfig } from "../config.js";
import { DemoReporter } from "../utils/reporter.js";

// ---------------------------------------------------------------------------
// Travel Rule Demo — FATF + MiCA compliance flow
// ---------------------------------------------------------------------------

const SENDER = demoConfig.wallets["newAgent"]!.address;
const RECEIVER = demoConfig.wallets["cleanVitalik"]!.address;

// ---------------------------------------------------------------------------
// IVMS101 data structure display
// ---------------------------------------------------------------------------

interface Ivms101Payload {
  originator: {
    naturalPerson?: { name: string; dateOfBirth: string; placeOfBirth: string };
    legalPerson?: { name: string; lei: string; registrationAuthority: string };
    accountNumber: string;
    jurisdiction: string;
  };
  beneficiary: {
    naturalPerson?: { name: string };
    legalPerson?: { name: string; lei: string };
    accountNumber: string;
    jurisdiction: string;
  };
  transferInfo: {
    amount: string;
    currency: string;
    originatingVASP: string;
    beneficiaryVASP: string;
  };
}

function displayIvms101(payload: Ivms101Payload): void {
  console.log();
  console.log(chalk.cyan.bold("  ┌─────────────────────────────────────────────────────┐"));
  console.log(chalk.cyan.bold("  │") + chalk.white.bold("       IVMS101 Travel Rule Data Payload          ") + chalk.cyan.bold("  │"));
  console.log(chalk.cyan.bold("  └─────────────────────────────────────────────────────┘"));
  console.log();

  const { originator, beneficiary, transferInfo } = payload;

  console.log(chalk.yellow.bold("  Originator:"));
  if (originator.legalPerson) {
    console.log(`    ${chalk.gray("Entity:")}        ${chalk.white(originator.legalPerson.name)}`);
    console.log(`    ${chalk.gray("LEI:")}           ${chalk.white(originator.legalPerson.lei)}`);
    console.log(`    ${chalk.gray("Reg Authority:")} ${chalk.white(originator.legalPerson.registrationAuthority)}`);
  }
  if (originator.naturalPerson) {
    console.log(`    ${chalk.gray("Name:")}          ${chalk.white(originator.naturalPerson.name)}`);
    console.log(`    ${chalk.gray("DOB:")}           ${chalk.white(originator.naturalPerson.dateOfBirth)}`);
    console.log(`    ${chalk.gray("Place of Birth:")} ${chalk.white(originator.naturalPerson.placeOfBirth)}`);
  }
  console.log(`    ${chalk.gray("Account:")}       ${chalk.white(truncateAddress(originator.accountNumber))}`);
  console.log(`    ${chalk.gray("Jurisdiction:")}  ${chalk.white(originator.jurisdiction)}`);

  console.log();
  console.log(chalk.yellow.bold("  Beneficiary:"));
  if (beneficiary.legalPerson) {
    console.log(`    ${chalk.gray("Entity:")}       ${chalk.white(beneficiary.legalPerson.name)}`);
    console.log(`    ${chalk.gray("LEI:")}          ${chalk.white(beneficiary.legalPerson.lei)}`);
  }
  if (beneficiary.naturalPerson) {
    console.log(`    ${chalk.gray("Name:")}         ${chalk.white(beneficiary.naturalPerson.name)}`);
  }
  console.log(`    ${chalk.gray("Account:")}      ${chalk.white(truncateAddress(beneficiary.accountNumber))}`);
  console.log(`    ${chalk.gray("Jurisdiction:")} ${chalk.white(beneficiary.jurisdiction)}`);

  console.log();
  console.log(chalk.yellow.bold("  Transfer:"));
  console.log(`    ${chalk.gray("Amount:")}        ${chalk.white(`${transferInfo.amount} ${transferInfo.currency}`)}`);
  console.log(`    ${chalk.gray("Origin VASP:")}   ${chalk.white(transferInfo.originatingVASP)}`);
  console.log(`    ${chalk.gray("Beneficiary VASP:")} ${chalk.white(transferInfo.beneficiaryVASP)}`);
}

// ---------------------------------------------------------------------------
// Travel Rule status transitions display
// ---------------------------------------------------------------------------

function displayStatusTransitions(statuses: Array<{ state: string; time: string; detail: string }>): void {
  console.log();
  console.log(chalk.white.bold("  Travel Rule Status Transitions:"));
  console.log();

  for (let i = 0; i < statuses.length; i++) {
    const s = statuses[i]!;
    const isLast = i === statuses.length - 1;
    const stateColor =
      s.state === "COMPLETED" || s.state === "ACCEPTED"
        ? chalk.green.bold
        : s.state === "PENDING" || s.state === "SUBMITTED"
          ? chalk.yellow.bold
          : s.state === "NOT_REQUIRED"
            ? chalk.gray
            : chalk.cyan.bold;

    const connector = isLast ? "  " : chalk.gray("  │");
    const bullet = isLast ? chalk.green("  └─") : chalk.gray("  ├─");

    console.log(`${bullet} ${stateColor(s.state.padEnd(14))} ${chalk.gray(s.time)}  ${chalk.white(s.detail)}`);
    if (!isLast) {
      console.log(connector);
    }
  }
  console.log();
}

// ---------------------------------------------------------------------------
// Main demo
// ---------------------------------------------------------------------------

export async function runTravelRuleDemo(): Promise<void> {
  const ora = oraImport;
  const reporter = new DemoReporter("Travel Rule Compliance");
  const demoStart = Date.now();

  sectionHeader("TRAVEL RULE COMPLIANCE DEMO");

  console.log(chalk.gray("  FATF Travel Rule requires originator/beneficiary data for"));
  console.log(chalk.gray("  virtual asset transfers above jurisdiction-specific thresholds."));
  console.log(chalk.gray("  ProofLink enforces this automatically with IVMS101 data exchange.\n"));

  console.log(`  ${chalk.gray("Jurisdictions covered:")} ${chalk.white("US (FinCEN $3,000)")}, ${chalk.white("EU/MiCA (EUR 1,000)")}`);
  console.log(`  ${chalk.gray("Protocol:")}             ${chalk.white("TRISA + IVMS101")}`);
  console.log();

  await sleep(400);

  // ═══════════════════════════════════════════════════════════════════════════
  // SCENARIO 1: Below US threshold — Travel Rule NOT required ($2,500)
  // ═══════════════════════════════════════════════════════════════════════════

  stepHeader("\u{1F4B5}", "Scenario 1: Below US threshold ($2,500 USDC)");

  console.log(`  ${chalk.gray("Amount:")}       ${chalk.white("$2,500 USDC")}`);
  console.log(`  ${chalk.gray("Jurisdiction:")} ${chalk.white("United States (FinCEN)")}`);
  console.log(`  ${chalk.gray("Threshold:")}    ${chalk.white("$3,000 USD")}`);
  console.log(`  ${chalk.gray("Expected:")}     ${chalk.green("Travel Rule NOT required")}`);
  console.log();

  prooflinkLog("Intercepting x402 payment...");
  await sleep(200);

  const spinner1 = ora({
    text: chalk.gray("Screening addresses..."),
    color: "cyan",
    indent: 2,
  }).start();
  const screen1Latency = Math.floor(Math.random() * 20) + 45;
  await sleep(screen1Latency + 100);
  spinner1.stop();

  statusCleared("sender", SENDER, screen1Latency);
  statusCleared("receiver", RECEIVER, 3, true);
  riskScore(5, 85);

  travelRuleStatus(false, 2500, 3000);

  displayStatusTransitions([
    { state: "INITIATED", time: "T+0ms", detail: "Payment intercepted by ProofLink" },
    { state: "EVALUATED", time: `T+${screen1Latency}ms`, detail: "Amount $2,500 < $3,000 threshold" },
    { state: "NOT_REQUIRED", time: `T+${screen1Latency + 5}ms`, detail: "Travel Rule check skipped" },
  ]);

  reporter.addEvent({
    type: "travel_rule",
    label: "Travel Rule check -- $2,500 (below US threshold)",
    status: "passed",
    latencyMs: screen1Latency,
    details: { amount: 2500, threshold: 3000, required: false, jurisdiction: "US" },
  });

  paymentApproved();

  const receipt1Id = generateReceiptId("pl");
  prooflinkLog(`ProofLink receipt: ${chalk.white(receipt1Id)}`);

  const receipt1: ReceiptData = {
    receiptId: receipt1Id,
    overallStatus: "COMPLIANT",
    riskScore: 5,
    checks: [
      { checkType: "SANCTIONS_SCREENING", result: "PASSED", provider: "Chainalysis KYT", latencyMs: screen1Latency },
      { checkType: "AML_MONITORING", result: "PASSED", provider: "ProofLink Engine", latencyMs: 12 },
      { checkType: "TRAVEL_RULE", result: "SKIPPED", provider: "N/A (below $3,000 US)", latencyMs: 0 },
    ],
    travelRuleStatus: "NOT_REQUIRED",
    signature: generateSignature(),
    timestamp: new Date().toISOString(),
  };

  reporter.addReceipt(receipt1);
  formatReceipt(receipt1);

  console.log();
  console.log(`  ${chalk.green.bold("\u2713")} ${chalk.white("Sub-threshold payment -- no Travel Rule data needed")}`);

  await sleep(800);

  // ═══════════════════════════════════════════════════════════════════════════
  // SCENARIO 2: Above US threshold — Travel Rule REQUIRED ($5,000 USD)
  // ═══════════════════════════════════════════════════════════════════════════

  stepHeader("\u{1F6A8}", "Scenario 2: Above US threshold ($5,000 USDC)");

  console.log(`  ${chalk.gray("Amount:")}       ${chalk.yellow.bold("$5,000 USDC")}`);
  console.log(`  ${chalk.gray("Jurisdiction:")} ${chalk.white("United States (FinCEN)")}`);
  console.log(`  ${chalk.gray("Threshold:")}    ${chalk.white("$3,000 USD")}`);
  console.log(`  ${chalk.gray("Expected:")}     ${chalk.yellow("Travel Rule REQUIRED -- originator/beneficiary data")}`);
  console.log();

  prooflinkLog("Intercepting x402 payment...");
  await sleep(200);

  const spinner2 = ora({
    text: chalk.gray("Screening addresses..."),
    color: "cyan",
    indent: 2,
  }).start();
  const screen2Latency = Math.floor(Math.random() * 20) + 45;
  await sleep(screen2Latency + 100);
  spinner2.stop();

  statusCleared("sender", SENDER, screen2Latency);
  statusCleared("receiver", RECEIVER, 4, true);
  riskScore(8, 85);

  travelRuleStatus(true, 5000, 3000);

  reporter.addEvent({
    type: "travel_rule",
    label: "Travel Rule check -- $5,000 (above US threshold)",
    status: "passed",
    latencyMs: screen2Latency,
    details: { amount: 5000, threshold: 3000, required: true, jurisdiction: "US" },
  });

  prooflinkLog(`Travel Rule ${chalk.yellow.bold("TRIGGERED")} -- collecting IVMS101 originator/beneficiary data`);
  await sleep(300);

  // Simulate IVMS101 data collection
  stepHeader("\u{1F4CB}", "Collecting IVMS101 data...");

  const spinnerTr = ora({
    text: chalk.gray("Collecting originator information (IVMS101)..."),
    color: "yellow",
    indent: 2,
  }).start();
  const trCollectLatency = Math.floor(Math.random() * 30) + 80;
  await sleep(trCollectLatency + 200);
  spinnerTr.succeed(chalk.gray("Originator data collected (IVMS101)"));

  const spinnerBen = ora({
    text: chalk.gray("Collecting beneficiary information (IVMS101)..."),
    color: "yellow",
    indent: 2,
  }).start();
  const benCollectLatency = Math.floor(Math.random() * 20) + 50;
  await sleep(benCollectLatency + 150);
  spinnerBen.succeed(chalk.gray("Beneficiary data collected (IVMS101)"));

  const ivms101US: Ivms101Payload = {
    originator: {
      legalPerson: {
        name: "Acme AI Corp",
        lei: "254900OPPU84GM83MG36",
        registrationAuthority: "Delaware Division of Corporations",
      },
      accountNumber: SENDER,
      jurisdiction: "US-DE",
    },
    beneficiary: {
      naturalPerson: { name: "Vitalik Buterin" },
      accountNumber: RECEIVER,
      jurisdiction: "CH-ZG",
    },
    transferInfo: {
      amount: "5,000.00",
      currency: "USDC",
      originatingVASP: "prooflink.finance",
      beneficiaryVASP: "vasp.ethereum.org",
    },
  };

  displayIvms101(ivms101US);

  reporter.addEvent({
    type: "travel_rule",
    label: "IVMS101 data submission -- US jurisdiction",
    status: "passed",
    latencyMs: trCollectLatency + benCollectLatency,
  });

  // Submit to VASP
  const spinnerVasp = ora({
    text: chalk.gray("Submitting to counterparty VASP via TRISA protocol..."),
    color: "yellow",
    indent: 2,
  }).start();
  const vaspLatency = Math.floor(Math.random() * 40) + 150;
  await sleep(vaspLatency + 200);
  spinnerVasp.succeed(chalk.gray("VASP exchange complete"));

  prooflinkLog(`TRISA exchange: ${chalk.green.bold("COMPLETED")} ${chalk.gray(`(${vaspLatency}ms)`)}`);
  prooflinkLog(`  Protocol:    ${chalk.white("TRISA v1")}`);
  prooflinkLog(`  Peer VASP:   ${chalk.white("vasp.ethereum.org")}`);
  prooflinkLog(`  Transfer ID: ${chalk.white(generateReceiptId("tr"))}`);
  prooflinkLog(`  Status:      ${chalk.green.bold("ACCEPTED")}`);

  // Show status transitions
  displayStatusTransitions([
    { state: "INITIATED", time: "T+0ms", detail: "Payment intercepted by ProofLink" },
    { state: "EVALUATED", time: `T+${screen2Latency}ms`, detail: "Amount $5,000 > $3,000 threshold (US/FinCEN)" },
    { state: "PENDING", time: `T+${screen2Latency + 10}ms`, detail: "Travel Rule data collection started" },
    { state: "SUBMITTED", time: `T+${screen2Latency + trCollectLatency + benCollectLatency}ms`, detail: "IVMS101 payload submitted to peer VASP" },
    { state: "ACCEPTED", time: `T+${screen2Latency + trCollectLatency + benCollectLatency + vaspLatency}ms`, detail: "Counterparty VASP accepted" },
    { state: "COMPLETED", time: `T+${screen2Latency + trCollectLatency + benCollectLatency + vaspLatency + 5}ms`, detail: "Travel Rule obligation fulfilled" },
  ]);

  reporter.addEvent({
    type: "travel_rule",
    label: "TRISA VASP exchange -- US $5,000",
    status: "passed",
    latencyMs: vaspLatency,
  });

  // Settlement
  paymentApproved();
  const spinnerSettle = ora({
    text: chalk.gray("Settling on Base via x402..."),
    color: "magenta",
    indent: 2,
  }).start();
  const txHash2 = generateTxHash();
  await sleep(600);
  spinnerSettle.stop();
  x402Log(`Transaction: ${chalk.white(truncateAddress(txHash2))} (Base)`);

  const receipt2Id = generateReceiptId("pl");
  const easUid2 = generateEasUid();

  const receipt2: ReceiptData = {
    receiptId: receipt2Id,
    overallStatus: "COMPLIANT",
    riskScore: 8,
    checks: [
      { checkType: "SANCTIONS_SCREENING", result: "PASSED", provider: "Chainalysis KYT", latencyMs: screen2Latency },
      { checkType: "AML_MONITORING", result: "PASSED", provider: "ProofLink Engine", latencyMs: 15 },
      { checkType: "TRAVEL_RULE", result: "PASSED", provider: "TRISA Protocol (IVMS101)", latencyMs: vaspLatency },
      { checkType: "KYA_VERIFICATION", result: "PASSED", provider: "ERC-8004 Registry", latencyMs: 42 },
    ],
    travelRuleStatus: "COMPLETED",
    easAttestationUid: easUid2,
    signature: generateSignature(),
    timestamp: new Date().toISOString(),
  };

  reporter.addReceipt(receipt2);
  formatReceipt(receipt2);

  await sleep(800);

  // ═══════════════════════════════════════════════════════════════════════════
  // SCENARIO 3: EU/MiCA — EUR 1,200 (Travel Rule triggered at EUR 1,000)
  // ═══════════════════════════════════════════════════════════════════════════

  stepHeader("\u{1F1EA}\u{1F1FA}", "Scenario 3: EU/MiCA jurisdiction (EUR 1,200)");

  console.log(`  ${chalk.gray("Amount:")}       ${chalk.yellow.bold("EUR 1,200")}`);
  console.log(`  ${chalk.gray("Jurisdiction:")} ${chalk.white("European Union (MiCA / TFR)")}`);
  console.log(`  ${chalk.gray("Threshold:")}    ${chalk.white("EUR 1,000")} ${chalk.gray("(MiCA Transfer of Funds Regulation)")}`);
  console.log(`  ${chalk.gray("Expected:")}     ${chalk.yellow("Travel Rule REQUIRED -- MiCA applies")}`);
  console.log();

  prooflinkLog("Intercepting x402 payment...");
  prooflinkLog(`Jurisdiction detection: ${chalk.white("EU/MiCA")} ${chalk.gray("(beneficiary VASP in EU)")}`);
  await sleep(200);

  const spinner3 = ora({
    text: chalk.gray("Screening addresses against EU sanctions lists..."),
    color: "cyan",
    indent: 2,
  }).start();
  const screen3Latency = Math.floor(Math.random() * 20) + 50;
  await sleep(screen3Latency + 100);
  spinner3.stop();

  statusCleared("sender", SENDER, screen3Latency);
  statusCleared("receiver", RECEIVER, 5, true);
  riskScore(10, 85);

  prooflinkLog(
    `Travel Rule: ${chalk.yellow.bold("REQUIRED")} ${chalk.gray("(amount EUR 1,200 above EUR 1,000 MiCA threshold)")}`,
  );

  reporter.addEvent({
    type: "travel_rule",
    label: "Travel Rule check -- EUR 1,200 (above EU/MiCA threshold)",
    status: "passed",
    latencyMs: screen3Latency,
    details: { amount: 1200, currency: "EUR", threshold: 0, required: true, jurisdiction: "EU" },
  });

  prooflinkLog(`Travel Rule ${chalk.yellow.bold("TRIGGERED")} -- MiCA Transfer of Funds Regulation applies`);
  prooflinkLog(`  Regulation: ${chalk.white("Regulation (EU) 2023/1113 (TFR)")}`);
  prooflinkLog(`  Note: ${chalk.gray("EU TFR 2023/1113 requires IVMS101 data for ALL CASP-to-CASP transfers (no threshold)")}`);
  await sleep(300);

  // IVMS101 data for EU
  stepHeader("\u{1F4CB}", "Collecting IVMS101 data (MiCA-enhanced)...");

  const spinnerEuOrig = ora({
    text: chalk.gray("Collecting originator information (MiCA-enhanced IVMS101)..."),
    color: "yellow",
    indent: 2,
  }).start();
  const euOrigLatency = Math.floor(Math.random() * 25) + 70;
  await sleep(euOrigLatency + 180);
  spinnerEuOrig.succeed(chalk.gray("Originator data collected (MiCA-enhanced)"));

  const spinnerEuBen = ora({
    text: chalk.gray("Collecting beneficiary information (MiCA-enhanced IVMS101)..."),
    color: "yellow",
    indent: 2,
  }).start();
  const euBenLatency = Math.floor(Math.random() * 20) + 50;
  await sleep(euBenLatency + 150);
  spinnerEuBen.succeed(chalk.gray("Beneficiary data collected (MiCA-enhanced)"));

  const ivms101EU: Ivms101Payload = {
    originator: {
      legalPerson: {
        name: "Acme AI Corp",
        lei: "254900OPPU84GM83MG36",
        registrationAuthority: "Delaware Division of Corporations",
      },
      accountNumber: SENDER,
      jurisdiction: "US-DE",
    },
    beneficiary: {
      legalPerson: {
        name: "EuroNode GmbH",
        lei: "529900T8BM49AURSDO55",
      },
      accountNumber: RECEIVER,
      jurisdiction: "DE-BY",
    },
    transferInfo: {
      amount: "1,200.00",
      currency: "EUR",
      originatingVASP: "prooflink.finance",
      beneficiaryVASP: "vasp.euronode.eu",
    },
  };

  displayIvms101(ivms101EU);

  // MiCA-specific additional fields
  console.log(chalk.yellow.bold("  MiCA Additional Requirements:"));
  console.log(`    ${chalk.gray("Originator verified:")} ${chalk.green("YES")} ${chalk.gray("(CASP obligation under TFR Art. 14)")}`);
  console.log(`    ${chalk.gray("Self-hosted wallet:")}  ${chalk.white("NO")} ${chalk.gray("(both hosted by CASPs)")}`);
  console.log(`    ${chalk.gray("Record retention:")}    ${chalk.white("5 years")} ${chalk.gray("(MiCA Art. 63)")}`);
  console.log();

  reporter.addEvent({
    type: "travel_rule",
    label: "IVMS101 data submission -- EU/MiCA jurisdiction",
    status: "passed",
    latencyMs: euOrigLatency + euBenLatency,
  });

  // Submit to EU VASP
  const spinnerEuVasp = ora({
    text: chalk.gray("Submitting to EU counterparty VASP via TRISA protocol..."),
    color: "yellow",
    indent: 2,
  }).start();
  const euVaspLatency = Math.floor(Math.random() * 50) + 180;
  await sleep(euVaspLatency + 200);
  spinnerEuVasp.succeed(chalk.gray("EU VASP exchange complete"));

  prooflinkLog(`TRISA exchange: ${chalk.green.bold("COMPLETED")} ${chalk.gray(`(${euVaspLatency}ms)`)}`);
  prooflinkLog(`  Protocol:    ${chalk.white("TRISA v1 (MiCA-compliant)")}`);
  prooflinkLog(`  Peer VASP:   ${chalk.white("vasp.euronode.eu")} ${chalk.gray("(DE)")}`);
  prooflinkLog(`  Regulation:  ${chalk.white("EU TFR 2023/1113")}`);
  prooflinkLog(`  Transfer ID: ${chalk.white(generateReceiptId("tr"))}`);
  prooflinkLog(`  Status:      ${chalk.green.bold("ACCEPTED")}`);

  displayStatusTransitions([
    { state: "INITIATED", time: "T+0ms", detail: "Payment intercepted by ProofLink" },
    { state: "EVALUATED", time: `T+${screen3Latency}ms`, detail: "Amount EUR 1,200 > EUR 1,000 (MiCA/TFR)" },
    { state: "PENDING", time: `T+${screen3Latency + 10}ms`, detail: "MiCA-enhanced IVMS101 collection started" },
    { state: "SUBMITTED", time: `T+${screen3Latency + euOrigLatency + euBenLatency}ms`, detail: "IVMS101 payload submitted to EU VASP" },
    { state: "ACCEPTED", time: `T+${screen3Latency + euOrigLatency + euBenLatency + euVaspLatency}ms`, detail: "EU counterparty VASP accepted" },
    { state: "COMPLETED", time: `T+${screen3Latency + euOrigLatency + euBenLatency + euVaspLatency + 5}ms`, detail: "MiCA Travel Rule obligation fulfilled" },
  ]);

  reporter.addEvent({
    type: "travel_rule",
    label: "TRISA VASP exchange -- EU MiCA EUR 1,200",
    status: "passed",
    latencyMs: euVaspLatency,
  });

  paymentApproved();
  const spinnerSettleEu = ora({
    text: chalk.gray("Settling on Ethereum via x402..."),
    color: "magenta",
    indent: 2,
  }).start();
  const txHash3 = generateTxHash();
  await sleep(700);
  spinnerSettleEu.stop();
  x402Log(`Transaction: ${chalk.white(truncateAddress(txHash3))} (Ethereum)`);

  const receipt3Id = generateReceiptId("pl");
  const receipt3: ReceiptData = {
    receiptId: receipt3Id,
    overallStatus: "COMPLIANT",
    riskScore: 10,
    checks: [
      { checkType: "SANCTIONS_SCREENING", result: "PASSED", provider: "Chainalysis KYT + EU_CONSOLIDATED", latencyMs: screen3Latency },
      { checkType: "AML_MONITORING", result: "PASSED", provider: "ProofLink Engine", latencyMs: 18 },
      { checkType: "TRAVEL_RULE", result: "PASSED", provider: "TRISA Protocol (MiCA/TFR)", latencyMs: euVaspLatency },
      { checkType: "KYA_VERIFICATION", result: "PASSED", provider: "ERC-8004 Registry", latencyMs: 38 },
    ],
    travelRuleStatus: "COMPLETED (MiCA)",
    easAttestationUid: generateEasUid(),
    signature: generateSignature(),
    timestamp: new Date().toISOString(),
  };

  reporter.addReceipt(receipt3);
  formatReceipt(receipt3);

  // ═══════════════════════════════════════════════════════════════════════════
  // COMPARISON TABLE
  // ═══════════════════════════════════════════════════════════════════════════

  sectionHeader("TRAVEL RULE COMPARISON");

  const table = new Table({
    head: [
      chalk.cyan("Scenario"),
      chalk.cyan("Amount"),
      chalk.cyan("Jurisdiction"),
      chalk.cyan("Threshold"),
      chalk.cyan("Travel Rule"),
      chalk.cyan("Protocol"),
    ],
    style: { head: [], border: [], "padding-left": 2, "padding-right": 1 },
    chars: {
      top: "\u2500", "top-mid": "\u252C", "top-left": "  \u250C", "top-right": "\u2510",
      bottom: "\u2500", "bottom-mid": "\u2534", "bottom-left": "  \u2514", "bottom-right": "\u2518",
      left: "  \u2502", "left-mid": "  \u251C", mid: "\u2500", "mid-mid": "\u253C",
      right: "\u2502", "right-mid": "\u2524", middle: "\u2502",
    },
  });

  table.push(
    [chalk.white("1"), chalk.white("$2,500"), chalk.white("US (FinCEN)"), chalk.white("$3,000"), chalk.green("NOT REQUIRED"), chalk.gray("N/A")],
    [chalk.white("2"), chalk.yellow("$5,000"), chalk.white("US (FinCEN)"), chalk.white("$3,000"), chalk.yellow("REQUIRED"), chalk.white("TRISA/IVMS101")],
    [chalk.white("3"), chalk.yellow("EUR 1,200"), chalk.white("EU (MiCA)"), chalk.white("EUR 1,000"), chalk.yellow("REQUIRED"), chalk.white("TRISA/IVMS101")],
  );

  console.log(table.toString());

  console.log();
  console.log(chalk.white.bold("  Key takeaway:"));
  console.log(chalk.gray("  The same $1,200 payment requires Travel Rule data in the EU (MiCA)"));
  console.log(chalk.gray("  but NOT in the US. ProofLink detects jurisdiction automatically and"));
  console.log(chalk.gray("  enforces the correct threshold per regulatory framework."));
  console.log();

  // Timing summary
  const demoEnd = Date.now();
  const totalMs = demoEnd - demoStart;

  console.log(chalk.gray("  Pipeline timing breakdown:"));
  timingDisplay("Screening (Scenario 1)", screen1Latency);
  timingDisplay("Screening (Scenario 2)", screen2Latency);
  timingDisplay("IVMS101 collection (US)", trCollectLatency + benCollectLatency);
  timingDisplay("TRISA VASP exchange (US)", vaspLatency);
  timingDisplay("Screening (Scenario 3)", screen3Latency);
  timingDisplay("IVMS101 collection (EU)", euOrigLatency + euBenLatency);
  timingDisplay("TRISA VASP exchange (EU)", euVaspLatency);
  totalTiming(totalMs);

  const reportPath = reporter.saveHtmlReport();
  console.log();
  console.log(`  ${chalk.gray("HTML report saved:")} ${chalk.cyan.underline(reportPath)}`);
  console.log();
}
