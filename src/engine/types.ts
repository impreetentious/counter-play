import type { Rat } from "./rat";

export type Mode = "deterministic" | "stochastic";
export type AppLocale = "en-US" | "en-GB" | "de-DE";

/** A view-only destination for explaining a linter finding; it never changes scenario wire data. */
export interface DeepLink {
  surface: "model" | "design" | "simulate" | "analyze";
  chart: string;
  highlight: Record<string, string | number>;
}

/**
 * §3.3b V-03 second task. `ability = 0` is the fully unmeasured activity; `valuePerEffort` is in
 * currency per unit of task-2 effort (not per revenue unit, which an unmeasured task cannot have).
 */
export interface SecondTask {
  /** a₂ — measured revenue per unit of task-2 effort. */
  ability: Rat;
  /** v₂ — true value per unit of task-2 effort. */
  valuePerEffort: Rat;
  /** ψ ∈ [0, 0.95] — cost substitutability; 0 = independent activities. */
  costSubstitution: Rat;
}

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
  /** §3.3b; absent ⇒ responses identical to §3.3/§3.4. */
  secondTask?: SecondTask | null;
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

/**
 * §3.3a V-02 bounded-rationality dial. `exact` is the §3.3/§3.4 best response;
 * `softmax` draws over the plan's salient efforts with temperature `tau` (currency units).
 */
export interface Rationality {
  mode: "exact" | "softmax";
  tau: Rat;
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

/** §3.10a V-04 N-period horizon with a dynamic quota rule. */
export interface Horizon {
  periods: number;
  seasonality: Rat[];
  ratchet: { weight: Rat; growth: Rat };
  response: "myopic" | "ratchetAware";
}

/**
 * The firm's objective, **declared rather than discovered**. Expected profit is always
 * `trueValue − totalComp` — both quantities the engine already computes, and the reason
 * `valueQuality` exists at all. The two optional limits are the constraints a comp committee
 * actually states out loud, and they are recorded so the design record carries the standard
 * a plan was judged against rather than leaving it in the reader's head.
 */
export interface Objective {
  /** Reject a plan whose `totalComp / expectedRevenue` exceeds this. */
  compRatioCeiling: Rat | null;
  /** Reject a plan that retains a smaller share of headcount than this. */
  retentionFloor: Rat | null;
}

/**
 * Presence means the scenario's plans are offered *together* — a menu people choose from
 * rather than alternatives a designer picks between. Selection and sorting run either way;
 * this is what licenses the menu reading, and with it the incentive-compatibility rule.
 */
export interface MenuSettings {
  /** When false a segment must take its best plan even if its CE trails its reservation. */
  walkAwayAllowed: boolean;
}

/** §3.14 V-05 team credit / rank-order tournament group. */
export interface TeamSettings {
  mode: "split" | "tournament";
  size: number;
  split?: { creditShare: Rat } | null;
  tournament?: { prize: Rat; winners: number } | null;
}

export interface ScenarioSettings {
  mode: Mode;
  periodLabel: string;
  currencyLabel: string;
  /** V-10; absent on old scenarios means en-US. Formatting only — never touches engine input. */
  locale?: AppLocale | null;
  discount: Rat;
  seasonality: readonly [Rat, Rat];
  /** §3.3a; absent ⇒ `{ mode: "exact" }` ⇒ responses identical to §3.3/§3.4. */
  rationality?: Rationality | null;
  /** §3.10a; absent ⇒ the §3.10 two-period module is the whole timing story. */
  horizon?: Horizon | null;
  /** §3.14; absent ⇒ no equilibrium module runs. */
  team?: TeamSettings | null;
  /** Absent ⇒ plans are compared on KPI cards only, with no declared standard. */
  objective?: Objective | null;
  /** Absent ⇒ the scenario's plans are alternatives to compare, not a menu people choose from. */
  menu?: MenuSettings | null;
  mc: MonteCarloSettings;
}

export interface Scenario {
  schemaVersion: 1;
  population: Segment[];
  plans: Plan[];
  settings: ScenarioSettings;
  meta: { notes: string };
}
