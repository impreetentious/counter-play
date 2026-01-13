import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function engineFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? engineFiles(path) : [path];
  });
}

describe("engine import boundary", () => {
  it("does not import UI, state, validation, or browser layers", () => {
    const root = join(process.cwd(), "src", "engine");
    for (const file of engineFiles(root).filter(
      (path) => path.endsWith(".ts") && !path.endsWith(".test.ts"),
    )) {
      const source = readFileSync(file, "utf8");
      expect(source).not.toMatch(/from\s+["'](?:react|next|zustand|zod|@\/state|\.\.\/state)/);
      expect(source).not.toMatch(/\b(?:window|document|localStorage|Math\.random|Date\.now)\b/);
    }
  });
});
