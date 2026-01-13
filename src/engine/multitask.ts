import { Rat, R0 } from "./rat";
import type { Segment } from "./types";

/**
 * §3.3b two-task multitasking. The rep splits effort between the measured task the plan pays on
 * and a second task the plan cannot tell apart but the business values differently. Everything
 * here is exact: the whole model reduces to the §3.3 problem on an effective segment.
 */

/** §3.3b portfolio efficiency `S` and the interior test that selected its branch. */
export interface Portfolio {
  /** `S` — measured revenue² per unit of `2·cost/k`; larger means the portfolio buys revenue more cheaply. */
  efficiency: Rat;
  /** True when both efforts stay nonnegative; false on the crowd-out corner. */
  interior: boolean;
  /** `D = a₁² − 2ψa₁a₂ + a₂²`, the interior branch's numerator. */
  discriminant: Rat;
  /** Index (0 or 1) of the task carrying all effort on the corner branch. */
  cornerTask: 0 | 1;
}

/** §3.3b per-(segment, plan) allocation and distortion report; null when no second task is set. */
export interface MultitaskReport {
  effortTask1: Rat;
  effortTask2: Rat;
  revenueTask1: Rat;
  revenueTask2: Rat;
  /** Realised effort cost `c* = k·q²/(2S)`, blended across a §3.3a mixture. */
  cost: Rat;
  /** `V = γ·a₁e₁ + v₂·e₂`. */
  valueDelivered: Rat;
  /** `V_max² = 2·c*·S_v/k` — rational even though `V_max` is not. */
  valueCeilingSq: Rat;
  /** `1 − V²/V_max² ∈ [0, 1]`: the share of achievable value the plan's own incentives discard. */
  distortionIndex: Rat;
  efficiency: Rat;
  valueEfficiency: Rat;
  interior: boolean;
}

export interface MultitaskReportFloat {
  effortTask1: number;
  effortTask2: number;
  revenueTask1: number;
  revenueTask2: number;
  cost: number;
  valueDelivered: number;
  valueCeilingSq: number;
  distortionIndex: number;
  efficiency: number;
  valueEfficiency: number;
  interior: boolean;
}

const R2 = Rat.from(2);

/** §3.3b `S` for an arbitrary productivity pair — used for both the revenue and value portfolios. */
export function portfolioEfficiency(first: Rat, second: Rat, psi: Rat): Portfolio {
  const discriminant = first
    .mul(first)
    .sub(R2.mul(psi).mul(first).mul(second))
    .add(second.mul(second));
  const interior = first.gte(psi.mul(second)) && second.gte(psi.mul(first));
  if (interior) {
    const denominator = Rat.one().sub(psi.mul(psi));
    return {
      efficiency: discriminant.div(denominator),
      interior: true,
      discriminant,
      cornerTask: 0,
    };
  }
  const cornerTask: 0 | 1 = first.gte(second) ? 0 : 1;
  const best = first.max(second);
  return { efficiency: best.mul(best), interior: false, discriminant, cornerTask };
}

/**
 * Cheapest effort split delivering `q`. Both branches agree where they meet (`ψ·max = min`),
 * so the interior formulas are used whenever the interior test passes.
 */
export function allocate(
  first: Rat,
  second: Rat,
  psi: Rat,
  portfolio: Portfolio,
  target: Rat,
): [Rat, Rat] {
  if (portfolio.interior) {
    return [
      target.mul(first.sub(psi.mul(second))).div(portfolio.discriminant),
      target.mul(second.sub(psi.mul(first))).div(portfolio.discriminant),
    ];
  }
  return portfolio.cornerTask === 0 ? [target.div(first), R0] : [R0, target.div(second)];
}

/** The revenue portfolio of a segment; `S = a₁²` (and the interior branch) with no second task. */
export function revenuePortfolio(segment: Segment): Portfolio {
  const second = segment.secondTask;
  if (!second) return portfolioEfficiency(segment.ability, R0, R0);
  return portfolioEfficiency(segment.ability, second.ability, second.costSubstitution);
}

/**
 * §3.3b reduction: the multitask response *is* the §3.3 response on this segment, whose costK is
 * rescaled so `k_eff·e²/2 = k·q²/(2S)` at `q = a₁·e`. Returns the segment itself when no second
 * task is set, so every prior response, KPI, and golden is bit-identical.
 */
export function effectiveSegment(segment: Segment): Segment {
  if (!segment.secondTask) return segment;
  const portfolio = revenuePortfolio(segment);
  const ability = segment.ability;
  return { ...segment, costK: segment.costK.mul(ability).mul(ability).div(portfolio.efficiency) };
}

/** Scales both task abilities by a demand/seasonality multiplier (§3.3b, §3.10, §3.11). */
export function scaleAbility(segment: Segment, multiplier: Rat): Segment {
  const scaled: Segment = { ...segment, ability: segment.ability.mul(multiplier) };
  if (!segment.secondTask) return scaled;
  return {
    ...scaled,
    secondTask: { ...segment.secondTask, ability: segment.secondTask.ability.mul(multiplier) },
  };
}

/**
 * §3.3b allocation + distortion, blended over a §3.3a mixture. Allocation and value are linear in
 * `q` so they blend exactly; cost is convex, so it is blended per component rather than evaluated
 * at the mean (the same reason §3.3a takes the recoverable-draw positive part per component).
 */
export function multitaskReport(
  segment: Segment,
  entries: readonly { probability: Rat; output: Rat }[],
): MultitaskReport | null {
  const second = segment.secondTask;
  if (!second) return null;
  const portfolio = revenuePortfolio(segment);
  const psi = second.costSubstitution;
  const valuePortfolio = portfolioEfficiency(
    segment.valueQuality.mul(segment.ability),
    second.valuePerEffort,
    psi,
  );

  let effortTask1 = R0;
  let effortTask2 = R0;
  let cost = R0;
  let valueDelivered = R0;
  for (const entry of entries) {
    const [first, rest] = allocate(segment.ability, second.ability, psi, portfolio, entry.output);
    effortTask1 = effortTask1.add(first.mul(entry.probability));
    effortTask2 = effortTask2.add(rest.mul(entry.probability));
    const componentCost = segment.costK
      .mul(entry.output)
      .mul(entry.output)
      .div(portfolio.efficiency.mul(R2));
    cost = cost.add(componentCost.mul(entry.probability));
    const componentValue = segment.valueQuality
      .mul(segment.ability)
      .mul(first)
      .add(second.valuePerEffort.mul(rest));
    valueDelivered = valueDelivered.add(componentValue.mul(entry.probability));
  }

  const valueCeilingSq = R2.mul(cost).mul(valuePortfolio.efficiency).div(segment.costK);
  const distortionIndex = valueCeilingSq.eq(R0)
    ? R0
    : Rat.one().sub(valueDelivered.mul(valueDelivered).div(valueCeilingSq));

  return {
    effortTask1,
    effortTask2,
    revenueTask1: segment.ability.mul(effortTask1),
    revenueTask2: second.ability.mul(effortTask2),
    cost,
    valueDelivered,
    valueCeilingSq,
    distortionIndex,
    efficiency: portfolio.efficiency,
    valueEfficiency: valuePortfolio.efficiency,
    interior: portfolio.interior,
  };
}

export function toFloatReport(report: MultitaskReport): MultitaskReportFloat {
  return {
    effortTask1: report.effortTask1.toNumber(),
    effortTask2: report.effortTask2.toNumber(),
    revenueTask1: report.revenueTask1.toNumber(),
    revenueTask2: report.revenueTask2.toNumber(),
    cost: report.cost.toNumber(),
    valueDelivered: report.valueDelivered.toNumber(),
    valueCeilingSq: report.valueCeilingSq.toNumber(),
    distortionIndex: report.distortionIndex.toNumber(),
    efficiency: report.efficiency.toNumber(),
    valueEfficiency: report.valueEfficiency.toNumber(),
    interior: report.interior,
  };
}

/** Stochastic-path wrapper: float components cross into the exact report and back (§3.7). */
export function multitaskReportFromFloats(
  segment: Segment,
  entries: readonly { probability: number; output: number }[],
): MultitaskReportFloat | null {
  if (!segment.secondTask) return null;
  const exact = multitaskReport(
    segment,
    entries.map((entry) => ({
      probability: Rat.fromFloat64(entry.probability),
      output: Rat.fromFloat64(entry.output),
    })),
  );
  return exact ? toFloatReport(exact) : null;
}

/** §3.5 true value under §3.3b; falls back to `γ·q` when no second task is set. */
export function trueValueOf(segment: Segment, output: Rat, report: MultitaskReport | null): Rat {
  return report ? report.valueDelivered : segment.valueQuality.mul(output);
}
