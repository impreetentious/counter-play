import { describe, expect, it } from "vitest";
import { lintScenario, type Finding } from "./linter";
import { parseScenario, type ScenarioJson } from "@/state/schema";

const baseSettings: ScenarioJson["settings"] = {
  mode: "deterministic",
  periodLabel: "year",
  currencyLabel: "$",
  discount: "1",
  seasonality: ["1", "1"],
  mc: { seed: 1, N: 500, ranges: {} },
};

const flatPopulation = [
  { id: "seg-1", label: "Junior", count: 6, ability: "600000", costK: "60000", riskAversion: "0", noiseSD: "0", reservationCE: "0", quotaMult: "0.6", valueQuality: "1", movable: "0" },
  { id: "seg-2", label: "Core", count: 8, ability: "900000", costK: "70000", riskAversion: "0", noiseSD: "0", reservationCE: "0", quotaMult: "1", valueQuality: "1", movable: "0" },
  { id: "seg-3", label: "Senior", count: 4, ability: "1300000", costK: "85000", riskAversion: "0", noiseSD: "0", reservationCE: "0", quotaMult: "1.5", valueQuality: "1", movable: "0" },
];

const LF1: ScenarioJson = {
  schemaVersion: 1,
  population: flatPopulation,
  plans: [{
    id: "plan-1",
    label: "Zone",
    base: "60000",
    quota: "900000",
    tiers: [{ from: "0", rate: "0.08" }, { from: "0.5", rate: "0" }, { from: "0.8", rate: "0.11" }],
    bonus: null,
    cap: null,
  }],
  settings: baseSettings,
  meta: { notes: "" },
};

const LF2: ScenarioJson = {
  schemaVersion: 1,
  population: flatPopulation,
  plans: [{
    id: "plan-1",
    label: "Bonus @ 100%",
    base: "55000",
    quota: "900000",
    tiers: [{ from: "0", rate: "0.05" }],
    bonus: { L: "20000", x_b: "1" },
    cap: null,
  }],
  settings: baseSettings,
  meta: { notes: "" },
};

const LF3: ScenarioJson = {
  schemaVersion: 1,
  population: flatPopulation,
  plans: [{
    id: "plan-1",
    label: "Capped flat",
    base: "60000",
    quota: "900000",
    tiers: [{ from: "0", rate: "0.1" }],
    bonus: null,
    cap: "1",
  }],
  settings: baseSettings,
  meta: { notes: "" },
};

const LF4: ScenarioJson = {
  schemaVersion: 1,
  population: [
    { id: "seg-1", label: "High-value low-throughput", count: 5, ability: "600000", costK: "60000", riskAversion: "0", noiseSD: "0", reservationCE: "0", quotaMult: "5", valueQuality: "2", movable: "0" },
    { id: "seg-2", label: "Low-value high-throughput", count: 10, ability: "1500000", costK: "50000", riskAversion: "0", noiseSD: "0", reservationCE: "0", quotaMult: "0.2", valueQuality: "0.19", movable: "0" },
  ],
  plans: [
    { id: "plan-1", label: "Broad", base: "60000", quota: "900000", tiers: [{ from: "0", rate: "0.08" }], bonus: null, cap: null },
    { id: "plan-2", label: "Targeted accelerator", base: "40000", quota: "900000", tiers: [{ from: "0", rate: "0.02" }, { from: "1", rate: "0.12" }], bonus: null, cap: null },
  ],
  settings: baseSettings,
  meta: { notes: "" },
};

const LF5: ScenarioJson = {
  schemaVersion: 1,
  population: [
    { id: "seg-1", label: "Balanced", count: 10, ability: "1000000", costK: "80000", riskAversion: "0", noiseSD: "0", reservationCE: "20000", quotaMult: "1", valueQuality: "1", movable: "0" },
  ],
  plans: [{ id: "plan-1", label: "Simple", base: "60000", quota: "900000", tiers: [{ from: "0", rate: "0.08" }], bonus: null, cap: null }],
  settings: baseSettings,
  meta: { notes: "" },
};

const LF6: ScenarioJson = {
  schemaVersion: 1,
  population: [
    { id: "seg-1", label: "Only", count: 10, ability: "100", costK: "100", riskAversion: "0", noiseSD: "0", reservationCE: "0", quotaMult: "1", valueQuality: "1", movable: "0.3" },
  ],
  plans: [{ id: "plan-1", label: "O-F2", base: "0", quota: "20", tiers: [{ from: "0", rate: "0.1" }], bonus: { L: "0.1", x_b: "0.8" }, cap: null }],
  settings: { ...baseSettings, seasonality: ["1", "1.5"] },
  meta: { notes: "" },
};

function summarize(findings: Finding[]): Array<{ type: string; severity: string; segments: string[]; plans?: string[] }> {
  return findings.map((finding) => {
    const record: { type: string; severity: string; segments: string[]; plans?: string[] } = {
      type: finding.type,
      severity: finding.severity,
      segments: finding.segments,
    };
    if (finding.plans) record.plans = finding.plans;
    return record;
  });
}

describe("linter goldens", () => {
  it("LF-1 fires L-1 warn on Junior and Core (bunched at the zone edge)", () => {
    expect(summarize(lintScenario(parseScenario(LF1)))).toEqual([
      { type: "L-1", severity: "warn", segments: ["seg-1", "seg-2"] },
    ]);
  });

  it("LF-2 fires L-2 high across the roster (bonus cliff)", () => {
    expect(summarize(lintScenario(parseScenario(LF2)))).toEqual([
      { type: "L-2", severity: "high", segments: ["seg-1", "seg-2", "seg-3"] },
    ]);
  });

  it("LF-3 fires L-3 high across the roster (binding cap)", () => {
    expect(summarize(lintScenario(parseScenario(LF3)))).toEqual([
      { type: "L-3", severity: "high", segments: ["seg-1", "seg-2", "seg-3"] },
    ]);
  });

  it("LF-4 fires L-5 high with a plan-level pair (ranking flip)", () => {
    expect(summarize(lintScenario(parseScenario(LF4)))).toEqual([
      { type: "L-5", severity: "high", segments: [], plans: ["plan-1", "plan-2"] },
    ]);
  });

  it("LF-5 clean control produces no findings", () => {
    expect(lintScenario(parseScenario(LF5))).toEqual([]);
  });

  it("LF-6 fires L-7 high on seg-1 (O-F2 end-to-end pull; frozen at P8)", () => {
    const findings = lintScenario(parseScenario(LF6));
    expect(findings).toHaveLength(1);
    const first = findings[0]!;
    expect(first.type).toBe("L-7");
    expect(first.severity).toBe("high");
    expect(first.segments).toEqual(["seg-1"]);
    expect(first.planId).toBe("plan-1");
    expect(first.evidence).toEqual({
      z_star_currency: "6",
      pay_gain_currency: "0.1",
      displaced_revenue: 60,
      displaced_pct: "18%",
    });
  });
});
