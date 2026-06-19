import { defineConfig } from "vitest/config";
import path from "node:path";

/**
 * Vitest configuration for E2E scenario tests.
 *
 * Mirrors the integration test config structure — resolves @prooflink/* workspace
 * packages to their TypeScript source so no build step is required before testing.
 *
 * All external services (Postgres, Chainalysis API, blockchain RPC) are mocked
 * at the test-file level. Tests run fully in-process via Hono's app.request().
 */
export default defineConfig({
  test: {
    name: "e2e",
    environment: "node",
    globals: false,
    // Each file is isolated: vi.mock() calls do not bleed between test files
    isolate: true,
    pool: "forks",
    poolOptions: {
      forks: {
        singleFork: false,
      },
    },
    // 15s per test to accommodate async compliance pipeline assertions
    testTimeout: 15_000,
    include: ["scenarios/**/*.test.ts"],
    exclude: ["**/node_modules/**"],
  },
  resolve: {
    alias: {
      "@prooflink/shared": path.resolve(__dirname, "../../packages/shared/src/index.ts"),
      "@prooflink/shared/types": path.resolve(__dirname, "../../packages/shared/src/types/index.ts"),
      "@prooflink/shared/constants": path.resolve(__dirname, "../../packages/shared/src/constants.ts"),
      "@prooflink/shared/errors": path.resolve(__dirname, "../../packages/shared/src/errors.ts"),
      "@prooflink/shared/utils": path.resolve(__dirname, "../../packages/shared/src/utils/index.ts"),
      "@prooflink/core": path.resolve(__dirname, "../../packages/core/src/index.ts"),
    },
  },
});
