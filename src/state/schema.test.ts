import { describe, expect, it } from "vitest";
import { EngineError } from "@/engine/errors";
import { allocateId, parseScenario, serializeScenario, type ScenarioJson } from "./schema";

const scenario: ScenarioJson = {
  schemaVersion: 1,
  population: [{
    id: "seg-1", label: "Core", count: 8, ability: "900000", costK: "70000", riskAversion: "8e-5",
    noiseSD: "140000", reservationCE: "75000", quotaMult: "1", valueQuality: "1", movable: "0.10",
  }],
  plans: [{
    id: "plan-1", label: "Tiered", base: "55000", quota: "900000",
    tiers: [{ from: "0", rate: "0.05" }, { from: "1", rate: "0.11" }], bonus: null, cap: null,
  }],
  settings: {
    mode: "deterministic", periodLabel: "year", currencyLabel: "$", discount: "1", seasonality: ["1", "1"],
    mc: { seed: 1, N: 500, ranges: {} },
  },
  meta: { notes: "" },
};

describe("scenario wire schema", () => {
  it("round-trips exact decimal input through the Rat domain", () => {
    const parsed = parseScenario(scenario);
    const wire = serializeScenario(parsed);
    expect(wire.population[0]?.movable).toBe("0.1");
    expect(wire.population[0]?.riskAversion).toBe("0.00008");
    expect(serializeScenario(parseScenario(wire))).toEqual(wire);
  });

  it("rejects malformed decimals, unsorted tiers, duplicate ids, and dangling range keys", () => {
    expect(() => parseScenario({ ...scenario, population: [{ ...scenario.population[0]!, ability: ".5" }] })).toThrow(EngineError);
    expect(() => parseScenario({ ...scenario, plans: [{ ...scenario.plans[0]!, tiers: [{ from: "0", rate: "0.1" }, { from: "0", rate: "0.2" }] }] })).toThrow(EngineError);
    expect(() => parseScenario({ ...scenario, population: [scenario.population[0]!, { ...scenario.population[0]!, label: "Duplicate" }] })).toThrow(EngineError);
    expect(() => parseScenario({
      ...scenario,
      settings: {
        ...scenario.settings,
        mc: { ...scenario.settings.mc, ranges: { perSegment: { "seg-99": { a: ["0.8", "1.2"] } } } },
      },
    })).toThrow(EngineError);
  });

  it("hard-rejects future wire versions with a friendly direction", () => {
    expect(() => parseScenario({ ...scenario, schemaVersion: 2 } as unknown)).toThrow("newer version of Counterplay");
  });

  it("allocates deterministic ids without time or randomness", () => {
    expect(allocateId("seg", ["seg-1", "seg-4", "imported"])).toBe("seg-5");
    expect(allocateId("plan", ["plan-x"])).toBe("plan-1");
  });

  it("round-trips V-01 payout extras and omits them when absent", () => {
    // absent extras stay absent on the wire (byte-stable for pre-V-01 scenarios)
    expect(serializeScenario(parseScenario(scenario)).plans[0]).not.toHaveProperty("extras");

    const withExtras: ScenarioJson = {
      ...scenario,
      plans: [{
        ...scenario.plans[0]!,
        extras: {
          drawNonRecoverable: "20000", spiff: { amount: "5000", threshold: "1.5" },
          clawback: { amount: "8000", threshold: "0.5" }, payFloor: "12000", drawRecoverable: "25000",
        },
      }],
    };
    const parsed = parseScenario(withExtras);
    expect(parsed.plans[0]?.extras?.spiff?.amount.toDecimalString()).toBe("5000");
    const wire = serializeScenario(parsed);
    expect(wire.plans[0]?.extras?.payFloor).toBe("12000");
    expect(serializeScenario(parseScenario(wire))).toEqual(wire);
  });

  it("round-trips the V-02 rationality dial and omits it when untouched", () => {
    // an untouched scenario never gains the block (byte-stable for pre-V-02 scenarios)
    expect(serializeScenario(parseScenario(scenario)).settings).not.toHaveProperty("rationality");

    const bounded: ScenarioJson = {
      ...scenario,
      settings: { ...scenario.settings, rationality: { mode: "softmax", tau: "5000" } },
    };
    const parsed = parseScenario(bounded);
    expect(parsed.settings.rationality?.mode).toBe("softmax");
    expect(parsed.settings.rationality?.tau.toDecimalString()).toBe("5000");
    const wire = serializeScenario(parsed);
    expect(wire.settings.rationality).toEqual({ mode: "softmax", tau: "5000" });
    expect(serializeScenario(parseScenario(wire))).toEqual(wire);
  });

  it("rejects a zero or negative temperature", () => {
    for (const tau of ["0", "-1"]) {
      expect(() => parseScenario({ ...scenario, settings: { ...scenario.settings, rationality: { mode: "softmax", tau } } })).toThrow(EngineError);
    }
  });

  it("validates extras bounds", () => {
    const bad: ScenarioJson = {
      ...scenario,
      plans: [{ ...scenario.plans[0]!, extras: { clawback: { amount: "8000", threshold: "0" } } }],
    };
    expect(() => parseScenario(bad)).toThrow(EngineError); // threshold must be > 0
  });
});
