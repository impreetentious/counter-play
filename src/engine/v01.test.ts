import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { assertDecomposition, decompose, kinks, marginalRate, payout } from "./plan";
import { respondDeterministic } from "./respond.det";
import { respondCARA } from "./respond.cara";
import { checkStochasticPayoutConservation } from "./identity";
import { normalPdf } from "./normal";
import { Rat, R0 } from "./rat";
import type { Plan, PayoutExtras, Segment } from "./types";

// §12 V-01 payout-primitive goldens. Every value is hand-derived,
// not read back from the implementation (§9): a=100, k=100, Q_s=100, B=10, one tier r=0.1.
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

function withExtras(extras: Partial<PayoutExtras>): Plan {
  return {
    ...basePlan,
    extras: {
      drawNonRecoverable: null,
      drawRecoverable: null,
      spiff: null,
      clawback: null,
      payFloor: null,
      ...extras,
    },
  };
}

const q = (value: number) => Rat.from(value);

describe("V-01 exact payout primitives", () => {
  it("non-recoverable draw floors commission at D_nr", () => {
    const plan = withExtras({ drawNonRecoverable: Rat.from(20) });
    expect(payout(plan, segment, q(0)).serialize()).toBe("30/1"); // 10 + max(0,20)
    expect(payout(plan, segment, q(100)).serialize()).toBe("30/1"); // 10 + max(10,20)
    expect(payout(plan, segment, q(300)).serialize()).toBe("40/1"); // 10 + max(30,20)
    const d = decompose(plan, segment, q(100));
    expect(d.perTier[0]?.serialize()).toBe("10/1");
    expect(d.drawTopUp.serialize()).toBe("10/1");
    expect(marginalRate(plan, segment, q(100)).serialize()).toBe("0/1"); // draw plateau
    expect(marginalRate(plan, segment, q(300)).serialize()).toBe("1/10");
    expect(kinks(plan, segment).map((k) => k.serialize())).toEqual(["200/1"]); // C(q)=20 at q=200
    assertDecomposition(plan, segment, q(100));
  });

  it("SPIFF adds a lump above its threshold", () => {
    const plan = withExtras({ spiff: { amount: Rat.from(5), threshold: Rat.from(3, 2) } }); // q=150
    expect(payout(plan, segment, q(100)).serialize()).toBe("20/1"); // 10 + 10 + 0
    expect(payout(plan, segment, q(150)).serialize()).toBe("30/1"); // 10 + 15 + 5
    expect(payout(plan, segment, q(200)).serialize()).toBe("35/1"); // 10 + 20 + 5
    expect(decompose(plan, segment, q(150)).spiff.serialize()).toBe("5/1");
    expect(kinks(plan, segment).map((k) => k.serialize())).toEqual(["150/1"]);
    assertDecomposition(plan, segment, q(150));
  });

  it("clawback subtracts a lump below its threshold and stays nondecreasing", () => {
    const plan = withExtras({ clawback: { amount: Rat.from(8), threshold: Rat.from(1, 2) } }); // q=50
    expect(payout(plan, segment, q(0)).serialize()).toBe("2/1"); // 10 + 0 - 8
    expect(payout(plan, segment, q(40)).serialize()).toBe("6/1"); // 10 + 4 - 8
    expect(payout(plan, segment, q(50)).serialize()).toBe("15/1"); // 10 + 5 - 0
    expect(decompose(plan, segment, q(40)).clawback.serialize()).toBe("8/1");
    expect(kinks(plan, segment).map((k) => k.serialize())).toEqual(["50/1"]);
    // monotone across the clawback step
    expect(payout(plan, segment, q(49)).lt(payout(plan, segment, q(50)))).toBe(true);
    assertDecomposition(plan, segment, q(40));
  });

  it("pay-floor clamps W and replaces the negative tail", () => {
    const plan = withExtras({ payFloor: Rat.from(12) });
    expect(payout(plan, segment, q(0)).serialize()).toBe("12/1"); // max(10, 12)
    expect(payout(plan, segment, q(20)).serialize()).toBe("12/1"); // W_pre = 12 at q=20
    expect(payout(plan, segment, q(100)).serialize()).toBe("20/1"); // max(20, 12)
    expect(payout(plan, segment, q(-50)).serialize()).toBe("12/1"); // max(5, 12) — tail clamped
    const d = decompose(plan, segment, q(-50));
    expect(d.perTier[0]?.serialize()).toBe("-5/1");
    expect(d.floorTopUp.serialize()).toBe("7/1");
    expect(kinks(plan, segment).map((k) => k.serialize())).toEqual(["20/1"]); // W_pre = F at q=20
    assertDecomposition(plan, segment, q(-50));
  });

  it("primitives compose and conserve the exact identity", () => {
    const plan = withExtras({
      drawNonRecoverable: Rat.from(20),
      spiff: { amount: Rat.from(5), threshold: Rat.from(3, 2) },
      clawback: { amount: Rat.from(8), threshold: Rat.from(1, 2) },
      payFloor: Rat.from(12),
    });
    for (const value of [-50, 0, 40, 49, 50, 100, 150, 200, 300]) {
      assertDecomposition(plan, segment, q(value));
    }
    // nondecreasing on a wide integer grid
    fc.assert(
      fc.property(
        fc.integer({ min: -400, max: 400 }),
        fc.integer({ min: -400, max: 400 }),
        (left, right) => {
          const lo = q(Math.min(left, right));
          const hi = q(Math.max(left, right));
          expect(payout(plan, segment, hi).gte(payout(plan, segment, lo))).toBe(true);
        },
      ),
    );
  });
});

describe("V-01 deterministic best response", () => {
  it("a binding pay-floor drives effort to zero at ce = F", () => {
    const plan = withExtras({ payFloor: Rat.from(15) });
    const response = respondDeterministic(plan, segment);
    expect(response.effort.serialize()).toBe("0/1");
    expect(response.payout.serialize()).toBe("15/1");
    expect(response.ce.serialize()).toBe("15/1");
  });

  it("a non-binding pay-floor leaves the response unchanged", () => {
    const floored = respondDeterministic(withExtras({ payFloor: Rat.from(5) }), segment);
    const plain = respondDeterministic(basePlan, segment);
    expect(floored.effort.eq(plain.effort)).toBe(true); // e* = r·a/k = 0.1
    expect(floored.payout.eq(plain.payout)).toBe(true); // 10 + 1 = 11
  });

  it("recoverable draw is CE-neutral and reported as a cash-flow carry", () => {
    const plan = withExtras({ drawRecoverable: Rat.from(25) });
    const response = respondDeterministic(plan, segment);
    const plain = respondDeterministic(basePlan, segment);
    expect(response.effort.eq(plain.effort)).toBe(true); // W untouched → identical optimum
    expect(response.payout.eq(plain.payout)).toBe(true); // payout = 11 (variable pay = 1)
    expect(response.recoverableDraw?.advance.serialize()).toBe("25/1");
    expect(response.recoverableDraw?.carry.serialize()).toBe("24/1"); // max(25 - 1, 0)
  });
});

describe("V-01 stochastic path", () => {
  const stoch = (rho: number, sigma: number): Segment => ({
    ...segment,
    riskAversion: Rat.fromFloat64(rho),
    noiseSD: Rat.fromFloat64(sigma),
  });

  // Independent oracle for E[W]: fine midpoint quadrature of the exact payout against N(mean, sigma).
  function quadratureExpectedPayout(plan: Plan, seg: Segment, mean: number, sigma: number): number {
    const points = 120_000;
    const span = 12 * sigma;
    const step = (2 * span) / points;
    let total = 0;
    for (let index = 0; index < points; index += 1) {
      const value = mean - span + (index + 0.5) * step;
      const density = normalPdf((value - mean) / sigma) / sigma;
      total += payout(plan, seg, Rat.fromFloat64(value)).toNumber() * density * step;
    }
    return total;
  }

  it(
    "the analytic expected decomposition matches quadrature with all primitives active",
    { timeout: 30_000 },
    () => {
      const plan = withExtras({
        drawNonRecoverable: Rat.from(20),
        spiff: { amount: Rat.from(5), threshold: Rat.from(3, 2) },
        clawback: { amount: Rat.from(8), threshold: Rat.from(1, 2) },
        payFloor: Rat.from(12),
      });
      const seg = stoch(0.01, 25);
      const response = respondCARA(plan, seg);
      const oracle = quadratureExpectedPayout(plan, seg, response.output, response.sigma);
      expect(response.decomposition.total).toBeCloseTo(oracle, 1); // abs ~0.05 on payouts ~O(30)
      // I-1 conservation over the parts
      checkStochasticPayoutConservation([
        { count: 1, payout: response.payout, decomposition: response.decomposition },
      ]);
    },
  );

  it("expected recoverable carry matches quadrature", { timeout: 30_000 }, () => {
    const plan = withExtras({ drawRecoverable: Rat.from(40) });
    const seg = stoch(0.005, 30);
    const response = respondCARA(plan, seg);
    // E[(D_r + B - W)^+] by quadrature
    const points = 120_000;
    const span = 12 * response.sigma;
    const step = (2 * span) / points;
    let carry = 0;
    for (let index = 0; index < points; index += 1) {
      const value = response.output - span + (index + 0.5) * step;
      const density = normalPdf((value - response.output) / response.sigma) / response.sigma;
      const shortfall = Math.max(0, 40 + 10 - payout(plan, seg, Rat.fromFloat64(value)).toNumber());
      carry += shortfall * density * step;
    }
    expect(response.recoverableDraw?.advance).toBe(40);
    expect(response.recoverableDraw?.carry ?? 0).toBeCloseTo(carry, 1);
  });
});
