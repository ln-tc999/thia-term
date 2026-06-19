import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex min-h-[60vh] w-full items-center justify-center p-6">
      <div className="flex max-w-md flex-col items-center gap-6 text-center">
        {/* 404 display */}
        <div className="relative">
          <span className="text-8xl font-bold text-gradient select-none">
            404
          </span>
        </div>

        {/* Copy */}
        <div className="space-y-2">
          <h1 className="text-xl font-semibold text-foreground">
            Page not found
          </h1>
          <p className="text-sm text-muted-foreground">
            The page you are looking for does not exist or has been moved.
          </p>
        </div>

        {/* Action */}
        <Link
          href="/"
          className="rounded-lg bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Back to Dashboard
        </Link>
      </div>
    </div>
  );
}
