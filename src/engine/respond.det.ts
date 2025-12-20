import { decompose, marginalRate, payout, kinks, attainment as planAttainment } from "./plan";
import { Rat, R0 } from "./rat";
import type { PayoutDecomposition } from "./plan";
import type { Plan, Segment } from "./types";

export interface DeterministicResponse {
  effort: Rat;
  output: Rat;
  attainment: Rat;
  payout: Rat;
  decomposition: PayoutDecomposition;
  ce: Rat;
  marginalAtOpt: Rat;
  participation: boolean;
}

function effortCe(plan: Plan, segment: Segment, effort: Rat): Rat {
  const output = segment.ability.mul(effort);
  const cost = segment.costK.mul(effort.mul(effort)).div(Rat.from(2));
  return payout(plan, segment, output).sub(cost);
}

function clamp(value: Rat, lower: Rat, upper: Rat | null): Rat {
  if (value.lt(lower)) return lower;
  if (upper && value.gt(upper)) return upper;
  return value;
}

/** Complete finite §3.3 candidate set, deduplicated and sorted exactly. */
export function deterministicCandidates(plan: Plan, segment: Segment): Rat[] {
  const candidates = [R0];
  const quota = plan.quota.mul(segment.quotaMult);
  const capOutput = plan.cap ? quota.mul(plan.cap) : null;

  for (let index = 0; index < plan.tiers.length; index += 1) {
    const tier = plan.tiers[index];
    if (!tier) continue;
    const lowerOutput = quota.mul(tier.from);
    const next = plan.tiers[index + 1];
    const nextOutput = next ? quota.mul(next.from) : null;
    const upperOutput = capOutput && nextOutput ? capOutput.min(nextOutput) : capOutput ?? nextOutput;
    const lowerEffort = lowerOutput.div(segment.ability);
    const upperEffort = upperOutput ? upperOutput.div(segment.ability) : null;
    const focal = tier.rate.mul(segment.ability).div(segment.costK);
    candidates.push(clamp(focal, lowerEffort, upperEffort));
  }

  for (const kink of kinks(plan, segment)) {
    candidates.push(kink.div(segment.ability));
  }

  return candidates
    .filter((candidate) => candidate.gte(R0))
    .sort((left, right) => left.cmp(right))
    .filter((candidate, index, values) => index === 0 || !candidate.eq(values[index - 1] ?? candidate));
}

/** Exact deterministic best response with the normative lower-effort tie break. */
export function respondDeterministic(plan: Plan, segment: Segment): DeterministicResponse {
  let best = R0;
  let bestCe = effortCe(plan, segment, best);
  for (const candidate of deterministicCandidates(plan, segment)) {
    const ce = effortCe(plan, segment, candidate);
    if (ce.gt(bestCe) || (ce.eq(bestCe) && candidate.lt(best))) {
      best = candidate;
      bestCe = ce;
    }
  }
  const output = segment.ability.mul(best);
  const payoutValue = payout(plan, segment, output);
  const decomposition = decompose(plan, segment, output);
  return {
    effort: best,
    output,
    attainment: planAttainment(plan, segment, output),
    payout: payoutValue,
    decomposition,
    ce: bestCe,
    marginalAtOpt: marginalRate(plan, segment, output),
    participation: bestCe.gte(segment.reservationCE),
  };
}
