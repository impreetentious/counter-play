import { describe, expect, it } from "vitest";
import { lintScenario } from "./linter";
import { Rat, R0 } from "./rat";
import { computeSorting } from "./sorting";
import type { MenuSettings, Plan, Scenario, Segment } from "./types";

const d = (value: string): Rat => Rat.fromDecimalString(value);

function segment(overrides: Partial<Segment> & { id: string }): Segment {
  return {
    label: overrides.id,
    count: 1,
    ability: d("100"),
    costK: d("100"),
    riskAversion: R0,
    noiseSD: R0,
    reservationCE: R0,
    quotaMult: d("1"),
    valueQuality: d("1"),
    movable: R0,
    ...overrides,
  };
}

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
  population: Segment[],
  menu: MenuSettings | null = null,
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
      ...(menu ? { menu } : {}),
      mc: { seed: 1, N: 500, ranges: {} },
    },
    meta: { notes: "" },
  };
}

describe("selection and sorting", () => {
  /**
   * With a = 100, k = 100 and a flat 10%, CE is 0.5. A reservation of 1 is out of reach, so
   * that segment leaves; the surviving-roster KPIs are computed on whoever is left, and the
   * difference from §3.5's full-roster reading is the number the KPI card cannot show.
   */
  it("recomputes the KPIs on the roster that stays", () => {
    const result = computeSorting(
      scenario(
        [plan("plan-1", {})],
        [segment({ id: "stays" }), segment({ id: "leaves", reservationCE: d("1") })],
      ),
    );
    const row = result.roster[0]!;
    expect(row.exitingSegmentIds).toEqual(["leaves"]);
    expect(row.exitingHeadcount).toBe(1);
    expect(row.fullRoster.expectedRevenue.toDecimalString()).toBe("20");
    expect(row.surviving.expectedRevenue.toDecimalString()).toBe("10");
    expect(row.delta.expectedRevenue.toDecimalString()).toBe("-10");
    expect(row.surviving.headcount).toBe(1);
  });

  /**
   * The comp ratio can improve for the worst possible reason. Here both plans pay the same
   * ratio, so the check is that the surviving-roster ratio is computed at all rather than
   * inherited from the full roster.
   */
  it("keeps full-roster and surviving-roster comp ratios separately computed", () => {
    const result = computeSorting(
      scenario(
        [plan("plan-1", { base: d("0.4") })],
        [segment({ id: "stays" }), segment({ id: "leaves", reservationCE: d("5") })],
      ),
    );
    const row = result.roster[0]!;
    // Base 0.4 + commission 1 on revenue 10 per head.
    expect(row.fullRoster.compRatio!.toDecimalString()).toBe("0.14");
    expect(row.surviving.compRatio!.toDecimalString()).toBe("0.14");
    expect(row.surviving.totalComp.toDecimalString()).toBe("1.4");
    expect(row.fullRoster.totalComp.toDecimalString()).toBe("2.8");
  });

  /**
   * Two segments, two plans, and each takes the one that suits it: the low-cost segment can
   * afford the effort a steeper rate asks for, the high-cost one cannot. That is screening.
   */
  it("sorts segments onto the plan each one prefers", () => {
    const cheapEffort = segment({ id: "hunter", costK: d("50") });
    const dearEffort = segment({ id: "farmer", costK: d("400") });
    const flat = plan("flat", { base: d("2"), tiers: [{ from: R0, rate: d("0.05") }] });
    const leveraged = plan("leveraged", { base: R0, tiers: [{ from: R0, rate: d("0.2") }] });
    const result = computeSorting(scenario([flat, leveraged], [cheapEffort, dearEffort]));

    expect(result.choices.find((choice) => choice.segmentId === "hunter")!.chosenPlanId).toBe(
      "leveraged",
    );
    expect(result.choices.find((choice) => choice.segmentId === "farmer")!.chosenPlanId).toBe(
      "flat",
    );
    expect(result.deadOptions).toEqual([]);
    expect(result.walkAwayHeadcount).toBe(0);
  });

  it("reports the plan nobody takes rather than hiding it in an average", () => {
    const strictlyWorse = plan("worse", { tiers: [{ from: R0, rate: d("0.01") }] });
    const better = plan("better", { tiers: [{ from: R0, rate: d("0.2") }] });
    const result = computeSorting(scenario([strictlyWorse, better], [segment({ id: "seg-1" })]));
    expect(result.deadOptions).toEqual(["worse"]);
    expect(result.sorting.find((entry) => entry.planId === "better")!.headcount).toBe(1);
  });

  it("lets a segment walk away when no plan clears its reservation", () => {
    const result = computeSorting(
      scenario([plan("plan-1", {})], [segment({ id: "picky", reservationCE: d("100") })]),
    );
    expect(result.choices[0]!.chosenPlanId).toBeNull();
    expect(result.walkAwayHeadcount).toBe(1);
    expect(result.menuKpis.expectedRevenue.toDecimalString()).toBe("0");
  });

  it("keeps a segment on the roster under duress when there is nowhere to walk to", () => {
    const result = computeSorting(
      scenario([plan("plan-1", {})], [segment({ id: "stuck", reservationCE: d("100") })], {
        walkAwayAllowed: false,
      }),
    );
    const choice = result.choices[0]!;
    expect(choice.chosenPlanId).toBe("plan-1");
    expect(choice.surplus.toDecimalString()).toBe("-99.5");
  });

  it("stays silent in the linter until the owner calls the plans a menu", () => {
    const plans = [
      plan("worse", { tiers: [{ from: R0, rate: d("0.01") }] }),
      plan("better", { tiers: [{ from: R0, rate: d("0.2") }] }),
    ];
    const population = [segment({ id: "seg-1" })];
    expect(lintScenario(scenario(plans, population)).some((f) => f.type === "L-10")).toBe(false);
    const findings = lintScenario(scenario(plans, population, { walkAwayAllowed: true })).filter(
      (finding) => finding.type === "L-10",
    );
    expect(findings.map((finding) => finding.evidence.kind).sort()).toEqual([
      "dead-option",
      "pooling",
    ]);
  });

  it("flags a menu whose choice is decided by the tie-break", () => {
    const identical = [plan("a", {}), plan("b", {})];
    const findings = lintScenario(
      scenario(identical, [segment({ id: "seg-1" })], { walkAwayAllowed: true }),
    ).filter((finding) => finding.type === "L-10");
    expect(findings.some((finding) => finding.evidence.kind === "knife-edge")).toBe(true);
    const result = computeSorting(scenario(identical, [segment({ id: "seg-1" })]));
    expect(result.choices[0]!.chosenPlanId).toBe("a");
    expect(result.choices[0]!.separation!.toDecimalString()).toBe("0");
  });

  it("flags menu-induced exit as a high finding when it takes a quarter of the roster", () => {
    const findings = lintScenario(
      scenario(
        [plan("plan-1", {})],
        [
          segment({ id: "stays", count: 3 }),
          segment({ id: "leaves", count: 1, reservationCE: d("100") }),
        ],
        { walkAwayAllowed: true },
      ),
    ).filter((finding) => finding.type === "L-10" && finding.evidence.kind === "walk-away");
    expect(findings).toHaveLength(1);
    expect(findings[0]!.severity).toBe("high");
    expect(findings[0]!.evidence.walk_away_pct).toBe("25%");
  });
});
