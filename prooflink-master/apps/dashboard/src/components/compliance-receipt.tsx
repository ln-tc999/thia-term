"use client";

import { useState, useCallback } from "react";
import {
  Copy,
  Check,
  Download,
  CheckCircle2,
  XCircle,
  Shield,
  Clock,
} from "lucide-react";
import { cn, formatDate } from "@/lib/utils";
import { StatusBadge } from "@/components/ui/status-badge";
import { RiskGauge } from "@/components/ui/risk-gauge";
import { AddressDisplay } from "@/components/ui/address-display";
import { Button } from "@/components/ui/button";

// ─── Types ─────────────────────────────────────────────────────────────────────

type ReceiptStatus = "approved" | "rejected" | "escalated" | "pending";

interface ComplianceCheckResult {
  name: string;
  passed: boolean;
  detail?: string;
}

interface TravelRuleInfo {
  status: "complete" | "pending" | "not_required";
  originatorName?: string;
  beneficiaryName?: string;
}

interface ComplianceReceiptProps {
  receiptId: string;
  timestamp: string;
  status: ReceiptStatus;
  walletAddress: string;
  chain?: string;
  riskScore: number;
  riskThreshold?: number;
  checks: ComplianceCheckResult[];
  travelRule?: TravelRuleInfo;
  amount?: number;
  currency?: string;
  className?: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const travelRuleLabels: Record<TravelRuleInfo["status"], { label: string; color: string }> = {
  complete: { label: "Complete", color: "text-emerald-400" },
  pending: { label: "Pending", color: "text-amber-400" },
  not_required: { label: "Not Required", color: "text-zinc-400" },
};

// ─── Component ──────────────────────────────────────────────────────────────────

export function ComplianceReceipt({
  receiptId,
  timestamp,
  status,
  walletAddress,
  chain,
  riskScore,
  riskThreshold = 70,
  checks,
  travelRule,
  amount,
  currency,
  className,
}: ComplianceReceiptProps) {
  const [copied, setCopied] = useState(false);

  const handleCopyId = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(receiptId);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard not available
    }
  }, [receiptId]);

  const handleDownload = useCallback(() => {
    const receiptData = {
      receiptId,
      timestamp,
      status,
      walletAddress,
      chain,
      riskScore,
      checks: checks.map((c) => ({ name: c.name, passed: c.passed, detail: c.detail })),
      travelRule,
    };
    const blob = new Blob([JSON.stringify(receiptData, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `compliance-receipt-${receiptId}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [receiptId, timestamp, status, walletAddress, chain, riskScore, checks, travelRule]);

  const passedCount = checks.filter((c) => c.passed).length;

  return (
    <div className={cn("glass-card rounded-xl divide-y divide-border/40", className)}>
      {/* Header */}
      <div className="flex items-start justify-between p-6">
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Shield className="h-5 w-5 text-primary" aria-hidden="true" />
            <h3 className="text-lg font-semibold">Compliance Receipt</h3>
          </div>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <code className="font-mono text-xs">{receiptId}</code>
            <button
              type="button"
              onClick={handleCopyId}
              className="rounded p-0.5 hover:bg-secondary/60 transition-colors"
              aria-label={copied ? "Copied" : "Copy receipt ID"}
            >
              {copied ? (
                <Check className="h-3.5 w-3.5 text-emerald-400" />
              ) : (
                <Copy className="h-3.5 w-3.5" />
              )}
            </button>
          </div>
        </div>
        <StatusBadge status={status} />
      </div>

      {/* Meta */}
      <div className="grid grid-cols-2 gap-4 p-6 text-sm">
        <div>
          <p className="text-muted-foreground text-xs mb-1">Timestamp</p>
          <p className="font-medium tabular-nums">{formatDate(timestamp)}</p>
        </div>
        {amount !== undefined && currency && (
          <div>
            <p className="text-muted-foreground text-xs mb-1">Amount</p>
            <p className="font-medium tabular-nums">
              {amount.toLocaleString()} {currency}
            </p>
          </div>
        )}
        <div className="col-span-2">
          <p className="text-muted-foreground text-xs mb-1">Wallet</p>
          <AddressDisplay address={walletAddress} chain={chain} />
        </div>
      </div>

      {/* Risk Score */}
      <div className="p-6">
        <p className="text-xs font-medium text-muted-foreground mb-3">Risk Assessment</p>
        <RiskGauge score={riskScore} threshold={riskThreshold} size="md" />
      </div>

      {/* Checks */}
      <div className="p-6">
        <div className="flex items-center justify-between mb-3">
          <p className="text-xs font-medium text-muted-foreground">
            Compliance Checks
          </p>
          <span className="text-xs text-muted-foreground tabular-nums">
            {passedCount}/{checks.length} passed
          </span>
        </div>
        <div className="space-y-2">
          {checks.map((check) => (
            <div
              key={check.name}
              className="flex items-center justify-between rounded-lg bg-secondary/20 px-3 py-2"
            >
              <div className="flex items-center gap-2">
                {check.passed ? (
                  <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                ) : (
                  <XCircle className="h-4 w-4 text-red-400" />
                )}
                <span className="text-sm font-medium">{check.name}</span>
              </div>
              {check.detail && (
                <span className="text-xs text-muted-foreground">{check.detail}</span>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Travel Rule */}
      {travelRule && (
        <div className="p-6">
          <p className="text-xs font-medium text-muted-foreground mb-3">Travel Rule</p>
          <div className="rounded-lg bg-secondary/20 px-3 py-2.5 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm">Status</span>
              <span className={cn("text-sm font-medium", travelRuleLabels[travelRule.status].color)}>
                {travelRuleLabels[travelRule.status].label}
              </span>
            </div>
            {travelRule.originatorName && (
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>Originator</span>
                <span className="font-medium text-foreground">{travelRule.originatorName}</span>
              </div>
            )}
            {travelRule.beneficiaryName && (
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>Beneficiary</span>
                <span className="font-medium text-foreground">{travelRule.beneficiaryName}</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center justify-end gap-2 p-4">
        <Button variant="ghost" size="sm" onClick={handleCopyId}>
          <Copy className="h-3.5 w-3.5" />
          Copy ID
        </Button>
        <Button variant="outline" size="sm" onClick={handleDownload}>
          <Download className="h-3.5 w-3.5" />
          Download
        </Button>
      </div>
    </div>
  );
}

export type { ComplianceReceiptProps, ComplianceCheckResult, TravelRuleInfo, ReceiptStatus };
