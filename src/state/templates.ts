import type { ScenarioJson, SegmentJson } from "./schema";

const sharedPopulation: SegmentJson[] = [
  { id: "seg-1", label: "Junior", count: 6, ability: "600000", costK: "60000", riskAversion: "1.2e-4", noiseSD: "100000", reservationCE: "62000", quotaMult: "0.6", valueQuality: "1", movable: "0.1" },
  { id: "seg-2", label: "Core", count: 8, ability: "900000", costK: "70000", riskAversion: "8e-5", noiseSD: "140000", reservationCE: "75000", quotaMult: "1", valueQuality: "1", movable: "0.1" },
  { id: "seg-3", label: "Senior", count: 4, ability: "1300000", costK: "85000", riskAversion: "5e-5", noiseSD: "200000", reservationCE: "95000", quotaMult: "1.5", valueQuality: "1", movable: "0.1" },
];

const sharedSettings: ScenarioJson["settings"] = {
  mode: "deterministic",
  periodLabel: "year",
  currencyLabel: "$",
  discount: "1",
  seasonality: ["1", "1"],
  mc: { seed: 1, N: 500, ranges: {} },
};

export const templateT1: ScenarioJson = {
  schemaVersion: 1,
  population: sharedPopulation,
  plans: [{ id: "plan-1", label: "Flat 8%", base: "60000", quota: "900000", tiers: [{ from: "0", rate: "0.08" }], bonus: null, cap: null }],
  settings: sharedSettings,
  meta: { notes: "" },
};

export const templateT2: ScenarioJson = {
  schemaVersion: 1,
  population: sharedPopulation,
  plans: [{
    id: "plan-1",
    label: "Tiered accelerator",
    base: "55000",
    quota: "900000",
    tiers: [
      { from: "0", rate: "0.05" },
      { from: "0.6", rate: "0.08" },
      { from: "1", rate: "0.11" },
      { from: "1.4", rate: "0.13" },
    ],
    bonus: null,
    cap: null,
  }],
  settings: sharedSettings,
  meta: { notes: "" },
};

export const templateT3: ScenarioJson = {
  schemaVersion: 1,
  population: sharedPopulation,
  plans: [{
    id: "plan-1",
    label: "Bonus + cap",
    base: "65000",
    quota: "900000",
    tiers: [{ from: "0", rate: "0.06" }],
    bonus: { L: "15000", x_b: "1" },
    cap: "1.5",
  }],
  settings: sharedSettings,
  meta: { notes: "" },
};

export const blankScenario: ScenarioJson = {
  schemaVersion: 1,
  population: [
    { id: "seg-1", label: "Segment 1", count: 5, ability: "800000", costK: "70000", riskAversion: "1e-4", noiseSD: "120000", reservationCE: "70000", quotaMult: "1", valueQuality: "1", movable: "0.1" },
  ],
  plans: [{ id: "plan-1", label: "Plan 1", base: "60000", quota: "900000", tiers: [{ from: "0", rate: "0.08" }], bonus: null, cap: null }],
  settings: sharedSettings,
  meta: { notes: "" },
};

export interface TemplateEntry {
  id: "t1" | "t2" | "t3" | "blank";
  name: string;
  summary: string;
  scenario: ScenarioJson;
}

export const templates: readonly TemplateEntry[] = [
  { id: "t1", name: "Flat 8%", summary: "A single 8% commission on every dollar of revenue.", scenario: templateT1 },
  { id: "t2", name: "Tiered accelerator", summary: "Rates climb from 5% to 13% as attainment crosses 60%, 100%, and 140%.", scenario: templateT2 },
  { id: "t3", name: "Bonus + cap", summary: "A flat 6% rate, a $15k lump bonus at quota, and a cap at 150% attainment.", scenario: templateT3 },
  { id: "blank", name: "Start blank", summary: "One generic segment and one 8% plan you edit end-to-end.", scenario: blankScenario },
];

export const landingScenario: ScenarioJson = templateT2;
