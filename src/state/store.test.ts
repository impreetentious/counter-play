import { beforeEach, describe, expect, it } from "vitest";
import { parseScenario } from "./schema";
import { templateT1 } from "./templates";
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
