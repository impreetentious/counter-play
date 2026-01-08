import { EngineError } from "./errors";
import { commissionPieces, kinks, marginalRate, payout, prefloorPieces, segmentQuota } from "./plan";
import type { LinearPiece } from "./plan";
import { deterministicCandidates, respondDeterministic } from "./respond.det";
import type { DeterministicResponse } from "./respond.det";
import { Rat, R0 } from "./rat";
import { isSoftmax, modalIndex, softmaxProbabilitiesFloat } from "./softmax";
import { effectiveSegment, multitaskReportFromFloats, toFloatReport, type MultitaskReportFloat } from "./multitask";
import { logNormalCdf, logNormalInterval, normalCdf, normalIntervalProbability, truncatedNormalMoments } from "./normal";
import type { Plan, Rationality, Segment } from "./types";

export interface FloatDecomposition {
  base: number;
  perTier: number[];
  bonus: number;
  /** §3.2a: E[S·1[q ≥ x_sp·Q]]. */
  spiff: number;
  /** §3.2a: E[K_c·1[q < x_c·Q]] (positive, subtracted). */
  clawback: number;
  /** §3.2a: E[(D_nr − C(q))⁺]. */
  drawTopUp: number;
  /** §3.2a: E[(F − W_pre(q))⁺]. */
  floorTopUp: number;
  total: number;
}

/** §3.2a recoverable-draw cash-flow report (never enters W). */
export interface RecoverableDrawReport {
  advance: number;
  carry: number;
}

interface NumericPiece {
  lower: number;
  upper: number;
  slope: number;
  alpha: number;
}

function toNumericPieces(pieces: readonly LinearPiece[]): NumericPiece[] {
  return pieces.map((piece) => ({
    lower: piece.from ? piece.from.toNumber() : -Infinity,
    upper: piece.to ? piece.to.toNumber() : Infinity,
    slope: piece.slope.toNumber(),
    alpha: piece.alpha.toNumber(),
  }));
}

/** P(g < T) and E[(T − g)⁺] for a nondecreasing piecewise-linear g(q) = alpha + slope·q. */
function expectedShortfall(pieces: readonly NumericPiece[], threshold: number, mean: number, sigma: number): { probability: number; shortfall: number } {
  let probability = 0;
  let shortfall = 0;
  for (const piece of pieces) {
    let lower = piece.lower;
    let upper = piece.upper;
    if (piece.slope > 0) {
      upper = Math.min(upper, (threshold - piece.alpha) / piece.slope);
    } else if (piece.alpha >= threshold) {
      continue;
    }
    if (!(upper > lower)) continue;
    const moments = truncatedNormalMoments(mean, sigma, lower, upper);
    probability += moments.probability;
    shortfall += (threshold - piece.alpha) * moments.probability - piece.slope * moments.first;
  }
  return { probability, shortfall: Math.max(0, shortfall) };
}

export interface PayoutPiece {
  lower: number;
  upper: number;
  alpha: number;
  beta: number;
}

/** §3.3a one play from the choice set, with its own payout distribution. */
export interface StochasticComponent {
  probability: number;
  effort: number;
  output: number;
  payout: number;
  variance: number;
  decomposition: FloatDecomposition;
  objective: number;
  pieceProbabilities: number[];
}

export interface StochasticResponse {
  effort: number;
  output: number;
  attainment: number;
  payout: number;
  payoutVariance: number;
  decomposition: FloatDecomposition;
  ce: number;
  /** §3.3a CE⋆ − ce: what the segment burns by not playing the optimum (0 in exact mode). */
  ceGap: number;
  marginalAtOpt: number;
  participation: boolean;
  pieceProbabilities: number[];
  sigma: number;
  eMax: number;
  recoverableDraw: RecoverableDrawReport | null;
  /** §3.3b task allocation and distortion; null when the segment sets no second task. */
  multitask: MultitaskReportFloat | null;
  /** §3.3a mixture over the choice set; exactly one entry (probability 1) in exact mode. */
  components: StochasticComponent[];
  /** The most-played component — "where most reps sit". */
  modal: StochasticComponent;
}

const EPS = 1e-12;

function toNumber(value: Rat): number {
  return value.toNumber();
}

function sampleBetween(lower: number, upper: number): number {
  if (lower === -Infinity && upper === Infinity) return 0;
  if (lower === -Infinity) return upper - Math.max(1, Math.abs(upper) * 0.01);
  if (upper === Infinity) return lower + Math.max(1, Math.abs(lower) * 0.01);
  return lower + (upper - lower) / 2;
}

/** Linear W(q)=α+βq pieces over (lower, upper], including bonus jumps and caps. */
export function payoutPieces(plan: Plan, segment: Segment): PayoutPiece[] {
  const breaks = kinks(plan, segment).map(toNumber).sort((left, right) => left - right);
  const unique = breaks.filter((value, index) => index === 0 || value !== breaks[index - 1]);
  const bounds = [-Infinity, ...unique, Infinity];
  const pieces: PayoutPiece[] = [];
  for (let index = 0; index < bounds.length - 1; index += 1) {
    const lower = bounds[index] ?? -Infinity;
    const upper = bounds[index + 1] ?? Infinity;
    const probe = sampleBetween(lower, upper);
    const probeRat = Rat.fromFloat64(probe);
    const beta = toNumber(marginalRate(plan, segment, probeRat));
    const alpha = toNumber(payout(plan, segment, probeRat)) - beta * probe;
    pieces.push({ lower, upper, alpha, beta });
  }
  return pieces;
}

function pieceMoments(pieces: readonly PayoutPiece[], mean: number, sigma: number): { expected: number; variance: number; probabilities: number[] } {
  let expected = 0;
  let second = 0;
  const probabilities: number[] = [];
  for (const piece of pieces) {
    const moments = truncatedNormalMoments(mean, sigma, piece.lower, piece.upper);
    probabilities.push(moments.probability);
    expected += piece.alpha * moments.probability + piece.beta * moments.first;
    second += piece.alpha * piece.alpha * moments.probability + 2 * piece.alpha * piece.beta * moments.first + piece.beta * piece.beta * moments.second;
  }
  return { expected, variance: Math.max(0, second - expected * expected), probabilities };
}

function upperForTier(plan: Plan, segment: Segment, index: number): number | null {
  const quota = toNumber(segmentQuota(plan, segment));
  const next = plan.tiers[index + 1];
  const nextBound = next ? quota * toNumber(next.from) : null;
  const cap = plan.cap ? quota * toNumber(plan.cap) : null;
  if (cap === null) return nextBound;
  if (nextBound === null) return cap;
  return Math.min(cap, nextBound);
}

function expectedDecomposition(plan: Plan, segment: Segment, mean: number, sigma: number): FloatDecomposition {
  const quota = toNumber(segmentQuota(plan, segment));
  const perTier = plan.tiers.map((tier, index) => {
    const rate = toNumber(tier.rate);
    const lower = quota * toNumber(tier.from);
    const upper = upperForTier(plan, segment, index);
    if (index === 0) {
      if (upper === null) return rate * mean;
      const below = truncatedNormalMoments(mean, sigma, -Infinity, upper);
      const aboveProbability = normalIntervalProbability((upper - mean) / sigma, Infinity);
      return rate * (below.first + upper * aboveProbability);
    }
    if (upper === null) {
      const above = truncatedNormalMoments(mean, sigma, lower, Infinity);
      return rate * (above.first - lower * above.probability);
    }
    const within = truncatedNormalMoments(mean, sigma, lower, upper);
    const aboveProbability = normalIntervalProbability((upper - mean) / sigma, Infinity);
    return rate * (within.first - lower * within.probability + (upper - lower) * aboveProbability);
  });
  const base = toNumber(plan.base);
  const bonus = plan.bonus
    ? toNumber(plan.bonus.L) * normalIntervalProbability((quota * toNumber(plan.bonus.x_b) - mean) / sigma, Infinity)
    : 0;

  const extras = plan.extras ?? null;
  const spiff = extras?.spiff
    ? toNumber(extras.spiff.amount) * normalIntervalProbability((quota * toNumber(extras.spiff.threshold) - mean) / sigma, Infinity)
    : 0;
  const clawback = extras?.clawback
    ? toNumber(extras.clawback.amount) * normalIntervalProbability(-Infinity, (quota * toNumber(extras.clawback.threshold) - mean) / sigma)
    : 0;
  const drawTopUp = extras?.drawNonRecoverable
    ? expectedShortfall(toNumericPieces(commissionPieces(plan, segment)), toNumber(extras.drawNonRecoverable), mean, sigma).shortfall
    : 0;
  const floorTopUp = extras?.payFloor
    ? expectedShortfall(toNumericPieces(prefloorPieces(plan, segment)), toNumber(extras.payFloor), mean, sigma).shortfall
    : 0;

  const total = base + perTier.reduce((sum, value) => sum + value, 0) + bonus + spiff - clawback + drawTopUp + floorTopUp;
  return { base, perTier, bonus, spiff, clawback, drawTopUp, floorTopUp, total };
}

/** §3.2a recoverable-draw report: advance D_r and expected carry E[(D_r + B − W)⁺]. */
function recoverableDrawReport(plan: Plan, segment: Segment, pieces: readonly PayoutPiece[], mean: number, sigma: number): RecoverableDrawReport | null {
  const draw = plan.extras?.drawRecoverable ?? null;
  if (!draw) return null;
  const advance = toNumber(draw);
  const level = advance + toNumber(plan.base);
  const carry = expectedShortfall(pieces.map((piece) => ({ lower: piece.lower, upper: piece.upper, slope: piece.beta, alpha: piece.alpha })), level, mean, sigma).shortfall;
  return { advance, carry };
}

/** §3.3a field-wise mixture of the expected decompositions (keeps I-1 an independent check). */
function blendFloatDecompositions(components: readonly StochasticComponent[]): FloatDecomposition {
  const weigh = (pick: (value: FloatDecomposition) => number): number =>
    components.reduce((sum, component) => sum + component.probability * pick(component.decomposition), 0);
  const tierCount = components[0]?.decomposition.perTier.length ?? 0;
  return {
    base: weigh((value) => value.base),
    perTier: Array.from({ length: tierCount }, (_, index) =>
      components.reduce((sum, component) => sum + component.probability * (component.decomposition.perTier[index] ?? 0), 0)),
    bonus: weigh((value) => value.bonus),
    spiff: weigh((value) => value.spiff),
    clawback: weigh((value) => value.clawback),
    drawTopUp: weigh((value) => value.drawTopUp),
    floorTopUp: weigh((value) => value.floorTopUp),
    total: weigh((value) => value.total),
  };
}

function logSumExp(values: readonly number[]): number {
  const pivot = Math.max(...values);
  if (!Number.isFinite(pivot)) return pivot;
  return pivot + Math.log(values.reduce((sum, value) => sum + Math.exp(value - pivot), 0));
}

function caraPayoutCe(pieces: readonly PayoutPiece[], mean: number, sigma: number, rho: number): number {
  const terms = pieces.map((piece) => {
    const lower = (piece.lower - mean + rho * piece.beta * sigma * sigma) / sigma;
    const upper = (piece.upper - mean + rho * piece.beta * sigma * sigma) / sigma;
    const logMass = logNormalInterval(lower, upper);
    if (logMass === -Infinity) return -Infinity;
    const coefficient = -rho * piece.alpha - rho * piece.beta * mean + 0.5 * rho * rho * piece.beta * piece.beta * sigma * sigma;
    return coefficient + logMass;
  }).filter(Number.isFinite);
  if (terms.length === 0) throw new EngineError("INTERNAL_INVARIANT", "CARA expectation lost all payout pieces.");
  return -logSumExp(terms) / rho;
}

function c0ForCeiling(firstRate: number, sigma: number, rho: number): number {
  if (rho === 0) return 0;
  const tilted = rho * firstRate * sigma;
  const logarithm = logSumExp([Math.log(0.5), logNormalCdf(tilted) + 0.5 * tilted * tilted]);
  return logarithm / rho;
}

export function stochasticCeiling(plan: Plan, segment: Segment): number {
  const ability = toNumber(segment.ability);
  const costK = toNumber(segment.costK);
  const sigma = toNumber(segment.noiseSD);
  const rho = toNumber(segment.riskAversion);
  const rates = plan.tiers.map((tier) => toNumber(tier.rate));
  const firstRate = rates[0] ?? 0;
  const maxRate = Math.max(...rates);
  const maxKink = Math.max(0, ...kinks(plan, segment).map(toNumber));
  const kinkEffort = maxKink / ability;
  // §3.2a: widen the constant payout headroom by the bounded extension lumps (S + D_nr + F);
  // clawback and the floors only reduce/bound the tail, so the ceiling stays a sufficient over-estimate.
  const extras = plan.extras ?? null;
  const bonus = (plan.bonus ? toNumber(plan.bonus.L) : 0)
    + (extras?.spiff ? toNumber(extras.spiff.amount) : 0)
    + (extras?.drawNonRecoverable ? toNumber(extras.drawNonRecoverable) : 0)
    + (extras?.payFloor ? toNumber(extras.payFloor) : 0);
  const c0 = c0ForCeiling(firstRate, sigma, rho);
  const focus = (maxRate * ability + Math.sqrt((maxRate * ability) ** 2 + 2 * costK * (bonus + 0.4 * maxRate * sigma + c0))) / costK;
  return 1.05 * Math.max(kinkEffort + 6 * sigma / ability, focus);
}

function useRiskNeutral(plan: Plan, segment: Segment, eMax: number): boolean {
  const rho = toNumber(segment.riskAversion);
  if (rho === 0) return true;
  const output = toNumber(segment.ability) * eMax;
  const spread = Math.abs(toNumber(payout(plan, segment, Rat.fromFloat64(output))) - toNumber(payout(plan, segment, R0)));
  return rho * spread < 1e-8;
}

function evaluateCe(plan: Plan, segment: Segment, pieces: readonly PayoutPiece[], effort: number, riskNeutral: boolean): number {
  const mean = toNumber(segment.ability) * effort;
  const sigma = toNumber(segment.noiseSD);
  const payoutCe = riskNeutral
    ? pieceMoments(pieces, mean, sigma).expected
    : caraPayoutCe(pieces, mean, sigma, toNumber(segment.riskAversion));
  return payoutCe - toNumber(segment.costK) * effort * effort / 2;
}

function goldenSearch(fn: (value: number) => number, lower: number, upper: number, eMax: number): { effort: number; ce: number } {
  const ratio = (Math.sqrt(5) - 1) / 2;
  let a = lower;
  let b = upper;
  let x1 = b - ratio * (b - a);
  let x2 = a + ratio * (b - a);
  let f1 = fn(x1);
  let f2 = fn(x2);
  const tolerance = 1e-12 * Math.max(1, eMax);
  for (let iteration = 0; iteration < 200 && b - a > tolerance; iteration += 1) {
    if (f1 >= f2) {
      b = x2;
      x2 = x1;
      f2 = f1;
      x1 = b - ratio * (b - a);
      f1 = fn(x1);
    } else {
      a = x1;
      x1 = x2;
      f1 = f2;
      x2 = a + ratio * (b - a);
      f2 = fn(x2);
    }
  }
  const candidates = [{ effort: a, ce: fn(a) }, { effort: b, ce: fn(b) }, { effort: x1, ce: f1 }, { effort: x2, ce: f2 }]
    .sort((left, right) => right.ce - left.ce || left.effort - right.effort);
  return candidates[0] ?? { effort: 0, ce: fn(0) };
}

function isGloballyLinear(plan: Plan): boolean {
  return plan.tiers.length === 1 && !plan.bonus && !plan.cap;
}

function toFloatDecomposition(decomposition: DeterministicResponse["decomposition"]): FloatDecomposition {
  return {
    base: toNumber(decomposition.base),
    perTier: decomposition.perTier.map(toNumber),
    bonus: toNumber(decomposition.bonus),
    spiff: toNumber(decomposition.spiff),
    clawback: toNumber(decomposition.clawback),
    drawTopUp: toNumber(decomposition.drawTopUp),
    floorTopUp: toNumber(decomposition.floorTopUp),
    total: toNumber(decomposition.total),
  };
}

/** σ = 0 point-mass fallback (§3.4): the exact response, converted at the float boundary. */
function pointMassResponse(plan: Plan, segment: Segment, solving: Segment, rationality: Rationality | null | undefined): StochasticResponse {
  const response = respondDeterministic(plan, segment, rationality);
  const pieces = payoutPieces(plan, segment);
  const components: StochasticComponent[] = response.components.map((component) => {
    const output = toNumber(component.output);
    return {
      probability: toNumber(component.probability),
      effort: toNumber(component.effort),
      output,
      payout: toNumber(component.payout),
      variance: 0,
      decomposition: toFloatDecomposition(component.decomposition),
      objective: toNumber(component.objective),
      pieceProbabilities: pieces.map((piece) => (piece.lower < output && output <= piece.upper ? 1 : 0)),
    };
  });
  const modal = components[modalIndex(response.components.map((component) => component.probability))] ?? components[0];
  if (!modal) throw new EngineError("INTERNAL_INVARIANT", "A response always has at least one component.");
  return {
    effort: toNumber(response.effort), output: toNumber(response.output), attainment: toNumber(response.attainment),
    payout: toNumber(response.payout), payoutVariance: 0, decomposition: toFloatDecomposition(response.decomposition),
    ce: toNumber(response.ce), ceGap: toNumber(response.ceGap), marginalAtOpt: toNumber(response.marginalAtOpt),
    participation: response.participation,
    pieceProbabilities: pieces.map((_, index) => components.reduce((sum, component) => sum + component.probability * (component.pieceProbabilities[index] ?? 0), 0)),
    sigma: 0, eMax: stochasticCeiling(plan, solving),
    recoverableDraw: response.recoverableDraw
      ? { advance: toNumber(response.recoverableDraw.advance), carry: toNumber(response.recoverableDraw.carry) }
      : null,
    multitask: response.multitask ? toFloatReport(response.multitask) : null,
    components, modal,
  };
}

/** Closed-form CARA-normal response with the pinned deterministic global optimizer. */
export function respondCARA(plan: Plan, segment: Segment, rationality?: Rationality | null): StochasticResponse {
  // §3.3b: multitasking reduces to this same solve on a costK-rescaled segment (identity when
  // the segment sets no second task), so the CARA path needs no separate two-task optimizer.
  const solving = effectiveSegment(segment);
  const sigma = toNumber(solving.noiseSD);
  if (sigma === 0) return pointMassResponse(plan, segment, solving, rationality);

  const pieces = payoutPieces(plan, solving);
  const eMax = stochasticCeiling(plan, solving);
  const riskNeutral = useRiskNeutral(plan, solving, eMax);
  const evaluate = (effort: number) => evaluateCe(plan, solving, pieces, effort, riskNeutral);
  const ability = toNumber(solving.ability);
  const costK = toNumber(solving.costK);
  let best: { effort: number; ce: number };

  if (isGloballyLinear(plan)) {
    const rate = toNumber(plan.tiers[0]?.rate ?? R0);
    const effort = rate * ability / costK;
    best = { effort, ce: evaluate(effort) };
  } else {
    const seeded = new Set<number>();
    for (let index = 0; index < 512; index += 1) seeded.add(eMax * index / 511);
    for (const candidate of deterministicCandidates(plan, solving)) seeded.add(toNumber(candidate));
    const evaluated = [...seeded]
      .filter((candidate) => candidate >= 0 && candidate <= eMax)
      .sort((left, right) => left - right)
      .map((effort) => ({ effort, ce: evaluate(effort) }));
    const leaders = [...evaluated].sort((left, right) => right.ce - left.ce || left.effort - right.effort).slice(0, 3);
    best = leaders[0] ?? { effort: 0, ce: evaluate(0) };
    for (const leader of leaders) {
      const index = evaluated.findIndex((candidate) => candidate.effort === leader.effort);
      const lower = evaluated[Math.max(0, index - 1)]?.effort ?? 0;
      const upper = evaluated[Math.min(evaluated.length - 1, index + 1)]?.effort ?? eMax;
      const refined = goldenSearch(evaluate, lower, upper, eMax);
      if (refined.ce > best.ce + EPS || (Math.abs(refined.ce - best.ce) <= EPS && refined.effort < best.effort)) best = refined;
    }
  }

  // §3.3a choice set: the plan's salient efforts plus this mode's own optimum (exact mode plays it alone).
  const choices = isSoftmax(rationality)
    ? [...new Set([...deterministicCandidates(plan, solving).map(toNumber).filter((effort) => effort >= 0), best.effort])].sort((left, right) => left - right)
    : [best.effort];
  const objectives = choices.map((effort) => (effort === best.effort ? best.ce : evaluate(effort)));
  const probabilities = isSoftmax(rationality) ? softmaxProbabilitiesFloat(objectives, toNumber(rationality.tau)) : [1];
  const components: StochasticComponent[] = choices.map((effort, index) => {
    const mean = ability * effort;
    const decomposition = expectedDecomposition(plan, solving, mean, sigma);
    const moments = pieceMoments(pieces, mean, sigma);
    return {
      probability: probabilities[index] ?? 0,
      effort,
      output: mean,
      payout: decomposition.total,
      variance: moments.variance,
      decomposition,
      objective: objectives[index] ?? best.ce,
      pieceProbabilities: moments.probabilities,
    };
  });

  const modal = components[modalIndex(probabilities)] ?? components[0];
  if (!modal) throw new EngineError("INTERNAL_INVARIANT", "A response always has at least one component.");
  const single = components.length === 1 ? modal : null;
  const weigh = (pick: (component: StochasticComponent) => number): number =>
    components.reduce((sum, component) => sum + component.probability * pick(component), 0);

  const output = single ? single.output : weigh((component) => component.output);
  const payoutMean = single ? single.payout : weigh((component) => component.payout);
  const ce = single ? single.objective : weigh((component) => component.objective);
  const quota = toNumber(segmentQuota(plan, solving));
  const carries = components.map((component) => recoverableDrawReport(plan, solving, pieces, component.output, sigma));
  const advance = carries.find((report) => report !== null) ?? null;

  return {
    effort: single ? single.effort : weigh((component) => component.effort),
    output,
    attainment: output / quota,
    payout: payoutMean,
    // Mixture variance: E[Var | j] + Var[E | j] (§3.3a).
    payoutVariance: single ? single.variance : Math.max(0, weigh((component) => component.variance + component.payout * component.payout) - payoutMean * payoutMean),
    decomposition: single ? single.decomposition : blendFloatDecompositions(components),
    ce,
    ceGap: Math.max(...objectives) - ce,
    marginalAtOpt: toNumber(marginalRate(plan, solving, Rat.fromFloat64(modal.output))),
    participation: ce >= toNumber(segment.reservationCE),
    pieceProbabilities: single ? single.pieceProbabilities : pieces.map((_, index) => weigh((component) => component.pieceProbabilities[index] ?? 0)),
    sigma,
    eMax,
    recoverableDraw: advance
      ? { advance: advance.advance, carry: components.reduce((sum, component, index) => sum + component.probability * (carries[index]?.carry ?? 0), 0) }
      : null,
    multitask: multitaskReportFromFloats(segment, components.map((component) => ({ probability: component.probability, output: component.output }))),
    components,
    modal,
  };
}

/**
 * Analytic P(W ≤ payoff) for a monotone plan, including plateaus and bonus jumps.
 * Under a §3.3a mixture this is the component-weighted sum; `q_w` depends on `W` alone.
 */
export function payoutCdf(plan: Plan, segment: Segment, response: StochasticResponse, payoff: number): number {
  if (response.sigma === 0) {
    return response.components.reduce((sum, component) => sum + component.probability * (component.payout <= payoff ? 1 : 0), 0);
  }
  let supremum = -Infinity;
  for (const piece of payoutPieces(plan, segment)) {
    if (piece.beta === 0) {
      if (piece.alpha <= payoff) supremum = Math.max(supremum, piece.upper);
      continue;
    }
    const candidate = (payoff - piece.alpha) / piece.beta;
    if (candidate > piece.lower) supremum = Math.max(supremum, Math.min(candidate, piece.upper));
  }
  if (supremum === -Infinity) return 0;
  if (supremum === Infinity) return 1;
  const edge = supremum;
  return response.components.reduce((sum, component) => sum + component.probability * normalCdf((edge - component.output) / response.sigma), 0);
}
