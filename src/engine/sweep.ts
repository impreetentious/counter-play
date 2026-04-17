import { EngineError } from "./errors";
import { lintScenario } from "./linter";
import { KPI_KEYS, type KpiKey } from "./mc";
import { attainment as planAttainment, payout, segmentQuota } from "./plan";
import { Rat, R0 } from "./rat";
import { simulateDeterministic, type DeterministicPlanResult } from "./simulate";
import { respondDeterministic } from "./respond.det";
import { engineVersion } from "./version";
import type { Mode, Plan, Scenario, Segment } from "./types";

/**
 * Plan-space sweep. Where §3.11 sweeps the *assumptions*, this sweeps the *plan*: one plan
 * scalar over a stated range, every KPI as a curve, and the exact parameter values where a
 * segment's best play jumps from one branch of the payout function to another.
 *
 * It is deliberately not a plan optimiser (§2.5 defers that, and §3.15's V-06 is the only
 * search this product ships): there is no argmax, no ranking, and no suggested plan — the
 * reader draws the conclusion from the curve. Like V-06 it evaluates the exact deterministic
 * response even from a CARA scenario, so no new float crossing enters §3.7.
 */

export type SweepAxisKind = "base" | "bonusAmount" | "bonusThreshold" | "cap" | "tierRate";

export interface SweepAxis {
  kind: SweepAxisKind;
  /** Required by `tierRate`; ignored otherwise. */
  tierIndex?: number;
  lo: Rat;
  hi: Rat;
  /** Grid intervals — the sweep evaluates `steps + 1` points, endpoints included. */
  steps: number;
}

export const SWEEP_MIN_STEPS = 4;
export const SWEEP_MAX_STEPS = 200;
export const SWEEP_GRID_MIN_STEPS = 4;
export const SWEEP_GRID_MAX_STEPS = 40;

export type SweepKpiKey = KpiKey | "profit";

/** §3.5 KPIs plus the principal's declared objective (`trueValue − totalComp`). */
export const SWEEP_KPI_KEYS: readonly SweepKpiKey[] = [...KPI_KEYS, "profit"];

export type SweepKpis = Record<SweepKpiKey, Rat | null>;

/**
 * Which structural feature of the payout function the segment's best play is sitting on.
 * Two adjacent grid points sharing a branch moved along one continuous piece; a change of
 * branch is a regime change, and `SweepCrossing` locates it exactly.
 */
export interface SweepPlay {
  segmentId: string;
  effort: Rat;
  output: Rat;
  attainment: Rat;
  branch: string;
}

export interface SweepCrossing {
  segmentId: string;
  /** The exact parameter value at which the play changes; null when it could not be located. */
  at: Rat | null;
  /** The grid interval containing the change — always present, even when `at` is null. */
  bracket: readonly [Rat, Rat];
  fromBranch: string;
  toBranch: string;
  fromOutput: Rat;
  toOutput: Rat;
}

export interface SweepPoint {
  value: Rat;
  /** Non-null when the plan this grid point would describe is not a legal plan (§3.0). */
  infeasible: string | null;
  kpis: SweepKpis | null;
  plays: SweepPlay[];
  /** Count of `high`-severity linter findings at this grid point; null when infeasible. */
  highFindings: number | null;
}

export interface SweepStamp {
  engineVersion: string;
  /** The scenario's own mode, recorded even though the sweep always runs the exact path. */
  mode: Mode;
}

export interface SweepResult {
  planId: string;
  planLabel: string;
  axis: SweepAxis;
  points: SweepPoint[];
  crossings: SweepCrossing[];
  stamp: SweepStamp;
  /** Always true: the sweep runs §3.3 exactly, as §3.15's local search does. */
  usesExactDeterministicResponse: true;
  /** True when the workspace is in CARA mode and the sweep derived a deterministic scenario. */
  derivedFromStochastic: boolean;
}

export interface SweepGridCell {
  x: Rat;
  y: Rat;
  infeasible: string | null;
  kpis: SweepKpis | null;
  /** The population's joint play — cells sharing a signature are one regime. */
  signature: string | null;
}

export interface SweepGridResult {
  planId: string;
  planLabel: string;
  axisX: SweepAxis;
  axisY: SweepAxis;
  /** Row-major: `cells[yIndex][xIndex]`. */
  cells: SweepGridCell[][];
  stamp: SweepStamp;
  usesExactDeterministicResponse: true;
  derivedFromStochastic: boolean;
}

export interface SweepRun<T> {
  readonly completed: number;
  readonly total: number;
  step(count: number): boolean;
  result(): T;
}

const HALF = Rat.from(1, 2);
const MAX_BISECTIONS = 40;

const AXIS_LABELS: Record<SweepAxisKind, string> = {
  base: "Base salary (B)",
  bonusAmount: "Quota bonus (L)",
  bonusThreshold: "Bonus threshold (x_b)",
  cap: "Cap (x_cap)",
  tierRate: "Tier rate",
};

export function sweepAxisLabel(axis: SweepAxis, plan?: Plan): string {
  if (axis.kind !== "tierRate") return AXIS_LABELS[axis.kind];
  const index = axis.tierIndex ?? 0;
  const tier = plan?.tiers[index];
  const from = tier ? ` (from ${tier.from.toDecimalString()})` : "";
  return `Tier ${index + 1} rate${from}`;
}

/** Which axes this plan can express. Sweeping a bonus a plan does not have is not a curve. */
export function availableAxes(plan: Plan): SweepAxis[] {
  const axes: SweepAxis[] = [
    { kind: "base", lo: R0, hi: plan.base.mul(Rat.from(2)).max(Rat.from(1)), steps: 40 },
  ];
  plan.tiers.forEach((tier, index) => {
    axes.push({
      kind: "tierRate",
      tierIndex: index,
      lo: R0,
      hi: tier.rate.mul(Rat.from(2)).max(Rat.from(1, 10)),
      steps: 40,
    });
  });
  if (plan.bonus) {
    axes.push({
      kind: "bonusAmount",
      lo: R0,
      hi: plan.bonus.L.mul(Rat.from(2)).max(Rat.from(1)),
      steps: 40,
    });
    axes.push({
      kind: "bonusThreshold",
      lo: plan.bonus.x_b.mul(HALF).max(Rat.from(1, 100)),
      hi: plan.bonus.x_b.mul(Rat.from(2)),
      steps: 40,
    });
  }
  axes.push({
    kind: "cap",
    lo: lastTierFrom(plan).max(Rat.from(1, 100)),
    hi: (plan.cap ?? Rat.from(2)).mul(Rat.from(2)),
    steps: 40,
  });
  return axes;
}

function lastTierFrom(plan: Plan): Rat {
  return plan.tiers.reduce((max, tier) => tier.from.max(max), R0);
}

function clonePlan(plan: Plan): Plan {
  return {
    ...plan,
    tiers: plan.tiers.map((tier) => ({ ...tier })),
    bonus: plan.bonus ? { ...plan.bonus } : null,
    extras: plan.extras
      ? {
          ...plan.extras,
          spiff: plan.extras.spiff ? { ...plan.extras.spiff } : null,
          clawback: plan.extras.clawback ? { ...plan.extras.clawback } : null,
        }
      : null,
  };
}

const MONEY_CEILING = Rat.fromDecimalString("1e12");
const RATE_CEILING = Rat.from(10);
const ATTAINMENT_CEILING = Rat.from(1000);

/**
 * Writes one axis value into a copy of the plan, or reports why that value is not a legal
 * plan under §3.0's bounds. Infeasible points render as gaps in the curve with their reason
 * stated — never as a silently dropped sample.
 */
export function applyAxisValue(
  plan: Plan,
  axis: SweepAxis,
  value: Rat,
): { plan: Plan } | { infeasible: string } {
  switch (axis.kind) {
    case "base": {
      if (value.lt(R0) || value.gt(MONEY_CEILING))
        return { infeasible: "Base is outside the permitted [0, 1e12] range." };
      return { plan: { ...clonePlan(plan), base: value } };
    }
    case "tierRate": {
      const index = axis.tierIndex ?? -1;
      const tier = plan.tiers[index];
      if (!tier) return { infeasible: "This plan has no tier at that index." };
      if (value.lt(R0) || value.gt(RATE_CEILING))
        return { infeasible: "Rate is outside the permitted [0, 10] range." };
      const next = clonePlan(plan);
      next.tiers = next.tiers.map((entry, entryIndex) =>
        entryIndex === index ? { ...entry, rate: value } : entry,
      );
      return { plan: next };
    }
    case "bonusAmount": {
      if (!plan.bonus) return { infeasible: "This plan has no quota bonus." };
      if (value.lt(R0) || value.gt(MONEY_CEILING))
        return { infeasible: "Bonus is outside the permitted [0, 1e12] range." };
      const next = clonePlan(plan);
      next.bonus = { L: value, x_b: plan.bonus.x_b };
      return { plan: next };
    }
    case "bonusThreshold": {
      if (!plan.bonus) return { infeasible: "This plan has no quota bonus." };
      if (value.lte(R0) || value.gt(ATTAINMENT_CEILING))
        return { infeasible: "Bonus threshold must lie in (0, 1000]." };
      const next = clonePlan(plan);
      next.bonus = { L: plan.bonus.L, x_b: value };
      return { plan: next };
    }
    case "cap": {
      if (value.lte(R0) || value.gt(ATTAINMENT_CEILING))
        return { infeasible: "Cap must lie in (0, 1000]." };
      const floor = lastTierFrom(plan);
      if (value.lt(floor))
        return {
          infeasible: `Cap must sit in the last tier (at or above ${floor.toDecimalString()}).`,
        };
      return { plan: { ...clonePlan(plan), cap: value } };
    }
  }
}

/**
 * The sweep evaluates the exact deterministic response, exactly as §3.15's local search does,
 * so a CARA workspace still gets a reproducible curve rather than an unpinned float protocol.
 * The rationality dial is kept — it describes how the population chooses, not what the plan
 * pays — and branch analysis reads the modal component, per §3.3a's rule for L-1/L-3.
 */
function deterministicScenario(scenario: Scenario, plan: Plan): Scenario {
  return { ...scenario, plans: [plan], settings: { ...scenario.settings, mode: "deterministic" } };
}

function kpisOf(row: DeterministicPlanResult): SweepKpis {
  return {
    expectedRevenue: row.kpis.expectedRevenue,
    totalComp: row.kpis.totalComp,
    compRatio: row.kpis.compRatio,
    quotaAttainRate: row.kpis.quotaAttainRate,
    effectiveCommissionRate: row.kpis.effectiveCommissionRate,
    trueValue: row.kpis.trueValue,
    profit: row.kpis.trueValue.sub(row.kpis.totalComp),
  };
}

/**
 * Names the structural feature the best play sits on. Every test is exact rational equality
 * against a landmark the plan itself defines, so the label is a fact about the optimum rather
 * than a tolerance-dependent guess.
 */
export function playBranch(plan: Plan, segment: Segment, output: Rat): string {
  if (output.eq(R0)) return "no effort";
  const quota = segmentQuota(plan, segment);
  if (plan.bonus && output.eq(quota.mul(plan.bonus.x_b))) return "bonus threshold";
  if (plan.cap && output.eq(quota.mul(plan.cap))) return "cap";
  const spiff = plan.extras?.spiff;
  if (spiff && output.eq(quota.mul(spiff.threshold))) return "SPIFF threshold";
  const clawback = plan.extras?.clawback;
  if (clawback && output.eq(quota.mul(clawback.threshold))) return "clawback threshold";
  for (let index = plan.tiers.length - 1; index >= 1; index -= 1) {
    const tier = plan.tiers[index];
    if (tier && output.eq(quota.mul(tier.from))) return `tier ${index + 1} edge`;
  }
  let active = 0;
  for (let index = 0; index < plan.tiers.length; index += 1) {
    const tier = plan.tiers[index];
    if (tier && output.gte(quota.mul(tier.from))) active = index;
  }
  return `tier ${active + 1} interior`;
}

function playsOf(scenario: Scenario, plan: Plan): SweepPlay[] {
  return scenario.population.map((segment) => {
    const response = respondDeterministic(plan, segment, scenario.settings.rationality);
    const output = response.modal.output;
    return {
      segmentId: segment.id,
      effort: response.modal.effort,
      output,
      attainment: planAttainment(plan, segment, output),
      branch: playBranch(plan, segment, output),
    };
  });
}

function evaluatePoint(scenario: Scenario, plan: Plan, value: Rat, axis: SweepAxis): SweepPoint {
  const applied = applyAxisValue(plan, axis, value);
  if ("infeasible" in applied)
    return {
      value,
      infeasible: applied.infeasible,
      kpis: null,
      plays: [],
      highFindings: null,
    };
  const derived = deterministicScenario(scenario, applied.plan);
  const row = simulateDeterministic(derived).plans[0];
  if (!row) throw new EngineError("INTERNAL_INVARIANT", "A sweep point produced no plan result.");
  return {
    value,
    infeasible: null,
    kpis: kpisOf(row),
    plays: playsOf(derived, applied.plan),
    highFindings: lintScenario(derived).filter((finding) => finding.severity === "high").length,
  };
}

function gridValue(axis: SweepAxis, index: number): Rat {
  return axis.lo.add(axis.hi.sub(axis.lo).mul(Rat.from(index, axis.steps)));
}

function validateAxis(axis: SweepAxis, maxSteps: number): void {
  if (!Number.isSafeInteger(axis.steps) || axis.steps < SWEEP_MIN_STEPS || axis.steps > maxSteps)
    throw new EngineError(
      "INVALID_INPUT",
      `A sweep axis needs between ${SWEEP_MIN_STEPS} and ${maxSteps} steps.`,
    );
  if (axis.hi.lte(axis.lo))
    throw new EngineError("INVALID_INPUT", "A sweep axis needs a strictly increasing range.");
  if (axis.kind === "tierRate" && axis.tierIndex === undefined)
    throw new EngineError("INVALID_INPUT", "A tier-rate sweep needs a tier index.");
}

/** `f_θ(e)` at a fixed effort — the objective one specific play earns under one axis value. */
function objectiveAtFixedEffort(
  plan: Plan,
  axis: SweepAxis,
  value: Rat,
  segment: Segment,
  effort: Rat,
): Rat | null {
  const applied = applyAxisValue(plan, axis, value);
  if ("infeasible" in applied) return null;
  const output = segment.ability.mul(effort);
  const cost = segment.costK.mul(effort.mul(effort)).mul(HALF);
  return payout(applied.plan, segment, output).sub(cost);
}

/**
 * `located` — a verified two-play tie at an exact axis value; `continuous` — the plays swapped
 * rank without ever being jointly optimal, so the optimum only drifted and nothing is drawn;
 * `unresolved` — a real branch change whose crossing is not a rational number.
 */
type CrossingSearch =
  | { kind: "located"; at: Rat }
  | { kind: "continuous" }
  | { kind: "unresolved" };

/** `f⋆` — the best objective available at this axis value, in exact and softmax modes alike. */
function bestObjectiveAt(
  scenario: Scenario,
  plan: Plan,
  axis: SweepAxis,
  value: Rat,
  segment: Segment,
): Rat | null {
  const applied = applyAxisValue(plan, axis, value);
  if ("infeasible" in applied) return null;
  const response = respondDeterministic(applied.plan, segment, scenario.settings.rationality);
  return response.ce.add(response.ceGap);
}

/**
 * Locates the exact axis value at which a segment's best play jumps, inside one grid interval.
 *
 * A jump in the argmax is exactly a tie between two *distinct* plays that are both optimal —
 * the cliff economics of §3.9's L-2, seen as a function of the plan rather than of the rep. So
 * the search is for that tie, and the tie is then verified rather than asserted: the located
 * value is fed back through `respondDeterministic`, and both plays must earn precisely the
 * objective the solver says is the best available there.
 *
 * The verification is what keeps the marker honest. An optimum that merely *drifts* off a
 * threshold as a rate rises also produces a ranking flip between two adjacent grid plays, and
 * that flip has a root too — but at that root the two plays tie *below* the true optimum, so
 * the check rejects it and no discontinuity is drawn. Only a genuine two-peaked objective
 * survives.
 *
 * Returns null when no such value could be found in the interval. Where the true crossing is
 * irrational — a bonus threshold abandoned mid-interval, say — no rational value can be
 * verified, and the caller reports the bracket instead of inventing a point inside it.
 */
function locateCrossing(
  scenario: Scenario,
  plan: Plan,
  axis: SweepAxis,
  segment: Segment,
  lo: Rat,
  hi: Rat,
  effortLow: Rat,
  effortHigh: Rat,
): CrossingSearch {
  const difference = (value: Rat): Rat | null => {
    const left = objectiveAtFixedEffort(plan, axis, value, segment, effortLow);
    const right = objectiveAtFixedEffort(plan, axis, value, segment, effortHigh);
    return left && right ? right.sub(left) : null;
  };
  const isVerifiedTie = (value: Rat): boolean => {
    const best = bestObjectiveAt(scenario, plan, axis, value, segment);
    const left = objectiveAtFixedEffort(plan, axis, value, segment, effortLow);
    const right = objectiveAtFixedEffort(plan, axis, value, segment, effortHigh);
    return best !== null && left !== null && right !== null && left.eq(best) && right.eq(best);
  };

  const settle = (value: Rat): CrossingSearch =>
    isVerifiedTie(value) ? { kind: "located", at: value } : { kind: "continuous" };

  let left = lo;
  let right = hi;
  let dLeft = difference(left);
  let dRight = difference(right);
  if (!dLeft || !dRight) return { kind: "unresolved" };
  for (let depth = 0; depth < MAX_BISECTIONS; depth += 1) {
    const span = dRight.sub(dLeft);
    if (!span.eq(R0)) {
      const root = left.add(right.sub(left).mul(dLeft.neg().div(span)));
      if (root.gte(lo) && root.lte(hi)) {
        const atRoot = difference(root);
        if (atRoot && atRoot.eq(R0)) return settle(root);
      }
    }
    const middle = left.add(right).mul(HALF);
    const dMiddle = difference(middle);
    if (!dMiddle) return { kind: "unresolved" };
    if (dMiddle.eq(R0)) return settle(middle);
    if (dLeft.lt(R0) === dMiddle.lt(R0)) {
      left = middle;
      dLeft = dMiddle;
    } else {
      right = middle;
      dRight = dMiddle;
    }
  }
  return { kind: "unresolved" };
}

function crossingsBetween(
  scenario: Scenario,
  plan: Plan,
  axis: SweepAxis,
  previous: SweepPoint,
  current: SweepPoint,
): SweepCrossing[] {
  if (previous.infeasible || current.infeasible) return [];
  const crossings: SweepCrossing[] = [];
  for (const play of current.plays) {
    const before = previous.plays.find((entry) => entry.segmentId === play.segmentId);
    if (!before || before.output.eq(play.output)) continue;
    if (before.branch === play.branch) continue;
    const segment = scenario.population.find((entry) => entry.id === play.segmentId);
    if (!segment) continue;
    const search = locateCrossing(
      scenario,
      plan,
      axis,
      segment,
      previous.value,
      current.value,
      before.effort,
      play.effort,
    );
    if (search.kind === "continuous") continue;
    crossings.push({
      segmentId: play.segmentId,
      at: search.kind === "located" ? search.at : null,
      bracket: [previous.value, current.value],
      fromBranch: before.branch,
      toBranch: play.branch,
      fromOutput: before.output,
      toOutput: play.output,
    });
  }
  return crossings;
}

/** Chunked runner, mirroring §3.11's Monte Carlo runner so the UI can stay responsive. */
export function createSweepRun(
  scenario: Scenario,
  planId: string,
  axis: SweepAxis,
): SweepRun<SweepResult> {
  validateAxis(axis, SWEEP_MAX_STEPS);
  const plan = scenario.plans.find((entry) => entry.id === planId);
  if (!plan) throw new EngineError("INVALID_INPUT", "The swept plan is not in this scenario.");
  const total = axis.steps + 1;
  const points: SweepPoint[] = [];
  let completed = 0;
  let finalResult: SweepResult | null = null;

  const step = (count: number): boolean => {
    if (!Number.isSafeInteger(count) || count < 1)
      throw new EngineError("INVALID_INPUT", "Sweep step count must be a positive integer.");
    if (finalResult) return true;
    const limit = Math.min(total, completed + count);
    while (completed < limit) {
      points.push(evaluatePoint(scenario, plan, gridValue(axis, completed), axis));
      completed += 1;
    }
    return completed === total;
  };

  const result = (): SweepResult => {
    if (completed !== total)
      throw new EngineError("INTERNAL_INVARIANT", "Sweep result requested before it completed.");
    if (!finalResult) {
      const crossings: SweepCrossing[] = [];
      for (let index = 1; index < points.length; index += 1) {
        const previous = points[index - 1];
        const current = points[index];
        if (!previous || !current) continue;
        crossings.push(...crossingsBetween(scenario, plan, axis, previous, current));
      }
      finalResult = {
        planId: plan.id,
        planLabel: plan.label,
        axis,
        points,
        crossings,
        stamp: { engineVersion, mode: scenario.settings.mode },
        usesExactDeterministicResponse: true,
        derivedFromStochastic: scenario.settings.mode === "stochastic",
      };
    }
    return finalResult;
  };

  return {
    get completed() {
      return completed;
    },
    get total() {
      return total;
    },
    step,
    result,
  };
}

export function sweepPlan(scenario: Scenario, planId: string, axis: SweepAxis): SweepResult {
  const run = createSweepRun(scenario, planId, axis);
  while (!run.step(16)) {
    // The chunked runner owns the loop; this wrapper deliberately performs no yielding.
  }
  return run.result();
}

function applyBothAxes(
  plan: Plan,
  axisX: SweepAxis,
  x: Rat,
  axisY: SweepAxis,
  y: Rat,
): { plan: Plan } | { infeasible: string } {
  const first = applyAxisValue(plan, axisX, x);
  if ("infeasible" in first) return first;
  return applyAxisValue(first.plan, axisY, y);
}

/**
 * The 2-D companion, for the pairs that genuinely interact — bonus size against its threshold,
 * top rate against the cap. Every cell carries the population's joint play signature, so the
 * heatmap can draw the regime boundaries the KPI surface folds away.
 */
export function createSweepGridRun(
  scenario: Scenario,
  planId: string,
  axisX: SweepAxis,
  axisY: SweepAxis,
): SweepRun<SweepGridResult> {
  validateAxis(axisX, SWEEP_GRID_MAX_STEPS);
  validateAxis(axisY, SWEEP_GRID_MAX_STEPS);
  const plan = scenario.plans.find((entry) => entry.id === planId);
  if (!plan) throw new EngineError("INVALID_INPUT", "The swept plan is not in this scenario.");
  const columns = axisX.steps + 1;
  const rows = axisY.steps + 1;
  const total = columns * rows;
  const cells: SweepGridCell[][] = Array.from({ length: rows }, () => []);
  let completed = 0;
  let finalResult: SweepGridResult | null = null;

  const evaluateCell = (index: number): void => {
    const rowIndex = Math.floor(index / columns);
    const columnIndex = index % columns;
    const x = gridValue(axisX, columnIndex);
    const y = gridValue(axisY, rowIndex);
    const applied = applyBothAxes(plan, axisX, x, axisY, y);
    if ("infeasible" in applied) {
      cells[rowIndex]?.push({ x, y, infeasible: applied.infeasible, kpis: null, signature: null });
      return;
    }
    const derived = deterministicScenario(scenario, applied.plan);
    const row = simulateDeterministic(derived).plans[0];
    if (!row) throw new EngineError("INTERNAL_INVARIANT", "A sweep cell produced no plan result.");
    const signature = playsOf(derived, applied.plan)
      .map((play) => `${play.segmentId}:${play.branch}`)
      .join(" · ");
    cells[rowIndex]?.push({ x, y, infeasible: null, kpis: kpisOf(row), signature });
  };

  const step = (count: number): boolean => {
    if (!Number.isSafeInteger(count) || count < 1)
      throw new EngineError("INVALID_INPUT", "Sweep step count must be a positive integer.");
    if (finalResult) return true;
    const limit = Math.min(total, completed + count);
    while (completed < limit) {
      evaluateCell(completed);
      completed += 1;
    }
    return completed === total;
  };

  const result = (): SweepGridResult => {
    if (completed !== total)
      throw new EngineError("INTERNAL_INVARIANT", "Sweep result requested before it completed.");
    if (!finalResult) {
      finalResult = {
        planId: plan.id,
        planLabel: plan.label,
        axisX,
        axisY,
        cells,
        stamp: { engineVersion, mode: scenario.settings.mode },
        usesExactDeterministicResponse: true,
        derivedFromStochastic: scenario.settings.mode === "stochastic",
      };
    }
    return finalResult;
  };

  return {
    get completed() {
      return completed;
    },
    get total() {
      return total;
    },
    step,
    result,
  };
}

export function sweepGrid(
  scenario: Scenario,
  planId: string,
  axisX: SweepAxis,
  axisY: SweepAxis,
): SweepGridResult {
  const run = createSweepGridRun(scenario, planId, axisX, axisY);
  while (!run.step(32)) {
    // The chunked runner owns the loop; this wrapper deliberately performs no yielding.
  }
  return run.result();
}
