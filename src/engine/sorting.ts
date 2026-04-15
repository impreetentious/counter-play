import { EngineError } from "./errors";
import { trueValueOf } from "./multitask";
import { attainment as planAttainment } from "./plan";
import { Rat, R0 } from "./rat";
import { respondCARA } from "./respond.cara";
import { respondDeterministic } from "./respond.det";
import type { Mode, Plan, Scenario, Segment } from "./types";

export type { MenuSettings } from "./types";

/**
 * Selection and sorting — the hidden-information half of the subject.
 *
 * Everything else in this engine answers the moral-hazard question: given this plan and this
 * population, what will people do? It cannot answer the question a practitioner asks first —
 * *who ends up on this plan?* — because §3.5 pins every aggregate to the full roster and says
 * so out loud. This module supplies the other half, and follows §3.14's discipline exactly: it
 * reports **beside** the §3.5 KPIs and is never substituted into them, so no golden moves and
 * no KPI card silently changes meaning.
 *
 * Two readings come out of the same machinery:
 *
 * - **Menu.** Offer the scenario's plans simultaneously and let each segment take its
 *   CE-maximising one, with its reservation value as the walk-away. The sorting map, the
 *   screening diagnostics, and menu-adjusted KPIs follow.
 * - **Roster response.** Run the same choice with a single plan on the menu, and it becomes the
 *   exit model: the segments whose CE trails their reservation leave, the KPIs recompute on
 *   who is left, and the difference is the number the full-roster reading hides.
 *
 * Both are argmax over quantities `CE(s, π)` the engine already computes. The only new
 * convention is the tie-break, pinned below.
 */

export interface PlanOption {
  planId: string;
  planLabel: string;
  /** Exact in deterministic mode; the exact rational of the float CE in CARA mode (§3.7). */
  ce: Rat;
  effort: Rat;
  output: Rat;
  payout: Rat;
  trueValue: Rat;
  /** Share of this segment's plays that clear quota, for the menu-adjusted attainment KPI. */
  quotaShare: Rat;
  participates: boolean;
}

export interface SegmentChoice {
  segmentId: string;
  segmentLabel: string;
  count: number;
  reservation: Rat;
  options: PlanOption[];
  /** Null when the segment walks away from every plan on the menu. */
  chosenPlanId: string | null;
  /** The CE the segment actually lives with — the chosen plan's, or the reservation. */
  realisedCe: Rat;
  /**
   * How far the chosen plan beats the best of the rest. Zero means the menu did not decide
   * this segment's choice; the tie-break did. Null when only one plan is on offer.
   */
  separation: Rat | null;
  /** Chosen CE minus reservation. Negative means the segment is staying under duress. */
  surplus: Rat;
}

export interface RosterKpis {
  headcount: number;
  expectedRevenue: Rat;
  totalComp: Rat;
  trueValue: Rat;
  profit: Rat;
  compRatio: Rat | null;
  quotaAttainRate: Rat | null;
}

export interface RosterDelta {
  planId: string;
  planLabel: string;
  /** §3.5's reading: everybody stays, whatever their certainty equivalent says. */
  fullRoster: RosterKpis;
  /** The same plan once the segments below their reservation have gone. */
  surviving: RosterKpis;
  exitingSegmentIds: string[];
  exitingHeadcount: number;
  delta: {
    expectedRevenue: Rat;
    totalComp: Rat;
    trueValue: Rat;
    profit: Rat;
  };
}

export interface SortingResult {
  mode: Mode;
  walkAwayAllowed: boolean;
  choices: SegmentChoice[];
  /** KPIs aggregated over the plan each segment actually chose. */
  menuKpis: RosterKpis;
  sorting: Array<{ planId: string; planLabel: string; segmentIds: string[]; headcount: number }>;
  walkAwaySegmentIds: string[];
  walkAwayHeadcount: number;
  /** Plans on the menu that nobody chose. An option nobody takes is not screening anyone. */
  deadOptions: string[];
  /** Segments the menu leaves exactly indifferent — the tie-break, not the plan, decided. */
  knifeEdgeSegmentIds: string[];
  /** Per-plan full-roster versus surviving-roster comparison. */
  roster: RosterDelta[];
}

function optionFor(scenario: Scenario, plan: Plan, segment: Segment): PlanOption {
  if (scenario.settings.mode === "deterministic") {
    const response = respondDeterministic(plan, segment, scenario.settings.rationality);
    const quotaShare = response.components.reduce(
      (sum, component) =>
        component.attainment.gte(Rat.one()) ? sum.add(component.probability) : sum,
      R0,
    );
    return {
      planId: plan.id,
      planLabel: plan.label,
      ce: response.ce,
      effort: response.effort,
      output: response.output,
      payout: response.payout,
      trueValue: trueValueOf(segment, response.output, response.multitask),
      quotaShare,
      participates: response.participation,
    };
  }
  const response = respondCARA(plan, segment, scenario.settings.rationality);
  const output = Rat.fromFloat64(response.output);
  const quota = plan.quota.mul(segment.quotaMult);
  return {
    planId: plan.id,
    planLabel: plan.label,
    ce: Rat.fromFloat64(response.ce),
    effort: Rat.fromFloat64(response.effort),
    output,
    payout: Rat.fromFloat64(response.payout),
    trueValue: response.multitask
      ? Rat.fromFloat64(response.multitask.valueDelivered)
      : segment.valueQuality.mul(output),
    quotaShare: quota.eq(R0) || output.div(quota).lt(Rat.one()) ? R0 : Rat.one(),
    participates: response.participation,
  };
}

/**
 * Pinned choice convention. Highest certainty equivalent wins; a tie goes to the plan that
 * induces less effort, matching §3.0's rule that agents do not work extra for an identical
 * certainty equivalent; a remaining tie goes to the plan written first, so the result is a
 * function of the scenario rather than of iteration order.
 */
function pickBest(options: readonly PlanOption[]): PlanOption | null {
  let best: PlanOption | null = null;
  for (const option of options) {
    if (!best) {
      best = option;
      continue;
    }
    const byCe = option.ce.cmp(best.ce);
    if (byCe > 0 || (byCe === 0 && option.effort.lt(best.effort))) best = option;
  }
  return best;
}

function aggregate(entries: readonly { count: number; option: PlanOption }[]): RosterKpis {
  const headcount = entries.reduce((sum, entry) => sum + entry.count, 0);
  const weighted = (pick: (option: PlanOption) => Rat): Rat =>
    entries.reduce((sum, entry) => sum.add(pick(entry.option).mul(Rat.from(entry.count))), R0);
  const expectedRevenue = weighted((option) => option.output);
  const totalComp = weighted((option) => option.payout);
  const trueValue = weighted((option) => option.trueValue);
  const quotaAttained = weighted((option) => option.quotaShare);
  return {
    headcount,
    expectedRevenue,
    totalComp,
    trueValue,
    profit: trueValue.sub(totalComp),
    compRatio: expectedRevenue.eq(R0) ? null : totalComp.div(expectedRevenue),
    quotaAttainRate: headcount === 0 ? null : quotaAttained.div(Rat.from(headcount)),
  };
}

export function computeSorting(scenario: Scenario): SortingResult {
  if (scenario.plans.length === 0)
    throw new EngineError("INVALID_INPUT", "A menu needs at least one plan.");
  const walkAwayAllowed = scenario.settings.menu?.walkAwayAllowed ?? true;

  const choices: SegmentChoice[] = scenario.population.map((segment) => {
    const options = scenario.plans.map((plan) => optionFor(scenario, plan, segment));
    const acceptable = walkAwayAllowed ? options.filter((option) => option.participates) : options;
    const best = pickBest(acceptable);
    const rest = best ? options.filter((option) => option.planId !== best.planId) : [];
    const runnerUp = pickBest(rest);
    return {
      segmentId: segment.id,
      segmentLabel: segment.label,
      count: segment.count,
      reservation: segment.reservationCE,
      options,
      chosenPlanId: best?.planId ?? null,
      realisedCe: best ? best.ce : segment.reservationCE,
      separation: best && runnerUp ? best.ce.sub(runnerUp.ce) : null,
      surplus: best ? best.ce.sub(segment.reservationCE) : R0,
    };
  });

  const taken = choices.filter((choice) => choice.chosenPlanId !== null);
  const menuEntries = taken.map((choice) => ({
    count: choice.count,
    option: choice.options.find((option) => option.planId === choice.chosenPlanId)!,
  }));

  const sorting = scenario.plans.map((plan) => {
    const members = taken.filter((choice) => choice.chosenPlanId === plan.id);
    return {
      planId: plan.id,
      planLabel: plan.label,
      segmentIds: members.map((choice) => choice.segmentId),
      headcount: members.reduce((sum, choice) => sum + choice.count, 0),
    };
  });

  const roster: RosterDelta[] = scenario.plans.map((plan) => {
    const all = scenario.population.map((segment) => ({
      segment,
      count: segment.count,
      option: choices
        .find((choice) => choice.segmentId === segment.id)!
        .options.find((option) => option.planId === plan.id)!,
    }));
    const fullRoster = aggregate(all);
    const staying = all.filter((entry) => entry.option.participates);
    const leaving = all.filter((entry) => !entry.option.participates);
    const surviving = aggregate(staying);
    return {
      planId: plan.id,
      planLabel: plan.label,
      fullRoster,
      surviving,
      exitingSegmentIds: leaving.map((entry) => entry.segment.id),
      exitingHeadcount: leaving.reduce((sum, entry) => sum + entry.count, 0),
      delta: {
        expectedRevenue: surviving.expectedRevenue.sub(fullRoster.expectedRevenue),
        totalComp: surviving.totalComp.sub(fullRoster.totalComp),
        trueValue: surviving.trueValue.sub(fullRoster.trueValue),
        profit: surviving.profit.sub(fullRoster.profit),
      },
    };
  });

  return {
    mode: scenario.settings.mode,
    walkAwayAllowed,
    choices,
    menuKpis: aggregate(menuEntries),
    sorting,
    walkAwaySegmentIds: choices
      .filter((choice) => choice.chosenPlanId === null)
      .map((choice) => choice.segmentId),
    walkAwayHeadcount: choices
      .filter((choice) => choice.chosenPlanId === null)
      .reduce((sum, choice) => sum + choice.count, 0),
    deadOptions: sorting.filter((entry) => entry.headcount === 0).map((entry) => entry.planId),
    knifeEdgeSegmentIds: choices
      .filter((choice) => choice.separation !== null && choice.separation.eq(R0))
      .map((choice) => choice.segmentId),
    roster,
  };
}

/** Attainment of a segment's chosen play, for the sorting map's per-row read-out. */
export function chosenAttainment(scenario: Scenario, choice: SegmentChoice): Rat | null {
  const plan = scenario.plans.find((entry) => entry.id === choice.chosenPlanId);
  const segment = scenario.population.find((entry) => entry.id === choice.segmentId);
  const option = choice.options.find((entry) => entry.planId === choice.chosenPlanId);
  if (!plan || !segment || !option) return null;
  return planAttainment(plan, segment, option.output);
}
