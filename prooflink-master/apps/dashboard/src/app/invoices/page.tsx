"use client";

import { useQuery } from "@tanstack/react-query";
import { useState, useMemo } from "react";
import Link from "next/link";
import { Plus, Search, FileText } from "lucide-react";
import { getInvoices } from "@/lib/api";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/badge";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell, TableSkeleton, TableEmpty } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { formatAmount, formatDate, shortenAddress } from "@/lib/utils";
import type { Invoice } from "@/lib/api";

type StateFilter = "ALL" | Invoice["state"];

export default function InvoicesPage() {
  const [search, setSearch] = useState("");
  const [stateFilter, setStateFilter] = useState<StateFilter>("ALL");

  const { data: invoices, isLoading, isError } = useQuery({
    queryKey: ["invoices"],
    queryFn: getInvoices,
  });

  const filtered = useMemo(() => {
    if (!invoices) return [];
    return invoices.filter((inv) => {
      const matchesSearch =
        search === "" ||
        inv.number.toLowerCase().includes(search.toLowerCase()) ||
        inv.description.toLowerCase().includes(search.toLowerCase()) ||
        inv.to.toLowerCase().includes(search.toLowerCase());
      const matchesState = stateFilter === "ALL" || inv.state === stateFilter;
      return matchesSearch && matchesState;
    });
  }, [invoices, search, stateFilter]);

  const stateFilters: StateFilter[] = ["ALL", "DRAFT", "PENDING", "PAID", "REJECTED", "EXPIRED"];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between animate-fade-in">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Invoices</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Create and manage compliant payment invoices
          </p>
        </div>
        <Button asChild className="gap-2">
          <Link href="/invoices/new">
            <Plus className="h-4 w-4" />
            New Invoice
          </Link>
        </Button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {[
          { label: "Total", value: invoices?.length ?? 0, color: "text-foreground" },
          { label: "Paid", value: invoices?.filter((i) => i.state === "PAID").length ?? 0, color: "text-emerald-400" },
          { label: "Pending", value: invoices?.filter((i) => i.state === "PENDING").length ?? 0, color: "text-amber-400" },
          { label: "Draft", value: invoices?.filter((i) => i.state === "DRAFT").length ?? 0, color: "text-muted-foreground" },
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
              <FileText className="h-5 w-5 text-primary" />
              All Invoices
            </CardTitle>
            <div className="flex items-center gap-3">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Search invoices..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-9 w-[240px]"
                />
              </div>
              <div className="flex items-center gap-1 rounded-lg border border-border/50 p-1 overflow-x-auto">
                {stateFilters.map((f) => (
                  <Button
                    key={f}
                    variant={stateFilter === f ? "default" : "ghost"}
                    size="sm"
                    onClick={() => setStateFilter(f)}
                    className="text-xs h-7 px-2 whitespace-nowrap"
                  >
                    {f}
                  </Button>
                ))}
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Invoice #</TableHead>
                <TableHead>Description</TableHead>
                <TableHead>To</TableHead>
                <TableHead>Chain</TableHead>
                <TableHead>Amount</TableHead>
                <TableHead>State</TableHead>
                <TableHead>Due Date</TableHead>
                <TableHead>Created</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableSkeleton rows={8} cols={8} />
              ) : isError ? (
                <TableEmpty message="Failed to load invoices." colSpan={8} />
              ) : filtered.length === 0 ? (
                <TableEmpty message="No invoices found" colSpan={8} />
              ) : (
                filtered.map((inv) => (
                  <TableRow key={inv.id}>
                    <TableCell>
                      <Link
                        href={`/invoices/${inv.id}`}
                        className="text-primary hover:underline font-mono text-xs"
                      >
                        {inv.number}
                      </Link>
                    </TableCell>
                    <TableCell className="text-sm max-w-[200px] truncate">
                      {inv.description}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {shortenAddress(inv.to)}
                    </TableCell>
                    <TableCell className="text-xs">{inv.chain}</TableCell>
                    <TableCell className="text-sm font-medium">
                      {formatAmount(inv.amount)}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={inv.state} />
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                      {formatDate(inv.dueDate)}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                      {formatDate(inv.createdAt)}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
