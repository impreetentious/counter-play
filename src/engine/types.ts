import type { Rat } from "./rat";

export type Mode = "deterministic" | "stochastic";

export interface Segment {
  id: string;
  label: string;
  count: number;
  ability: Rat;
  costK: Rat;
  riskAversion: Rat;
  noiseSD: Rat;
  reservationCE: Rat;
  quotaMult: Rat;
  valueQuality: Rat;
  movable: Rat;
}

export interface Tier {
  from: Rat;
  rate: Rat;
}

export interface Bonus {
  L: Rat;
  x_b: Rat;
}

export interface Plan {
  id: string;
  label: string;
  base: Rat;
  quota: Rat;
  tiers: Tier[];
  bonus: Bonus | null;
  cap: Rat | null;
}

export type MultiplierRange = readonly [Rat, Rat];

export interface SegmentRanges {
  a?: MultiplierRange;
  k?: MultiplierRange;
  sigma?: MultiplierRange;
  gamma?: MultiplierRange;
}

export interface MonteCarloSettings {
  seed: number;
  N: number;
  ranges: {
    demand?: MultiplierRange;
    perSegment?: Record<string, SegmentRanges>;
  };
}

export interface ScenarioSettings {
  mode: Mode;
  periodLabel: string;
  currencyLabel: string;
  discount: Rat;
  seasonality: readonly [Rat, Rat];
  mc: MonteCarloSettings;
}

export interface Scenario {
  schemaVersion: 1;
  population: Segment[];
  plans: Plan[];
  settings: ScenarioSettings;
  meta: { notes: string };
}
