import { describe, expect, it } from "vitest";
import { computeTiming, optimizeShift } from "./timing";
import { parseScenario, type ScenarioJson } from "@/state/schema";
import { Rat } from "./rat";
import type { Plan, Segment } from "./types";

function flatPlan(
  bonus: { L: string; x_b: string } | null = null,
  cap: string | null = null,
): Plan {
  return parseScenario({
    schemaVersion: 1,
    population: [
      {
        id: "seg-1",
        label: "unit",
        count: 1,
        ability: "100",
        costK: "100",
        riskAversion: "0",
        noiseSD: "0",
        reservationCE: "0",
        quotaMult: "1",
        valueQuality: "1",
        movable: "0.3",
      },
    ],
    plans: [
      {
        id: "plan-1",
        label: "flat",
        base: "0",
        quota: "1",
        tiers: [{ from: "0", rate: "0.1" }],
        bonus,
        cap,
      },
    ],
    settings: {
      mode: "deterministic",
      periodLabel: "half",
      currencyLabel: "$",
      discount: "1",
      seasonality: ["1", "1"],
      mc: { seed: 1, N: 500, ranges: {} },
    },
    meta: { notes: "" },
  }).plans[0]!;
}

function unitSegment(movable = "0.3"): Segment {
  return parseScenario({
    schemaVersion: 1,
    population: [
      {
        id: "seg-1",
        label: "unit",
        count: 1,
        ability: "100",
        costK: "100",
        riskAversion: "0",
        noiseSD: "0",
        reservationCE: "0",
        quotaMult: "1",
        valueQuality: "1",
        movable,
      },
    ],
    plans: [
      {
        id: "plan-1",
        label: "flat",
        base: "0",
        quota: "1",
        tiers: [{ from: "0", rate: "0.1" }],
        bonus: null,
        cap: null,
      },
    ],
    settings: {
      mode: "deterministic",
      periodLabel: "half",
      currencyLabel: "$",
      discount: "1",
      seasonality: ["1", "1"],
      mc: { seed: 1, N: 500, ranges: {} },
    },
    meta: { notes: "" },
  }).population[0]!;
}

describe("O-F unit oracle — pull, bonus at q̂=16, q1=14, q2=10, window 3", () => {
  it("returns z* = +2 exactly", () => {
    const plan = flatPlan({ L: "1", x_b: "16" });
    // window ±3 → force movable so [-μ·q1, +μ·q2] contains {-3, +3}. movable = 3/10 = 0.3 gives window [-4.2, +3].
    // For a symmetric ±3 window with q1=14, q2=10, μ·q1=3 → μ=3/14; μ·q2=10μ=30/14≈2.14 (asymmetric).
    // Contract phrasing "window 3" = |z|≤3. We enlarge movable and manually restrict candidates via q values.
    const segment: Segment = { ...unitSegment("0.5"), ability: Rat.from(100) };
    // Use plan with q_s = 1 quota so quota × x_b = 16.
    const z = optimizeShift(plan, segment, Rat.from(14), Rat.from(10), Rat.from(1));
    expect(z.eq(Rat.from(2))).toBe(true);
  });
});

describe("O-F unit oracle — push, cap at q=16, q1=18, q2=10", () => {
  it("returns z* = −2 exactly", () => {
    // Plan: flat r=0.1, cap at 16 (attainment). To make Q_s · cap = 16, set quota=1, cap="16".
    const plan = parseScenario({
      schemaVersion: 1,
      population: [
        {
          id: "seg-1",
          label: "unit",
          count: 1,
          ability: "100",
          costK: "100",
          riskAversion: "0",
          noiseSD: "0",
          reservationCE: "0",
          quotaMult: "1",
          valueQuality: "1",
          movable: "0.5",
        },
      ],
      plans: [
        {
          id: "plan-1",
          label: "capped",
          base: "0",
          quota: "1",
          tiers: [{ from: "0", rate: "0.1" }],
          bonus: null,
          cap: "16",
        },
      ],
      settings: {
        mode: "deterministic",
        periodLabel: "half",
        currencyLabel: "$",
        discount: "1",
        seasonality: ["1", "1"],
        mc: { seed: 1, N: 500, ranges: {} },
      },
      meta: { notes: "" },
    }).plans[0]!;
    const segment = unitSegment("0.5");
    const z = optimizeShift(plan, segment, Rat.from(18), Rat.from(10), Rat.from(1));
    expect(z.eq(Rat.from(-2))).toBe(true);
  });
});

describe("O-F unit oracle — neutral flat, no bonus/cap", () => {
  it("returns z* = 0", () => {
    const plan = flatPlan();
    const segment = unitSegment("0.3");
    const z = optimizeShift(plan, segment, Rat.from(10), Rat.from(10), Rat.from(1));
    expect(z.eq(Rat.from(0))).toBe(true);
  });
});

describe("O-F unit oracle — δ-only asymmetry, r=0.1, q1=q2=10, δ=0.9, window ±1", () => {
  it("returns z* = +1 exactly", () => {
    const plan = flatPlan();
    // movable=0.1: window ±1 with q1=q2=10.
    const segment = unitSegment("0.1");
    const z = optimizeShift(plan, segment, Rat.from(10), Rat.from(10), Rat.from(9, 10));
    expect(z.eq(Rat.from(1))).toBe(true);
  });
});

describe("O-F2 end-to-end pull oracle", () => {
  it("computes z* = +6, pay gain 0.1, displaced revenue 6·n_s via computeTiming", () => {
    const wire: ScenarioJson = {
      schemaVersion: 1,
      population: [
        {
          id: "seg-1",
          label: "Only",
          count: 10,
          ability: "100",
          costK: "100",
          riskAversion: "0",
          noiseSD: "0",
          reservationCE: "0",
          quotaMult: "1",
          valueQuality: "1",
          movable: "0.3",
        },
      ],
      plans: [
        {
          id: "plan-1",
          label: "O-F2",
          base: "0",
          quota: "20",
          tiers: [{ from: "0", rate: "0.1" }],
          bonus: { L: "0.1", x_b: "0.8" },
          cap: null,
        },
      ],
      settings: {
        mode: "deterministic",
        periodLabel: "half",
        currencyLabel: "$",
        discount: "1",
        seasonality: ["1", "1.5"],
        mc: { seed: 1, N: 500, ranges: {} },
      },
      meta: { notes: "" },
    };
    const scenario = parseScenario(wire);
    const timing = computeTiming(scenario);
    const plan = timing.plans[0]!;
    const seg = plan.perSegment[0]!;
    expect(seg.q1.eq(Rat.from(10))).toBe(true);
    expect(seg.q2.eq(Rat.from(45, 2))).toBe(true); // 22.5
    expect(seg.zStar.eq(Rat.from(6))).toBe(true);
    expect(seg.payGain.eq(Rat.from(1, 10))).toBe(true); // 0.1
    expect(plan.displacedRevenueTotal.eq(Rat.from(60))).toBe(true); // 10 · 6
    expect(plan.twoPeriodExpectedRevenue.eq(Rat.from(325))).toBe(true); // 10 · 32.5
  });
});

describe("computeTiming — degenerate window", () => {
  it("returns z* = 0 when movable = 0", () => {
    const wire: ScenarioJson = {
      schemaVersion: 1,
      population: [
        {
          id: "seg-1",
          label: "Only",
          count: 1,
          ability: "100",
          costK: "100",
          riskAversion: "0",
          noiseSD: "0",
          reservationCE: "0",
          quotaMult: "1",
          valueQuality: "1",
          movable: "0",
        },
      ],
      plans: [
        {
          id: "plan-1",
          label: "flat",
          base: "0",
          quota: "1",
          tiers: [{ from: "0", rate: "0.1" }],
          bonus: null,
          cap: null,
        },
      ],
      settings: {
        mode: "deterministic",
        periodLabel: "half",
        currencyLabel: "$",
        discount: "1",
        seasonality: ["1", "1.5"],
        mc: { seed: 1, N: 500, ranges: {} },
      },
      meta: { notes: "" },
    };
    const timing = computeTiming(parseScenario(wire));
    expect(timing.plans[0]!.perSegment[0]!.zStar.eq(Rat.from(0))).toBe(true);
  });
});
