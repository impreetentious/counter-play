import { describe, expect, it } from "vitest";
import { comparePlans, simulateDeterministic } from "./simulate";
import { parseScenario, type ScenarioJson } from "@/state/schema";

const scenarioJson: ScenarioJson = {
  schemaVersion: 1,
  population: [{ id: "seg-1", label: "Core", count: 2, ability: "100", costK: "100", riskAversion: "0", noiseSD: "0", reservationCE: "0", quotaMult: "1", valueQuality: "1", movable: "0" }],
  plans: [
    { id: "plan-1", label: "Low", base: "0", quota: "100", tiers: [{ from: "0", rate: "0.1" }], bonus: null, cap: null },
    { id: "plan-2", label: "High", base: "0", quota: "100", tiers: [{ from: "0", rate: "0.2" }], bonus: null, cap: null },
  ],
  settings: { mode: "deterministic", periodLabel: "year", currencyLabel: "$", discount: "1", seasonality: ["1", "1"], mc: { seed: 1, N: 500, ranges: {} } },
  meta: { notes: "" },
};

describe("deterministic simulation", () => {
  it("aggregates full-roster KPIs and returns required attestations", () => {
    const result = simulateDeterministic(parseScenario(scenarioJson));
    const low = result.plans[0];
    expect(low?.kpis.expectedRevenue.serialize()).toBe("20/1");
    expect(low?.kpis.totalComp.serialize()).toBe("2/1");
    expect(low?.kpis.compRatio?.serialize()).toBe("1/10");
    expect(result.attestations).toEqual([{ id: "I-1", pass: true, maxErr: 0 }, { id: "I-3", pass: true, maxErr: 0 }]);
  });

  it("recomputes exact comparison deltas", () => {
    const result = simulateDeterministic(parseScenario(scenarioJson));
    const comparison = comparePlans(result, "plan-2", "plan-1");
    expect(comparison.expectedRevenueDelta.serialize()).toBe("20/1");
    expect(comparison.totalCompDelta.serialize()).toBe("6/1");
    expect(comparison.attestation.pass).toBe(true);
  });
});
