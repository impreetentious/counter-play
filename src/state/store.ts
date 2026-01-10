"use client";

import { create } from "zustand";
import type { Scenario } from "@/engine/types";
import { EngineError } from "@/engine/errors";
import { allocateId, parseScenario, ScenarioJsonSchema, type HorizonJson, type PayoutExtrasJson, type PlanJson, type ScenarioJson, type SecondTaskJson, type SegmentJson, type TeamJson } from "./schema";
import { landingScenario, templates, type TemplateEntry } from "./templates";
import { persistScenario } from "./persist";
import { computeTornado, runMonteCarlo, type KpiKey, type McResult, type TornadoResult } from "@/engine/mc";

export interface FieldIssue {
  path: string;
  message: string;
}

export interface StoreState {
  scenario: ScenarioJson;
  domain: Scenario | null;
  domainError: string | null;
  issues: FieldIssue[];
  activePlanId: string;
  hydrated: boolean;
  hydrate(persisted: ScenarioJson | null): void;
  replaceScenario(next: ScenarioJson): void;
  applyTemplate(template: TemplateEntry): void;
  setSegmentField<K extends keyof SegmentJson>(id: string, key: K, value: SegmentJson[K]): void;
  addSegment(): void;
  duplicateSegment(id: string): void;
  deleteSegment(id: string): void;
  setPlanField<K extends keyof PlanJson>(id: string, key: K, value: PlanJson[K]): void;
  setTierField(planId: string, index: number, key: "from" | "rate", value: string): void;
  addTier(planId: string): void;
  deleteTier(planId: string, index: number): void;
  toggleBonus(planId: string): void;
  setBonusField(planId: string, key: "L" | "x_b", value: string): void;
  toggleCap(planId: string): void;
  setCap(planId: string, value: string): void;
  toggleExtra(planId: string, key: ExtraKey): void;
  setExtraScalar(planId: string, key: ExtraScalarKey, value: string): void;
  setExtraLump(planId: string, key: ExtraLumpKey, field: "amount" | "threshold", value: string): void;
  addPlan(): void;
  duplicatePlan(id: string): void;
  deletePlan(id: string): void;
  setActivePlanId(id: string): void;
  setMode(mode: "deterministic" | "stochastic"): void;
  setDiscount(value: string): void;
  setRationalityMode(mode: "exact" | "softmax"): void;
  setRationalityTau(value: string): void;
  toggleSecondTask(segmentId: string): void;
  setSecondTaskField(segmentId: string, key: keyof SecondTaskJson, value: string): void;
  toggleHorizon(): void;
  setHorizonPeriods(periods: number): void;
  setHorizonSeasonality(index: number, value: string): void;
  setRatchetField(key: "weight" | "growth", value: string): void;
  setHorizonResponse(response: "myopic" | "ratchetAware"): void;
  toggleTeam(): void;
  setTeamMode(mode: "split" | "tournament"): void;
  setTeamSize(size: number): void;
  setCreditShare(value: string): void;
  setTournamentField(key: "prize" | "winners", value: string): void;
  setSeasonality(value: [string, string]): void;
  setNotes(notes: string): void;
  mcResult: McResult | null;
  mcTornado: TornadoResult | null;
  mcTornadoKpi: KpiKey;
  mcRunning: boolean;
  mcError: string | null;
  setMcSeed(seed: number): void;
  setMcN(N: number): void;
  setDemandRange(range: [string, string] | null): void;
  setSegmentRange(segmentId: string, param: "a" | "k" | "sigma" | "gamma", range: [string, string] | null): void;
  setTornadoKpi(kpi: KpiKey): void;
  runMonteCarloAction(): void;
}

export type ExtraKey = "drawNonRecoverable" | "drawRecoverable" | "spiff" | "clawback" | "payFloor";
export type ExtraScalarKey = "drawNonRecoverable" | "drawRecoverable" | "payFloor";
export type ExtraLumpKey = "spiff" | "clawback";

// §3.3a default temperature (currency units), adopted when the rationality dial is switched on.
const DEFAULT_TAU = "5000";

// §3.2a defaults used when a primitive is switched on in the Design surface.
const EXTRA_DEFAULTS: { [K in ExtraKey]: NonNullable<PayoutExtrasJson[K]> } = {
  drawNonRecoverable: "30000",
  drawRecoverable: "30000",
  payFloor: "0",
  spiff: { amount: "5000", threshold: "1.2" },
  clawback: { amount: "5000", threshold: "0.5" },
};

/** Applies a mutation to a plan's extras block, dropping it entirely when empty. */
function mutateExtras(plan: PlanJson, fn: (extras: PayoutExtrasJson) => PayoutExtrasJson): PlanJson {
  const next = fn({ ...(plan.extras ?? {}) });
  const cleaned: PayoutExtrasJson = {};
  for (const [key, value] of Object.entries(next)) {
    if (value != null) (cleaned as Record<string, unknown>)[key] = value;
  }
  if (Object.keys(cleaned).length === 0) {
    const { extras: _drop, ...rest } = plan;
    return rest;
  }
  return { ...plan, extras: cleaned };
}

function reviewScenario(next: ScenarioJson): { domain: Scenario | null; issues: FieldIssue[]; domainError: string | null } {
  const zod = ScenarioJsonSchema.safeParse(next);
  if (!zod.success) {
    const issues: FieldIssue[] = zod.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message }));
    return { domain: null, issues, domainError: issues[0]?.message ?? "Scenario is invalid." };
  }
  try {
    const domain = parseScenario(next);
    return { domain, issues: [], domainError: null };
  } catch (error) {
    if (error instanceof EngineError) return { domain: null, issues: [], domainError: error.message };
    return { domain: null, issues: [], domainError: "Unknown scenario error." };
  }
}

function commit(next: ScenarioJson, activePlanIdCandidate?: string): Partial<StoreState> {
  const review = reviewScenario(next);
  const activePlanId = next.plans.some((plan) => plan.id === activePlanIdCandidate) ? (activePlanIdCandidate as string) : (next.plans[0]?.id ?? "plan-1");
  persistScenario(next);
  return { scenario: next, ...review, activePlanId, mcResult: null, mcTornado: null, mcError: null };
}

function updateRanges(scenario: ScenarioJson, mutate: (ranges: ScenarioJson["settings"]["mc"]["ranges"]) => ScenarioJson["settings"]["mc"]["ranges"]): ScenarioJson {
  return {
    ...scenario,
    settings: { ...scenario.settings, mc: { ...scenario.settings.mc, ranges: mutate(scenario.settings.mc.ranges) } },
  };
}

// §3.3b / §3.10a / §3.14 defaults, written only when a block is switched on so that an untouched
// scenario never carries the field and stays byte-identical on the wire.
const SECOND_TASK_DEFAULT: SecondTaskJson = { ability: "0", valuePerEffort: "300000", costSubstitution: "0.5" };

const HORIZON_DEFAULT: HorizonJson = {
  periods: 4,
  seasonality: ["1", "1", "1", "1"],
  ratchet: { weight: "0.5", growth: "1" },
  response: "ratchetAware",
};

const TEAM_DEFAULT: TeamJson = { mode: "split", size: 4, split: { creditShare: "0.5" } };

function updateSettings(scenario: ScenarioJson, mutate: (settings: ScenarioJson["settings"]) => ScenarioJson["settings"]): ScenarioJson {
  return { ...scenario, settings: mutate(scenario.settings) };
}

function updateHorizon(scenario: ScenarioJson, mutate: (horizon: HorizonJson) => HorizonJson): ScenarioJson {
  return updateSettings(scenario, (settings) => (settings.horizon ? { ...settings, horizon: mutate(settings.horizon) } : settings));
}

function updateTeam(scenario: ScenarioJson, mutate: (team: TeamJson) => TeamJson): ScenarioJson {
  return updateSettings(scenario, (settings) => (settings.team ? { ...settings, team: mutate(settings.team) } : settings));
}

function replaceSegment(scenario: ScenarioJson, id: string, updater: (segment: SegmentJson) => SegmentJson): ScenarioJson {
  return { ...scenario, population: scenario.population.map((segment) => (segment.id === id ? updater(segment) : segment)) };
}

function replacePlan(scenario: ScenarioJson, id: string, updater: (plan: PlanJson) => PlanJson): ScenarioJson {
  return { ...scenario, plans: scenario.plans.map((plan) => (plan.id === id ? updater(plan) : plan)) };
}

const initialReview = reviewScenario(landingScenario);

export const useScenarioStore = create<StoreState>((set, get) => ({
  scenario: landingScenario,
  domain: initialReview.domain,
  domainError: initialReview.domainError,
  issues: initialReview.issues,
  activePlanId: landingScenario.plans[0]?.id ?? "plan-1",
  hydrated: false,
  hydrate(persisted) {
    if (get().hydrated) return;
    if (persisted) set({ hydrated: true, ...commit(persisted, persisted.plans[0]?.id) });
    else set({ hydrated: true });
  },
  replaceScenario(next) {
    set(commit(next, get().activePlanId));
  },
  applyTemplate(template) {
    set(commit(template.scenario, template.scenario.plans[0]?.id));
  },
  setSegmentField(id, key, value) {
    const next = replaceSegment(get().scenario, id, (segment) => ({ ...segment, [key]: value }));
    set(commit(next, get().activePlanId));
  },
  addSegment() {
    const scenario = get().scenario;
    const newId = allocateId("seg", scenario.population.map((segment) => segment.id));
    const next: ScenarioJson = {
      ...scenario,
      population: [
        ...scenario.population,
        { id: newId, label: `Segment ${scenario.population.length + 1}`, count: 5, ability: "800000", costK: "70000", riskAversion: "1e-4", noiseSD: "120000", reservationCE: "70000", quotaMult: "1", valueQuality: "1", movable: "0.1" },
      ],
    };
    set(commit(next, get().activePlanId));
  },
  duplicateSegment(id) {
    const scenario = get().scenario;
    const source = scenario.population.find((segment) => segment.id === id);
    if (!source) return;
    const newId = allocateId("seg", scenario.population.map((segment) => segment.id));
    const next: ScenarioJson = { ...scenario, population: [...scenario.population, { ...source, id: newId, label: `${source.label} copy` }] };
    set(commit(next, get().activePlanId));
  },
  deleteSegment(id) {
    const scenario = get().scenario;
    if (scenario.population.length <= 1) return;
    const next: ScenarioJson = { ...scenario, population: scenario.population.filter((segment) => segment.id !== id) };
    set(commit(next, get().activePlanId));
  },
  setPlanField(id, key, value) {
    const next = replacePlan(get().scenario, id, (plan) => ({ ...plan, [key]: value }));
    set(commit(next, get().activePlanId));
  },
  setTierField(planId, index, key, value) {
    const next = replacePlan(get().scenario, planId, (plan) => ({
      ...plan,
      tiers: plan.tiers.map((tier, tierIndex) => (tierIndex === index ? { ...tier, [key]: value } : tier)),
    }));
    set(commit(next, get().activePlanId));
  },
  addTier(planId) {
    const next = replacePlan(get().scenario, planId, (plan) => {
      if (plan.tiers.length >= 12) return plan;
      const last = plan.tiers[plan.tiers.length - 1];
      const from = last ? String(Number(last.from) + 0.2) : "0";
      return { ...plan, tiers: [...plan.tiers, { from, rate: "0.1" }] };
    });
    set(commit(next, get().activePlanId));
  },
  deleteTier(planId, index) {
    const next = replacePlan(get().scenario, planId, (plan) => {
      if (plan.tiers.length <= 1 || index === 0) return plan;
      return { ...plan, tiers: plan.tiers.filter((_, tierIndex) => tierIndex !== index) };
    });
    set(commit(next, get().activePlanId));
  },
  toggleBonus(planId) {
    const next = replacePlan(get().scenario, planId, (plan) => (plan.bonus ? { ...plan, bonus: null } : { ...plan, bonus: { L: "10000", x_b: "1" } }));
    set(commit(next, get().activePlanId));
  },
  setBonusField(planId, key, value) {
    const next = replacePlan(get().scenario, planId, (plan) => (plan.bonus ? { ...plan, bonus: { ...plan.bonus, [key]: value } } : plan));
    set(commit(next, get().activePlanId));
  },
  toggleCap(planId) {
    const next = replacePlan(get().scenario, planId, (plan) => (plan.cap ? { ...plan, cap: null } : { ...plan, cap: "1.5" }));
    set(commit(next, get().activePlanId));
  },
  setCap(planId, value) {
    const next = replacePlan(get().scenario, planId, (plan) => (plan.cap ? { ...plan, cap: value } : plan));
    set(commit(next, get().activePlanId));
  },
  toggleExtra(planId, key) {
    const next = replacePlan(get().scenario, planId, (plan) => mutateExtras(plan, (extras) => (
      extras[key] != null ? { ...extras, [key]: null } : { ...extras, [key]: EXTRA_DEFAULTS[key] }
    )));
    set(commit(next, get().activePlanId));
  },
  setExtraScalar(planId, key, value) {
    const next = replacePlan(get().scenario, planId, (plan) => (
      plan.extras?.[key] != null ? mutateExtras(plan, (extras) => ({ ...extras, [key]: value })) : plan
    ));
    set(commit(next, get().activePlanId));
  },
  setExtraLump(planId, key, field, value) {
    const next = replacePlan(get().scenario, planId, (plan) => {
      const current = plan.extras?.[key];
      if (!current) return plan;
      return mutateExtras(plan, (extras) => ({ ...extras, [key]: { ...current, [field]: value } }));
    });
    set(commit(next, get().activePlanId));
  },
  addPlan() {
    const scenario = get().scenario;
    if (scenario.plans.length >= 3) return;
    const newId = allocateId("plan", scenario.plans.map((plan) => plan.id));
    const next: ScenarioJson = {
      ...scenario,
      plans: [
        ...scenario.plans,
        { id: newId, label: `Plan ${scenario.plans.length + 1}`, base: "60000", quota: "900000", tiers: [{ from: "0", rate: "0.08" }], bonus: null, cap: null },
      ],
    };
    set(commit(next, newId));
  },
  duplicatePlan(id) {
    const scenario = get().scenario;
    if (scenario.plans.length >= 3) return;
    const source = scenario.plans.find((plan) => plan.id === id);
    if (!source) return;
    const newId = allocateId("plan", scenario.plans.map((plan) => plan.id));
    const next: ScenarioJson = { ...scenario, plans: [...scenario.plans, { ...source, id: newId, label: `${source.label} copy` }] };
    set(commit(next, newId));
  },
  deletePlan(id) {
    const scenario = get().scenario;
    if (scenario.plans.length <= 1) return;
    const next: ScenarioJson = { ...scenario, plans: scenario.plans.filter((plan) => plan.id !== id) };
    set(commit(next, next.plans[0]?.id ?? "plan-1"));
  },
  setActivePlanId(id) {
    if (get().scenario.plans.some((plan) => plan.id === id)) set({ activePlanId: id });
  },
  setMode(mode) {
    const scenario = get().scenario;
    if (scenario.settings.mode === mode) return;
    const next: ScenarioJson = { ...scenario, settings: { ...scenario.settings, mode } };
    set(commit(next, get().activePlanId));
  },
  setDiscount(value) {
    const scenario = get().scenario;
    const next: ScenarioJson = { ...scenario, settings: { ...scenario.settings, discount: value } };
    set(commit(next, get().activePlanId));
  },
  setRationalityMode(mode) {
    const scenario = get().scenario;
    if ((scenario.settings.rationality?.mode ?? "exact") === mode) return;
    // The block is written only once the dial is touched, so untouched scenarios stay byte-identical.
    const tau = scenario.settings.rationality?.tau ?? DEFAULT_TAU;
    const next: ScenarioJson = { ...scenario, settings: { ...scenario.settings, rationality: { mode, tau } } };
    set(commit(next, get().activePlanId));
  },
  setRationalityTau(value) {
    const scenario = get().scenario;
    const mode = scenario.settings.rationality?.mode ?? "exact";
    const next: ScenarioJson = { ...scenario, settings: { ...scenario.settings, rationality: { mode, tau: value } } };
    set(commit(next, get().activePlanId));
  },
  toggleSecondTask(segmentId) {
    const next = replaceSegment(get().scenario, segmentId, (segment) => {
      if (segment.secondTask) {
        const { secondTask: _drop, ...rest } = segment;
        return rest;
      }
      return { ...segment, secondTask: SECOND_TASK_DEFAULT };
    });
    set(commit(next, get().activePlanId));
  },
  setSecondTaskField(segmentId, key, value) {
    const next = replaceSegment(get().scenario, segmentId, (segment) => (
      segment.secondTask ? { ...segment, secondTask: { ...segment.secondTask, [key]: value } } : segment
    ));
    set(commit(next, get().activePlanId));
  },
  toggleHorizon() {
    const scenario = get().scenario;
    set(commit(updateSettings(scenario, (settings) => {
      if (settings.horizon) {
        const { horizon: _drop, ...rest } = settings;
        return rest;
      }
      return { ...settings, horizon: HORIZON_DEFAULT };
    }), get().activePlanId));
  },
  setHorizonPeriods(periods) {
    if (!Number.isInteger(periods) || periods < 2 || periods > 12) return;
    set(commit(updateHorizon(get().scenario, (horizon) => ({
      ...horizon,
      periods,
      // Keep exactly one demand multiplier per period; new ones start neutral.
      seasonality: Array.from({ length: periods }, (_, index) => horizon.seasonality[index] ?? "1"),
    })), get().activePlanId));
  },
  setHorizonSeasonality(index, value) {
    set(commit(updateHorizon(get().scenario, (horizon) => ({
      ...horizon,
      seasonality: horizon.seasonality.map((entry, position) => (position === index ? value : entry)),
    })), get().activePlanId));
  },
  setRatchetField(key, value) {
    set(commit(updateHorizon(get().scenario, (horizon) => ({ ...horizon, ratchet: { ...horizon.ratchet, [key]: value } })), get().activePlanId));
  },
  setHorizonResponse(response) {
    set(commit(updateHorizon(get().scenario, (horizon) => ({ ...horizon, response })), get().activePlanId));
  },
  toggleTeam() {
    const scenario = get().scenario;
    set(commit(updateSettings(scenario, (settings) => {
      if (settings.team) {
        const { team: _drop, ...rest } = settings;
        return rest;
      }
      return { ...settings, team: TEAM_DEFAULT };
    }), get().activePlanId));
  },
  setTeamMode(mode) {
    set(commit(updateTeam(get().scenario, (team) => ({
      ...team,
      mode,
      // Each mode carries its own parameters; write the one being switched to.
      ...(mode === "split" ? { split: team.split ?? { creditShare: "0.5" } } : { tournament: team.tournament ?? { prize: "20000", winners: 1 } }),
    })), get().activePlanId));
  },
  setTeamSize(size) {
    if (!Number.isInteger(size) || size < 2 || size > 50) return;
    set(commit(updateTeam(get().scenario, (team) => ({
      ...team,
      size,
      ...(team.tournament ? { tournament: { ...team.tournament, winners: Math.min(team.tournament.winners, size - 1) } } : {}),
    })), get().activePlanId));
  },
  setCreditShare(value) {
    set(commit(updateTeam(get().scenario, (team) => ({ ...team, split: { creditShare: value } })), get().activePlanId));
  },
  setTournamentField(key, value) {
    set(commit(updateTeam(get().scenario, (team) => {
      const current = team.tournament ?? { prize: "20000", winners: 1 };
      if (key === "winners") {
        const winners = Number(value);
        if (!Number.isInteger(winners) || winners < 1 || winners > team.size - 1) return team;
        return { ...team, tournament: { ...current, winners } };
      }
      return { ...team, tournament: { ...current, prize: value } };
    }), get().activePlanId));
  },
  setSeasonality(value) {
    const scenario = get().scenario;
    const next: ScenarioJson = { ...scenario, settings: { ...scenario.settings, seasonality: value } };
    set(commit(next, get().activePlanId));
  },
  setNotes(notes) {
    const scenario = get().scenario;
    if (scenario.meta.notes === notes) return;
    const next: ScenarioJson = { ...scenario, meta: { ...scenario.meta, notes } };
    set(commit(next, get().activePlanId));
  },
  mcResult: null,
  mcTornado: null,
  mcTornadoKpi: "totalComp",
  mcRunning: false,
  mcError: null,
  setMcSeed(seed) {
    const scenario = get().scenario;
    if (!Number.isInteger(seed) || seed < 0 || seed > 2 ** 32 - 1) return;
    const next: ScenarioJson = { ...scenario, settings: { ...scenario.settings, mc: { ...scenario.settings.mc, seed } } };
    set(commit(next, get().activePlanId));
  },
  setMcN(N) {
    const scenario = get().scenario;
    if (!Number.isInteger(N) || N < 100 || N > 5000) return;
    const next: ScenarioJson = { ...scenario, settings: { ...scenario.settings, mc: { ...scenario.settings.mc, N } } };
    set(commit(next, get().activePlanId));
  },
  setDemandRange(range) {
    const next = updateRanges(get().scenario, (ranges) => {
      if (!range) {
        const { demand: _omit, ...rest } = ranges;
        return rest;
      }
      return { ...ranges, demand: range };
    });
    set(commit(next, get().activePlanId));
  },
  setSegmentRange(segmentId, param, range) {
    const next = updateRanges(get().scenario, (ranges) => {
      const perSegment = { ...(ranges.perSegment ?? {}) };
      const current = { ...(perSegment[segmentId] ?? {}) };
      if (range) current[param] = range;
      else delete current[param];
      if (Object.keys(current).length === 0) delete perSegment[segmentId];
      else perSegment[segmentId] = current;
      const next = { ...ranges };
      if (Object.keys(perSegment).length === 0) delete next.perSegment;
      else next.perSegment = perSegment;
      return next;
    });
    set(commit(next, get().activePlanId));
  },
  setTornadoKpi(kpi) {
    set({ mcTornadoKpi: kpi, mcTornado: null });
  },
  runMonteCarloAction() {
    const domain = get().domain;
    if (!domain) return;
    set({ mcRunning: true, mcError: null });
    try {
      const result = runMonteCarlo(domain);
      const tornado = computeTornado(domain, get().mcTornadoKpi);
      set({ mcRunning: false, mcResult: result, mcTornado: tornado, mcError: null });
    } catch (error) {
      const message = error instanceof EngineError ? error.message : "Monte Carlo failed.";
      set({ mcRunning: false, mcError: message });
    }
  },
}));

export function selectTemplates(): readonly TemplateEntry[] {
  return templates;
}

export function findIssuesForPath(state: Pick<StoreState, "issues">, prefix: string): FieldIssue[] {
  return state.issues.filter((issue) => issue.path === prefix || issue.path.startsWith(`${prefix}.`));
}
