import { describe, expect, it } from "vitest";
import { decompose, payout } from "./plan";
import { checkPayoutConservation } from "./identity";
import { Rat, R0 } from "./rat";
import type { Plan, Segment } from "./types";

describe("I-1 payout conservation", () => {
  it("conserves weighted deterministic payouts exactly", () => {
    const segment: Segment = { id: "seg-1", label: "Core", count: 3, ability: Rat.from(1), costK: Rat.from(1), riskAversion: R0, noiseSD: R0, reservationCE: R0, quotaMult: Rat.one(), valueQuality: Rat.one(), movable: R0 };
    const plan: Plan = { id: "plan-1", label: "Flat", base: Rat.from(5), quota: Rat.from(10), tiers: [{ from: R0, rate: Rat.from(1, 10) }], bonus: null, cap: null };
    const output = Rat.from(20);
    expect(checkPayoutConservation([{ count: segment.count, payout: payout(plan, segment, output), decomposition: decompose(plan, segment, output) }])).toEqual({ id: "I-1", pass: true, maxErr: 0 });
  });
});
