"use client";

import { create } from "zustand";
import type { Scenario } from "@/engine/types";
import { EngineError } from "@/engine/errors";
import { allocateId, parseScenario, ScenarioJsonSchema, type PlanJson, type ScenarioJson, type SegmentJson } from "./schema";
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
  addPlan(): void;
  duplicatePlan(id: string): void;
  deletePlan(id: string): void;
  setActivePlanId(id: string): void;
  setMode(mode: "deterministic" | "stochastic"): void;
  setDiscount(value: string): void;
  setSeasonality(value: [string, string]): void;
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
  setSeasonality(value) {
    const scenario = get().scenario;
    const next: ScenarioJson = { ...scenario, settings: { ...scenario.settings, seasonality: value } };
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
