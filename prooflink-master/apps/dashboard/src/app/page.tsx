"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import {
  Shield,
  TrendingUp,
  Bot,
  ArrowUpRight,
  ArrowDownRight,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Clock,
  Activity,
  Zap,
  Search,
  FileText,
  type LucideIcon,
} from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/badge";
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
import { VolumeChart } from "@/components/charts/volume-chart";
import { ActivityFeed } from "@/components/activity-feed";
import {
  getDashboardStats,
  getVolumeData,
  getComplianceChecks,
  getSystemHealth,
} from "@/lib/api";
import {
  formatAmount,
  formatDate,
  formatCompactNumber,
  shortenAddress,
  cn,
} from "@/lib/utils";
import Link from "next/link";

// ─── Sparkline ──────────────────────────────────────────────────────────────

function Sparkline({ data, color = "#3b82f6", width = 80, height = 24 }: { data: number[]; color?: string; width?: number; height?: number }) {
  if (data.length < 2) return null;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;

  const points = data
    .map((v, i) => {
      const x = (i / (data.length - 1)) * width;
      const y = height - ((v - min) / range) * height;
      return `${x},${y}`;
    })
    .join(" ");

  return (
    <svg width={width} height={height} className="overflow-visible" aria-hidden="true">
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// ─── Animated Counter ────────────────────────────────────────────────────────

function useAnimatedCounter(target: number, duration = 1200): number {
  const [count, setCount] = useState(0);
  const startTime = useRef<number | null>(null);
  const rafId = useRef<number>(0);

  useEffect(() => {
    if (target === 0) {
      setCount(0);
      return;
    }

    startTime.current = null;

    function step(timestamp: number) {
      if (!startTime.current) startTime.current = timestamp;
      const progress = Math.min((timestamp - startTime.current) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setCount(Math.floor(eased * target));
      if (progress < 1) {
        rafId.current = requestAnimationFrame(step);
      } else {
        setCount(target);
      }
    }

    rafId.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(rafId.current);
  }, [target, duration]);

  return count;
}

function AnimatedStatCard({
  title,
  rawValue,
  change,
  icon: Icon,
  iconColor,
  suffix,
  prefix,
  sparklineData,
  sparklineColor,
}: {
  title: string;
  rawValue: number;
  change?: number;
  icon: LucideIcon;
  iconColor: string;
  suffix?: string;
  prefix?: string;
  sparklineData?: number[];
  sparklineColor?: string;
}) {
  const animated = useAnimatedCounter(rawValue);
  const isPositive = change !== undefined && change >= 0;

  const displayValue = (() => {
    if (prefix === "$") {
      return `$${new Intl.NumberFormat("en-US", {
        notation: "compact",
        maximumFractionDigits: 1,
      }).format(animated)}`;
    }
    if (suffix === "%") {
      return `${animated}%`;
    }
    if (suffix === "ms") {
      return `${animated}ms`;
    }
    return formatCompactNumber(animated);
  })();

  return (
    <div className="glass-card rounded-xl p-6 hover:border-primary/30 transition-all duration-300 group animate-slide-in-up">
      <div className="flex items-start justify-between">
        <div className="space-y-1">
          <p className="text-sm text-muted-foreground">{title}</p>
          <p className="text-2xl font-bold tracking-tight tabular-nums">
            {displayValue}
          </p>
        </div>
        <div
          className={cn(
            "rounded-lg p-2.5 bg-secondary/80 group-hover:scale-110 transition-transform",
            iconColor
          )}
        >
          <Icon className="h-5 w-5" />
        </div>
      </div>
      <div className="mt-3 flex items-center justify-between">
        <div className="flex items-center gap-1 text-xs">
          {change !== undefined && (
            <>
              {isPositive ? (
                <ArrowUpRight className="h-3.5 w-3.5 text-emerald-400" />
              ) : (
                <ArrowDownRight className="h-3.5 w-3.5 text-red-400" />
              )}
              <span className={isPositive ? "text-emerald-400" : "text-red-400"}>
                {Math.abs(change)}%
              </span>
              <span className="text-muted-foreground">vs last 30d</span>
            </>
          )}
        </div>
        {sparklineData && sparklineData.length > 1 && (
          <Sparkline data={sparklineData} color={sparklineColor} />
        )}
      </div>
    </div>
  );
}

// ─── Stats ───────────────────────────────────────────────────────────────────

function StatsSection() {
  const { data: stats, isLoading, isError } = useQuery({
    queryKey: ["dashboard-stats"],
    queryFn: getDashboardStats,
  });

  // Generate sparkline data
  const sparklines = {
    checks: Array.from({ length: 14 }, () => Math.floor(Math.random() * 500) + 300),
    passRate: Array.from({ length: 14 }, () => 90 + Math.random() * 8),
    volume: Array.from({ length: 14 }, () => Math.floor(Math.random() * 500000) + 200000),
    agents: Array.from({ length: 14 }, () => Math.floor(Math.random() * 2) + 2),
  };

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="glass-card rounded-xl p-6">
            <div className="space-y-3">
              <div className="h-4 w-24 shimmer rounded" />
              <div className="h-8 w-32 shimmer rounded" />
              <div className="h-3 w-20 shimmer rounded" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (isError || !stats) {
    return (
      <div className="glass-card rounded-xl p-6 text-sm text-destructive">
        Failed to load dashboard stats.
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4 stagger-children">
      <AnimatedStatCard
        title="Total Checks"
        rawValue={stats.totalChecks}
        change={stats.checksChange}
        icon={Shield}
        iconColor="text-blue-400"
        sparklineData={sparklines.checks}
        sparklineColor="#60a5fa"
      />
      <AnimatedStatCard
        title="Approved Rate"
        rawValue={Math.round(stats.passRate)}
        change={stats.passRateChange}
        icon={TrendingUp}
        iconColor="text-emerald-400"
        suffix="%"
        sparklineData={sparklines.passRate}
        sparklineColor="#34d399"
      />
      <AnimatedStatCard
        title="Average Latency"
        rawValue={42}
        change={-8.2}
        icon={Clock}
        iconColor="text-blue-400"
        suffix="ms"
        sparklineData={Array.from({ length: 14 }, () => Math.floor(Math.random() * 30) + 30)}
        sparklineColor="#60a5fa"
      />
      <AnimatedStatCard
        title="Active Agents"
        rawValue={stats.activeAgents}
        change={stats.agentsChange}
        icon={Bot}
        iconColor="text-amber-400"
        sparklineData={sparklines.agents}
        sparklineColor="#fbbf24"
      />
    </div>
  );
}

// ─── Chart ───────────────────────────────────────────────────────────────────

function ChartSection() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["volume-data"],
    queryFn: getVolumeData,
  });

  return (
    <Card className="animate-slide-in-up">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Activity className="h-4 w-4 text-primary" aria-hidden="true" />
            <CardTitle>Compliance Volume</CardTitle>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-1.5">
              <div className="h-2.5 w-2.5 rounded-full bg-blue-500" />
              <span className="text-xs text-muted-foreground">Passed</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="h-2.5 w-2.5 rounded-full bg-red-500" />
              <span className="text-xs text-muted-foreground">Failed</span>
            </div>
            <span className="text-xs text-muted-foreground/60">Last 30 days</span>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="h-[320px] shimmer rounded-lg" />
        ) : isError || !data ? (
          <div className="h-[320px] flex items-center justify-center text-sm text-destructive">
            Failed to load chart data.
          </div>
        ) : (
          <VolumeChart data={data} />
        )}
      </CardContent>
    </Card>
  );
}

// ─── System Health ──────────────────────────────────────────────────────────

function SystemHealth() {
  const { data: health, isLoading } = useQuery({
    queryKey: ["system-health"],
    queryFn: getSystemHealth,
    refetchInterval: 60000,
  });

  if (isLoading || !health) {
    return (
      <Card className="animate-slide-in-up">
        <CardHeader><CardTitle className="text-base">System Health</CardTitle></CardHeader>
        <CardContent>
          <div className="space-y-3">
            {Array.from({ length: 5 }, (_, i) => (
              <div key={i} className="h-6 shimmer rounded" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  const statusColor = {
    operational: "text-emerald-400",
    degraded: "text-amber-400",
    down: "text-red-400",
  };

  const statusDot = {
    operational: "bg-emerald-500",
    degraded: "bg-amber-500",
    down: "bg-red-500",
  };

  return (
    <Card className="animate-slide-in-up">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Zap className="h-4 w-4 text-primary" />
            <CardTitle className="text-base">System Health</CardTitle>
          </div>
          <span className={cn("text-xs font-medium capitalize", statusColor[health.status])}>
            {health.status}
          </span>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">Uptime</span>
          <span className="font-medium text-emerald-400">{health.uptime}%</span>
        </div>
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">Avg Latency</span>
          <span className="font-medium">{health.latency}ms</span>
        </div>
        <div className="border-t border-border/30 pt-3 space-y-2">
          {health.services.map((svc) => (
            <div key={svc.name} className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">{svc.name}</span>
              <div className="flex items-center gap-1.5">
                <div className={cn("h-1.5 w-1.5 rounded-full", statusDot[svc.status])} />
                <span className={cn("text-[10px] capitalize", statusColor[svc.status])}>
                  {svc.status}
                </span>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Quick Actions ───────────────────────────────────────────────────────────

function QuickActions() {
  const actions = [
    { href: "/screen", label: "Screen Address", desc: "Run compliance check on a wallet", icon: Shield, color: "teal" },
    { href: "/invoices/new", label: "Create Invoice", desc: "Generate a compliant invoice", icon: FileText, color: "blue" },
    { href: "/agents", label: "Manage Agents", desc: "View and issue KYA credentials", icon: Bot, color: "amber" },
    { href: "/analytics", label: "View Analytics", desc: "Compliance and transaction analytics", icon: TrendingUp, color: "emerald" },
  ];

  const colorMap: Record<string, { bg: string; bgHover: string; text: string }> = {
    teal: { bg: "bg-teal-500/15", bgHover: "hover:border-teal-500/30", text: "text-teal-400" },
    blue: { bg: "bg-blue-500/15", bgHover: "hover:border-blue-500/30", text: "text-blue-400" },
    amber: { bg: "bg-amber-500/15", bgHover: "hover:border-amber-500/30", text: "text-amber-400" },
    emerald: { bg: "bg-emerald-500/15", bgHover: "hover:border-emerald-500/30", text: "text-emerald-400" },
  };

  return (
    <Card className="animate-slide-in-up">
      <CardHeader>
        <CardTitle>Quick Actions</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {actions.map((action) => {
          const colors = colorMap[action.color];
          return (
            <Link
              key={action.href}
              href={action.href}
              className={cn(
                "flex items-center gap-3 rounded-lg border border-border/40 bg-secondary/20 p-3 hover:bg-secondary/40 transition-all duration-200 group",
                colors.bgHover
              )}
            >
              <div className={cn("rounded-lg p-2 group-hover:scale-110 transition-transform", colors.bg)}>
                <action.icon className={cn("h-4 w-4", colors.text)} />
              </div>
              <div>
                <p className="text-sm font-medium">{action.label}</p>
                <p className="text-xs text-muted-foreground">{action.desc}</p>
              </div>
            </Link>
          );
        })}
      </CardContent>
    </Card>
  );
}

// ─── Recent Checks Table ─────────────────────────────────────────────────────

function RecentChecks() {
  const { data: checks, isLoading, isError } = useQuery({
    queryKey: ["compliance-checks"],
    queryFn: getComplianceChecks,
  });

  return (
    <Card className="animate-slide-in-up">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Shield className="h-4 w-4 text-primary" aria-hidden="true" />
            <CardTitle>Recent Compliance Checks</CardTitle>
          </div>
          <Link
            href="/compliance"
            className="text-xs text-primary hover:text-primary/80 transition-colors"
          >
            View all
          </Link>
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
              <TableHead>Status</TableHead>
              <TableHead>Date</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableSkeleton rows={5} cols={6} />
            ) : isError ? (
              <TableEmpty
                message="Failed to load compliance checks."
                colSpan={6}
              />
            ) : (
              checks?.slice(0, 8).map((check) => (
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

// ─── Page ────────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  return (
    <div className="space-y-6">
      <div className="animate-fade-in">
        <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Real-time compliance monitoring for your payment infrastructure
        </p>
      </div>

      <StatsSection />

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <ChartSection />
        </div>
        <div className="xl:col-span-1">
          <ActivityFeed />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <RecentChecks />
        </div>
        <div className="xl:col-span-1 space-y-6">
          <QuickActions />
          <SystemHealth />
        </div>
      </div>
    </div>
  );
}
