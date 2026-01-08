import { createSplitMix64 } from "./rng";
import { scaleAbility } from "./multitask";
import { simulate, type SimulationResult } from "./simulate";
import { Rat } from "./rat";
import { engineVersion } from "./version";
import { EngineError } from "./errors";
import type { Mode, Scenario, Segment, MultiplierRange } from "./types";

export type KpiKey =
  | "expectedRevenue"
  | "totalComp"
  | "compRatio"
  | "quotaAttainRate"
  | "effectiveCommissionRate"
  | "trueValue";

export const KPI_KEYS: readonly KpiKey[] = [
  "expectedRevenue",
  "totalComp",
  "compRatio",
  "quotaAttainRate",
  "effectiveCommissionRate",
  "trueValue",
];

export interface McKpiSample {
  expectedRevenue: number;
  totalComp: number;
  compRatio: number | null;
  quotaAttainRate: number;
  effectiveCommissionRate: number | null;
  trueValue: number;
}

export interface McPlanQuantiles {
  p10: number;
  p50: number;
  p90: number;
}

export interface McPlanSummary {
  planId: string;
  planLabel: string;
  draws: McKpiSample[];
  quantiles: Record<KpiKey, McPlanQuantiles | null>;
}

export interface McStamp {
  seed: number;
  N: number;
  engineVersion: string;
  mode: Mode;
}

export interface McResult {
  stamp: McStamp;
  plans: McPlanSummary[];
}

export interface TornadoParameterId {
  kind: "demand" | "segment";
  segmentId?: string;
  param?: "a" | "k" | "sigma" | "gamma";
}

export interface TornadoBarPlan {
  planId: string;
  planLabel: string;
  base: number | null;
  low: number | null;
  high: number | null;
}

export interface TornadoBar {
  id: string;
  label: string;
  parameter: TornadoParameterId;
  perPlan: TornadoBarPlan[];
}

export interface TornadoResult {
  stamp: Omit<McStamp, "seed" | "N">;
  kpi: KpiKey;
  bars: TornadoBar[];
}

function toKpiSample(result: SimulationResult, planIndex: number): McKpiSample {
  const plan = result.plans[planIndex];
  if (!plan) throw new EngineError("INTERNAL_INVARIANT", "MC draw returned no plan result.");
  if (result.mode === "deterministic") {
    const kpi = plan.kpis as {
      expectedRevenue: Rat;
      totalComp: Rat;
      compRatio: Rat | null;
      quotaAttainRate: Rat;
      effectiveCommissionRate: Rat | null;
      trueValue: Rat;
    };
    return {
      expectedRevenue: kpi.expectedRevenue.toNumber(),
      totalComp: kpi.totalComp.toNumber(),
      compRatio: kpi.compRatio ? kpi.compRatio.toNumber() : null,
      quotaAttainRate: kpi.quotaAttainRate.toNumber(),
      effectiveCommissionRate: kpi.effectiveCommissionRate ? kpi.effectiveCommissionRate.toNumber() : null,
      trueValue: kpi.trueValue.toNumber(),
    };
  }
  const kpi = plan.kpis as {
    expectedRevenue: number;
    totalComp: number;
    compRatio: number | null;
    quotaAttainRate: number;
    effectiveCommissionRate: number | null;
    trueValue: number;
  };
  return { ...kpi };
}

function applyMultiplierToSegment(segment: Segment, param: "a" | "k" | "sigma" | "gamma", multiplier: Rat): Segment {
  switch (param) {
    case "a": return { ...segment, ability: segment.ability.mul(multiplier) };
    case "k": return { ...segment, costK: segment.costK.mul(multiplier) };
    case "sigma": return { ...segment, noiseSD: segment.noiseSD.mul(multiplier) };
    case "gamma": return { ...segment, valueQuality: segment.valueQuality.mul(multiplier) };
  }
}

/**
 * §3.11 global demand multiplier. It scales both §3.3b task abilities — a demand shock moves the
 * whole selling opportunity, not one activity — and consumes no extra RNG, so the canonical draw
 * order that O-G's bit-replay depends on is untouched. Per-segment ranges stay on task 1 only.
 */
function scaleDemand(segment: Segment, multiplier: Rat): Segment {
  return scaleAbility(segment, multiplier);
}

function rangeMultiplier(range: MultiplierRange, u: number): Rat {
  const [lo, hi] = range;
  const span = hi.sub(lo);
  return lo.add(span.mul(Rat.fromFloat64(u)));
}

interface CanonicalParam {
  id: string;
  label: string;
  parameter: TornadoParameterId;
  range: MultiplierRange;
}

function canonicalParams(scenario: Scenario): CanonicalParam[] {
  const params: CanonicalParam[] = [];
  const ranges = scenario.settings.mc.ranges;
  if (ranges.demand) {
    params.push({
      id: "demand",
      label: "Demand (global ability multiplier)",
      parameter: { kind: "demand" },
      range: ranges.demand,
    });
  }
  const perSegment = ranges.perSegment ?? {};
  for (const segment of scenario.population) {
    const segRanges = perSegment[segment.id];
    if (!segRanges) continue;
    for (const key of ["a", "k", "sigma", "gamma"] as const) {
      const range = segRanges[key];
      if (!range) continue;
      params.push({
        id: `${segment.id}.${key}`,
        label: `${segment.label} · ${key}`,
        parameter: { kind: "segment", segmentId: segment.id, param: key },
        range,
      });
    }
  }
  return params;
}

function applyDrawMultipliers(
  scenario: Scenario,
  demandMultiplier: Rat | null,
  perSegmentMultipliers: Map<string, Partial<Record<"a" | "k" | "sigma" | "gamma", Rat>>>,
): Scenario {
  const population = scenario.population.map((segment) => {
    let next = segment;
    if (demandMultiplier) next = scaleDemand(next, demandMultiplier);
    const perSeg = perSegmentMultipliers.get(segment.id);
    if (perSeg) {
      for (const key of ["a", "k", "sigma", "gamma"] as const) {
        const multiplier = perSeg[key];
        if (multiplier) next = applyMultiplierToSegment(next, key, multiplier);
      }
    }
    return next;
  });
  return { ...scenario, population };
}

/** §3.11 draw protocol — deterministic canonical order for O-G bit-replay. */
function generateDraw(rng: ReturnType<typeof createSplitMix64>, scenario: Scenario): Scenario {
  const ranges = scenario.settings.mc.ranges;
  const demandMultiplier = ranges.demand ? rangeMultiplier(ranges.demand, rng.nextFloat()) : null;
  const perSegment = new Map<string, Partial<Record<"a" | "k" | "sigma" | "gamma", Rat>>>();
  const perSegRanges = ranges.perSegment ?? {};
  for (const segment of scenario.population) {
    const segRanges = perSegRanges[segment.id];
    if (!segRanges) continue;
    const bucket: Partial<Record<"a" | "k" | "sigma" | "gamma", Rat>> = {};
    for (const key of ["a", "k", "sigma", "gamma"] as const) {
      const range = segRanges[key];
      if (!range) continue;
      bucket[key] = rangeMultiplier(range, rng.nextFloat());
    }
    perSegment.set(segment.id, bucket);
  }
  return applyDrawMultipliers(scenario, demandMultiplier, perSegment);
}

/** Weighted lower quantile (§3.11 type-1) — sort ascending, take ⌈p·N⌉ − 1. */
export function lowerQuantile(sortedAscending: readonly number[], probability: number): number {
  if (sortedAscending.length === 0) throw new EngineError("INTERNAL_INVARIANT", "Cannot quantile an empty sample.");
  const n = sortedAscending.length;
  const rawIndex = Math.ceil(probability * n) - 1;
  const clamped = Math.min(Math.max(rawIndex, 0), n - 1);
  const value = sortedAscending[clamped];
  if (value === undefined) throw new EngineError("INTERNAL_INVARIANT", "Quantile index out of range.");
  return value;
}

function summarizeDraws(planId: string, planLabel: string, draws: McKpiSample[]): McPlanSummary {
  const quantiles: Record<KpiKey, McPlanQuantiles | null> = {
    expectedRevenue: null,
    totalComp: null,
    compRatio: null,
    quotaAttainRate: null,
    effectiveCommissionRate: null,
    trueValue: null,
  };
  for (const key of KPI_KEYS) {
    const values: number[] = [];
    for (const draw of draws) {
      const value = draw[key];
      if (typeof value === "number" && Number.isFinite(value)) values.push(value);
    }
    if (values.length === 0) { quantiles[key] = null; continue; }
    values.sort((left, right) => left - right);
    quantiles[key] = {
      p10: lowerQuantile(values, 0.1),
      p50: lowerQuantile(values, 0.5),
      p90: lowerQuantile(values, 0.9),
    };
  }
  return { planId, planLabel, draws, quantiles };
}

export function runMonteCarlo(scenario: Scenario): McResult {
  const { seed, N } = scenario.settings.mc;
  const rng = createSplitMix64(seed);
  const perPlanDraws: McKpiSample[][] = scenario.plans.map(() => []);
  for (let draw = 0; draw < N; draw += 1) {
    const perturbed = generateDraw(rng, scenario);
    const result = simulate(perturbed);
    scenario.plans.forEach((_plan, index) => {
      const sample = toKpiSample(result, index);
      perPlanDraws[index]?.push(sample);
    });
  }
  const plans = scenario.plans.map((plan, index) =>
    summarizeDraws(plan.id, plan.label, perPlanDraws[index] ?? []),
  );
  return {
    stamp: { seed, N, engineVersion, mode: scenario.settings.mode },
    plans,
  };
}

function applyTornadoParam(scenario: Scenario, param: CanonicalParam, endpoint: Rat): Scenario {
  if (param.parameter.kind === "demand") {
    return applyDrawMultipliers(scenario, endpoint, new Map());
  }
  const segmentId = param.parameter.segmentId!;
  const key = param.parameter.param!;
  const map = new Map<string, Partial<Record<"a" | "k" | "sigma" | "gamma", Rat>>>();
  map.set(segmentId, { [key]: endpoint });
  return applyDrawMultipliers(scenario, null, map);
}

function tornadoKpiValue(scenario: Scenario, planIndex: number, kpi: KpiKey): number | null {
  const result = simulate(scenario);
  const sample = toKpiSample(result, planIndex);
  return sample[kpi];
}

export function computeTornado(scenario: Scenario, kpi: KpiKey): TornadoResult {
  const params = canonicalParams(scenario);
  const baseValues = scenario.plans.map((_plan, index) => tornadoKpiValue(scenario, index, kpi));
  const bars: TornadoBar[] = params.map((param) => {
    const lowScenario = applyTornadoParam(scenario, param, param.range[0]);
    const highScenario = applyTornadoParam(scenario, param, param.range[1]);
    return {
      id: param.id,
      label: param.label,
      parameter: param.parameter,
      perPlan: scenario.plans.map((plan, index) => ({
        planId: plan.id,
        planLabel: plan.label,
        base: baseValues[index] ?? null,
        low: tornadoKpiValue(lowScenario, index, kpi),
        high: tornadoKpiValue(highScenario, index, kpi),
      })),
    };
  });
  return {
    stamp: { engineVersion, mode: scenario.settings.mode },
    kpi,
    bars,
  };
}

export function hasActiveRanges(scenario: Scenario): boolean {
  return canonicalParams(scenario).length > 0;
}

export function activeParameterLabels(scenario: Scenario): string[] {
  return canonicalParams(scenario).map((param) => param.label);
}
