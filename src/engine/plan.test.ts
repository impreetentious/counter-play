import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { assertDecomposition, decompose, kinks, marginalRate, payout, segmentQuota } from "./plan";
import { Rat, R0 } from "./rat";
import type { Plan, Segment } from "./types";

const segment: Segment = {
  id: "seg-1", label: "Core", count: 1, ability: Rat.from(100), costK: Rat.from(100), riskAversion: R0,
  noiseSD: R0, reservationCE: R0, quotaMult: Rat.one(), valueQuality: Rat.one(), movable: R0,
};

const plan: Plan = {
  id: "plan-1", label: "Plan", base: Rat.from(10), quota: Rat.from(100),
  tiers: [{ from: R0, rate: Rat.from(1, 10) }, { from: Rat.one(), rate: Rat.from(1, 5) }],
  bonus: { L: Rat.from(7), x_b: Rat.from(6, 5) }, cap: Rat.from(3, 2),
};

describe("exact payout plan", () => {
  it("covers zero, kink, threshold, cap, post-cap, and negative output", () => {
    expect(payout(plan, segment, R0).serialize()).toBe("10/1");
    expect(payout(plan, segment, Rat.from(100)).serialize()).toBe("20/1");
    expect(marginalRate(plan, segment, Rat.from(100)).serialize()).toBe("1/5");
    expect(payout(plan, segment, Rat.from(120)).serialize()).toBe("31/1");
    expect(payout(plan, segment, Rat.from(150)).serialize()).toBe("37/1");
    expect(payout(plan, segment, Rat.from(180)).serialize()).toBe("37/1");
    expect(payout(plan, segment, Rat.from(-20)).serialize()).toBe("8/1");
  });

  it("keeps decompose exact and exposes all output kinks", () => {
    const result = decompose(plan, segment, Rat.from(120));
    expect(result.base.add(result.perTier[0] ?? R0).add(result.perTier[1] ?? R0).add(result.bonus).eq(result.total)).toBe(true);
    expect(kinks(plan, segment).map((value) => value.serialize())).toEqual(["100/1", "120/1", "150/1"]);
    assertDecomposition(plan, segment, Rat.from(120));
  });

  it("is nondecreasing and its non-bonus differences equal marginal partitions", () => {
    const continuous: Plan = { ...plan, bonus: null, cap: null };
    fc.assert(fc.property(fc.integer({ min: -500, max: 500 }), fc.integer({ min: -500, max: 500 }), (left, right) => {
      const lo = Rat.from(Math.min(left, right));
      const hi = Rat.from(Math.max(left, right));
      expect(payout(continuous, segment, hi).gte(payout(continuous, segment, lo))).toBe(true);

      const split = [lo, ...kinks(continuous, segment).filter((kink) => kink.gt(lo) && kink.lt(hi)), hi];
      const integrated = split.slice(0, -1).reduce((sum, start, index) => {
        const end = split[index + 1];
        return end ? sum.add(end.sub(start).mul(marginalRate(continuous, segment, start))) : sum;
      }, R0);
      expect(payout(continuous, segment, hi).sub(payout(continuous, segment, lo)).eq(integrated)).toBe(true);
    }));
  });

  it("uses the segment-specific quota everywhere", () => {
    const adjusted = { ...segment, quotaMult: Rat.from(3, 2) };
    expect(segmentQuota(plan, adjusted).serialize()).toBe("150/1");
    expect(payout(plan, adjusted, Rat.from(150)).serialize()).toBe("25/1");
  });
});
