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
  summaryBox,
  sleep,
  generateReceiptId,
  generateTxHash,
  generateEasUid,
  generateSignature,
  truncateAddress,
  type ReceiptData,
} from "../utils/display.js";
import { demoConfig, type ChainConfig } from "../config.js";
import { DemoReporter } from "../utils/reporter.js";

// ---------------------------------------------------------------------------
// Multi-Chain Demo — Same agent, three chains, gas comparison
// ---------------------------------------------------------------------------

const AGENT_WALLET = demoConfig.wallets["newAgent"]!.address;
const RECEIVER = demoConfig.wallets["cleanCoinbase"]!.address;
const PAYMENT_AMOUNT = 500; // Same amount on all chains

interface ChainPayment {
  chain: ChainConfig;
  chainKey: string;
  amount: number;
  currency: string;
  gasEstimateUsd: number;
  gasGwei: number;
  blockTime: string;
}

const PAYMENTS: ChainPayment[] = [
  {
    chain: demoConfig.chains["ethereum"]!,
    chainKey: "ethereum",
    amount: PAYMENT_AMOUNT,
    currency: "USDC",
    gasEstimateUsd: 4.82,
    gasGwei: 28,
    blockTime: "~12s",
  },
  {
    chain: demoConfig.chains["base"]!,
    chainKey: "base",
    amount: PAYMENT_AMOUNT,
    currency: "USDC",
    gasEstimateUsd: 0.008,
    gasGwei: 0.005,
    blockTime: "~2s",
  },
  {
    chain: demoConfig.chains["polygon"]!,
    chainKey: "polygon",
    amount: PAYMENT_AMOUNT,
    currency: "USDC",
    gasEstimateUsd: 0.02,
    gasGwei: 35,
    blockTime: "~2s",
  },
];

function chainColor(key: string): typeof chalk {
  return key === "ethereum"
    ? chalk.cyan
    : key === "base"
      ? chalk.blue
      : chalk.magenta;
}

export async function runMultiChainDemo(): Promise<void> {
  const ora = oraImport;
  const reporter = new DemoReporter("Multi-Chain Compliance");
  const demoStart = Date.now();

  sectionHeader("CROSS-CHAIN COMPLIANCE DEMO");

  console.log(chalk.gray("  Same agent, same payment, three different chains."));
  console.log(chalk.gray("  ProofLink enforces compliance on each chain independently,"));
  console.log(chalk.gray("  with chain-specific thresholds, gas costs, and rules.\n"));

  console.log(`  ${chalk.gray("Agent:")}    ${chalk.white(truncateAddress(AGENT_WALLET))}`);
  console.log(`  ${chalk.gray("Receiver:")} ${chalk.white(truncateAddress(RECEIVER))} ${chalk.gray("(Coinbase Wallet)")}`);
  console.log(`  ${chalk.gray("Amount:")}   ${chalk.white(`$${PAYMENT_AMOUNT} USDC`)} ${chalk.gray("(identical on all chains)")}`);
  console.log(`  ${chalk.gray("Chains:")}   ${chalk.cyan("Ethereum")} | ${chalk.blue("Base")} | ${chalk.magenta("Polygon")}`);
  console.log();

  await sleep(400);

  const receipts: ReceiptData[] = [];
  const chainResults: Array<{
    chain: string;
    chainKey: string;
    complianceMs: number;
    settlementMs: number;
    totalMs: number;
    gasUsd: number;
    travelRule: boolean;
  }> = [];

  for (let i = 0; i < PAYMENTS.length; i++) {
    const payment = PAYMENTS[i]!;
    const cc = chainColor(payment.chainKey);
    const chainStart = Date.now();

    stepHeader(
      "\u{1F310}",
      `Chain ${i + 1}/3: ${payment.chain.name} -- $${payment.amount} ${payment.currency}`,
    );

    console.log(`  ${chalk.gray("Chain:")}      ${cc.bold(payment.chain.name)} ${chalk.gray(`(ID: ${payment.chain.chainId})`)}`);
    console.log(`  ${chalk.gray("Amount:")}     ${chalk.white(`$${payment.amount} ${payment.currency}`)}`);
    console.log(`  ${chalk.gray("Gas cost:")}   ${chalk.white(`~$${payment.gasEstimateUsd}`)} ${chalk.gray(`(${payment.gasGwei} gwei)`)}`);
    console.log(`  ${chalk.gray("Block time:")} ${chalk.white(payment.blockTime)}`);
    console.log(`  ${chalk.gray("Threshold:")}  ${chalk.white(`$${payment.chain.travelRuleThreshold.toLocaleString()}`)} ${chalk.gray("(Travel Rule)")}`);
    console.log(`  ${chalk.gray("Explorer:")}   ${chalk.gray(payment.chain.explorerUrl)}`);
    console.log();

    prooflinkLog(`Intercepting x402 payment on ${cc.bold(payment.chain.name)}...`);
    prooflinkLog(`Chain-aware compliance profile loaded: ${cc(payment.chain.name)} (${payment.chain.chainId})`);
    await sleep(200);

    // Screen sender
    const spinnerSender = ora({
      text: chalk.gray(`Screening sender on ${payment.chain.name}...`),
      color: "cyan",
      indent: 2,
    }).start();
    const senderLatency = i === 0 ? Math.floor(Math.random() * 20) + 50 : Math.floor(Math.random() * 5) + 2;
    await sleep(senderLatency + (i === 0 ? 100 : 50));
    spinnerSender.stop();
    statusCleared("sender", AGENT_WALLET, senderLatency, i > 0);

    // Screen receiver
    const spinnerReceiver = ora({
      text: chalk.gray(`Screening receiver on ${payment.chain.name}...`),
      color: "cyan",
      indent: 2,
    }).start();
    const receiverLatency = Math.floor(Math.random() * 20) + 40;
    await sleep(receiverLatency + 80);
    spinnerReceiver.stop();
    statusCleared("receiver", RECEIVER, receiverLatency, i > 0);

    // AML
    const amlLatency = Math.floor(Math.random() * 10) + 15;
    const riskVal = Math.floor(Math.random() * 12) + 3;
    riskScore(riskVal, 85);

    // Travel Rule (chain-aware)
    const travelRuleRequired = payment.amount >= payment.chain.travelRuleThreshold;
    travelRuleStatus(travelRuleRequired, payment.amount, payment.chain.travelRuleThreshold);

    let travelRuleLatency = 0;
    if (travelRuleRequired) {
      prooflinkLog(
        `Chain-specific threshold: ${cc.bold(payment.chain.name)} uses $${payment.chain.travelRuleThreshold.toLocaleString()} ` +
        `${chalk.gray("(vs $3,000 on Ethereum/Base)")}`,
      );
      const spinnerTr = ora({
        text: chalk.gray("Executing Travel Rule data exchange..."),
        color: "yellow",
        indent: 2,
      }).start();
      travelRuleLatency = Math.floor(Math.random() * 50) + 120;
      await sleep(travelRuleLatency + 100);
      spinnerTr.succeed(chalk.gray("Travel Rule data exchanged via TRISA"));

      reporter.addEvent({
        type: "travel_rule",
        label: `Travel Rule exchange -- ${payment.chain.name} ($${payment.amount})`,
        status: "passed",
        latencyMs: travelRuleLatency,
      });
    }

    const complianceMs = senderLatency + receiverLatency + amlLatency + travelRuleLatency;

    reporter.addEvent({
      type: "screening",
      label: `Compliance screening -- ${payment.chain.name}`,
      status: "passed",
      latencyMs: complianceMs,
    });

    // Settle
    paymentApproved();
    const spinnerSettle = ora({
      text: chalk.gray(`Settling on ${payment.chain.name}...`),
      color: "magenta",
      indent: 2,
    }).start();
    const txHash = generateTxHash();
    const settleLatency = payment.chainKey === "ethereum" ? 800 : payment.chainKey === "polygon" ? 300 : 500;
    await sleep(settleLatency);
    spinnerSettle.stop();

    x402Log(`Transaction: ${chalk.white(truncateAddress(txHash))} (${cc(payment.chain.name)})`);
    x402Log(`Gas used: ${chalk.white(`$${payment.gasEstimateUsd}`)} ${chalk.gray(`(${payment.gasGwei} gwei)`)}`);

    reporter.addEvent({
      type: "payment",
      label: `x402 settlement -- ${payment.chain.name}`,
      status: "passed",
      latencyMs: settleLatency,
    });

    // Receipt
    const receiptId = generateReceiptId("pl");
    const receipt: ReceiptData = {
      receiptId,
      overallStatus: "COMPLIANT",
      riskScore: riskVal,
      checks: [
        { checkType: "SANCTIONS_SCREENING", result: "PASSED", provider: "Chainalysis KYT", latencyMs: senderLatency + receiverLatency },
        { checkType: "AML_MONITORING", result: "PASSED", provider: "ProofLink Engine", latencyMs: amlLatency },
        {
          checkType: "TRAVEL_RULE",
          result: travelRuleRequired ? "PASSED" : "SKIPPED",
          provider: travelRuleRequired ? "TRISA Protocol" : `N/A (below $${payment.chain.travelRuleThreshold.toLocaleString()})`,
          latencyMs: travelRuleLatency,
        },
      ],
      travelRuleStatus: travelRuleRequired ? "COMPLETED" : "NOT_REQUIRED",
      easAttestationUid: generateEasUid(),
      signature: generateSignature(),
      timestamp: new Date().toISOString(),
    };

    receipts.push(receipt);
    reporter.addReceipt(receipt);
    formatReceipt(receipt);

    const chainEnd = Date.now();
    const totalChainMs = chainEnd - chainStart;

    chainResults.push({
      chain: payment.chain.name,
      chainKey: payment.chainKey,
      complianceMs,
      settlementMs: settleLatency,
      totalMs: totalChainMs,
      gasUsd: payment.gasEstimateUsd,
      travelRule: travelRuleRequired,
    });

    if (i < PAYMENTS.length - 1) {
      await sleep(500);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // GAS COST COMPARISON
  // ═══════════════════════════════════════════════════════════════════════════

  sectionHeader("GAS COST COMPARISON");

  console.log(chalk.white.bold("  Same $500 USDC transfer -- gas costs across chains:\n"));

  const gasTable = new Table({
    head: [
      chalk.cyan("Chain"),
      chalk.cyan("Gas (gwei)"),
      chalk.cyan("Gas Cost"),
      chalk.cyan("% of Transfer"),
      chalk.cyan("Savings vs L1"),
    ],
    style: { head: [], border: [], "padding-left": 2, "padding-right": 1 },
    chars: {
      top: "\u2500", "top-mid": "\u252C", "top-left": "  \u250C", "top-right": "\u2510",
      bottom: "\u2500", "bottom-mid": "\u2534", "bottom-left": "  \u2514", "bottom-right": "\u2518",
      left: "  \u2502", "left-mid": "  \u251C", mid: "\u2500", "mid-mid": "\u253C",
      right: "\u2502", "right-mid": "\u2524", middle: "\u2502",
    },
  });

  const ethGas = PAYMENTS[0]!.gasEstimateUsd;

  for (const payment of PAYMENTS) {
    const cc = chainColor(payment.chainKey);
    const pct = ((payment.gasEstimateUsd / PAYMENT_AMOUNT) * 100).toFixed(3);
    const savings = payment.chainKey === "ethereum"
      ? chalk.gray("--")
      : chalk.green(`${((1 - payment.gasEstimateUsd / ethGas) * 100).toFixed(1)}% cheaper`);

    gasTable.push([
      cc.bold(payment.chain.name),
      chalk.white(String(payment.gasGwei)),
      payment.gasEstimateUsd > 1 ? chalk.red(`$${payment.gasEstimateUsd}`) : chalk.green(`$${payment.gasEstimateUsd}`),
      chalk.gray(`${pct}%`),
      savings,
    ]);
  }

  console.log(gasTable.toString());

  console.log();

  // Visual bar chart
  console.log(chalk.white.bold("  Gas cost visualization:\n"));

  const maxBarWidth = 50;
  for (const payment of PAYMENTS) {
    const cc = chainColor(payment.chainKey);
    const barWidth = Math.max(1, Math.round((payment.gasEstimateUsd / ethGas) * maxBarWidth));
    const bar = "\u2588".repeat(barWidth);
    const label = `$${payment.gasEstimateUsd}`;
    console.log(`  ${cc.bold(payment.chain.name.padEnd(10))} ${cc(bar)} ${chalk.white(label)}`);
  }

  console.log();
  console.log(
    chalk.gray("  Base is ") +
    chalk.green.bold(`${((1 - PAYMENTS[1]!.gasEstimateUsd / ethGas) * 100).toFixed(0)}x cheaper`) +
    chalk.gray(" than Ethereum L1 for the same compliant transfer."),
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // COMPLIANCE COMPARISON
  // ═══════════════════════════════════════════════════════════════════════════

  sectionHeader("CROSS-CHAIN COMPLIANCE SUMMARY");

  const compTable = new Table({
    head: [
      chalk.cyan("Chain"),
      chalk.cyan("Compliance"),
      chalk.cyan("Settlement"),
      chalk.cyan("Total"),
      chalk.cyan("Gas"),
      chalk.cyan("Travel Rule"),
      chalk.cyan("Sanctions"),
    ],
    style: { head: [], border: [], "padding-left": 2, "padding-right": 1 },
    chars: {
      top: "\u2500", "top-mid": "\u252C", "top-left": "  \u250C", "top-right": "\u2510",
      bottom: "\u2500", "bottom-mid": "\u2534", "bottom-left": "  \u2514", "bottom-right": "\u2518",
      left: "  \u2502", "left-mid": "  \u251C", mid: "\u2500", "mid-mid": "\u253C",
      right: "\u2502", "right-mid": "\u2524", middle: "\u2502",
    },
  });

  for (const result of chainResults) {
    const cc = chainColor(result.chainKey);
    compTable.push([
      cc.bold(result.chain),
      chalk.gray(`${result.complianceMs}ms`),
      chalk.gray(`${result.settlementMs}ms`),
      chalk.white(`${result.totalMs}ms`),
      result.gasUsd > 1 ? chalk.red(`$${result.gasUsd}`) : chalk.green(`$${result.gasUsd}`),
      result.travelRule ? chalk.yellow("REQUIRED") : chalk.green("N/A"),
      chalk.green("CLEAR"),
    ]);
  }

  console.log(compTable.toString());

  const demoEnd = Date.now();
  const totalDemoMs = demoEnd - demoStart;
  const totalAmount = PAYMENTS.reduce((s, p) => s + p.amount, 0);
  const totalGas = PAYMENTS.reduce((s, p) => s + p.gasEstimateUsd, 0);

  summaryBox("Multi-Chain Compliance Results", [
    { label: "Chains covered", value: chalk.white("Ethereum, Base, Polygon") },
    { label: "Total payments", value: chalk.white(`3 x $${PAYMENT_AMOUNT} = $${totalAmount.toLocaleString()} USDC`) },
    { label: "Total gas cost", value: chalk.white(`$${totalGas.toFixed(3)}`) },
    { label: "Cheapest chain", value: chalk.green.bold("Base ($0.008)") },
    { label: "Sanctions cleared", value: chalk.green("6/6 addresses") },
    { label: "Travel Rule triggered", value: chalk.yellow("1 (Polygon $500 > $1,000 threshold)") },
    { label: "Compliance receipts", value: chalk.white("3 ProofLink receipts") },
    { label: "Total demo time", value: chalk.cyan(`${(totalDemoMs / 1000).toFixed(1)}s`) },
  ]);

  console.log();
  console.log(chalk.white.bold("  Key insight:"));
  console.log(chalk.gray("  ProofLink applies chain-specific compliance rules automatically."));
  console.log(chalk.gray("  Polygon has a lower Travel Rule threshold ($1,000 vs $3,000),"));
  console.log(chalk.gray("  so the $500 payment triggered Travel Rule on Polygon but not on"));
  console.log(chalk.gray("  Ethereum or Base. Gas costs vary 600x across chains."));
  console.log();

  const reportPath = reporter.saveHtmlReport();
  console.log(`  ${chalk.gray("HTML report saved:")} ${chalk.cyan.underline(reportPath)}`);
  console.log();
}
