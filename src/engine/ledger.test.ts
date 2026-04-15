import { describe, expect, it } from "vitest";
import { computeLedger } from "./ledger";
import { Rat, R0 } from "./rat";
import type { Objective, Plan, Scenario, Segment } from "./types";

const d = (value: string): Rat => Rat.fromDecimalString(value);

const base: Segment = {
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

function plan(id: string, overrides: Partial<Plan>): Plan {
  return {
    id,
    label: id,
    base: R0,
    quota: d("10"),
    tiers: [{ from: R0, rate: d("0.1") }],
    bonus: null,
    cap: null,
    ...overrides,
  };
}

function scenario(
  plans: Plan[],
  population: Segment[] = [base],
  objective: Objective | null = null,
): Scenario {
  return {
    schemaVersion: 1,
    population,
    plans,
    settings: {
      mode: "deterministic",
      periodLabel: "year",
      currencyLabel: "$",
      discount: d("1"),
      seasonality: [d("1"), d("1")],
      ...(objective ? { objective } : {}),
      mc: { seed: 1, N: 500, ranges: {} },
    },
    meta: { notes: "" },
  };
}

describe("the principal's ledger", () => {
  /**
   * a = 100, k = 100, r = 0.1 ⇒ e* = 0.1, q = 10, W = 1. With γ = 1 the firm keeps 10 − 1 = 9,
   * and true value tracks measured revenue exactly, so there is no wedge to report.
   */
  it("states expected profit as the declared objective", () => {
    const result = computeLedger(scenario([plan("plan-1", {})]));
    const row = result.rows[0]!;
    expect(row.trueValue.toDecimalString()).toBe("10");
    expect(row.totalComp.toDecimalString()).toBe("1");
    expect(row.profit.toDecimalString()).toBe("9");
    expect(row.compRatio!.toDecimalString()).toBe("0.1");
    expect(row.wedge.toDecimalString()).toBe("0");
    expect(row.retainedShare.toDecimalString()).toBe("1");
  });

  it("prices the Goodhart wedge instead of only flagging it", () => {
    const result = computeLedger(
      scenario([plan("plan-1", {})], [{ ...base, valueQuality: d("0.5") }]),
    );
    const row = result.rows[0]!;
    // Revenue is still 10 but the business only values it at 5.
    expect(row.trueValue.toDecimalString()).toBe("5");
    expect(row.wedge.toDecimalString()).toBe("-5");
    expect(row.wedgePerRevenue!.toDecimalString()).toBe("-0.5");
  });

  /**
   * Raising the base cannot move effort (O-E), so a base-heavy twin buys exactly the same true
   * value for strictly more comp. That is the one ranking this module will make.
   */
  it("reports dominance only where it needs no weights", () => {
    const result = computeLedger(scenario([plan("plan-1", {}), plan("plan-2", { base: d("1") })]));
    expect(result.dominance).toHaveLength(1);
    const [only] = result.dominance;
    expect(only!.dominantPlanId).toBe("plan-1");
    expect(only!.dominatedPlanId).toBe("plan-2");
    expect(only!.profitGap.toDecimalString()).toBe("1");
    expect(only!.compSaving.toDecimalString()).toBe("1");
    expect(result.frontier).toEqual(["plan-1"]);
  });

  it("keeps both plans on the frontier when neither beats the other on both axes", () => {
    const result = computeLedger(
      scenario([plan("plan-1", {}), plan("plan-2", { tiers: [{ from: R0, rate: d("0.2") }] })]),
    );
    // plan-1 is cheaper ($1 vs $4); plan-2 is worth more ($20 vs $10).
    expect(result.dominance).toEqual([]);
    expect(result.frontier).toEqual(["plan-1", "plan-2"]);
  });

  it("tests each declared constraint and names the ones that fail", () => {
    const result = computeLedger(
      scenario([plan("plan-1", {})], [base], {
        compRatioCeiling: d("0.05"),
        retentionFloor: d("0.5"),
      }),
    );
    const row = result.rows[0]!;
    expect(row.feasible).toBe(false);
    const compRatio = row.constraints.find((entry) => entry.id === "comp-ratio")!;
    expect(compRatio.satisfied).toBe(false);
    expect(compRatio.actual!.toDecimalString()).toBe("0.1");
    expect(row.constraints.find((entry) => entry.id === "retention")!.satisfied).toBe(true);
  });

  it("fails the retention floor when a segment's CE trails its reservation", () => {
    const result = computeLedger(
      scenario([plan("plan-1", {})], [{ ...base, reservationCE: d("100") }], {
        compRatioCeiling: null,
        retentionFloor: d("1"),
      }),
    );
    const row = result.rows[0]!;
    expect(row.retainedShare.toDecimalString()).toBe("0");
    expect(row.feasible).toBe(false);
  });

  it("declares nothing when the owner has declared nothing", () => {
    const result = computeLedger(scenario([plan("plan-1", {})]));
    expect(result.objective).toBeNull();
    expect(result.rows[0]!.constraints).toEqual([]);
    expect(result.rows[0]!.feasible).toBe(true);
  });
});
