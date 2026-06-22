'use client'

import { motion, AnimatePresence } from "framer-motion"
import { Button } from "@/components/ui/button"
import { Loader2, AlertTriangle, Inbox } from "lucide-react"

type AsyncState = "loading" | "error" | "empty" | "data"

interface EmptyStateConfig {
  icon?: React.ReactNode
  heading: string
  description?: string
  action?: { label: string; onClick: () => void }
}

interface AsyncBoundaryProps {
  /** Manual async state override */
  state?: AsyncState
  /** Shorthand booleans */
  loading?: boolean
  error?: boolean
  empty?: boolean
  /** Custom empty state content */
  emptyState?: EmptyStateConfig
  /** Error message */
  errorMessage?: string
  /** Retry callback (shown on error) */
  onRetry?: () => void
  /** Number of skeleton items to show during loading */
  skeletonCount?: number
  /** Custom skeleton renderer. Defaults to a simple pulse block. */
  skeletonRenderer?: (i: number) => React.ReactNode
  /** Children rendered when state is "data" */
  children: React.ReactNode
}

function DefaultSkeleton({ i }: { i: number }) {
  return (
    <div
      className="rounded-2xl border border-white/[0.06] bg-white/[0.03] p-5 animate-pulse"
      style={{ animationDelay: `${i * 0.06}s` }}
    >
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <div className="h-4 w-32 bg-white/10 rounded" />
          <div className="h-4 w-16 bg-white/[0.06] rounded" />
        </div>
        <div className="h-3 w-64 bg-white/[0.06] rounded" />
        <div className="flex gap-4">
          <div className="h-3 w-16 bg-white/[0.06] rounded" />
          <div className="h-3 w-20 bg-white/[0.06] rounded" />
        </div>
      </div>
    </div>
  )
}

export function AsyncBoundary({
  state,
  loading,
  error,
  empty,
  emptyState,
  errorMessage,
  onRetry,
  skeletonCount = 3,
  skeletonRenderer,
  children,
}: AsyncBoundaryProps) {
  const resolvedState: AsyncState = state
    ?? (loading ? "loading" : error ? "error" : empty ? "empty" : "data")

  return (
    <AnimatePresence mode="wait">
      {resolvedState === "loading" && (
        <motion.div
          key="loading"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="space-y-3"
        >
          {Array.from({ length: skeletonCount }, (_, i) =>
            skeletonRenderer?.(i) ?? <DefaultSkeleton key={i} i={i} />,
          )}
        </motion.div>
      )}

      {resolvedState === "error" && (
        <motion.div
          key="error"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          className="rounded-2xl border border-red-500/30 bg-red-500/[0.05] p-6 text-center"
        >
          <AlertTriangle className="h-10 w-10 mx-auto mb-3 text-red-400" />
          <p className="font-semibold text-slate-200">{errorMessage ?? "Something went wrong"}</p>
          {onRetry && (
            <Button
              variant="outline"
              size="sm"
              onClick={onRetry}
              className="mt-3 bg-white/[0.04] border-white/10 text-slate-300 hover:bg-white/10 rounded-xl"
            >
              Try again
            </Button>
          )}
        </motion.div>
      )}

      {resolvedState === "empty" && emptyState && (
        <motion.div
          key="empty"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          className="text-center py-16 rounded-2xl border border-white/[0.06] bg-white/[0.02]"
        >
          {emptyState.icon ?? (
            <div className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4"
              style={{ background: "linear-gradient(135deg, #0a2e2e, #0f3d3d)" }}>
              <Inbox className="h-7 w-7 text-sky-400" />
            </div>
          )}
          <p className="font-semibold text-slate-300">{emptyState.heading}</p>
          {emptyState.description && (
            <p className="text-sm text-slate-600 mt-1 mb-4">{emptyState.description}</p>
          )}
          {emptyState.action && (
            <Button
              onClick={emptyState.action.onClick}
              className="bg-sky-600 hover:bg-sky-500 text-white rounded-xl"
            >
              {emptyState.action.label}
            </Button>
          )}
        </motion.div>
      )}

      {resolvedState === "data" && (
        <motion.div
          key="data"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  )
}
