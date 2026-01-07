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

/** A lump paid/subtracted at an attainment threshold (SPIFF spot bonus, clawback). */
export interface ThresholdLump {
  amount: Rat;
  threshold: Rat;
}

/**
 * §3.2a V-01 payout-primitive extensions. Every field is optional; an all-null
 * (or absent) block leaves `W` identical to §3.2.
 */
export interface PayoutExtras {
  /** D_nr ≥ 0 — non-recoverable draw; floors tier commission at D_nr (incentive-bearing). */
  drawNonRecoverable: Rat | null;
  /** D_r ≥ 0 — recoverable draw; CE-neutral cash-flow report only (never enters W). */
  drawRecoverable: Rat | null;
  /** SPIFF spot bonus: +amount when q ≥ threshold·Q_s. */
  spiff: ThresholdLump | null;
  /** Clawback: −amount while q < threshold·Q_s (lump penalty below the floor). */
  clawback: ThresholdLump | null;
  /** F — pay-floor; clamps W to at least F (overrides the §3.2 Option-B negative tail). */
  payFloor: Rat | null;
}

export interface Plan {
  id: string;
  label: string;
  base: Rat;
  quota: Rat;
  tiers: Tier[];
  bonus: Bonus | null;
  cap: Rat | null;
  /** §3.2a V-01 payout-primitive extensions; absent/null ⇒ identical W to §3.2. */
  extras?: PayoutExtras | null;
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
