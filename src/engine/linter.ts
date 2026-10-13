import { effectiveCap, kinks, payout, segmentQuota } from "./plan";
import { respondDeterministic } from "./respond.det";
import { respondCARA } from "./respond.cara";
import { simulate } from "./simulate";
import { computeTiming } from "./timing";
import { computeHorizon } from "./horizon";
import { computeTeam } from "./team";
import { computeSorting } from "./sorting";
import { EngineError } from "./errors";
import { deepLinkFor } from "./deeplink";
import { Rat, R0 } from "./rat";
import type { DeepLink, Plan, Rationality, Scenario, Segment } from "./types";

export type FindingType =
  "L-1" | "L-2" | "L-3" | "L-4" | "L-5" | "L-6" | "L-7" | "L-8" | "L-9" | "L-10";
type FindingSeverity = "info" | "warn" | "high";

export interface Finding {
  id: string;
  type: FindingType;
  severity: FindingSeverity;
  planId?: string;
  segments: string[];
  plans?: string[];
  evidence: Record<string, unknown>;
  deepLink: DeepLink;
}

type DraftFinding = Omit<Finding, "deepLink">;

function clonePlan(plan: Plan, mutator: (plan: Plan) => Plan): Plan {
  return mutator({
    ...plan,
    tiers: plan.tiers.map((tier) => ({ ...tier })),
    bonus: plan.bonus ? { ...plan.bonus } : null,
  });
}

function counterfactualPlanWithoutBonus(plan: Plan): Plan {
  return clonePlan(plan, (next) => ({ ...next, bonus: null }));
}

function counterfactualPlanUncapped(plan: Plan): Plan {
  return clonePlan(plan, (next) => {
    let lastNonzeroRate: Rat | null = null;
    for (const tier of next.tiers) if (!tier.rate.eq(R0)) lastNonzeroRate = tier.rate;
    if (!lastNonzeroRate) return { ...next, cap: null };
    let firstTrailingZeroIndex = -1;
    for (let index = next.tiers.length - 1; index >= 0; index -= 1) {
      const tier = next.tiers[index];
      if (!tier) continue;
      if (tier.rate.eq(R0)) firstTrailingZeroIndex = index;
      else break;
    }
    const tiers = next.tiers.map((tier, index) =>
      firstTrailingZeroIndex >= 0 && index >= firstTrailingZeroIndex
        ? { ...tier, rate: lastNonzeroRate! }
        : tier,
    );
    return { ...next, tiers, cap: null };
  });
}

interface ZoneRun {
  fromIndex: number;
  toIndex: number;
  loAttain: Rat;
  hiAttain: Rat;
}

function findInteriorZeroRuns(plan: Plan): ZoneRun[] {
  const runs: ZoneRun[] = [];
  let index = 0;
  while (index < plan.tiers.length) {
    const tier = plan.tiers[index];
    if (!tier || !tier.rate.eq(R0)) {
      index += 1;
      continue;
    }
    let end = index;
    while (end + 1 < plan.tiers.length && plan.tiers[end + 1]?.rate.eq(R0)) end += 1;
    const upper = plan.tiers[end + 1];
    if (upper)
      runs.push({ fromIndex: index, toIndex: end, loAttain: tier.from, hiAttain: upper.from });
    index = end + 1;
  }
  return runs;
}

function replaceZoneRate(plan: Plan, run: ZoneRun, rate: Rat): Plan {
  return clonePlan(plan, (next) => ({
    ...next,
    tiers: next.tiers.map((tier, index) =>
      index >= run.fromIndex && index <= run.toIndex ? { ...tier, rate } : tier,
    ),
  }));
}

function nearestPrecedingNonzeroRate(plan: Plan, index: number): Rat | null {
  for (let i = index - 1; i >= 0; i -= 1) {
    const tier = plan.tiers[i];
    if (tier && !tier.rate.eq(R0)) return tier.rate;
  }
  return null;
}

function nearestFollowingNonzeroRate(plan: Plan, index: number): Rat | null {
  for (let i = index + 1; i < plan.tiers.length; i += 1) {
    const tier = plan.tiers[i];
    if (tier && !tier.rate.eq(R0)) return tier.rate;
  }
  return null;
}

// §3.3a: every counterfactual runs under the scenario's active response class, so findings and
// the simulation can never disagree; the two exact-bunching tests below read the modal play.
function detEffort(
  plan: Plan,
  segment: Segment,
  rationality: Rationality | null | undefined,
): number {
  return respondDeterministic(plan, segment, rationality).effort.toNumber();
}

function stochEffort(
  plan: Plan,
  segment: Segment,
  rationality: Rationality | null | undefined,
): number {
  return respondCARA(plan, segment, rationality).effort;
}

function planHasNonzeroRate(plan: Plan): boolean {
  return plan.tiers.some((tier) => !tier.rate.eq(R0));
}

function planKPIsFromScenario(
  scenario: Scenario,
  plan: Plan,
): { revenue: number; trueValue: number } {
  const derived: Scenario = { ...scenario, plans: [plan] };
  const result = simulate(derived);
  const first = result.plans[0];
  if (!first)
    throw new EngineError("INTERNAL_INVARIANT", "Linter counterfactual missing plan result.");
  const revenue =
    "mode" in result && result.mode === "deterministic"
      ? (first as { kpis: { expectedRevenue: Rat } }).kpis.expectedRevenue.toNumber()
      : (first as { kpis: { expectedRevenue: number } }).kpis.expectedRevenue;
  const trueValue =
    "mode" in result && result.mode === "deterministic"
      ? (first as { kpis: { trueValue: Rat } }).kpis.trueValue.toNumber()
      : (first as { kpis: { trueValue: number } }).kpis.trueValue;
  return { revenue, trueValue };
}

function lintPlanForL1(plan: Plan, scenario: Scenario): DraftFinding[] {
  const runs = findInteriorZeroRuns(plan);
  const findings: DraftFinding[] = [];
  runs.forEach((run, runIndex) => {
    const replacement =
      nearestPrecedingNonzeroRate(plan, run.fromIndex) ??
      nearestFollowingNonzeroRate(plan, run.toIndex);
    if (!replacement) return;
    const counterfactualPlan = replaceZoneRate(plan, run, replacement);
    let highSegments: string[] = [];
    let warnSegments: string[] = [];
    for (const segment of scenario.population) {
      const isDeterministic = scenario.settings.mode === "deterministic";
      const effortCf = isDeterministic
        ? detEffort(counterfactualPlan, segment, scenario.settings.rationality)
        : stochEffort(counterfactualPlan, segment, scenario.settings.rationality);
      const revenueCf = segment.ability.toNumber() * effortCf;
      const attainCf = revenueCf / segmentQuota(plan, segment).toNumber();
      if (attainCf >= run.loAttain.toNumber() && attainCf < run.hiAttain.toNumber())
        highSegments.push(segment.id);
      const actualAttainment = isDeterministic
        ? respondDeterministic(
            plan,
            segment,
            scenario.settings.rationality,
          ).modal.attainment.toNumber()
        : (stochEffort(plan, segment, scenario.settings.rationality) * segment.ability.toNumber()) /
          segmentQuota(plan, segment).toNumber();
      if (Math.abs(actualAttainment - run.loAttain.toNumber()) <= 1e-10)
        warnSegments.push(segment.id);
    }
    let severity: FindingSeverity = "info";
    let segments: string[] = [];
    if (highSegments.length > 0) {
      severity = "high";
      segments = highSegments;
    } else if (warnSegments.length > 0) {
      severity = "warn";
      segments = warnSegments;
    }
    findings.push({
      id: `${plan.id}-L1-${runIndex}`,
      type: "L-1",
      severity,
      planId: plan.id,
      segments,
      evidence: {
        zone_lo_pct: `${Math.round(run.loAttain.toNumber() * 100)}%`,
        zone_hi_pct: `${Math.round(run.hiAttain.toNumber() * 100)}%`,
        cf_rate: replacement.toDecimalString(),
      },
    });
  });
  return findings;
}

function lintPlanForL2(plan: Plan, scenario: Scenario): DraftFinding[] {
  if (!plan.bonus || plan.bonus.L.eq(R0)) return [];
  const withoutBonus = counterfactualPlanWithoutBonus(plan);
  const isDet = scenario.settings.mode === "deterministic";
  const affected: string[] = [];
  let crossers = 0;
  let affectedHeadcount = 0;
  const totalHeadcount = scenario.population.reduce((sum, segment) => sum + segment.count, 0);
  for (const segment of scenario.population) {
    const effortWith = isDet
      ? detEffort(plan, segment, scenario.settings.rationality)
      : stochEffort(plan, segment, scenario.settings.rationality);
    const effortWithout = isDet
      ? detEffort(withoutBonus, segment, scenario.settings.rationality)
      : stochEffort(withoutBonus, segment, scenario.settings.rationality);
    const movesEnough =
      effortWithout === 0
        ? effortWith > 0
        : Math.abs(effortWith - effortWithout) > 0.05 * effortWithout;
    if (movesEnough) {
      affected.push(segment.id);
      affectedHeadcount += segment.count;
    }
    const quota = segmentQuota(plan, segment).toNumber();
    const revenueWith = segment.ability.toNumber() * effortWith;
    const revenueWithout = segment.ability.toNumber() * effortWithout;
    if (revenueWith >= quota && revenueWithout < quota) crossers += segment.count;
  }
  if (affected.length === 0) return [];
  const severity: FindingSeverity = crossers >= 0.25 * totalHeadcount ? "high" : "warn";
  return [
    {
      id: `${plan.id}-L2`,
      type: "L-2",
      severity,
      planId: plan.id,
      segments: affected,
      evidence: {
        x_b_pct: `${Math.round(plan.bonus.x_b.toNumber() * 100)}%`,
        affected_headcount_pct: `${Math.round((affectedHeadcount / totalHeadcount) * 100)}%`,
        crossers_pct: `${Math.round((crossers / totalHeadcount) * 100)}%`,
      },
    },
  ];
}

function lintPlanForL3(plan: Plan, scenario: Scenario): DraftFinding[] {
  const cap = effectiveCap(plan);
  if (!cap) return [];
  if (!planHasNonzeroRate(plan)) return [];
  const uncappedPlan = counterfactualPlanUncapped(plan);
  const isDet = scenario.settings.mode === "deterministic";
  const flagged: string[] = [];
  let flaggedHeadcount = 0;
  const totalHeadcount = scenario.population.reduce((sum, segment) => sum + segment.count, 0);
  let revenueLeft = 0;
  for (const segment of scenario.population) {
    const effortActual = isDet
      ? detEffort(plan, segment, scenario.settings.rationality)
      : stochEffort(plan, segment, scenario.settings.rationality);
    const effortUncapped = isDet
      ? detEffort(uncappedPlan, segment, scenario.settings.rationality)
      : stochEffort(uncappedPlan, segment, scenario.settings.rationality);
    const capAttain = cap.toNumber();
    if (isDet) {
      const attainActual = respondDeterministic(
        plan,
        segment,
        scenario.settings.rationality,
      ).modal.attainment.toNumber();
      if (Math.abs(attainActual - capAttain) < 1e-9 && effortUncapped > effortActual) {
        flagged.push(segment.id);
        flaggedHeadcount += segment.count;
        revenueLeft += segment.count * segment.ability.toNumber() * (effortUncapped - effortActual);
      }
    } else if (effortUncapped - effortActual > Math.max(1e-9, 0.005 * effortActual)) {
      flagged.push(segment.id);
      flaggedHeadcount += segment.count;
      revenueLeft += segment.count * segment.ability.toNumber() * (effortUncapped - effortActual);
    }
  }
  if (flagged.length === 0) return [];
  const severity: FindingSeverity = flaggedHeadcount >= 0.25 * totalHeadcount ? "high" : "warn";
  return [
    {
      id: `${plan.id}-L3`,
      type: "L-3",
      severity,
      planId: plan.id,
      segments: flagged,
      evidence: {
        x_bar_pct: `${Math.round(cap.toNumber() * 100)}%`,
        revenue_left_currency: revenueLeft,
      },
    },
  ];
}

function lintPlanForL4(plan: Plan, scenario: Scenario): DraftFinding[] {
  const isDet = scenario.settings.mode === "deterministic";
  const findings: DraftFinding[] = [];
  for (const segment of scenario.population) {
    const ce = isDet
      ? respondDeterministic(plan, segment, scenario.settings.rationality).ce.toNumber()
      : respondCARA(plan, segment, scenario.settings.rationality).ce;
    const reservation = segment.reservationCE.toNumber();
    if (ce < reservation) {
      const gap = reservation - ce;
      findings.push({
        id: `${plan.id}-L4-${segment.id}`,
        type: "L-4",
        severity: "warn",
        planId: plan.id,
        segments: [segment.id],
        evidence: { ce_gap_currency: gap, base_delta_currency: gap },
      });
    }
  }
  return findings;
}

/** §3.3b distortion index per segment under a plan; 0 for every segment with no second task. */
function distortionBySegment(plan: Plan, scenario: Scenario): Array<{ id: string; index: number }> {
  const isDet = scenario.settings.mode === "deterministic";
  return scenario.population.map((segment) => {
    if (!segment.secondTask) return { id: segment.id, index: 0 };
    const index = isDet
      ? (respondDeterministic(
          plan,
          segment,
          scenario.settings.rationality,
        ).multitask?.distortionIndex.toNumber() ?? 0)
      : (respondCARA(plan, segment, scenario.settings.rationality).multitask?.distortionIndex ?? 0);
    return { id: segment.id, index };
  });
}

function lintScenarioForL5(scenario: Scenario): DraftFinding[] {
  const findings: DraftFinding[] = [];
  if (scenario.plans.length === 1) {
    const plan = scenario.plans[0]!;
    const gammaSegments = scenario.population
      .filter((segment) => !segment.valueQuality.eq(Rat.one()))
      .map((segment) => segment.id);
    // §3.3b: the wedge is now computed, not just flagged — a second task can distort at γ = 1.
    const distorted = distortionBySegment(plan, scenario).filter((entry) => entry.index > 0);
    const wedgeSegments = [...new Set([...gammaSegments, ...distorted.map((entry) => entry.id)])];
    if (wedgeSegments.length > 0) {
      const worst = distorted.reduce((max, entry) => Math.max(max, entry.index), 0);
      findings.push({
        id: `${plan.id}-L5-single`,
        type: "L-5",
        severity: "info",
        planId: plan.id,
        segments: wedgeSegments,
        plans: [plan.id],
        evidence: {
          gamma_neq_one_segments: gammaSegments,
          ...(distorted.length > 0
            ? {
                distorted_segments: distorted.map((entry) => entry.id),
                max_distortion_pct: `${Math.round(worst * 100)}%`,
                value_efficiency_pct: `${Math.round(Math.sqrt(Math.max(0, 1 - worst)) * 100)}%`,
              }
            : {}),
        },
      });
    }
    return findings;
  }
  const perPlan = scenario.plans.map((plan) => ({
    plan,
    kpis: planKPIsFromScenario(scenario, plan),
  }));
  for (let i = 0; i < perPlan.length; i += 1) {
    for (let j = i + 1; j < perPlan.length; j += 1) {
      const a = perPlan[i]!;
      const b = perPlan[j]!;
      const revenueFlip =
        (a.kpis.revenue > b.kpis.revenue && a.kpis.trueValue < b.kpis.trueValue) ||
        (a.kpis.revenue < b.kpis.revenue && a.kpis.trueValue > b.kpis.trueValue);
      if (revenueFlip) {
        const revLeader = a.kpis.revenue > b.kpis.revenue ? a.plan.id : b.plan.id;
        const valueLeader = a.kpis.trueValue > b.kpis.trueValue ? a.plan.id : b.plan.id;
        findings.push({
          id: `L5-flip-${a.plan.id}-${b.plan.id}`,
          type: "L-5",
          severity: "high",
          segments: [],
          plans: [a.plan.id, b.plan.id],
          evidence: { plan_high_revenue: revLeader, plan_high_value: valueLeader },
        });
      }
    }
  }
  return findings;
}

function lintPlanForL7(plan: Plan, scenario: Scenario): DraftFinding[] {
  const timing = computeTiming(scenario);
  const planResult = timing.plans.find((entry) => entry.planId === plan.id);
  if (!planResult) return [];
  const affected = planResult.perSegment.filter((seg) => !seg.zStar.eq(R0));
  if (affected.length === 0) return [];
  const primary = affected.reduce((max, seg) => (seg.zStar.abs().gt(max.zStar.abs()) ? seg : max));
  const displaced = planResult.displacedRevenueTotal;
  const twoPeriod = planResult.twoPeriodExpectedRevenue;
  const ratio = twoPeriod.eq(R0) ? 0 : displaced.toNumber() / twoPeriod.toNumber();
  const severity: FindingSeverity = ratio >= 0.05 ? "high" : "warn";
  return [
    {
      id: `${plan.id}-L7`,
      type: "L-7",
      severity,
      planId: plan.id,
      segments: affected.map((seg) => seg.segmentId),
      evidence: {
        z_star_currency: primary.zStar.toNumber().toString(),
        pay_gain_currency: primary.payGain.toNumber().toString(),
        displaced_revenue: displaced.toNumber(),
        displaced_pct: `${Math.round(ratio * 100)}%`,
      },
    },
  ];
}

/** §3.10a L-8: fires only when a horizon is configured, so the frozen goldens stay silent. */
function lintPlanForL8(plan: Plan, scenario: Scenario): DraftFinding[] {
  const horizon = computeHorizon(scenario);
  if (!horizon) return [];
  const planResult = horizon.plans.find((entry) => entry.planId === plan.id);
  if (!planResult || !planResult.withheldRevenue.gt(R0)) return [];
  const naive = planResult.naiveProducedRevenue;
  const ratio = naive.eq(R0) ? 0 : planResult.withheldRevenue.toNumber() / naive.toNumber();
  const affected = planResult.perSegment.filter((entry) => entry.withheldRevenue.gt(R0));
  const drift = affected.reduce((max, entry) => Math.min(max, entry.attainmentDrift.toNumber()), 0);
  return [
    {
      id: `${plan.id}-L8`,
      type: "L-8",
      severity: ratio >= 0.05 ? "high" : "warn",
      planId: plan.id,
      segments: affected.map((entry) => entry.segmentId),
      evidence: {
        lambda_pct: `${Math.round(horizon.ratchet.weight.toNumber() * 100)}%`,
        growth: horizon.ratchet.growth.toNumber().toString(),
        periods: horizon.periods,
        withheld_currency: planResult.withheldRevenue.toNumber(),
        withheld_pct: `${Math.round(ratio * 100)}%`,
        terminal_quota: affected[0]?.terminalQuota.toNumber() ?? 0,
        shadow_rate: affected[0]?.periods[0]?.shadowRate.toNumber().toString() ?? "0",
        attainment_drift: drift,
      },
    },
  ];
}

/** §3.14 L-9: fires only on a configured split-credit team, so the frozen goldens stay silent. */
function lintPlanForL9(plan: Plan, scenario: Scenario): DraftFinding[] {
  const team = computeTeam(scenario);
  if (!team || team.mode !== "split") return [];
  const planResult = team.plans.find((entry) => entry.planId === plan.id);
  if (!planResult || planResult.revenueGap === null) return [];
  const affected = planResult.perSegment.filter(
    (entry) =>
      entry.individualRevenue > 0 &&
      entry.individualRevenue - entry.equilibriumRevenue > 0.05 * entry.individualRevenue,
  );
  if (affected.length === 0) return [];
  const individual = planResult.individualRevenue.toNumber();
  const ratio = individual === 0 ? 0 : planResult.revenueGap.toNumber() / individual;
  const worst = affected.reduce((min, entry) => Math.min(min, entry.creditWeight ?? 1), 1);
  const effortGap = affected.reduce(
    (max, entry) =>
      Math.max(
        max,
        entry.individualEffort === 0 ? 0 : 1 - entry.equilibriumEffort / entry.individualEffort,
      ),
    0,
  );
  return [
    {
      id: `${plan.id}-L9`,
      type: "L-9",
      severity: ratio >= 0.25 ? "high" : "warn",
      planId: plan.id,
      segments: affected.map((entry) => entry.segmentId),
      evidence: {
        credit_share_pct: `${Math.round((team.creditShare?.toNumber() ?? 0) * 100)}%`,
        team_size: team.size,
        phi_pct: `${Math.round(worst * 100)}%`,
        effort_gap_pct: `${Math.round(effortGap * 100)}%`,
        revenue_gap_currency: planResult.revenueGap.toNumber(),
        equilibria_count: affected[0]?.equilibriaCount ?? 1,
      },
    },
  ];
}

function lintPlanForL6(plan: Plan, scenario: Scenario): DraftFinding[] {
  const findings: DraftFinding[] = [];
  for (const segment of scenario.population) {
    const outputs = [R0, ...kinks(plan, segment)];
    const sorted = outputs.filter((value) => value.gte(R0)).sort((left, right) => left.cmp(right));
    let previous = payout(plan, segment, sorted[0] ?? R0);
    for (let i = 1; i < sorted.length; i += 1) {
      const current = payout(plan, segment, sorted[i]!);
      if (current.lt(previous)) {
        findings.push({
          id: `${plan.id}-L6-${segment.id}-${i}`,
          type: "L-6",
          severity: "high",
          planId: plan.id,
          segments: [segment.id],
          evidence: { q_flip_currency: sorted[i]!.toNumber() },
        });
      }
      previous = current;
    }
  }
  return findings;
}

/**
 * L-10 Menu screening. Fires only when `settings.menu` is present, so every frozen golden is
 * provably silent: a menu is a claim the owner makes about how plans are offered, and until it
 * is made the plans are alternatives and there is nothing to screen.
 *
 * Three failures of a menu, each computed by the sorting module rather than guessed at:
 * an option nobody takes is not screening anyone; a menu everybody pools onto is one plan in
 * expensive disguise; and a segment the menu leaves exactly indifferent was sorted by the
 * tie-break, not by the plans.
 */
function lintScenarioForL10(scenario: Scenario): DraftFinding[] {
  if (!scenario.settings.menu) return [];
  const sorting = computeSorting(scenario);
  const findings: DraftFinding[] = [];
  const headcount = scenario.population.reduce((sum, segment) => sum + segment.count, 0);
  const placed = headcount - sorting.walkAwayHeadcount;

  if (scenario.plans.length > 1 && sorting.deadOptions.length > 0) {
    findings.push({
      id: `L10-dead-${sorting.deadOptions.join("-")}`,
      type: "L-10",
      severity: sorting.deadOptions.length >= scenario.plans.length - 1 ? "high" : "warn",
      segments: [],
      plans: sorting.deadOptions,
      evidence: {
        kind: "dead-option",
        unchosen_plans: sorting.deadOptions,
        chosen_plans: sorting.sorting
          .filter((entry) => entry.headcount > 0)
          .map((entry) => entry.planId),
      },
    });
  }

  const crowded = sorting.sorting.find(
    (entry) => placed > 0 && entry.headcount === placed && scenario.plans.length > 1,
  );
  if (crowded) {
    findings.push({
      id: `L10-pool-${crowded.planId}`,
      type: "L-10",
      severity: "high",
      segments: crowded.segmentIds,
      plans: [crowded.planId],
      evidence: {
        kind: "pooling",
        pooled_plan: crowded.planId,
        pooled_headcount: crowded.headcount,
        offered_plans: scenario.plans.length,
      },
    });
  }

  if (sorting.knifeEdgeSegmentIds.length > 0) {
    findings.push({
      id: `L10-knife-${sorting.knifeEdgeSegmentIds.join("-")}`,
      type: "L-10",
      severity: "warn",
      segments: sorting.knifeEdgeSegmentIds,
      evidence: { kind: "knife-edge", segments: sorting.knifeEdgeSegmentIds },
    });
  }

  if (sorting.walkAwayHeadcount > 0) {
    const share = sorting.walkAwayHeadcount / Math.max(1, headcount);
    findings.push({
      id: `L10-exit-${sorting.walkAwaySegmentIds.join("-")}`,
      type: "L-10",
      severity: share >= 0.25 ? "high" : "warn",
      segments: sorting.walkAwaySegmentIds,
      evidence: {
        kind: "walk-away",
        walk_away_headcount: sorting.walkAwayHeadcount,
        walk_away_pct: `${Math.round(share * 1000) / 10}%`,
      },
    });
  }

  return findings;
}

export function lintScenario(scenario: Scenario): Finding[] {
  const findings: DraftFinding[] = [];
  for (const plan of scenario.plans) {
    findings.push(...lintPlanForL1(plan, scenario));
    findings.push(...lintPlanForL2(plan, scenario));
    findings.push(...lintPlanForL3(plan, scenario));
    findings.push(...lintPlanForL4(plan, scenario));
    findings.push(...lintPlanForL6(plan, scenario));
    findings.push(...lintPlanForL7(plan, scenario));
    findings.push(...lintPlanForL8(plan, scenario));
    findings.push(...lintPlanForL9(plan, scenario));
  }
  findings.push(...lintScenarioForL5(scenario));
  findings.push(...lintScenarioForL10(scenario));
  return findings
    .sort((left, right) => {
      const severityRank = { high: 0, warn: 1, info: 2 } as const;
      return severityRank[left.severity] - severityRank[right.severity];
    })
    .map((finding) => ({ ...finding, deepLink: deepLinkFor(finding) }));
}
