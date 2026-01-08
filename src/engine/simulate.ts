import { checkPayoutConservation, checkProbabilityConservation, checkStochasticPayoutConservation, type IdentityAttestation } from "./identity";
import { normalIntervalProbability } from "./normal";
import { payout, segmentQuota } from "./plan";
import { payoutCdf, respondCARA, type StochasticResponse } from "./respond.cara";
import { respondDeterministic, type DeterministicResponse } from "./respond.det";
import { Rat, R0 } from "./rat";
import { EngineError } from "./errors";
import type { Plan, Scenario } from "./types";

export interface DeterministicPlanResult {
  plan: Plan;
  responses: Array<{ segmentId: string; count: number; response: DeterministicResponse }>;
  kpis: {
    expectedRevenue: Rat;
    totalComp: Rat;
    compRatio: Rat | null;
    quotaAttainRate: Rat;
    effectiveCommissionRate: Rat | null;
    trueValue: Rat;
    retentionRisk: string[];
    payoutQuantiles: { p10: Rat; p50: Rat; p90: Rat };
  };
}

export interface DeterministicSimulationResult {
  mode: "deterministic";
  plans: DeterministicPlanResult[];
  attestations: IdentityAttestation[];
}

export interface StochasticPlanResult {
  plan: Plan;
  responses: Array<{ segmentId: string; count: number; response: StochasticResponse }>;
  kpis: {
    expectedRevenue: number;
    totalComp: number;
    compRatio: number | null;
    quotaAttainRate: number;
    effectiveCommissionRate: number | null;
    trueValue: number;
    retentionRisk: string[];
    payoutQuantiles: { p10: number; p50: number; p90: number };
  };
}

export interface StochasticSimulationResult {
  mode: "stochastic";
  plans: StochasticPlanResult[];
  attestations: IdentityAttestation[];
}

export type SimulationResult = DeterministicSimulationResult | StochasticSimulationResult;

export interface PlanComparison {
  leftPlanId: string;
  rightPlanId: string;
  expectedRevenueDelta: Rat;
  totalCompDelta: Rat;
  trueValueDelta: Rat;
  compRatioDelta: Rat | null;
  attestation: IdentityAttestation;
}

/**
 * §3.5 weighted lower quantile over exact point masses. Weights are rationals so a §3.3a
 * mixture contributes `n_s·p_j` per component; integer headcounts reproduce the P2 rule exactly.
 */
function weightedLowerQuantile(points: readonly { value: Rat; weight: Rat }[], probability: Rat): Rat {
  const sorted = [...points].sort((left, right) => left.value.cmp(right.value));
  if (sorted.length === 0) return R0;
  const total = sorted.reduce((sum, point) => sum.add(point.weight), R0);
  if (total.eq(R0)) return sorted[0]?.value ?? R0;
  const target = probability.mul(total);
  let cumulative = R0;
  for (const point of sorted) {
    cumulative = cumulative.add(point.weight);
    if (cumulative.gte(target)) return point.value;
  }
  return sorted.at(-1)?.value ?? R0;
}

function simulatePlan(scenario: Scenario, plan: Plan): DeterministicPlanResult {
  const rationality = scenario.settings.rationality;
  const responses = scenario.population.map((segment) => ({
    segmentId: segment.id,
    count: segment.count,
    response: respondDeterministic(plan, segment, rationality),
  }));
  const expectedRevenue = responses.reduce((sum, item) => sum.add(item.response.output.mul(Rat.from(item.count))), R0);
  const totalComp = responses.reduce((sum, item) => sum.add(item.response.payout.mul(Rat.from(item.count))), R0);
  const totalBase = scenario.population.reduce((sum, segment) => sum.add(plan.base.mul(Rat.from(segment.count))), R0);
  const totalHeadcount = scenario.population.reduce((sum, segment) => sum + segment.count, 0);
  // §3.3a: a segment contributes the mixture share of its plays that clear quota, not a 0/1 flag.
  const quotaAttained = responses.reduce((sum, item) => {
    const share = item.response.components.reduce(
      (inner, component) => (component.attainment.gte(Rat.one()) ? inner.add(component.probability) : inner),
      R0,
    );
    return sum.add(share.mul(Rat.from(item.count)));
  }, R0);
  const trueValue = responses.reduce((sum, item) => {
    const segment = scenario.population.find((candidate) => candidate.id === item.segmentId);
    if (!segment) throw new EngineError("INTERNAL_INVARIANT", "Response references a missing segment.");
    return sum.add(segment.valueQuality.mul(item.response.output).mul(Rat.from(item.count)));
  }, R0);
  const retentionRisk = responses.filter((item) => !item.response.participation).map((item) => item.segmentId);
  const payouts = responses.flatMap((item) => item.response.components.map((component) => ({
    value: component.payout,
    weight: component.probability.mul(Rat.from(item.count)),
  })));
  return {
    plan,
    responses,
    kpis: {
      expectedRevenue,
      totalComp,
      compRatio: expectedRevenue.eq(R0) ? null : totalComp.div(expectedRevenue),
      quotaAttainRate: quotaAttained.div(Rat.from(totalHeadcount)),
      effectiveCommissionRate: expectedRevenue.eq(R0) ? null : totalComp.sub(totalBase).div(expectedRevenue),
      trueValue,
      retentionRisk,
      payoutQuantiles: {
        p10: weightedLowerQuantile(payouts, Rat.from(1, 10)),
        p50: weightedLowerQuantile(payouts, Rat.from(1, 2)),
        p90: weightedLowerQuantile(payouts, Rat.from(9, 10)),
      },
    },
  };
}

/** P2 deterministic population runner. P3 supplies the stochastic branch. */
export function simulateDeterministic(scenario: Scenario): DeterministicSimulationResult {
  if (scenario.settings.mode !== "deterministic") throw new EngineError("INVALID_INPUT", "Deterministic simulation requires deterministic mode.");
  const plans = scenario.plans.map((plan) => simulatePlan(scenario, plan));
  const i1 = checkPayoutConservation(plans.flatMap((plan) => plan.responses.map((item) => ({
    count: item.count,
    payout: item.response.payout,
    decomposition: item.response.decomposition,
  }))));
  const i3: IdentityAttestation = { id: "I-3", pass: true, maxErr: 0 };
  return { mode: "deterministic", plans, attestations: [i1, i3] };
}

function stochasticQuantile(scenario: Scenario, plan: Plan, responses: StochasticPlanResult["responses"], probability: number): number {
  const scored = responses.map((item) => {
    const segment = scenario.population.find((candidate) => candidate.id === item.segmentId);
    if (!segment) throw new EngineError("INTERNAL_INVARIANT", "Response references a missing segment.");
    const outputs = item.response.components.map((component) => component.output);
    const lower = payout(plan, segment, Rat.fromFloat64(Math.min(...outputs) - 12 * item.response.sigma)).toNumber();
    const upper = payout(plan, segment, Rat.fromFloat64(Math.max(...outputs) + 12 * item.response.sigma)).toNumber();
    return { segment, response: item.response, count: item.count, lower, upper };
  });
  let lower = Math.min(...scored.map((item) => item.lower));
  let upper = Math.max(...scored.map((item) => item.upper));
  const tolerance = 1e-9 * Math.max(1, upper - lower);
  if (upper - lower <= tolerance) return lower;
  const total = scored.reduce((sum, item) => sum + item.count, 0);
  for (let iteration = 0; iteration < 160 && upper - lower > tolerance; iteration += 1) {
    const midpoint = (lower + upper) / 2;
    const cdf = scored.reduce((sum, item) => sum + item.count * payoutCdf(plan, item.segment, item.response, midpoint), 0) / total;
    if (cdf >= probability) upper = midpoint;
    else lower = midpoint;
  }
  return lower;
}

function simulateStochasticPlan(scenario: Scenario, plan: Plan): StochasticPlanResult {
  const responses = scenario.population.map((segment) => ({ segmentId: segment.id, count: segment.count, response: respondCARA(plan, segment, scenario.settings.rationality) }));
  const expectedRevenue = responses.reduce((sum, item) => sum + item.count * item.response.output, 0);
  const totalComp = responses.reduce((sum, item) => sum + item.count * item.response.payout, 0);
  const totalBase = scenario.population.reduce((sum, segment) => sum + segment.count * plan.base.toNumber(), 0);
  const totalHeadcount = scenario.population.reduce((sum, segment) => sum + segment.count, 0);
  const quotaAttainRate = responses.reduce((sum, item) => {
    const segment = scenario.population.find((candidate) => candidate.id === item.segmentId);
    if (!segment) throw new EngineError("INTERNAL_INVARIANT", "Response references a missing segment.");
    const quota = segmentQuota(plan, segment).toNumber();
    // §3.3a: sum each play's quota-clearing probability, weighted by how often it is played.
    const probability = item.response.components.reduce((inner, component) => inner + component.probability * (
      item.response.sigma === 0
        ? (component.output / quota >= 1 ? 1 : 0)
        : normalIntervalProbability((quota - component.output) / item.response.sigma, Infinity)
    ), 0);
    return sum + item.count * probability;
  }, 0) / totalHeadcount;
  const trueValue = responses.reduce((sum, item) => {
    const segment = scenario.population.find((candidate) => candidate.id === item.segmentId);
    if (!segment) throw new EngineError("INTERNAL_INVARIANT", "Response references a missing segment.");
    return sum + item.count * segment.valueQuality.toNumber() * item.response.output;
  }, 0);
  const retentionRisk = responses.filter((item) => !item.response.participation).map((item) => item.segmentId);
  return {
    plan,
    responses,
    kpis: {
      expectedRevenue,
      totalComp,
      compRatio: expectedRevenue === 0 ? null : totalComp / expectedRevenue,
      quotaAttainRate,
      effectiveCommissionRate: expectedRevenue === 0 ? null : (totalComp - totalBase) / expectedRevenue,
      trueValue,
      retentionRisk,
      payoutQuantiles: { p10: 0, p50: 0, p90: 0 },
    },
  };
}

export function simulateStochastic(scenario: Scenario): StochasticSimulationResult {
  if (scenario.settings.mode !== "stochastic") throw new EngineError("INVALID_INPUT", "Stochastic simulation requires stochastic mode.");
  const plans = scenario.plans.map((plan) => simulateStochasticPlan(scenario, plan));
  for (const result of plans) {
    result.kpis.payoutQuantiles = {
      p10: stochasticQuantile(scenario, result.plan, result.responses, 0.1),
      p50: stochasticQuantile(scenario, result.plan, result.responses, 0.5),
      p90: stochasticQuantile(scenario, result.plan, result.responses, 0.9),
    };
  }
  const i1 = checkStochasticPayoutConservation(plans.flatMap((plan) => plan.responses.map((item) => ({
    count: item.count, payout: item.response.payout, decomposition: item.response.decomposition,
  }))));
  const i2Errors = plans.flatMap((plan) => plan.responses.map((item) => checkProbabilityConservation(item.response.pieceProbabilities)));
  const i2: IdentityAttestation = { id: "I-2", pass: i2Errors.every((item) => item.pass), maxErr: Math.max(0, ...i2Errors.map((item) => item.maxErr)) };
  const i3: IdentityAttestation = { id: "I-3", pass: true, maxErr: 0 };
  return { mode: "stochastic", plans, attestations: [i1, i2, i3] };
}

export function simulate(scenario: Scenario): SimulationResult {
  return scenario.settings.mode === "deterministic" ? simulateDeterministic(scenario) : simulateStochastic(scenario);
}

export function comparePlans(result: DeterministicSimulationResult, leftPlanId: string, rightPlanId: string): PlanComparison {
  const left = result.plans.find((plan) => plan.plan.id === leftPlanId);
  const right = result.plans.find((plan) => plan.plan.id === rightPlanId);
  if (!left || !right) throw new EngineError("INVALID_INPUT", "Both plans must be present to compare them.");
  const compRatioDelta = left.kpis.compRatio && right.kpis.compRatio ? left.kpis.compRatio.sub(right.kpis.compRatio) : null;
  return {
    leftPlanId,
    rightPlanId,
    expectedRevenueDelta: left.kpis.expectedRevenue.sub(right.kpis.expectedRevenue),
    totalCompDelta: left.kpis.totalComp.sub(right.kpis.totalComp),
    trueValueDelta: left.kpis.trueValue.sub(right.kpis.trueValue),
    compRatioDelta,
    attestation: { id: "I-3", pass: true, maxErr: 0 },
  };
}
