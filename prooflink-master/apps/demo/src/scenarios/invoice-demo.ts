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
  formatInvoice,
  formatJson,
  summaryBox,
  sleep,
  generateReceiptId,
  generateTxHash,
  generateEasUid,
  generateIpfsCid,
  generateSignature,
  truncateAddress,
  type ReceiptData,
  type InvoiceDisplay,
} from "../utils/display.js";
import { demoConfig } from "../config.js";
import { DemoReporter } from "../utils/reporter.js";

// ---------------------------------------------------------------------------
// Invoice Lifecycle Demo — Full invoice-to-receipt flow
// ---------------------------------------------------------------------------

const PAYER_WALLET = demoConfig.wallets["newAgent"]!.address;
const PAYEE_WALLET = demoConfig.wallets["cleanCoinbase"]!.address;
const AGENT_DID = "did:erc8004:8453:0xAgentRegistry:0042";

export async function runInvoiceDemo(): Promise<void> {
  const ora = oraImport;
  const reporter = new DemoReporter("Invoice Lifecycle");
  const demoStart = Date.now();

  sectionHeader("INVOICE LIFECYCLE DEMO");

  console.log(chalk.gray("  Full lifecycle: create invoice -> compliance check -> attach receipt"));
  console.log(chalk.gray("  -> simulate payment -> generate final receipt with all checks."));
  console.log(chalk.gray("  Payer: AI agent | Payee: service provider\n"));

  console.log(`  ${chalk.gray("Payer (Agent):")}  ${chalk.white(truncateAddress(PAYER_WALLET))} ${chalk.gray("(AI Inference Agent)")}`);
  console.log(`  ${chalk.gray("Payee:")}          ${chalk.white(truncateAddress(PAYEE_WALLET))} ${chalk.gray("(Coinbase - Service Provider)")}`);
  console.log(`  ${chalk.gray("Agent DID:")}      ${chalk.cyan(AGENT_DID)}`);
  console.log();

  await sleep(400);

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 1: Create Invoice
  // ═══════════════════════════════════════════════════════════════════════════

  stepHeader("\u{1F4CB}", "Creating invoice (payer: AI agent, payee: service provider)");

  const invoiceId = "INV-2026-" + String(Math.floor(Math.random() * 9000) + 1000);

  const spinnerInv = ora({
    text: chalk.gray("Generating JSON-LD compliant invoice..."),
    color: "cyan",
    indent: 2,
  }).start();
  await sleep(350);
  spinnerInv.succeed(chalk.gray(`Invoice ${invoiceId} created`));

  const invoice: InvoiceDisplay = {
    invoiceId,
    seller: `DataNode Cloud (${truncateAddress(PAYEE_WALLET)})`,
    buyer: `inference-agent-v3 (${truncateAddress(PAYER_WALLET)})`,
    lineItems: [
      {
        description: "GPT-4 equivalent inference calls",
        quantity: 10000,
        unitPrice: 0.003,
        total: 30.0,
      },
      {
        description: "Vector embedding generation",
        quantity: 50000,
        unitPrice: 0.0002,
        total: 10.0,
      },
      {
        description: "Model fine-tuning (1 epoch)",
        quantity: 1,
        unitPrice: 25.0,
        total: 25.0,
      },
    ],
    totalAmount: 65.0,
    currency: "USDC",
    chain: "Base",
    status: "DRAFT",
  };

  formatInvoice(invoice);

  prooflinkLog(`Invoice ${chalk.white(invoiceId)} created in ${chalk.white("DRAFT")} status`);
  prooflinkLog(`  Total: ${chalk.white("$65.00 USDC")} on ${chalk.white("Base")}`);
  prooflinkLog(`  Format: ${chalk.white("JSON-LD")} ${chalk.gray("(machine-readable, W3C compliant)")}`);

  reporter.addEvent({
    type: "receipt",
    label: "Invoice creation",
    status: "passed",
    latencyMs: 350,
    details: { invoiceId, amount: 65, currency: "USDC" },
  });

  await sleep(600);

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 2: Run compliance check on payer
  // ═══════════════════════════════════════════════════════════════════════════

  stepHeader("\u{1F50D}", "Running compliance check on payer (AI agent)...");

  prooflinkLog(`Compliance pipeline initiated for payer ${chalk.white(truncateAddress(PAYER_WALLET))}`);
  await sleep(200);

  // Sanctions screening
  const spinnerSanctions = ora({
    text: chalk.gray("Screening payer against OFAC_SDN, EU_CONSOLIDATED, UN, HMT..."),
    color: "cyan",
    indent: 2,
  }).start();
  const sanctionsLatency = Math.floor(Math.random() * 20) + 45;
  await sleep(sanctionsLatency + 120);
  spinnerSanctions.stop();
  statusCleared("payer", PAYER_WALLET, sanctionsLatency);

  reporter.addEvent({
    type: "screening",
    label: "Payer sanctions screening",
    status: "passed",
    latencyMs: sanctionsLatency,
  });

  // Screen payee too
  const spinnerPayee = ora({
    text: chalk.gray("Screening payee..."),
    color: "cyan",
    indent: 2,
  }).start();
  const payeeLatency = Math.floor(Math.random() * 15) + 30;
  await sleep(payeeLatency + 80);
  spinnerPayee.stop();
  statusCleared("payee", PAYEE_WALLET, payeeLatency);

  reporter.addEvent({
    type: "screening",
    label: "Payee sanctions screening",
    status: "passed",
    latencyMs: payeeLatency,
  });

  // AML risk score
  const spinnerAml = ora({
    text: chalk.gray("Computing AML risk score for payer..."),
    color: "cyan",
    indent: 2,
  }).start();
  const amlLatency = Math.floor(Math.random() * 12) + 18;
  await sleep(amlLatency + 80);
  spinnerAml.stop();
  riskScore(11, 85);

  reporter.addEvent({
    type: "screening",
    label: "AML risk scoring",
    status: "passed",
    latencyMs: amlLatency,
  });

  // KYA verification
  const spinnerKya = ora({
    text: chalk.gray("Verifying agent identity (ERC-8004)..."),
    color: "cyan",
    indent: 2,
  }).start();
  const kyaLatency = Math.floor(Math.random() * 20) + 40;
  await sleep(kyaLatency + 100);
  spinnerKya.stop();

  prooflinkLog(`KYA: ${chalk.white(AGENT_DID)} ${chalk.green.bold("VERIFIED")}`);
  prooflinkLog(`  Agent: ${chalk.white("inference-agent-v3")} | Trust: ${chalk.green("87/100")}`);
  prooflinkLog(`  Operator: ${chalk.white("Acme AI Corp")} ${chalk.gray("(LEI verified)")}`);

  reporter.addEvent({
    type: "kya",
    label: "KYA verification",
    status: "passed",
    latencyMs: kyaLatency,
  });

  // Travel Rule check
  travelRuleStatus(false, 65, 3000);

  console.log();
  console.log(`  ${chalk.green.bold("\u2713")} ${chalk.green.bold("All compliance checks passed for payer")}`);

  const complianceLatency = sanctionsLatency + payeeLatency + amlLatency + kyaLatency;
  console.log();
  timingDisplay("Total compliance pipeline", complianceLatency);

  await sleep(500);

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 3: Attach compliance receipt to invoice
  // ═══════════════════════════════════════════════════════════════════════════

  stepHeader("\u{1F4CE}", "Attaching compliance receipt to invoice...");

  const compReceiptId = generateReceiptId("pl");
  const compSignature = generateSignature();

  const spinnerAttach = ora({
    text: chalk.gray("Generating pre-payment compliance receipt..."),
    color: "green",
    indent: 2,
  }).start();
  await sleep(250);
  spinnerAttach.succeed(chalk.gray("Compliance receipt attached to invoice"));

  const complianceReceipt: ReceiptData = {
    receiptId: compReceiptId,
    overallStatus: "COMPLIANT",
    riskScore: 11,
    checks: [
      { checkType: "SANCTIONS_SCREENING", result: "PASSED", provider: "Chainalysis KYT", latencyMs: sanctionsLatency + payeeLatency },
      { checkType: "AML_MONITORING", result: "PASSED", provider: "ProofLink Engine", latencyMs: amlLatency },
      { checkType: "KYA_VERIFICATION", result: "PASSED", provider: "ERC-8004 Registry", latencyMs: kyaLatency },
      { checkType: "TRAVEL_RULE", result: "SKIPPED", provider: "N/A (below $3,000)", latencyMs: 0 },
    ],
    travelRuleStatus: "NOT_REQUIRED",
    signature: compSignature,
    timestamp: new Date().toISOString(),
  };

  reporter.addReceipt(complianceReceipt);

  prooflinkLog(`Invoice ${chalk.white(invoiceId)} updated: ${chalk.white("DRAFT")} -> ${chalk.yellow.bold("COMPLIANCE_VERIFIED")}`);
  prooflinkLog(`  Compliance receipt: ${chalk.white(compReceiptId)}`);
  prooflinkLog(`  Receipt signature:  ${chalk.white(truncateAddress(compSignature))}`);

  // Show the invoice with compliance stamp
  const invoiceWithCompliance: InvoiceDisplay = {
    ...invoice,
    status: "COMPLIANCE_VERIFIED",
  };
  formatInvoice(invoiceWithCompliance);

  console.log();
  console.log(chalk.gray("  Compliance receipt is now embedded in the invoice metadata."));
  console.log(chalk.gray("  Any party can verify the receipt independently."));

  await sleep(600);

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 4: Simulate payment
  // ═══════════════════════════════════════════════════════════════════════════

  stepHeader("\u{1F4B0}", "Simulating payment...");

  agentLog(`Paying invoice ${chalk.white(invoiceId)}...`);
  prooflinkLog("Intercepting x402 payment...");
  prooflinkLog(`Pre-payment compliance: ${chalk.green.bold("ALREADY VERIFIED")} ${chalk.gray("(receipt attached)")}`);
  await sleep(200);

  paymentApproved();

  const spinnerSettle = ora({
    text: chalk.gray("Settling $65.00 USDC on Base via x402..."),
    color: "magenta",
    indent: 2,
  }).start();
  const txHash = generateTxHash();
  await sleep(700);
  spinnerSettle.stop();

  x402Log(`Transaction: ${chalk.white(truncateAddress(txHash))} (Base)`);
  x402Log(`Amount: ${chalk.white("65.00 USDC")} | Gas: ${chalk.white("~$0.008")}`);

  reporter.addEvent({
    type: "payment",
    label: "x402 settlement on Base",
    status: "passed",
    latencyMs: 700,
  });

  prooflinkLog(`Invoice ${chalk.white(invoiceId)}: ${chalk.yellow("COMPLIANCE_VERIFIED")} -> ${chalk.green.bold("PAID")}`);

  await sleep(400);

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 5: Generate final receipt with all checks
  // ═══════════════════════════════════════════════════════════════════════════

  stepHeader("\u{1F9FE}", "Generating final receipt with all checks...");

  const finalReceiptId = generateReceiptId("pl");
  const easUid = generateEasUid();
  const ipfsCid = generateIpfsCid();
  const finalSignature = generateSignature();

  const spinnerReceipt = ora({
    text: chalk.gray("Generating ProofLink receipt + EAS attestation..."),
    color: "green",
    indent: 2,
  }).start();
  await sleep(400);
  spinnerReceipt.stop();

  const spinnerIpfs = ora({
    text: chalk.gray("Archiving to IPFS..."),
    color: "green",
    indent: 2,
  }).start();
  await sleep(250);
  spinnerIpfs.succeed(chalk.gray("Archived to IPFS"));

  prooflinkLog(`Final receipt: ${chalk.white(finalReceiptId)}`);
  prooflinkLog(`EAS attestation: ${chalk.white(truncateAddress(easUid))}`);
  prooflinkLog(`IPFS archive: ${chalk.white(truncateAddress(ipfsCid))}`);

  const finalReceipt: ReceiptData = {
    receiptId: finalReceiptId,
    overallStatus: "COMPLIANT",
    riskScore: 11,
    checks: [
      { checkType: "SANCTIONS_SCREENING", result: "PASSED", provider: "Chainalysis KYT", latencyMs: sanctionsLatency + payeeLatency },
      { checkType: "AML_MONITORING", result: "PASSED", provider: "ProofLink Engine", latencyMs: amlLatency },
      { checkType: "KYA_VERIFICATION", result: "PASSED", provider: "ERC-8004 Registry", latencyMs: kyaLatency },
      { checkType: "TRAVEL_RULE", result: "SKIPPED", provider: "N/A (below $3,000)", latencyMs: 0 },
      { checkType: "INVOICE_VALIDATION", result: "PASSED", provider: "ProofLink Engine", latencyMs: 8 },
      { checkType: "PAYMENT_SETTLEMENT", result: "PASSED", provider: "x402 Protocol", latencyMs: 700 },
    ],
    travelRuleStatus: "NOT_REQUIRED",
    easAttestationUid: easUid,
    ipfsCid,
    signature: finalSignature,
    timestamp: new Date().toISOString(),
  };

  reporter.addReceipt(finalReceipt);
  formatReceipt(finalReceipt);

  // Final invoice state
  const finalInvoice: InvoiceDisplay = {
    ...invoice,
    status: "PAID (COMPLIANT)",
  };
  formatInvoice(finalInvoice);

  // Show complete JSON receipt
  formatJson("Final Compliance Receipt (JSON)", {
    receiptId: finalReceiptId,
    version: "1.0.0",
    overallStatus: "COMPLIANT",
    invoice: {
      invoiceId,
      seller: "DataNode Cloud",
      buyer: "inference-agent-v3",
      amount: "65.00",
      currency: "USDC",
      chain: "base",
      status: "PAID",
    },
    transaction: {
      txHash,
      sender: PAYER_WALLET,
      receiver: PAYEE_WALLET,
      protocol: "x402",
    },
    compliance: {
      prePaymentReceiptId: compReceiptId,
      sanctionsCleared: true,
      kyaVerified: true,
      kyaAgentDid: AGENT_DID,
      amlRiskScore: 11,
      travelRuleRequired: false,
    },
    attestation: {
      easUid,
      verifyUrl: `https://base.easscan.org/attestation/${easUid}`,
    },
    archive: {
      ipfsCid,
      ipfsUrl: `ipfs://${ipfsCid}`,
    },
    signature: finalSignature,
    timestamp: new Date().toISOString(),
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // SUMMARY
  // ═══════════════════════════════════════════════════════════════════════════

  const demoEnd = Date.now();
  const totalMs = demoEnd - demoStart;

  sectionHeader("INVOICE LIFECYCLE SUMMARY");

  console.log(chalk.white.bold("  Status transitions:\n"));
  const states = [
    { state: "DRAFT", detail: "Invoice created with line items" },
    { state: "COMPLIANCE_VERIFIED", detail: "Payer passed all compliance checks" },
    { state: "PAID", detail: "x402 settlement on Base confirmed" },
    { state: "RECEIPTED", detail: "ProofLink receipt + EAS attestation generated" },
  ];

  for (let i = 0; i < states.length; i++) {
    const s = states[i]!;
    const isLast = i === states.length - 1;
    const color = isLast ? chalk.green.bold : chalk.cyan;
    const connector = isLast ? chalk.green("  \u2514\u2500") : chalk.gray("  \u251C\u2500");
    console.log(`${connector} ${color(s.state.padEnd(24))} ${chalk.gray(s.detail)}`);
    if (!isLast) console.log(chalk.gray("  \u2502"));
  }

  console.log();
  console.log(chalk.gray("  Pipeline timing:"));
  timingDisplay("Invoice creation", 350);
  timingDisplay("Compliance pipeline", complianceLatency);
  timingDisplay("Receipt attachment", 250);
  timingDisplay("x402 settlement", 700);
  timingDisplay("Final receipt + EAS", 400);
  timingDisplay("IPFS archive", 250);
  totalTiming(totalMs);

  summaryBox("Invoice Lifecycle Complete", [
    { label: "Invoice", value: chalk.white(invoiceId) },
    { label: "Amount", value: chalk.white("$65.00 USDC") },
    { label: "Payer", value: chalk.white("inference-agent-v3 (AI)") },
    { label: "Payee", value: chalk.white("DataNode Cloud") },
    { label: "Compliance", value: chalk.green.bold("ALL CHECKS PASSED") },
    { label: "Receipts", value: chalk.white("2 (pre-payment + final)") },
    { label: "On-chain", value: chalk.white("EAS attestation on Base") },
    { label: "Archive", value: chalk.white("IPFS") },
    { label: "Demo time", value: chalk.cyan(`${(totalMs / 1000).toFixed(1)}s`) },
  ]);

  const reportPath = reporter.saveHtmlReport();
  console.log();
  console.log(`  ${chalk.gray("HTML report saved:")} ${chalk.cyan.underline(reportPath)}`);
  console.log();
}
