"use client";

import { cn, formatDate } from "@/lib/utils";
import { CheckCircle2, XCircle, AlertTriangle, Clock } from "lucide-react";

type TimelineStatus = "pass" | "fail" | "review" | "pending";

interface TimelineEvent {
  title: string;
  description?: string;
  timestamp: string;
  status: TimelineStatus;
}

interface TimelineProps {
  events: TimelineEvent[];
  className?: string;
}

const statusConfig: Record<TimelineStatus, {
  icon: typeof CheckCircle2;
  dot: string;
  line: string;
  text: string;
}> = {
  pass: {
    icon: CheckCircle2,
    dot: "bg-emerald-500 ring-emerald-500/30",
    line: "bg-emerald-500/30",
    text: "text-emerald-400",
  },
  fail: {
    icon: XCircle,
    dot: "bg-red-500 ring-red-500/30",
    line: "bg-red-500/30",
    text: "text-red-400",
  },
  review: {
    icon: AlertTriangle,
    dot: "bg-amber-500 ring-amber-500/30",
    line: "bg-amber-500/30",
    text: "text-amber-400",
  },
  pending: {
    icon: Clock,
    dot: "bg-zinc-500 ring-zinc-500/30",
    line: "bg-zinc-500/30",
    text: "text-zinc-400",
  },
};

export function Timeline({ events, className }: TimelineProps) {
  return (
    <div className={cn("relative space-y-0", className)}>
      {events.map((event, index) => {
        const config = statusConfig[event.status];
        const Icon = config.icon;
        const isLast = index === events.length - 1;

        return (
          <div key={`${event.timestamp}-${index}`} className="relative flex gap-4 pb-6 last:pb-0">
            {/* Connector line */}
            {!isLast && (
              <div
                className={cn(
                  "absolute left-[11px] top-7 w-0.5 h-[calc(100%-16px)]",
                  config.line
                )}
              />
            )}

            {/* Dot / Icon */}
            <div className="relative z-10 flex shrink-0 items-center justify-center">
              <div
                className={cn(
                  "flex h-6 w-6 items-center justify-center rounded-full ring-4",
                  config.dot
                )}
              >
                <Icon className="h-3.5 w-3.5 text-white" />
              </div>
            </div>

            {/* Content */}
            <div className="flex-1 min-w-0 pt-0.5">
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm font-medium leading-tight">{event.title}</p>
                <time className="shrink-0 text-[11px] text-muted-foreground/60 tabular-nums">
                  {formatDate(event.timestamp)}
                </time>
              </div>
              {event.description && (
                <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
                  {event.description}
                </p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export type { TimelineEvent, TimelineStatus };
