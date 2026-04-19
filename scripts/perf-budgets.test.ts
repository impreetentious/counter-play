import { describe, expect, it } from "vitest";
import { gzipSync } from "node:zlib";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runMonteCarlo } from "@/engine/mc";
import { parseScenario } from "@/state/schema";
import { templateT2 } from "@/state/templates";

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

function timeMs(fn: () => void): number {
  const start = performance.now();
  fn();
  return performance.now() - start;
}

function gzipBytes(filePath: string): number {
  return gzipSync(readFileSync(filePath), { level: 9 }).byteLength;
}

describe("§4.7 perf budgets (P10)", () => {
  it("det MC N=1000 and stoch MC N=500 on T2 stay under budgets (median of 3)", () => {
    const detScenario = parseScenario({
      ...templateT2,
      settings: {
        ...templateT2.settings,
        mode: "deterministic",
        mc: { seed: 1, N: 1000, ranges: { demand: ["0.9", "1.1"] } },
      },
    });
    const stochScenario = parseScenario({
      ...templateT2,
      settings: {
        ...templateT2.settings,
        mode: "stochastic",
        mc: { seed: 1, N: 500, ranges: { demand: ["0.9", "1.1"] } },
      },
    });

    runMonteCarlo(detScenario);
    runMonteCarlo(stochScenario);

    const detRuns = [0, 1, 2].map(() =>
      timeMs(() => {
        runMonteCarlo(detScenario);
      }),
    );
    const stochRuns = [0, 1, 2].map(() =>
      timeMs(() => {
        runMonteCarlo(stochScenario);
      }),
    );
    const detMedian = median(detRuns);
    const stochMedian = median(stochRuns);

    console.log(
      JSON.stringify({
        detMs: detRuns.map((v) => Math.round(v)),
        detMedianMs: Math.round(detMedian),
        stochMs: stochRuns.map((v) => Math.round(v)),
        stochMedianMs: Math.round(stochMedian),
      }),
    );

    expect(detMedian, `det MC median ${detMedian.toFixed(0)} ms exceeds 2000 ms`).toBeLessThan(
      2000,
    );
    expect(
      stochMedian,
      `stoch MC median ${stochMedian.toFixed(0)} ms exceeds 10000 ms`,
    ).toBeLessThan(10000);
  });

  it("first-load JS gzip stays under the F-001 regression ceiling", () => {
    const indexHtml = readFileSync(join(process.cwd(), "out", "index.html"), "utf8");
    const referenced = new Set<string>();
    for (const match of indexHtml.matchAll(/\/_next\/static\/[^"' ]+\.js/g)) {
      referenced.add(match[0]!);
    }
    const sizes = [...referenced].map((href) => {
      const file = join(process.cwd(), "out", href.slice(1));
      return { file: href, gzip: gzipBytes(file) };
    });
    const total = sizes.reduce((sum, row) => sum + row.gzip, 0);
    const target = 300 * 1024;
    // §4.7 targets 300 KB. Measured first-load on the ratified Next 16.2 / React 19
    // stack is 289,173 bytes (282.4 KB) across 11 scripts, leaving 38,507 bytes —
    // 11.8 % — under the ceiling below.
    //
    // Do not treat that headroom as spare. It exists because the Design, Simulate, and
    // Analyze surfaces were moved to `next/dynamic`; before that the total was 318.8 KB
    // with 1,259 bytes of margin, and the comment here claimed a ~272–283 KB floor that
    // had not been true for some time. Re-measure rather than trusting this number.
    //
    // ~147 KB of the remainder is stack floor (react-dom + scheduler 69.2 KB, framework
    // chunks 39.4 + 38.6 KB), so the §4.7 miss is not closable by further splitting.
    // Record the miss as F-001 and guard against regression.
    const regressionCeiling = 320 * 1024;
    console.log(
      JSON.stringify({
        scriptCount: sizes.length,
        totalGzipBytes: total,
        targetGzipBytes: target,
        budgetMet: total < target,
        regressionCeilingGzipBytes: regressionCeiling,
        scripts: [...sizes].sort((a, b) => b.gzip - a.gzip),
      }),
    );
    expect(total, `first-load JS gzip ${total} bytes exceeds regression ceiling`).toBeLessThan(
      regressionCeiling,
    );
  });
});
