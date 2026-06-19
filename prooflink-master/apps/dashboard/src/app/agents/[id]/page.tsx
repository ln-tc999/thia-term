"use client";

import { useQuery } from "@tanstack/react-query";
import { useParams } from "next/navigation";
import Link from "next/link";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  type TooltipProps,
} from "recharts";
import {
  Bot,
  Shield,
  Wallet,
  TrendingUp,
  ArrowLeft,
  Clock,
  CheckCircle2,
  Activity,
  Lock,
  Globe,
} from "lucide-react";
import { getAgent, getComplianceChecks, type Agent } from "@/lib/api";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  TableSkeleton,
  TableEmpty,
} from "@/components/ui/table";
import {
  formatDate,
  formatAmount,
  formatCompactNumber,
  shortenAddress,
  cn,
} from "@/lib/utils";

function RiskChartTooltip({ active, payload, label }: TooltipProps<number, string>) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-border/50 bg-card/95 backdrop-blur-xl p-3 shadow-2xl">
      <p className="text-xs font-medium text-muted-foreground mb-1">{label}</p>
      <div className="flex items-center gap-2 text-sm">
        <div className="h-2.5 w-2.5 rounded-full bg-amber-400" />
        <span className="text-muted-foreground">Risk Score:</span>
        <span className="font-semibold tabular-nums">{payload[0].value}</span>
      </div>
    </div>
  );
}

function AgentProfileCard({ agent }: { agent: Agent }) {
  const walletAddress = agent.did.replace("did:web:", "0x") + "0".repeat(34);

  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-start gap-4">
          <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-gradient-to-br from-blue-500/20 to-teal-500/20 border border-border/50">
            <Bot className="h-7 w-7 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3 mb-1">
              <h2 className="text-xl font-bold">{agent.name}</h2>
              <StatusBadge status={agent.status} />
            </div>
            <p className="text-sm text-muted-foreground">{agent.provider}</p>
          </div>
        </div>

        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-sm">
              <Shield className="h-4 w-4 text-muted-foreground" />
              <span className="text-muted-foreground">DID</span>
            </div>
            <code className="block text-xs font-mono bg-secondary/50 px-3 py-2 rounded-lg break-all">
              {agent.did}
            </code>
          </div>
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-sm">
              <Wallet className="h-4 w-4 text-muted-foreground" />
              <span className="text-muted-foreground">Wallet</span>
            </div>
            <code className="block text-xs font-mono bg-secondary/50 px-3 py-2 rounded-lg break-all">
              {shortenAddress(walletAddress, 10)}
            </code>
          </div>
        </div>

        <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div className="rounded-lg bg-secondary/30 p-3 text-center">
            <p className="text-xs text-muted-foreground mb-1">Credential</p>
            <p className="text-sm font-semibold">{agent.credentialType}</p>
          </div>
          <div className="rounded-lg bg-secondary/30 p-3 text-center">
            <p className="text-xs text-muted-foreground mb-1">Checks</p>
            <p className="text-sm font-semibold">{formatCompactNumber(agent.checksPerformed)}</p>
          </div>
          <div className="rounded-lg bg-secondary/30 p-3 text-center">
            <p className="text-xs text-muted-foreground mb-1">Volume</p>
            <p className="text-sm font-semibold">{formatAmount(agent.transactionVolume ?? 0)}</p>
          </div>
          <div className="rounded-lg bg-secondary/30 p-3 text-center">
            <p className="text-xs text-muted-foreground mb-1">Reputation</p>
            <p className="text-sm font-semibold text-emerald-400">
              {agent.riskScoreHistory && agent.riskScoreHistory.length > 0
                ? Math.round(100 - agent.riskScoreHistory[agent.riskScoreHistory.length - 1].score)
                : "N/A"}
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function KYAVerificationCard({ agent }: { agent: Agent }) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4 text-primary" />
          <CardTitle>KYA Verification</CardTitle>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <div className="flex items-center justify-between rounded-lg border border-border/50 bg-secondary/20 p-4">
            <div className="flex items-center gap-3">
              <div className={cn(
                "flex h-10 w-10 items-center justify-center rounded-full",
                agent.status === "VERIFIED"
                  ? "bg-emerald-500/15"
                  : agent.status === "EXPIRED"
                  ? "bg-zinc-500/15"
                  : agent.status === "PENDING"
                  ? "bg-amber-500/15"
                  : "bg-red-500/15"
              )}>
                <CheckCircle2 className={cn(
                  "h-5 w-5",
                  agent.status === "VERIFIED"
                    ? "text-emerald-400"
                    : agent.status === "EXPIRED"
                    ? "text-zinc-400"
                    : agent.status === "PENDING"
                    ? "text-amber-400"
                    : "text-red-400"
                )} />
              </div>
              <div>
                <p className="text-sm font-medium">
                  {agent.status === "VERIFIED" ? "Credential Verified" :
                   agent.status === "EXPIRED" ? "Credential Expired" :
                   agent.status === "PENDING" ? "Verification Pending" :
                   "Credential Revoked"}
                </p>
                <p className="text-xs text-muted-foreground">
                  {agent.credentialType}
                </p>
              </div>
            </div>
            <StatusBadge status={agent.status} />
          </div>

          <div className="space-y-2.5 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground flex items-center gap-2">
                <Clock className="h-3.5 w-3.5" />Issued
              </span>
              <span className="text-xs">{formatDate(agent.issuedAt)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground flex items-center gap-2">
                <Clock className="h-3.5 w-3.5" />Expires
              </span>
              <span className="text-xs">{formatDate(agent.expiresAt)}</span>
            </div>
            {agent.lastActive && (
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground flex items-center gap-2">
                  <Activity className="h-3.5 w-3.5" />Last Active
                </span>
                <span className="text-xs">{formatDate(agent.lastActive)}</span>
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function DelegationScopeCard({ agent }: { agent: Agent }) {
  const scopeLabels: Record<string, { label: string; description: string }> = {
    "payment.send": { label: "Send Payments", description: "Initiate outbound payments" },
    "payment.receive": { label: "Receive Payments", description: "Accept inbound payments" },
    "compliance.check": { label: "Compliance Check", description: "Run compliance screenings" },
    "compliance.report": { label: "Compliance Report", description: "Generate compliance reports" },
    "invoice.create": { label: "Create Invoice", description: "Generate payment invoices" },
    "risk.monitor": { label: "Risk Monitor", description: "Monitor risk scores in real-time" },
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Lock className="h-4 w-4 text-primary" />
          <CardTitle>Delegation Scope</CardTitle>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-lg border border-border/50 bg-secondary/20 p-3">
              <p className="text-xs text-muted-foreground mb-1">Max Transaction</p>
              <p className="text-sm font-semibold">$50,000 USDC</p>
            </div>
            <div className="rounded-lg border border-border/50 bg-secondary/20 p-3">
              <p className="text-xs text-muted-foreground mb-1">Daily Limit</p>
              <p className="text-sm font-semibold">$500,000 USDC</p>
            </div>
          </div>

          <div>
            <p className="text-xs text-muted-foreground mb-2">Allowed Chains</p>
            <div className="flex flex-wrap gap-2">
              {["Ethereum", "Base", "Polygon"].map((chain) => (
                <span
                  key={chain}
                  className="inline-flex items-center gap-1.5 rounded-full border border-border/50 bg-secondary/30 px-3 py-1 text-xs"
                >
                  <Globe className="h-3 w-3 text-blue-400" />
                  {chain}
                </span>
              ))}
            </div>
          </div>

          <div>
            <p className="text-xs text-muted-foreground mb-2">Permissions</p>
            <div className="space-y-2">
              {(agent.delegationScope ?? []).map((scope) => {
                const info = scopeLabels[scope] ?? { label: scope, description: "" };
                return (
                  <div key={scope} className="flex items-center justify-between rounded-lg border border-border/50 bg-secondary/10 px-3 py-2">
                    <div>
                      <p className="text-sm font-medium">{info.label}</p>
                      <p className="text-xs text-muted-foreground">{info.description}</p>
                    </div>
                    <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function RiskScoreTrendCard({ agent }: { agent: Agent }) {
  const history = agent.riskScoreHistory ?? [];

  if (history.length === 0) {
    return (
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-amber-400" />
            <CardTitle>Risk Score Trend</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <TrendingUp className="h-8 w-8 text-muted-foreground/30 mb-2" />
            <p className="text-sm text-muted-foreground">No risk score data available</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const formatted = history.map((d) => ({
    date: new Date(d.date).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
    score: Math.round(d.score),
  }));

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-amber-400" />
            <CardTitle>Risk Score Trend</CardTitle>
          </div>
          <span className="text-xs text-muted-foreground">Last 30 days</span>
        </div>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={200}>
          <AreaChart data={formatted} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
            <defs>
              <linearGradient id="riskGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="hsl(38, 92%, 50%)" stopOpacity={0.3} />
                <stop offset="95%" stopColor="hsl(38, 92%, 50%)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(215, 25%, 13%)" vertical={false} />
            <XAxis
              dataKey="date"
              tick={{ fill: "hsl(215, 20%, 50%)", fontSize: 10 }}
              tickLine={false}
              axisLine={false}
              interval="preserveStartEnd"
            />
            <YAxis
              domain={[0, 100]}
              tick={{ fill: "hsl(215, 20%, 50%)", fontSize: 10 }}
              tickLine={false}
              axisLine={false}
            />
            <Tooltip content={<RiskChartTooltip />} />
            <Area
              type="monotone"
              dataKey="score"
              stroke="hsl(38, 92%, 50%)"
              strokeWidth={2}
              fill="url(#riskGrad)"
              animationDuration={1000}
            />
          </AreaChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}

function RecentTransactionsCard({ agentDid }: { agentDid: string }) {
  const { data: checks, isLoading } = useQuery({
    queryKey: ["compliance-checks"],
    queryFn: getComplianceChecks,
  });

  const agentChecks = checks?.filter((c) => c.agentDid === agentDid).slice(0, 10) ?? [];

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Activity className="h-4 w-4 text-primary" />
          <CardTitle>Recent Transactions</CardTitle>
        </div>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>ID</TableHead>
              <TableHead>Wallet</TableHead>
              <TableHead>Chain</TableHead>
              <TableHead>Amount</TableHead>
              <TableHead>Risk Score</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Date</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableSkeleton rows={5} cols={7} />
            ) : agentChecks.length === 0 ? (
              <TableEmpty message="No transactions found for this agent" colSpan={7} />
            ) : (
              agentChecks.map((check) => (
                <TableRow key={check.id}>
                  <TableCell>
                    <Link
                      href={`/compliance/${check.id}`}
                      className="text-primary hover:underline font-mono text-xs"
                    >
                      {check.id}
                    </Link>
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {shortenAddress(check.walletAddress)}
                  </TableCell>
                  <TableCell className="text-xs">{check.chain}</TableCell>
                  <TableCell className="text-xs">
                    {formatAmount(check.amount)} {check.currency}
                  </TableCell>
                  <TableCell>
                    <span className={cn(
                      "text-xs font-medium",
                      check.riskScore < 30 ? "text-emerald-400" :
                      check.riskScore < 60 ? "text-amber-400" :
                      "text-red-400"
                    )}>
                      {Math.round(check.riskScore)}
                    </span>
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={check.status} />
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {formatDate(check.createdAt)}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

export default function AgentDetailPage() {
  const params = useParams();
  const agentId = decodeURIComponent(params.id as string);

  const { data: agent, isLoading, isError } = useQuery({
    queryKey: ["agent", agentId],
    queryFn: () => getAgent(agentId),
  });

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="h-6 w-32 shimmer rounded" />
        <div className="glass-card rounded-xl p-6 space-y-4">
          <div className="flex items-center gap-4">
            <div className="h-14 w-14 shimmer rounded-xl" />
            <div className="space-y-2">
              <div className="h-5 w-40 shimmer rounded" />
              <div className="h-3 w-24 shimmer rounded" />
            </div>
          </div>
          <div className="grid grid-cols-4 gap-4">
            {Array.from({ length: 4 }, (_, i) => (
              <div key={i} className="h-16 shimmer rounded-lg" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (isError || !agent) {
    return (
      <div className="space-y-6">
        <Link
          href="/agents"
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Agents
        </Link>
        <div className="glass-card rounded-xl p-6 text-sm text-destructive">
          Agent not found or failed to load.
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between animate-fade-in">
        <Link
          href="/agents"
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Agents
        </Link>
        <div className="flex items-center gap-2">
          {agent.status === "VERIFIED" && (
            <>
              <Button variant="outline" size="sm" className="text-xs">
                Renew Credential
              </Button>
              <Button variant="outline" size="sm" className="text-xs text-red-400 hover:text-red-300">
                Revoke
              </Button>
            </>
          )}
          {agent.status === "EXPIRED" && (
            <Button size="sm" className="text-xs gap-1.5">
              <Shield className="h-3 w-3" />
              Reissue Credential
            </Button>
          )}
        </div>
      </div>

      <AgentProfileCard agent={agent} />

      <div className="grid gap-6 lg:grid-cols-2">
        <KYAVerificationCard agent={agent} />
        <DelegationScopeCard agent={agent} />
      </div>

      <RiskScoreTrendCard agent={agent} />

      <RecentTransactionsCard agentDid={agent.did} />
    </div>
  );
}
