import { beforeEach, describe, expect, it } from "vitest";
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
