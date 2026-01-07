import { EngineError } from "./errors";
import { kinks, marginalRate, payout, segmentQuota } from "./plan";
import { deterministicCandidates, respondDeterministic } from "./respond.det";
import { Rat, R0 } from "./rat";
import { logNormalCdf, logNormalInterval, normalCdf, normalIntervalProbability, truncatedNormalMoments } from "./normal";
import type { Plan, Segment } from "./types";

export interface FloatDecomposition {
  base: number;
  perTier: number[];
  bonus: number;
  spiff: number;
  clawback: number;
  drawTopUp: number;
  floorTopUp: number;
  total: number;
}

export interface PayoutPiece {
  lower: number;
  upper: number;
  alpha: number;
  beta: number;
}

export interface StochasticResponse {
  effort: number;
  output: number;
  attainment: number;
  payout: number;
  payoutVariance: number;
  decomposition: FloatDecomposition;
  ce: number;
  marginalAtOpt: number;
  participation: boolean;
  pieceProbabilities: number[];
  sigma: number;
  eMax: number;
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
  return { base, perTier, bonus, spiff: 0, clawback: 0, drawTopUp: 0, floorTopUp: 0, total: base + perTier.reduce((sum, value) => sum + value, 0) + bonus };
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
  const bonus = plan.bonus ? toNumber(plan.bonus.L) : 0;
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

/** Closed-form CARA-normal response with the pinned deterministic global optimizer. */
export function respondCARA(plan: Plan, segment: Segment): StochasticResponse {
  const sigma = toNumber(segment.noiseSD);
  if (sigma === 0) {
    const response = respondDeterministic(plan, segment);
    const decomposition = {
      base: toNumber(response.decomposition.base),
      perTier: response.decomposition.perTier.map(toNumber),
      bonus: toNumber(response.decomposition.bonus),
      spiff: 0,
      clawback: 0,
      drawTopUp: 0,
      floorTopUp: 0,
      total: toNumber(response.decomposition.total),
    };
    return {
      effort: toNumber(response.effort), output: toNumber(response.output), attainment: toNumber(response.attainment), payout: toNumber(response.payout), payoutVariance: 0,
      decomposition, ce: toNumber(response.ce), marginalAtOpt: toNumber(response.marginalAtOpt), participation: response.participation,
      pieceProbabilities: payoutPieces(plan, segment).map((piece) => (piece.lower < toNumber(response.output) && toNumber(response.output) <= piece.upper ? 1 : 0)),
      sigma, eMax: stochasticCeiling(plan, segment),
    };
  }

  const pieces = payoutPieces(plan, segment);
  const eMax = stochasticCeiling(plan, segment);
  const riskNeutral = useRiskNeutral(plan, segment, eMax);
  const evaluate = (effort: number) => evaluateCe(plan, segment, pieces, effort, riskNeutral);
  const ability = toNumber(segment.ability);
  const costK = toNumber(segment.costK);
  let best: { effort: number; ce: number };

  if (isGloballyLinear(plan)) {
    const rate = toNumber(plan.tiers[0]?.rate ?? R0);
    const effort = rate * ability / costK;
    best = { effort, ce: evaluate(effort) };
  } else {
    const seeded = new Set<number>();
    for (let index = 0; index < 512; index += 1) seeded.add(eMax * index / 511);
    for (const candidate of deterministicCandidates(plan, segment)) seeded.add(toNumber(candidate));
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

  const mean = ability * best.effort;
  const decomposition = expectedDecomposition(plan, segment, mean, sigma);
  const moments = pieceMoments(pieces, mean, sigma);
  const total = decomposition.total;
  const normalized = { ...decomposition, total };
  const quota = toNumber(segmentQuota(plan, segment));
  const marginal = toNumber(marginalRate(plan, segment, Rat.fromFloat64(mean)));
  return {
    effort: best.effort,
    output: mean,
    attainment: mean / quota,
    payout: total,
    payoutVariance: moments.variance,
    decomposition: normalized,
    ce: best.ce,
    marginalAtOpt: marginal,
    participation: best.ce >= toNumber(segment.reservationCE),
    pieceProbabilities: moments.probabilities,
    sigma,
    eMax,
  };
}

/** Analytic P(W ≤ payoff) for a monotone plan, including plateaus and bonus jumps. */
export function payoutCdf(plan: Plan, segment: Segment, response: StochasticResponse, payoff: number): number {
  if (response.sigma === 0) return response.payout <= payoff ? 1 : 0;
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
  return normalCdf((supremum - response.output) / response.sigma);
}
