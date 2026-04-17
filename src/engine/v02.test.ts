import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { checkPayoutConservation } from "./identity";
import { respondCARA } from "./respond.cara";
import { respondDeterministic } from "./respond.det";
import { simulateDeterministic } from "./simulate";
import { softmaxProbabilitiesExact } from "./softmax";
import { computeTiming } from "./timing";
import { Rat, R0 } from "./rat";
import type { Plan, Rationality, Scenario, Segment } from "./types";

// §12 V-02 bounded-rationality goldens. Every value is the closed form pinned in docs/MATH-SPEC.md §3.3a,
// evaluated independently — never read back from the implementation (§9).
// a = 100, k = 100, Q_s = 100, B = 10, one tier r = 0.1 ⇒ C = {0, 0.1}, f = (10, 10.5).
const segment: Segment = {
  id: "seg-1",
  label: "Core",
  count: 1,
  ability: Rat.from(100),
  costK: Rat.from(100),
  riskAversion: R0,
  noiseSD: R0,
  reservationCE: R0,
  quotaMult: Rat.one(),
  valueQuality: Rat.one(),
  movable: R0,
};

const basePlan: Plan = {
  id: "plan-1",
  label: "Base",
  base: Rat.from(10),
  quota: Rat.from(100),
  tiers: [{ from: R0, rate: Rat.from(1, 10) }],
  bonus: null,
  cap: null,
};

// C = {0, 0.1, 1}: the bonus threshold q = 100 adds a third salient play with f(1) = 10.
const cliffPlan: Plan = { ...basePlan, bonus: { L: Rat.from(40), x_b: Rat.one() } };

const softmax = (tau: Rat): Rationality => ({ mode: "softmax", tau });
const HALF = Rat.from(1, 2);

// Closed forms from §3.3a, gap 0.5 at τ = 0.5 ⇒ weights (e⁻¹, 1).
const P_ZERO = 0.2689414213699951;
const P_FOC = 0.7310585786300049;
const P3_TAIL = 0.21194155761708544;
const P3_FOC = 0.57611688476582912;

function scenarioWith(plan: Plan, rationality: Rationality | null): Scenario {
  return {
    schemaVersion: 1,
    population: [segment],
    plans: [plan],
    settings: {
      mode: "deterministic",
      periodLabel: "quarter",
      currencyLabel: "$",
      discount: Rat.one(),
      seasonality: [Rat.one(), Rat.one()],
      ...(rationality ? { rationality } : {}),
      mc: { seed: 1, N: 500, ranges: {} },
    },
    meta: { notes: "" },
  };
}

describe("V-02 softmax weights", () => {
  it("normalizes exactly, so the probabilities sum to one in rationals", () => {
    const probabilities = softmaxProbabilitiesExact([Rat.from(10), Rat.from(21, 2)], HALF);
    expect(probabilities.reduce((sum, value) => sum.add(value), R0).eq(Rat.one())).toBe(true);
    expect(probabilities[0]?.toNumber()).toBeCloseTo(P_ZERO, 12);
    expect(probabilities[1]?.toNumber()).toBeCloseTo(P_FOC, 12);
  });

  it("flushes a play 64 temperatures below the best one to exactly zero", () => {
    const probabilities = softmaxProbabilitiesExact([R0, Rat.from(65)], Rat.one());
    expect(probabilities[0]?.eq(R0)).toBe(true);
    expect(probabilities[1]?.eq(Rat.one())).toBe(true);
  });

  it("sums to exactly one for any temperature and objective set", () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: -500, max: 500 }), { minLength: 1, maxLength: 12 }),
        fc.integer({ min: 1, max: 10_000 }),
        (values, tauScale) => {
          const probabilities = softmaxProbabilitiesExact(
            values.map((value) => Rat.from(value)),
            Rat.from(tauScale, 100),
          );
          expect(probabilities.reduce((sum, value) => sum.add(value), R0).eq(Rat.one())).toBe(true);
        },
      ),
    );
  });
});

describe("V-02 deterministic mixture (G1, G2)", () => {
  it("G1 — two salient plays split by the logistic", () => {
    const response = respondDeterministic(basePlan, segment, softmax(HALF));
    expect(response.components.map((component) => component.effort.serialize())).toEqual([
      "0/1",
      "1/10",
    ]);
    expect(response.components[0]?.probability.toNumber()).toBeCloseTo(P_ZERO, 12);
    expect(response.components[1]?.probability.toNumber()).toBeCloseTo(P_FOC, 12);
    expect(response.effort.toNumber()).toBeCloseTo(0.073105857863000487, 12);
    expect(response.payout.toNumber()).toBeCloseTo(10.731058578630005, 12);
    expect(response.ce.toNumber()).toBeCloseTo(10.365529289315003, 12);
    expect(response.ceGap.toNumber()).toBeCloseTo(0.13447071068499755, 12);
    expect(response.modal.effort.serialize()).toBe("1/10");
  });

  it("G2 — a bonus cliff adds a third play and the mixture spreads over it", () => {
    const response = respondDeterministic(cliffPlan, segment, softmax(HALF));
    expect(response.components.map((component) => component.effort.serialize())).toEqual([
      "0/1",
      "1/10",
      "1/1",
    ]);
    expect(response.components.map((component) => component.probability.toNumber())).toEqual([
      expect.closeTo(P3_TAIL, 12),
      expect.closeTo(P3_FOC, 12),
      expect.closeTo(P3_TAIL, 12),
    ]);
    expect(response.effort.toNumber()).toBeCloseTo(0.26955324609366837, 12);
    expect(response.payout.toNumber()).toBeCloseTo(21.173194765620103, 12);
    expect(response.ce.toNumber()).toBeCloseTo(10.288058442382916, 12);
    expect(response.ceGap.toNumber()).toBeCloseTo(0.21194155761708544, 12);
  });

  it("conserves the I-1 payout identity exactly across the mixture", () => {
    const response = respondDeterministic(cliffPlan, segment, softmax(HALF));
    const attestation = checkPayoutConservation([
      { count: 3, payout: response.payout, decomposition: response.decomposition },
    ]);
    expect(attestation.pass).toBe(true);
    expect(
      response.components
        .reduce((sum, component) => sum.add(component.probability), R0)
        .eq(Rat.one()),
    ).toBe(true);
  });
});

describe("V-02 temperature limits (G3)", () => {
  it("τ → 0⁺ reproduces the exact best response", () => {
    const cold = respondDeterministic(cliffPlan, segment, softmax(Rat.fromDecimalString("1e-9")));
    const exact = respondDeterministic(cliffPlan, segment);
    expect(cold.effort.eq(exact.effort)).toBe(true);
    expect(cold.payout.eq(exact.payout)).toBe(true);
    expect(cold.ce.eq(exact.ce)).toBe(true);
    expect(cold.ceGap.eq(R0)).toBe(true);
  });

  it("τ → ∞ approaches the uniform draw over the plan's salient plays", () => {
    const hot = respondDeterministic(cliffPlan, segment, softmax(Rat.from(1_000_000_000)));
    expect(hot.effort.toNumber()).toBeCloseTo(0.3666666666666667, 8);
    for (const component of hot.components)
      expect(component.probability.toNumber()).toBeCloseTo(1 / 3, 8);
  });

  it("the dial is off by default — no rationality block leaves every response untouched", () => {
    const plain = respondDeterministic(cliffPlan, segment);
    const explicit = respondDeterministic(cliffPlan, segment, {
      mode: "exact",
      tau: Rat.from(5000),
    });
    expect(plain.effort.eq(explicit.effort)).toBe(true);
    expect(plain.components).toHaveLength(1);
    expect(plain.components[0]?.probability.eq(Rat.one())).toBe(true);
    expect(plain.ceGap.eq(R0)).toBe(true);
  });
});

describe("V-02 population KPIs under a mixture", () => {
  it("G2 — quota attainment becomes the share of plays that clear quota", () => {
    const result = simulateDeterministic(scenarioWith(cliffPlan, softmax(HALF)));
    const kpis = result.plans[0]?.kpis;
    expect(kpis?.quotaAttainRate.toNumber()).toBeCloseTo(P3_TAIL, 12);
    // Payout point masses 10 / 11 / 60 carry weights p₀ / p₁ / p₂ (§3.5 lower quantile).
    expect(kpis?.payoutQuantiles.p10.serialize()).toBe("10/1");
    expect(kpis?.payoutQuantiles.p50.serialize()).toBe("11/1");
    expect(kpis?.payoutQuantiles.p90.serialize()).toBe("60/1");
    expect(result.attestations.every((attestation) => attestation.pass)).toBe(true);
  });

  it("leaves the exact-mode run byte-identical", () => {
    const dialed = simulateDeterministic(
      scenarioWith(cliffPlan, { mode: "exact", tau: Rat.from(5000) }),
    );
    const plain = simulateDeterministic(scenarioWith(cliffPlan, null));
    expect(dialed.plans[0]?.kpis.totalComp.eq(plain.plans[0]?.kpis.totalComp ?? R0)).toBe(true);
    expect(
      dialed.plans[0]?.kpis.quotaAttainRate.eq(plain.plans[0]?.kpis.quotaAttainRate ?? R0),
    ).toBe(true);
  });
});

describe("V-02 stochastic mixture (G4)", () => {
  const noisy: Segment = { ...segment, riskAversion: Rat.fromFloat64(0.01), noiseSD: Rat.from(25) };

  it("logits the §3.4 certainty equivalents over the same choice set", () => {
    const response = respondCARA(basePlan, noisy, softmax(HALF));
    // §3.4 anchor: CE(e) = B + βμ − ρβ²σ²/2 − ke²/2 with ρβ²σ²/2 = 0.03125.
    expect(response.components[0]?.objective).toBeCloseTo(9.96875, 9);
    expect(response.components[1]?.objective).toBeCloseTo(10.46875, 9);
    expect(response.components[1]?.probability).toBeCloseTo(P_FOC, 9);
    expect(response.effort).toBeCloseTo(0.073105857863000487, 9);
    expect(response.payout).toBeCloseTo(10.731058578630005, 9);
    expect(response.ce).toBeCloseTo(10.334279289315003, 9);
    expect(response.ceGap).toBeCloseTo(0.5 * P_ZERO, 9);
  });

  it("keeps I-2 piece probabilities summing to one across the mixture", () => {
    const response = respondCARA(cliffPlan, noisy, softmax(HALF));
    expect(response.pieceProbabilities.reduce((sum, value) => sum + value, 0)).toBeCloseTo(1, 12);
    expect(response.payoutVariance).toBeGreaterThan(0);
  });
});

describe("V-02 scope boundaries", () => {
  it("leaves the §3.10 timing module on the exact best response", () => {
    const dialed = computeTiming(scenarioWith(cliffPlan, softmax(HALF)));
    const exact = computeTiming(scenarioWith(cliffPlan, null));
    const dialedSegment = dialed.plans[0]?.perSegment[0];
    const exactSegment = exact.plans[0]?.perSegment[0];
    expect(dialedSegment?.e1.eq(exactSegment?.e1 ?? R0)).toBe(true);
    expect(dialedSegment?.zStar.eq(exactSegment?.zStar ?? R0)).toBe(true);
  });

  it("never reports a negative CE gap", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 100_000 }), (tauScale) => {
        const response = respondDeterministic(cliffPlan, segment, softmax(Rat.from(tauScale, 100)));
        expect(response.ceGap.gte(R0)).toBe(true);
      }),
    );
  });
});
