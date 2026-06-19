import chalk from "chalk";
import oraImport from "ora";

import {
  prooflinkLog,
  sectionHeader,
  stepHeader,
  timingDisplay,
  totalTiming,
  formatJson,
  sleep,
  generateReceiptId,
  generateTxHash,
  generateSignature,
  truncateAddress,
} from "../utils/display.js";
import { demoConfig } from "../config.js";
import { DemoReporter } from "../utils/reporter.js";

// ---------------------------------------------------------------------------
// Webhook Demo — Simulated real-time compliance webhooks
// ---------------------------------------------------------------------------

interface WebhookEvent {
  id: string;
  type: string;
  timestamp: string;
  payload: Record<string, unknown>;
}

function generateWebhookId(): string {
  return `wh_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export async function runWebhookDemo(): Promise<void> {
  const ora = oraImport;
  const reporter = new DemoReporter("Real-Time Webhooks");
  const demoStart = Date.now();

  sectionHeader("REAL-TIME WEBHOOK DEMO");

  console.log(chalk.gray("  ProofLink sends real-time webhooks for every compliance event."));
  console.log(chalk.gray("  Integrate with Slack, PagerDuty, ERP systems, or custom dashboards."));
  console.log(chalk.gray("  All payloads are signed with HMAC-SHA256 for authenticity.\n"));

  await sleep(300);

  // ═════════════════════════════════════════════════════════════════════════
  // STEP 1: Register webhook endpoint
  // ═════════════════════════════════════════════════════════════════════════

  stepHeader("\U0001F517", "Registering webhook endpoint...");

  const webhookUrl = `http://localhost:${demoConfig.webhookPort}/webhooks/compliance`;
  console.log(`  ${chalk.gray("Endpoint:")} ${chalk.cyan(webhookUrl)}`);
  console.log(`  ${chalk.gray("Events:")}   ${chalk.white("screening.*, payment.*, travel_rule.*, kya.*")}`);
  console.log(`  ${chalk.gray("Format:")}   ${chalk.white("JSON (application/json)")}`);
  console.log(`  ${chalk.gray("Auth:")}     ${chalk.white("HMAC-SHA256 signature in X-ProofLink-Signature header")}`);
  console.log();

  const spinnerReg = ora({
    text: chalk.gray("Registering webhook subscription..."),
    color: "cyan",
    indent: 2,
  }).start();
  await sleep(300);
  spinnerReg.succeed(chalk.gray("Webhook registered"));

  const subscriptionId = `sub_${Math.random().toString(36).slice(2, 10)}`;
  prooflinkLog(`Subscription ID: ${chalk.white(subscriptionId)}`);
  prooflinkLog(`Secret: ${chalk.white("whsec_" + "x".repeat(32))} ${chalk.gray("(for HMAC verification)")}`);

  reporter.addEvent({
    type: "webhook",
    label: "Webhook endpoint registered",
    status: "passed",
    latencyMs: 300,
  });

  await sleep(500);

  // ═════════════════════════════════════════════════════════════════════════
  // STEP 2: Trigger compliance events + show webhook payloads
  // ═════════════════════════════════════════════════════════════════════════

  stepHeader("\u26A1", "Triggering compliance events...");

  const events: WebhookEvent[] = [];

  // Event 1: Screening cleared
  console.log(chalk.gray("\n  --- Simulating clean address screening ---\n"));

  const spinner1 = ora({
    text: chalk.gray("Processing screening..."),
    color: "cyan",
    indent: 2,
  }).start();
  await sleep(250);
  spinner1.stop();

  const event1: WebhookEvent = {
    id: generateWebhookId(),
    type: "screening.cleared",
    timestamp: new Date().toISOString(),
    payload: {
      address: demoConfig.wallets["cleanVitalik"]!.address,
      label: "vitalik.eth",
      result: "CLEARED",
      riskScore: 3,
      lists: ["OFAC_SDN", "EU_CONSOLIDATED", "UN_CONSOLIDATED", "HMT"],
      latencyMs: 67,
      receiptId: generateReceiptId("scr"),
    },
  };
  events.push(event1);

  prooflinkLog(`${chalk.green("\u2192")} Webhook fired: ${chalk.green.bold("screening.cleared")}`);
  formatJson(`Webhook: ${event1.type}`, {
    id: event1.id,
    type: event1.type,
    timestamp: event1.timestamp,
    data: event1.payload,
    signature: "sha256=" + generateSignature().slice(2, 66),
  });

  reporter.addEvent({
    type: "webhook",
    label: "Webhook: screening.cleared",
    status: "passed",
    latencyMs: 250,
  });

  await sleep(400);

  // Event 2: Screening blocked
  console.log(chalk.gray("\n  --- Simulating sanctioned address screening ---\n"));

  const spinner2 = ora({
    text: chalk.gray("Processing screening..."),
    color: "red",
    indent: 2,
  }).start();
  await sleep(300);
  spinner2.stop();

  const event2: WebhookEvent = {
    id: generateWebhookId(),
    type: "screening.blocked",
    timestamp: new Date().toISOString(),
    payload: {
      address: demoConfig.wallets["sanctionedTornado"]!.address,
      label: "Tornado Cash Deployer",
      result: "BLOCKED",
      riskScore: 99,
      matchedList: "OFAC_SDN",
      matchedEntity: "Tornado Cash",
      confidence: 0.99,
      latencyMs: 89,
      receiptId: generateReceiptId("scr"),
    },
  };
  events.push(event2);

  prooflinkLog(`${chalk.red("\u2192")} Webhook fired: ${chalk.red.bold("screening.blocked")}`);
  formatJson(`Webhook: ${event2.type}`, {
    id: event2.id,
    type: event2.type,
    timestamp: event2.timestamp,
    data: event2.payload,
    signature: "sha256=" + generateSignature().slice(2, 66),
  });

  reporter.addEvent({
    type: "webhook",
    label: "Webhook: screening.blocked",
    status: "passed",
    latencyMs: 300,
  });

  await sleep(400);

  // Event 3: Payment completed
  console.log(chalk.gray("\n  --- Simulating payment settlement ---\n"));

  const spinner3 = ora({
    text: chalk.gray("Processing payment..."),
    color: "magenta",
    indent: 2,
  }).start();
  await sleep(350);
  spinner3.stop();

  const txHash = generateTxHash();
  const event3: WebhookEvent = {
    id: generateWebhookId(),
    type: "payment.settled",
    timestamp: new Date().toISOString(),
    payload: {
      txHash,
      sender: demoConfig.wallets["newAgent"]!.address,
      receiver: demoConfig.wallets["cleanVitalik"]!.address,
      amount: "500.00",
      asset: "USDC",
      chain: "base",
      chainId: 8453,
      protocol: "x402",
      complianceStatus: "COMPLIANT",
      receiptId: generateReceiptId("pl"),
      easAttestationUid: generateTxHash(),
    },
  };
  events.push(event3);

  prooflinkLog(`${chalk.magenta("\u2192")} Webhook fired: ${chalk.magenta.bold("payment.settled")}`);
  formatJson(`Webhook: ${event3.type}`, {
    id: event3.id,
    type: event3.type,
    timestamp: event3.timestamp,
    data: event3.payload,
    signature: "sha256=" + generateSignature().slice(2, 66),
  });

  reporter.addEvent({
    type: "webhook",
    label: "Webhook: payment.settled",
    status: "passed",
    latencyMs: 350,
  });

  await sleep(400);

  // Event 4: Travel Rule triggered
  console.log(chalk.gray("\n  --- Simulating Travel Rule event ---\n"));

  const spinner4 = ora({
    text: chalk.gray("Processing Travel Rule..."),
    color: "yellow",
    indent: 2,
  }).start();
  await sleep(280);
  spinner4.stop();

  const event4: WebhookEvent = {
    id: generateWebhookId(),
    type: "travel_rule.completed",
    timestamp: new Date().toISOString(),
    payload: {
      transferId: generateReceiptId("tr"),
      amount: "15000.00",
      asset: "USDC",
      threshold: 3000,
      originator: {
        name: "Acme AI Corp",
        lei: "254900OPPU84GM83MG36",
        wallet: truncateAddress(demoConfig.wallets["newAgent"]!.address),
      },
      beneficiary: {
        name: "Ethereum Foundation",
        identifier: "vitalik.eth",
        wallet: truncateAddress(demoConfig.wallets["cleanVitalik"]!.address),
      },
      vaspExchange: "COMPLETED",
      protocol: "TRISA",
    },
  };
  events.push(event4);

  prooflinkLog(`${chalk.yellow("\u2192")} Webhook fired: ${chalk.yellow.bold("travel_rule.completed")}`);
  formatJson(`Webhook: ${event4.type}`, {
    id: event4.id,
    type: event4.type,
    timestamp: event4.timestamp,
    data: event4.payload,
    signature: "sha256=" + generateSignature().slice(2, 66),
  });

  reporter.addEvent({
    type: "webhook",
    label: "Webhook: travel_rule.completed",
    status: "passed",
    latencyMs: 280,
  });

  await sleep(400);

  // Event 5: KYA verification
  console.log(chalk.gray("\n  --- Simulating KYA verification event ---\n"));

  const spinner5 = ora({
    text: chalk.gray("Processing KYA verification..."),
    color: "cyan",
    indent: 2,
  }).start();
  await sleep(250);
  spinner5.stop();

  const event5: WebhookEvent = {
    id: generateWebhookId(),
    type: "kya.verified",
    timestamp: new Date().toISOString(),
    payload: {
      agentDid: "did:erc8004:8453:0xRegistry:0042",
      agentWallet: demoConfig.wallets["newAgent"]!.address,
      operator: "Acme AI Corp",
      trustScore: 87,
      autonomyTier: "SEMI_AUTONOMOUS",
      spendingLimit: "$10,000/day",
      verification: "PASSED",
    },
  };
  events.push(event5);

  prooflinkLog(`${chalk.cyan("\u2192")} Webhook fired: ${chalk.cyan.bold("kya.verified")}`);
  formatJson(`Webhook: ${event5.type}`, {
    id: event5.id,
    type: event5.type,
    timestamp: event5.timestamp,
    data: event5.payload,
    signature: "sha256=" + generateSignature().slice(2, 66),
  });

  reporter.addEvent({
    type: "webhook",
    label: "Webhook: kya.verified",
    status: "passed",
    latencyMs: 250,
  });

  // ═════════════════════════════════════════════════════════════════════════
  // STEP 3: Webhook delivery summary
  // ═════════════════════════════════════════════════════════════════════════

  sectionHeader("WEBHOOK DELIVERY SUMMARY");

  const demoEnd = Date.now();
  const totalMs = demoEnd - demoStart;

  console.log(chalk.white.bold("  Events delivered:\n"));

  for (const event of events) {
    const typeColor =
      event.type.includes("blocked") ? chalk.red :
      event.type.includes("cleared") ? chalk.green :
      event.type.includes("payment") ? chalk.magenta :
      event.type.includes("travel") ? chalk.yellow :
      chalk.cyan;

    console.log(
      `    ${typeColor("\u2713")} ${chalk.white(event.type.padEnd(25))} ` +
        `${chalk.gray(event.id)} ` +
        `${chalk.gray(event.timestamp.split("T")[1]?.split(".")[0] ?? "")}`,
    );
  }

  console.log();
  console.log(chalk.white.bold("  Integration examples:\n"));
  console.log(chalk.gray("    Slack:     #compliance-alerts channel for screening.blocked events"));
  console.log(chalk.gray("    PagerDuty: High-urgency alert on screening.blocked"));
  console.log(chalk.gray("    ERP:       Auto-reconcile on payment.settled webhook"));
  console.log(chalk.gray("    Dashboard: Real-time compliance status feed"));
  console.log(chalk.gray("    Audit log: Append all events to immutable compliance log"));
  console.log();

  console.log(chalk.gray("  Pipeline timing:"));
  timingDisplay("Webhook registration", 300);
  timingDisplay("5 webhook deliveries", totalMs - 300);
  totalTiming(totalMs);

  const reportPath = reporter.saveHtmlReport();
  console.log();
  console.log(`  ${chalk.gray("HTML report saved:")} ${chalk.cyan.underline(reportPath)}`);
  console.log();
}
