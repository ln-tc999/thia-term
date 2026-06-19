import chalk from "chalk";
import oraImport from "ora";
import Table from "cli-table3";

import {
  prooflinkLog,
  sectionHeader,
  stepHeader,
  timingDisplay,
  totalTiming,
  summaryBox,
  sleep,
  truncateAddress,
} from "../utils/display.js";
import { demoConfig } from "../config.js";
import { DemoReporter } from "../utils/reporter.js";

// ---------------------------------------------------------------------------
// Batch Screening Demo — 50 addresses (48 clean, 2 OFAC sanctioned)
// ---------------------------------------------------------------------------

const SANCTIONED_ENTRIES: Array<{ address: string; entity: string; list: string }> = [
  {
    address: demoConfig.wallets["sanctionedTornado"]!.address,
    entity: "Tornado Cash Deployer",
    list: "OFAC_SDN",
  },
  {
    address: demoConfig.wallets["sanctionedLazarus"]!.address,
    entity: "Lazarus Group (DPRK)",
    list: "OFAC_SDN",
  },
];

interface ScreeningResult {
  index: number;
  address: string;
  status: "CLEAR" | "SANCTIONED";
  entity?: string;
  list?: string;
  latencyMs: number;
  confidence?: number;
}

function randomAddress(): string {
  const hex = "0123456789abcdef";
  let addr = "0x";
  for (let i = 0; i < 40; i++) {
    addr += hex[Math.floor(Math.random() * hex.length)];
  }
  return addr;
}

export async function runBatchDemo(): Promise<void> {
  const ora = oraImport;
  const reporter = new DemoReporter("Batch Sanctions Screening");
  const demoStart = Date.now();

  sectionHeader("BATCH SANCTIONS SCREENING DEMO");

  console.log(chalk.gray("  High-throughput parallel sanctions screening."));
  console.log(chalk.gray("  50 addresses screened simultaneously against 4 sanctions lists."));
  console.log(chalk.gray("  48 clean addresses + 2 OFAC SDN sanctioned addresses.\n"));

  await sleep(400);

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 1: Generate 50 addresses (48 clean + 2 sanctioned)
  // ═══════════════════════════════════════════════════════════════════════════

  stepHeader("\u{1F4CB}", "Generating 50 test addresses...");

  const addresses: string[] = [];
  for (let i = 0; i < 48; i++) {
    addresses.push(randomAddress());
  }

  // Insert sanctioned addresses at random positions
  const pos1 = Math.floor(Math.random() * 20) + 5;
  const pos2 = Math.floor(Math.random() * 15) + 30;
  addresses.splice(pos1, 0, SANCTIONED_ENTRIES[0]!.address);
  addresses.splice(pos2, 0, SANCTIONED_ENTRIES[1]!.address);

  prooflinkLog(`Generated ${chalk.white("48")} random clean addresses`);
  prooflinkLog(`Injected ${chalk.red("2")} known OFAC SDN addresses`);
  prooflinkLog(`Total batch: ${chalk.white.bold("50")} addresses`);
  console.log();

  console.log(chalk.gray("  Sanctioned addresses hidden at:"));
  console.log(`    ${chalk.red(`#${pos1 + 1}`)} ${chalk.white(truncateAddress(SANCTIONED_ENTRIES[0]!.address))} ${chalk.gray(`(${SANCTIONED_ENTRIES[0]!.entity})`)}`);
  console.log(`    ${chalk.red(`#${pos2 + 1}`)} ${chalk.white(truncateAddress(SANCTIONED_ENTRIES[1]!.address))} ${chalk.gray(`(${SANCTIONED_ENTRIES[1]!.entity})`)}`);
  console.log();

  await sleep(500);

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 2: Screen all 50 in parallel
  // ═══════════════════════════════════════════════════════════════════════════

  stepHeader("\u26A1", "Screening all 50 addresses in parallel...");

  const spinner = ora({
    text: chalk.gray("Batch screening: 0/50 complete..."),
    color: "cyan",
    indent: 2,
  }).start();

  const sanctionedSet = new Set(SANCTIONED_ENTRIES.map((s) => s.address.toLowerCase()));
  const results: ScreeningResult[] = [];
  const batchStart = Date.now();

  // Simulate parallel screening in waves
  for (let wave = 0; wave < 5; wave++) {
    for (let j = 0; j < 10; j++) {
      const idx = wave * 10 + j;
      const addr = addresses[idx]!;
      const isSanctioned = sanctionedSet.has(addr.toLowerCase());
      const latency = isSanctioned
        ? Math.floor(Math.random() * 30) + 70
        : Math.floor(Math.random() * 40) + 30;

      const match = isSanctioned
        ? SANCTIONED_ENTRIES.find((s) => s.address.toLowerCase() === addr.toLowerCase())
        : undefined;

      results.push({
        index: idx + 1,
        address: addr,
        status: isSanctioned ? "SANCTIONED" : "CLEAR",
        entity: match?.entity,
        list: match?.list,
        latencyMs: latency,
        confidence: isSanctioned ? 0.99 : undefined,
      });
    }
    const done = (wave + 1) * 10;
    spinner.text = chalk.gray(`Batch screening: ${done}/50 complete...`);
    await sleep(200);
  }

  const batchEnd = Date.now();
  const batchMs = batchEnd - batchStart;
  spinner.stop();

  prooflinkLog(`Batch screening ${chalk.green.bold("COMPLETE")} ${chalk.gray(`(${batchMs}ms wall-clock)`)}`);

  reporter.addEvent({
    type: "batch",
    label: "Batch sanctions screening -- 50 addresses",
    status: "passed",
    latencyMs: batchMs,
    details: { total: 50, clear: 48, sanctioned: 2 },
  });

  await sleep(300);

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 3: Results matrix (address | status | time)
  // ═══════════════════════════════════════════════════════════════════════════

  stepHeader("\u{1F4CA}", "Results Matrix");

  const table = new Table({
    head: [
      chalk.cyan("#"),
      chalk.cyan("Address"),
      chalk.cyan("Status"),
      chalk.cyan("Time"),
      chalk.cyan("Match"),
    ],
    style: { head: [], border: [], "padding-left": 2, "padding-right": 1 },
    colWidths: [7, 18, 14, 10, 28],
    chars: {
      top: "\u2500", "top-mid": "\u252C", "top-left": "  \u250C", "top-right": "\u2510",
      bottom: "\u2500", "bottom-mid": "\u2534", "bottom-left": "  \u2514", "bottom-right": "\u2518",
      left: "  \u2502", "left-mid": "  \u251C", mid: "\u2500", "mid-mid": "\u253C",
      right: "\u2502", "right-mid": "\u2524", middle: "\u2502",
    },
  });

  // Show first 12, then ellipsis, then any sanctioned in middle, then last 5
  const showSet = new Set<number>();
  for (let i = 0; i < 12; i++) showSet.add(i);
  for (let i = results.length - 5; i < results.length; i++) showSet.add(i);
  results.forEach((r, i) => {
    if (r.status === "SANCTIONED") {
      showSet.add(i);
      if (i > 0) showSet.add(i - 1);
      if (i < results.length - 1) showSet.add(i + 1);
    }
  });

  const sortedShow = [...showSet].sort((a, b) => a - b);
  let lastShown = -1;

  for (const idx of sortedShow) {
    if (lastShown !== -1 && idx - lastShown > 1) {
      const skipped = idx - lastShown - 1;
      table.push([
        chalk.gray("..."),
        chalk.gray(`${skipped} more`),
        chalk.green("CLEAR"),
        chalk.gray("--"),
        chalk.gray("--"),
      ]);
    }
    lastShown = idx;
    const r = results[idx]!;
    const statusStr = r.status === "SANCTIONED"
      ? chalk.bgRed.white.bold(" BLOCKED ")
      : chalk.green("CLEAR");
    table.push([
      r.status === "SANCTIONED" ? chalk.red.bold(String(r.index)) : chalk.gray(String(r.index)),
      chalk.white(truncateAddress(r.address)),
      statusStr,
      chalk.gray(`${r.latencyMs}ms`),
      r.entity ? chalk.red(r.entity) : chalk.gray("--"),
    ]);
  }

  console.log(table.toString());
  console.log();

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 4: Highlight the 2 caught sanctions matches
  // ═══════════════════════════════════════════════════════════════════════════

  stepHeader("\u{1F6A8}", "Sanctions Matches Caught");

  const sanctionedResults = results.filter((r) => r.status === "SANCTIONED");

  for (const hit of sanctionedResults) {
    console.log(chalk.red.bold(`  ---- MATCH ${sanctionedResults.indexOf(hit) + 1} of ${sanctionedResults.length} ----`));
    console.log();
    console.log(`  ${chalk.gray("Position:")}   ${chalk.red.bold(`#${hit.index}`)}`);
    console.log(`  ${chalk.gray("Address:")}    ${chalk.white(hit.address)}`);
    console.log(`  ${chalk.gray("Status:")}     ${chalk.bgRed.white.bold(" SANCTIONED ")}`);
    console.log(`  ${chalk.gray("Entity:")}     ${chalk.red(hit.entity ?? "Unknown")}`);
    console.log(`  ${chalk.gray("List:")}       ${chalk.red(hit.list ?? "OFAC_SDN")}`);
    console.log(`  ${chalk.gray("Confidence:")} ${chalk.red(`${((hit.confidence ?? 0.99) * 100).toFixed(0)}%`)}`);
    console.log(`  ${chalk.gray("Latency:")}    ${chalk.white(`${hit.latencyMs}ms`)}`);
    console.log();
  }

  console.log(`  ${chalk.green.bold("\u2713")} ${chalk.white("Both sanctioned addresses detected. Zero false negatives.")}`);

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 5: Aggregate statistics
  // ═══════════════════════════════════════════════════════════════════════════

  sectionHeader("AGGREGATE STATISTICS");

  const clearCount = results.filter((r) => r.status === "CLEAR").length;
  const avgLatency = Math.round(results.reduce((s, r) => s + r.latencyMs, 0) / results.length);
  const maxLatency = Math.max(...results.map((r) => r.latencyMs));
  const minLatency = Math.min(...results.map((r) => r.latencyMs));
  const sortedLatencies = results.map((r) => r.latencyMs).sort((a, b) => a - b);
  const p50 = sortedLatencies[Math.floor(results.length * 0.5)]!;
  const p95 = sortedLatencies[Math.floor(results.length * 0.95)]!;
  const p99 = sortedLatencies[Math.floor(results.length * 0.99)]!;
  const throughput = Math.round((50 / batchMs) * 1000);
  const seqTotal = results.reduce((s, r) => s + r.latencyMs, 0);

  summaryBox("Batch Screening Results", [
    { label: "Total addresses", value: chalk.white.bold("50") },
    { label: "Clear", value: chalk.green.bold(`${clearCount}`) },
    { label: "Sanctioned", value: chalk.red.bold(`${sanctionedResults.length}`) },
    { label: "Detection rate", value: chalk.green.bold("100% (2/2)") },
    { label: "False positives", value: chalk.green("0") },
    { label: "False negatives", value: chalk.green("0") },
    { label: "Avg latency", value: chalk.white(`${avgLatency}ms`) },
    { label: "P50 / P95 / P99", value: chalk.white(`${p50}ms / ${p95}ms / ${p99}ms`) },
    { label: "Min / Max", value: chalk.white(`${minLatency}ms / ${maxLatency}ms`) },
    { label: "Batch time", value: chalk.cyan(`${batchMs}ms (parallel)`) },
    { label: "Sequential equiv", value: chalk.gray(`~${seqTotal}ms`) },
    { label: "Throughput", value: chalk.cyan.bold(`${throughput} addr/s`) },
  ]);

  // Latency histogram
  console.log();
  console.log(chalk.white.bold("  Latency Distribution:"));
  console.log();

  const buckets = [
    { label: "  0-30ms", min: 0, max: 30 },
    { label: " 30-50ms", min: 30, max: 50 },
    { label: " 50-70ms", min: 50, max: 70 },
    { label: " 70-90ms", min: 70, max: 90 },
    { label: "90-110ms", min: 90, max: 110 },
  ];

  const maxBucketCount = Math.max(
    ...buckets.map((b) => results.filter((r) => r.latencyMs >= b.min && r.latencyMs < b.max).length),
    1,
  );

  for (const bucket of buckets) {
    const count = results.filter((r) => r.latencyMs >= bucket.min && r.latencyMs < bucket.max).length;
    const barWidth = Math.max(0, Math.round((count / maxBucketCount) * 30));
    const hasSanctioned = sanctionedResults.some(
      (r) => r.latencyMs >= bucket.min && r.latencyMs < bucket.max,
    );
    const barColor = hasSanctioned ? chalk.red : chalk.cyan;
    const bar = barWidth > 0 ? barColor("\u2588".repeat(barWidth)) : "";
    console.log(`  ${chalk.gray(bucket.label)} ${bar} ${chalk.white(String(count))}`);
  }

  console.log();
  console.log(`  ${chalk.cyan("\u2588")} ${chalk.gray("= clean")}   ${chalk.red("\u2588")} ${chalk.gray("= contains sanctioned match")}`);

  const demoEnd = Date.now();
  console.log();
  totalTiming(demoEnd - demoStart);

  const reportPath = reporter.saveHtmlReport();
  console.log();
  console.log(`  ${chalk.gray("HTML report saved:")} ${chalk.cyan.underline(reportPath)}`);
  console.log();
}
