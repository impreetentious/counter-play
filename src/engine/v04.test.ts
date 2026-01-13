import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { computeHorizon, quotaSensitivity, solveHorizonEffort } from "./horizon";
import { lintScenario } from "./linter";
import { respondDeterministic } from "./respond.det";
import { computeTiming } from "./timing";
import { Rat, R0 } from "./rat";
import type { Horizon, Plan, Scenario, Segment } from "./types";

// §12 V-04 horizon and ratchet goldens. Every value is the closed form,
// derived by hand and reproduced here — never read back from the implementation (§9).
// a = 100, k = 100, m = 1, movable = 0; plan B = 0, Q = 10, tiers 5% then 20% above quota.
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

const accelerator: Plan = {
  id: "plan-1",
  label: "Accelerator",
  base: R0,
  quota: Rat.from(10),
  tiers: [
    { from: R0, rate: Rat.from(1, 20) },
    { from: Rat.one(), rate: Rat.from(1, 5) },
  ],
  bonus: null,
  cap: null,
};

const flat: Plan = {
  ...accelerator,
  id: "plan-2",
  label: "Flat",
  tiers: [{ from: R0, rate: Rat.from(1, 10) }],
};

function horizonOf(
  periods: number,
  weight: Rat,
  response: Horizon["response"],
  seasonality?: Rat[],
): Horizon {
  return {
    periods,
    seasonality: seasonality ?? Array.from({ length: periods }, () => Rat.one()),
    ratchet: { weight, growth: Rat.one() },
    response,
  };
}

function scenarioWith(
  plan: Plan,
  horizon: Horizon | null,
  population: Segment[] = [segment],
): Scenario {
  return {
    schemaVersion: 1,
    population,
    plans: [plan],
    settings: {
      mode: "deterministic",
      periodLabel: "quarter",
      currencyLabel: "$",
      discount: Rat.one(),
      seasonality: [Rat.one(), Rat.one()],
      ...(horizon ? { horizon } : {}),
      mc: { seed: 1, N: 500, ranges: {} },
    },
    meta: { notes: "" },
  };
}

function planPeriods(scenario: Scenario) {
  const result = computeHorizon(scenario);
  const perSegment = result?.plans[0]?.perSegment[0];
  if (!result || !perSegment) throw new Error("expected a horizon result");
  return { result, segmentResult: perSegment, periods: perSegment.periods };
}

describe("V-04 H1 — no ratchet is the §3.3 world repeated", () => {
  const scenario = scenarioWith(accelerator, horizonOf(3, R0, "myopic"));

  it("holds the quota flat and repeats the single-period response", () => {
    const { periods } = planPeriods(scenario);
    const single = respondDeterministic(accelerator, segment);
    expect(periods).toHaveLength(3);
    for (const period of periods) {
      expect(period.quota.eq(Rat.from(10))).toBe(true);
      expect(period.effort.eq(single.effort)).toBe(true);
      expect(period.produced.eq(Rat.from(20))).toBe(true);
      expect(period.shadowRate.eq(R0)).toBe(true);
    }
  });

  it("leaves nothing displaced when the segment cannot move pipeline", () => {
    const { segmentResult } = planPeriods(scenario);
    expect(segmentResult.shifts.every((shift) => shift.eq(R0))).toBe(true);
    expect(segmentResult.producedRevenue.eq(Rat.from(60))).toBe(true);
    expect(segmentResult.withheldRevenue.eq(R0)).toBe(true);
  });
});

describe("V-04 H2 — ratchet cycling (λ = 0.5, myopic)", () => {
  const scenario = scenarioWith(accelerator, horizonOf(3, Rat.from(1, 2), "myopic"));

  it("reproduces the pinned quota and output path", () => {
    const { periods } = planPeriods(scenario);
    expect(periods.map((period) => period.quota.toNumber())).toEqual([10, 15, 10]);
    expect(periods.map((period) => period.effort.toNumber())).toEqual([0.2, 0.05, 0.2]);
    expect(periods.map((period) => period.produced.toNumber())).toEqual([20, 5, 20]);
  });

  it("charges the firm the drag without calling it strategic withholding", () => {
    const { segmentResult } = planPeriods(scenario);
    expect(segmentResult.producedRevenue.eq(Rat.from(45))).toBe(true);
    expect(segmentResult.unratchetedRevenue.eq(Rat.from(60))).toBe(true);
    // A myopic rep does not withhold: the loss is mechanical, so L-8 must stay silent.
    expect(segmentResult.withheldRevenue.eq(R0)).toBe(true);
    expect(lintScenario(scenario).filter((finding) => finding.type === "L-8")).toHaveLength(0);
  });

  it("reports the ratchet drag at the plan level", () => {
    const { result } = planPeriods(scenario);
    expect(result.plans[0]?.ratchetDrag.eq(Rat.from(15))).toBe(true);
  });
});

describe("V-04 H3 — a rep who prices the ratchet in (λ = 0.1, ratchet-aware)", () => {
  const scenario = scenarioWith(accelerator, horizonOf(2, Rat.from(1, 10), "ratchetAware"));

  it("computes the shadow price exactly from the naive baseline", () => {
    expect(
      quotaSensitivity(accelerator, segment, Rat.from(11), Rat.from(20)).eq(Rat.from(-3, 20)),
    ).toBe(true);
    const { periods } = planPeriods(scenario);
    expect(periods[0]?.shadowRate.eq(Rat.from(-3, 200))).toBe(true);
    expect(periods[1]?.shadowRate.eq(R0)).toBe(true);
  });

  it("withholds exactly 1.5 of revenue in the first period", () => {
    const { periods, segmentResult } = planPeriods(scenario);
    expect(periods[0]?.effort.eq(Rat.from(37, 200))).toBe(true);
    expect(periods[0]?.produced.eq(Rat.from(37, 2))).toBe(true);
    expect(periods[1]?.quota.eq(Rat.from(217, 20))).toBe(true);
    expect(periods[1]?.produced.eq(Rat.from(20))).toBe(true);
    expect(segmentResult.naiveProducedRevenue.eq(Rat.from(40))).toBe(true);
    expect(segmentResult.withheldRevenue.eq(Rat.from(3, 2))).toBe(true);
  });

  it("raises L-8 at warn, since 3.75% is under the 5% line", () => {
    const findings = lintScenario(scenario).filter((finding) => finding.type === "L-8");
    expect(findings).toHaveLength(1);
    expect(findings[0]?.severity).toBe("warn");
    expect(findings[0]?.segments).toEqual(["seg-1"]);
    expect(findings[0]?.evidence.withheld_currency).toBe(1.5);
    expect(findings[0]?.evidence.withheld_pct).toBe("4%");
  });
});

describe("V-04 H4 — a flat plan has no ratchet channel", () => {
  it("prices quota sensitivity at exactly zero", () => {
    expect(quotaSensitivity(flat, segment, Rat.from(11), Rat.from(20)).eq(R0)).toBe(true);
  });

  it("makes the aware and naive chains coincide while the quota still drifts", () => {
    // Quota 20 against a produced 10, so the ratchet visibly walks the quota toward output.
    const wide: Plan = { ...flat, quota: Rat.from(20) };
    const scenario = scenarioWith(wide, horizonOf(3, Rat.from(1, 2), "ratchetAware"));
    const { periods, segmentResult } = planPeriods(scenario);
    expect(periods.every((period) => period.shadowRate.eq(R0))).toBe(true);
    expect(segmentResult.withheldRevenue.eq(R0)).toBe(true);
    expect(periods.map((period) => period.quota.toNumber())).toEqual([20, 15, 12.5]);
    // Effort is quota-invariant on a flat rate, so only the attainment reading moves.
    expect(periods.every((period) => period.effort.eq(Rat.from(1, 10)))).toBe(true);
    expect(segmentResult.attainmentDrift.gt(R0)).toBe(true);
  });
});

describe("V-04 structural invariants", () => {
  it("reproduces the single-period response when the shadow rate is zero", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 40 }), (rateScale) => {
        const plan: Plan = {
          ...accelerator,
          tiers: [
            { from: R0, rate: Rat.from(rateScale, 100) },
            { from: Rat.one(), rate: Rat.from(1, 5) },
          ],
        };
        const solved = solveHorizonEffort(plan, segment, R0);
        return solved.effort.eq(respondDeterministic(plan, segment).effort);
      }),
      { numRuns: 40 },
    );
  });

  it("freezes the quota when the ratchet weight is zero", () => {
    const { periods } = planPeriods(scenarioWith(accelerator, horizonOf(5, R0, "ratchetAware")));
    expect(periods.every((period) => period.quota.eq(Rat.from(10)))).toBe(true);
  });

  it("reproduces §3.10's shift at N = 2 with no ratchet", () => {
    const mover: Segment = { ...segment, count: 10, movable: Rat.from(3, 10) };
    const pullPlan: Plan = {
      id: "plan-1",
      label: "Bonus",
      base: R0,
      quota: Rat.from(20),
      tiers: [{ from: R0, rate: Rat.from(1, 10) }],
      bonus: { L: Rat.from(1, 10), x_b: Rat.from(4, 5) },
      cap: null,
    };
    const seasonality: [Rat, Rat] = [Rat.one(), Rat.from(3, 2)];
    const base = scenarioWith(pullPlan, horizonOf(2, R0, "myopic", [...seasonality]), [mover]);
    const scenario: Scenario = { ...base, settings: { ...base.settings, seasonality } };
    const { segmentResult } = planPeriods(scenario);
    const timing = computeTiming(scenario);
    expect(segmentResult.shifts[0]?.eq(Rat.from(6))).toBe(true);
    expect(segmentResult.shifts[0]?.eq(timing.plans[0]?.perSegment[0]?.zStar ?? R0)).toBe(true);
  });

  it("keeps every quota strictly positive across the bounded ratchet range", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 90 }), (weightPercent) => {
        const horizon = horizonOf(6, Rat.from(weightPercent, 100), "myopic");
        const { periods } = planPeriods(scenarioWith(accelerator, horizon));
        return periods.every((period) => period.quota.gt(R0));
      }),
      { numRuns: 30 },
    );
  });
});
