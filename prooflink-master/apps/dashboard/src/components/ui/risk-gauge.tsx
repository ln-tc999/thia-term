"use client";

import { cn } from "@/lib/utils";

interface RiskGaugeProps {
  score: number;
  threshold?: number;
  size?: "sm" | "md" | "lg";
  className?: string;
}

function getScoreColor(score: number): string {
  if (score <= 30) return "text-emerald-400";
  if (score <= 60) return "text-amber-400";
  if (score <= 80) return "text-orange-400";
  return "text-red-400";
}

function getBarColor(score: number): string {
  if (score <= 30) return "bg-emerald-400";
  if (score <= 60) return "bg-amber-400";
  if (score <= 80) return "bg-orange-400";
  return "bg-red-400";
}

function getTrackGradient(score: number): string {
  if (score <= 30) return "from-emerald-500/20 to-emerald-500/5";
  if (score <= 60) return "from-amber-500/20 to-amber-500/5";
  if (score <= 80) return "from-orange-500/20 to-orange-500/5";
  return "from-red-500/20 to-red-500/5";
}

function getRiskLabel(score: number): string {
  if (score <= 30) return "Low";
  if (score <= 60) return "Medium";
  if (score <= 80) return "High";
  return "Critical";
}

const sizeConfig = {
  sm: { height: "h-1.5", text: "text-xs", label: "text-[10px]" },
  md: { height: "h-2", text: "text-sm", label: "text-xs" },
  lg: { height: "h-3", text: "text-lg", label: "text-sm" },
} as const;

export function RiskGauge({ score, threshold, size = "md", className }: RiskGaugeProps) {
  const clamped = Math.max(0, Math.min(100, score));
  const config = sizeConfig[size];

  return (
    <div className={cn("w-full space-y-1.5", className)}>
      <div className="flex items-baseline justify-between">
        <span className={cn("font-bold tabular-nums", config.text, getScoreColor(clamped))}>
          {Math.round(clamped)}
        </span>
        <span className={cn("font-medium text-muted-foreground", config.label)}>
          {getRiskLabel(clamped)}
        </span>
      </div>

      <div className="relative">
        {/* Track */}
        <div
          className={cn(
            "w-full rounded-full bg-gradient-to-r",
            config.height,
            getTrackGradient(clamped)
          )}
        />

        {/* Fill */}
        <div
          className={cn(
            "absolute inset-y-0 left-0 rounded-full transition-all duration-500",
            config.height,
            getBarColor(clamped)
          )}
          style={{ width: `${clamped}%` }}
        />

        {/* Threshold marker */}
        {threshold !== undefined && threshold >= 0 && threshold <= 100 && (
          <div
            className="absolute top-1/2 -translate-y-1/2 w-0.5 h-[200%] bg-foreground/60 rounded-full"
            style={{ left: `${threshold}%` }}
            title={`Threshold: ${threshold}`}
          />
        )}
      </div>

      {/* Scale labels */}
      <div className="flex justify-between text-[10px] text-muted-foreground/50">
        <span>0</span>
        <span>30</span>
        <span>60</span>
        <span>80</span>
        <span>100</span>
      </div>
    </div>
  );
}
