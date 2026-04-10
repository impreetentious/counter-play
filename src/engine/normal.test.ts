import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { logNormalCdf, normalCdf, normalInv, normalPdf, truncatedNormalMoments } from "./normal";

describe("normal numerics", () => {
  it("matches the §3.8 CDF and log-CDF micro-oracles", () => {
    expect(normalCdf(0)).toBeCloseTo(0.5, 12);
    expect(normalCdf(1)).toBeCloseTo(0.841344746069, 12);
    expect(normalCdf(2)).toBeCloseTo(0.977249868052, 12);
    expect(normalCdf(3)).toBeCloseTo(0.998650101968, 12);
    expect(normalCdf(0.5)).toBeCloseTo(0.691462461274, 12);
    expect(logNormalCdf(-6)).toBeCloseTo(-20.736768949975, 9);
    expect(logNormalCdf(-10)).toBeCloseTo(-53.231285150512, 9);
    expect(logNormalCdf(-20)).toBeCloseTo(-203.917155371097, 9);
    expect(logNormalCdf(-40)).toBeCloseTo(-804.608442014, 6);
    expect(normalInv(0.5)).toBeCloseTo(0, 10);
    expect(normalInv(0.975)).toBeCloseTo(1.95996398454, 10);
    expect(normalInv(0.99)).toBeCloseTo(2.326347874041, 10);
  });

  it("preserves CDF symmetry, quadrature, and inverse round trips on contract domains", () => {
    fc.assert(
      fc.property(fc.double({ min: -37.5, max: 37.5, noNaN: true }), (z) => {
        expect(normalCdf(-z)).toBeCloseTo(1 - normalCdf(z), 14);
      }),
    );
    fc.assert(
      fc.property(
        fc.double({ min: -8, max: 7.9, noNaN: true }),
        fc.double({ min: -7.9, max: 8, noNaN: true }),
        (left, right) => {
          const lo = Math.min(left, right);
          const hi = Math.max(left, right) + 1e-5;
          const steps = 4_000;
          const width = (hi - lo) / steps;
          let sum = normalPdf(lo) + normalPdf(hi);
          for (let index = 1; index < steps; index += 1)
            sum += (index % 2 === 0 ? 2 : 4) * normalPdf(lo + index * width);
          expect(Math.abs(normalCdf(hi) - normalCdf(lo) - (sum * width) / 3)).toBeLessThan(1e-10);
        },
      ),
    );
    fc.assert(
      fc.property(fc.double({ min: 1e-12, max: 1 - 1e-12, noNaN: true }), (p) => {
        expect(normalCdf(normalInv(p))).toBeCloseTo(p, 11);
      }),
    );
  });

  it("computes truncated moments with the point-mass fallback", () => {
    const point = truncatedNormalMoments(3, 0, 0, 4);
    expect(point).toEqual({ probability: 1, first: 3, second: 9 });
    const whole = truncatedNormalMoments(2, 3, -Infinity, Infinity);
    expect(whole.probability).toBeCloseTo(1, 12);
    expect(whole.first).toBeCloseTo(2, 12);
    expect(whole.second).toBeCloseTo(13, 12);
  });
});
