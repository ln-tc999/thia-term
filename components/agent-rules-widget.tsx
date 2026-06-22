"use client"

import React, { useState, useEffect, useCallback } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import {
  Plus,
  Trash2,
  Pause,
  Play,
  Clock,
  GitBranch,
  Zap,
  Bot,
  Calendar,
} from "lucide-react"
import { toast } from "sonner"
import { ruleTypeLabel, ruleTypeColor, ruleDescription } from "@/lib/agent-engine"
import type { RuleType } from "@/lib/agent-engine"

interface AgentRule {
  id: string
  agentId: string
  type: RuleType
  config: Record<string, unknown>
  status: "active" | "paused"
  lastRun: string | null
  nextRun: string | null
  createdAt: string
}

interface Agent {
  id: string
  name: string
}

const typeIcon: Record<RuleType, React.ElementType> = {
  scheduled: Clock,
  conditional: GitBranch,
  multistep: Zap,
}

// ── Add Rule Modal ────────────────────────────────────────────────────────────

interface AddRuleModalProps {
  open: boolean
  agents: Agent[]
  onClose: () => void
  onCreated: () => void
}

function AddRuleModal({ open, agents, onClose, onCreated }: AddRuleModalProps) {
  const [agentId, setAgentId] = useState(agents[0]?.id ?? "")
  const [type, setType] = useState<RuleType>("scheduled")
  const [cron, setCron] = useState("0 9 * * 1")
  const [action, setAction] = useState("send_invoice_reminder")
  const [trigger, setTrigger] = useState("invoice_overdue")
  const [condition, setCondition] = useState("days_overdue > 7")
  const [stepCount, setStepCount] = useState("2")
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (open && agents.length > 0) setAgentId(agents[0].id)
  }, [open, agents])

  const buildConfig = () => {
    switch (type) {
      case "scheduled":
        return { cron, action, params: {} }
      case "conditional":
        return { trigger, condition, action, params: {} }
      case "multistep":
        return {
          steps: Array.from({ length: Number(stepCount) }, (_, i) => ({
            action: `step_${i + 1}`,
            params: {},
            delayHours: i * 24,
          })),
        }
    }
  }

  const handleCreate = async () => {
    if (!agentId) { toast.error("Select an agent"); return }
    setLoading(true)
    try {
      const res = await fetch("/api/agents/rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentId, type, config: buildConfig() }),
      })
      const data = await res.json()
      if (!data.success) { toast.error(data.error || "Failed to create rule"); return }
      toast.success("Rule created")
      onCreated()
      onClose()
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg bg-white">
        <DialogHeader>
          <DialogTitle>Add Agent Rule</DialogTitle>
          <DialogDescription>Configure an automation rule for one of your agents.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Agent */}
          <div className="space-y-1.5">
            <Label>Agent</Label>
            <Select value={agentId} onValueChange={setAgentId}>
              <SelectTrigger>
                <SelectValue placeholder="Select agent" />
              </SelectTrigger>
              <SelectContent>
                {agents.map((a) => (
                  <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Rule type */}
          <div className="space-y-1.5">
            <Label>Rule Type</Label>
            <Select value={type} onValueChange={(v) => setType(v as RuleType)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="scheduled">Scheduled — run on a cron schedule</SelectItem>
                <SelectItem value="conditional">Conditional — trigger on an event</SelectItem>
                <SelectItem value="multistep">Multi-step — sequential workflow</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Scheduled fields */}
          {type === "scheduled" && (
            <>
              <div className="space-y-1.5">
                <Label>Cron Expression</Label>
                <Input
                  value={cron}
                  onChange={(e) => setCron(e.target.value)}
                  placeholder="0 9 * * 1"
                  className="font-mono text-sm"
                />
                <p className="text-xs text-slate-400">e.g. <code>0 9 * * 1</code> = every Monday at 9am</p>
              </div>
              <div className="space-y-1.5">
                <Label>Action</Label>
                <Input value={action} onChange={(e) => setAction(e.target.value)} placeholder="send_invoice_reminder" />
              </div>
            </>
          )}

          {/* Conditional fields */}
          {type === "conditional" && (
            <>
              <div className="space-y-1.5">
                <Label>Trigger Event</Label>
                <Input value={trigger} onChange={(e) => setTrigger(e.target.value)} placeholder="invoice_overdue" />
              </div>
              <div className="space-y-1.5">
                <Label>Condition</Label>
                <Input value={condition} onChange={(e) => setCondition(e.target.value)} placeholder="days_overdue > 7" />
              </div>
              <div className="space-y-1.5">
                <Label>Action</Label>
                <Input value={action} onChange={(e) => setAction(e.target.value)} placeholder="send_reminder_email" />
              </div>
            </>
          )}

          {/* Multistep fields */}
          {type === "multistep" && (
            <div className="space-y-1.5">
              <Label>Number of Steps</Label>
              <Select value={stepCount} onValueChange={setStepCount}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["2", "3", "4", "5"].map((n) => (
                    <SelectItem key={n} value={n}>{n} steps</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            className="bg-sky-600 hover:bg-sky-700 text-white"
            onClick={handleCreate}
            disabled={loading}
          >
            {loading ? "Creating…" : "Create Rule"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ── Rules Widget ──────────────────────────────────────────────────────────────

interface AgentRulesWidgetProps {
  agents: Agent[]
}

export function AgentRulesWidget({ agents }: AgentRulesWidgetProps) {
  const [rules, setRules] = useState<AgentRule[]>([])
  const [selectedAgentId, setSelectedAgentId] = useState<string>("all")
  const [showAddRule, setShowAddRule] = useState(false)
  const [loading, setLoading] = useState(false)

  const fetchRules = useCallback(async () => {
    if (agents.length === 0) return
    setLoading(true)
    try {
      const results = await Promise.all(
        agents.map((a) =>
          fetch(`/api/agents/rules?agentId=${a.id}`)
            .then((r) => r.json())
            .then((d) => (d.success ? (d.data as AgentRule[]) : []))
        )
      )
      setRules(results.flat())
    } finally {
      setLoading(false)
    }
  }, [agents])

  useEffect(() => { fetchRules() }, [fetchRules])

  const agentName = (id: string) => agents.find((a) => a.id === id)?.name ?? "Unknown"

  const filteredRules = selectedAgentId === "all"
    ? rules
    : rules.filter((r) => r.agentId === selectedAgentId)

  const toggleStatus = async (rule: AgentRule) => {
    const newStatus = rule.status === "active" ? "paused" : "active"
    const res = await fetch("/api/agents/rules", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: rule.id, status: newStatus }),
    })
    const data = await res.json()
    if (data.success) {
      setRules((prev) => prev.map((r) => r.id === rule.id ? { ...r, status: newStatus } : r))
      toast.success(`Rule ${newStatus === "active" ? "resumed" : "paused"}`)
    }
  }

  const deleteRule = async (rule: AgentRule) => {
    const res = await fetch(`/api/agents/rules?id=${rule.id}`, { method: "DELETE" })
    const data = await res.json()
    if (data.success) {
      setRules((prev) => prev.filter((r) => r.id !== rule.id))
      toast.success("Rule deleted")
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        {/* Agent filter pills */}
        <div className="flex gap-1 bg-slate-100 rounded-lg p-1">
          <button
            onClick={() => setSelectedAgentId("all")}
            className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
              selectedAgentId === "all"
                ? "bg-white text-slate-900 shadow-sm"
                : "text-slate-500 hover:text-slate-700"
            }`}
          >
            All agents
          </button>
          {agents.map((a) => (
            <button
              key={a.id}
              onClick={() => setSelectedAgentId(a.id)}
              className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                selectedAgentId === a.id
                  ? "bg-white text-slate-900 shadow-sm"
                  : "text-slate-500 hover:text-slate-700"
              }`}
            >
              {a.name}
            </button>
          ))}
        </div>

        <Button
          variant="outline"
          className="border-sky-200 text-sky-700 hover:bg-sky-50 gap-1.5"
          onClick={() => setShowAddRule(true)}
          disabled={agents.length === 0}
        >
          <Plus className="h-4 w-4" />
          Add Rule
        </Button>
      </div>

      {agents.length === 0 ? (
        <Card className="bg-white border-slate-200">
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="w-14 h-14 rounded-full bg-slate-100 flex items-center justify-center mb-4">
              <Bot className="h-7 w-7 text-slate-400" />
            </div>
            <p className="text-slate-700 font-semibold">No agents registered</p>
            <p className="text-slate-400 text-sm mt-1">Register an agent first, then add rules to automate it</p>
          </div>
        </Card>
      ) : loading ? (
        <div className="flex justify-center py-12 text-slate-400 text-sm">Loading rules…</div>
      ) : filteredRules.length === 0 ? (
        <Card className="bg-white border-slate-200">
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="w-14 h-14 rounded-full bg-slate-100 flex items-center justify-center mb-4">
              <Zap className="h-7 w-7 text-slate-400" />
            </div>
            <p className="text-slate-700 font-semibold">No rules yet</p>
            <p className="text-slate-400 text-sm mt-1">Add a rule to automate your agent&apos;s behaviour</p>
            <Button
              className="mt-4 bg-sky-600 hover:bg-sky-700 text-white gap-1.5"
              onClick={() => setShowAddRule(true)}
            >
              <Plus className="h-4 w-4" />
              Add Rule
            </Button>
          </div>
        </Card>
      ) : (
        <div className="space-y-3">
          {filteredRules.map((rule) => {
            const Icon = typeIcon[rule.type]
            const mockDesc = ruleDescription({ ...rule, config: rule.config as unknown as Parameters<typeof ruleDescription>[0]["config"], lastRun: rule.lastRun ? new Date(rule.lastRun) : null, nextRun: rule.nextRun ? new Date(rule.nextRun) : null, createdAt: new Date(rule.createdAt), updatedAt: new Date(rule.createdAt) })
            return (
              <Card key={rule.id} className="bg-white border-slate-200 shadow-sm">
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3 min-w-0">
                      <div className="w-9 h-9 rounded-lg bg-slate-100 flex items-center justify-center shrink-0">
                        <Icon className="h-4 w-4 text-slate-600" />
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <Badge className={`text-xs border ${ruleTypeColor(rule.type)}`}>
                            {ruleTypeLabel(rule.type)}
                          </Badge>
                          <span className="text-xs text-slate-400">
                            {agentName(rule.agentId)}
                          </span>
                          <Badge className={`text-xs border ${rule.status === "active" ? "bg-sky-50 text-sky-700 border-sky-200" : "bg-slate-100 text-slate-500 border-slate-200"}`}>
                            {rule.status}
                          </Badge>
                        </div>
                        <p className="text-sm text-slate-700 mt-1 truncate">{mockDesc}</p>
                        <div className="flex items-center gap-4 mt-1.5 text-xs text-slate-400">
                          {rule.lastRun && (
                            <span className="flex items-center gap-1">
                              <Clock className="h-3 w-3" />
                              Last: {new Date(rule.lastRun).toLocaleDateString()}
                            </span>
                          )}
                          {rule.nextRun && (
                            <span className="flex items-center gap-1">
                              <Calendar className="h-3 w-3" />
                              Next: {new Date(rule.nextRun).toLocaleDateString()}
                            </span>
                          )}
                          {!rule.lastRun && !rule.nextRun && (
                            <span>Never run</span>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-1 shrink-0">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 px-2 text-slate-500 hover:text-slate-800"
                        onClick={() => toggleStatus(rule)}
                        title={rule.status === "active" ? "Pause rule" : "Resume rule"}
                      >
                        {rule.status === "active"
                          ? <Pause className="h-3.5 w-3.5" />
                          : <Play className="h-3.5 w-3.5" />
                        }
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 px-2 text-red-400 hover:text-red-600 hover:bg-red-50"
                        onClick={() => deleteRule(rule)}
                        title="Delete rule"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      <AddRuleModal
        open={showAddRule}
        agents={agents}
        onClose={() => setShowAddRule(false)}
        onCreated={fetchRules}
      />
    </div>
  )
}
