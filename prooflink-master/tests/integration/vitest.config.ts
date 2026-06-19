import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "../..");

/**
 * Vitest configuration for integration tests.
 *
 * Resolves @prooflink/* workspace packages to their TypeScript source so tests
 * can exercise real internal logic without requiring a prior build step.
 *
 * External services (Chainalysis API, blockchain RPC, PostgreSQL) are mocked
 * at the test level — only the source resolution happens here.
 */
export default defineConfig({
  test: {
    name: "integration",
    environment: "node",
    globals: false,
    // Each test file is isolated to prevent module-level side-effects leaking
    isolate: true,
    // Run files in parallel but keep individual test order deterministic
    pool: "forks",
    poolOptions: {
      forks: {
        singleFork: false,
      },
    },
    // Timeout per test: 10s for async pipelines
    testTimeout: 10_000,
    include: ["**/*.test.ts"],
    exclude: ["**/node_modules/**"],
  },
  resolve: {
    alias: [
      // Map workspace packages to their TypeScript source directories.
      // Sub-path exports (e.g. @prooflink/core/webhooks/manager.js) must be
      // listed before the root entry so the more specific match wins.
      {
        find: /^@prooflink\/core\/webhooks\/manager\.js$/,
        replacement: path.join(root, "packages/core/src/webhooks/manager.ts"),
      },
      {
        find: /^@prooflink\/core\/webhooks\/events\.js$/,
        replacement: path.join(root, "packages/core/src/webhooks/events.ts"),
      },
      {
        find: /^@prooflink\/core\/webhooks\/types\.js$/,
        replacement: path.join(root, "packages/core/src/webhooks/types.ts"),
      },
      {
        find: "@prooflink/shared/types",
        replacement: path.join(root, "packages/shared/src/types/index.ts"),
      },
      {
        find: "@prooflink/shared/constants",
        replacement: path.join(root, "packages/shared/src/constants.ts"),
      },
      {
        find: "@prooflink/shared/errors",
        replacement: path.join(root, "packages/shared/src/errors.ts"),
      },
      {
        find: "@prooflink/shared/utils",
        replacement: path.join(root, "packages/shared/src/utils/index.ts"),
      },
      {
        find: "@prooflink/shared",
        replacement: path.join(root, "packages/shared/src/index.ts"),
      },
      {
        find: "@prooflink/core",
        replacement: path.join(root, "packages/core/src/index.ts"),
      },
      {
        find: "@prooflink/x402-compliance",
        replacement: path.join(root, "packages/x402-compliance/src/index.ts"),
      },
    ],
  },
});
