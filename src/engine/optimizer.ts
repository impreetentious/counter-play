import { lintScenario } from "./linter";
import { Rat, R0 } from "./rat";
import { simulateDeterministic, type DeterministicPlanResult } from "./simulate";
import type { Plan, Scenario } from "./types";

/**
 * §3.15 V-06. A deliberately small, deterministic neighbourhood search. It is an aid for
 * comparing nearby rate schedules, not a plan-authoring oracle or a global optimisation claim.
 */
export interface OptimizerSummary {
  trueValue: Rat;
  totalComp: Rat;
  expectedRevenue: Rat;
  retentionRisk: readonly string[];
  highFindings: number;
}

export interface OptimizerSuggestion {
  baseline: OptimizerSummary;
  candidate: OptimizerSummary;
  plan: Plan;
  changedTier: number;
  multiplier: Rat;
  rateChanges: Array<{ tier: number; from: Rat; to: Rat }>;
  rounds: number;
  explored: number;
  /** The search always evaluates an exact deterministic response, even from a CARA scenario. */
  usesExactDeterministicResponse: true;
}

const MULTIPLIERS = [Rat.from(9, 10), Rat.from(19, 20), Rat.from(21, 20), Rat.from(11, 10)] as const;
const MAX_ROUNDS = 4;
const MAX_COMP_MULTIPLE = Rat.from(5, 4);

interface EvaluatedPlan {
  plan: Plan;
  summary: OptimizerSummary;
  tier: number;
  multiplier: Rat;
}

function clonePlanWithRate(plan: Plan, tierIndex: number, multiplier: Rat): Plan {
  return {
    ...plan,
    tiers: plan.tiers.map((tier, index) => index === tierIndex ? { ...tier, rate: tier.rate.mul(multiplier) } : { ...tier }),
    bonus: plan.bonus ? { ...plan.bonus } : null,
    extras: plan.extras ? {
      ...plan.extras,
      spiff: plan.extras.spiff ? { ...plan.extras.spiff } : null,
      clawback: plan.extras.clawback ? { ...plan.extras.clawback } : null,
    } : null,
  };
}

function deterministicScenario(scenario: Scenario, plan: Plan): Scenario {
  // Softmax is intentionally excluded: an optimiser needs an exact, reproducible response
  // protocol rather than a choice-noise fit. Team/horizon modules remain visible to linting.
  const { rationality: _rationality, ...settings } = scenario.settings;
  return { ...scenario, plans: [plan], settings: { ...settings, mode: "deterministic" } };
}

function summaryFor(scenario: Scenario, plan: Plan): OptimizerSummary {
  const derived = deterministicScenario(scenario, plan);
  const result = simulateDeterministic(derived);
  const row: DeterministicPlanResult | undefined = result.plans[0];
  if (!row) throw new Error("Optimizer evaluation returned no plan.");
  const highFindings = lintScenario(derived).filter((finding) => finding.severity === "high").length;
  return {
    trueValue: row.kpis.trueValue,
    totalComp: row.kpis.totalComp,
    expectedRevenue: row.kpis.expectedRevenue,
    retentionRisk: row.kpis.retentionRisk,
    highFindings,
  };
}

function feasible(summary: OptimizerSummary, baselineComp: Rat): boolean {
  return summary.highFindings === 0
    && summary.retentionRisk.length === 0
    && summary.totalComp.lte(baselineComp.mul(MAX_COMP_MULTIPLE));
}

/** Returns positive when left outranks right under §3.15's deterministic score ordering. */
function compareCandidate(left: EvaluatedPlan, right: EvaluatedPlan): number {
  const value = left.summary.trueValue.cmp(right.summary.trueValue);
  if (value !== 0) return value;
  const comp = right.summary.totalComp.cmp(left.summary.totalComp);
  if (comp !== 0) return comp;
  if (left.tier !== right.tier) return right.tier - left.tier;
  return right.multiplier.cmp(left.multiplier);
}

function strictlyImproves(candidate: EvaluatedPlan, current: EvaluatedPlan): boolean {
  return candidate.summary.trueValue.gt(current.summary.trueValue)
    || (candidate.summary.trueValue.eq(current.summary.trueValue) && candidate.summary.totalComp.lt(current.summary.totalComp));
}

/**
 * Search at most four single-rate-move neighbourhoods. `null` means no feasible strict local
 * improvement was found; it does not mean the current plan is globally optimal.
 */
export function optimizePlan(scenario: Scenario, planId: string): OptimizerSuggestion | null {
  const baselinePlan = scenario.plans.find((plan) => plan.id === planId);
  if (!baselinePlan) return null;

  const baseline: EvaluatedPlan = {
    plan: baselinePlan,
    summary: summaryFor(scenario, baselinePlan),
    tier: -1,
    multiplier: Rat.one(),
  };
  let current = baseline;
  let explored = 1;
  let rounds = 0;

  for (let round = 0; round < MAX_ROUNDS; round += 1) {
    const candidates: EvaluatedPlan[] = [];
    for (let tier = 0; tier < current.plan.tiers.length; tier += 1) {
      const rate = current.plan.tiers[tier]?.rate ?? R0;
      if (rate.eq(R0)) continue;
      for (const multiplier of MULTIPLIERS) {
        if (multiplier.eq(Rat.one())) continue;
        const plan = clonePlanWithRate(current.plan, tier, multiplier);
        const summary = summaryFor(scenario, plan);
        explored += 1;
        if (feasible(summary, baseline.summary.totalComp)) candidates.push({ plan, summary, tier, multiplier });
      }
    }
    const winner = candidates.filter((candidate) => strictlyImproves(candidate, current))
      .sort((left, right) => compareCandidate(right, left))[0];
    if (!winner) break;
    current = winner;
    rounds += 1;
  }

  if (current === baseline) return null;
  const rateChanges = current.plan.tiers.flatMap((tier, index) => {
    const from = baseline.plan.tiers[index]?.rate;
    return from && !from.eq(tier.rate) ? [{ tier: index, from, to: tier.rate }] : [];
  });
  return {
    baseline: baseline.summary,
    candidate: current.summary,
    plan: current.plan,
    changedTier: current.tier,
    multiplier: current.multiplier,
    rateChanges,
    rounds,
    explored,
    usesExactDeterministicResponse: true,
  };
}
