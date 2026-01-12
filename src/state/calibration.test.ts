import { describe, expect, it } from "vitest";
import { calibrateHistoricalCsv } from "./calibration";
import { Rat, R0 } from "@/engine/rat";
import type { Scenario } from "@/engine/types";

const scenario: Scenario = {
  schemaVersion: 1,
  population: [{ id: "seg-1", label: "Core", count: 1, ability: Rat.from(100), costK: Rat.from(100), riskAversion: R0, noiseSD: R0, reservationCE: R0, quotaMult: Rat.one(), valueQuality: Rat.one(), movable: R0 }],
  plans: [{ id: "plan-1", label: "Flat", base: R0, quota: Rat.from(10), tiers: [{ from: R0, rate: Rat.from(1, 10) }], bonus: null, cap: null }],
  settings: { mode: "deterministic", periodLabel: "year", currencyLabel: "$", discount: Rat.one(), seasonality: [Rat.one(), Rat.one()], mc: { seed: 1, N: 500, ranges: {} } },
  meta: { notes: "" },
};

describe("V-07 local calibration", () => {
  it("reproduces the hand-derived attainment mean and spread proposal", () => {
    const result = calibrateHistoricalCsv("segment,attainment\nseg-1,0.8\nseg-1,1.0\nseg-1,1.2\n", scenario, "plan-1");
    const proposal = result.proposals[0];
    expect(result.rowsRead).toBe(3);
    expect(proposal?.meanAttainment).toBeCloseTo(1, 12);
    expect(proposal?.attainmentSD).toBeCloseTo(Math.sqrt(0.08 / 3), 12);
    expect(proposal?.modeledAttainment).toBe(1);
    expect(proposal?.ability).toBe("100");
    expect(Number(proposal?.noiseSD)).toBeCloseTo(10 * Math.sqrt(0.08 / 3), 10);
  });

  it("accepts revenue/quota input and rejects unknown or partial rows", () => {
    expect(calibrateHistoricalCsv("segment,revenue,quota\nCore,12,10\n", scenario, "plan-1").proposals[0]?.meanAttainment).toBe(1.2);
    expect(() => calibrateHistoricalCsv("segment,attainment\nmissing,1\n", scenario, "plan-1")).toThrow(/unknown or ambiguous/);
    expect(() => calibrateHistoricalCsv("segment,revenue\nseg-1,10\n", scenario, "plan-1")).toThrow(/needs attainment/);
  });

  it("does not persist or mutate the source scenario", () => {
    calibrateHistoricalCsv("segment,attainment\nseg-1,1.2\n", scenario, "plan-1");
    expect(scenario.population[0]?.ability.eq(Rat.from(100))).toBe(true);
    expect(scenario.population[0]?.noiseSD.eq(R0)).toBe(true);
  });
});
