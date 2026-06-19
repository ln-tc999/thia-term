"use client";

import { useState, useCallback } from "react";
import {
  Search,
  Shield,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Clock,
  Loader2,
  Zap,
  Copy,
} from "lucide-react";
import { screenAddress, type ScreeningResult } from "@/lib/api";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  CardDescription,
} from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatDate, cn } from "@/lib/utils";

const CHAINS = ["Ethereum", "Polygon", "Base", "Arbitrum", "Solana"];

const EXAMPLE_ADDRESSES = [
  { label: "Vitalik.eth", address: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045" },
  { label: "Uniswap Router", address: "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D" },
  { label: "Circle USDC", address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48" },
];

function RiskGauge({ score }: { score: number }) {
  const r = 60;
  const stroke = 12;
  const cx = 80;
  const cy = 80;
  const circumference = Math.PI * r;
  const filled = (score / 100) * circumference;

  const strokeColor =
    score < 25
      ? "#34d399"
      : score < 50
      ? "#60a5fa"
      : score < 75
      ? "#fbbf24"
      : "#f87171";

  const textColor =
    score < 25
      ? "text-emerald-400"
      : score < 50
      ? "text-blue-400"
      : score < 75
      ? "text-amber-400"
      : "text-red-400";

  return (
    <div
      className="flex flex-col items-center"
      role="img"
      aria-label={`Risk score: ${score} out of 100`}
    >
      <div className="relative">
        <svg
          width="160"
          height="90"
          viewBox="0 0 160 90"
          fill="none"
          aria-hidden="true"
        >
          <path
            d={`M ${cx - r},${cy} A ${r},${r} 0 0,1 ${cx + r},${cy}`}
            stroke="hsl(215,25%,15%)"
            strokeWidth={stroke}
            strokeLinecap="round"
            fill="none"
          />
          <path
            d={`M ${cx - r},${cy} A ${r},${r} 0 0,1 ${cx + r},${cy}`}
            stroke={strokeColor}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={`${filled} ${circumference}`}
            fill="none"
            className="transition-all duration-700 ease-out"
          />
        </svg>
        <div className="absolute inset-x-0 bottom-0 flex flex-col items-center">
          <span
            className={cn("text-3xl font-bold leading-none tabular-nums", textColor)}
          >
            {score}
          </span>
          <span className="text-xs text-muted-foreground">/ 100</span>
        </div>
      </div>
    </div>
  );
}

interface ScreeningResultWithMeta extends ScreeningResult {
  responseTime: number;
}

function ScreeningResultCard({ result }: { result: ScreeningResultWithMeta }) {
  const [copied, setCopied] = useState(false);
  const riskColor = {
    LOW: "border-emerald-500/30",
    MEDIUM: "border-blue-500/30",
    HIGH: "border-amber-500/30",
    CRITICAL: "border-red-500/30",
  }[result.riskLevel];

  const handleCopy = () => {
    navigator.clipboard.writeText(result.address).catch(() => undefined);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Card
      className={cn(
        "relative overflow-hidden animate-slide-in-up",
        riskColor
      )}
    >
      <div
        className={cn(
          "absolute top-0 left-0 right-0 h-1",
          result.riskLevel === "LOW" && "bg-emerald-500",
          result.riskLevel === "MEDIUM" && "bg-blue-500",
          result.riskLevel === "HIGH" && "bg-amber-500",
          result.riskLevel === "CRITICAL" && "bg-red-500"
        )}
      />
      <CardContent className="pt-6">
        <div className="grid gap-6 md:grid-cols-2">
          <div className="space-y-4">
            {/* Address with copy */}
            <div>
              <p className="text-xs text-muted-foreground mb-1">Address</p>
              <div className="flex items-center gap-2">
                <code className="text-xs font-mono bg-secondary/50 px-2 py-1 rounded break-all flex-1">
                  {result.address}
                </code>
                <button
                  onClick={handleCopy}
                  className={cn(
                    "shrink-0 transition-colors",
                    copied
                      ? "text-emerald-400"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                  aria-label="Copy address"
                >
                  <Copy className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>

            {/* Key metrics row */}
            <div className="flex flex-wrap gap-4">
              <div>
                <p className="text-xs text-muted-foreground mb-1">Chain</p>
                <p className="text-sm font-medium">{result.chain}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1">Risk Level</p>
                <StatusBadge status={result.riskLevel} />
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1">Sanctioned</p>
                <div className="flex items-center gap-1.5">
                  {result.sanctioned ? (
                    <>
                      <XCircle className="h-4 w-4 text-red-400" />
                      <span className="text-sm text-red-400 font-semibold">
                        Yes
                      </span>
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                      <span className="text-sm text-emerald-400 font-semibold">
                        No
                      </span>
                    </>
                  )}
                </div>
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1">Response</p>
                <div className="flex items-center gap-1">
                  <Zap className="h-3 w-3 text-amber-400" />
                  <span className="text-sm font-medium tabular-nums">
                    {result.responseTime}ms
                  </span>
                </div>
              </div>
            </div>

            {/* Flags */}
            {result.flags.length > 0 && (
              <div>
                <p className="text-xs text-muted-foreground mb-2">Flags</p>
                <div className="space-y-1.5">
                  {result.flags.map((flag) => (
                    <div
                      key={flag}
                      className="flex items-center gap-2 text-sm text-amber-400"
                    >
                      <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                      {flag}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* No flags = clean */}
            {result.flags.length === 0 && (
              <div className="flex items-center gap-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20 px-3 py-2">
                <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                <span className="text-sm text-emerald-400 font-medium">
                  No risk flags detected
                </span>
              </div>
            )}
          </div>

          {/* Gauge */}
          <div className="flex flex-col items-center justify-center">
            <RiskGauge score={result.riskScore} />
            <p className="text-xs text-muted-foreground mt-4">
              Screened at {formatDate(result.screenedAt)}
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function ScreenPage() {
  const [address, setAddress] = useState("");
  const [chain, setChain] = useState("Ethereum");
  const [isScreening, setIsScreening] = useState(false);
  const [results, setResults] = useState<ScreeningResultWithMeta[]>([]);

  const handleScreen = useCallback(
    async (e?: React.FormEvent, overrideAddress?: string) => {
      e?.preventDefault();
      const addr = overrideAddress ?? address.trim();
      if (!addr) return;

      setIsScreening(true);
      const start = performance.now();
      try {
        const result = await screenAddress(addr, chain);
        const elapsed = Math.round(performance.now() - start);
        setResults((prev) => [{ ...result, responseTime: elapsed }, ...prev]);
        setAddress("");
      } finally {
        setIsScreening(false);
      }
    },
    [address, chain]
  );

  return (
    <div className="space-y-6">
      <div className="animate-fade-in">
        <h1 className="text-2xl font-bold tracking-tight">
          Address Screening
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Screen wallet addresses for compliance risks in real-time
        </p>
      </div>

      {/* Screening Form */}
      <Card className="glow-blue animate-slide-in-up">
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-primary/15 p-2">
              <Shield className="h-5 w-5 text-primary" />
            </div>
            <div>
              <CardTitle>Screen Address</CardTitle>
              <CardDescription>
                Check any wallet against OFAC sanctions, risk scoring, and
                behavioral analysis
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <form onSubmit={handleScreen} className="flex gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Enter wallet address (0x...)"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                className="pl-9 h-11"
                required
              />
            </div>
            <select
              value={chain}
              onChange={(e) => setChain(e.target.value)}
              className="flex h-11 rounded-md border border-input bg-background/50 px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 w-[140px]"
            >
              {CHAINS.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <Button
              type="submit"
              disabled={isScreening}
              className="gap-2 min-w-[130px] h-11"
            >
              {isScreening ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Screening...
                </>
              ) : (
                <>
                  <Shield className="h-4 w-4" />
                  Screen
                </>
              )}
            </Button>
          </form>

          {/* Example addresses */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground">Try:</span>
            {EXAMPLE_ADDRESSES.map((ex) => (
              <button
                key={ex.address}
                type="button"
                onClick={() => {
                  setAddress(ex.address);
                }}
                className="rounded-full border border-border/50 bg-secondary/30 px-3 py-1 text-xs text-muted-foreground hover:text-foreground hover:border-primary/40 transition-all"
              >
                {ex.label}
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Results */}
      {results.length > 0 && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <Clock className="h-4 w-4 text-muted-foreground" />
              Screening History
              <span className="text-sm font-normal text-muted-foreground">
                ({results.length})
              </span>
            </h2>
            <Button
              variant="ghost"
              size="sm"
              className="text-xs text-muted-foreground"
              onClick={() => setResults([])}
            >
              Clear all
            </Button>
          </div>
          <div className="space-y-4">
            {results.map((result, i) => (
              <ScreeningResultCard
                key={`${result.address}-${result.screenedAt}-${i}`}
                result={result}
              />
            ))}
          </div>
        </div>
      )}

      {/* Empty State */}
      {results.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-center animate-fade-in">
          <div className="rounded-full bg-secondary/50 p-6 mb-4">
            <Search className="h-8 w-8 text-muted-foreground/50" />
          </div>
          <h3 className="text-lg font-medium mb-1">No screenings yet</h3>
          <p className="text-sm text-muted-foreground max-w-md">
            Enter a wallet address above to screen it for compliance risks.
            Results include OFAC sanctions checks, risk scoring, and behavioral
            analysis.
          </p>
        </div>
      )}
    </div>
  );
}
