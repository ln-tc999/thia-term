import chalk from "chalk";
import Table from "cli-table3";

// ---------------------------------------------------------------------------
// ASCII Art Banner
// ---------------------------------------------------------------------------

const BANNER = `
${chalk.cyan.bold("  ╔══════════════════════════════════════════════════════════════════╗")}
${chalk.cyan.bold("  ║")}                                                                  ${chalk.cyan.bold("║")}
${chalk.cyan.bold("  ║")}  ${chalk.cyan("  ███████╗██╗      ██████╗ ██╗    ██╗██╗     ██╗███╗   ██╗██╗  ██╗")}${chalk.cyan.bold("║")}
${chalk.cyan.bold("  ║")}  ${chalk.cyan("  ██╔════╝██║     ██╔═══██╗██║    ██║██║     ██║████╗  ██║██║ ██╔╝")}${chalk.cyan.bold("║")}
${chalk.cyan.bold("  ║")}  ${chalk.white.bold("  █████╗  ██║     ██║   ██║██║ █╗ ██║██║     ██║██╔██╗ ██║█████╔╝ ")}${chalk.cyan.bold("║")}
${chalk.cyan.bold("  ║")}  ${chalk.white.bold("  ██╔══╝  ██║     ██║   ██║██║███╗██║██║     ██║██║╚██╗██║██╔═██╗ ")}${chalk.cyan.bold("║")}
${chalk.cyan.bold("  ║")}  ${chalk.cyan("  ██║     ███████╗╚██████╔╝╚███╔███╔╝███████╗██║██║ ╚████║██║  ██╗")}${chalk.cyan.bold("║")}
${chalk.cyan.bold("  ║")}  ${chalk.cyan("  ╚═╝     ╚══════╝ ╚═════╝  ╚══╝╚══╝ ╚══════╝╚═╝╚═╝  ╚═══╝╚═╝  ╚═╝")}${chalk.cyan.bold("║")}
${chalk.cyan.bold("  ║")}                                                                  ${chalk.cyan.bold("║")}
${chalk.cyan.bold("  ║")}  ${chalk.gray("  Compliance-as-Infrastructure for the Agentic Economy")}          ${chalk.cyan.bold("║")}
${chalk.cyan.bold("  ║")}  ${chalk.gray("  Sanctions | KYA | Travel Rule | ProofLink | x402")}              ${chalk.cyan.bold("║")}
${chalk.cyan.bold("  ║")}                                                                  ${chalk.cyan.bold("║")}
${chalk.cyan.bold("  ╚══════════════════════════════════════════════════════════════════╝")}
`;

export function printBanner(): void {
  console.log(BANNER);
}

// ---------------------------------------------------------------------------
// Tag-based logging (matches demo script terminal output style)
// ---------------------------------------------------------------------------

export function prooflinkLog(message: string): void {
  console.log(`${chalk.cyan.bold("[ProofLink]")} ${message}`);
}

export function agentLog(message: string): void {
  console.log(`${chalk.yellow.bold("[Agent]")}    ${message}`);
}

export function x402Log(message: string): void {
  console.log(`${chalk.magenta.bold("[x402]")}     ${message}`);
}

// ---------------------------------------------------------------------------
// Status display helpers
// ---------------------------------------------------------------------------

export function statusCleared(label: string, address: string, timeMs: number, cached = false): void {
  const addr = truncateAddress(address);
  const cacheTag = cached ? chalk.gray(", cached") : "";
  prooflinkLog(
    `Screening ${label}: ${chalk.white(addr)} -> ${chalk.green.bold("CLEARED")} ${chalk.gray(`(${timeMs}ms${cacheTag})`)}`,
  );
}

export function statusBlocked(
  label: string,
  address: string,
  timeMs: number,
  matchInfo?: { list: string; entity: string; confidence: number },
): void {
  const addr = truncateAddress(address);
  prooflinkLog(
    `Screening ${label}: ${chalk.white(addr)} -> ${chalk.red.bold("BLOCKED")} ${chalk.gray(`(${timeMs}ms)`)}`,
  );
  if (matchInfo) {
    prooflinkLog(
      `Match: ${chalk.red(matchInfo.list)} | ${chalk.red(matchInfo.entity)} | Confidence: ${chalk.red(String(matchInfo.confidence))}`,
    );
  }
}

export function riskScore(score: number, threshold: number): void {
  const color = score < 30 ? chalk.green : score < 60 ? chalk.yellow : chalk.red;
  const level = score < 30 ? "LOW RISK" : score < 60 ? "MEDIUM RISK" : "HIGH RISK";
  const thresholdNote = score >= threshold ? ` ${chalk.red("EXCEEDS threshold")}` : "";
  prooflinkLog(`AML risk score: ${color.bold(`${score}/100`)} ${chalk.gray(`(${level})`)}${thresholdNote}`);
}

export function travelRuleStatus(required: boolean, amount?: number, threshold?: number): void {
  if (required) {
    prooflinkLog(
      `Travel Rule: ${chalk.yellow.bold("REQUIRED")} ${chalk.gray(`(amount $${amount?.toLocaleString()} above $${threshold?.toLocaleString()} threshold)`)}`,
    );
  } else {
    prooflinkLog(
      `Travel Rule: ${chalk.green("Not required")} ${chalk.gray(`(amount below $${threshold?.toLocaleString() ?? "3,000"} threshold)`)}`,
    );
  }
}

export function paymentApproved(): void {
  prooflinkLog(`Payment ${chalk.green.bold("APPROVED")}. Settling via x402...`);
}

export function paymentRejected(code: string): void {
  prooflinkLog(`Payment ${chalk.red.bold("REJECTED")}. Compliance code: ${chalk.red(code)}`);
}

// ---------------------------------------------------------------------------
// Section headers
// ---------------------------------------------------------------------------

export function sectionHeader(title: string): void {
  console.log();
  console.log(chalk.cyan("  ─────────────────────────────────────────────────────────"));
  console.log(chalk.cyan.bold(`  ${title}`));
  console.log(chalk.cyan("  ─────────────────────────────────────────────────────────"));
  console.log();
}

export function stepHeader(emoji: string, title: string): void {
  console.log();
  console.log(`  ${emoji} ${chalk.white.bold(title)}`);
  console.log();
}

// ---------------------------------------------------------------------------
// Timing display
// ---------------------------------------------------------------------------

export function timingDisplay(label: string, ms: number): void {
  const color = ms < 100 ? chalk.green : ms < 500 ? chalk.yellow : chalk.red;
  console.log(`  ${chalk.gray("⏱")}  ${label}: ${color.bold(`${ms}ms`)}`);
}

export function totalTiming(ms: number): void {
  console.log();
  console.log(
    `  ${chalk.gray("⏱")}  ${chalk.white.bold("Total pipeline")}: ${chalk.cyan.bold(`${ms}ms`)} ${chalk.gray(`(${(ms / 1000).toFixed(2)}s)`)}`,
  );
}

// ---------------------------------------------------------------------------
// Receipt formatting
// ---------------------------------------------------------------------------

export interface ReceiptData {
  receiptId: string;
  overallStatus: "COMPLIANT" | "BLOCKED" | "REVIEW_REQUIRED";
  riskScore: number;
  checks: Array<{
    checkType: string;
    result: "PASSED" | "FAILED" | "SKIPPED";
    provider: string;
    latencyMs: number;
  }>;
  travelRuleStatus: string;
  easAttestationUid?: string;
  ipfsCid?: string;
  signature: string;
  timestamp: string;
}

export function formatReceipt(receipt: ReceiptData): void {
  console.log();
  console.log(chalk.cyan.bold("  ┌─────────────────────────────────────────────────────┐"));
  console.log(chalk.cyan.bold("  │") + chalk.white.bold("       ProofLink Compliance Receipt              ") + chalk.cyan.bold("  │"));
  console.log(chalk.cyan.bold("  └─────────────────────────────────────────────────────┘"));
  console.log();

  const statusColor =
    receipt.overallStatus === "COMPLIANT"
      ? chalk.green.bold
      : receipt.overallStatus === "BLOCKED"
        ? chalk.red.bold
        : chalk.yellow.bold;

  console.log(`  ${chalk.gray("Receipt ID:")}      ${chalk.white(receipt.receiptId)}`);
  console.log(`  ${chalk.gray("Status:")}          ${statusColor(receipt.overallStatus)}`);
  console.log(`  ${chalk.gray("Risk Score:")}      ${receipt.riskScore}/100`);
  console.log(`  ${chalk.gray("Travel Rule:")}     ${receipt.travelRuleStatus}`);
  console.log(`  ${chalk.gray("Timestamp:")}       ${receipt.timestamp}`);
  if (receipt.easAttestationUid) {
    console.log(`  ${chalk.gray("EAS Attestation:")} ${chalk.white(receipt.easAttestationUid)}`);
  }
  if (receipt.ipfsCid) {
    console.log(`  ${chalk.gray("IPFS Archive:")}    ${chalk.white(receipt.ipfsCid)}`);
  }
  console.log(`  ${chalk.gray("Signature:")}       ${chalk.white(receipt.signature)}`);

  console.log();
  console.log(chalk.gray("  Checks Performed:"));

  const table = new Table({
    head: [
      chalk.cyan("Check"),
      chalk.cyan("Result"),
      chalk.cyan("Provider"),
      chalk.cyan("Latency"),
    ],
    style: { head: [], border: [], "padding-left": 2, "padding-right": 1 },
    chars: {
      top: "─",
      "top-mid": "┬",
      "top-left": "  ┌",
      "top-right": "┐",
      bottom: "─",
      "bottom-mid": "┴",
      "bottom-left": "  └",
      "bottom-right": "┘",
      left: "  │",
      "left-mid": "  ├",
      mid: "─",
      "mid-mid": "┼",
      right: "│",
      "right-mid": "┤",
      middle: "│",
    },
  });

  for (const check of receipt.checks) {
    const resultColor =
      check.result === "PASSED"
        ? chalk.green
        : check.result === "FAILED"
          ? chalk.red
          : chalk.gray;
    table.push([
      chalk.white(check.checkType),
      resultColor(check.result),
      chalk.gray(check.provider),
      chalk.gray(`${check.latencyMs}ms`),
    ]);
  }

  console.log(table.toString());
}

// ---------------------------------------------------------------------------
// JSON display (formatted, colorized)
// ---------------------------------------------------------------------------

export function formatJson(label: string, data: Record<string, unknown>): void {
  console.log();
  console.log(`  ${chalk.cyan.bold(label)}`);
  const json = JSON.stringify(data, null, 2);
  const lines = json.split("\n");
  for (const line of lines) {
    // Colorize keys vs values
    const colored = line
      .replace(/"([^"]+)":/g, `${chalk.cyan('"$1"')}:`)
      .replace(/: "([^"]+)"/g, `: ${chalk.green('"$1"')}`)
      .replace(/: (\d+)/g, `: ${chalk.yellow("$1")}`)
      .replace(/: (true|false)/g, `: ${chalk.magenta("$1")}`);
    console.log(`  ${colored}`);
  }
}

// ---------------------------------------------------------------------------
// Invoice display
// ---------------------------------------------------------------------------

export interface InvoiceDisplay {
  invoiceId: string;
  seller: string;
  buyer: string;
  lineItems: Array<{ description: string; quantity: number; unitPrice: number; total: number }>;
  totalAmount: number;
  currency: string;
  chain: string;
  status: string;
}

export function formatInvoice(invoice: InvoiceDisplay): void {
  console.log();
  console.log(chalk.cyan.bold("  ┌─────────────────────────────────────────────────────┐"));
  console.log(chalk.cyan.bold("  │") + chalk.white.bold("       ProofLink Compliant Invoice                ") + chalk.cyan.bold("  │"));
  console.log(chalk.cyan.bold("  └─────────────────────────────────────────────────────┘"));
  console.log();

  console.log(`  ${chalk.gray("Invoice ID:")}  ${chalk.white(invoice.invoiceId)}`);
  console.log(`  ${chalk.gray("Seller:")}      ${chalk.white(invoice.seller)}`);
  console.log(`  ${chalk.gray("Buyer:")}       ${chalk.white(invoice.buyer)}`);
  console.log(`  ${chalk.gray("Chain:")}       ${chalk.white(invoice.chain)}`);
  console.log(`  ${chalk.gray("Status:")}      ${chalk.green.bold(invoice.status)}`);
  console.log();

  const table = new Table({
    head: [
      chalk.cyan("Description"),
      chalk.cyan("Qty"),
      chalk.cyan("Unit Price"),
      chalk.cyan("Total"),
    ],
    style: { head: [], border: [], "padding-left": 2, "padding-right": 1 },
    chars: {
      top: "─",
      "top-mid": "┬",
      "top-left": "  ┌",
      "top-right": "┐",
      bottom: "─",
      "bottom-mid": "┴",
      "bottom-left": "  └",
      "bottom-right": "┘",
      left: "  │",
      "left-mid": "  ├",
      mid: "─",
      "mid-mid": "┼",
      right: "│",
      "right-mid": "┤",
      middle: "│",
    },
  });

  for (const item of invoice.lineItems) {
    table.push([
      chalk.white(item.description),
      chalk.gray(String(item.quantity)),
      chalk.gray(`$${item.unitPrice.toFixed(4)}`),
      chalk.white(`$${item.total.toFixed(2)}`),
    ]);
  }

  console.log(table.toString());
  console.log();
  console.log(`  ${chalk.white.bold("Total:")} ${chalk.green.bold(`$${invoice.totalAmount.toFixed(2)} ${invoice.currency}`)}`);
}

// ---------------------------------------------------------------------------
// Summary box
// ---------------------------------------------------------------------------

export function summaryBox(title: string, lines: Array<{ label: string; value: string }>): void {
  const maxLabel = Math.max(...lines.map((l) => l.label.length));
  console.log();
  console.log(chalk.green.bold("  ┌─────────────────────────────────────────────────────────┐"));
  console.log(chalk.green.bold("  │") + chalk.white.bold(`  ${title}`.padEnd(57)) + chalk.green.bold("│"));
  console.log(chalk.green.bold("  ├─────────────────────────────────────────────────────────┤"));
  for (const line of lines) {
    // Strip ANSI escape codes (CSI sequences) to measure visible width
    const stripAnsi = (s: string): string =>
      s.replace(/\u001B\[[\x30-\x3F]*[\x20-\x2F]*[\x40-\x7E]/g, "");
    const raw = `  ${line.label.padEnd(maxLabel + 2)}${stripAnsi(line.value)}`;
    const visibleLen = raw.length;
    const padNeeded = Math.max(0, 57 - visibleLen);
    const content = `  ${chalk.gray(line.label.padEnd(maxLabel + 2))}${line.value}${" ".repeat(padNeeded)}`;
    console.log(chalk.green.bold("  │") + content + chalk.green.bold("│"));
  }
  console.log(chalk.green.bold("  └─────────────────────────────────────────────────────────┘"));
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

export function truncateAddress(address: string): string {
  if (address.length <= 12) return address;
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Simulate a timed operation with a spinner.
 * Returns the simulated latency in ms.
 */
export async function simulateWithSpinner(
  ora: typeof import("ora").default,
  text: string,
  minMs: number,
  maxMs: number,
): Promise<number> {
  const spinner = ora({ text, color: "cyan" }).start();
  const latency = Math.floor(Math.random() * (maxMs - minMs)) + minMs;
  await sleep(latency);
  spinner.stop();
  return latency;
}

/**
 * Generate a random receipt ID in ProofLink format.
 */
export function generateReceiptId(prefix = "pl"): string {
  const chars = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
  let id = `${prefix}_`;
  for (let i = 0; i < 22; i++) {
    id += chars[Math.floor(Math.random() * chars.length)];
  }
  return id;
}

/**
 * Generate a fake transaction hash.
 */
export function generateTxHash(): string {
  const hex = "0123456789abcdef";
  let hash = "0x";
  for (let i = 0; i < 64; i++) {
    hash += hex[Math.floor(Math.random() * hex.length)];
  }
  return hash;
}

/**
 * Generate a fake EAS attestation UID.
 */
export function generateEasUid(): string {
  return generateTxHash();
}

/**
 * Generate a fake IPFS CID.
 */
export function generateIpfsCid(): string {
  const chars = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let cid = "Qm";
  for (let i = 0; i < 44; i++) {
    cid += chars[Math.floor(Math.random() * chars.length)];
  }
  return cid;
}

/**
 * Generate a fake EIP-712 signature.
 */
export function generateSignature(): string {
  return `0x${Array.from({ length: 130 }, () => "0123456789abcdef"[Math.floor(Math.random() * 16)]).join("")}`;
}

// ---------------------------------------------------------------------------
// Progress step with timing
// ---------------------------------------------------------------------------

export interface StepTimingResult {
  label: string;
  latencyMs: number;
  status: "passed" | "failed" | "skipped";
}

/**
 * Execute a simulated step with spinner, timing, and status display.
 */
export async function timedStep(
  ora: typeof import("ora").default,
  label: string,
  minMs: number,
  maxMs: number,
  opts?: { color?: string; indent?: number; successText?: string },
): Promise<StepTimingResult> {
  const start = Date.now();
  const spinner = ora({
    text: chalk.gray(label),
    color: (opts?.color ?? "cyan") as import("ora").Color,
    indent: opts?.indent ?? 2,
  }).start();

  const latency = Math.floor(Math.random() * (maxMs - minMs)) + minMs;
  await sleep(latency);

  if (opts?.successText) {
    spinner.succeed(chalk.gray(opts.successText));
  } else {
    spinner.stop();
  }

  return { label, latencyMs: Date.now() - start, status: "passed" };
}

// ---------------------------------------------------------------------------
// Progress bar (simple ASCII)
// ---------------------------------------------------------------------------

export function progressBar(current: number, total: number, width = 30): string {
  const ratio = Math.min(current / total, 1);
  const filled = Math.round(ratio * width);
  const empty = width - filled;
  const bar = chalk.cyan("\u2588".repeat(filled)) + chalk.gray("\u2591".repeat(empty));
  const pct = `${Math.round(ratio * 100)}%`;
  return `${bar} ${chalk.white(pct)}`;
}

// ---------------------------------------------------------------------------
// Divider
// ---------------------------------------------------------------------------

export function divider(char = "\u2500", width = 57): void {
  console.log(chalk.gray(`  ${char.repeat(width)}`));
}

// ---------------------------------------------------------------------------
// Key-value display
// ---------------------------------------------------------------------------

export function keyValue(key: string, value: string, indent = 2): void {
  const pad = " ".repeat(indent);
  console.log(`${pad}${chalk.gray(key + ":")} ${value}`);
}

// ---------------------------------------------------------------------------
// Countdown display
// ---------------------------------------------------------------------------

export function countdownLabel(current: number, total: number, label: string): string {
  return `${chalk.gray(`[${current}/${total}]`)} ${chalk.white(label)}`;
}
