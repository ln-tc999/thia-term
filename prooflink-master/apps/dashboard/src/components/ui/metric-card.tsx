"use client";

import { cn } from "@/lib/utils";
import { ArrowUpRight, ArrowDownRight } from "lucide-react";

interface MetricCardProps {
  title: string;
  value: string;
  change?: number;
  changeType?: "positive" | "negative";
  className?: string;
}

export function MetricCard({
  title,
  value,
  change,
  changeType,
  className,
}: MetricCardProps) {
  const resolvedType = changeType ?? (change !== undefined && change >= 0 ? "positive" : "negative");
  const isPositive = resolvedType === "positive";

  return (
    <div
      className={cn(
        "glass-card rounded-xl p-6 hover:border-primary/30 transition-all duration-300",
        className
      )}
    >
      <p className="text-sm text-muted-foreground">{title}</p>
      <p className="mt-1 text-3xl font-bold tracking-tight tabular-nums">{value}</p>

      {change !== undefined && (
        <div className="mt-3 flex items-center gap-1 text-xs">
          {isPositive ? (
            <ArrowUpRight className="h-3.5 w-3.5 text-emerald-400" />
          ) : (
            <ArrowDownRight className="h-3.5 w-3.5 text-red-400" />
          )}
          <span className={isPositive ? "text-emerald-400" : "text-red-400"}>
            {Math.abs(change)}%
          </span>
          <span className="text-muted-foreground">vs last period</span>
        </div>
      )}
    </div>
  );
}
