#!/usr/bin/env node

import chalk from "chalk";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";

import { printBanner, sectionHeader } from "./utils/display.js";
import { runSanctionsDemo } from "./scenarios/sanctions-demo.js";
import { runPaymentDemo } from "./scenarios/payment-demo.js";
import { runFullDemo } from "./scenarios/full-demo.js";
import { runKyaDemo } from "./scenarios/kya-demo.js";
import { runTravelRuleDemo } from "./scenarios/travel-rule-demo.js";
import { runMultiChainDemo } from "./scenarios/multi-chain-demo.js";
import { runBatchDemo } from "./scenarios/batch-demo.js";
import { runInvoiceDemo } from "./scenarios/invoice-demo.js";
import { runInteractiveMode } from "./interactive.js";

// ---------------------------------------------------------------------------
// Scenario registry
// ---------------------------------------------------------------------------

interface ScenarioEntry {
  name: string;
  description: string;
  duration: string;
  run: () => Promise<void>;
}

const SCENARIOS: Record<string, ScenarioEntry> = {
  sanctions: {
    name: "Sanctions Screening",
    description: "Screen OFAC SDN addresses in real-time",
    duration: "30s",
    run: runSanctionsDemo,
  },
  payment: {
    name: "x402 Payment",
    description: "Full compliant payment pipeline",
    duration: "60s",
    run: runPaymentDemo,
  },
  full: {
    name: "Full Hackathon Demo",
    description: "Complete 3-minute showcase",
    duration: "3min",
    run: runFullDemo,
  },
  kya: {
    name: "Know Your Agent",
    description: "Agent identity verification flow",
    duration: "90s",
    run: runKyaDemo,
  },
  "travel-rule": {
    name: "Travel Rule Compliance",
    description: "US ($3K) + EU/MiCA (EUR 1K) with IVMS101 data",
    duration: "90s",
    run: runTravelRuleDemo,
  },
  "multi-chain": {
    name: "Cross-Chain Compliance",
    description: "Ethereum/Base/Polygon with gas cost comparison",
    duration: "2min",
    run: runMultiChainDemo,
  },
  batch: {
    name: "Batch Screening",
    description: "50 addresses (48 clean, 2 OFAC) screened in parallel",
    duration: "45s",
    run: runBatchDemo,
  },
  invoice: {
    name: "Invoice Lifecycle",
    description: "Invoice -> compliance -> payment -> receipt",
    duration: "90s",
    run: runInvoiceDemo,
  },
};

const SCENARIO_KEYS = Object.keys(SCENARIOS);

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

interface DemoArgs {
  sanctions: boolean;
  payment: boolean;
  full: boolean;
  scenario: string | undefined;
  interactive: boolean;
  all: boolean;
  list: boolean;
}

async function main(): Promise<void> {
  const argv = (await yargs(hideBin(process.argv))
    .scriptName("prooflink-demo")
    .usage("$0 [options]")
    .option("sanctions", {
      alias: "s",
      type: "boolean",
      default: false,
      describe: "Run sanctions screening demo",
    })
    .option("payment", {
      alias: "p",
      type: "boolean",
      default: false,
      describe: "Run x402 compliant payment demo",
    })
    .option("full", {
      alias: "f",
      type: "boolean",
      default: false,
      describe: "Run full 3-minute hackathon demo",
    })
    .option("scenario", {
      type: "string",
      describe: `Run a specific scenario (${SCENARIO_KEYS.join(", ")})`,
    })
    .option("interactive", {
      alias: "i",
      type: "boolean",
      default: false,
      describe: "Launch interactive mode with CLI menu",
    })
    .option("all", {
      alias: "a",
      type: "boolean",
      default: false,
      describe: "Run all scenarios sequentially",
    })
    .option("list", {
      alias: "l",
      type: "boolean",
      default: false,
      describe: "List all available demo scenarios",
    })
    .example("$0 --scenario travel-rule", "Run the Travel Rule demo")
    .example("$0 --scenario batch", "Run batch screening of 50 addresses")
    .example("$0 --scenario invoice", "Run invoice lifecycle demo")
    .example("$0 --interactive", "Launch interactive demo selector")
    .example("$0 --all", "Run all scenarios sequentially")
    .example("$0 --list", "List all available scenarios")
    .help()
    .version("0.2.0")
    .strict()
    .parse()) as DemoArgs;

  // List mode
  if (argv.list) {
    printBanner();
    listScenarios();
    return;
  }

  // --all: run all scenarios sequentially
  if (argv.all) {
    sectionHeader("RUNNING ALL SCENARIOS");
    const startAll = Date.now();
    let count = 0;
    const entries = Object.entries(SCENARIOS);
    for (const [key, scenario] of entries) {
      count++;
      console.log(
        chalk.cyan.bold(`\n  [${count}/${entries.length}] `) +
        chalk.white.bold(scenario.name) +
        chalk.gray(` (${key})`),
      );
      await scenario.run();
    }
    const elapsed = ((Date.now() - startAll) / 1000).toFixed(1);
    sectionHeader("ALL SCENARIOS COMPLETE");
    console.log(
      `  ${chalk.green.bold("\u2713")} Ran ${chalk.white.bold(String(count))} scenarios in ${chalk.cyan.bold(`${elapsed}s`)}`,
    );
    console.log();
    return;
  }

  // Interactive mode
  if (argv.interactive) {
    await runInteractiveMode();
    return;
  }

  // Scenario flag
  if (argv.scenario) {
    const scenario = SCENARIOS[argv.scenario];
    if (!scenario) {
      console.error(chalk.red(`\n  Unknown scenario: "${argv.scenario}"`));
      console.error(chalk.gray(`  Available: ${SCENARIO_KEYS.join(", ")}\n`));
      process.exit(1);
    }
    printBanner();
    await scenario.run();
    return;
  }

  // Legacy boolean flags
  const noneSelected = !argv.sanctions && !argv.payment && !argv.full;

  if (noneSelected) {
    await showMenu();
    return;
  }

  printBanner();

  if (argv.sanctions) {
    await runSanctionsDemo();
  }
  if (argv.payment) {
    await runPaymentDemo();
  }
  if (argv.full) {
    await runFullDemo();
  }
}

// ---------------------------------------------------------------------------
// List all scenarios
// ---------------------------------------------------------------------------

function listScenarios(): void {
  sectionHeader("AVAILABLE DEMO SCENARIOS");

  for (const [key, scenario] of Object.entries(SCENARIOS)) {
    console.log(
      `  ${chalk.cyan.bold(key.padEnd(14))} ${chalk.white(scenario.name.padEnd(25))} ` +
        `${chalk.gray(scenario.description)} ${chalk.gray(`(${scenario.duration})`)}`,
    );
  }

  console.log();
  console.log(chalk.gray("  Usage:"));
  console.log(chalk.gray("    prooflink-demo --scenario <name>"));
  console.log(chalk.gray("    prooflink-demo --interactive"));
  console.log();
}

// ---------------------------------------------------------------------------
// Quick menu (when no flags passed)
// ---------------------------------------------------------------------------

async function showMenu(): Promise<void> {
  printBanner();
  sectionHeader("SELECT A DEMO");

  console.log(chalk.white("  Available demos:\n"));

  const entries = Object.entries(SCENARIOS);
  for (let idx = 0; idx < entries.length; idx++) {
    const [key, scenario] = entries[idx]!;
    const num = String(idx + 1);
    console.log(
      `  ${chalk.cyan.bold(`[${num}]`)} ${chalk.white(scenario.name.padEnd(25))} ` +
        `${chalk.gray(`-- ${scenario.description} (${scenario.duration})`)}`,
    );
    void key; // used implicitly via entries index
  }

  console.log();
  console.log(
    `  ${chalk.cyan.bold("[a]")} ${chalk.white("All Demos")}                 ${chalk.gray("-- Run everything sequentially")}`,
  );
  console.log(
    `  ${chalk.cyan.bold("[i]")} ${chalk.white("Interactive Mode")}          ${chalk.gray("-- Full menu with custom params")}`,
  );
  console.log();

  console.log(chalk.gray("  Tip: Use --scenario <name> or --interactive for more options"));
  console.log();

  const choice = await readKey(entries.length);

  if (choice === "i") {
    await runInteractiveMode();
    return;
  }

  if (choice === "a") {
    for (const [, scenario] of entries) {
      await scenario.run();
    }
    return;
  }

  const idx = parseInt(choice, 10) - 1;
  if (idx >= 0 && idx < entries.length) {
    const [, scenario] = entries[idx]!;
    await scenario.run();
    return;
  }

  console.log(chalk.yellow("\n  No valid selection. Use --help for usage.\n"));
}

/**
 * Read a single keypress from stdin.
 */
function readKey(maxNum: number): Promise<string> {
  return new Promise((resolve) => {
    process.stdout.write(chalk.cyan.bold(`  > Select demo [1-${maxNum}/a/i]: `));

    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
    }
    process.stdin.resume();
    process.stdin.setEncoding("utf8");

    const onData = (key: string): void => {
      process.stdin.removeListener("data", onData);
      if (process.stdin.isTTY) {
        process.stdin.setRawMode(false);
      }
      process.stdin.pause();

      // Handle Ctrl+C
      if (key === "\u0003") {
        console.log();
        process.exit(0);
      }

      console.log(key.trim());
      resolve(key.trim());
    };

    process.stdin.on("data", onData);
  });
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

main().catch((error: unknown) => {
  console.error(chalk.red("\n  Fatal error:"), error);
  process.exit(1);
});
