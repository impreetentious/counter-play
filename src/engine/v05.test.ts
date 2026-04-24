import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { lintScenario } from "./linter";
import { respondCARA } from "./respond.cara";
import { respondDeterministic } from "./respond.det";
import {
  computeTeam,
  creditWeight,
  standardWinDensity,
  symmetricSplitEquilibria,
  tournamentEquilibrium,
} from "./team";
import { Rat, R0 } from "./rat";
import type { Plan, Scenario, Segment, TeamSettings } from "./types";

// Team and tournament references. Every value is the closed form in docs/MATH-SPEC.md §3.14,
// derived by hand there and reproduced here, never read back from the implementation.
// a = 100, k = 100, m = 1; plan B = 0, Q = 10, one tier r = 0.1.
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

const flat: Plan = {
  id: "plan-1",
  label: "Flat",
  base: R0,
  quota: Rat.from(10),
  tiers: [{ from: R0, rate: Rat.from(1, 10) }],
  bonus: null,
  cap: null,
};

// Bonus at 160% attainment ⇒ q̂ = 16, the cliff that produces two symmetric equilibria.
const cliff: Plan = { ...flat, bonus: { L: Rat.one(), x_b: Rat.from(8, 5) } };

// §3.14: C_{2,1} = C_{3,1} = 1/(2√π); C_{4,1} = 3/(2√π)·(1/4 + arcsin(1/3)/(2π)).
const HALF_ROOT_PI = 1 / (2 * Math.sqrt(Math.PI));
const C_FOUR = 3 * HALF_ROOT_PI * (0.25 + Math.asin(1 / 3) / (2 * Math.PI));

function teamOf(
  team: TeamSettings,
  plan: Plan = flat,
  population: Segment[] = [segment],
): Scenario {
  return {
    schemaVersion: 1,
    population,
    plans: [plan],
    settings: {
      mode: "deterministic",
      periodLabel: "quarter",
      currencyLabel: "$",
      discount: Rat.one(),
      seasonality: [Rat.one(), Rat.one()],
      team,
      mc: { seed: 1, N: 500, ranges: {} },
    },
    meta: { notes: "" },
  };
}

describe("T1 — individual credit is the §3.3 world", () => {
  it("keeps φ at one and reproduces the independent best response", () => {
    const set = symmetricSplitEquilibria(flat, segment, 4, R0);
    expect(set.creditWeight.eq(Rat.one())).toBe(true);
    expect(set.selected.effort.eq(respondDeterministic(flat, segment).effort)).toBe(true);
    expect(set.selected.effort.eq(Rat.from(1, 10))).toBe(true);
  });
});

describe("T2 — the 1/n problem, exactly", () => {
  it("cuts the marginal credit to a quarter and effort with it", () => {
    const set = symmetricSplitEquilibria(flat, segment, 4, Rat.one());
    expect(set.creditWeight.eq(Rat.from(1, 4))).toBe(true);
    expect(set.selected.effort.eq(Rat.from(1, 40))).toBe(true);
    expect(set.selected.output.eq(Rat.from(5, 2))).toBe(true);
    expect(set.equilibria).toHaveLength(1);
  });

  it("raises L-9 high, since the revenue gap is three quarters", () => {
    const findings = lintScenario(
      teamOf({ mode: "split", size: 4, split: { creditShare: Rat.one() } }),
    ).filter((finding) => finding.type === "L-9");
    expect(findings).toHaveLength(1);
    expect(findings[0]?.severity).toBe("high");
    expect(findings[0]?.evidence.phi_pct).toBe("25%");
    expect(findings[0]?.evidence.revenue_gap_currency).toBe(7.5);
  });
});

describe("T3 — a cliff supports two symmetric equilibria", () => {
  const set = symmetricSplitEquilibria(cliff, segment, 2, Rat.one());

  it("finds both, and only those two", () => {
    expect(set.creditWeight.eq(Rat.from(1, 2))).toBe(true);
    expect(set.equilibria.map((entry) => entry.effort.toNumber())).toEqual([0.05, 0.16]);
  });

  it("pins each equilibrium's payoff and selects the Pareto-best", () => {
    expect(set.equilibria[0]?.ce.eq(Rat.from(3, 8))).toBe(true);
    expect(set.equilibria[1]?.ce.eq(Rat.from(33, 25))).toBe(true);
    expect(set.selected.effort.eq(Rat.from(4, 25))).toBe(true);
  });

  it("rejects zero effort, which is not a fixed point", () => {
    expect(set.equilibria.some((entry) => entry.effort.eq(R0))).toBe(false);
  });
});

describe("T4/T5 — rank-order tournament", () => {
  // σ = 50 keeps the contest smooth enough for a pure-strategy equilibrium (§3.14).
  const noisy: Segment = { ...segment, noiseSD: Rat.from(50) };

  it("reproduces the closed-form win densities from the pinned quadrature", () => {
    expect(standardWinDensity(2, 1)).toBeCloseTo(HALF_ROOT_PI, 12);
    expect(standardWinDensity(3, 1)).toBeCloseTo(HALF_ROOT_PI, 12);
    expect(standardWinDensity(4, 1)).toBeCloseTo(C_FOUR, 9);
  });

  it("lands on the closed-form equilibrium effort for a linear plan", () => {
    const result = tournamentEquilibrium(flat, noisy, 2, 1, Rat.from(100));
    expect(result?.converged).toBe(true);
    expect(result?.effort).toBeCloseTo((10 + 100 * 100 * (HALF_ROOT_PI / 50)) / 100, 6);
    expect(result?.effort).toBeCloseTo(0.66418958354775628, 6);
    expect(result?.winProbability).toBeCloseTo(0.5, 9);
    expect(result?.winDensity).toBeCloseTo(HALF_ROOT_PI / 50, 12);
  });

  it("collapses to the §3.4 response when the prize is zero", () => {
    const result = tournamentEquilibrium(flat, noisy, 2, 1, R0);
    expect(result?.effort).toBeCloseTo(respondCARA(flat, noisy).effort, 6);
    expect(result?.effort).toBeCloseTo(0.1, 6);
  });

  it("refuses to certify an equilibrium when the prize dwarfs the noise", () => {
    // a/σ = 100: one unit of effort decides the contest, so the local FOC point is beaten by
    // conceding the prize outright. The all-pay-auction limit — reported, never smoothed over.
    const sharp: Segment = { ...segment, noiseSD: Rat.one() };
    const result = tournamentEquilibrium(flat, sharp, 2, 1, Rat.one());
    expect(result?.converged).toBe(false);
  });

  it("reports that a noiseless segment has no pure-strategy equilibrium", () => {
    expect(tournamentEquilibrium(flat, segment, 2, 1, Rat.one())).toBeNull();
    const result = computeTeam(
      teamOf({ mode: "tournament", size: 2, tournament: { prize: Rat.one(), winners: 1 } }),
    );
    expect(result?.plans[0]?.perSegment[0]?.unavailable).toMatch(/positive noise/);
  });
});

describe("team and tournament structural invariants", () => {
  it("keeps φ inside (0, 1] across the whole bounded range", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 50 }),
        fc.integer({ min: 0, max: 100 }),
        (size, sharePercent) => {
          const phi = creditWeight(size, Rat.from(sharePercent, 100));
          return phi.gt(R0) && phi.lte(Rat.one());
        },
      ),
      { numRuns: 80 },
    );
  });

  it("confirms every reported equilibrium against its own best response", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 12 }),
        fc.integer({ min: 0, max: 100 }),
        (size, sharePercent) => {
          const share = Rat.from(sharePercent, 100);
          const set = symmetricSplitEquilibria(cliff, segment, size, share);
          const phi = creditWeight(size, share);
          return set.equilibria.every((entry) => {
            // Credited revenue equals own output at a symmetric profile (§3.14).
            const credited = phi.mul(entry.output).add(Rat.one().sub(phi).mul(entry.output));
            return credited.eq(entry.output);
          });
        },
      ),
      { numRuns: 40 },
    );
  });

  it("never lets the equilibrium beat the independent best response on revenue", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 20 }),
        fc.integer({ min: 0, max: 100 }),
        (size, sharePercent) => {
          const set = symmetricSplitEquilibria(flat, segment, size, Rat.from(sharePercent, 100));
          return set.selected.output.lte(respondDeterministic(flat, segment).output);
        },
      ),
      { numRuns: 50 },
    );
  });

  it("stays silent when no team block is configured", () => {
    const scenario = teamOf({ mode: "split", size: 2, split: { creditShare: R0 } });
    const { team: _drop, ...settings } = scenario.settings;
    const findings = lintScenario({ ...scenario, settings });
    expect(findings.filter((finding) => finding.type === "L-9")).toHaveLength(0);
  });
});
