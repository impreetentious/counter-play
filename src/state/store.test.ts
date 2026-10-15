import { loadPersistedScenario, persistScenario } from "./persist";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseScenario } from "./schema";
import { templateT1, templateT2 } from "./templates";
import { useScenarioStore } from "./store";

function resetStore(): void {
  useScenarioStore.setState({
    scenario: templateT1,
    domain: parseScenario(templateT1),
    domainError: null,
    issues: [],
    activePlanId: "plan-1",
    historyPast: [],
    historyFuture: [],
    hydrated: true,
  });
}

describe("scenario history", () => {
  beforeEach(resetStore);

  it("undoes and redoes the same validated wire snapshot", () => {
    const store = useScenarioStore.getState();
    store.setTierField("plan-1", 0, "rate", "0.09");
    expect(useScenarioStore.getState().scenario.plans[0]?.tiers[0]?.rate).toBe("0.09");
    expect(useScenarioStore.getState().historyPast).toHaveLength(1);

    useScenarioStore.getState().undo();
    expect(useScenarioStore.getState().scenario.plans[0]?.tiers[0]?.rate).toBe("0.08");
    expect(useScenarioStore.getState().historyFuture).toHaveLength(1);

    useScenarioStore.getState().redo();
    expect(useScenarioStore.getState().scenario.plans[0]?.tiers[0]?.rate).toBe("0.09");
  });

  it("does not put locale-only presentation state in scenario history", () => {
    useScenarioStore.getState().setLocale("de-DE");
    expect(useScenarioStore.getState().scenario.settings.locale).toBe("de-DE");
    expect(useScenarioStore.getState().historyPast).toHaveLength(0);
  });

  it("clears the Monte Carlo run flags when undo and redo interrupt a run", () => {
    useScenarioStore.getState().setTierField("plan-1", 0, "rate", "0.09");

    useScenarioStore.getState().runMonteCarloAction();
    expect(useScenarioStore.getState().mcRunning).toBe(true);

    // Undo cancels the pending run; leaving mcRunning set would strand the panel on "Running…"
    // with its Run button disabled, because the cancelled run can never clear the flag itself.
    useScenarioStore.getState().undo();
    expect(useScenarioStore.getState().mcRunning).toBe(false);
    expect(useScenarioStore.getState().mcProgress).toBe(0);

    useScenarioStore.getState().runMonteCarloAction();
    expect(useScenarioStore.getState().mcRunning).toBe(true);

    useScenarioStore.getState().redo();
    expect(useScenarioStore.getState().mcRunning).toBe(false);
    expect(useScenarioStore.getState().mcProgress).toBe(0);
  });
});

describe("plan editing", () => {
  beforeEach(resetStore);

  /**
   * The tier step is exact for the same reason every other wire value is: a float `1.4 + 0.2`
   * renders as 1.5999999999999999, which §3.0's 15-significand-digit rule rejects — and 1.4 is
   * the last tier edge of the template the workspace opens on, so the default scenario plus one
   * click was enough to invalidate it.
   */
  it("appends a tier edge that is still an exact wire decimal", () => {
    useScenarioStore.getState().replaceScenario(templateT2);
    useScenarioStore.getState().addTier("plan-1");

    const state = useScenarioStore.getState();
    expect(state.scenario.plans[0]?.tiers.at(-1)?.from).toBe("1.6");
    expect(state.domainError).toBeNull();
    expect(state.issues).toEqual([]);
    expect(state.domain).not.toBeNull();
  });
});

describe("revision-bound optimizer proposals", () => {
  beforeEach(resetStore);
  function proposal() {
    const state = useScenarioStore.getState();
    return {
      revision: state.revision,
      planId: state.activePlanId,
      tierFrom: state.scenario.plans[0]!.tiers.map((tier) => tier.from),
      rates: state.scenario.plans[0]!.tiers.map(() => "0.09"),
    };
  }
  it("applies a complete current suggestion once", () => {
    const captured = proposal();
    expect(useScenarioStore.getState().applyOptimizedPlanRates(captured)).toBe(true);
    const scenario = useScenarioStore.getState().scenario;
    expect(useScenarioStore.getState().applyOptimizedPlanRates(captured)).toBe(false);
    expect(useScenarioStore.getState().scenario).toBe(scenario);
  });
  it("rejects every obsolete scenario revision, including a restored identical scenario", () => {
    for (const edit of [
      () => useScenarioStore.getState().setNotes("label edit"),
      () => useScenarioStore.getState().applyStressPreset("tight-cap"),
      () => useScenarioStore.getState().replaceScenario(templateT2),
      () => {
        useScenarioStore.getState().setTierField("plan-1", 0, "rate", "0.1");
        useScenarioStore.getState().undo();
      },
      () => useScenarioStore.getState().setLocale("de-DE"),
    ]) {
      resetStore();
      const captured = proposal();
      edit();
      expect(useScenarioStore.getState().applyOptimizedPlanRates(captured)).toBe(false);
    }
  });
  it("refuses wrong plan, missing rates, malformed rates and reordered tiers without mutation", () => {
    for (const patch of [
      { planId: "absent" },
      { rates: [] },
      { rates: ["NaN"] },
      { rates: ["-1"] },
      { tierFrom: ["99"] },
    ]) {
      const captured = { ...proposal(), ...patch };
      const before = useScenarioStore.getState().scenario;
      expect(useScenarioStore.getState().applyOptimizedPlanRates(captured)).toBe(false);
      expect(useScenarioStore.getState().scenario).toBe(before);
    }
    const captured = proposal();
    useScenarioStore.getState().setActiveSurface("Analyze");
    expect(useScenarioStore.getState().applyOptimizedPlanRates(captured)).toBe(true);
  });
});

describe("recoverable autosave", () => {
  beforeEach(() => {
    resetStore();
    useScenarioStore.setState({ hydrated: false, recoveryBytes: null, persistenceError: null });
  });
  afterEach(() => vi.unstubAllGlobals());
  it("keeps absent, invalid, unavailable and valid reads distinct without hydration writes", () => {
    let saved: string | null = null;
    const write = vi.fn();
    vi.stubGlobal("window", { localStorage: { getItem: () => saved, setItem: write } });
    expect(loadPersistedScenario().kind).toBe("absent");
    saved = "{";
    const unreadable = loadPersistedScenario();
    expect(unreadable.kind).toBe("invalid");
    useScenarioStore.getState().hydrate(unreadable);
    expect(write).not.toHaveBeenCalled();
    useScenarioStore.getState().setNotes("keep editing");
    useScenarioStore.getState().retryPersistence();
    expect(write).not.toHaveBeenCalled();
    expect(useScenarioStore.getState().recoveryBytes).toBe("{");
    useScenarioStore.getState().retryPersistence(true);
    expect(write).toHaveBeenCalledOnce();
    expect(useScenarioStore.getState().recoveryBytes).toBeNull();
    saved = JSON.stringify(templateT1);
    expect(loadPersistedScenario().kind).toBe("valid");
    vi.stubGlobal("window", {
      get localStorage() {
        throw new Error("blocked");
      },
    });
    expect(loadPersistedScenario().kind).toBe("unavailable");
  });
  it("reports quota failure, keeps recovery bytes, and clears only after a successful write", () => {
    let fails = true;
    const write = vi.fn((_key: string, _value: string) => {
      if (fails) throw new Error("quota");
    });
    vi.stubGlobal("window", { localStorage: { getItem: () => "future", setItem: write } });
    useScenarioStore.getState().hydrate(loadPersistedScenario());
    useScenarioStore.getState().retryPersistence(true);
    expect(useScenarioStore.getState().recoveryBytes).toBe("future");
    expect(useScenarioStore.getState().persistenceError).toBe("quota");
    useScenarioStore.getState().setNotes("latest");
    fails = false;
    useScenarioStore.getState().retryPersistence(true);
    expect(JSON.parse(write.mock.calls.at(-1)![1]).meta.notes).toBe("latest");
    expect(useScenarioStore.getState().persistenceError).toBeNull();
    fails = true;
    expect(persistScenario(templateT1).ok).toBe(false);
    useScenarioStore.getState().setNotes("in memory");
    expect(useScenarioStore.getState().persistenceError).toBe("quota");
    expect(useScenarioStore.getState().scenario.meta.notes).toBe("in memory");
    fails = false;
    useScenarioStore.getState().retryPersistence();
    expect(useScenarioStore.getState().persistenceError).toBeNull();
  });
});
