import { describe, expect, it } from "vitest";
import { comparePlans, compareStochasticPlans, simulate, simulateDeterministic } from "./simulate";
import { Rat } from "./rat";
import { parseScenario, type ScenarioJson } from "@/state/schema";

const scenarioJson: ScenarioJson = {
  schemaVersion: 1,
  population: [
    {
      id: "seg-1",
      label: "Core",
      count: 2,
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
      label: "Low",
      base: "0",
      quota: "100",
      tiers: [{ from: "0", rate: "0.1" }],
      bonus: null,
      cap: null,
    },
    {
      id: "plan-2",
      label: "High",
      base: "0",
      quota: "100",
      tiers: [{ from: "0", rate: "0.2" }],
      bonus: null,
      cap: null,
    },
  ],
  settings: {
    mode: "deterministic",
    periodLabel: "year",
    currencyLabel: "$",
    discount: "1",
    seasonality: ["1", "1"],
    mc: { seed: 1, N: 500, ranges: {} },
  },
  meta: { notes: "" },
};

describe("deterministic simulation", () => {
  it("aggregates full-roster KPIs and returns required attestations", () => {
    const result = simulateDeterministic(parseScenario(scenarioJson));
    const low = result.plans[0];
    expect(low?.kpis.expectedRevenue.serialize()).toBe("20/1");
    expect(low?.kpis.totalComp.serialize()).toBe("2/1");
    expect(low?.kpis.compRatio?.serialize()).toBe("1/10");
    expect(result.attestations).toEqual([
      { id: "I-1", pass: true, maxErr: 0 },
      { id: "I-3", pass: true, maxErr: 0 },
    ]);
  });

  it("recomputes exact comparison deltas", () => {
    const scenario = parseScenario(scenarioJson);
    const result = simulateDeterministic(scenario);
    const comparison = comparePlans(scenario, result, "plan-2", "plan-1");
    expect(comparison.expectedRevenueDelta.serialize()).toBe("20/1");
    expect(comparison.totalCompDelta.serialize()).toBe("6/1");
    expect(comparison.attestation.pass).toBe(true);
  });

  it("rejects a displayed delta that differs from an independent recomputation", () => {
    const scenario = parseScenario(scenarioJson);
    const result = simulateDeterministic(scenario);
    const corrupt = {
      ...result,
      plans: result.plans.map((plan, index) =>
        index === 0
          ? {
              ...plan,
              kpis: { ...plan.kpis, expectedRevenue: plan.kpis.expectedRevenue.add(Rat.from(1)) },
            }
          : plan,
      ),
    };
    expect(() => comparePlans(scenario, corrupt, "plan-1", "plan-2")).toThrow(
      /I-3 exact compare consistency failed/,
    );
  });

  it("aggregates analytic stochastic distributions and conservation attestations", () => {
    const stochastic = {
      ...scenarioJson,
      population: [{ ...scenarioJson.population[0]!, noiseSD: "20", riskAversion: "0.01" }],
      settings: { ...scenarioJson.settings, mode: "stochastic" as const },
    };
    const result = simulate(parseScenario(stochastic));
    expect(result.mode).toBe("stochastic");
    if (result.mode !== "stochastic") throw new Error("Expected stochastic result.");
    expect(result.plans[0]?.kpis.payoutQuantiles.p10).toBeLessThanOrEqual(
      result.plans[0]?.kpis.payoutQuantiles.p90 ?? Infinity,
    );
    expect(result.attestations.map((item) => item.id)).toEqual(["I-1", "I-2", "I-3"]);
    expect(result.attestations.every((item) => item.pass)).toBe(true);
    const comparison = compareStochasticPlans(
      parseScenario(stochastic),
      result,
      "plan-1",
      "plan-2",
    );
    expect(comparison.attestation.pass).toBe(true);
  });

  it("omits I-3 when there is no second plan to compare", () => {
    const scenario = parseScenario({ ...scenarioJson, plans: [scenarioJson.plans[0]!] });
    expect(simulateDeterministic(scenario).attestations.map((item) => item.id)).toEqual(["I-1"]);
  });
});
