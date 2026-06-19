"use client";

import { useQuery } from "@tanstack/react-query";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useState } from "react";
import {
  FileText,
  ArrowLeft,
  User,
  Wallet,
  Clock,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Send,
  Ban,
  CreditCard,
  Shield,
  DollarSign,
  Loader2,
  Copy,
} from "lucide-react";
import { getInvoice, getComplianceCheck, type Invoice } from "@/lib/api";
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
} from "@/components/ui/table";
import { formatDate, formatAmount, shortenAddress, cn } from "@/lib/utils";

function InvoiceHeaderCard({ invoice }: { invoice: Invoice }) {
  const statusConfig: Record<Invoice["state"], { icon: typeof CheckCircle2; color: string; bg: string }> = {
    DRAFT: { icon: FileText, color: "text-amber-400", bg: "bg-amber-500/15" },
    PENDING: { icon: Clock, color: "text-amber-400", bg: "bg-amber-500/15" },
    PAID: { icon: CheckCircle2, color: "text-emerald-400", bg: "bg-emerald-500/15" },
    REJECTED: { icon: XCircle, color: "text-red-400", bg: "bg-red-500/15" },
    EXPIRED: { icon: AlertTriangle, color: "text-zinc-400", bg: "bg-zinc-500/15" },
  };

  const config = statusConfig[invoice.state];
  const StatusIcon = config.icon;

  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-4">
            <div className={cn("flex h-12 w-12 items-center justify-center rounded-xl", config.bg)}>
              <StatusIcon className={cn("h-6 w-6", config.color)} />
            </div>
            <div>
              <div className="flex items-center gap-3">
                <h2 className="text-xl font-bold">{invoice.number}</h2>
                <StatusBadge status={invoice.state} />
              </div>
              <p className="text-sm text-muted-foreground mt-1">{invoice.description}</p>
            </div>
          </div>
          <div className="text-right">
            <p className="text-3xl font-bold tracking-tight">
              {formatAmount(invoice.amount)}
            </p>
            <p className="text-sm text-muted-foreground">{invoice.currency}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function PartyInfoCards({ invoice }: { invoice: Invoice }) {
  const [copied, setCopied] = useState<string | null>(null);

  const handleCopy = (text: string, field: string) => {
    navigator.clipboard.writeText(text).catch(() => undefined);
    setCopied(field);
    setTimeout(() => setCopied(null), 2000);
  };

  return (
    <div className="grid gap-6 sm:grid-cols-2">
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <User className="h-4 w-4 text-primary" />
            <CardTitle className="text-base">From (Payer)</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">DID</span>
              <div className="flex items-center gap-1.5">
                <code className="text-xs font-mono bg-secondary/50 px-2 py-0.5 rounded max-w-[180px] truncate">
                  {invoice.from}
                </code>
                <button onClick={() => handleCopy(invoice.from, "from")} className="text-muted-foreground hover:text-foreground">
                  <Copy className="h-3 w-3" />
                </button>
              </div>
            </div>
            {copied === "from" && (
              <p className="text-xs text-emerald-400 text-right">Copied!</p>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Wallet className="h-4 w-4 text-blue-400" />
            <CardTitle className="text-base">To (Payee)</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Wallet</span>
              <div className="flex items-center gap-1.5">
                <code className="text-xs font-mono bg-secondary/50 px-2 py-0.5 rounded">
                  {shortenAddress(invoice.to)}
                </code>
                <button onClick={() => handleCopy(invoice.to, "to")} className="text-muted-foreground hover:text-foreground">
                  <Copy className="h-3 w-3" />
                </button>
              </div>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Chain</span>
              <span className="text-xs">{invoice.chain}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Pay-to Address</span>
              <div className="flex items-center gap-1.5">
                <code className="text-xs font-mono bg-secondary/50 px-2 py-0.5 rounded">
                  {shortenAddress(invoice.walletAddress)}
                </code>
                <button onClick={() => handleCopy(invoice.walletAddress, "wallet")} className="text-muted-foreground hover:text-foreground">
                  <Copy className="h-3 w-3" />
                </button>
              </div>
            </div>
            {copied === "to" || copied === "wallet" ? (
              <p className="text-xs text-emerald-400 text-right">Copied!</p>
            ) : null}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function LineItemsCard({ invoice }: { invoice: Invoice }) {
  const lineItems = invoice.lineItems ?? [];
  const subtotal = lineItems.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <DollarSign className="h-4 w-4 text-primary" />
          <CardTitle className="text-base">Line Items</CardTitle>
        </div>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Description</TableHead>
              <TableHead className="text-right">Qty</TableHead>
              <TableHead className="text-right">Unit Price</TableHead>
              <TableHead className="text-right">Total</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {lineItems.map((item, idx) => (
              <TableRow key={idx}>
                <TableCell className="text-sm">{item.description}</TableCell>
                <TableCell className="text-sm text-right">{item.quantity}</TableCell>
                <TableCell className="text-sm text-right">{formatAmount(item.unitPrice)}</TableCell>
                <TableCell className="text-sm text-right font-medium">
                  {formatAmount(item.quantity * item.unitPrice)}
                </TableCell>
              </TableRow>
            ))}
            <TableRow>
              <TableCell colSpan={3} className="text-sm font-medium text-right">
                Subtotal
              </TableCell>
              <TableCell className="text-sm text-right font-bold">
                {formatAmount(subtotal)}
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell colSpan={3} className="text-sm font-semibold text-right">
                Total
              </TableCell>
              <TableCell className="text-right text-lg font-bold text-primary">
                {formatAmount(invoice.amount)}
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function ComplianceTimelineCard({ invoice }: { invoice: Invoice }) {
  const { data: check } = useQuery({
    queryKey: ["compliance-check", invoice.complianceCheckId],
    queryFn: () => getComplianceCheck(invoice.complianceCheckId ?? ""),
    enabled: !!invoice.complianceCheckId,
  });

  type StepStatus = "complete" | "error" | "warning" | "pending";

  const steps: { label: string; description: string; time: string; status: StepStatus; icon: typeof FileText }[] = [
    {
      label: "Invoice Created",
      description: `Invoice ${invoice.number} generated`,
      time: invoice.createdAt,
      status: "complete",
      icon: FileText,
    },
  ];

  if (invoice.complianceCheckId) {
    steps.push({
      label: "Compliance Check",
      description: check
        ? `Risk score: ${Math.round(check.riskScore)} - ${check.status}`
        : "Running compliance checks...",
      time: check?.createdAt ?? invoice.createdAt,
      status: check?.status === "PASS" ? "complete" : check?.status === "FAIL" ? "error" : "warning",
      icon: Shield,
    });
  }

  if (invoice.state === "PENDING") {
    steps.push({
      label: "Awaiting Payment",
      description: `Due by ${formatDate(invoice.dueDate)}`,
      time: invoice.createdAt,
      status: "pending",
      icon: Clock,
    });
  }

  if (invoice.paidAt) {
    steps.push({
      label: "Payment Received",
      description: `${formatAmount(invoice.amount)} ${invoice.currency} on ${invoice.chain}`,
      time: invoice.paidAt,
      status: "complete",
      icon: CheckCircle2,
    });
  }

  if (invoice.state === "REJECTED") {
    steps.push({
      label: "Invoice Rejected",
      description: "Payment rejected due to compliance failure",
      time: invoice.createdAt,
      status: "error",
      icon: XCircle,
    });
  }

  const statusColors: Record<StepStatus, string> = {
    complete: "border-emerald-500 bg-emerald-500/15 text-emerald-400",
    error: "border-red-500 bg-red-500/15 text-red-400",
    warning: "border-amber-500 bg-amber-500/15 text-amber-400",
    pending: "border-border bg-secondary/30 text-muted-foreground",
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Clock className="h-4 w-4 text-primary" />
          <CardTitle className="text-base">Compliance & Payment Timeline</CardTitle>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-0">
          {steps.map((step, idx) => {
            const StepIcon = step.icon;
            return (
              <div key={idx} className="flex gap-4">
                <div className="flex flex-col items-center">
                  <div className={cn(
                    "flex h-8 w-8 items-center justify-center rounded-full border",
                    statusColors[step.status]
                  )}>
                    <StepIcon className="h-4 w-4" />
                  </div>
                  {idx < steps.length - 1 && (
                    <div className="w-px flex-1 bg-border/50 my-1" />
                  )}
                </div>
                <div className="pb-6">
                  <p className="text-sm font-medium">{step.label}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{step.description}</p>
                  <p className="text-[11px] text-muted-foreground/60 mt-1">{formatDate(step.time)}</p>
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

function InvoiceActions({ invoice }: { invoice: Invoice }) {
  const [acting, setActing] = useState<string | null>(null);

  const handleAction = async (action: string) => {
    setActing(action);
    await new Promise((r) => setTimeout(r, 1500));
    setActing(null);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Actions</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {invoice.state === "DRAFT" && (
          <Button
            onClick={() => handleAction("send")}
            disabled={acting !== null}
            className="w-full gap-2"
          >
            {acting === "send" ? (
              <><Loader2 className="h-4 w-4 animate-spin" />Sending...</>
            ) : (
              <><Send className="h-4 w-4" />Send Invoice</>
            )}
          </Button>
        )}
        {invoice.state === "PENDING" && (
          <Button
            onClick={() => handleAction("markpaid")}
            disabled={acting !== null}
            className="w-full gap-2"
            variant="default"
          >
            {acting === "markpaid" ? (
              <><Loader2 className="h-4 w-4 animate-spin" />Processing...</>
            ) : (
              <><CreditCard className="h-4 w-4" />Mark as Paid</>
            )}
          </Button>
        )}
        {(invoice.state === "DRAFT" || invoice.state === "PENDING") && (
          <Button
            onClick={() => handleAction("cancel")}
            disabled={acting !== null}
            variant="outline"
            className="w-full gap-2 text-red-400 hover:text-red-300"
          >
            {acting === "cancel" ? (
              <><Loader2 className="h-4 w-4 animate-spin" />Cancelling...</>
            ) : (
              <><Ban className="h-4 w-4" />Cancel Invoice</>
            )}
          </Button>
        )}
        {invoice.state === "PAID" && (
          <div className="flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3">
            <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
            <p className="text-xs text-emerald-400">
              Payment received on {invoice.paidAt ? formatDate(invoice.paidAt) : "N/A"}
            </p>
          </div>
        )}
        {invoice.state === "REJECTED" && (
          <div className="flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 p-3">
            <XCircle className="h-4 w-4 text-red-400 shrink-0" />
            <p className="text-xs text-red-400">
              This invoice was rejected due to compliance failure
            </p>
          </div>
        )}

        <div className="border-t border-border/50 pt-3 space-y-2 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Created</span>
            <span className="text-xs">{formatDate(invoice.createdAt)}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Due Date</span>
            <span className="text-xs">{formatDate(invoice.dueDate)}</span>
          </div>
          {invoice.complianceCheckId && (
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Compliance Check</span>
              <Link
                href={`/compliance/${invoice.complianceCheckId}`}
                className="text-xs text-primary hover:underline font-mono"
              >
                {invoice.complianceCheckId}
              </Link>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export default function InvoiceDetailPage() {
  const params = useParams();
  const invoiceId = params.id as string;

  const { data: invoice, isLoading, isError } = useQuery({
    queryKey: ["invoice", invoiceId],
    queryFn: () => getInvoice(invoiceId),
  });

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="h-6 w-32 shimmer rounded" />
        <div className="glass-card rounded-xl p-6 space-y-4">
          <div className="flex items-center gap-4">
            <div className="h-12 w-12 shimmer rounded-xl" />
            <div className="space-y-2">
              <div className="h-5 w-40 shimmer rounded" />
              <div className="h-3 w-24 shimmer rounded" />
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (isError || !invoice) {
    return (
      <div className="space-y-6">
        <Link
          href="/invoices"
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Invoices
        </Link>
        <div className="glass-card rounded-xl p-6 text-sm text-destructive">
          Invoice not found or failed to load.
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="animate-fade-in">
        <Link
          href="/invoices"
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Invoices
        </Link>
      </div>

      <InvoiceHeaderCard invoice={invoice} />

      <PartyInfoCards invoice={invoice} />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-6">
          <LineItemsCard invoice={invoice} />
          <ComplianceTimelineCard invoice={invoice} />
        </div>
        <div>
          <InvoiceActions invoice={invoice} />
        </div>
      </div>
    </div>
  );
}
