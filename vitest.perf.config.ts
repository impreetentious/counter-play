import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const sourceRoot = fileURLToPath(new URL("./src", import.meta.url));

// Performance budgets run in their own project so a slow machine cannot fail the unit suite.
export default defineConfig({
  resolve: {
    alias: { "@": sourceRoot },
  },
  test: {
    include: ["scripts/perf-budgets.test.ts"],
    testTimeout: 60_000,
  },
});
