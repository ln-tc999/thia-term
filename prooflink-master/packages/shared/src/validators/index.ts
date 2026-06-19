import { z } from "zod";

import {
  ComplianceRequest,
  PaymentIntent,
  SettlementResult,
} from "../types/protocol.js";
import {
  ComplianceReceipt,
  ComplianceDecision,
  CompliancePolicy,
  ProofLinkReceipt,
  SanctionsCheckResult,
  AMLRiskScore,
  TravelRuleData,
} from "../types/compliance.js";
import {
  AgentInvoice,
  InvoiceLineItem,
  InvoiceParty,
  PaymentProof,
} from "../types/invoice.js";
import {
  AgentIdentity,
  KYACredential,
  KYAVerificationResult,
  DelegationScope,
} from "../types/identity.js";
import {
  CheckSanctionsInput,
  CheckSanctionsOutput,
  VerifyKYAInput,
  VerifyKYAOutput,
  SubmitTravelRuleInput,
  SubmitTravelRuleOutput,
  GetComplianceReceiptInput,
  PayWithComplianceInput,
  PayWithComplianceOutput,
} from "../types/mcp.js";
import { WebhookConfig, WebhookEvent, WebhookSubscription } from "../types/webhook.js";
import { PaginationParams, APIKey } from "../types/api.js";
import { PluginManifest, PluginRegistration } from "../types/plugin.js";

// ---------------------------------------------------------------------------
// Helper: create a parse function from a Zod schema
// ---------------------------------------------------------------------------

type ParseResult<T> =
  | { success: true; data: T }
  | { success: false; error: z.ZodError };

function createParser<T extends z.ZodTypeAny>(schema: T) {
  return (input: unknown): ParseResult<z.infer<T>> => {
    const result = schema.safeParse(input);
    if (result.success) {
      return { success: true, data: result.data };
    }
    return { success: false, error: result.error };
  };
}

function createStrictParser<T extends z.ZodTypeAny>(schema: T) {
  return (input: unknown): z.infer<T> => {
    return schema.parse(input);
  };
}

// ---------------------------------------------------------------------------
// Compliance validators
// ---------------------------------------------------------------------------

export const parseComplianceRequest = createParser(ComplianceRequest);
export const parseComplianceRequestStrict = createStrictParser(ComplianceRequest);

export const parseComplianceReceipt = createParser(ComplianceReceipt);
export const parseComplianceReceiptStrict = createStrictParser(ComplianceReceipt);

export const parseComplianceDecision = createParser(ComplianceDecision);
export const parseComplianceDecisionStrict = createStrictParser(ComplianceDecision);

export const parseCompliancePolicy = createParser(CompliancePolicy);
export const parseCompliancePolicyStrict = createStrictParser(CompliancePolicy);

export const parseProofLinkReceipt = createParser(ProofLinkReceipt);
export const parseProofLinkReceiptStrict = createStrictParser(ProofLinkReceipt);

export const parseSanctionsCheckResult = createParser(SanctionsCheckResult);
export const parseSanctionsCheckResultStrict = createStrictParser(SanctionsCheckResult);

export const parseAMLRiskScore = createParser(AMLRiskScore);
export const parseAMLRiskScoreStrict = createStrictParser(AMLRiskScore);

export const parseTravelRuleData = createParser(TravelRuleData);
export const parseTravelRuleDataStrict = createStrictParser(TravelRuleData);

// ---------------------------------------------------------------------------
// Protocol validators
// ---------------------------------------------------------------------------

export const parsePaymentIntent = createParser(PaymentIntent);
export const parsePaymentIntentStrict = createStrictParser(PaymentIntent);

export const parseSettlementResult = createParser(SettlementResult);
export const parseSettlementResultStrict = createStrictParser(SettlementResult);

// ---------------------------------------------------------------------------
// Invoice validators
// ---------------------------------------------------------------------------

export const parseInvoiceRequest = createParser(AgentInvoice);
export const parseInvoiceRequestStrict = createStrictParser(AgentInvoice);

export const parseInvoiceLineItem = createParser(InvoiceLineItem);
export const parseInvoiceLineItemStrict = createStrictParser(InvoiceLineItem);

export const parseInvoiceParty = createParser(InvoiceParty);
export const parseInvoicePartyStrict = createStrictParser(InvoiceParty);

export const parsePaymentProof = createParser(PaymentProof);
export const parsePaymentProofStrict = createStrictParser(PaymentProof);

// ---------------------------------------------------------------------------
// Identity validators
// ---------------------------------------------------------------------------

export const parseAgentIdentity = createParser(AgentIdentity);
export const parseAgentIdentityStrict = createStrictParser(AgentIdentity);

export const parseKYACredential = createParser(KYACredential);
export const parseKYACredentialStrict = createStrictParser(KYACredential);

export const parseKYAVerificationResult = createParser(KYAVerificationResult);
export const parseKYAVerificationResultStrict = createStrictParser(KYAVerificationResult);

export const parseDelegationScope = createParser(DelegationScope);
export const parseDelegationScopeStrict = createStrictParser(DelegationScope);

// ---------------------------------------------------------------------------
// MCP tool validators
// ---------------------------------------------------------------------------

export const parseCheckSanctionsInput = createParser(CheckSanctionsInput);
export const parseCheckSanctionsInputStrict = createStrictParser(CheckSanctionsInput);

export const parseCheckSanctionsOutput = createParser(CheckSanctionsOutput);
export const parseCheckSanctionsOutputStrict = createStrictParser(CheckSanctionsOutput);

export const parseVerifyKYAInput = createParser(VerifyKYAInput);
export const parseVerifyKYAInputStrict = createStrictParser(VerifyKYAInput);

export const parseVerifyKYAOutput = createParser(VerifyKYAOutput);
export const parseVerifyKYAOutputStrict = createStrictParser(VerifyKYAOutput);

export const parseSubmitTravelRuleInput = createParser(SubmitTravelRuleInput);
export const parseSubmitTravelRuleInputStrict = createStrictParser(SubmitTravelRuleInput);

export const parseSubmitTravelRuleOutput = createParser(SubmitTravelRuleOutput);
export const parseSubmitTravelRuleOutputStrict = createStrictParser(SubmitTravelRuleOutput);

export const parseGetComplianceReceiptInput = createParser(GetComplianceReceiptInput);
export const parseGetComplianceReceiptInputStrict = createStrictParser(GetComplianceReceiptInput);

export const parsePayWithComplianceInput = createParser(PayWithComplianceInput);
export const parsePayWithComplianceInputStrict = createStrictParser(PayWithComplianceInput);

export const parsePayWithComplianceOutput = createParser(PayWithComplianceOutput);
export const parsePayWithComplianceOutputStrict = createStrictParser(PayWithComplianceOutput);

// ---------------------------------------------------------------------------
// Webhook validators
// ---------------------------------------------------------------------------

export const parseWebhookConfig = createParser(WebhookConfig);
export const parseWebhookConfigStrict = createStrictParser(WebhookConfig);

export const parseWebhookEvent = createParser(WebhookEvent);
export const parseWebhookEventStrict = createStrictParser(WebhookEvent);

export const parseWebhookSubscription = createParser(WebhookSubscription);
export const parseWebhookSubscriptionStrict = createStrictParser(WebhookSubscription);

// ---------------------------------------------------------------------------
// API validators
// ---------------------------------------------------------------------------

export const parsePaginationParams = createParser(PaginationParams);
export const parsePaginationParamsStrict = createStrictParser(PaginationParams);

export const parseAPIKey = createParser(APIKey);
export const parseAPIKeyStrict = createStrictParser(APIKey);

// ---------------------------------------------------------------------------
// Plugin validators
// ---------------------------------------------------------------------------

export const parsePluginManifest = createParser(PluginManifest);
export const parsePluginManifestStrict = createStrictParser(PluginManifest);

export const parsePluginRegistration = createParser(PluginRegistration);
export const parsePluginRegistrationStrict = createStrictParser(PluginRegistration);
