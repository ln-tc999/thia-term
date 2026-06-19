// Agent Rules Engine — evaluate and schedule agent rules

import { Cron } from "croner"

export type RuleType = "scheduled" | "conditional" | "multistep"
export type RuleStatus = "active" | "paused"

export interface ScheduledConfig {
  cron: string        // e.g. "0 9 * * 1" = every Monday 9am
  action: string      // e.g. "send_invoice"
  params: Record<string, unknown>
}

export interface ConditionalConfig {
  trigger: string     // e.g. "invoice_overdue"
  condition: string   // e.g. "days_overdue > 7"
  action: string
  params: Record<string, unknown>
}

export interface MultistepConfig {
  steps: Array<{
    action: string
    params: Record<string, unknown>
    delayHours?: number
  }>
}

export type RuleConfig = ScheduledConfig | ConditionalConfig | MultistepConfig

export interface AgentRule {
  id: string
  agentId: string
  type: RuleType
  config: RuleConfig
  status: RuleStatus
  lastRun: Date | null
  nextRun: Date | null
  createdAt: Date
  updatedAt: Date
}

export function computeNextRun(cronExpr: string, from: Date = new Date()): Date | null {
  try {
    const job = new Cron(cronExpr, { startAt: from })
    return job.nextRun(from) ?? null
  } catch {
    // Invalid cron expression — fall back to 1 hour from now
    const fallback = new Date(from)
    fallback.setHours(fallback.getHours() + 1, 0, 0, 0)
    return fallback
  }
}

export function ruleTypeLabel(type: RuleType): string {
  switch (type) {
    case "scheduled":   return "Scheduled"
    case "conditional": return "Conditional"
    case "multistep":   return "Multi-step"
  }
}

export function ruleTypeColor(type: RuleType): string {
  switch (type) {
    case "scheduled":   return "bg-blue-50 text-blue-700 border-blue-200"
    case "conditional": return "bg-amber-50 text-amber-700 border-amber-200"
    case "multistep":   return "bg-purple-50 text-purple-700 border-purple-200"
  }
}

export function ruleDescription(rule: AgentRule): string {
  switch (rule.type) {
    case "scheduled": {
      const cfg = rule.config as ScheduledConfig
      return `Run "${cfg.action}" on schedule: ${cfg.cron}`
    }
    case "conditional": {
      const cfg = rule.config as ConditionalConfig
      return `When ${cfg.trigger}: ${cfg.condition} → ${cfg.action}`
    }
    case "multistep": {
      const cfg = rule.config as MultistepConfig
      return `${cfg.steps.length}-step workflow`
    }
    default:
      return "Rule"
  }
}
