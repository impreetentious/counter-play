import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { EngineError } from "./errors";
import { Rat } from "./rat";

const numerator = fc.integer({ min: -50_000, max: 50_000 });
const denominator = fc.integer({ min: -5_000, max: 5_000 }).filter((value) => value !== 0);

describe("Rat", () => {
  it("normalizes signs, zeros, and common divisors", () => {
    expect(Rat.from(6, -8).serialize()).toBe("-3/4");
    expect(Rat.from(0, -10).serialize()).toBe("0/1");
    expect(Rat.from(-12, -8).serialize()).toBe("3/2");
  });

  it("obeys core field axioms", () => {
    fc.assert(
      fc.property(numerator, denominator, numerator, denominator, (an, ad, bn, bd) => {
        const a = Rat.from(an, ad);
        const b = Rat.from(bn, bd);
        expect(a.add(b).sub(b).eq(a)).toBe(true);
        expect(a.mul(Rat.one()).eq(a)).toBe(true);
        expect(a.cmp(b) === 0).toBe(a.eq(b));
        expect(a.d > BigInt(0)).toBe(true);
      }),
    );
  });

  it("round-trips terminating decimals with canonical serialization", () => {
    expect(Rat.fromDecimalString("1.20").toDecimalString()).toBe("1.2");
    expect(Rat.fromDecimalString("+1e2").toDecimalString()).toBe("100");
    expect(() => Rat.fromDecimalString(".5")).toThrow(EngineError);
    expect(Rat.fromDecimalString("-0.125").toDecimalString()).toBe("-0.125");
    expect(Rat.fromFloat64(0.5).toDecimalString()).toBe("0.5");
  });

  it("uses half-even fixed formatting", () => {
    expect(Rat.from(5, 2).toFixed(0)).toBe("2");
    expect(Rat.from(7, 2).toFixed(0)).toBe("4");
    expect(Rat.from(-5, 2).toFixed(0)).toBe("-2");
    expect(Rat.from(1, 8).toFixed(2)).toBe("0.12");
  });

  it("rejects non-terminating exact decimal serialization", () => {
    expect(() => Rat.from(1, 3).toDecimalString()).toThrow(EngineError);
  });
});
