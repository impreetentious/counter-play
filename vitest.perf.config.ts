import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const sourceRoot = fileURLToPath(new URL("./src", import.meta.url));

export default defineConfig({
  resolve: {
    alias: { "@": sourceRoot },
  },
  test: {
    include: ["scripts/perf-budgets.test.ts"],
    testTimeout: 60_000,
  },
});
