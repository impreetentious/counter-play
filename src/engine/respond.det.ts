import { EngineError } from "./errors";
import { decompose, marginalRate, payout, kinks, attainment as planAttainment } from "./plan";
import { Rat, R0 } from "./rat";
import { isSoftmax, modalIndex, softmaxProbabilitiesExact } from "./softmax";
import { effectiveSegment, multitaskReport, type MultitaskReport } from "./multitask";
import type { PayoutDecomposition } from "./plan";
import type { Plan, Rationality, Segment } from "./types";

/** §3.2a recoverable-draw cash-flow report (never enters W); exact in det mode. */
export interface RecoverableDrawReport {
  advance: Rat;
  carry: Rat;
}

/** §3.3a one play from the choice set, with the probability the segment plays it. */
export interface DeterministicComponent {
  probability: Rat;
  effort: Rat;
  output: Rat;
  attainment: Rat;
  payout: Rat;
  decomposition: PayoutDecomposition;
  objective: Rat;
}

export interface DeterministicResponse {
  effort: Rat;
  output: Rat;
  attainment: Rat;
  payout: Rat;
  decomposition: PayoutDecomposition;
  ce: Rat;
  /** §3.3a f⋆ − ce: the CE the segment burns by not playing the optimum (0 in exact mode). */
  ceGap: Rat;
  marginalAtOpt: Rat;
  participation: boolean;
  recoverableDraw: RecoverableDrawReport | null;
  /** §3.3b task allocation and distortion; null when the segment sets no second task. */
  multitask: MultitaskReport | null;
  /** §3.3a mixture over the choice set; exactly one entry (probability 1) in exact mode. */
  components: DeterministicComponent[];
  /** The most-played component — "where most reps sit". */
  modal: DeterministicComponent;
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

function componentAt(plan: Plan, segment: Segment, effort: Rat, probability: Rat): DeterministicComponent {
  const output = segment.ability.mul(effort);
  const decomposition = decompose(plan, segment, output);
  const cost = segment.costK.mul(effort.mul(effort)).div(Rat.from(2));
  return {
    probability,
    effort,
    output,
    attainment: planAttainment(plan, segment, output),
    payout: decomposition.total,
    decomposition,
    objective: decomposition.total.sub(cost),
  };
}

function blendDecompositions(components: readonly DeterministicComponent[]): PayoutDecomposition {
  const first = components[0];
  if (!first) return { base: R0, perTier: [], bonus: R0, spiff: R0, clawback: R0, drawTopUp: R0, floorTopUp: R0, total: R0 };
  const weigh = (pick: (value: PayoutDecomposition) => Rat): Rat =>
    components.reduce((sum, component) => sum.add(pick(component.decomposition).mul(component.probability)), R0);
  return {
    base: weigh((value) => value.base),
    perTier: first.decomposition.perTier.map((_, index) =>
      components.reduce((sum, component) => sum.add((component.decomposition.perTier[index] ?? R0).mul(component.probability)), R0)),
    bonus: weigh((value) => value.bonus),
    spiff: weigh((value) => value.spiff),
    clawback: weigh((value) => value.clawback),
    drawTopUp: weigh((value) => value.drawTopUp),
    floorTopUp: weigh((value) => value.floorTopUp),
    total: weigh((value) => value.total),
  };
}

/** §3.2a report, averaged over the mixture with the positive part taken per component (§3.3a). */
function recoverableReport(plan: Plan, components: readonly DeterministicComponent[]): RecoverableDrawReport | null {
  const advance = plan.extras?.drawRecoverable ?? null;
  if (!advance) return null;
  const carry = components.reduce(
    (sum, component) => sum.add(advance.sub(component.payout.sub(plan.base)).max(R0).mul(component.probability)),
    R0,
  );
  return { advance, carry };
}

function exactBestEffort(plan: Plan, segment: Segment): Rat {
  let best = R0;
  let bestCe = effortCe(plan, segment, best);
  for (const candidate of deterministicCandidates(plan, segment)) {
    const ce = effortCe(plan, segment, candidate);
    if (ce.gt(bestCe) || (ce.eq(bestCe) && candidate.lt(best))) {
      best = candidate;
      bestCe = ce;
    }
  }
  return best;
}

/**
 * Exact deterministic best response with the normative lower-effort tie break; under the
 * §3.3a softmax dial the response is the logit mixture over the same candidate set.
 */
export function respondDeterministic(plan: Plan, segment: Segment, rationality?: Rationality | null): DeterministicResponse {
  // §3.3b: the multitask problem is this same solve on a costK-rescaled segment; with no second
  // task `effectiveSegment` returns the segment itself, so nothing below can move.
  const solving = effectiveSegment(segment);
  const components: DeterministicComponent[] = [];
  if (isSoftmax(rationality)) {
    const plays = deterministicCandidates(plan, solving).map((effort) => componentAt(plan, solving, effort, R0));
    const probabilities = softmaxProbabilitiesExact(plays.map((play) => play.objective), rationality.tau);
    plays.forEach((play, index) => components.push({ ...play, probability: probabilities[index] ?? R0 }));
  } else {
    components.push(componentAt(plan, solving, exactBestEffort(plan, solving), Rat.one()));
  }

  const modal = components[modalIndex(components.map((component) => component.probability))] ?? components[0];
  if (!modal) throw new EngineError("INTERNAL_INVARIANT", "A response always has at least one component.");
  const single = components.length === 1 ? modal : null;
  const weigh = (pick: (component: DeterministicComponent) => Rat): Rat =>
    components.reduce((sum, component) => sum.add(pick(component).mul(component.probability)), R0);

  const output = single ? single.output : weigh((component) => component.output);
  const ce = single ? single.objective : weigh((component) => component.objective);
  const best = components.reduce((max, component) => component.objective.max(max), modal.objective);

  return {
    effort: single ? single.effort : weigh((component) => component.effort),
    output,
    attainment: single ? single.attainment : planAttainment(plan, segment, output),
    payout: single ? single.payout : weigh((component) => component.payout),
    decomposition: single ? single.decomposition : blendDecompositions(components),
    ce,
    ceGap: best.sub(ce),
    marginalAtOpt: marginalRate(plan, segment, modal.output),
    participation: ce.gte(segment.reservationCE),
    recoverableDraw: recoverableReport(plan, components),
    multitask: multitaskReport(segment, components.map((component) => ({ probability: component.probability, output: component.output }))),
    components,
    modal,
  };
}
