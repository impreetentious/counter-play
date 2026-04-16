import { describe, expect, it } from "vitest";
import { lintScenario, type FindingType } from "@/engine/linter";
import { computeSorting } from "@/engine/sorting";
import { simulate } from "@/engine/simulate";
import { casebook } from "./casebook";
import { parseScenario, serializeScenario } from "./schema";

/**
 * The casebook is a regression corpus as well as an essay. Each entry declares the rules its
 * encoding is designed to fire; if the engine stops firing them, either a rule changed or the
 * episode no longer demonstrates what it claims — and both are things to find out here.
 */
describe("casebook", () => {
  it.each(casebook.map((entry) => [entry.id, entry] as const))(
    "%s round-trips through the wire boundary",
    (_id, entry) => {
      const domain = parseScenario(entry.scenario);
      expect(serializeScenario(domain)).toEqual(entry.scenario);
    },
  );

  it.each(casebook.map((entry) => [entry.id, entry] as const))(
    "%s simulates with every identity holding",
    (_id, entry) => {
      const result = simulate(parseScenario(entry.scenario));
      expect(result.attestations.every((attestation) => attestation.pass)).toBe(true);
    },
  );

  it.each(casebook.map((entry) => [entry.id, entry] as const))(
    "%s fires exactly the rules its essay claims",
    (_id, entry) => {
      const findings = lintScenario(parseScenario(entry.scenario));
      const fired = [...new Set(findings.map((finding) => finding.type))].sort();
      const expected = [...new Set<FindingType>(entry.expects)].sort();
      expect(fired).toEqual(expected);
    },
  );

  /**
   * Steenburgh's whole point is the decomposition, so the episode has to be able to run it.
   * Opening the timing channel is the experiment: the effort finding survives and no timing
   * finding joins it, because every segment already sits on the threshold in both periods and
   * moving an order could only cost one of the two bonuses. The response is effort.
   */
  it("shows the Steenburgh response is effort even once timing is possible", () => {
    const entry = casebook.find((item) => item.id === "steenburgh-2008")!;
    const withTiming = {
      ...entry.scenario,
      population: entry.scenario.population.map((segment) => ({ ...segment, movable: "0.3" })),
    };
    const fired = new Set(lintScenario(parseScenario(withTiming)).map((finding) => finding.type));
    expect(fired.has("L-2")).toBe(true);
    expect(fired.has("L-7")).toBe(false);
  });

  /** Lazear's sorting result is the episode's whole claim, so it is asserted, not narrated. */
  it("sorts the Safelite population onto the plan each half prefers", () => {
    const entry = casebook.find((item) => item.id === "lazear-2000")!;
    const sorting = computeSorting(parseScenario(entry.scenario));
    const byId = Object.fromEntries(
      sorting.choices.map((choice) => [choice.segmentId, choice.chosenPlanId]),
    );
    expect(byId["seg-1"]).toBe("piece-rate");
    expect(byId["seg-2"]).toBe("salary");
    expect(sorting.deadOptions).toEqual([]);
  });

  it("keeps every essay field written", () => {
    for (const entry of casebook) {
      expect(entry.title.length).toBeGreaterThan(0);
      expect(entry.citation.length).toBeGreaterThan(0);
      expect(entry.finding.length).toBeGreaterThan(80);
      expect(entry.encoding.length).toBeGreaterThan(80);
      expect(entry.tryThis.length).toBeGreaterThan(80);
    }
  });
});
