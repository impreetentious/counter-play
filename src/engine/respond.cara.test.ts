import { describe, expect, it } from "vitest";
import { respondCARA } from "./respond.cara";
import { Rat, R0 } from "./rat";
import type { Plan, Segment } from "./types";

function linearPlan(rate: number): Plan {
  return {
    id: "plan-1",
    label: "Linear",
    base: R0,
    quota: Rat.one(),
    tiers: [{ from: R0, rate: Rat.fromFloat64(rate) }],
    bonus: null,
    cap: null,
  };
}

function segment(a: number, k: number, sigma: number, rho: number): Segment {
  return {
    id: "seg-1",
    label: "Segment",
    count: 1,
    ability: Rat.fromFloat64(a),
    costK: Rat.fromFloat64(k),
    riskAversion: Rat.fromFloat64(rho),
    noiseSD: Rat.fromFloat64(sigma),
    reservationCE: R0,
    quotaMult: Rat.one(),
    valueQuality: Rat.one(),
    movable: R0,
  };
}

describe("CARA-normal response oracles", () => {
  it("O-B1: preserves the linear e*=βa/k matrix", () => {
    const tuples: Array<[number, number, number, number]> = [
      [100, 1, 0.01, 1e-3],
      [50, 2, 5, 0.02],
      [1, 1, 1, 1],
    ];
    for (const [a, k, sigma, rho] of tuples) {
      for (const beta of [0.05, 0.1, 0.5]) {
        const response = respondCARA(linearPlan(beta), segment(a, k, sigma, rho));
        expect(response.effort).toBeCloseTo((beta * a) / k, 12);
      }
    }
  });

  it("uses the numerical CARA optimizer when a single-tier plan has a SPIFF", () => {
    const plan: Plan = {
      ...linearPlan(0.1),
      extras: {
        drawNonRecoverable: null,
        drawRecoverable: null,
        spiff: { amount: Rat.from(100), threshold: Rat.from(15) },
        clawback: null,
        payFloor: null,
      },
    };
    const closedFormEffort = 0.1;
    const response = respondCARA(plan, segment(100, 100, 1, 0.001));
    expect(response.effort).toBeGreaterThan(closedFormEffort);
  });

  it("O-B2: engine-side surplus peaks nearest the Holmstrom-Milgrom beta", () => {
    for (const [a, k, sigma, rho, optimum] of [
      [1, 1, 1, 1, 0.5],
      [2, 0.5, 2, 0.25, 8 / 9],
    ] as const) {
      const values = Array.from({ length: 99 }, (_, index) => (index + 1) / 100).map((beta) => {
        const response = respondCARA(linearPlan(beta), segment(a, k, sigma, rho));
        const surplus = response.output - response.payout + response.ce;
        return { beta, surplus };
      });
      const best = [...values].sort((left, right) => right.surplus - left.surplus)[0];
      expect(best?.beta).toBeCloseTo(Math.round(optimum * 100) / 100, 12);
    }
  });

  it("O-B3 and O-H: the ceiling covers distant optima and continuous plans converge", () => {
    const distant = respondCARA(linearPlan(0.1), segment(100, 1, 0.01, 1e-3));
    expect(distant.eMax).toBeGreaterThanOrEqual(10);
    expect(distant.effort).toBeCloseTo(10, 12);

    const continuous = linearPlan(0.08);
    expect(respondCARA(continuous, segment(900_000, 70_000, 0.9, 8e-5)).effort).toBeCloseTo(
      72 / 70,
      12,
    );
    expect(respondCARA(continuous, segment(900_000, 70_000, 140_000, 1e-9)).effort).toBeCloseTo(
      72 / 70,
      12,
    );
  });

  it("preserves the expected payout decomposition and piece probabilities", () => {
    const plan: Plan = {
      id: "plan-1",
      label: "Tiered",
      base: Rat.from(10),
      quota: Rat.from(100),
      tiers: [
        { from: R0, rate: Rat.from(1, 10) },
        { from: Rat.one(), rate: Rat.from(1, 5) },
      ],
      bonus: { L: Rat.from(7), x_b: Rat.from(6, 5) },
      cap: Rat.from(3, 2),
    };
    const response = respondCARA(plan, segment(100, 100, 25, 0.01));
    const reconstructed =
      response.decomposition.base +
      response.decomposition.perTier.reduce((sum, value) => sum + value, 0) +
      response.decomposition.bonus;
    expect(reconstructed).toBeCloseTo(response.payout, 9);
    expect(response.pieceProbabilities.reduce((sum, value) => sum + value, 0)).toBeCloseTo(1, 12);
  });
});
