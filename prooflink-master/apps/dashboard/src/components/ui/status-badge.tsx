"use client";

import { cn } from "@/lib/utils";

type Status = "approved" | "rejected" | "escalated" | "pending";

interface StatusBadgeProps {
  status: Status;
  className?: string;
}

const statusConfig: Record<Status, { dot: string; bg: string; label: string }> = {
  approved: {
    dot: "bg-emerald-400",
    bg: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
    label: "Approved",
  },
  rejected: {
    dot: "bg-red-400",
    bg: "bg-red-500/15 text-red-400 border-red-500/30",
    label: "Rejected",
  },
  escalated: {
    dot: "bg-amber-400",
    bg: "bg-amber-500/15 text-amber-400 border-amber-500/30",
    label: "Escalated",
  },
  pending: {
    dot: "bg-zinc-400",
    bg: "bg-zinc-500/15 text-zinc-400 border-zinc-500/30",
    label: "Pending",
  },
};

export function StatusBadge({ status, className }: StatusBadgeProps) {
  const config = statusConfig[status];

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold tracking-wide",
        config.bg,
        className
      )}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full", config.dot)} aria-hidden="true" />
      {config.label}
    </span>
  );
}
