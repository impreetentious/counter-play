import { EngineError } from "./errors";
import { Rat, R0 } from "./rat";
import { simulateDeterministic, simulateStochastic } from "./simulate";
import type { Objective, Scenario } from "./types";

/**
 * The principal's ledger — the firm's side of the contract, stated rather than inferred.
 *
 * Every KPI card in this product answers "what will the reps do?". None of them answers "and
 * is that what we wanted?", because until the owner names an objective there is no standard to
 * answer against. This module asks for that standard — expected profit, plus whatever limits
 * the comp committee would actually say out loud — and then reports each plan against it.
 *
 * It is deliberately not an optimiser. Nothing here searches plan space or nominates a winner;
 * it evaluates the plans the owner wrote against the objective the owner declared, and where
 * one plan dominates another on that objective it says so with the arithmetic attached.
 */

export interface LedgerConstraint {
  id: "comp-ratio" | "retention";
  label: string;
  /** The plan's realised value. Null when the KPI is itself undefined (§3.5 zero revenue). */
  actual: Rat | null;
  limit: Rat;
  satisfied: boolean;
}

export interface LedgerRow {
  planId: string;
  planLabel: string;
  expectedRevenue: Rat;
  totalComp: Rat;
  trueValue: Rat;
  /** The declared objective: what the firm keeps after paying for it. */
  profit: Rat;
  compRatio: Rat | null;
  /** Share of headcount whose CE clears its reservation value. */
  retainedShare: Rat;
  /**
   * §3.9's L-5 wedge as a number rather than a verdict: true value minus measured revenue.
   * Negative means the plan buys revenue the business values at less than face.
   */
  wedge: Rat;
  /** The wedge per unit of measured revenue; null when the population produces none. */
  wedgePerRevenue: Rat | null;
  constraints: LedgerConstraint[];
  /** True when every declared constraint holds. Plans with no declared limits are feasible. */
  feasible: boolean;
}

export interface LedgerDominance {
  dominantPlanId: string;
  dominatedPlanId: string;
  /** How much more profit the dominant plan earns. Always strictly positive. */
  profitGap: Rat;
  /** How much less it costs. Zero when it dominates on profit alone. */
  compSaving: Rat;
}

export interface LedgerResult {
  objective: Objective | null;
  rows: LedgerRow[];
  /**
   * Pairs where one plan is at least as good on both axes and strictly better on one — the
   * only ranking this module will make, because it is the only one that needs no weights.
   */
  dominance: LedgerDominance[];
  /** Plan ids on the upper-left frontier of (totalComp, trueValue): cheaper and worth more. */
  frontier: string[];
}

interface PlanFacts {
  planId: string;
  planLabel: string;
  expectedRevenue: Rat;
  totalComp: Rat;
  trueValue: Rat;
  compRatio: Rat | null;
  retainedShare: Rat;
}

function factsFrom(scenario: Scenario): PlanFacts[] {
  const headcount = scenario.population.reduce((sum, segment) => sum + segment.count, 0);
  if (headcount <= 0)
    throw new EngineError("INTERNAL_INVARIANT", "A scenario always carries headcount.");
  const total = Rat.from(headcount);

  if (scenario.settings.mode === "deterministic") {
    return simulateDeterministic(scenario).plans.map((plan) => {
      const atRisk = plan.responses
        .filter((item) => !item.response.participation)
        .reduce((sum, item) => sum + item.count, 0);
      return {
        planId: plan.plan.id,
        planLabel: plan.plan.label,
        expectedRevenue: plan.kpis.expectedRevenue,
        totalComp: plan.kpis.totalComp,
        trueValue: plan.kpis.trueValue,
        compRatio: plan.kpis.compRatio,
        retainedShare: Rat.from(headcount - atRisk).div(total),
      };
    });
  }

  // The stochastic path is float by §3.7; the ledger reads its KPIs through the documented
  // float column rather than inventing a second exact route through the CARA integral.
  return simulateStochastic(scenario).plans.map((plan) => {
    const atRisk = plan.responses
      .filter((item) => !item.response.participation)
      .reduce((sum, item) => sum + item.count, 0);
    return {
      planId: plan.plan.id,
      planLabel: plan.plan.label,
      expectedRevenue: Rat.fromFloat64(plan.kpis.expectedRevenue),
      totalComp: Rat.fromFloat64(plan.kpis.totalComp),
      trueValue: Rat.fromFloat64(plan.kpis.trueValue),
      compRatio: plan.kpis.compRatio === null ? null : Rat.fromFloat64(plan.kpis.compRatio),
      retainedShare: Rat.from(headcount - atRisk).div(total),
    };
  });
}

function constraintsFor(facts: PlanFacts, objective: Objective | null): LedgerConstraint[] {
  if (!objective) return [];
  const constraints: LedgerConstraint[] = [];
  if (objective.compRatioCeiling) {
    constraints.push({
      id: "comp-ratio",
      label: "Comp ratio at or below the declared ceiling",
      actual: facts.compRatio,
      limit: objective.compRatioCeiling,
      // A plan that produces no revenue has no comp ratio to test; it cannot pass a ceiling
      // it never computed, so the constraint is reported as failed rather than waived.
      satisfied: facts.compRatio !== null && facts.compRatio.lte(objective.compRatioCeiling),
    });
  }
  if (objective.retentionFloor) {
    constraints.push({
      id: "retention",
      label: "Retained headcount at or above the declared floor",
      actual: facts.retainedShare,
      limit: objective.retentionFloor,
      satisfied: facts.retainedShare.gte(objective.retentionFloor),
    });
  }
  return constraints;
}

/**
 * Plan A dominates plan B when it earns at least as much profit for no more comp, and beats it
 * on at least one of the two. No weights, no scoring function — only the comparisons that hold
 * whatever the reader's exchange rate between money spent and value created happens to be.
 */
function dominancePairs(rows: readonly LedgerRow[]): LedgerDominance[] {
  const pairs: LedgerDominance[] = [];
  for (const left of rows) {
    for (const right of rows) {
      if (left.planId === right.planId) continue;
      const profitGap = left.profit.sub(right.profit);
      const compSaving = right.totalComp.sub(left.totalComp);
      const noWorse = profitGap.gte(R0) && compSaving.gte(R0);
      const strictlyBetter = profitGap.gt(R0) || compSaving.gt(R0);
      if (noWorse && strictlyBetter)
        pairs.push({
          dominantPlanId: left.planId,
          dominatedPlanId: right.planId,
          profitGap,
          compSaving,
        });
    }
  }
  return pairs;
}

/** Plans no other plan beats on both cost and value: the (totalComp, trueValue) frontier. */
function frontierOf(rows: readonly LedgerRow[]): string[] {
  return rows
    .filter(
      (row) =>
        !rows.some(
          (other) =>
            other.planId !== row.planId &&
            other.totalComp.lte(row.totalComp) &&
            other.trueValue.gte(row.trueValue) &&
            (other.totalComp.lt(row.totalComp) || other.trueValue.gt(row.trueValue)),
        ),
    )
    .map((row) => row.planId);
}

export function computeLedger(scenario: Scenario): LedgerResult {
  const objective = scenario.settings.objective ?? null;
  const rows: LedgerRow[] = factsFrom(scenario).map((facts) => {
    const constraints = constraintsFor(facts, objective);
    return {
      ...facts,
      profit: facts.trueValue.sub(facts.totalComp),
      wedge: facts.trueValue.sub(facts.expectedRevenue),
      wedgePerRevenue: facts.expectedRevenue.eq(R0)
        ? null
        : facts.trueValue.sub(facts.expectedRevenue).div(facts.expectedRevenue),
      constraints,
      feasible: constraints.every((constraint) => constraint.satisfied),
    };
  });
  return {
    objective,
    rows,
    dominance: dominancePairs(rows),
    frontier: frontierOf(rows),
  };
}
