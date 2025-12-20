import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { respondDeterministic } from "./respond.det";
import { Rat, R0 } from "./rat";
import type { Plan, Segment } from "./types";

function segment(overrides: Partial<Segment> = {}): Segment {
  return {
    id: "seg-1", label: "Segment", count: 1, ability: Rat.from(100), costK: Rat.from(100), riskAversion: R0,
    noiseSD: R0, reservationCE: R0, quotaMult: Rat.one(), valueQuality: Rat.one(), movable: R0, ...overrides,
  };
}

function plan(overrides: Partial<Plan> = {}): Plan {
  return {
    id: "plan-1", label: "Plan", base: R0, quota: Rat.from(100), tiers: [{ from: R0, rate: Rat.from(1, 10) }],
    bonus: null, cap: null, ...overrides,
  };
}

describe("deterministic response oracles", () => {
  it("O-A: reproduces the linear closed form exactly", () => {
    const response = respondDeterministic(plan({ base: Rat.from(5) }), segment());
    expect(response.effort.serialize()).toBe("1/10");
    expect(response.output.serialize()).toBe("10/1");
    expect(response.payout.serialize()).toBe("6/1");
    expect(response.ce.serialize()).toBe("11/2");
  });

  it("O-C: chooses a profitable quota bonus kink and otherwise stays at the FOC", () => {
    const common = { quota: Rat.from(16), tiers: [{ from: R0, rate: Rat.from(1, 10) }], bonus: { L: Rat.one(), x_b: Rat.one() } };
    expect(respondDeterministic(plan(common), segment()).output.serialize()).toBe("16/1");
    expect(respondDeterministic(plan({ ...common, bonus: { L: Rat.from(1, 10), x_b: Rat.one() } }), segment()).output.serialize()).toBe("10/1");
  });

  it("O-D: stops exactly at a trailing zero-rate kink and rises under the live-rate counterfactual", () => {
    const stopped = plan({ quota: Rat.from(8), tiers: [{ from: R0, rate: Rat.from(1, 10) }, { from: Rat.one(), rate: R0 }] });
    const continued = plan({ quota: Rat.from(8), tiers: [{ from: R0, rate: Rat.from(1, 10) }] });
    const atCap = respondDeterministic(stopped, segment());
    expect(atCap.effort.serialize()).toBe("2/25");
    expect(atCap.marginalAtOpt.eq(R0)).toBe(true);
    expect(respondDeterministic(continued, segment()).effort.serialize()).toBe("1/10");
  });

  it("O-E: respects base invariance and rate comparative statics", () => {
    fc.assert(fc.property(fc.integer({ min: 1, max: 30 }), fc.integer({ min: 2, max: 10 }), (ratePercent, multiplier) => {
      const low = plan({ tiers: [{ from: R0, rate: Rat.from(ratePercent, 100) }] });
      const high = plan({ tiers: [{ from: R0, rate: Rat.from(ratePercent * multiplier, 100) }] });
      const lowResponse = respondDeterministic(low, segment());
      const highResponse = respondDeterministic(high, segment());
      expect(highResponse.effort.gte(lowResponse.effort)).toBe(true);
      const raisedBase = respondDeterministic({ ...low, base: Rat.from(999) }, segment());
      expect(raisedBase.effort.eq(lowResponse.effort)).toBe(true);
      expect(highResponse.ce.gte(lowResponse.ce)).toBe(true);
    }));
  });
});
