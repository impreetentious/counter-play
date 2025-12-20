import { EngineError } from "./errors";
import { Rat, R0 } from "./rat";
import type { Plan, Segment } from "./types";

export interface PayoutDecomposition {
  base: Rat;
  perTier: Rat[];
  bonus: Rat;
  total: Rat;
}

export function segmentQuota(plan: Plan, segment: Segment): Rat {
  return plan.quota.mul(segment.quotaMult);
}

export function attainment(plan: Plan, segment: Segment, output: Rat): Rat {
  return output.div(segmentQuota(plan, segment));
}

function capOutput(plan: Plan, segment: Segment): Rat | null {
  return plan.cap ? segmentQuota(plan, segment).mul(plan.cap) : null;
}

function tierLower(plan: Plan, segment: Segment, index: number): Rat {
  const tier = plan.tiers[index];
  if (!tier) throw new EngineError("INTERNAL_INVARIANT", "Tier index is out of range.");
  return segmentQuota(plan, segment).mul(tier.from);
}

function tierUpper(plan: Plan, segment: Segment, index: number): Rat | null {
  const next = plan.tiers[index + 1];
  const nextLower = next ? segmentQuota(plan, segment).mul(next.from) : null;
  const cap = capOutput(plan, segment);
  if (!nextLower) return cap;
  if (!cap) return nextLower;
  return nextLower.min(cap);
}

function positivePart(value: Rat): Rat {
  return value.gt(R0) ? value : R0;
}

/** Exact §3.2 payout decomposition, including the tier-one negative-output extension. */
export function decompose(plan: Plan, segment: Segment, output: Rat): PayoutDecomposition {
  const perTier = plan.tiers.map(() => R0);
  const first = plan.tiers[0];
  if (!first) throw new EngineError("INTERNAL_INVARIANT", "A plan must have at least one tier.");

  if (output.lt(R0)) {
    perTier[0] = first.rate.mul(output);
  } else {
    for (let index = 0; index < plan.tiers.length; index += 1) {
      const tier = plan.tiers[index];
      if (!tier) continue;
      const lower = tierLower(plan, segment, index);
      const upper = tierUpper(plan, segment, index);
      let covered = output.sub(lower);
      if (upper) covered = covered.min(upper.sub(lower));
      perTier[index] = tier.rate.mul(positivePart(covered));
    }
  }

  const bonusThreshold = plan.bonus ? segmentQuota(plan, segment).mul(plan.bonus.x_b) : null;
  const bonus = plan.bonus && bonusThreshold && output.gte(bonusThreshold) ? plan.bonus.L : R0;
  const total = perTier.reduce((sum, value) => sum.add(value), plan.base).add(bonus);
  return { base: plan.base, perTier, bonus, total };
}

export function payout(plan: Plan, segment: Segment, output: Rat): Rat {
  return decompose(plan, segment, output).total;
}

/** Right-limit marginal rate; jumps have no marginal rate. */
export function marginalRate(plan: Plan, segment: Segment, output: Rat): Rat {
  const first = plan.tiers[0];
  if (!first) throw new EngineError("INTERNAL_INVARIANT", "A plan must have at least one tier.");
  if (output.lt(R0)) return first.rate;

  const cap = capOutput(plan, segment);
  if (cap && output.gte(cap)) return R0;
  let active = first;
  for (const tier of plan.tiers) {
    if (output.gte(segmentQuota(plan, segment).mul(tier.from))) active = tier;
    else break;
  }
  return active.rate;
}

/** Sorted, deduplicated output kinks used by exact response candidate construction. */
export function kinks(plan: Plan, segment: Segment): Rat[] {
  const quota = segmentQuota(plan, segment);
  const values = [
    ...plan.tiers.slice(1).map((tier) => quota.mul(tier.from)),
    ...(plan.bonus ? [quota.mul(plan.bonus.x_b)] : []),
    ...(plan.cap ? [quota.mul(plan.cap)] : []),
  ].sort((left, right) => left.cmp(right));
  return values.filter((value, index) => index === 0 || !value.eq(values[index - 1] ?? value));
}

export function effectiveCap(plan: Plan): Rat | null {
  const candidates: Rat[] = [];
  if (plan.cap) candidates.push(plan.cap);
  let firstTrailingZero: Rat | null = null;
  for (let index = plan.tiers.length - 1; index >= 0; index -= 1) {
    const tier = plan.tiers[index];
    if (!tier) continue;
    if (tier.rate.eq(R0)) firstTrailingZero = tier.from;
    else break;
  }
  if (firstTrailingZero) candidates.push(firstTrailingZero);
  return candidates.length ? candidates.reduce((smallest, candidate) => smallest.min(candidate)) : null;
}

export function assertDecomposition(plan: Plan, segment: Segment, output: Rat): void {
  const result = decompose(plan, segment, output);
  const reconstructed = result.perTier.reduce((sum, value) => sum.add(value), result.base).add(result.bonus);
  if (!reconstructed.eq(result.total)) {
    throw new EngineError("INTERNAL_INVARIANT", "Payout decomposition does not conserve payout.");
  }
}
