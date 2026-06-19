"use client";

export function StatCardSkeleton() {
  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900 p-6 animate-pulse">
      <div className="flex items-start justify-between">
        <div className="space-y-3">
          <div className="h-3 w-20 rounded bg-gray-800" />
          <div className="h-7 w-28 rounded bg-gray-800" />
        </div>
        <div className="h-10 w-10 rounded-lg bg-gray-800" />
      </div>
      <div className="mt-4 h-3 w-24 rounded bg-gray-800" />
    </div>
  );
}

export function TableSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900 p-6 animate-pulse space-y-4">
      {/* Header row */}
      <div className="flex gap-4">
        <div className="h-3 w-16 rounded bg-gray-800" />
        <div className="h-3 w-24 rounded bg-gray-800" />
        <div className="h-3 w-20 rounded bg-gray-800" />
        <div className="h-3 w-16 rounded bg-gray-800" />
      </div>
      {/* Data rows */}
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex gap-4">
          <div className="h-4 w-20 rounded bg-gray-800" />
          <div className="h-4 w-32 rounded bg-gray-800" />
          <div className="h-4 w-16 rounded bg-gray-800" />
          <div className="h-4 w-14 rounded bg-gray-800" />
        </div>
      ))}
    </div>
  );
}

export function ChartSkeleton() {
  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900 p-6 animate-pulse">
      <div className="mb-4 h-4 w-32 rounded bg-gray-800" />
      <div className="h-[320px] rounded-lg bg-gray-800" />
    </div>
  );
}
