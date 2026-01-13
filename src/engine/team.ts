import { EngineError } from "./errors";
import { effectiveSegment } from "./multitask";
import { normalCdf, normalPdf, truncatedNormalMoments } from "./normal";
import { kinks, payout } from "./plan";
import { payoutPieces, respondCARA, stochasticCeiling } from "./respond.cara";
import { deterministicCandidates, respondDeterministic } from "./respond.det";
import { Rat, R0 } from "./rat";
import type { Plan, Scenario, Segment, TeamSettings } from "./types";

/**
 * §3.14 team credit and rank-order tournaments — the one place in the engine where agents play
 * against each other rather than against a plan. Split credit is exact; the tournament path is
 * float (it needs Φ and φ). Neither rewrites the §3.5 KPIs: the equilibrium is reported beside
 * the independent best response, never silently substituted for it.
 */

/** §3.14 own-output credit weight `φ = 1 − s(n−1)/n` — the whole 1/n free-riding problem. */
export function creditWeight(size: number, creditShare: Rat): Rat {
  return Rat.one().sub(creditShare.mul(Rat.from(size - 1, size)));
}

function payoffAt(plan: Plan, solving: Segment, phi: Rat, others: Rat, own: Rat): Rat {
  const credited = phi
    .mul(solving.ability)
    .mul(own)
    .add(Rat.one().sub(phi).mul(solving.ability).mul(others));
  const cost = solving.costK.mul(own).mul(own).div(Rat.from(2));
  return payout(plan, solving, credited).sub(cost);
}

/** Exact best response to a symmetric profile at `others`, with §3.0's lower-effort tie-break. */
function bestResponse(plan: Plan, solving: Segment, phi: Rat, others: Rat): Rat {
  const scale = phi.mul(solving.ability);
  const offset = Rat.one().sub(phi).mul(solving.ability).mul(others);
  const candidates: Rat[] = [R0, others];
  for (const tier of plan.tiers) {
    candidates.push(tier.rate.mul(phi).mul(solving.ability).div(solving.costK));
  }
  for (const kink of kinks(plan, solving)) {
    candidates.push(kink.sub(offset).div(scale));
  }
  let best = R0;
  let bestValue = payoffAt(plan, solving, phi, others, best);
  for (const candidate of candidates) {
    if (candidate.lt(R0)) continue;
    const value = payoffAt(plan, solving, phi, others, candidate);
    if (value.gt(bestValue) || (value.eq(bestValue) && candidate.lt(best))) {
      best = candidate;
      bestValue = value;
    }
  }
  return best;
}

export interface SplitEquilibrium {
  effort: Rat;
  output: Rat;
  payout: Rat;
  ce: Rat;
}

export interface SplitEquilibriumSet {
  creditWeight: Rat;
  /** Every symmetric equilibrium found, ascending in effort. */
  equilibria: SplitEquilibrium[];
  /** Pareto-best for the agents; ties resolve to smaller effort (§3.14 selection rule). */
  selected: SplitEquilibrium;
}

/**
 * §3.14 symmetric split-credit equilibria. At a symmetric profile credited revenue equals own
 * output, so the candidate set is §3.3's with the tier FOCs scaled by `φ` — every candidate stays
 * rational, and each is confirmed by its own exact best-response check.
 */
export function symmetricSplitEquilibria(
  plan: Plan,
  segment: Segment,
  size: number,
  creditShare: Rat,
): SplitEquilibriumSet {
  const solving = effectiveSegment(segment);
  const phi = creditWeight(size, creditShare);
  const candidates: Rat[] = [...deterministicCandidates(plan, solving)];
  for (const tier of plan.tiers) {
    candidates.push(tier.rate.mul(phi).mul(solving.ability).div(solving.costK));
  }
  const seen: Rat[] = [];
  const equilibria: SplitEquilibrium[] = [];
  for (const candidate of candidates
    .filter((value) => value.gte(R0))
    .sort((left, right) => left.cmp(right))) {
    if (seen.some((value) => value.eq(candidate))) continue;
    seen.push(candidate);
    if (!bestResponse(plan, solving, phi, candidate).eq(candidate)) continue;
    const output = solving.ability.mul(candidate);
    const paid = payout(plan, solving, output);
    equilibria.push({
      effort: candidate,
      output,
      payout: paid,
      ce: paid.sub(solving.costK.mul(candidate).mul(candidate).div(Rat.from(2))),
    });
  }
  if (equilibria.length === 0) {
    throw new EngineError("INTERNAL_INVARIANT", "No symmetric split-credit equilibrium was found.");
  }
  const selected = equilibria.reduce((best, entry) => (entry.ce.gt(best.ce) ? entry : best));
  return { creditWeight: phi, equilibria, selected };
}

const QUADRATURE_INTERVALS = 16_384;
const QUADRATURE_HALF_WIDTH = 12;

function simpson(integrand: (u: number) => number, halfWidth: number, intervals: number): number {
  const step = (2 * halfWidth) / intervals;
  let total = integrand(-halfWidth) + integrand(halfWidth);
  for (let index = 1; index < intervals; index += 1) {
    total += integrand(-halfWidth + index * step) * (index % 2 === 0 ? 2 : 4);
  }
  return (total * step) / 3;
}

function binomial(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  let value = 1;
  for (let index = 0; index < k; index += 1) value = (value * (n - index)) / (index + 1);
  return value;
}

/**
 * §3.14 `C_{n,w}` on the standard normal; `κ(n, w, σ) = C_{n,w}/σ` exactly. Pinned quadrature —
 * the contract's closed forms (`C_{2,1} = C_{3,1} = 1/(2√π)`) are what this must reproduce.
 */
export function standardWinDensity(size: number, winners: number): number {
  const integral = simpson(
    (u) => {
      const cdf = normalCdf(u);
      return normalPdf(u) ** 2 * (1 - cdf) ** (winners - 1) * cdf ** (size - 1 - winners);
    },
    QUADRATURE_HALF_WIDTH,
    QUADRATURE_INTERVALS,
  );
  return (size - 1) * binomial(size - 2, winners - 1) * integral;
}

const RIVAL_INTERVALS = 4096;
const RIVAL_HALF_WIDTH = 40;
const rivalCache = new Map<string, { nodes: number[]; weights: number[] }>();

/**
 * Simpson weights times `Ψ(y) = P(the w-th best rival scores below y)`, cached per `(n, w)`.
 * Writing the win integral as `∫ φ(y − δ)·Ψ(y) dy` puts the whole `δ` dependence on the Gaussian,
 * so a best-response search costs one `exp` per node instead of one `Φ` per node.
 */
function rivalGrid(size: number, winners: number): { nodes: number[]; weights: number[] } {
  const key = `${size}:${winners}`;
  const cached = rivalCache.get(key);
  if (cached) return cached;
  const step = (2 * RIVAL_HALF_WIDTH) / RIVAL_INTERVALS;
  const nodes: number[] = [];
  const weights: number[] = [];
  for (let index = 0; index <= RIVAL_INTERVALS; index += 1) {
    const node = -RIVAL_HALF_WIDTH + index * step;
    const cdf = normalCdf(node);
    let below = 0;
    for (let losses = 0; losses < winners; losses += 1) {
      below += binomial(size - 1, losses) * (1 - cdf) ** losses * cdf ** (size - 1 - losses);
    }
    const simpsonWeight = index === 0 || index === RIVAL_INTERVALS ? 1 : index % 2 === 0 ? 2 : 4;
    nodes.push(node);
    weights.push((simpsonWeight * step * below) / 3);
  }
  const grid = { nodes, weights };
  rivalCache.set(key, grid);
  return grid;
}

/** P(top `w` of `n`) for a rep whose score sits `delta` standard deviations above the field. */
export function winProbability(delta: number, size: number, winners: number): number {
  if (delta > RIVAL_HALF_WIDTH - 10) return 1;
  if (delta < -(RIVAL_HALF_WIDTH - 10)) return 0;
  const grid = rivalGrid(size, winners);
  let total = 0;
  for (let index = 0; index < grid.nodes.length; index += 1) {
    total += (grid.weights[index] ?? 0) * normalPdf((grid.nodes[index] ?? 0) - delta);
  }
  return total;
}

function expectedPayout(plan: Plan, solving: Segment, mean: number, sigma: number): number {
  return payoutPieces(plan, solving).reduce((total, piece) => {
    const moments = truncatedNormalMoments(mean, sigma, piece.lower, piece.upper);
    return total + piece.alpha * moments.probability + piece.beta * moments.first;
  }, 0);
}

export interface TournamentEquilibrium {
  effort: number;
  output: number;
  payout: number;
  winProbability: number;
  /** Marginal win density at the symmetric point, `κ = C_{n,w}/σ`. */
  winDensity: number;
  converged: boolean;
}

/**
 * §3.14 symmetric tournament equilibrium by best-response iteration with damping 1/2. The
 * objective is risk-neutral by contract: a prize lottery under CARA is a different integral.
 */
export function tournamentEquilibrium(
  plan: Plan,
  segment: Segment,
  size: number,
  winners: number,
  prize: Rat,
): TournamentEquilibrium | null {
  const solving = effectiveSegment(segment);
  const sigma = solving.noiseSD.toNumber();
  if (sigma <= 0) return null;
  const ability = solving.ability.toNumber();
  const costK = solving.costK.toNumber();
  const prizeValue = prize.toNumber();
  // The prize is a bounded lump like `L`, so §3.4's sufficiency argument covers it once it is
  // folded into the bonus slot; the extra kink can only raise the ceiling, never lower it.
  const padded: Plan = {
    ...plan,
    bonus: { L: (plan.bonus?.L ?? R0).add(prize), x_b: plan.bonus?.x_b ?? Rat.one() },
  };
  const eMax = stochasticCeiling(padded, solving);
  const seeds = new Set<number>([0, eMax]);
  for (let index = 0; index < 128; index += 1) seeds.add((eMax * index) / 127);
  for (const candidate of deterministicCandidates(plan, solving)) {
    const value = candidate.toNumber();
    if (value >= 0 && value <= eMax) seeds.add(value);
  }
  const grid = [...seeds].sort((left, right) => left - right);

  const objective = (own: number, others: number): number =>
    expectedPayout(plan, solving, ability * own, sigma) +
    prizeValue * winProbability((ability * (own - others)) / sigma, size, winners) -
    (costK * own * own) / 2;

  const respond = (others: number): number => {
    let best = 0;
    let bestValue = objective(0, others);
    for (const point of grid) {
      const value = objective(point, others);
      if (value > bestValue) {
        best = point;
        bestValue = value;
      }
    }
    // Golden-section refinement inside the winning bracket (§3.4's procedure).
    const index = grid.indexOf(best);
    let lower = grid[Math.max(0, index - 1)] ?? 0;
    let upper = grid[Math.min(grid.length - 1, index + 1)] ?? eMax;
    const ratio = (Math.sqrt(5) - 1) / 2;
    for (let step = 0; step < 60 && upper - lower > 1e-12 * Math.max(1, eMax); step += 1) {
      const left = upper - ratio * (upper - lower);
      const right = lower + ratio * (upper - lower);
      if (objective(left, others) >= objective(right, others)) upper = right;
      else lower = left;
    }
    const refined = (lower + upper) / 2;
    return objective(refined, others) > bestValue ? refined : best;
  };

  // §3.14 protocol: undamped best-response iteration first (a linear plan settles in one step),
  // damped 1/2 afterwards so a kinked plan that would cycle still converges.
  let effort = respondCARA(plan, segment).effort;
  let converged = false;
  for (let iteration = 0; iteration < 80; iteration += 1) {
    const response = respond(effort);
    const movement = Math.abs(response - effort);
    effort = iteration < 40 ? response : (effort + response) / 2;
    // 1e-7 is the precision floor of a derivative-free search on a locally quadratic objective
    // (≈ √eps): value differences below that are float noise, not information about the optimum.
    if (movement <= 1e-7 * Math.max(1, effort)) {
      converged = true;
      break;
    }
  }
  const output = ability * effort;
  return {
    effort,
    output,
    payout: expectedPayout(plan, solving, output, sigma),
    winProbability: winProbability(0, size, winners),
    winDensity: standardWinDensity(size, winners) / sigma,
    converged,
  };
}

export interface TeamSegmentResult {
  segmentId: string;
  segmentLabel: string;
  count: number;
  /** Independent §3.3/§3.4 response, for the side-by-side comparison. */
  individualEffort: number;
  individualRevenue: number;
  equilibriumEffort: number;
  equilibriumRevenue: number;
  equilibriumPayout: number;
  /** `φ` on the split path; null on the tournament path. */
  creditWeight: number | null;
  /** Number of symmetric equilibria found (split path); 1 on the tournament path. */
  equilibriaCount: number;
  converged: boolean;
  /** Set when no equilibrium is defined for this segment — e.g. a tournament at σ = 0. */
  unavailable: string | null;
}

export interface TeamPlanResult {
  planId: string;
  planLabel: string;
  perSegment: TeamSegmentResult[];
  individualRevenue: Rat;
  equilibriumRevenue: Rat;
  revenueGap: Rat;
}

export interface TeamResult {
  mode: TeamSettings["mode"];
  size: number;
  creditShare: Rat | null;
  prize: Rat | null;
  winners: number | null;
  plans: TeamPlanResult[];
}

function teamForSegment(
  plan: Plan,
  segment: Segment,
  team: TeamSettings,
  mode: Scenario["settings"]["mode"],
): TeamSegmentResult {
  const individual =
    mode === "deterministic" ? respondDeterministic(plan, segment) : respondCARA(plan, segment);
  const individualEffort =
    typeof individual.effort === "number" ? individual.effort : individual.effort.toNumber();
  const individualOutput =
    typeof individual.output === "number" ? individual.output : individual.output.toNumber();
  const shared = {
    segmentId: segment.id,
    segmentLabel: segment.label,
    count: segment.count,
    individualEffort,
    individualRevenue: individualOutput,
  };

  if (team.mode === "split") {
    const share = team.split?.creditShare ?? R0;
    const set = symmetricSplitEquilibria(plan, segment, team.size, share);
    return {
      ...shared,
      equilibriumEffort: set.selected.effort.toNumber(),
      equilibriumRevenue: set.selected.output.toNumber(),
      equilibriumPayout: set.selected.payout.toNumber(),
      creditWeight: set.creditWeight.toNumber(),
      equilibriaCount: set.equilibria.length,
      converged: true,
      unavailable: null,
    };
  }

  const tournament = tournamentEquilibrium(
    plan,
    segment,
    team.size,
    team.tournament?.winners ?? 1,
    team.tournament?.prize ?? R0,
  );
  if (!tournament) {
    return {
      ...shared,
      equilibriumEffort: individualEffort,
      equilibriumRevenue: individualOutput,
      equilibriumPayout: 0,
      creditWeight: null,
      equilibriaCount: 0,
      converged: false,
      unavailable:
        "A tournament needs positive noise — at σ = 0 the contest has no equilibrium in pure strategies.",
    };
  }
  return {
    ...shared,
    equilibriumEffort: tournament.effort,
    equilibriumRevenue: tournament.output,
    equilibriumPayout: tournament.payout,
    creditWeight: null,
    equilibriaCount: 1,
    converged: tournament.converged,
    unavailable: null,
  };
}

export function computeTeam(scenario: Scenario): TeamResult | null {
  const team = scenario.settings.team;
  if (!team) return null;
  const plans = scenario.plans.map((plan) => {
    const perSegment = scenario.population.map((segment) =>
      teamForSegment(plan, segment, team, scenario.settings.mode),
    );
    const individualRevenue = perSegment.reduce(
      (total, entry) =>
        total.add(Rat.fromFloat64(entry.individualRevenue).mul(Rat.from(entry.count))),
      R0,
    );
    const equilibriumRevenue = perSegment.reduce(
      (total, entry) =>
        total.add(Rat.fromFloat64(entry.equilibriumRevenue).mul(Rat.from(entry.count))),
      R0,
    );
    return {
      planId: plan.id,
      planLabel: plan.label,
      perSegment,
      individualRevenue,
      equilibriumRevenue,
      revenueGap: individualRevenue.sub(equilibriumRevenue),
    } satisfies TeamPlanResult;
  });
  return {
    mode: team.mode,
    size: team.size,
    creditShare: team.split?.creditShare ?? null,
    prize: team.tournament?.prize ?? null,
    winners: team.tournament?.winners ?? null,
    plans,
  };
}
