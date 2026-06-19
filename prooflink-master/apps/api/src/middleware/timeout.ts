import type { MiddlewareHandler } from "hono";

/**
 * Request timeout middleware.
 * Aborts the request with a 408 if it exceeds the given duration.
 */
export function timeout(ms: number = 30_000): MiddlewareHandler {
  return async (c, next) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ms);

    try {
      controller.signal.addEventListener("abort", () => {
        // no-op: handled below
      });

      const result = await Promise.race([
        next(),
        new Promise<"timeout">((resolve) => {
          controller.signal.addEventListener("abort", () => resolve("timeout"));
        }),
      ]);

      if (result === "timeout") {
        return c.json(
          { error: "REQUEST_TIMEOUT", message: "Request timed out" },
          408,
        );
      }
    } finally {
      clearTimeout(timer);
    }
  };
}
