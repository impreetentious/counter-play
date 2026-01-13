import { EngineError } from "./errors";
import { Rat, R0 } from "./rat";
import type { Plan, PayoutExtras, Segment } from "./types";

export interface PayoutDecomposition {
  base: Rat;
  perTier: Rat[];
  bonus: Rat;
  /** §3.2a: +S·1[q ≥ x_sp·Q_s]. */
  spiff: Rat;
  /** §3.2a: positive amount subtracted while q < x_c·Q_s. */
  clawback: Rat;
  /** §3.2a: (D_nr − C(q))⁺ — the non-recoverable draw's lift above raw commission. */
  drawTopUp: Rat;
  /** §3.2a: (F − W_pre(q))⁺ — the pay-floor's lift above the pre-floor payout. */
  floorTopUp: Rat;
  total: Rat;
}

/** Exact linear payout piece C(q)=alpha+slope·q on (from, to]; null bounds are ∓∞. */
export interface LinearPiece {
  from: Rat | null;
  to: Rat | null;
  slope: Rat;
  alpha: Rat;
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

function firstTier(plan: Plan) {
  const first = plan.tiers[0];
  if (!first) throw new EngineError("INTERNAL_INVARIANT", "A plan must have at least one tier.");
  return first;
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

const extrasOf = (plan: Plan): PayoutExtras | null => plan.extras ?? null;

function spiffThreshold(plan: Plan, segment: Segment): Rat | null {
  const spiff = extrasOf(plan)?.spiff;
  return spiff ? segmentQuota(plan, segment).mul(spiff.threshold) : null;
}

function clawbackThreshold(plan: Plan, segment: Segment): Rat | null {
  const clawback = extrasOf(plan)?.clawback;
  return clawback ? segmentQuota(plan, segment).mul(clawback.threshold) : null;
}

/** Raw §3.2 per-tier commission split (tier-1 line extended below zero), pre-extensions. */
function rawPerTier(plan: Plan, segment: Segment, output: Rat): Rat[] {
  const perTier = plan.tiers.map(() => R0);
  const first = firstTier(plan);
  if (output.lt(R0)) {
    perTier[0] = first.rate.mul(output);
    return perTier;
  }
  for (let index = 0; index < plan.tiers.length; index += 1) {
    const tier = plan.tiers[index];
    if (!tier) continue;
    const lower = tierLower(plan, segment, index);
    const upper = tierUpper(plan, segment, index);
    let covered = output.sub(lower);
    if (upper) covered = covered.min(upper.sub(lower));
    perTier[index] = tier.rate.mul(positivePart(covered));
  }
  return perTier;
}

/** Tier commission C(q) = Σ perTier (nondecreasing across ℝ). */
export function rawCommission(plan: Plan, segment: Segment, output: Rat): Rat {
  return rawPerTier(plan, segment, output).reduce((sum, value) => sum.add(value), R0);
}

/** Right-limit tier slope of C(q), ignoring the draw/pay-floor plateaus. */
function tierSlope(plan: Plan, segment: Segment, output: Rat): Rat {
  const first = firstTier(plan);
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

/** Pre-floor payout W_pre(q) = B + max(C, D_nr) + bonus + SPIFF − clawback. */
function prefloorAt(plan: Plan, segment: Segment, output: Rat): Rat {
  const extras = extrasOf(plan);
  const commission = rawCommission(plan, segment, output);
  const draw = extras?.drawNonRecoverable ?? null;
  const guarded = draw ? commission.max(draw) : commission;
  let value = plan.base.add(guarded);
  const bonusThreshold = plan.bonus ? segmentQuota(plan, segment).mul(plan.bonus.x_b) : null;
  if (plan.bonus && bonusThreshold && output.gte(bonusThreshold)) value = value.add(plan.bonus.L);
  const spiffAt = spiffThreshold(plan, segment);
  if (extras?.spiff && spiffAt && output.gte(spiffAt)) value = value.add(extras.spiff.amount);
  const clawAt = clawbackThreshold(plan, segment);
  if (extras?.clawback && clawAt && output.lt(clawAt)) value = value.sub(extras.clawback.amount);
  return value;
}

/** Right-limit slope of W_pre(q) (tier slope, flattened inside the draw plateau). */
function prefloorSlope(plan: Plan, segment: Segment, output: Rat): Rat {
  const extras = extrasOf(plan);
  const draw = extras?.drawNonRecoverable ?? null;
  if (draw && rawCommission(plan, segment, output).lt(draw)) return R0;
  return tierSlope(plan, segment, output);
}

/** §3.2a exact decomposition; the four extension fields keep I-1 an independent check. */
export function decompose(plan: Plan, segment: Segment, output: Rat): PayoutDecomposition {
  const perTier = rawPerTier(plan, segment, output);
  const commission = perTier.reduce((sum, value) => sum.add(value), R0);
  const extras = extrasOf(plan);

  const draw = extras?.drawNonRecoverable ?? null;
  const drawTopUp = draw && draw.gt(commission) ? draw.sub(commission) : R0;

  const bonusThreshold = plan.bonus ? segmentQuota(plan, segment).mul(plan.bonus.x_b) : null;
  const bonus = plan.bonus && bonusThreshold && output.gte(bonusThreshold) ? plan.bonus.L : R0;

  const spiffAt = spiffThreshold(plan, segment);
  const spiff = extras?.spiff && spiffAt && output.gte(spiffAt) ? extras.spiff.amount : R0;

  const clawAt = clawbackThreshold(plan, segment);
  const clawback = extras?.clawback && clawAt && output.lt(clawAt) ? extras.clawback.amount : R0;

  const prefloor = plan.base.add(commission).add(drawTopUp).add(bonus).add(spiff).sub(clawback);
  const floor = extras?.payFloor ?? null;
  const floorTopUp = floor && floor.gt(prefloor) ? floor.sub(prefloor) : R0;
  const total = prefloor.add(floorTopUp);

  return { base: plan.base, perTier, bonus, spiff, clawback, drawTopUp, floorTopUp, total };
}

export function payout(plan: Plan, segment: Segment, output: Rat): Rat {
  return decompose(plan, segment, output).total;
}

/** Right-limit marginal rate of the extended W (0 on the draw and pay-floor plateaus). */
export function marginalRate(plan: Plan, segment: Segment, output: Rat): Rat {
  const extras = extrasOf(plan);
  const draw = extras?.drawNonRecoverable ?? null;
  if (draw && rawCommission(plan, segment, output).lt(draw)) return R0;
  const floor = extras?.payFloor ?? null;
  if (floor && floor.gt(prefloorAt(plan, segment, output))) return R0;
  return tierSlope(plan, segment, output);
}

function interiorSample(from: Rat | null, to: Rat | null): Rat {
  if (from === null && to === null) return R0;
  if (from === null && to !== null) return to.sub(Rat.one());
  if (from !== null && to === null) return from.add(Rat.one());
  if (from !== null && to !== null) return from.add(to).div(Rat.from(2));
  return R0;
}

function sortUniqueRats(values: readonly Rat[]): Rat[] {
  return [...values]
    .sort((left, right) => left.cmp(right))
    .filter((value, index, all) => index === 0 || !value.eq(all[index - 1] ?? value));
}

/** Builds exact α+βq pieces over (−∞, b₀], (b₀, b₁], …, (bₙ, ∞] from a value/slope oracle. */
export function buildLinearPieces(
  breakpoints: readonly Rat[],
  valueAt: (q: Rat) => Rat,
  slopeAt: (q: Rat) => Rat,
): LinearPiece[] {
  const sorted = sortUniqueRats(breakpoints);
  const bounds: (Rat | null)[] = [null, ...sorted, null];
  const pieces: LinearPiece[] = [];
  for (let index = 0; index < bounds.length - 1; index += 1) {
    const from = bounds[index] ?? null;
    const to = bounds[index + 1] ?? null;
    const probe = interiorSample(from, to);
    const slope = slopeAt(probe);
    const alpha = valueAt(probe).sub(slope.mul(probe));
    pieces.push({ from, to, slope, alpha });
  }
  return pieces;
}

function structuralCommissionBreaks(plan: Plan, segment: Segment): Rat[] {
  const quota = segmentQuota(plan, segment);
  const breaks = plan.tiers.slice(1).map((tier) => quota.mul(tier.from));
  const cap = capOutput(plan, segment);
  if (cap) breaks.push(cap);
  return breaks;
}

/** Exact pieces of the raw tier commission C(q). */
export function commissionPieces(plan: Plan, segment: Segment): LinearPiece[] {
  return buildLinearPieces(
    structuralCommissionBreaks(plan, segment),
    (q) => rawCommission(plan, segment, q),
    (q) => tierSlope(plan, segment, q),
  );
}

/** Exact q where C(q) = D_nr (draw plateau boundary), or null if C never reaches it. */
function drawCrossing(plan: Plan, segment: Segment): Rat | null {
  const draw = extrasOf(plan)?.drawNonRecoverable ?? null;
  if (!draw) return null;
  for (const piece of commissionPieces(plan, segment)) {
    if (piece.slope.lte(R0)) continue;
    const start = piece.from ? piece.alpha.add(piece.slope.mul(piece.from)) : null;
    const end = piece.to ? piece.alpha.add(piece.slope.mul(piece.to)) : null;
    const belowStart = start === null || start.lt(draw);
    const atOrAboveEnd = end === null || end.gte(draw);
    if (belowStart && atOrAboveEnd) {
      const crossing = draw.sub(piece.alpha).div(piece.slope);
      return crossing;
    }
  }
  return null;
}

function prefloorBreaks(plan: Plan, segment: Segment): Rat[] {
  const breaks = structuralCommissionBreaks(plan, segment);
  const quota = segmentQuota(plan, segment);
  if (plan.bonus) breaks.push(quota.mul(plan.bonus.x_b));
  const spiffAt = spiffThreshold(plan, segment);
  if (spiffAt) breaks.push(spiffAt);
  const clawAt = clawbackThreshold(plan, segment);
  if (clawAt) breaks.push(clawAt);
  const crossing = drawCrossing(plan, segment);
  if (crossing) breaks.push(crossing);
  return breaks;
}

/** Exact pieces of the pre-floor payout W_pre(q) (jumps captured as α-shifts). */
export function prefloorPieces(plan: Plan, segment: Segment): LinearPiece[] {
  return buildLinearPieces(
    prefloorBreaks(plan, segment),
    (q) => prefloorAt(plan, segment, q),
    (q) => prefloorSlope(plan, segment, q),
  );
}

/** Exact interior q where W_pre(q) = F on a sloped piece, or null (jump crossings need no kink). */
function floorCrossing(plan: Plan, segment: Segment): Rat | null {
  const floor = extrasOf(plan)?.payFloor ?? null;
  if (!floor) return null;
  for (const piece of prefloorPieces(plan, segment)) {
    if (piece.slope.lte(R0)) continue;
    const start = piece.from ? piece.alpha.add(piece.slope.mul(piece.from)) : null;
    const end = piece.to ? piece.alpha.add(piece.slope.mul(piece.to)) : null;
    const belowStart = start === null || start.lt(floor);
    const atOrAboveEnd = end === null || end.gte(floor);
    if (belowStart && atOrAboveEnd) {
      return floor.sub(piece.alpha).div(piece.slope);
    }
  }
  return null;
}

/** Sorted, deduplicated output kinks used by exact candidate + stochastic piece construction. */
export function kinks(plan: Plan, segment: Segment): Rat[] {
  const quota = segmentQuota(plan, segment);
  const values: Rat[] = [
    ...plan.tiers.slice(1).map((tier) => quota.mul(tier.from)),
    ...(plan.bonus ? [quota.mul(plan.bonus.x_b)] : []),
    ...(plan.cap ? [quota.mul(plan.cap)] : []),
  ];
  const spiffAt = spiffThreshold(plan, segment);
  if (spiffAt) values.push(spiffAt);
  const clawAt = clawbackThreshold(plan, segment);
  if (clawAt) values.push(clawAt);
  const crossing = drawCrossing(plan, segment);
  if (crossing) values.push(crossing);
  const floor = floorCrossing(plan, segment);
  if (floor) values.push(floor);
  return sortUniqueRats(values);
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
  return candidates.length
    ? candidates.reduce((smallest, candidate) => smallest.min(candidate))
    : null;
}

export function assertDecomposition(plan: Plan, segment: Segment, output: Rat): void {
  const result = decompose(plan, segment, output);
  const reconstructed = result.perTier
    .reduce((sum, value) => sum.add(value), result.base)
    .add(result.bonus)
    .add(result.spiff)
    .sub(result.clawback)
    .add(result.drawTopUp)
    .add(result.floorTopUp);
  if (!reconstructed.eq(result.total)) {
    throw new EngineError("INTERNAL_INVARIANT", "Payout decomposition does not conserve payout.");
  }
}
