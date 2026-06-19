"use client";

import { useQuery } from "@tanstack/react-query";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useState } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
  type TooltipProps,
} from "recharts";
import {
  ArrowLeft,
  Shield,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Copy,
  ExternalLink,
  Download,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Ban,
  Clock,
  Loader2,
} from "lucide-react";
import { getComplianceCheck } from "@/lib/api";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatAmount, formatDate, shortenAddress, cn } from "@/lib/utils";

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => {
        navigator.clipboard.writeText(text).catch(() => undefined);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
      aria-label={copied ? "Copied!" : "Copy to clipboard"}
      title={copied ? "Copied!" : "Copy to clipboard"}
      className={cn(
        "transition-colors shrink-0",
        copied ? "text-emerald-400" : "text-muted-foreground hover:text-foreground"
      )}
    >
      <Copy className="h-3.5 w-3.5" aria-hidden="true" />
    </button>
  );
}

function CheckItem({ label, passed }: { label: string; passed: boolean }) {
  return (
    <div className="flex items-center justify-between rounded-lg border border-border/50 bg-secondary/20 px-4 py-3">
      <span className="text-sm">{label}</span>
      {passed ? (
        <div className="flex items-center gap-1.5 text-emerald-400">
          <CheckCircle2 className="h-4 w-4" />
          <span className="text-xs font-medium">PASS</span>
        </div>
      ) : (
        <div className="flex items-center gap-1.5 text-red-400">
          <XCircle className="h-4 w-4" />
          <span className="text-xs font-medium">FAIL</span>
        </div>
      )}
    </div>
  );
}

// ─── Check Timeline ─────────────────────────────────────────────────────────

interface TimelineStep {
  label: string;
  description: string;
  status: "completed" | "current" | "failed";
  icon: typeof Shield;
  timestamp: string;
}

function CheckTimeline({ check }: { check: NonNullable<Awaited<ReturnType<typeof getComplianceCheck>>> }) {
  const now = new Date(check.createdAt);
  const steps: TimelineStep[] = [
    {
      label: "Request Received",
      description: `Compliance check initiated for ${shortenAddress(check.walletAddress)}`,
      status: "completed",
      icon: Clock,
      timestamp: new Date(now.getTime() - 3000).toISOString(),
    },
    {
      label: "OFAC Screening",
      description: check.checks.ofac ? "No matches found on OFAC SDN list" : "Match found on OFAC sanctions list",
      status: check.checks.ofac ? "completed" : "failed",
      icon: Shield,
      timestamp: new Date(now.getTime() - 2500).toISOString(),
    },
    {
      label: "Risk Score Evaluation",
      description: `Risk score: ${Math.round(check.riskScore)} / 100 (threshold: 70)`,
      status: check.checks.riskScore ? "completed" : "failed",
      icon: ShieldAlert,
      timestamp: new Date(now.getTime() - 2000).toISOString(),
    },
    {
      label: "Velocity Check",
      description: check.checks.velocity ? "Transaction velocity within limits" : "Velocity limit exceeded",
      status: check.checks.velocity ? "completed" : "failed",
      icon: RefreshCw,
      timestamp: new Date(now.getTime() - 1500).toISOString(),
    },
    {
      label: "Jurisdiction Check",
      description: check.checks.jurisdiction ? "Origin jurisdiction approved" : "Blocked jurisdiction detected",
      status: check.checks.jurisdiction ? "completed" : "failed",
      icon: ShieldCheck,
      timestamp: new Date(now.getTime() - 1000).toISOString(),
    },
    {
      label: "Decision",
      description: check.status === "PASS" ? "All checks passed. Transaction approved." : check.status === "FAIL" ? "Check failed. Transaction blocked." : "Manual review required.",
      status: check.status === "PASS" ? "completed" : check.status === "FAIL" ? "failed" : "current",
      icon: check.status === "PASS" ? CheckCircle2 : check.status === "FAIL" ? XCircle : AlertTriangle,
      timestamp: check.createdAt,
    },
  ];

  return (
    <div className="space-y-0">
      {steps.map((step, idx) => {
        const Icon = step.icon;
        return (
          <div key={step.label} className="flex gap-4">
            {/* Vertical line */}
            <div className="flex flex-col items-center">
              <div className={cn(
                "flex h-8 w-8 items-center justify-center rounded-full border-2",
                step.status === "completed" && "border-emerald-500 bg-emerald-500/10",
                step.status === "failed" && "border-red-500 bg-red-500/10",
                step.status === "current" && "border-amber-500 bg-amber-500/10"
              )}>
                <Icon className={cn(
                  "h-4 w-4",
                  step.status === "completed" && "text-emerald-400",
                  step.status === "failed" && "text-red-400",
                  step.status === "current" && "text-amber-400"
                )} />
              </div>
              {idx < steps.length - 1 && (
                <div className={cn(
                  "w-0.5 flex-1 min-h-[24px]",
                  step.status === "completed" ? "bg-emerald-500/30" : step.status === "failed" ? "bg-red-500/30" : "bg-border"
                )} />
              )}
            </div>
            {/* Content */}
            <div className="pb-6">
              <p className="text-sm font-medium leading-tight">{step.label}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{step.description}</p>
              <p className="text-[10px] text-muted-foreground/60 mt-1 font-mono">{formatDate(step.timestamp)}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Risk Factor Chart ──────────────────────────────────────────────────────

function RiskFactorChart({ check }: { check: NonNullable<Awaited<ReturnType<typeof getComplianceCheck>>> }) {
  const factors = [
    { name: "OFAC", score: check.checks.ofac ? 0 : 40, max: 40 },
    { name: "Risk Score", score: Math.round(check.riskScore * 0.3), max: 30 },
    { name: "Velocity", score: check.checks.velocity ? 0 : 15, max: 15 },
    { name: "Jurisdiction", score: check.checks.jurisdiction ? 0 : 15, max: 15 },
  ];

  return (
    <ResponsiveContainer width="100%" height={200}>
      <BarChart data={factors} layout="vertical" margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(215, 25%, 13%)" horizontal={false} />
        <XAxis type="number" domain={[0, 40]} tick={{ fill: "hsl(215, 20%, 50%)", fontSize: 11 }} tickLine={false} axisLine={false} />
        <YAxis type="category" dataKey="name" tick={{ fill: "hsl(215, 20%, 50%)", fontSize: 11 }} tickLine={false} axisLine={false} width={90} />
        <Tooltip
          content={({ active, payload }: TooltipProps<number, string>) => {
            if (!active || !payload?.length) return null;
            return (
              <div className="rounded-lg border border-border/50 bg-card/95 backdrop-blur-xl p-3 shadow-2xl">
                <p className="text-xs font-medium">{payload[0].payload.name}: {payload[0].value} / {payload[0].payload.max}</p>
              </div>
            );
          }}
        />
        <Bar dataKey="score" radius={[0, 4, 4, 0]} animationDuration={1000}>
          {factors.map((f, idx) => (
            <Cell key={idx} fill={f.score === 0 ? "hsl(142, 76%, 50%)" : f.score > 20 ? "hsl(0, 84%, 60%)" : "hsl(45, 93%, 50%)"} fillOpacity={0.7} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

// ─── Page ───────────────────────────────────────────────────────────────────

export default function ComplianceDetailPage() {
  const params = useParams();
  const id = params.id as string;
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const { data: check, isLoading } = useQuery({
    queryKey: ["compliance-check", id],
    queryFn: () => getComplianceCheck(id),
  });

  const handleAction = async (action: string) => {
    setActionLoading(action);
    await new Promise((r) => setTimeout(r, 1500));
    setActionLoading(null);
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <div className="h-10 w-10 shimmer rounded" />
          <div className="space-y-2">
            <div className="h-6 w-48 shimmer rounded" />
            <div className="h-4 w-24 shimmer rounded" />
          </div>
        </div>
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="glass-card rounded-xl p-6 space-y-4">
            <div className="h-5 w-32 shimmer rounded" />
            <div className="grid grid-cols-2 gap-4">
              {Array.from({ length: 4 }, (_, i) => (
                <div key={i} className="space-y-2">
                  <div className="h-3 w-16 shimmer rounded" />
                  <div className="h-6 w-24 shimmer rounded" />
                </div>
              ))}
            </div>
          </div>
          <div className="glass-card rounded-xl p-6 space-y-4">
            <div className="h-5 w-32 shimmer rounded" />
            <div className="space-y-3">
              {Array.from({ length: 4 }, (_, i) => (
                <div key={i} className="h-12 w-full shimmer rounded-lg" />
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!check) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <AlertTriangle className="h-12 w-12 text-amber-400 mb-4" />
        <h2 className="text-lg font-semibold mb-2">Check Not Found</h2>
        <p className="text-sm text-muted-foreground mb-4">
          The compliance check &quot;{id}&quot; does not exist.
        </p>
        <Button asChild variant="outline">
          <Link href="/compliance">Back to Compliance</Link>
        </Button>
      </div>
    );
  }

  const statusIcon =
    check.status === "PASS" ? (
      <CheckCircle2 className="h-6 w-6 text-emerald-400" />
    ) : check.status === "FAIL" ? (
      <XCircle className="h-6 w-6 text-red-400" />
    ) : (
      <AlertTriangle className="h-6 w-6 text-amber-400" />
    );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4 animate-fade-in">
        <Button asChild variant="ghost" size="icon">
          <Link href="/compliance">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight">
              Compliance Receipt
            </h1>
            <StatusBadge status={check.status} />
          </div>
          <p className="text-sm text-muted-foreground mt-1 font-mono">
            {check.id}
          </p>
        </div>
        {/* Actions */}
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => handleAction("recheck")}
            disabled={actionLoading !== null}
            className="gap-1.5 text-xs"
          >
            {actionLoading === "recheck" ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
            Re-check
          </Button>
          {check.status === "REVIEW" && (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleAction("approve")}
                disabled={actionLoading !== null}
                className="gap-1.5 text-xs text-emerald-400 hover:text-emerald-300"
              >
                {actionLoading === "approve" ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />}
                Approve
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleAction("block")}
                disabled={actionLoading !== null}
                className="gap-1.5 text-xs text-red-400 hover:text-red-300"
              >
                {actionLoading === "block" ? <Loader2 className="h-3 w-3 animate-spin" /> : <Ban className="h-3 w-3" />}
                Block
              </Button>
            </>
          )}
          {check.status !== "REVIEW" && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleAction("escalate")}
              disabled={actionLoading !== null}
              className="gap-1.5 text-xs text-amber-400 hover:text-amber-300"
            >
              {actionLoading === "escalate" ? <Loader2 className="h-3 w-3 animate-spin" /> : <AlertTriangle className="h-3 w-3" />}
              Escalate
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={() => handleAction("download")}
            disabled={actionLoading !== null}
            className="gap-1.5 text-xs"
          >
            {actionLoading === "download" ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />}
            Download PDF
          </Button>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Overview */}
        <Card className={cn(
          "relative overflow-hidden",
          check.status === "PASS" && "border-emerald-500/20",
          check.status === "FAIL" && "border-red-500/20",
          check.status === "REVIEW" && "border-amber-500/20",
        )}>
          <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-blue-500 to-teal-500" />
          <CardHeader>
            <div className="flex items-center gap-3">
              {statusIcon}
              <CardTitle>Check Overview</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-xs text-muted-foreground mb-1">Amount</p>
                <p className="text-lg font-semibold">
                  {formatAmount(check.amount)} {check.currency}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1">Risk Score</p>
                <div className="flex items-center gap-2">
                  <p className="text-lg font-semibold">
                    {Math.round(check.riskScore)}
                  </p>
                  <span className="text-xs text-muted-foreground">/ 100</span>
                </div>
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1">Chain</p>
                <p className="text-sm font-medium">{check.chain}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1">Date</p>
                <p className="text-sm">{formatDate(check.createdAt)}</p>
              </div>
            </div>

            <div className="space-y-3 pt-2">
              <div>
                <p className="text-xs text-muted-foreground mb-1">Wallet Address</p>
                <div className="flex items-center gap-2">
                  <code className="text-xs bg-secondary/50 px-2 py-1 rounded font-mono break-all">
                    {check.walletAddress}
                  </code>
                  <CopyButton text={check.walletAddress} />
                </div>
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1">Counterparty</p>
                <div className="flex items-center gap-2">
                  <code className="text-xs bg-secondary/50 px-2 py-1 rounded font-mono break-all">
                    {check.counterparty}
                  </code>
                  <CopyButton text={check.counterparty} />
                </div>
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1">Agent DID</p>
                <div className="flex items-center gap-2">
                  <code className="text-xs bg-secondary/50 px-2 py-1 rounded font-mono">
                    {check.agentDid}
                  </code>
                  <CopyButton text={check.agentDid} />
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Check Details */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-3">
              <Shield className="h-5 w-5 text-primary" />
              <CardTitle>Compliance Checks</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <CheckItem label="OFAC Sanctions Screening" passed={check.checks.ofac} />
            <CheckItem label="Risk Score Threshold" passed={check.checks.riskScore} />
            <CheckItem label="Transaction Velocity" passed={check.checks.velocity} />
            <CheckItem label="Jurisdiction Check" passed={check.checks.jurisdiction} />

            <div className="mt-6 rounded-lg border border-border/50 bg-secondary/10 p-4">
              <h4 className="text-sm font-medium mb-2">Verification Receipt</h4>
              <p className="text-xs text-muted-foreground leading-relaxed">
                This compliance check was performed by ProofLink&apos;s x402 compliance
                middleware. The check evaluated the transaction against OFAC
                sanctions lists, risk score thresholds, transaction velocity
                limits, and jurisdiction restrictions. The result is
                cryptographically signed and stored on-chain for auditability.
              </p>
              <div className="mt-3 flex items-center gap-2">
                <Button variant="outline" size="sm" className="text-xs gap-1.5">
                  <ExternalLink className="h-3 w-3" />
                  View on Explorer
                </Button>
                <Button variant="outline" size="sm" className="text-xs gap-1.5">
                  <Copy className="h-3 w-3" />
                  Copy Receipt Hash
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Check Timeline & Risk Breakdown */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Timeline */}
        <Card className="animate-slide-in-up">
          <CardHeader>
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4 text-primary" />
              <CardTitle>Check Timeline</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <CheckTimeline check={check} />
          </CardContent>
        </Card>

        {/* Risk Factor Breakdown */}
        <Card className="animate-slide-in-up">
          <CardHeader>
            <div className="flex items-center gap-2">
              <ShieldAlert className="h-4 w-4 text-amber-400" />
              <CardTitle>Risk Factor Breakdown</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <RiskFactorChart check={check} />
            <div className="mt-4 grid grid-cols-2 gap-3">
              <div className="rounded-lg border border-border/50 bg-secondary/20 p-3 text-center">
                <p className="text-xs text-muted-foreground">Overall Risk</p>
                <p className={cn(
                  "text-xl font-bold mt-1",
                  check.riskScore < 30 ? "text-emerald-400" :
                  check.riskScore < 60 ? "text-amber-400" : "text-red-400"
                )}>
                  {Math.round(check.riskScore)}%
                </p>
              </div>
              <div className="rounded-lg border border-border/50 bg-secondary/20 p-3 text-center">
                <p className="text-xs text-muted-foreground">Checks Passed</p>
                <p className="text-xl font-bold mt-1 text-foreground">
                  {Object.values(check.checks).filter(Boolean).length}/{Object.values(check.checks).length}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Full Receipt */}
      <Card className="animate-slide-in-up">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Shield className="h-4 w-4 text-primary" />
            <CardTitle>Full Compliance Receipt</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <div className="rounded-lg bg-secondary/30 border border-border/50 p-4 overflow-x-auto">
            <pre className="text-xs font-mono text-muted-foreground whitespace-pre-wrap">
{JSON.stringify({
  receipt: {
    id: check.id,
    version: "1.0",
    protocol: "x402",
    timestamp: check.createdAt,
    decision: check.status,
    riskScore: Math.round(check.riskScore),
    transaction: {
      walletAddress: check.walletAddress,
      counterparty: check.counterparty,
      amount: check.amount,
      currency: check.currency,
      chain: check.chain,
    },
    checks: check.checks,
    agent: {
      did: check.agentDid,
    },
    signature: "0x" + "a".repeat(64) + "...",
    receiptHash: "0x" + "b".repeat(64),
  },
}, null, 2)}
            </pre>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
