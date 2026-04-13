import { describe, expect, it } from "vitest";
import { Rat, R0 } from "./rat";
import { availableAxes, sweepGrid, sweepPlan, type SweepAxis } from "./sweep";
import type { Plan, Scenario, Segment } from "./types";

const d = (value: string): Rat => Rat.fromDecimalString(value);

/** O-C's segment and plan: a = 100, k = 100, flat r = 0.10, bonus threshold at q̂ = 16. */
const segment: Segment = {
  id: "seg-1",
  label: "Solo",
  count: 1,
  ability: d("100"),
  costK: d("100"),
  riskAversion: R0,
  noiseSD: R0,
  reservationCE: R0,
  quotaMult: d("1"),
  valueQuality: d("1"),
  movable: R0,
};

function planWith(overrides: Partial<Plan>): Plan {
  return {
    id: "plan-1",
    label: "Sweep subject",
    base: R0,
    quota: d("10"),
    tiers: [{ from: R0, rate: d("0.1") }],
    bonus: null,
    cap: null,
    ...overrides,
  };
}

function scenarioWith(plan: Plan): Scenario {
  return {
    schemaVersion: 1,
    population: [segment],
    plans: [plan],
    settings: {
      mode: "deterministic",
      periodLabel: "year",
      currencyLabel: "$",
      discount: d("1"),
      seasonality: [d("1"), d("1")],
      mc: { seed: 1, N: 500, ranges: {} },
    },
    meta: { notes: "" },
  };
}

describe("plan-space sweep", () => {
  /**
   * O-C's own arithmetic, read as a function of the bonus rather than of the rep: moving from
   * the tier optimum (q = 10, f = 0.5) to the threshold (q = 16) gains 0.6 of commission plus
   * L and costs 0.78 of effort, so the two plays are exactly indifferent at L = 0.18. The
   * sweep must land on that value exactly, not on the grid point nearest to it.
   */
  it("locates the bonus cliff at its exact indifference value", () => {
    const plan = planWith({ bonus: { L: R0, x_b: d("1.6") } });
    const axis: SweepAxis = { kind: "bonusAmount", lo: R0, hi: d("0.4"), steps: 8 };
    const result = sweepPlan(scenarioWith(plan), "plan-1", axis);

    expect(result.crossings).toHaveLength(1);
    const crossing = result.crossings[0]!;
    expect(crossing.at?.toDecimalString()).toBe("0.18");
    expect(crossing.fromBranch).toBe("tier 1 interior");
    expect(crossing.toBranch).toBe("bonus threshold");
    expect(crossing.fromOutput.toDecimalString()).toBe("10");
    expect(crossing.toOutput.toDecimalString()).toBe("16");
  });

  it("holds the tie-break at the crossing: L = 0.18 still plays the lower effort", () => {
    const plan = planWith({ bonus: { L: d("0.18"), x_b: d("1.6") } });
    const axis: SweepAxis = { kind: "bonusAmount", lo: d("0.18"), hi: d("0.22"), steps: 4 };
    const result = sweepPlan(scenarioWith(plan), "plan-1", axis);
    const first = result.points[0]!;
    const last = result.points.at(-1)!;
    expect(first.plays[0]!.output.toDecimalString()).toBe("10");
    expect(last.plays[0]!.output.toDecimalString()).toBe("16");
  });

  /**
   * A cap release is continuous — the optimum walks up with the cap and then stops moving when
   * the tier FOC takes over. There is no second peak anywhere, so the sweep must draw no
   * discontinuity even though the play's *label* changes from "cap" to "tier 1 interior".
   */
  it("does not mark a discontinuity where the optimum only drifts", () => {
    const plan = planWith({});
    const axis: SweepAxis = { kind: "cap", lo: d("0.5"), hi: d("2"), steps: 6 };
    const result = sweepPlan(scenarioWith(plan), "plan-1", axis);

    expect(result.crossings).toEqual([]);
    expect(result.points[0]!.plays[0]!.output.toDecimalString()).toBe("5");
    expect(result.points.at(-1)!.plays[0]!.output.toDecimalString()).toBe("10");
  });

  /**
   * Swept against the tier rate, the same plan has two peaks between r = 0.06 (where reaching
   * the bonus first pays: 50r² = 16r − 0.78) and r = 0.16 (where the tier optimum reaches the
   * threshold on its own). Only the first is a jump; the second is the optimum leaving the
   * threshold continuously, and must not be marked.
   */
  it("marks the rate at which the bonus starts being worth reaching, and only that", () => {
    const plan = planWith({ bonus: { L: d("0.5"), x_b: d("1.6") } });
    const axis: SweepAxis = { kind: "tierRate", tierIndex: 0, lo: R0, hi: d("0.3"), steps: 30 };
    const result = sweepPlan(scenarioWith(plan), "plan-1", axis);

    expect(result.crossings).toHaveLength(1);
    expect(result.crossings[0]!.at?.toDecimalString()).toBe("0.06");
    expect(result.crossings[0]!.toBranch).toBe("bonus threshold");
  });

  it("reports the principal's objective alongside the §3.5 KPIs", () => {
    const plan = planWith({});
    const axis: SweepAxis = {
      kind: "tierRate",
      tierIndex: 0,
      lo: d("0.1"),
      hi: d("0.2"),
      steps: 4,
    };
    const result = sweepPlan(scenarioWith(plan), "plan-1", axis);
    const first = result.points[0]!.kpis!;
    // r = 0.1 ⇒ q = 10, W = 1, γ = 1 ⇒ profit = 10 − 1 = 9.
    expect(first.trueValue!.toDecimalString()).toBe("10");
    expect(first.totalComp!.toDecimalString()).toBe("1");
    expect(first.profit!.toDecimalString()).toBe("9");
  });

  it("reports infeasible grid points with their reason instead of dropping them", () => {
    const plan = planWith({
      tiers: [
        { from: R0, rate: d("0.1") },
        { from: d("1"), rate: d("0.2") },
      ],
    });
    const axis: SweepAxis = { kind: "cap", lo: d("0.5"), hi: d("1.5"), steps: 4 };
    const result = sweepPlan(scenarioWith(plan), "plan-1", axis);
    const blocked = result.points.filter((point) => point.infeasible !== null);
    expect(blocked.length).toBe(2);
    expect(blocked[0]!.infeasible).toContain("last tier");
    expect(blocked[0]!.kpis).toBeNull();
  });

  it("offers only the axes the plan can express", () => {
    const withoutBonus = availableAxes(planWith({})).map((axis) => axis.kind);
    expect(withoutBonus).not.toContain("bonusAmount");
    const withBonus = availableAxes(planWith({ bonus: { L: d("1"), x_b: d("1") } })).map(
      (axis) => axis.kind,
    );
    expect(withBonus).toContain("bonusAmount");
    expect(withBonus).toContain("bonusThreshold");
  });

  it("labels every grid cell of a 2-D pair with the population's joint play", () => {
    const plan = planWith({ bonus: { L: d("0.5"), x_b: d("1.6") } });
    const result = sweepGrid(
      scenarioWith(plan),
      "plan-1",
      { kind: "bonusAmount", lo: R0, hi: d("1"), steps: 4 },
      { kind: "bonusThreshold", lo: d("1"), hi: d("2"), steps: 4 },
    );
    expect(result.cells).toHaveLength(5);
    expect(result.cells[0]).toHaveLength(5);
    const signatures = new Set(result.cells.flat().map((cell) => cell.signature ?? "infeasible"));
    // Both regimes are present: the tier optimum and the threshold play.
    expect(signatures.size).toBeGreaterThan(1);
  });

  it("runs the exact deterministic response even from a CARA workspace", () => {
    const plan = planWith({ bonus: { L: d("0.5"), x_b: d("1.6") } });
    const stochastic: Scenario = {
      ...scenarioWith(plan),
      population: [{ ...segment, noiseSD: d("5"), riskAversion: d("0.01") }],
      settings: { ...scenarioWith(plan).settings, mode: "stochastic" },
    };
    const result = sweepPlan(stochastic, "plan-1", {
      kind: "tierRate",
      tierIndex: 0,
      lo: R0,
      hi: d("0.3"),
      steps: 30,
    });
    expect(result.derivedFromStochastic).toBe(true);
    expect(result.usesExactDeterministicResponse).toBe(true);
    expect(result.stamp.mode).toBe("stochastic");
    expect(result.crossings[0]!.at?.toDecimalString()).toBe("0.06");
  });
});
