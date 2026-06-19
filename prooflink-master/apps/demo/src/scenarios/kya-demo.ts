import chalk from "chalk";
import oraImport from "ora";

import {
  prooflinkLog,
  agentLog,
  x402Log,
  statusCleared,
  riskScore,
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
  generateSignature,
  truncateAddress,
  type ReceiptData,
} from "../utils/display.js";
import { demoConfig } from "../config.js";
import { DemoReporter } from "../utils/reporter.js";

// ---------------------------------------------------------------------------
// KYA Demo — Agent identity verification flow
// ---------------------------------------------------------------------------

const AGENT_WALLET = demoConfig.wallets["newAgent"]!.address;
const RECEIVER_WALLET = demoConfig.wallets["cleanVitalik"]!.address;
const AGENT_DID = "did:erc8004:8453:0xAgentRegistry:0042";
const OPERATOR_LEI = "254900OPPU84GM83MG36";

export async function runKyaDemo(): Promise<void> {
  const ora = oraImport;
  const reporter = new DemoReporter("KYA Verification");
  const pipelineStart = Date.now();

  sectionHeader("KNOW YOUR AGENT (KYA) DEMO");

  console.log(chalk.gray("  Demonstrating the full agent identity lifecycle:"));
  console.log(chalk.gray("  1. Register agent with ERC-8004 identity"));
  console.log(chalk.gray("  2. Verify KYA credential against operator"));
  console.log(chalk.gray("  3. Execute a payment using verified identity\n"));

  await sleep(400);

  // ═════════════════════════════════════════════════════════════════════════
  // STEP 1: Agent Registration
  // ═════════════════════════════════════════════════════════════════════════

  stepHeader("\U0001F4DD", "Registering agent on ERC-8004 registry...");

  console.log(`  ${chalk.gray("Agent wallet:")}  ${chalk.white(AGENT_WALLET)}`);
  console.log(`  ${chalk.gray("Agent DID:")}     ${chalk.cyan(AGENT_DID)}`);
  console.log(`  ${chalk.gray("Operator:")}      ${chalk.white("Acme AI Corp")}`);
  console.log(`  ${chalk.gray("Operator LEI:")} ${chalk.white(OPERATOR_LEI)}`);
  console.log();

  const spinnerReg = ora({
    text: chalk.gray("Submitting agent registration to ERC-8004 registry..."),
    color: "cyan",
    indent: 2,
  }).start();

  const regLatency = Math.floor(Math.random() * 30) + 120;
  await sleep(regLatency + 200);
  spinnerReg.succeed(chalk.gray("Agent registered on-chain"));

  prooflinkLog(`Agent DID: ${chalk.cyan(AGENT_DID)}`);
  prooflinkLog(`Registration tx: ${chalk.white(truncateAddress(generateTxHash()))}`);
  prooflinkLog(`Chain: ${chalk.white("Base (8453)")}`);

  reporter.addEvent({
    type: "kya",
    label: "Agent registration on ERC-8004",
    status: "passed",
    latencyMs: regLatency,
    details: { agentDid: AGENT_DID, chain: "Base" },
  });

  console.log();
  timingDisplay("Registration", regLatency);

  await sleep(500);

  // ═════════════════════════════════════════════════════════════════════════
  // STEP 2: KYA Credential Verification
  // ═════════════════════════════════════════════════════════════════════════

  stepHeader("\U0001F50D", "Verifying KYA credential...");

  console.log(chalk.gray("  ProofLink verifies the agent's identity chain:\n"));

  // Sub-step: Resolve DID
  const spinnerDid = ora({
    text: chalk.gray("Resolving agent DID document..."),
    color: "cyan",
    indent: 2,
  }).start();
  const didLatency = Math.floor(Math.random() * 10) + 15;
  await sleep(didLatency + 100);
  spinnerDid.stop();
  prooflinkLog(`DID resolution: ${chalk.green.bold("RESOLVED")} ${chalk.gray(`(${didLatency}ms)`)}`);

  reporter.addEvent({
    type: "kya",
    label: "DID document resolution",
    status: "passed",
    latencyMs: didLatency,
  });

  // Sub-step: Verify operator LEI
  const spinnerLei = ora({
    text: chalk.gray("Verifying operator LEI with GLEIF..."),
    color: "cyan",
    indent: 2,
  }).start();
  const leiLatency = Math.floor(Math.random() * 20) + 40;
  await sleep(leiLatency + 100);
  spinnerLei.stop();
  prooflinkLog(`Operator LEI: ${chalk.green.bold("VERIFIED")} ${chalk.gray(`(${leiLatency}ms)`)}`);
  prooflinkLog(`  Entity: ${chalk.white("Acme AI Corp")} | Jurisdiction: ${chalk.white("US-DE")}`);
  prooflinkLog(`  LEI status: ${chalk.green("ISSUED")} | Next renewal: ${chalk.gray("2027-01-15")}`);

  reporter.addEvent({
    type: "kya",
    label: "Operator LEI verification (GLEIF)",
    status: "passed",
    latencyMs: leiLatency,
  });

  // Sub-step: Check operator sanctions
  const spinnerOpSanctions = ora({
    text: chalk.gray("Screening operator entity..."),
    color: "cyan",
    indent: 2,
  }).start();
  const opSanctionsLatency = Math.floor(Math.random() * 15) + 25;
  await sleep(opSanctionsLatency + 80);
  spinnerOpSanctions.stop();
  prooflinkLog(`Operator sanctions: ${chalk.green.bold("CLEARED")} ${chalk.gray(`(${opSanctionsLatency}ms)`)}`);

  reporter.addEvent({
    type: "screening",
    label: "Operator entity sanctions screening",
    status: "passed",
    latencyMs: opSanctionsLatency,
  });

  // Sub-step: Validate agent autonomy tier
  const spinnerTier = ora({
    text: chalk.gray("Validating agent autonomy classification..."),
    color: "cyan",
    indent: 2,
  }).start();
  const tierLatency = Math.floor(Math.random() * 8) + 10;
  await sleep(tierLatency + 80);
  spinnerTier.stop();
  prooflinkLog(`Autonomy tier: ${chalk.white("SEMI_AUTONOMOUS")} ${chalk.gray("(Tier 2 of 4)")}`);
  prooflinkLog(`  Spending limit: ${chalk.white("$10,000/day")} | Approval: ${chalk.white("auto < $5,000")}`);

  // Sub-step: Compute trust score
  const spinnerTrust = ora({
    text: chalk.gray("Computing composite trust score..."),
    color: "cyan",
    indent: 2,
  }).start();
  const trustLatency = Math.floor(Math.random() * 10) + 20;
  await sleep(trustLatency + 100);
  spinnerTrust.stop();

  const trustScore = 87;
  prooflinkLog(`Trust score: ${chalk.green.bold(`${trustScore}/100`)} ${chalk.gray(`(${trustLatency}ms)`)}`);
  prooflinkLog(`  Components:`);
  prooflinkLog(`    Operator reputation:   ${chalk.green("92/100")}`);
  prooflinkLog(`    Transaction history:   ${chalk.green("85/100")}`);
  prooflinkLog(`    Identity completeness: ${chalk.green("90/100")}`);
  prooflinkLog(`    Time on registry:      ${chalk.yellow("72/100")} ${chalk.gray("(< 6 months)")}`);

  reporter.addEvent({
    type: "kya",
    label: "Trust score computation",
    status: "passed",
    latencyMs: trustLatency,
    details: { trustScore },
  });

  console.log();
  console.log(`  ${chalk.green.bold("\u2713")} ${chalk.green.bold("KYA credential fully verified")}`);

  const kyaTotalLatency = didLatency + leiLatency + opSanctionsLatency + tierLatency + trustLatency;
  console.log();
  timingDisplay("Total KYA verification", kyaTotalLatency);

  await sleep(600);

  // ═════════════════════════════════════════════════════════════════════════
  // STEP 3: Payment with Verified Identity
  // ═════════════════════════════════════════════════════════════════════════

  stepHeader("\U0001F4B0", "Executing payment with verified agent identity...");

  console.log(`  ${chalk.gray("From:")}    ${chalk.white(truncateAddress(AGENT_WALLET))} ${chalk.gray("(KYA verified)")}`);
  console.log(`  ${chalk.gray("To:")}      ${chalk.white(truncateAddress(RECEIVER_WALLET))}`);
  console.log(`  ${chalk.gray("Amount:")}  ${chalk.white("250 USDC")} on ${chalk.white("Base")}`);
  console.log();

  agentLog("Initiating payment with KYA credential attached...");
  await sleep(200);

  prooflinkLog("Intercepting x402 payment...");
  prooflinkLog(`KYA credential: ${chalk.green.bold("ATTACHED")} ${chalk.gray("(pre-verified, skip re-check)")}`);
  await sleep(150);

  // Screen addresses
  const spinnerScreen = ora({
    text: chalk.gray("Screening addresses..."),
    color: "cyan",
    indent: 2,
  }).start();
  const screenLatency = Math.floor(Math.random() * 15) + 35;
  await sleep(screenLatency + 100);
  spinnerScreen.stop();

  statusCleared("sender", AGENT_WALLET, 3, true);
  statusCleared("receiver", RECEIVER_WALLET, screenLatency);
  riskScore(6, 85);

  reporter.addEvent({
    type: "screening",
    label: "Sender + receiver screening",
    status: "passed",
    latencyMs: screenLatency,
  });

  paymentApproved();
  await sleep(200);

  const spinnerSettle = ora({
    text: chalk.gray("Settling on Base via x402..."),
    color: "magenta",
    indent: 2,
  }).start();
  const txHash = generateTxHash();
  await sleep(600);
  spinnerSettle.stop();

  x402Log(`Transaction: ${chalk.white(truncateAddress(txHash))} (Base)`);

  reporter.addEvent({
    type: "payment",
    label: "x402 settlement on Base",
    status: "passed",
    latencyMs: 600,
    details: { txHash: truncateAddress(txHash), amount: 250 },
  });

  // Generate receipt
  const receiptId = generateReceiptId("pl");
  const easUid = generateEasUid();
  const signature = generateSignature();

  prooflinkLog(`ProofLink receipt: ${chalk.white(receiptId)}`);
  prooflinkLog(`EAS attestation: ${chalk.white(truncateAddress(easUid))}`);

  const receipt: ReceiptData = {
    receiptId,
    overallStatus: "COMPLIANT",
    riskScore: 6,
    checks: [
      { checkType: "KYA_VERIFICATION", result: "PASSED", provider: "ERC-8004 Registry", latencyMs: kyaTotalLatency },
      { checkType: "OPERATOR_LEI", result: "PASSED", provider: "GLEIF API", latencyMs: leiLatency },
      { checkType: "SANCTIONS_SCREENING", result: "PASSED", provider: "Chainalysis KYT", latencyMs: screenLatency },
      { checkType: "AML_MONITORING", result: "PASSED", provider: "ProofLink Engine", latencyMs: 12 },
      { checkType: "TRAVEL_RULE", result: "SKIPPED", provider: "N/A (below threshold)", latencyMs: 0 },
    ],
    travelRuleStatus: "NOT_REQUIRED",
    easAttestationUid: easUid,
    signature,
    timestamp: new Date().toISOString(),
  };

  reporter.addReceipt(receipt);
  formatReceipt(receipt);

  // KYA credential JSON
  formatJson("KYA Credential (Verifiable)", {
    "@context": ["https://www.w3.org/2018/credentials/v1", "https://prooflink.finance/kya/v1"],
    type: ["VerifiableCredential", "KnowYourAgentCredential"],
    issuer: "did:prooflink:compliance-engine",
    issuanceDate: new Date().toISOString(),
    credentialSubject: {
      id: AGENT_DID,
      agentWallet: AGENT_WALLET,
      operator: {
        name: "Acme AI Corp",
        lei: OPERATOR_LEI,
        jurisdiction: "US-DE",
        sanctionsCleared: true,
      },
      autonomyTier: "SEMI_AUTONOMOUS",
      trustScore: trustScore,
      spendingLimit: "$10,000/day",
    },
    proof: {
      type: "EIP712Signature2021",
      verificationMethod: "did:prooflink:compliance-engine#key-1",
      proofValue: signature,
    },
  });

  // Pipeline timing
  const pipelineEnd = Date.now();
  const totalMs = pipelineEnd - pipelineStart;

  console.log();
  console.log(chalk.gray("  Pipeline timing breakdown:"));
  timingDisplay("Agent registration", regLatency);
  timingDisplay("DID resolution", didLatency);
  timingDisplay("Operator LEI verification", leiLatency);
  timingDisplay("Operator sanctions screening", opSanctionsLatency);
  timingDisplay("Trust score computation", trustLatency);
  timingDisplay("Address screening", screenLatency);
  timingDisplay("x402 settlement", 600);
  totalTiming(totalMs);

  // Save report
  const reportPath = reporter.saveHtmlReport();
  console.log();
  console.log(`  ${chalk.gray("HTML report saved:")} ${chalk.cyan.underline(reportPath)}`);
  console.log();
}
