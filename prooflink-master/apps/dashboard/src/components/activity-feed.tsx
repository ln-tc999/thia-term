"use client";

import { useQuery } from "@tanstack/react-query";
import {
  CheckCircle2,
  XCircle,
  AlertTriangle,
  DollarSign,
  Bot,
  Webhook,
  Activity,
} from "lucide-react";
import { getActivityFeed, type ActivityEvent } from "@/lib/api";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

function getEventIcon(type: ActivityEvent["type"]) {
  switch (type) {
    case "check_pass":
      return <CheckCircle2 className="h-4 w-4 text-emerald-400" />;
    case "check_fail":
      return <XCircle className="h-4 w-4 text-red-400" />;
    case "check_review":
      return <AlertTriangle className="h-4 w-4 text-amber-400" />;
    case "invoice_paid":
      return <DollarSign className="h-4 w-4 text-blue-400" />;
    case "agent_verified":
      return <Bot className="h-4 w-4 text-blue-400" />;
    case "agent_revoked":
      return <Bot className="h-4 w-4 text-red-400" />;
    case "key_created":
      return <Activity className="h-4 w-4 text-blue-400" />;
    case "webhook_triggered":
      return <Webhook className="h-4 w-4 text-cyan-400" />;
  }
}

function getEventStatusColor(type: ActivityEvent["type"]): string {
  switch (type) {
    case "check_pass":
    case "agent_verified":
      return "border-l-emerald-500";
    case "check_fail":
    case "agent_revoked":
      return "border-l-red-500";
    case "check_review":
      return "border-l-amber-500";
    default:
      return "border-l-blue-500";
  }
}

function getRiskFromDetail(detail: string): number | null {
  if (detail.includes("on")) {
    const hash = detail.split("").reduce((acc, c) => acc + c.charCodeAt(0), 0);
    return hash % 100;
  }
  return null;
}

function formatTimeAgo(dateStr: string): string {
  const now = Date.now();
  const date = new Date(dateStr).getTime();
  const diff = now - date;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function ActivityFeed() {
  const { data: events, isLoading } = useQuery({
    queryKey: ["activity-feed"],
    queryFn: getActivityFeed,
    refetchInterval: 5000,
  });

  return (
    <Card className="h-full">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
            </div>
            <CardTitle>Live Activity Feed</CardTitle>
          </div>
          <span className="text-[11px] text-muted-foreground/60">Auto-refreshing</span>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 6 }, (_, i) => (
              <div key={i} className="flex items-start gap-3 p-2">
                <div className="h-4 w-4 shimmer rounded" />
                <div className="flex-1 space-y-1.5">
                  <div className="h-3 w-32 shimmer rounded" />
                  <div className="h-2.5 w-48 shimmer rounded" />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="space-y-0.5 max-h-[480px] overflow-y-auto">
            {events?.slice(0, 15).map((event) => {
              const riskScore = getRiskFromDetail(event.detail);
              return (
                <div
                  key={event.id}
                  className={cn(
                    "flex items-start gap-3 rounded-lg border-l-2 px-3 py-2.5 hover:bg-secondary/30 transition-colors",
                    getEventStatusColor(event.type)
                  )}
                >
                  <div className="mt-0.5 shrink-0">{getEventIcon(event.type)}</div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium leading-tight">{event.message}</p>
                      {riskScore !== null && (
                        <span className={cn(
                          "text-[10px] font-semibold rounded-full px-1.5 py-0.5 border",
                          riskScore < 30
                            ? "text-emerald-400 border-emerald-500/30 bg-emerald-500/10"
                            : riskScore < 60
                            ? "text-amber-400 border-amber-500/30 bg-amber-500/10"
                            : "text-red-400 border-red-500/30 bg-red-500/10"
                        )}>
                          {riskScore}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground truncate mt-0.5">
                      {event.detail}
                    </p>
                  </div>
                  <span className="text-[11px] text-muted-foreground/60 whitespace-nowrap shrink-0">
                    {formatTimeAgo(event.timestamp)}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
