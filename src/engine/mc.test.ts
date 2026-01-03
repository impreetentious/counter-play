import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { computeTornado, hasActiveRanges, lowerQuantile, runMonteCarlo } from "./mc";
import { parseScenario } from "@/state/schema";
import { templateT1 } from "@/state/templates";
import type { ScenarioJson } from "@/state/schema";

const baseTemplate = templateT1 as ScenarioJson;

function scenarioWithRanges(overrides: Partial<ScenarioJson["settings"]["mc"]["ranges"]>, seed = 42, N = 120): ScenarioJson {
  return {
    ...baseTemplate,
    settings: {
      ...baseTemplate.settings,
      mc: { seed, N, ranges: { ...baseTemplate.settings.mc.ranges, ...overrides } },
    },
  };
}

describe("mc — Monte Carlo replay (O-G)", () => {
  it("deep-equals two runs at the same seed, N, and ranges", () => {
    const wire = scenarioWithRanges({
      demand: ["0.9", "1.1"],
      perSegment: { "seg-1": { a: ["0.95", "1.05"] } },
    }, 42, 120);
    const scenario = parseScenario(wire);
    const first = runMonteCarlo(scenario);
    const second = runMonteCarlo(scenario);
    expect(second).toEqual(first);
  });

  it("consumes one float per (segment, param, draw) — order matters", () => {
    const orderedWire = scenarioWithRanges({
      perSegment: {
        "seg-1": { a: ["0.9", "1.1"] },
        "seg-2": { a: ["0.9", "1.1"] },
      },
    }, 7, 120);
    const reversedWire: ScenarioJson = {
      ...orderedWire,
      population: [...orderedWire.population].reverse(),
    };
    const ordered = runMonteCarlo(parseScenario(orderedWire));
    const reversed = runMonteCarlo(parseScenario(reversedWire));
    expect(ordered.plans[0]?.draws[0]?.expectedRevenue).not.toBe(reversed.plans[0]?.draws[0]?.expectedRevenue);
  });

  it("common random numbers apply the same draw to every plan", () => {
    const wire: ScenarioJson = {
      ...scenarioWithRanges({ demand: ["0.8", "1.2"] }, 11, 120),
      plans: [
        baseTemplate.plans[0]!,
        { id: "plan-2", label: "Rich flat", base: "80000", quota: "900000", tiers: [{ from: "0", rate: "0.09" }], bonus: null, cap: null },
      ],
    };
    const result = runMonteCarlo(parseScenario(wire));
    const first = result.plans[0]?.draws ?? [];
    const second = result.plans[1]?.draws ?? [];
    expect(first.length).toBe(second.length);
    // With CRN, a monotone plan transformation implies expected revenue rankings track exactly across draws.
    for (let i = 1; i < first.length; i += 1) {
      const a = first[i]!.expectedRevenue;
      const b = second[i]!.expectedRevenue;
      const aPrev = first[i - 1]!.expectedRevenue;
      const bPrev = second[i - 1]!.expectedRevenue;
      expect(Math.sign(a - aPrev)).toBe(Math.sign(b - bPrev));
    }
  });
});

describe("mc — tornado", () => {
  it("orders bars in the canonical §3.11 order", () => {
    const wire = scenarioWithRanges({
      demand: ["0.85", "1.15"],
      perSegment: {
        "seg-1": { a: ["0.9", "1.1"], k: ["0.9", "1.1"] },
        "seg-2": { gamma: ["0.95", "1.05"] },
      },
    });
    const tornado = computeTornado(parseScenario(wire), "totalComp");
    expect(tornado.bars.map((bar) => bar.id)).toEqual([
      "demand",
      "seg-1.a",
      "seg-1.k",
      "seg-2.gamma",
    ]);
  });

  it("computes low and high endpoints against the base scenario", () => {
    const wire = scenarioWithRanges({ demand: ["0.5", "1.5"] });
    const scenario = parseScenario(wire);
    const tornado = computeTornado(scenario, "expectedRevenue");
    const bar = tornado.bars[0]!;
    const perPlan = bar.perPlan[0]!;
    expect(perPlan.low).toBeLessThan(perPlan.base!);
    expect(perPlan.high).toBeGreaterThan(perPlan.base!);
  });
});

describe("mc — quantiles", () => {
  it("computes type-1 lower quantiles", () => {
    // §3.11 empirical band-quantile: index ⌈p·N⌉ − 1.
    // With sorted [1..10] and p=0.5 → index 4 (0-based) → value 5.
    expect(lowerQuantile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.5)).toBe(5);
    expect(lowerQuantile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.1)).toBe(1);
    expect(lowerQuantile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.9)).toBe(9);
  });

  it("reports quantiles for every KPI on every plan", () => {
    const wire = scenarioWithRanges({ demand: ["0.8", "1.2"] }, 3, 120);
    const result = runMonteCarlo(parseScenario(wire));
    for (const plan of result.plans) {
      for (const key of ["expectedRevenue", "totalComp", "quotaAttainRate", "trueValue"] as const) {
        expect(plan.quantiles[key]).not.toBeNull();
        expect(plan.quantiles[key]!.p10).toBeLessThanOrEqual(plan.quantiles[key]!.p50);
        expect(plan.quantiles[key]!.p50).toBeLessThanOrEqual(plan.quantiles[key]!.p90);
      }
    }
  });
});

describe("mc — property: seeded reproducibility", () => {
  it("two runs at the same seed produce identical draws", () => {
    fc.assert(fc.property(fc.integer({ min: 0, max: 0xffffffff }), (seed) => {
      const wire = scenarioWithRanges({ demand: ["0.9", "1.1"] }, seed, 100);
      const scenario = parseScenario(wire);
      const a = runMonteCarlo(scenario);
      const b = runMonteCarlo(scenario);
      expect(b.plans[0]?.draws).toEqual(a.plans[0]?.draws);
    }), { numRuns: 4 });
  });
});

describe("mc — helpers", () => {
  it("hasActiveRanges is false when no ranges present", () => {
    expect(hasActiveRanges(parseScenario(baseTemplate))).toBe(false);
  });

  it("hasActiveRanges is true when any parameter has a range", () => {
    const wire = scenarioWithRanges({ perSegment: { "seg-1": { k: ["0.9", "1.1"] } } });
    expect(hasActiveRanges(parseScenario(wire))).toBe(true);
  });
});
