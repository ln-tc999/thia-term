"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  Send,
  FileText,
  Plus,
  Trash2,
  Eye,
  CheckCircle2,
  Shield,
} from "lucide-react";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn, formatAmount } from "@/lib/utils";

const CHAINS = ["Ethereum", "Polygon", "Base", "Arbitrum", "Solana"];
const CURRENCIES = ["USDC", "USDT", "DAI"];

interface LineItem {
  id: string;
  description: string;
  quantity: string;
  unitPrice: string;
}

function generateId(): string {
  return `li_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

export default function NewInvoicePage() {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [step, setStep] = useState<"details" | "preview">("details");
  const [form, setForm] = useState({
    to: "",
    currency: "USDC",
    chain: "Base",
    description: "",
    dueDate: "",
    walletAddress: "",
  });
  const [lineItems, setLineItems] = useState<LineItem[]>([
    { id: generateId(), description: "", quantity: "1", unitPrice: "" },
  ]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (step === "details") {
      setStep("preview");
      return;
    }
    setIsSubmitting(true);
    try {
      const { createInvoiceApi } = await import("@/lib/api");
      await createInvoiceApi({
        sellerWallet: form.walletAddress,
        buyerWallet: form.to,
        lineItems: lineItems.map((li) => ({
          description: li.description,
          quantity: parseFloat(li.quantity) || 1,
          unitPrice: parseFloat(li.unitPrice) || 0,
          total: Math.round((parseFloat(li.quantity) || 1) * (parseFloat(li.unitPrice) || 0) * 100) / 100,
        })),
        currency: form.currency,
        totalAmount: Math.round(totalAmount * 100) / 100,
        dueDate: form.dueDate || undefined,
      });
    } finally {
      setIsSubmitting(false);
    }
    router.push("/invoices");
  };

  const updateField = (field: keyof typeof form, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const addLineItem = () => {
    setLineItems((prev) => [
      ...prev,
      { id: generateId(), description: "", quantity: "1", unitPrice: "" },
    ]);
  };

  const removeLineItem = (id: string) => {
    if (lineItems.length <= 1) return;
    setLineItems((prev) => prev.filter((li) => li.id !== id));
  };

  const updateLineItem = (
    id: string,
    field: keyof Omit<LineItem, "id">,
    value: string
  ) => {
    setLineItems((prev) =>
      prev.map((li) => (li.id === id ? { ...li, [field]: value } : li))
    );
  };

  const totalAmount = lineItems.reduce((sum, li) => {
    const qty = parseFloat(li.quantity) || 0;
    const price = parseFloat(li.unitPrice) || 0;
    return sum + qty * price;
  }, 0);

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-center gap-4 animate-fade-in">
        <Button asChild variant="ghost" size="icon">
          <Link href="/invoices">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold tracking-tight">Create Invoice</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Generate a new compliant payment invoice
          </p>
        </div>
      </div>

      {/* Step Indicator */}
      <div className="flex items-center gap-3 animate-slide-in-up">
        <div
          className={cn(
            "flex items-center gap-2 rounded-full px-4 py-1.5 text-sm font-medium transition-all",
            step === "details"
              ? "bg-primary/15 text-primary"
              : "bg-emerald-500/15 text-emerald-400"
          )}
        >
          {step === "preview" ? (
            <CheckCircle2 className="h-4 w-4" />
          ) : (
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary text-[11px] font-bold text-white">
              1
            </span>
          )}
          Details
        </div>
        <div className="h-px w-8 bg-border" />
        <div
          className={cn(
            "flex items-center gap-2 rounded-full px-4 py-1.5 text-sm font-medium transition-all",
            step === "preview"
              ? "bg-primary/15 text-primary"
              : "text-muted-foreground"
          )}
        >
          <span
            className={cn(
              "flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-bold",
              step === "preview"
                ? "bg-primary text-white"
                : "bg-secondary text-muted-foreground"
            )}
          >
            2
          </span>
          Preview
        </div>
      </div>

      {step === "details" ? (
        <Card className="animate-slide-in-up">
          <CardHeader>
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-primary/15 p-2">
                <FileText className="h-5 w-5 text-primary" />
              </div>
              <div>
                <CardTitle>Invoice Details</CardTitle>
                <CardDescription>
                  All invoices are automatically compliance-checked before
                  sending
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-5">
              {/* Recipient */}
              <div className="space-y-2">
                <label htmlFor="inv-to" className="text-sm font-medium">
                  Recipient Address / DID
                </label>
                <Input
                  id="inv-to"
                  placeholder="0x... or did:web:..."
                  value={form.to}
                  onChange={(e) => updateField("to", e.target.value)}
                  required
                />
              </div>

              {/* Line Items */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-medium">Line Items</label>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="text-xs gap-1 text-primary"
                    onClick={addLineItem}
                  >
                    <Plus className="h-3 w-3" />
                    Add item
                  </Button>
                </div>
                <div className="space-y-2">
                  {/* Header */}
                  <div className="grid grid-cols-12 gap-2 px-1">
                    <span className="col-span-6 text-xs text-muted-foreground">
                      Description
                    </span>
                    <span className="col-span-2 text-xs text-muted-foreground">
                      Qty
                    </span>
                    <span className="col-span-3 text-xs text-muted-foreground">
                      Unit Price
                    </span>
                    <span className="col-span-1" />
                  </div>
                  {lineItems.map((li, idx) => (
                    <div
                      key={li.id}
                      className="grid grid-cols-12 gap-2 items-center"
                    >
                      <div className="col-span-6">
                        <Input
                          placeholder="e.g., API access - Pro plan"
                          value={li.description}
                          onChange={(e) =>
                            updateLineItem(li.id, "description", e.target.value)
                          }
                          required
                        />
                      </div>
                      <div className="col-span-2">
                        <Input
                          type="number"
                          min="1"
                          step="1"
                          placeholder="1"
                          value={li.quantity}
                          onChange={(e) =>
                            updateLineItem(li.id, "quantity", e.target.value)
                          }
                          required
                        />
                      </div>
                      <div className="col-span-3">
                        <Input
                          type="number"
                          min="0"
                          step="0.01"
                          placeholder="0.00"
                          value={li.unitPrice}
                          onChange={(e) =>
                            updateLineItem(li.id, "unitPrice", e.target.value)
                          }
                          required
                        />
                      </div>
                      <div className="col-span-1 flex justify-center">
                        <button
                          type="button"
                          onClick={() => removeLineItem(li.id)}
                          disabled={lineItems.length <= 1}
                          className="text-muted-foreground hover:text-red-400 disabled:opacity-30 disabled:cursor-not-allowed transition-colors p-1"
                          aria-label="Remove line item"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
                {/* Total */}
                <div className="flex items-center justify-end gap-3 pt-2 border-t border-border/30">
                  <span className="text-sm text-muted-foreground">Total:</span>
                  <span className="text-lg font-bold tabular-nums">
                    {totalAmount > 0 ? formatAmount(totalAmount) : "$0.00"}{" "}
                    <span className="text-sm font-normal text-muted-foreground">
                      {form.currency}
                    </span>
                  </span>
                </div>
              </div>

              {/* Currency */}
              <div className="space-y-2">
                <label htmlFor="inv-currency" className="text-sm font-medium">
                  Currency
                </label>
                <div className="flex flex-wrap gap-2">
                  {CURRENCIES.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => updateField("currency", c)}
                      className={cn(
                        "rounded-lg border px-4 py-2 text-sm transition-all",
                        form.currency === c
                          ? "border-primary bg-primary/15 text-primary"
                          : "border-border/50 bg-secondary/30 text-muted-foreground hover:border-border hover:text-foreground"
                      )}
                    >
                      {c}
                    </button>
                  ))}
                </div>
              </div>

              {/* Chain */}
              <div className="space-y-2">
                <label className="text-sm font-medium" id="chain-label">
                  Chain
                </label>
                <div
                  className="flex flex-wrap gap-2"
                  role="group"
                  aria-labelledby="chain-label"
                >
                  {CHAINS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      aria-pressed={form.chain === c}
                      onClick={() => updateField("chain", c)}
                      className={cn(
                        "rounded-lg border px-4 py-2 text-sm transition-all",
                        form.chain === c
                          ? "border-primary bg-primary/15 text-primary"
                          : "border-border/50 bg-secondary/30 text-muted-foreground hover:border-border hover:text-foreground"
                      )}
                    >
                      {c}
                    </button>
                  ))}
                </div>
              </div>

              {/* Payment Wallet */}
              <div className="space-y-2">
                <label htmlFor="inv-wallet" className="text-sm font-medium">
                  Payment Wallet Address
                </label>
                <Input
                  id="inv-wallet"
                  placeholder="0x..."
                  value={form.walletAddress}
                  onChange={(e) => updateField("walletAddress", e.target.value)}
                  required
                />
                <p className="text-xs text-muted-foreground">
                  The wallet address where you want to receive payment
                </p>
              </div>

              {/* Description */}
              <div className="space-y-2">
                <label htmlFor="inv-description" className="text-sm font-medium">
                  Notes (optional)
                </label>
                <textarea
                  id="inv-description"
                  placeholder="Additional notes or terms..."
                  value={form.description}
                  onChange={(e) => updateField("description", e.target.value)}
                  rows={2}
                  className="flex w-full rounded-md border border-input bg-background/50 px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 resize-none transition-colors"
                />
              </div>

              {/* Due Date */}
              <div className="space-y-2">
                <label htmlFor="inv-due-date" className="text-sm font-medium">
                  Due Date
                </label>
                <Input
                  id="inv-due-date"
                  type="date"
                  value={form.dueDate}
                  onChange={(e) => updateField("dueDate", e.target.value)}
                  required
                />
              </div>

              {/* Actions */}
              <div className="flex items-center gap-3 pt-4 border-t border-border/50">
                <Button type="submit" className="gap-2">
                  <Eye className="h-4 w-4" />
                  Preview Invoice
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => router.push("/invoices")}
                >
                  Cancel
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      ) : (
        /* ─── Preview Step ─────────────────────────────────────────────── */
        <div className="space-y-4 animate-slide-in-up">
          <Card className="relative overflow-hidden">
            <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-blue-500 to-teal-500" />
            <CardContent className="pt-8">
              {/* Header */}
              <div className="flex items-start justify-between mb-8">
                <div>
                  <h2 className="text-xl font-bold gradient-text mb-1">
                    ProofLink Invoice
                  </h2>
                  <p className="text-xs text-muted-foreground">
                    Invoice #{" "}
                    <span className="font-mono">
                      FL-{new Date().getFullYear()}-
                      {String(Math.floor(Math.random() * 9000) + 1000)}
                    </span>
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-xs text-muted-foreground">Due Date</p>
                  <p className="text-sm font-medium">
                    {form.dueDate || "Not set"}
                  </p>
                </div>
              </div>

              {/* Parties */}
              <div className="grid grid-cols-2 gap-6 mb-8">
                <div>
                  <p className="text-xs text-muted-foreground mb-1">From</p>
                  <p className="text-sm font-medium">ProofLink Dashboard</p>
                  <p className="text-xs text-muted-foreground font-mono mt-0.5">
                    {form.walletAddress
                      ? `${form.walletAddress.slice(0, 10)}...${form.walletAddress.slice(-6)}`
                      : "---"}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-1">To</p>
                  <p className="text-sm font-medium font-mono">
                    {form.to
                      ? `${form.to.slice(0, 10)}...${form.to.slice(-6)}`
                      : "---"}
                  </p>
                </div>
              </div>

              {/* Line Items Table */}
              <div className="border border-border/50 rounded-lg overflow-hidden mb-6">
                <div className="grid grid-cols-12 gap-2 bg-secondary/30 px-4 py-2.5 text-xs font-medium text-muted-foreground">
                  <span className="col-span-6">Description</span>
                  <span className="col-span-2 text-right">Qty</span>
                  <span className="col-span-2 text-right">Unit Price</span>
                  <span className="col-span-2 text-right">Amount</span>
                </div>
                {lineItems.map((li) => {
                  const qty = parseFloat(li.quantity) || 0;
                  const price = parseFloat(li.unitPrice) || 0;
                  return (
                    <div
                      key={li.id}
                      className="grid grid-cols-12 gap-2 px-4 py-3 border-t border-border/30 text-sm"
                    >
                      <span className="col-span-6">
                        {li.description || "---"}
                      </span>
                      <span className="col-span-2 text-right tabular-nums">
                        {qty}
                      </span>
                      <span className="col-span-2 text-right tabular-nums text-muted-foreground">
                        {formatAmount(price)}
                      </span>
                      <span className="col-span-2 text-right font-medium tabular-nums">
                        {formatAmount(qty * price)}
                      </span>
                    </div>
                  );
                })}
                <div className="grid grid-cols-12 gap-2 px-4 py-3 border-t border-border/50 bg-secondary/20">
                  <span className="col-span-10 text-right text-sm font-semibold">
                    Total
                  </span>
                  <span className="col-span-2 text-right text-lg font-bold tabular-nums">
                    {formatAmount(totalAmount)}
                  </span>
                </div>
              </div>

              {/* Chain + Currency */}
              <div className="flex items-center gap-6 mb-6 text-sm">
                <div>
                  <span className="text-muted-foreground">Chain: </span>
                  <span className="font-medium">{form.chain}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Currency: </span>
                  <span className="font-medium">{form.currency}</span>
                </div>
              </div>

              {form.description && (
                <div className="mb-6">
                  <p className="text-xs text-muted-foreground mb-1">Notes</p>
                  <p className="text-sm">{form.description}</p>
                </div>
              )}

              {/* Compliance notice */}
              <div className="rounded-lg bg-blue-500/10 border border-blue-500/20 p-3 flex items-start gap-2">
                <Shield className="h-4 w-4 text-blue-400 mt-0.5 shrink-0" />
                <p className="text-xs text-muted-foreground">
                  This invoice will be automatically compliance-checked via
                  ProofLink&apos;s x402 protocol before delivery. The recipient
                  address will be screened against OFAC sanctions lists and risk
                  scoring.
                </p>
              </div>
            </CardContent>
          </Card>

          {/* Actions */}
          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              className="gap-2"
              onClick={() => setStep("details")}
            >
              <ArrowLeft className="h-4 w-4" />
              Back to Edit
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={isSubmitting}
              className="gap-2"
            >
              {isSubmitting ? (
                <>
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                  Creating...
                </>
              ) : (
                <>
                  <Send className="h-4 w-4" />
                  Create &amp; Send Invoice
                </>
              )}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
