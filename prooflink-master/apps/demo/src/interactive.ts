// ---------------------------------------------------------------------------
// Interactive CLI — menu-driven demo selection with custom parameters
// ---------------------------------------------------------------------------

import chalk from "chalk";
import oraImport from "ora";

import {
  printBanner,
  sectionHeader,
  stepHeader,
  prooflinkLog,
  statusCleared,
  statusBlocked,
  riskScore,
  travelRuleStatus,
  formatReceipt,
  sleep,
  generateReceiptId,
  generateSignature,
  truncateAddress,
  type ReceiptData,
} from "./utils/display.js";
import { demoConfig } from "./config.js";
import { runSanctionsDemo } from "./scenarios/sanctions-demo.js";
import { runPaymentDemo } from "./scenarios/payment-demo.js";
import { runFullDemo } from "./scenarios/full-demo.js";
import { runKyaDemo } from "./scenarios/kya-demo.js";
import { runTravelRuleDemo } from "./scenarios/travel-rule-demo.js";
import { runMultiChainDemo } from "./scenarios/multi-chain-demo.js";
import { runBatchDemo } from "./scenarios/batch-demo.js";
import { runInvoiceDemo } from "./scenarios/invoice-demo.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DemoOption {
  value: string;
  title: string;
  description: string;
  duration: string;
  run: () => Promise<void>;
}

// ---------------------------------------------------------------------------
// Demo registry
// ---------------------------------------------------------------------------

const DEMOS: DemoOption[] = [
  {
    value: "sanctions",
    title: "Sanctions Screening",
    description: "Screen OFAC SDN addresses in real-time",
    duration: "30s",
    run: runSanctionsDemo,
  },
  {
    value: "payment",
    title: "x402 Payment",
    description: "Full compliant payment pipeline",
    duration: "60s",
    run: runPaymentDemo,
  },
  {
    value: "full",
    title: "Full Hackathon Demo",
    description: "Complete 3-minute showcase (block + pay + receipt)",
    duration: "3min",
    run: runFullDemo,
  },
  {
    value: "kya",
    title: "Know Your Agent (KYA)",
    description: "Agent registration, identity verification, and payment",
    duration: "90s",
    run: runKyaDemo,
  },
  {
    value: "travel-rule",
    title: "Travel Rule Compliance",
    description: "US + EU/MiCA Travel Rule with IVMS101 data exchange",
    duration: "90s",
    run: runTravelRuleDemo,
  },
  {
    value: "multi-chain",
    title: "Cross-Chain Compliance",
    description: "Same payment on Ethereum, Base, Polygon with gas comparison",
    duration: "2min",
    run: runMultiChainDemo,
  },
  {
    value: "batch",
    title: "Batch Screening",
    description: "Screen 50 addresses in parallel (48 clean, 2 sanctioned)",
    duration: "45s",
    run: runBatchDemo,
  },
  {
    value: "invoice",
    title: "Invoice Lifecycle",
    description: "Full invoice -> compliance -> payment -> receipt flow",
    duration: "90s",
    run: runInvoiceDemo,
  },
];

// ---------------------------------------------------------------------------
// Interactive entry point
// ---------------------------------------------------------------------------

export async function runInteractiveMode(): Promise<void> {
  printBanner();

  // Dynamic import for prompts (ESM)
  const { default: prompts } = await import("prompts");

  sectionHeader("INTERACTIVE MODE");

  const onCancel = (): void => {
    console.log(chalk.gray("\n  Cancelled.\n"));
    process.exit(0);
  };

  // Main menu
  const { action } = await prompts(
    {
      type: "select",
      name: "action",
      message: "What would you like to do?",
      choices: [
        { title: `${chalk.cyan("Run demo scenario")}`, description: "Select from available demos", value: "scenario" },
        { title: `${chalk.yellow("Custom compliance check")}`, description: "Check specific sender/receiver/amount/chain", value: "compliance" },
        { title: `${chalk.red("Custom sanctions screen")}`, description: "Screen a specific address", value: "sanctions" },
        { title: `${chalk.gray("Exit")}`, value: "exit" },
      ],
    },
    { onCancel },
  );

  switch (action) {
    case "scenario":
      await selectAndRunScenarios(prompts, onCancel);
      break;
    case "compliance":
      await runCustomComplianceCheck(prompts, onCancel);
      break;
    case "sanctions":
      await runCustomSanctionsScreen(prompts, onCancel);
      break;
    case "exit":
      console.log(chalk.gray("\n  Goodbye.\n"));
      break;
    default:
      break;
  }
}

// ---------------------------------------------------------------------------
// Scenario selection
// ---------------------------------------------------------------------------

async function selectAndRunScenarios(
  prompts: typeof import("prompts"),
  onCancel: () => void,
): Promise<void> {
  const { scenarios } = await prompts(
    {
      type: "multiselect",
      name: "scenarios",
      message: "Select demo scenario(s) to run",
      choices: DEMOS.map((d) => ({
        title: `${d.title} ${chalk.gray(`(${d.duration})`)}`,
        description: d.description,
        value: d.value,
      })),
      min: 1,
      hint: "- Space to select, Enter to confirm",
      instructions: false,
    },
    { onCancel },
  );

  if (!scenarios || scenarios.length === 0) {
    console.log(chalk.yellow("\n  No scenarios selected.\n"));
    return;
  }

  console.log();
  console.log(
    chalk.cyan.bold("  Running ") +
    chalk.white.bold(`${scenarios.length} scenario${scenarios.length > 1 ? "s" : ""}`) +
    chalk.cyan.bold("..."),
  );

  const overallStart = Date.now();

  for (const scenarioKey of scenarios as string[]) {
    const demo = DEMOS.find((d) => d.value === scenarioKey);
    if (demo) {
      await demo.run();
    }
  }

  const overallMs = Date.now() - overallStart;

  sectionHeader("ALL DEMOS COMPLETE");
  console.log(
    `  ${chalk.green.bold("\u2713")} Ran ${chalk.white.bold(String(scenarios.length))} scenario${scenarios.length > 1 ? "s" : ""} ` +
    `in ${chalk.cyan.bold(`${(overallMs / 1000).toFixed(1)}s`)}`,
  );
  console.log();
}

// ---------------------------------------------------------------------------
// Custom compliance check
// ---------------------------------------------------------------------------

async function runCustomComplianceCheck(
  prompts: typeof import("prompts"),
  onCancel: () => void,
): Promise<void> {
  const ora = oraImport;

  sectionHeader("CUSTOM COMPLIANCE CHECK");

  const { sender } = await prompts(
    {
      type: "text",
      name: "sender",
      message: "Sender address",
      initial: demoConfig.wallets["newAgent"]!.address,
      validate: (val: string) =>
        /^0x[a-fA-F0-9]{40}$/.test(val) ? true : "Invalid Ethereum address (0x + 40 hex chars)",
    },
    { onCancel },
  );

  const { receiver } = await prompts(
    {
      type: "text",
      name: "receiver",
      message: "Receiver address",
      initial: demoConfig.wallets["cleanVitalik"]!.address,
      validate: (val: string) =>
        /^0x[a-fA-F0-9]{40}$/.test(val) ? true : "Invalid Ethereum address (0x + 40 hex chars)",
    },
    { onCancel },
  );

  const { amount } = await prompts(
    {
      type: "number",
      name: "amount",
      message: "Payment amount (USD)",
      initial: 500,
      min: 1,
      max: 1000000,
    },
    { onCancel },
  );

  const chainChoices = Object.entries(demoConfig.chains).map(([key, chain]) => ({
    title: `${chain.name} (ID: ${chain.chainId})`,
    value: key,
  }));

  const { chain } = await prompts(
    {
      type: "select",
      name: "chain",
      message: "Select chain",
      choices: chainChoices,
      initial: 1,
    },
    { onCancel },
  );

  const chainConfig = demoConfig.chains[chain as string]!;

  console.log();
  stepHeader("\u{1F50D}", "Running compliance check...");

  console.log(`  ${chalk.gray("Sender:")}   ${chalk.white(sender)}`);
  console.log(`  ${chalk.gray("Receiver:")} ${chalk.white(receiver)}`);
  console.log(`  ${chalk.gray("Amount:")}   ${chalk.white(`$${amount}`)} USDC`);
  console.log(`  ${chalk.gray("Chain:")}    ${chalk.white(chainConfig.name)}`);
  console.log();

  prooflinkLog("Intercepting compliance check...");
  await sleep(200);

  // Screen sender
  const spinnerSender = ora({
    text: chalk.gray("Screening sender..."),
    color: "cyan",
    indent: 2,
  }).start();
  const senderLatency = Math.floor(Math.random() * 30) + 50;
  await sleep(senderLatency + 100);
  spinnerSender.stop();

  const senderIsSanctioned = Object.values(demoConfig.wallets)
    .filter((w) => w.status === "sanctioned")
    .some((w) => w.address.toLowerCase() === sender.toLowerCase());

  if (senderIsSanctioned) {
    const match = Object.values(demoConfig.wallets).find(
      (w) => w.address.toLowerCase() === sender.toLowerCase(),
    );
    statusBlocked("sender", sender, senderLatency, {
      list: "OFAC_SDN",
      entity: match?.label ?? "Unknown",
      confidence: 0.99,
    });
  } else {
    statusCleared("sender", sender, senderLatency);
  }

  // Screen receiver
  const spinnerReceiver = ora({
    text: chalk.gray("Screening receiver..."),
    color: "cyan",
    indent: 2,
  }).start();
  const receiverLatency = Math.floor(Math.random() * 25) + 45;
  await sleep(receiverLatency + 100);
  spinnerReceiver.stop();

  const receiverIsSanctioned = Object.values(demoConfig.wallets)
    .filter((w) => w.status === "sanctioned")
    .some((w) => w.address.toLowerCase() === receiver.toLowerCase());

  if (receiverIsSanctioned) {
    const match = Object.values(demoConfig.wallets).find(
      (w) => w.address.toLowerCase() === receiver.toLowerCase(),
    );
    statusBlocked("receiver", receiver, receiverLatency, {
      list: "OFAC_SDN",
      entity: match?.label ?? "Unknown",
      confidence: 0.99,
    });
  } else {
    statusCleared("receiver", receiver, receiverLatency);
  }

  // AML risk
  const riskVal = senderIsSanctioned || receiverIsSanctioned ? 95 : Math.floor(Math.random() * 15) + 3;
  riskScore(riskVal, 85);

  // Travel Rule
  const travelRuleRequired = amount >= chainConfig.travelRuleThreshold;
  travelRuleStatus(travelRuleRequired, amount, chainConfig.travelRuleThreshold);

  // Generate receipt
  const isBlocked = senderIsSanctioned || receiverIsSanctioned;
  const receiptId = generateReceiptId("pl");

  const receipt: ReceiptData = {
    receiptId,
    overallStatus: isBlocked ? "BLOCKED" : "COMPLIANT",
    riskScore: riskVal,
    checks: [
      {
        checkType: "SANCTIONS_SCREENING",
        result: isBlocked ? "FAILED" : "PASSED",
        provider: "Chainalysis KYT",
        latencyMs: senderLatency + receiverLatency,
      },
      {
        checkType: "AML_MONITORING",
        result: isBlocked ? "SKIPPED" : "PASSED",
        provider: "ProofLink Engine",
        latencyMs: isBlocked ? 0 : 15,
      },
      {
        checkType: "TRAVEL_RULE",
        result: travelRuleRequired && !isBlocked ? "PASSED" : "SKIPPED",
        provider: travelRuleRequired ? "TRISA Protocol" : `N/A (below $${chainConfig.travelRuleThreshold.toLocaleString()})`,
        latencyMs: 0,
      },
    ],
    travelRuleStatus: travelRuleRequired ? "REQUIRED" : "NOT_REQUIRED",
    signature: generateSignature(),
    timestamp: new Date().toISOString(),
  };

  formatReceipt(receipt);

  if (isBlocked) {
    console.log(`  ${chalk.red.bold("\u{1F6D1}")} ${chalk.red.bold("PAYMENT WOULD BE BLOCKED")}`);
  } else {
    console.log(`  ${chalk.green.bold("\u2713")} ${chalk.green.bold("PAYMENT WOULD BE APPROVED")}`);
  }
  console.log();
}

// ---------------------------------------------------------------------------
// Custom sanctions screen
// ---------------------------------------------------------------------------

async function runCustomSanctionsScreen(
  prompts: typeof import("prompts"),
  onCancel: () => void,
): Promise<void> {
  const ora = oraImport;

  sectionHeader("CUSTOM SANCTIONS SCREEN");

  const { address } = await prompts(
    {
      type: "text",
      name: "address",
      message: "Address to screen",
      validate: (val: string) =>
        /^0x[a-fA-F0-9]{40}$/.test(val) ? true : "Invalid Ethereum address (0x + 40 hex chars)",
    },
    { onCancel },
  );

  console.log();
  console.log(`  ${chalk.gray("Screening:")} ${chalk.white(address)}`);
  console.log();

  const spinner = ora({
    text: chalk.gray("Screening against OFAC_SDN, EU_CONSOLIDATED, UN_CONSOLIDATED, HMT..."),
    color: "cyan",
    indent: 2,
  }).start();

  const latency = Math.floor(Math.random() * 30) + 60;
  await sleep(latency + 200);
  spinner.stop();

  const isSanctioned = Object.values(demoConfig.wallets)
    .filter((w) => w.status === "sanctioned")
    .some((w) => w.address.toLowerCase() === address.toLowerCase());

  if (isSanctioned) {
    const match = Object.values(demoConfig.wallets).find(
      (w) => w.address.toLowerCase() === address.toLowerCase(),
    );
    statusBlocked("address", address, latency, {
      list: "OFAC_SDN",
      entity: match?.label ?? "Unknown Entity",
      confidence: 0.99,
    });

    console.log();
    console.log(`  ${chalk.red.bold("\u{1F6A8} SANCTIONED")} -- This address is on the OFAC SDN list.`);
    console.log(`  ${chalk.gray("Entity:")} ${chalk.red(match?.label ?? "Unknown")}`);
    console.log(`  ${chalk.gray("Description:")} ${chalk.gray(match?.description ?? "")}`);
  } else {
    statusCleared("address", address, latency);
    riskScore(Math.floor(Math.random() * 15) + 2, 85);

    console.log();
    console.log(`  ${chalk.green.bold("\u2713 CLEAR")} -- No sanctions matches found.`);
  }

  console.log(`  ${chalk.gray("Latency:")} ${chalk.white(`${latency}ms`)}`);
  console.log(`  ${chalk.gray("Lists checked:")} ${chalk.white("OFAC_SDN, EU_CONSOLIDATED, UN_CONSOLIDATED, HMT")}`);
  console.log();
}
