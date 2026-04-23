import { decompose, kinks, payout } from "./plan";
import { effectiveSegment, scaleAbility } from "./multitask";
import { deterministicCandidates } from "./respond.det";
import { Rat, R0 } from "./rat";
import type { Horizon, Plan, Scenario, Segment } from "./types";

/**
 * §3.10a N-period horizon with a dynamic quota rule (the Weitzman/Oyer ratchet). Everything here
 * is exact: the quota chain, the ratchet shadow price, each period's effort solve, and the
 * left-to-right adjacent shift pass. The §3.3a rationality dial deliberately does not reach this
 * module — see §3.10a for why a mixture over quota paths is a different object.
 */

interface HorizonPeriodResult {
  /** 1-based period index. */
  period: number;
  demand: Rat;
  quota: Rat;
  /** `s_p = δ·λ·g·Λ_{p+1}`; zero in myopic mode and in the final period. */
  shadowRate: Rat;
  effort: Rat;
  /** Pre-shift output — the quantity the ratchet reads (§3.10a pinned convention). */
  produced: Rat;
  /** Post-shift output — the quantity the plan pays on. */
  credited: Rat;
  attainment: Rat;
  payout: Rat;
}

interface HorizonSegmentResult {
  segmentId: string;
  segmentLabel: string;
  count: number;
  periods: HorizonPeriodResult[];
  /** `z*` per boundary; length `N − 1`. */
  shifts: Rat[];
  producedRevenue: Rat;
  creditedRevenue: Rat;
  discountedPay: Rat;
  displacedRevenue: Rat;
  terminalQuota: Rat;
  /** Produced revenue under the ratchet-naive chain, for the L-8 comparison. */
  naiveProducedRevenue: Rat;
  /** Naive minus actual: what a rep who prices the ratchet in declines to produce. */
  withheldRevenue: Rat;
  /** Produced revenue with the ratchet switched off entirely (λ = 0). */
  unratchetedRevenue: Rat;
  attainmentDrift: Rat;
}

interface HorizonPlanResult {
  planId: string;
  planLabel: string;
  perSegment: HorizonSegmentResult[];
  producedRevenue: Rat;
  naiveProducedRevenue: Rat;
  withheldRevenue: Rat;
  displacedRevenue: Rat;
  /** Revenue the quota rule itself costs the firm: unratcheted produced minus actual produced. */
  ratchetDrag: Rat;
}

export interface HorizonResult {
  periods: number;
  response: Horizon["response"];
  ratchet: { weight: Rat; growth: Rat };
  discount: Rat;
  plans: HorizonPlanResult[];
}

/** A segment whose quota resolves to `quota` under this plan — exact, since `quotaMult = Q/quota`. */
function periodSegment(plan: Plan, segment: Segment, quota: Rat): Segment {
  return { ...segment, quotaMult: quota.div(plan.quota) };
}

/**
 * §3.10a `Λ = ∂W/∂Q` at fixed output — exact, term by term over the §3.2 commission. Lumps are
 * jumps and contribute nothing; the draw and pay-floor plateaus freeze `W` and contribute zero.
 */
export function quotaSensitivity(plan: Plan, segment: Segment, quota: Rat, output: Rat): Rat {
  if (output.lte(R0)) return R0;
  const local = periodSegment(plan, segment, quota);
  const parts = decompose(plan, local, output);
  if (parts.drawTopUp.gt(R0) || parts.floorTopUp.gt(R0)) return R0;

  let sensitivity = R0;
  for (let index = 0; index < plan.tiers.length; index += 1) {
    const tier = plan.tiers[index];
    if (!tier) continue;
    const next = plan.tiers[index + 1];
    const upperAttain =
      next && plan.cap ? next.from.min(plan.cap) : (next?.from ?? plan.cap ?? null);
    const lowerOutput = quota.mul(tier.from);
    if (output.lte(lowerOutput)) continue;
    const upperOutput = upperAttain ? quota.mul(upperAttain) : null;
    if (!upperOutput || output.lte(upperOutput)) {
      sensitivity = sensitivity.sub(tier.rate.mul(tier.from));
    } else if (upperAttain) {
      sensitivity = sensitivity.add(tier.rate.mul(upperAttain.sub(tier.from)));
    }
  }
  return sensitivity;
}

/**
 * §3.10a effort stage: `max_e W(a·e) + s·a·e − k·e²/2`, exactly. The candidate set is §3.3's plus
 * the shadow-shifted tier FOCs; a FOC that falls outside its own piece is harmless because that
 * piece's constrained optimum is an endpoint, and every endpoint is already a kink candidate.
 * With `s = 0` this reproduces `respondDeterministic` value for value.
 */
export function solveHorizonEffort(
  plan: Plan,
  segment: Segment,
  shadowRate: Rat,
): { effort: Rat; output: Rat } {
  const solving = effectiveSegment(segment);
  const candidates = [...deterministicCandidates(plan, solving)];
  if (!shadowRate.eq(R0)) {
    for (const tier of plan.tiers) {
      const focal = tier.rate.add(shadowRate).mul(solving.ability).div(solving.costK);
      if (focal.gt(R0)) candidates.push(focal);
    }
  }
  const objective = (effort: Rat): Rat => {
    const output = solving.ability.mul(effort);
    const cost = solving.costK.mul(effort).mul(effort).div(Rat.from(2));
    return payout(plan, solving, output).add(shadowRate.mul(output)).sub(cost);
  };
  let best = R0;
  let bestValue = objective(best);
  for (const candidate of candidates) {
    if (candidate.lt(R0)) continue;
    const value = objective(candidate);
    if (value.gt(bestValue) || (value.eq(bestValue) && candidate.lt(best))) {
      best = candidate;
      bestValue = value;
    }
  }
  return { effort: best, output: solving.ability.mul(best) };
}

interface ChainEntry {
  quota: Rat;
  demand: Rat;
  shadowRate: Rat;
  effort: Rat;
  produced: Rat;
}

function nextQuota(quota: Rat, weight: Rat, growth: Rat, produced: Rat): Rat {
  return Rat.one().sub(weight).mul(quota).add(weight.mul(growth).mul(produced));
}

/** Runs the forward quota/effort recursion. `baseline` supplies Λ for the ratchet-aware chain. */
function runChain(
  plan: Plan,
  segment: Segment,
  horizon: Horizon,
  discount: Rat,
  weight: Rat,
  baseline: ChainEntry[] | null,
): ChainEntry[] {
  const chain: ChainEntry[] = [];
  let quota = plan.quota.mul(segment.quotaMult);
  for (let index = 0; index < horizon.periods; index += 1) {
    const demand = horizon.seasonality[index] ?? Rat.one();
    const ahead = baseline?.[index + 1] ?? null;
    const shadowRate =
      ahead && !weight.eq(R0)
        ? discount
            .mul(weight)
            .mul(horizon.ratchet.growth)
            .mul(
              quotaSensitivity(
                plan,
                scaleAbility(segment, ahead.demand),
                ahead.quota,
                ahead.produced,
              ),
            )
        : R0;
    const local = periodSegment(plan, scaleAbility(segment, demand), quota);
    const solved = solveHorizonEffort(plan, local, shadowRate);
    chain.push({ quota, demand, shadowRate, effort: solved.effort, produced: solved.output });
    quota = nextQuota(quota, weight, horizon.ratchet.growth, solved.output);
  }
  return chain;
}

function tiePreferable(candidate: Rat, current: Rat): boolean {
  const candidateSize = candidate.abs();
  const currentSize = current.abs();
  if (candidateSize.lt(currentSize)) return true;
  if (candidateSize.gt(currentSize)) return false;
  return candidate.lte(R0) && current.gt(R0);
}

/**
 * §3.10a boundary shift between two periods that may carry different quotas — §3.10's optimizer
 * with the payout functions taken from each period's own quota.
 */
function optimizeShiftAcross(
  plan: Plan,
  first: Segment,
  second: Segment,
  q1: Rat,
  q2: Rat,
  movable: Rat,
  discount: Rat,
): Rat {
  const windowLo = movable.mul(q1).neg();
  const windowHi = movable.mul(q2);
  if (windowLo.eq(R0) && windowHi.eq(R0)) return R0;
  const candidates: Rat[] = [R0, windowLo, windowHi];
  for (const kink of kinks(plan, first)) candidates.push(kink.sub(q1));
  for (const kink of kinks(plan, second)) candidates.push(q2.sub(kink));
  const value = (z: Rat): Rat =>
    payout(plan, first, q1.add(z)).add(discount.mul(payout(plan, second, q2.sub(z))));
  let best = R0;
  let bestValue = value(best);
  for (const z of candidates) {
    if (z.lt(windowLo) || z.gt(windowHi)) continue;
    const candidateValue = value(z);
    if (candidateValue.gt(bestValue)) {
      best = z;
      bestValue = candidateValue;
    } else if (candidateValue.eq(bestValue) && tiePreferable(z, best)) {
      best = z;
    }
  }
  return best;
}

function horizonForSegment(
  plan: Plan,
  segment: Segment,
  horizon: Horizon,
  discount: Rat,
): HorizonSegmentResult {
  const weight = horizon.ratchet.weight;
  const naive = runChain(plan, segment, horizon, discount, weight, null);
  const active =
    horizon.response === "ratchetAware" && !weight.eq(R0)
      ? runChain(plan, segment, horizon, discount, weight, naive)
      : naive;
  const unratcheted = weight.eq(R0) ? naive : runChain(plan, segment, horizon, discount, R0, null);

  // Shifts run left to right on the credited outputs; quotas are already fixed (§3.10a).
  const credited = active.map((entry) => entry.produced);
  const shifts: Rat[] = [];
  for (let index = 0; index + 1 < active.length; index += 1) {
    const left = active[index];
    const right = active[index + 1];
    const leftCredited = credited[index];
    const rightCredited = credited[index + 1];
    if (!left || !right || leftCredited === undefined || rightCredited === undefined) continue;
    const leftSegment = periodSegment(plan, scaleAbility(segment, left.demand), left.quota);
    const rightSegment = periodSegment(plan, scaleAbility(segment, right.demand), right.quota);
    const shift = optimizeShiftAcross(
      plan,
      leftSegment,
      rightSegment,
      leftCredited,
      rightCredited,
      segment.movable,
      discount,
    );
    credited[index] = leftCredited.add(shift);
    credited[index + 1] = rightCredited.sub(shift);
    shifts.push(shift);
  }

  const periods: HorizonPeriodResult[] = active.map((entry, index) => {
    const local = periodSegment(plan, scaleAbility(segment, entry.demand), entry.quota);
    const creditedOutput = credited[index] ?? entry.produced;
    return {
      period: index + 1,
      demand: entry.demand,
      quota: entry.quota,
      shadowRate: entry.shadowRate,
      effort: entry.effort,
      produced: entry.produced,
      credited: creditedOutput,
      attainment: creditedOutput.div(entry.quota),
      payout: payout(plan, local, creditedOutput),
    };
  });

  const sum = (values: readonly Rat[]): Rat =>
    values.reduce((total, value) => total.add(value), R0);
  const producedRevenue = sum(active.map((entry) => entry.produced));
  const naiveProducedRevenue = sum(naive.map((entry) => entry.produced));
  let discountedPay = R0;
  let factor = Rat.one();
  for (const period of periods) {
    discountedPay = discountedPay.add(factor.mul(period.payout));
    factor = factor.mul(discount);
  }
  const firstPeriod = periods[0];
  const lastPeriod = periods.at(-1);

  return {
    segmentId: segment.id,
    segmentLabel: segment.label,
    count: segment.count,
    periods,
    shifts,
    producedRevenue,
    creditedRevenue: sum(credited),
    discountedPay,
    displacedRevenue: sum(shifts.map((shift) => shift.abs())),
    terminalQuota: lastPeriod?.quota ?? plan.quota.mul(segment.quotaMult),
    naiveProducedRevenue,
    withheldRevenue: naiveProducedRevenue.sub(producedRevenue).max(R0),
    unratchetedRevenue: sum(unratcheted.map((entry) => entry.produced)),
    attainmentDrift: (lastPeriod?.attainment ?? R0).sub(firstPeriod?.attainment ?? R0),
  };
}

export function computeHorizon(scenario: Scenario): HorizonResult | null {
  const horizon = scenario.settings.horizon;
  if (!horizon) return null;
  const discount = scenario.settings.discount;
  const weighted = (values: readonly { count: number; value: Rat }[]): Rat =>
    values.reduce((total, entry) => total.add(entry.value.mul(Rat.from(entry.count))), R0);

  const plans = scenario.plans.map((plan) => {
    const perSegment = scenario.population.map((segment) =>
      horizonForSegment(plan, segment, horizon, discount),
    );
    const produced = weighted(
      perSegment.map((entry) => ({ count: entry.count, value: entry.producedRevenue })),
    );
    const unratcheted = weighted(
      perSegment.map((entry) => ({ count: entry.count, value: entry.unratchetedRevenue })),
    );
    return {
      planId: plan.id,
      planLabel: plan.label,
      perSegment,
      producedRevenue: produced,
      naiveProducedRevenue: weighted(
        perSegment.map((entry) => ({ count: entry.count, value: entry.naiveProducedRevenue })),
      ),
      withheldRevenue: weighted(
        perSegment.map((entry) => ({ count: entry.count, value: entry.withheldRevenue })),
      ),
      displacedRevenue: weighted(
        perSegment.map((entry) => ({ count: entry.count, value: entry.displacedRevenue })),
      ),
      ratchetDrag: unratcheted.sub(produced),
    } satisfies HorizonPlanResult;
  });

  return {
    periods: horizon.periods,
    response: horizon.response,
    ratchet: horizon.ratchet,
    discount,
    plans,
  };
}
