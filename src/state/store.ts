"use client";

import { create } from "zustand";
import type { AppLocale, DeepLink, Scenario } from "@/engine/types";
import { EngineError } from "@/engine/errors";
import { Rat } from "@/engine/rat";
import {
  allocateId,
  parseScenario,
  ScenarioJsonSchema,
  type HorizonJson,
  type MenuJson,
  type ObjectiveJson,
  type PayoutExtrasJson,
  type PlanJson,
  type ScenarioJson,
  type SecondTaskJson,
  type SegmentJson,
  type TeamJson,
} from "./schema";
import { templateT2, templates, type TemplateEntry } from "./templates";
import { applyStressPreset, type StressPresetId } from "./presets";
import { persistScenario, type PersistenceRead } from "./persist";
import {
  computeTornado,
  createMonteCarloRun,
  type KpiKey,
  type McResult,
  type TornadoResult,
} from "@/engine/mc";

export interface FieldIssue {
  path: string;
  message: string;
}

interface CalibrationApplyProposal {
  segmentId: string;
  ability: string | null;
  noiseSD: string | null;
}

export interface StoreState {
  scenario: ScenarioJson;
  revision: number;
  persistenceError: string | null;
  recoveryBytes: string | null;
  retryPersistence(replaceUnreadable?: boolean): void;
  domain: Scenario | null;
  domainError: string | null;
  issues: FieldIssue[];
  activePlanId: string;
  activeSurface: "Model" | "Design" | "Simulate" | "Analyze";
  highlight: DeepLink | null;
  historyPast: ScenarioJson[];
  historyFuture: ScenarioJson[];
  hydrated: boolean;
  hydrate(persisted: PersistenceRead): void;
  replaceScenario(next: ScenarioJson): void;
  undo(): void;
  redo(): void;
  applyTemplate(template: TemplateEntry): void;
  applyStressPreset(preset: StressPresetId): void;
  setSegmentField<K extends keyof SegmentJson>(id: string, key: K, value: SegmentJson[K]): void;
  addSegment(): void;
  duplicateSegment(id: string): void;
  deleteSegment(id: string): void;
  setPlanField<K extends keyof PlanJson>(id: string, key: K, value: PlanJson[K]): void;
  applyOptimizedPlanRates(proposal: {
    revision: number;
    planId: string;
    tierFrom: readonly string[];
    rates: readonly string[];
  }): boolean;
  setTierField(planId: string, index: number, key: "from" | "rate", value: string): void;
  addTier(planId: string): void;
  deleteTier(planId: string, index: number): void;
  toggleBonus(planId: string): void;
  setBonusField(planId: string, key: "L" | "x_b", value: string): void;
  toggleCap(planId: string): void;
  setCap(planId: string, value: string): void;
  toggleExtra(planId: string, key: ExtraKey): void;
  setExtraScalar(planId: string, key: ExtraScalarKey, value: string): void;
  setExtraLump(
    planId: string,
    key: ExtraLumpKey,
    field: "amount" | "threshold",
    value: string,
  ): void;
  addPlan(): void;
  duplicatePlan(id: string): void;
  deletePlan(id: string): void;
  setActivePlanId(id: string): void;
  setActiveSurface(surface: StoreState["activeSurface"]): void;
  focusDeepLink(link: DeepLink): void;
  setMode(mode: "deterministic" | "stochastic"): void;
  setLocale(locale: AppLocale): void;
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
  toggleMenu(): void;
  setMenuWalkAway(allowed: boolean): void;
  toggleObjective(): void;
  setObjectiveLimit(key: "compRatioCeiling" | "retentionFloor", value: string | null): void;
  setSeasonality(value: [string, string]): void;
  setNotes(notes: string): void;
  applyCalibration(proposals: CalibrationApplyProposal[]): void;
  mcResult: McResult | null;
  mcTornado: TornadoResult | null;
  mcTornadoKpi: KpiKey;
  mcRunning: boolean;
  mcProgress: number;
  mcError: string | null;
  setMcSeed(seed: number): void;
  setMcN(N: number): void;
  setDemandRange(range: [string, string] | null): void;
  setSegmentRange(
    segmentId: string,
    param: "a" | "k" | "sigma" | "gamma",
    range: [string, string] | null,
  ): void;
  setTornadoKpi(kpi: KpiKey): void;
  runMonteCarloAction(): void;
  cancelMonteCarlo(): void;
}

type ExtraKey = "drawNonRecoverable" | "drawRecoverable" | "spiff" | "clawback" | "payFloor";
type ExtraScalarKey = "drawNonRecoverable" | "drawRecoverable" | "payFloor";
type ExtraLumpKey = "spiff" | "clawback";

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
function mutateExtras(
  plan: PlanJson,
  fn: (extras: PayoutExtrasJson) => PayoutExtrasJson,
): PlanJson {
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

function reviewScenario(next: ScenarioJson): {
  domain: Scenario | null;
  issues: FieldIssue[];
  domainError: string | null;
} {
  const zod = ScenarioJsonSchema.safeParse(next);
  if (!zod.success) {
    const issues: FieldIssue[] = zod.error.issues.map((issue) => ({
      path: issue.path.join("."),
      message: issue.message,
    }));
    return { domain: null, issues, domainError: issues[0]?.message ?? "Scenario is invalid." };
  }
  try {
    const domain = parseScenario(next);
    return { domain, issues: [], domainError: null };
  } catch (error) {
    if (error instanceof EngineError)
      return { domain: null, issues: [], domainError: error.message };
    return { domain: null, issues: [], domainError: "Unknown scenario error." };
  }
}

function commit(next: ScenarioJson, activePlanIdCandidate?: string): Partial<StoreState> {
  const review = reviewScenario(next);
  const activePlanId = next.plans.some((plan) => plan.id === activePlanIdCandidate)
    ? (activePlanIdCandidate as string)
    : (next.plans[0]?.id ?? "plan-1");
  return {
    scenario: next,
    ...review,
    activePlanId,
    mcResult: null,
    mcTornado: null,
    mcError: null,
  };
}

function differsOnlyByLocale(left: ScenarioJson, right: ScenarioJson): boolean {
  const { locale: _leftLocale, ...leftSettings } = left.settings;
  const { locale: _rightLocale, ...rightSettings } = right.settings;
  return (
    JSON.stringify({ ...left, settings: leftSettings }) ===
    JSON.stringify({ ...right, settings: rightSettings })
  );
}

function updateRanges(
  scenario: ScenarioJson,
  mutate: (
    ranges: ScenarioJson["settings"]["mc"]["ranges"],
  ) => ScenarioJson["settings"]["mc"]["ranges"],
): ScenarioJson {
  return {
    ...scenario,
    settings: {
      ...scenario.settings,
      mc: { ...scenario.settings.mc, ranges: mutate(scenario.settings.mc.ranges) },
    },
  };
}

// §3.3b / §3.10a / §3.14 defaults, written only when a block is switched on so that an untouched
// scenario never carries the field and stays byte-identical on the wire.
const SECOND_TASK_DEFAULT: SecondTaskJson = {
  ability: "0",
  valuePerEffort: "300000",
  costSubstitution: "0.5",
};

const HORIZON_DEFAULT: HorizonJson = {
  periods: 4,
  seasonality: ["1", "1", "1", "1"],
  ratchet: { weight: "0.5", growth: "1" },
  response: "ratchetAware",
};

const TEAM_DEFAULT: TeamJson = { mode: "split", size: 4, split: { creditShare: "0.5" } };

// Offering the plans together is a claim about the market, so it is off until the owner says so.
const MENU_DEFAULT: MenuJson = { walkAwayAllowed: true };

// Expected profit is always the objective; these are the limits the owner may add to it.
const OBJECTIVE_DEFAULT: ObjectiveJson = { compRatioCeiling: "0.4", retentionFloor: "1" };

// Tier edges are exact wire decimals, so the +0.2 step is taken in rationals. Float addition
// emits 1.4 + 0.2 = 1.5999999999999999, which the §3.0 15-significand-digit guard rejects —
// and 1.4 is the last tier edge of the template the workspace opens on.
const TIER_STEP = Rat.from(1, 5);

function nextTierFrom(previous: string): string {
  try {
    return Rat.fromDecimalString(previous).add(TIER_STEP).toDecimalString();
  } catch {
    // The existing edge is already unreadable, so the scenario is invalid and says so; repeating
    // it keeps that one message rather than adding a second, unrelated one.
    return previous;
  }
}

function updateSettings(
  scenario: ScenarioJson,
  mutate: (settings: ScenarioJson["settings"]) => ScenarioJson["settings"],
): ScenarioJson {
  return { ...scenario, settings: mutate(scenario.settings) };
}

function updateHorizon(
  scenario: ScenarioJson,
  mutate: (horizon: HorizonJson) => HorizonJson,
): ScenarioJson {
  return updateSettings(scenario, (settings) =>
    settings.horizon ? { ...settings, horizon: mutate(settings.horizon) } : settings,
  );
}

function updateTeam(scenario: ScenarioJson, mutate: (team: TeamJson) => TeamJson): ScenarioJson {
  return updateSettings(scenario, (settings) =>
    settings.team ? { ...settings, team: mutate(settings.team) } : settings,
  );
}

function replaceSegment(
  scenario: ScenarioJson,
  id: string,
  updater: (segment: SegmentJson) => SegmentJson,
): ScenarioJson {
  return {
    ...scenario,
    population: scenario.population.map((segment) =>
      segment.id === id ? updater(segment) : segment,
    ),
  };
}

function replacePlan(
  scenario: ScenarioJson,
  id: string,
  updater: (plan: PlanJson) => PlanJson,
): ScenarioJson {
  return {
    ...scenario,
    plans: scenario.plans.map((plan) => (plan.id === id ? updater(plan) : plan)),
  };
}

const initialReview = reviewScenario(templateT2);

export const useScenarioStore = create<StoreState>((rawSet, get) => {
  // Every scenario-bearing store mutation is journalled centrally. Individual mutations keep
  // their compact shape; view-only updates never carry `scenario` and therefore never enter history.
  let restoringHistory = false;
  let mcTimer: ReturnType<typeof setTimeout> | null = null;
  let mcRunId = 0;
  const stopMcTimer = (): void => {
    mcRunId += 1;
    if (mcTimer) clearTimeout(mcTimer);
    mcTimer = null;
  };
  const set: typeof rawSet = (partial, _replace) => {
    const resolved = typeof partial === "function" ? partial(get()) : partial;
    const candidate = resolved.scenario;
    const sourceChanged = candidate !== undefined && candidate !== get().scenario;
    const planChanged =
      resolved.activePlanId !== undefined && resolved.activePlanId !== get().activePlanId;
    if (sourceChanged || planChanged) resolved.revision = get().revision + 1;
    if (sourceChanged && resolved.domain && get().recoveryBytes === null) {
      const saved = persistScenario(candidate!);
      resolved.persistenceError = saved.ok ? null : saved.message;
    }
    const scenarioChanged =
      candidate !== undefined &&
      candidate !== get().scenario &&
      !differsOnlyByLocale(get().scenario, candidate);
    if (!scenarioChanged) {
      rawSet(resolved);
      return;
    }
    // A material scenario change invalidates any in-flight Monte Carlo run, so the timer and the
    // two flags the panel reads must always be cleared together. Undo and redo reach this path with
    // `restoringHistory` set: clearing only the timer there would leave the panel on "Running…"
    // with its Run button disabled and no run left to complete it.
    stopMcTimer();
    const state = get();
    rawSet({
      ...resolved,
      mcRunning: false,
      mcProgress: 0,
      ...(restoringHistory
        ? {}
        : { historyPast: [...state.historyPast, state.scenario].slice(-50), historyFuture: [] }),
    });
  };

  return {
    scenario: templateT2,
    revision: 0,
    persistenceError: null,
    recoveryBytes: null,
    domain: initialReview.domain,
    domainError: initialReview.domainError,
    issues: initialReview.issues,
    activePlanId: templateT2.plans[0]?.id ?? "plan-1",
    activeSurface: "Model",
    highlight: null,
    historyPast: [],
    historyFuture: [],
    hydrated: false,
    hydrate(persisted) {
      if (get().hydrated) return;
      rawSet({
        hydrated: true,
        historyPast: [],
        historyFuture: [],
        revision: get().revision + 1,
        ...(persisted.kind === "valid"
          ? commit(persisted.scenario, persisted.scenario.plans[0]?.id)
          : {}),
        recoveryBytes: persisted.kind === "invalid" ? persisted.raw : null,
        persistenceError:
          persisted.kind === "invalid" || persisted.kind === "unavailable"
            ? persisted.message
            : null,
      });
    },
    retryPersistence(replaceUnreadable = false) {
      const state = get();
      if (!state.domain || (state.recoveryBytes !== null && !replaceUnreadable)) return;
      const result = persistScenario(state.scenario);
      rawSet({
        persistenceError: result.ok ? null : result.message,
        ...(result.ok ? { recoveryBytes: null } : {}),
      });
    },
    replaceScenario(next) {
      set(commit(next, get().activePlanId));
    },
    undo() {
      const state = get();
      const previous = state.historyPast.at(-1);
      if (!previous) return;
      restoringHistory = true;
      set({
        ...commit(previous, state.activePlanId),
        historyPast: state.historyPast.slice(0, -1),
        historyFuture: [state.scenario, ...state.historyFuture].slice(0, 50),
      });
      restoringHistory = false;
    },
    redo() {
      const state = get();
      const next = state.historyFuture[0];
      if (!next) return;
      restoringHistory = true;
      set({
        ...commit(next, state.activePlanId),
        historyPast: [...state.historyPast, state.scenario].slice(-50),
        historyFuture: state.historyFuture.slice(1),
      });
      restoringHistory = false;
    },
    applyTemplate(template) {
      set(commit(template.scenario, template.scenario.plans[0]?.id));
    },
    applyStressPreset(preset) {
      set(commit(applyStressPreset(get().scenario, preset), get().activePlanId));
    },
    setSegmentField(id, key, value) {
      const next = replaceSegment(get().scenario, id, (segment) => ({ ...segment, [key]: value }));
      set(commit(next, get().activePlanId));
    },
    addSegment() {
      const scenario = get().scenario;
      const newId = allocateId(
        "seg",
        scenario.population.map((segment) => segment.id),
      );
      const next: ScenarioJson = {
        ...scenario,
        population: [
          ...scenario.population,
          {
            id: newId,
            label: `Segment ${scenario.population.length + 1}`,
            count: 5,
            ability: "800000",
            costK: "70000",
            riskAversion: "1e-4",
            noiseSD: "120000",
            reservationCE: "70000",
            quotaMult: "1",
            valueQuality: "1",
            movable: "0.1",
          },
        ],
      };
      set(commit(next, get().activePlanId));
    },
    duplicateSegment(id) {
      const scenario = get().scenario;
      const source = scenario.population.find((segment) => segment.id === id);
      if (!source) return;
      const newId = allocateId(
        "seg",
        scenario.population.map((segment) => segment.id),
      );
      const next: ScenarioJson = {
        ...scenario,
        population: [
          ...scenario.population,
          { ...source, id: newId, label: `${source.label} (copy)` },
        ],
      };
      set(commit(next, get().activePlanId));
    },
    deleteSegment(id) {
      const scenario = get().scenario;
      if (scenario.population.length <= 1) return;
      const next: ScenarioJson = {
        ...scenario,
        population: scenario.population.filter((segment) => segment.id !== id),
      };
      set(commit(next, get().activePlanId));
    },
    setPlanField(id, key, value) {
      const next = replacePlan(get().scenario, id, (plan) => ({ ...plan, [key]: value }));
      set(commit(next, get().activePlanId));
    },
    applyOptimizedPlanRates(proposal) {
      const state = get();
      const plan = state.scenario.plans.find((entry) => entry.id === proposal.planId);
      if (
        !state.domain ||
        state.revision !== proposal.revision ||
        state.activePlanId !== proposal.planId ||
        !plan ||
        proposal.rates.length !== plan.tiers.length ||
        proposal.tierFrom.length !== plan.tiers.length ||
        plan.tiers.some((tier, index) => tier.from !== proposal.tierFrom[index])
      )
        return false;
      try {
        if (
          proposal.rates.some(
            (rate) =>
              typeof rate !== "string" ||
              !Number.isFinite(Number(rate)) ||
              Rat.fromDecimalString(rate).lt(Rat.zero()),
          )
        )
          return false;
      } catch {
        return false;
      }
      const next = replacePlan(state.scenario, proposal.planId, (entry) => ({
        ...entry,
        tiers: entry.tiers.map((tier, index) => ({ ...tier, rate: proposal.rates[index]! })),
      }));
      if (!reviewScenario(next).domain) return false;
      set(commit(next, state.activePlanId));
      return true;
    },
    setTierField(planId, index, key, value) {
      const next = replacePlan(get().scenario, planId, (plan) => ({
        ...plan,
        tiers: plan.tiers.map((tier, tierIndex) =>
          tierIndex === index ? { ...tier, [key]: value } : tier,
        ),
      }));
      set(commit(next, get().activePlanId));
    },
    addTier(planId) {
      const next = replacePlan(get().scenario, planId, (plan) => {
        if (plan.tiers.length >= 12) return plan;
        const last = plan.tiers[plan.tiers.length - 1];
        const from = last ? nextTierFrom(last.from) : "0";
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
      const next = replacePlan(get().scenario, planId, (plan) =>
        plan.bonus ? { ...plan, bonus: null } : { ...plan, bonus: { L: "10000", x_b: "1" } },
      );
      set(commit(next, get().activePlanId));
    },
    setBonusField(planId, key, value) {
      const next = replacePlan(get().scenario, planId, (plan) =>
        plan.bonus ? { ...plan, bonus: { ...plan.bonus, [key]: value } } : plan,
      );
      set(commit(next, get().activePlanId));
    },
    toggleCap(planId) {
      const next = replacePlan(get().scenario, planId, (plan) =>
        plan.cap ? { ...plan, cap: null } : { ...plan, cap: "1.5" },
      );
      set(commit(next, get().activePlanId));
    },
    setCap(planId, value) {
      const next = replacePlan(get().scenario, planId, (plan) =>
        plan.cap ? { ...plan, cap: value } : plan,
      );
      set(commit(next, get().activePlanId));
    },
    toggleExtra(planId, key) {
      const next = replacePlan(get().scenario, planId, (plan) =>
        mutateExtras(plan, (extras) =>
          extras[key] != null
            ? { ...extras, [key]: null }
            : { ...extras, [key]: EXTRA_DEFAULTS[key] },
        ),
      );
      set(commit(next, get().activePlanId));
    },
    setExtraScalar(planId, key, value) {
      const next = replacePlan(get().scenario, planId, (plan) =>
        plan.extras?.[key] != null
          ? mutateExtras(plan, (extras) => ({ ...extras, [key]: value }))
          : plan,
      );
      set(commit(next, get().activePlanId));
    },
    setExtraLump(planId, key, field, value) {
      const next = replacePlan(get().scenario, planId, (plan) => {
        const current = plan.extras?.[key];
        if (!current) return plan;
        return mutateExtras(plan, (extras) => ({
          ...extras,
          [key]: { ...current, [field]: value },
        }));
      });
      set(commit(next, get().activePlanId));
    },
    addPlan() {
      const scenario = get().scenario;
      if (scenario.plans.length >= 3) return;
      const newId = allocateId(
        "plan",
        scenario.plans.map((plan) => plan.id),
      );
      const next: ScenarioJson = {
        ...scenario,
        plans: [
          ...scenario.plans,
          {
            id: newId,
            label: `Plan ${scenario.plans.length + 1}`,
            base: "60000",
            quota: "900000",
            tiers: [{ from: "0", rate: "0.08" }],
            bonus: null,
            cap: null,
          },
        ],
      };
      set(commit(next, newId));
    },
    duplicatePlan(id) {
      const scenario = get().scenario;
      if (scenario.plans.length >= 3) return;
      const source = scenario.plans.find((plan) => plan.id === id);
      if (!source) return;
      const newId = allocateId(
        "plan",
        scenario.plans.map((plan) => plan.id),
      );
      const next: ScenarioJson = {
        ...scenario,
        plans: [...scenario.plans, { ...source, id: newId, label: `${source.label} (copy)` }],
      };
      set(commit(next, newId));
    },
    deletePlan(id) {
      const scenario = get().scenario;
      if (scenario.plans.length <= 1) return;
      const next: ScenarioJson = {
        ...scenario,
        plans: scenario.plans.filter((plan) => plan.id !== id),
      };
      set(commit(next, next.plans[0]?.id ?? "plan-1"));
    },
    setActivePlanId(id) {
      if (get().scenario.plans.some((plan) => plan.id === id)) set({ activePlanId: id });
    },
    setActiveSurface(surface) {
      set({ activeSurface: surface, highlight: null });
    },
    focusDeepLink(link) {
      const activeSurface =
        `${link.surface[0]?.toUpperCase()}${link.surface.slice(1)}` as StoreState["activeSurface"];
      set({ activeSurface, highlight: link });
    },
    setMode(mode) {
      const scenario = get().scenario;
      if (scenario.settings.mode === mode) return;
      const next: ScenarioJson = { ...scenario, settings: { ...scenario.settings, mode } };
      set(commit(next, get().activePlanId));
    },
    setLocale(locale) {
      const scenario = get().scenario;
      if (scenario.settings.locale === locale) return;
      const next: ScenarioJson = { ...scenario, settings: { ...scenario.settings, locale } };
      set(commit(next, get().activePlanId));
    },
    setDiscount(value) {
      const scenario = get().scenario;
      const next: ScenarioJson = {
        ...scenario,
        settings: { ...scenario.settings, discount: value },
      };
      set(commit(next, get().activePlanId));
    },
    setRationalityMode(mode) {
      const scenario = get().scenario;
      if ((scenario.settings.rationality?.mode ?? "exact") === mode) return;
      // The block is written only once the dial is touched, so untouched scenarios stay byte-identical.
      const tau = scenario.settings.rationality?.tau ?? DEFAULT_TAU;
      const next: ScenarioJson = {
        ...scenario,
        settings: { ...scenario.settings, rationality: { mode, tau } },
      };
      set(commit(next, get().activePlanId));
    },
    setRationalityTau(value) {
      const scenario = get().scenario;
      const mode = scenario.settings.rationality?.mode ?? "exact";
      const next: ScenarioJson = {
        ...scenario,
        settings: { ...scenario.settings, rationality: { mode, tau: value } },
      };
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
      const next = replaceSegment(get().scenario, segmentId, (segment) =>
        segment.secondTask
          ? { ...segment, secondTask: { ...segment.secondTask, [key]: value } }
          : segment,
      );
      set(commit(next, get().activePlanId));
    },
    toggleHorizon() {
      const scenario = get().scenario;
      set(
        commit(
          updateSettings(scenario, (settings) => {
            if (settings.horizon) {
              const { horizon: _drop, ...rest } = settings;
              return rest;
            }
            return { ...settings, horizon: HORIZON_DEFAULT };
          }),
          get().activePlanId,
        ),
      );
    },
    setHorizonPeriods(periods) {
      if (!Number.isInteger(periods) || periods < 2 || periods > 12) return;
      set(
        commit(
          updateHorizon(get().scenario, (horizon) => ({
            ...horizon,
            periods,
            // Keep exactly one demand multiplier per period; new ones start neutral.
            seasonality: Array.from(
              { length: periods },
              (_, index) => horizon.seasonality[index] ?? "1",
            ),
          })),
          get().activePlanId,
        ),
      );
    },
    setHorizonSeasonality(index, value) {
      set(
        commit(
          updateHorizon(get().scenario, (horizon) => ({
            ...horizon,
            seasonality: horizon.seasonality.map((entry, position) =>
              position === index ? value : entry,
            ),
          })),
          get().activePlanId,
        ),
      );
    },
    setRatchetField(key, value) {
      set(
        commit(
          updateHorizon(get().scenario, (horizon) => ({
            ...horizon,
            ratchet: { ...horizon.ratchet, [key]: value },
          })),
          get().activePlanId,
        ),
      );
    },
    setHorizonResponse(response) {
      set(
        commit(
          updateHorizon(get().scenario, (horizon) => ({ ...horizon, response })),
          get().activePlanId,
        ),
      );
    },
    toggleTeam() {
      const scenario = get().scenario;
      set(
        commit(
          updateSettings(scenario, (settings) => {
            if (settings.team) {
              const { team: _drop, ...rest } = settings;
              return rest;
            }
            return { ...settings, team: TEAM_DEFAULT };
          }),
          get().activePlanId,
        ),
      );
    },
    setTeamMode(mode) {
      set(
        commit(
          updateTeam(get().scenario, (team) => ({
            ...team,
            mode,
            // Each mode carries its own parameters; write the one being switched to.
            ...(mode === "split"
              ? { split: team.split ?? { creditShare: "0.5" } }
              : { tournament: team.tournament ?? { prize: "20000", winners: 1 } }),
          })),
          get().activePlanId,
        ),
      );
    },
    setTeamSize(size) {
      if (!Number.isInteger(size) || size < 2 || size > 50) return;
      set(
        commit(
          updateTeam(get().scenario, (team) => ({
            ...team,
            size,
            ...(team.tournament
              ? {
                  tournament: {
                    ...team.tournament,
                    winners: Math.min(team.tournament.winners, size - 1),
                  },
                }
              : {}),
          })),
          get().activePlanId,
        ),
      );
    },
    setCreditShare(value) {
      set(
        commit(
          updateTeam(get().scenario, (team) => ({ ...team, split: { creditShare: value } })),
          get().activePlanId,
        ),
      );
    },
    setTournamentField(key, value) {
      set(
        commit(
          updateTeam(get().scenario, (team) => {
            const current = team.tournament ?? { prize: "20000", winners: 1 };
            if (key === "winners") {
              const winners = Number(value);
              if (!Number.isInteger(winners) || winners < 1 || winners > team.size - 1) return team;
              return { ...team, tournament: { ...current, winners } };
            }
            return { ...team, tournament: { ...current, prize: value } };
          }),
          get().activePlanId,
        ),
      );
    },
    toggleMenu() {
      const scenario = get().scenario;
      set(
        commit(
          updateSettings(scenario, (settings) => {
            if (settings.menu) {
              const { menu: _drop, ...rest } = settings;
              return rest;
            }
            return { ...settings, menu: MENU_DEFAULT };
          }),
          get().activePlanId,
        ),
      );
    },
    setMenuWalkAway(allowed) {
      set(
        commit(
          updateSettings(get().scenario, (settings) =>
            settings.menu ? { ...settings, menu: { walkAwayAllowed: allowed } } : settings,
          ),
          get().activePlanId,
        ),
      );
    },
    toggleObjective() {
      const scenario = get().scenario;
      set(
        commit(
          updateSettings(scenario, (settings) => {
            if (settings.objective) {
              const { objective: _drop, ...rest } = settings;
              return rest;
            }
            return { ...settings, objective: OBJECTIVE_DEFAULT };
          }),
          get().activePlanId,
        ),
      );
    },
    setObjectiveLimit(key, value) {
      set(
        commit(
          updateSettings(get().scenario, (settings) =>
            settings.objective
              ? { ...settings, objective: { ...settings.objective, [key]: value } }
              : settings,
          ),
          get().activePlanId,
        ),
      );
    },
    setSeasonality(value) {
      const scenario = get().scenario;
      const next: ScenarioJson = {
        ...scenario,
        settings: { ...scenario.settings, seasonality: value },
      };
      set(commit(next, get().activePlanId));
    },
    setNotes(notes) {
      const scenario = get().scenario;
      if (scenario.meta.notes === notes) return;
      const next: ScenarioJson = { ...scenario, meta: { ...scenario.meta, notes } };
      set(commit(next, get().activePlanId));
    },
    applyCalibration(proposals) {
      const updates = new Map(proposals.map((proposal) => [proposal.segmentId, proposal]));
      const next: ScenarioJson = {
        ...get().scenario,
        population: get().scenario.population.map((segment) => {
          const proposal = updates.get(segment.id);
          return proposal
            ? {
                ...segment,
                ...(proposal.ability ? { ability: proposal.ability } : {}),
                ...(proposal.noiseSD ? { noiseSD: proposal.noiseSD } : {}),
              }
            : segment;
        }),
      };
      set(commit(next, get().activePlanId));
    },
    mcResult: null,
    mcTornado: null,
    mcTornadoKpi: "totalComp",
    mcRunning: false,
    mcProgress: 0,
    mcError: null,
    setMcSeed(seed) {
      const scenario = get().scenario;
      if (!Number.isInteger(seed) || seed < 0 || seed > 2 ** 32 - 1) return;
      const next: ScenarioJson = {
        ...scenario,
        settings: { ...scenario.settings, mc: { ...scenario.settings.mc, seed } },
      };
      set(commit(next, get().activePlanId));
    },
    setMcN(N) {
      const scenario = get().scenario;
      if (!Number.isInteger(N) || N < 100 || N > 5000) return;
      const next: ScenarioJson = {
        ...scenario,
        settings: { ...scenario.settings, mc: { ...scenario.settings.mc, N } },
      };
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
      stopMcTimer();
      const runId = mcRunId;
      const run = createMonteCarloRun(domain);
      set({ mcRunning: true, mcProgress: 0, mcError: null, mcResult: null, mcTornado: null });
      const drive = (): void => {
        if (runId !== mcRunId || get().domain !== domain) return;
        try {
          const deadline = performance.now() + 35;
          do run.step(1);
          while (run.completed < run.total && performance.now() < deadline);
          set({ mcProgress: run.completed });
          if (run.completed < run.total) {
            mcTimer = setTimeout(drive, 0);
            return;
          }
          const result = run.result();
          const tornado = computeTornado(domain, get().mcTornadoKpi);
          if (runId === mcRunId) {
            mcTimer = null;
            set({
              mcRunning: false,
              mcProgress: run.total,
              mcResult: result,
              mcTornado: tornado,
              mcError: null,
            });
          }
        } catch (error) {
          if (runId !== mcRunId) return;
          const message = error instanceof EngineError ? error.message : "Monte Carlo failed.";
          set({ mcRunning: false, mcProgress: 0, mcError: message });
        }
      };
      mcTimer = setTimeout(drive, 0);
    },
    cancelMonteCarlo() {
      stopMcTimer();
      set({ mcRunning: false, mcProgress: 0, mcError: null });
    },
  };
});

export function selectTemplates(): readonly TemplateEntry[] {
  return templates;
}

export function findIssuesForPath(state: Pick<StoreState, "issues">, prefix: string): FieldIssue[] {
  return state.issues.filter(
    (issue) => issue.path === prefix || issue.path.startsWith(`${prefix}.`),
  );
}
