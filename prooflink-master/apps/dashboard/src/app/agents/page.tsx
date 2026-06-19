"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import {
  Bot,
  Plus,
  Shield,
  Clock,
  Activity,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Loader2,
  Star,
  Cpu,
  Users,
  Eye,
} from "lucide-react";
import { getAgents } from "@/lib/api";
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { formatDate, formatCompactNumber, cn } from "@/lib/utils";
import Link from "next/link";

// Agent type classification
type AgentType = "autonomous" | "semi-autonomous" | "human-supervised";

function getAgentType(did: string): AgentType {
  // Deterministic mapping based on agent DID
  if (did.includes("agent1") || did.includes("agent2")) return "autonomous";
  if (did.includes("agent3") || did.includes("agent5")) return "semi-autonomous";
  return "human-supervised";
}

function getReputationScore(checksPerformed: number, status: string): number {
  if (status === "REVOKED") return 25;
  if (status === "EXPIRED") return 55;
  if (status === "PENDING") return 0;
  // VERIFIED agents: score based on checks performed
  return Math.min(99, 60 + Math.floor(checksPerformed / 50));
}

function AgentTypeBadge({ type }: { type: AgentType }) {
  const config = {
    autonomous: { label: "Autonomous", icon: Cpu, bg: "bg-blue-500/15", text: "text-blue-400", border: "border-blue-500/30" },
    "semi-autonomous": { label: "Semi-Autonomous", icon: Activity, bg: "bg-blue-500/15", text: "text-blue-400", border: "border-blue-500/30" },
    "human-supervised": { label: "Human-Supervised", icon: Eye, bg: "bg-amber-500/15", text: "text-amber-400", border: "border-amber-500/30" },
  };
  const c = config[type];
  const Icon = c.icon;
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium", c.bg, c.text, c.border)}>
      <Icon className="h-3 w-3" />
      {c.label}
    </span>
  );
}

function ReputationIndicator({ score }: { score: number }) {
  const color = score >= 80 ? "text-emerald-400" : score >= 50 ? "text-amber-400" : score > 0 ? "text-red-400" : "text-zinc-500";
  const bg = score >= 80 ? "bg-emerald-500" : score >= 50 ? "bg-amber-500" : score > 0 ? "bg-red-500" : "bg-zinc-500";
  const stars = score >= 80 ? 5 : score >= 60 ? 4 : score >= 40 ? 3 : score >= 20 ? 2 : score > 0 ? 1 : 0;

  return (
    <div className="flex items-center gap-2">
      <div className="flex items-center gap-0.5">
        {Array.from({ length: 5 }, (_, i) => (
          <Star
            key={i}
            className={cn("h-3 w-3", i < stars ? color : "text-zinc-700")}
            fill={i < stars ? "currentColor" : "none"}
          />
        ))}
      </div>
      <div className="flex items-center gap-1.5">
        <div className="h-1.5 w-12 rounded-full bg-secondary overflow-hidden">
          <div
            className={cn("h-full rounded-full transition-all", bg)}
            style={{ width: `${score}%` }}
          />
        </div>
        <span className={cn("text-xs font-medium tabular-nums", color)}>
          {score > 0 ? score : "--"}
        </span>
      </div>
    </div>
  );
}

const statusIcons = {
  VERIFIED: CheckCircle2,
  EXPIRED: Clock,
  REVOKED: XCircle,
  PENDING: AlertTriangle,
};

export default function AgentsPage() {
  const { data: agents, isLoading, isError } = useQuery({
    queryKey: ["agents"],
    queryFn: getAgents,
  });

  const [isIssuing, setIsIssuing] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [newAgent, setNewAgent] = useState({ name: "", provider: "", did: "", type: "autonomous" as AgentType });

  const handleIssue = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsIssuing(true);
    try {
      await new Promise((r) => setTimeout(r, 1500));
      setDialogOpen(false);
      setNewAgent({ name: "", provider: "", did: "", type: "autonomous" });
    } finally {
      setIsIssuing(false);
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="h-8 w-48 shimmer rounded" />
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="glass-card rounded-lg p-4 space-y-2">
              <div className="h-3 w-16 shimmer rounded" />
              <div className="h-7 w-12 shimmer rounded" />
            </div>
          ))}
        </div>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }, (_, i) => (
            <div key={i} className="glass-card rounded-xl p-6 space-y-4">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 shimmer rounded-lg" />
                <div className="space-y-1.5">
                  <div className="h-4 w-24 shimmer rounded" />
                  <div className="h-3 w-16 shimmer rounded" />
                </div>
              </div>
              <div className="space-y-2">
                <div className="h-3 w-full shimmer rounded" />
                <div className="h-3 w-3/4 shimmer rounded" />
                <div className="h-3 w-2/3 shimmer rounded" />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="glass-card rounded-xl p-6 text-sm text-destructive">
        Failed to load agents. Please try again.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between animate-fade-in">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Agent Management</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Manage AI agent KYA credentials and permissions
          </p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button className="gap-2">
              <Plus className="h-4 w-4" />
              Add Agent
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Register New Agent</DialogTitle>
              <DialogDescription>
                Add a new AI agent and issue a KYA credential
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={handleIssue} className="space-y-4 mt-4">
              <div className="space-y-2">
                <label htmlFor="agent-name" className="text-sm font-medium">Agent Name</label>
                <Input
                  id="agent-name"
                  placeholder="e.g., PayBot Prime"
                  value={newAgent.name}
                  onChange={(e) =>
                    setNewAgent((p) => ({ ...p, name: e.target.value }))
                  }
                  required
                />
              </div>
              <div className="space-y-2">
                <label htmlFor="agent-did" className="text-sm font-medium">Agent DID</label>
                <Input
                  id="agent-did"
                  placeholder="did:web:agent.example.com"
                  value={newAgent.did}
                  onChange={(e) =>
                    setNewAgent((p) => ({ ...p, did: e.target.value }))
                  }
                  required
                />
              </div>
              <div className="space-y-2">
                <label htmlFor="agent-provider" className="text-sm font-medium">Provider</label>
                <Input
                  id="agent-provider"
                  placeholder="e.g., ProofLink"
                  value={newAgent.provider}
                  onChange={(e) =>
                    setNewAgent((p) => ({ ...p, provider: e.target.value }))
                  }
                  required
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Agent Type</label>
                <div className="flex flex-wrap gap-2">
                  {(["autonomous", "semi-autonomous", "human-supervised"] as AgentType[]).map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setNewAgent((p) => ({ ...p, type: t }))}
                      className={cn(
                        "rounded-lg border px-3 py-2 text-xs capitalize transition-all",
                        newAgent.type === t
                          ? "border-primary bg-primary/15 text-primary"
                          : "border-border/50 bg-secondary/30 text-muted-foreground hover:border-border hover:text-foreground"
                      )}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex gap-3 pt-2">
                <Button type="submit" disabled={isIssuing} className="gap-2">
                  {isIssuing ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Registering...
                    </>
                  ) : (
                    <>
                      <Shield className="h-4 w-4" />
                      Register Agent
                    </>
                  )}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setDialogOpen(false)}
                >
                  Cancel
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {[
          { label: "Total Agents", value: agents?.length ?? 0, icon: Bot, color: "text-foreground" },
          { label: "Verified", value: agents?.filter((a) => a.status === "VERIFIED").length ?? 0, icon: CheckCircle2, color: "text-emerald-400" },
          { label: "Pending", value: agents?.filter((a) => a.status === "PENDING").length ?? 0, icon: AlertTriangle, color: "text-amber-400" },
          { label: "Total Checks", value: agents?.reduce((acc, a) => acc + a.checksPerformed, 0) ?? 0, icon: Activity, color: "text-primary" },
        ].map((s) => (
          <div key={s.label} className="glass-card rounded-lg p-4">
            <div className="flex items-center gap-2 mb-1">
              <s.icon className={cn("h-4 w-4", s.color)} />
              <p className="text-xs text-muted-foreground">{s.label}</p>
            </div>
            <p className={cn("text-2xl font-bold", s.color)}>
              {formatCompactNumber(s.value)}
            </p>
          </div>
        ))}
      </div>

      {/* Agent Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {agents?.map((agent) => {
          const agentType = getAgentType(agent.did);
          const reputation = getReputationScore(agent.checksPerformed, agent.status);
          return (
            <Link
              key={agent.did}
              href={`/agents/${encodeURIComponent(agent.did)}`}
              className="block"
            >
            <Card
              className={cn(
                "relative overflow-hidden transition-all hover:border-primary/30 cursor-pointer",
                agent.status === "VERIFIED" && "border-emerald-500/15",
                agent.status === "REVOKED" && "border-red-500/15",
                agent.status === "EXPIRED" && "border-zinc-500/15",
                agent.status === "PENDING" && "border-amber-500/15"
              )}
            >
              <CardContent className="pt-6">
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br from-blue-500/20 to-teal-500/20 border border-border/50">
                      <Bot className="h-5 w-5 text-primary" />
                    </div>
                    <div>
                      <h3 className="font-semibold">{agent.name}</h3>
                      <p className="text-xs text-muted-foreground">
                        {agent.provider}
                      </p>
                    </div>
                  </div>
                  <StatusBadge status={agent.status} />
                </div>

                {/* Agent Type Badge */}
                <div className="mb-3">
                  <AgentTypeBadge type={agentType} />
                </div>

                {/* Reputation Score */}
                <div className="mb-3 rounded-lg border border-border/30 bg-secondary/10 p-2.5">
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">Reputation Score</p>
                  <ReputationIndicator score={reputation} />
                </div>

                <div className="space-y-2.5 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">DID</span>
                    <code className="text-xs font-mono bg-secondary/50 px-1.5 py-0.5 rounded max-w-[180px] truncate">
                      {agent.did}
                    </code>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Checks</span>
                    <span className="text-xs font-medium">
                      {formatCompactNumber(agent.checksPerformed)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Issued</span>
                    <span className="text-xs">
                      {formatDate(agent.issuedAt)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Expires</span>
                    <span className="text-xs">
                      {formatDate(agent.expiresAt)}
                    </span>
                  </div>
                </div>

                {agent.status === "VERIFIED" && (
                  <div className="mt-4 flex gap-2">
                    <Button variant="outline" size="sm" className="flex-1 text-xs">
                      Renew
                    </Button>
                    <Button variant="outline" size="sm" className="flex-1 text-xs text-red-400 hover:text-red-300">
                      Revoke
                    </Button>
                  </div>
                )}
                {agent.status === "EXPIRED" && (
                  <div className="mt-4">
                    <Button variant="default" size="sm" className="w-full text-xs gap-1.5">
                      <Shield className="h-3 w-3" />
                      Reissue Credential
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
