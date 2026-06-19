"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  AreaChart,
  Area,
  type TooltipProps,
} from "recharts";
import {
  TrendingUp,
  Globe,
  Bot,
  BarChart3,
  PieChart as PieChartIcon,
  Activity,
  MapPin,
} from "lucide-react";
import { getAnalyticsData } from "@/lib/api";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  TableSkeleton,
} from "@/components/ui/table";
import { formatAmount, formatCompactNumber, formatDateShort, cn } from "@/lib/utils";

type TimePeriod = "24h" | "7d" | "30d" | "90d";

function ChartTooltip({ active, payload, label }: TooltipProps<number, string>) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-border/50 bg-card/95 backdrop-blur-xl p-3 shadow-2xl">
      <p className="text-xs font-medium text-muted-foreground mb-2">{label}</p>
      {payload.map((entry) => (
        <div key={entry.name} className="flex items-center gap-2 text-sm">
          <div className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: entry.color }} />
          <span className="text-muted-foreground capitalize">{entry.name}:</span>
          <span className="font-semibold tabular-nums">
            {typeof entry.value === "number" && entry.name === "volume"
              ? formatAmount(entry.value)
              : entry.value}
          </span>
        </div>
      ))}
    </div>
  );
}

function PieTooltipContent({ active, payload }: TooltipProps<number, string>) {
  if (!active || !payload?.length) return null;
  const entry = payload[0];
  return (
    <div className="rounded-lg border border-border/50 bg-card/95 backdrop-blur-xl p-3 shadow-2xl">
      <div className="flex items-center gap-2 text-sm">
        <div className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: entry.payload?.color }} />
        <span className="font-medium">{entry.name}:</span>
        <span className="font-semibold tabular-nums">{entry.value}</span>
      </div>
    </div>
  );
}

export default function AnalyticsPage() {
  const [timePeriod, setTimePeriod] = useState<TimePeriod>("30d");
  const { data: analytics, isLoading, isError } = useQuery({
    queryKey: ["analytics"],
    queryFn: getAnalyticsData,
  });

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="h-8 w-48 shimmer rounded" />
        <div className="grid gap-6 lg:grid-cols-2">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="glass-card rounded-xl p-6">
              <div className="h-5 w-32 shimmer rounded mb-4" />
              <div className="h-[300px] shimmer rounded-lg" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (isError || !analytics) {
    return (
      <div className="glass-card rounded-xl p-6 text-sm text-destructive">
        Failed to load analytics data.
      </div>
    );
  }

  // Filter data based on time period
  const volumeData = (() => {
    const daysMap: Record<TimePeriod, number> = { "24h": 1, "7d": 7, "30d": 30, "90d": 90 };
    const days = daysMap[timePeriod];
    const filtered = analytics.volumeByPeriod.slice(-Math.min(days, analytics.volumeByPeriod.length));
    return filtered.map((d) => ({
      ...d,
      date: formatDateShort(d.date),
    }));
  })();

  const totalVolume = analytics.volumeByPeriod.reduce((s, d) => s + d.volume, 0);
  const totalChecks = analytics.complianceBreakdown.reduce((s, d) => s + d.count, 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between animate-fade-in">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Analytics</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Compliance and transaction analytics overview
          </p>
        </div>
        <div className="flex items-center gap-1 rounded-lg border border-border/50 p-1">
          {(["24h", "7d", "30d", "90d"] as const).map((p) => (
            <Button
              key={p}
              variant={timePeriod === p ? "default" : "ghost"}
              size="sm"
              onClick={() => setTimePeriod(p)}
              className="text-xs h-7 px-3"
            >
              {p}
            </Button>
          ))}
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div className="glass-card rounded-lg p-4">
          <div className="flex items-center gap-2 mb-1">
            <Activity className="h-4 w-4 text-primary" />
            <p className="text-xs text-muted-foreground">Total Volume</p>
          </div>
          <p className="text-2xl font-bold">{formatAmount(totalVolume)}</p>
        </div>
        <div className="glass-card rounded-lg p-4">
          <div className="flex items-center gap-2 mb-1">
            <BarChart3 className="h-4 w-4 text-blue-400" />
            <p className="text-xs text-muted-foreground">Total Checks</p>
          </div>
          <p className="text-2xl font-bold">{formatCompactNumber(totalChecks)}</p>
        </div>
        <div className="glass-card rounded-lg p-4">
          <div className="flex items-center gap-2 mb-1">
            <TrendingUp className="h-4 w-4 text-emerald-400" />
            <p className="text-xs text-muted-foreground">Pass Rate</p>
          </div>
          <p className="text-2xl font-bold text-emerald-400">
            {((analytics.complianceBreakdown[0].count / totalChecks) * 100).toFixed(1)}%
          </p>
        </div>
        <div className="glass-card rounded-lg p-4">
          <div className="flex items-center gap-2 mb-1">
            <Bot className="h-4 w-4 text-amber-400" />
            <p className="text-xs text-muted-foreground">Active Agents</p>
          </div>
          <p className="text-2xl font-bold">{analytics.topAgents.length}</p>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Transaction Volume Chart */}
        <Card className="animate-slide-in-up">
          <CardHeader>
            <div className="flex items-center gap-2">
              <BarChart3 className="h-4 w-4 text-primary" />
              <CardTitle>Transaction Volume</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <AreaChart data={volumeData} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="volumeGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="hsl(217, 91%, 60%)" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="hsl(217, 91%, 60%)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(215, 25%, 13%)" vertical={false} />
                <XAxis dataKey="date" tick={{ fill: "hsl(215, 20%, 50%)", fontSize: 11 }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fill: "hsl(215, 20%, 50%)", fontSize: 11 }} tickLine={false} axisLine={false} tickFormatter={(v: number) => formatCompactNumber(v)} />
                <Tooltip content={<ChartTooltip />} />
                <Area type="monotone" dataKey="volume" stroke="hsl(217, 91%, 60%)" strokeWidth={2} fill="url(#volumeGrad)" animationDuration={1000} />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Compliance Decision Pie Chart */}
        <Card className="animate-slide-in-up">
          <CardHeader>
            <div className="flex items-center gap-2">
              <PieChartIcon className="h-4 w-4 text-primary" />
              <CardTitle>Compliance Decisions</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-center">
              <ResponsiveContainer width="100%" height={300}>
                <PieChart>
                  <Pie
                    data={analytics.complianceBreakdown}
                    cx="50%"
                    cy="50%"
                    innerRadius={70}
                    outerRadius={110}
                    paddingAngle={4}
                    dataKey="count"
                    nameKey="status"
                    animationDuration={1000}
                  >
                    {analytics.complianceBreakdown.map((entry, idx) => (
                      <Cell key={idx} fill={entry.color} stroke="transparent" />
                    ))}
                  </Pie>
                  <Tooltip content={<PieTooltipContent />} />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="flex items-center justify-center gap-6 mt-2">
              {analytics.complianceBreakdown.map((entry) => (
                <div key={entry.status} className="flex items-center gap-2">
                  <div className="h-3 w-3 rounded-full" style={{ backgroundColor: entry.color }} />
                  <span className="text-xs text-muted-foreground">{entry.status}</span>
                  <span className="text-xs font-semibold">{entry.count}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Risk Score Histogram */}
        <Card className="animate-slide-in-up">
          <CardHeader>
            <div className="flex items-center gap-2">
              <BarChart3 className="h-4 w-4 text-amber-400" />
              <CardTitle>Risk Score Distribution</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={analytics.riskDistribution} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(215, 25%, 13%)" vertical={false} />
                <XAxis dataKey="range" tick={{ fill: "hsl(215, 20%, 50%)", fontSize: 10 }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fill: "hsl(215, 20%, 50%)", fontSize: 11 }} tickLine={false} axisLine={false} />
                <Tooltip content={<ChartTooltip />} />
                <Bar dataKey="count" radius={[4, 4, 0, 0]} animationDuration={1000}>
                  {analytics.riskDistribution.map((entry, idx) => {
                    const rangeStart = parseInt(entry.range.split("-")[0]);
                    const color =
                      rangeStart < 30 ? "hsl(142, 76%, 50%)" :
                      rangeStart < 60 ? "hsl(45, 93%, 50%)" :
                      "hsl(0, 84%, 60%)";
                    return <Cell key={idx} fill={color} fillOpacity={0.7} />;
                  })}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Geographic Distribution */}
        <Card className="animate-slide-in-up">
          <CardHeader>
            <div className="flex items-center gap-2">
              <MapPin className="h-4 w-4 text-blue-400" />
              <CardTitle>Geographic Distribution</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {analytics.geoDistribution.map((geo) => (
                <div key={geo.country} className="space-y-1.5">
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium">{geo.country}</span>
                    <span className="text-muted-foreground tabular-nums">
                      {geo.count} ({geo.percentage}%)
                    </span>
                  </div>
                  <div className="h-2 w-full rounded-full bg-secondary overflow-hidden">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-blue-500 to-teal-500 transition-all duration-700"
                      style={{ width: `${geo.percentage}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-4 rounded-lg border border-border/50 bg-secondary/10 p-3">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Globe className="h-3.5 w-3.5" />
                <span>Interactive map visualization coming soon</span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Top Agents Table */}
      <Card className="animate-slide-in-up">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Bot className="h-4 w-4 text-primary" />
            <CardTitle>Top Agents by Volume</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Rank</TableHead>
                <TableHead>Agent</TableHead>
                <TableHead>DID</TableHead>
                <TableHead>Volume</TableHead>
                <TableHead>Checks</TableHead>
                <TableHead>Pass Rate</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {analytics.topAgents.map((agent, idx) => (
                <TableRow key={agent.did}>
                  <TableCell>
                    <span className={cn(
                      "flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold",
                      idx === 0 ? "bg-amber-500/20 text-amber-400" :
                      idx === 1 ? "bg-zinc-400/20 text-zinc-400" :
                      idx === 2 ? "bg-orange-500/20 text-orange-400" :
                      "bg-secondary text-muted-foreground"
                    )}>
                      {idx + 1}
                    </span>
                  </TableCell>
                  <TableCell className="font-medium">{agent.name}</TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">{agent.did}</TableCell>
                  <TableCell className="text-sm font-medium">{formatAmount(agent.volume)}</TableCell>
                  <TableCell className="text-sm">{formatCompactNumber(agent.checks)}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 w-16 rounded-full bg-secondary overflow-hidden">
                        <div
                          className="h-full rounded-full bg-emerald-500 transition-all"
                          style={{ width: `${agent.passRate}%` }}
                        />
                      </div>
                      <span className="text-xs text-emerald-400 tabular-nums">{agent.passRate.toFixed(1)}%</span>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
