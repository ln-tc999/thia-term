"use client";

import { useQuery } from "@tanstack/react-query";
import { useState, useMemo } from "react";
import { Search, Shield, Calendar } from "lucide-react";
import Link from "next/link";
import { getComplianceChecks } from "@/lib/api";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/badge";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell, TableSkeleton, TableEmpty } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { formatAmount, formatDate, shortenAddress } from "@/lib/utils";

type StatusFilter = "ALL" | "PASS" | "FAIL" | "REVIEW";

const statusLabels: Record<StatusFilter, string> = {
  ALL: "All",
  PASS: "Approved",
  FAIL: "Rejected",
  REVIEW: "Escalated",
};

export default function CompliancePage() {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("ALL");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const { data: checks, isLoading, isError } = useQuery({
    queryKey: ["compliance-checks"],
    queryFn: getComplianceChecks,
  });

  const filtered = useMemo(() => {
    if (!checks) return [];
    return checks.filter((c) => {
      const matchesSearch =
        search === "" ||
        c.id.toLowerCase().includes(search.toLowerCase()) ||
        c.walletAddress.toLowerCase().includes(search.toLowerCase()) ||
        c.chain.toLowerCase().includes(search.toLowerCase());
      const matchesStatus = statusFilter === "ALL" || c.status === statusFilter;

      let matchesDate = true;
      if (dateFrom) {
        matchesDate = matchesDate && new Date(c.createdAt) >= new Date(dateFrom);
      }
      if (dateTo) {
        const toDate = new Date(dateTo);
        toDate.setHours(23, 59, 59, 999);
        matchesDate = matchesDate && new Date(c.createdAt) <= toDate;
      }

      return matchesSearch && matchesStatus && matchesDate;
    });
  }, [checks, search, statusFilter, dateFrom, dateTo]);

  const statusFilters: StatusFilter[] = ["ALL", "PASS", "FAIL", "REVIEW"];

  const counts = useMemo(() => {
    if (!checks) return { total: 0, approved: 0, rejected: 0, escalated: 0 };
    return {
      total: checks.length,
      approved: checks.filter((c) => c.status === "PASS").length,
      rejected: checks.filter((c) => c.status === "FAIL").length,
      escalated: checks.filter((c) => c.status === "REVIEW").length,
    };
  }, [checks]);

  return (
    <div className="space-y-6">
      <div className="animate-fade-in">
        <h1 className="text-2xl font-bold tracking-tight">Compliance History</h1>
        <p className="text-sm text-muted-foreground mt-1">
          View and search all compliance decisions
        </p>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {[
          { label: "Total Decisions", value: counts.total, color: "text-foreground" },
          { label: "Approved", value: counts.approved, color: "text-emerald-400" },
          { label: "Rejected", value: counts.rejected, color: "text-red-400" },
          { label: "Escalated", value: counts.escalated, color: "text-amber-400" },
        ].map((s) => (
          <div key={s.label} className="glass-card rounded-lg p-4">
            <p className="text-xs text-muted-foreground">{s.label}</p>
            <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
          </div>
        ))}
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <CardTitle className="flex items-center gap-2">
              <Shield className="h-5 w-5 text-primary" />
              All Decisions
            </CardTitle>
            <div className="flex flex-wrap items-center gap-3">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Search by ID, address, chain..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-9 w-[280px]"
                />
              </div>
              <div className="flex items-center gap-1 rounded-lg border border-border/50 p-1">
                {statusFilters.map((f) => (
                  <Button
                    key={f}
                    variant={statusFilter === f ? "default" : "ghost"}
                    size="sm"
                    onClick={() => setStatusFilter(f)}
                    className="text-xs h-7 px-2.5"
                  >
                    {statusLabels[f]}
                  </Button>
                ))}
              </div>
            </div>
          </div>
          {/* Date Range Picker */}
          <div className="flex items-center gap-3 mt-3">
            <Calendar className="h-4 w-4 text-muted-foreground shrink-0" />
            <div className="flex items-center gap-2">
              <Input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="h-8 w-[150px] text-xs"
                aria-label="From date"
              />
              <span className="text-xs text-muted-foreground">to</span>
              <Input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="h-8 w-[150px] text-xs"
                aria-label="To date"
              />
              {(dateFrom || dateTo) && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => { setDateFrom(""); setDateTo(""); }}
                  className="text-xs h-7 px-2 text-muted-foreground"
                >
                  Clear
                </Button>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Check ID</TableHead>
                <TableHead>Wallet Address</TableHead>
                <TableHead>Chain</TableHead>
                <TableHead>Amount</TableHead>
                <TableHead>Risk Score</TableHead>
                <TableHead>Decision</TableHead>
                <TableHead>Agent</TableHead>
                <TableHead>Date</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableSkeleton rows={10} cols={8} />
              ) : isError ? (
                <TableEmpty message="Failed to load compliance decisions." colSpan={8} />
              ) : filtered.length === 0 ? (
                <TableEmpty message="No compliance decisions found" colSpan={8} />
              ) : (
                filtered.map((check) => (
                  <TableRow
                    key={check.id}
                    className="cursor-pointer hover:bg-secondary/40 transition-colors"
                  >
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
                      {formatAmount(check.amount)}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 w-16 rounded-full bg-secondary overflow-hidden">
                          <div
                            className="h-full rounded-full transition-all"
                            style={{
                              width: `${Math.min(check.riskScore, 100)}%`,
                              backgroundColor:
                                check.riskScore < 30
                                  ? "hsl(142, 76%, 50%)"
                                  : check.riskScore < 60
                                  ? "hsl(45, 93%, 50%)"
                                  : "hsl(0, 84%, 60%)",
                            }}
                          />
                        </div>
                        <span className="text-xs text-muted-foreground w-8">
                          {Math.round(check.riskScore)}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={check.status} />
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {shortenAddress(check.agentDid, 8)}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                      {formatDate(check.createdAt)}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
          {!isLoading && !isError && filtered.length > 0 && (
            <div className="mt-4 text-xs text-muted-foreground text-center">
              Showing {filtered.length} of {checks?.length ?? 0} decisions
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
