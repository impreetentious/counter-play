import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const sourceRoot = fileURLToPath(new URL("./src", import.meta.url));

// Unit scope: engine and state only. Browser behaviour belongs to the Playwright suite.
export default defineConfig({
  resolve: {
    alias: { "@": sourceRoot },
  },
  test: {
    include: ["src/**/*.test.ts"],
    coverage: {
      reporter: ["text", "html"],
    },
  },
});
