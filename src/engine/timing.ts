import { kinks, payout, segmentQuota } from "./plan";
import { respondDeterministic } from "./respond.det";
import { Rat, R0 } from "./rat";
import type { Plan, Scenario, Segment } from "./types";

export interface TimingSegmentResult {
  segmentId: string;
  segmentLabel: string;
  count: number;
  q1: Rat;
  q2: Rat;
  e1: Rat;
  e2: Rat;
  shiftWindow: readonly [Rat, Rat];
  zStar: Rat;
  payAtBaseline: Rat;
  payAtOptimum: Rat;
  payGain: Rat;
  displacedRevenuePerCapita: Rat;
}

export interface TimingPlanResult {
  planId: string;
  planLabel: string;
  perSegment: TimingSegmentResult[];
  displacedRevenueTotal: Rat;
  twoPeriodExpectedRevenue: Rat;
}

export interface TimingResult {
  discount: Rat;
  seasonality: readonly [Rat, Rat];
  plans: TimingPlanResult[];
}

function perPeriodResponse(plan: Plan, segment: Segment, seasonality: Rat): { effort: Rat; output: Rat } {
  const boosted: Segment = { ...segment, ability: segment.ability.mul(seasonality) };
  const response = respondDeterministic(plan, boosted);
  return { effort: response.effort, output: response.output };
}

function shiftValue(plan: Plan, segment: Segment, q1: Rat, q2: Rat, discount: Rat, z: Rat): Rat {
  const first = payout(plan, segment, q1.add(z));
  const second = payout(plan, segment, q2.sub(z));
  return first.add(discount.mul(second));
}

function tiePreferable(candidate: Rat, current: Rat): boolean {
  const cAbs = candidate.abs();
  const rAbs = current.abs();
  if (cAbs.lt(rAbs)) return true;
  if (cAbs.gt(rAbs)) return false;
  // Equal |z|: §3.10 secondary tie-break — prefer z ≤ 0.
  return candidate.lte(R0) && current.gt(R0);
}

/** §3.10 exact shift optimizer — piecewise linear in z, candidate set is finite. */
export function optimizeShift(plan: Plan, segment: Segment, q1: Rat, q2: Rat, discount: Rat): Rat {
  const windowLo = segment.movable.mul(q1).neg();
  const windowHi = segment.movable.mul(q2);
  if (windowLo.eq(R0) && windowHi.eq(R0)) return R0;
  const candidates: Rat[] = [R0, windowLo, windowHi];
  for (const kink of kinks(plan, segment)) {
    const zA = kink.sub(q1);
    const zB = q2.sub(kink);
    if (zA.gte(windowLo) && zA.lte(windowHi)) candidates.push(zA);
    if (zB.gte(windowLo) && zB.lte(windowHi)) candidates.push(zB);
  }
  let best = R0;
  let bestValue = shiftValue(plan, segment, q1, q2, discount, best);
  for (const z of candidates) {
    if (z.lt(windowLo) || z.gt(windowHi)) continue;
    const value = shiftValue(plan, segment, q1, q2, discount, z);
    if (value.gt(bestValue)) { best = z; bestValue = value; continue; }
    if (value.eq(bestValue) && tiePreferable(z, best)) { best = z; }
  }
  return best;
}

function timingForPlan(scenario: Scenario, plan: Plan): TimingPlanResult {
  const discount = scenario.settings.discount;
  const [d1, d2] = scenario.settings.seasonality;
  const perSegment = scenario.population.map((segment) => {
    const p1 = perPeriodResponse(plan, segment, d1);
    const p2 = perPeriodResponse(plan, segment, d2);
    const q1 = p1.output;
    const q2 = p2.output;
    const zStar = optimizeShift(plan, segment, q1, q2, discount);
    const payAtBaseline = shiftValue(plan, segment, q1, q2, discount, R0);
    const payAtOptimum = shiftValue(plan, segment, q1, q2, discount, zStar);
    const payGain = payAtOptimum.sub(payAtBaseline);
    const shiftWindow: readonly [Rat, Rat] = [segment.movable.mul(q1).neg(), segment.movable.mul(q2)] as const;
    return {
      segmentId: segment.id,
      segmentLabel: segment.label,
      count: segment.count,
      q1,
      q2,
      e1: p1.effort,
      e2: p2.effort,
      shiftWindow,
      zStar,
      payAtBaseline,
      payAtOptimum,
      payGain,
      displacedRevenuePerCapita: zStar.abs(),
    } satisfies TimingSegmentResult;
  });
  const displacedRevenueTotal = perSegment.reduce(
    (sum, seg) => sum.add(seg.displacedRevenuePerCapita.mul(Rat.from(seg.count))),
    R0,
  );
  const twoPeriodExpectedRevenue = perSegment.reduce(
    (sum, seg) => sum.add(seg.q1.add(seg.q2).mul(Rat.from(seg.count))),
    R0,
  );
  return {
    planId: plan.id,
    planLabel: plan.label,
    perSegment,
    displacedRevenueTotal,
    twoPeriodExpectedRevenue,
  };
}

export function computeTiming(scenario: Scenario): TimingResult {
  const plans = scenario.plans.map((plan) => timingForPlan(scenario, plan));
  return { discount: scenario.settings.discount, seasonality: scenario.settings.seasonality, plans };
}

/** Quota-anchored helpers used by the boundary UI. */
export function attainmentOfOutput(plan: Plan, segment: Segment, output: Rat): Rat {
  return output.div(segmentQuota(plan, segment));
}
