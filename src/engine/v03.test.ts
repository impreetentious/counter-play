import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { effectiveSegment, multitaskReport, portfolioEfficiency, revenuePortfolio } from "./multitask";
import { respondCARA } from "./respond.cara";
import { respondDeterministic } from "./respond.det";
import { simulateDeterministic } from "./simulate";
import { lintScenario } from "./linter";
import { Rat, R0 } from "./rat";
import type { Plan, Scenario, SecondTask, Segment } from "./types";

// §12 V-03 multitasking goldens. Every value is the closed form derived
// by hand and reproduced here — never read back from the implementation (§9).
// a₁ = 100, k = 100, γ = 1, ρ = 0, Ū = 0, m = 1; plan B = 0, Q = 10, one tier r = 0.1.
const baseSegment: Segment = {
  id: "seg-1", label: "Core", count: 1, ability: Rat.from(100), costK: Rat.from(100), riskAversion: R0,
  noiseSD: R0, reservationCE: R0, quotaMult: Rat.one(), valueQuality: Rat.one(), movable: R0,
};

const plan: Plan = {
  id: "plan-1", label: "Flat", base: R0, quota: Rat.from(10),
  tiers: [{ from: R0, rate: Rat.from(1, 10) }], bonus: null, cap: null,
};

function task(ability: number, valuePerEffort: number, psi: Rat): SecondTask {
  return { ability: Rat.from(ability), valuePerEffort: Rat.from(valuePerEffort), costSubstitution: psi };
}

function withTask(secondTask: SecondTask): Segment {
  return { ...baseSegment, secondTask };
}

function reportFor(segment: Segment) {
  const response = respondDeterministic(plan, segment);
  const report = response.multitask;
  if (!report) throw new Error("expected a multitask report");
  return { response, report };
}

function scenarioWith(population: Segment[], plans: Plan[] = [plan]): Scenario {
  return {
    schemaVersion: 1,
    population,
    plans,
    settings: {
      mode: "deterministic", periodLabel: "quarter", currencyLabel: "$",
      discount: Rat.one(), seasonality: [Rat.one(), Rat.one()],
      mc: { seed: 1, N: 500, ranges: {} },
    },
    meta: { notes: "" },
  };
}

describe("V-03 M1 — absent second task is a no-op", () => {
  it("returns the segment itself from the effective-segment reduction", () => {
    expect(effectiveSegment(baseSegment)).toBe(baseSegment);
    expect(revenuePortfolio(baseSegment).efficiency.eq(Rat.from(10_000))).toBe(true);
  });

  it("leaves the response and its true value byte-identical to §3.3", () => {
    const response = respondDeterministic(plan, baseSegment);
    expect(response.multitask).toBeNull();
    expect(response.effort.eq(Rat.from(1, 10))).toBe(true);
    expect(response.output.eq(Rat.from(10))).toBe(true);
    const result = simulateDeterministic(scenarioWith([baseSegment]));
    expect(result.plans[0]?.kpis.trueValue.eq(Rat.from(10))).toBe(true);
  });
});

describe("V-03 M2 — independent tasks (ψ = 0)", () => {
  const segment = withTask(task(50, 25, R0));

  it("reproduces the pinned portfolio, allocation, and certainty equivalent", () => {
    const { response, report } = reportFor(segment);
    expect(report.efficiency.eq(Rat.from(12_500))).toBe(true);
    expect(report.interior).toBe(true);
    expect(response.output.eq(Rat.from(25, 2))).toBe(true);
    expect(report.effortTask1.eq(Rat.from(1, 10))).toBe(true);
    expect(report.effortTask2.eq(Rat.from(1, 20))).toBe(true);
    expect(response.payout.eq(Rat.from(5, 4))).toBe(true);
    expect(report.cost.eq(Rat.from(5, 8))).toBe(true);
    expect(response.ce.eq(Rat.from(5, 8))).toBe(true);
  });

  it("prices the distortion at exactly 4/85", () => {
    const { report } = reportFor(segment);
    expect(report.valueDelivered.eq(Rat.from(45, 4))).toBe(true);
    expect(report.valueCeilingSq.eq(Rat.from(2_125, 16))).toBe(true);
    expect(report.distortionIndex.eq(Rat.from(4, 85))).toBe(true);
  });

  it("raises measured revenue above the single-task response", () => {
    const single = respondDeterministic(plan, baseSegment);
    const both = respondDeterministic(plan, segment);
    expect(both.output.gt(single.output)).toBe(true);
  });
});

describe("V-03 M3 — substitutable effort (ψ = 1/4)", () => {
  const segment = withTask(task(50, 25, Rat.from(1, 4)));

  it("reproduces the pinned interior solution", () => {
    const { response, report } = reportFor(segment);
    expect(revenuePortfolio(segment).discriminant.eq(Rat.from(10_000))).toBe(true);
    expect(report.efficiency.eq(Rat.from(32_000, 3))).toBe(true);
    expect(response.output.eq(Rat.from(32, 3))).toBe(true);
    expect(report.effortTask1.eq(Rat.from(7, 75))).toBe(true);
    expect(report.effortTask2.eq(Rat.from(2, 75))).toBe(true);
    expect(response.payout.eq(Rat.from(16, 15))).toBe(true);
    expect(response.ce.eq(Rat.from(8, 15))).toBe(true);
  });
});

describe("V-03 M4 — total crowd-out at the interior boundary", () => {
  const segment = withTask(task(50, 25, Rat.from(1, 2)));

  it("collapses task 2 to zero effort where the two branches meet", () => {
    const { response, report } = reportFor(segment);
    expect(report.efficiency.eq(Rat.from(10_000))).toBe(true);
    expect(response.output.eq(Rat.from(10))).toBe(true);
    expect(report.effortTask1.eq(Rat.from(1, 10))).toBe(true);
    expect(report.effortTask2.eq(R0)).toBe(true);
  });

  it("agrees with the corner formula it borders", () => {
    const interior = portfolioEfficiency(Rat.from(100), Rat.from(50), Rat.from(1, 2));
    const corner = portfolioEfficiency(Rat.from(100), Rat.from(40), Rat.from(1, 2));
    expect(interior.efficiency.eq(Rat.from(10_000))).toBe(true);
    expect(corner.interior).toBe(false);
    expect(corner.efficiency.eq(Rat.from(10_000))).toBe(true);
  });
});

describe("V-03 M5 — the unmeasured task", () => {
  const segment = withTask(task(0, 40, R0));

  it("gets zero effort and leaves the measured response untouched", () => {
    const { response, report } = reportFor(segment);
    expect(response.effort.eq(Rat.from(1, 10))).toBe(true);
    expect(response.output.eq(Rat.from(10))).toBe(true);
    expect(report.effortTask2.eq(R0)).toBe(true);
    expect(report.valueDelivered.eq(Rat.from(10))).toBe(true);
  });

  it("still charges the plan 4/29 of the value it could have bought", () => {
    const { report } = reportFor(segment);
    expect(report.valueCeilingSq.eq(Rat.from(116))).toBe(true);
    expect(report.distortionIndex.eq(Rat.from(4, 29))).toBe(true);
  });
});

describe("V-03 structural invariants", () => {
  it("splits measured revenue exactly across the two tasks", () => {
    fc.assert(fc.property(
      fc.integer({ min: 0, max: 400 }),
      fc.integer({ min: 0, max: 90 }),
      (secondAbility, psiPercent) => {
        const segment = withTask(task(secondAbility, 30, Rat.from(psiPercent, 100)));
        const response = respondDeterministic(plan, segment);
        const report = response.multitask;
        if (!report) return false;
        return report.revenueTask1.add(report.revenueTask2).eq(response.output);
      },
    ), { numRuns: 60 });
  });

  it("keeps the distortion index inside [0, 1] (Cauchy–Schwarz)", () => {
    fc.assert(fc.property(
      fc.integer({ min: 0, max: 400 }),
      fc.integer({ min: 0, max: 400 }),
      fc.integer({ min: 0, max: 90 }),
      (secondAbility, valuePerEffort, psiPercent) => {
        const segment = withTask(task(secondAbility, valuePerEffort, Rat.from(psiPercent, 100)));
        const report = respondDeterministic(plan, segment).multitask;
        if (!report) return false;
        return report.distortionIndex.gte(R0) && report.distortionIndex.lte(Rat.one());
      },
    ), { numRuns: 80 });
  });

  it("blends the report over a softmax mixture without leaving the invariant", () => {
    const segment = withTask(task(50, 25, R0));
    const response = respondDeterministic(plan, segment, { mode: "softmax", tau: Rat.one() });
    expect(response.components.length).toBeGreaterThan(1);
    const report = response.multitask;
    expect(report?.distortionIndex.gte(R0)).toBe(true);
    expect(report?.distortionIndex.lte(Rat.one())).toBe(true);
    expect(report?.revenueTask1.add(report.revenueTask2).eq(response.output)).toBe(true);
  });
});

describe("V-03 stochastic path and linter", () => {
  it("reduces the CARA response to the same effective segment", () => {
    const segment = { ...withTask(task(50, 25, R0)), noiseSD: Rat.from(5) };
    const equivalent = { ...effectiveSegment(segment), secondTask: null };
    const withTasks = respondCARA(plan, segment);
    const reduced = respondCARA(plan, equivalent);
    expect(withTasks.effort).toBeCloseTo(reduced.effort, 12);
    expect(withTasks.payout).toBeCloseTo(reduced.payout, 12);
    expect(withTasks.multitask?.effortTask2).toBeCloseTo(0.05, 12);
  });

  it("fires L-5's single-plan branch on a distortion at γ = 1", () => {
    const segment = withTask(task(50, 25, R0));
    const findings = lintScenario(scenarioWith([segment]));
    const wedge = findings.filter((finding) => finding.type === "L-5");
    expect(wedge).toHaveLength(1);
    expect(wedge[0]?.severity).toBe("info");
    expect(wedge[0]?.segments).toEqual(["seg-1"]);
    expect(wedge[0]?.evidence.gamma_neq_one_segments).toEqual([]);
    expect(wedge[0]?.evidence.max_distortion_pct).toBe("5%");
  });

  it("stays silent on a population with no second task", () => {
    expect(lintScenario(scenarioWith([baseSegment])).filter((finding) => finding.type === "L-5")).toHaveLength(0);
  });
});
