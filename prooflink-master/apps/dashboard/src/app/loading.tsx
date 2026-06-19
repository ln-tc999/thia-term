export default function Loading() {
  return (
    <div className="flex min-h-[60vh] w-full items-center justify-center">
      <div className="flex flex-col items-center gap-6">
        {/* Brand mark */}
        <div className="relative flex items-center justify-center">
          <div className="h-12 w-12 animate-spin rounded-full border-2 border-muted border-t-primary" />
          <span className="absolute text-xs font-bold text-gradient select-none">
            FL
          </span>
        </div>

        {/* Skeleton content preview */}
        <div className="w-full max-w-md space-y-4">
          <SkeletonBar className="h-6 w-3/4" />
          <SkeletonBar className="h-4 w-full" />
          <SkeletonBar className="h-4 w-5/6" />
          <div className="grid grid-cols-3 gap-3 pt-2">
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
          </div>
        </div>
      </div>
    </div>
  );
}

function SkeletonBar({ className = "" }: { className?: string }) {
  return (
    <div
      className={`animate-pulse rounded-md bg-muted ${className}`}
      aria-hidden
    />
  );
}

function SkeletonCard() {
  return (
    <div className="animate-pulse space-y-2 rounded-lg bg-muted p-4" aria-hidden>
      <div className="h-3 w-2/3 rounded bg-muted-foreground/10" />
      <div className="h-5 w-1/2 rounded bg-muted-foreground/10" />
    </div>
  );
}
