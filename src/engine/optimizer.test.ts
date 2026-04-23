import { describe, expect, it } from "vitest";
import { optimizePlan } from "./optimizer";
import { Rat, R0 } from "./rat";
import type { Plan, Scenario, Segment } from "./types";

// §3.15's hand-derived reference: e = r·a/k, q = 100e; a 10% rate lift moves q 10 → 11.
const segment: Segment = {
  id: "seg-1",
  label: "Core",
  count: 1,
  ability: Rat.from(100),
  costK: Rat.from(100),
  riskAversion: R0,
  noiseSD: R0,
  reservationCE: R0,
  quotaMult: Rat.one(),
  valueQuality: Rat.one(),
  movable: R0,
};
const plan: Plan = {
  id: "plan-1",
  label: "Flat",
  base: R0,
  quota: Rat.from(10),
  tiers: [{ from: R0, rate: Rat.from(1, 10) }],
  bonus: null,
  cap: null,
};
const scenario: Scenario = {
  schemaVersion: 1,
  population: [segment],
  plans: [plan],
  settings: {
    mode: "deterministic",
    periodLabel: "year",
    currencyLabel: "$",
    discount: Rat.one(),
    seasonality: [Rat.one(), Rat.one()],
    mc: { seed: 1, N: 500, ranges: {} },
  },
  meta: { notes: "" },
};

describe("local plan search", () => {
  it("selects the hand-derived 10% rate neighbour under the exact deterministic protocol", () => {
    const result = optimizePlan(scenario, "plan-1");
    expect(result).not.toBeNull();
    expect(result?.changedTier).toBe(0);
    expect(result?.multiplier.eq(Rat.from(11, 10))).toBe(true);
    expect(result?.baseline.trueValue.eq(Rat.from(10))).toBe(true);
    expect(result?.candidate.trueValue.eq(Rat.from(11))).toBe(true);
    expect(result?.baseline.totalComp.eq(Rat.one())).toBe(true);
    expect(result?.candidate.totalComp.eq(Rat.from(121, 100))).toBe(true);
    expect(
      result?.rateChanges.map((change) => [
        change.tier,
        change.from.toDecimalString(),
        change.to.toDecimalString(),
      ]),
    ).toEqual([[0, "0.1", "0.11"]]);
    expect(result?.usesExactDeterministicResponse).toBe(true);
  });

  it("returns null when no live commission rate can create a local neighbour", () => {
    const constrained: Scenario = {
      ...scenario,
      plans: [{ ...plan, tiers: [{ ...plan.tiers[0]!, rate: R0 }] }],
    };
    expect(optimizePlan(constrained, "plan-1")).toBeNull();
  });

  it("is deterministic and does not mutate the source plan", () => {
    const first = optimizePlan(scenario, "plan-1");
    const second = optimizePlan(scenario, "plan-1");
    expect(first?.plan.tiers[0]?.rate.eq(second?.plan.tiers[0]?.rate ?? R0)).toBe(true);
    expect(plan.tiers[0]?.rate.eq(Rat.from(1, 10))).toBe(true);
  });
});
