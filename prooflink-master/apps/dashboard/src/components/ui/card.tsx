"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { ArrowUpRight, ArrowDownRight, type LucideIcon } from "lucide-react";

interface StatCardProps {
  title: string;
  value: string;
  change?: number;
  icon: LucideIcon;
  iconColor?: string;
}

export function StatCard({
  title,
  value,
  change,
  icon: Icon,
  iconColor = "text-primary",
}: StatCardProps) {
  const isPositive = change !== undefined && change >= 0;

  return (
    <div className="glass-card rounded-xl p-6 hover:border-primary/30 transition-all duration-300 group">
      <div className="flex items-start justify-between">
        <div className="space-y-1">
          <p className="text-sm text-muted-foreground">{title}</p>
          <p className="text-2xl font-bold tracking-tight tabular-nums">
            {value}
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
          <span className="text-muted-foreground">vs last 30d</span>
        </div>
      )}
    </div>
  );
}

interface CardProps {
  children: ReactNode;
  className?: string;
}

export function Card({ children, className }: CardProps) {
  return (
    <div className={cn("glass-card rounded-xl p-6", className)}>{children}</div>
  );
}

export function CardHeader({ children, className }: CardProps) {
  return <div className={cn("mb-4", className)}>{children}</div>;
}

export function CardTitle({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <h3 className={cn("text-lg font-semibold", className)}>{children}</h3>
  );
}

export function CardDescription({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <p className={cn("text-sm text-muted-foreground", className)}>{children}</p>
  );
}

export function CardContent({ children, className }: CardProps) {
  return <div className={cn("", className)}>{children}</div>;
}

export function CardSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn("glass-card rounded-xl p-6", className)}>
      <div className="space-y-3">
        <div className="h-4 w-32 shimmer rounded" />
        <div className="h-8 w-48 shimmer rounded" />
        <div className="h-3 w-24 shimmer rounded" />
      </div>
    </div>
  );
}
