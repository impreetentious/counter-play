import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { createSplitMix64 } from "./rng";

describe("splitmix64 RNG", () => {
  it("reproduces the pinned seed-42 uint64 stream", () => {
    const expected = [
      0xbdd732262feb6e95n,
      0x28efe333b266f103n,
      0x47526757130f9f52n,
      0x581ce1ff0e4ae394n,
      0x09bc585a244823f2n,
      0xde4431fa3c80db06n,
      0x37e9671c45376d5dn,
      0xccf635ee9e9e2fa4n,
    ];
    const rng = createSplitMix64(42);
    for (const value of expected) expect(rng.nextUint64()).toBe(value);
  });

  it("reproduces the pinned seed-42 float stream", () => {
    const rng = createSplitMix64(42);
    expect(rng.nextFloat()).toBeCloseTo(0.7415648787718233, 15);
    expect(rng.nextFloat()).toBeCloseTo(0.1599103928769201, 15);
  });

  it("loose uniformity: sample mean and variance track theoretical values", () => {
    fc.assert(fc.property(fc.integer({ min: 0, max: 0xffffffff }), (seed) => {
      const rng = createSplitMix64(seed);
      const n = 4096;
      let sum = 0;
      let sumSq = 0;
      for (let i = 0; i < n; i += 1) {
        const value = rng.nextFloat();
        sum += value;
        sumSq += value * value;
      }
      const mean = sum / n;
      const variance = sumSq / n - mean * mean;
      expect(Math.abs(mean - 0.5)).toBeLessThan(0.05);
      expect(Math.abs(variance - 1 / 12)).toBeLessThan(0.02);
    }), { numRuns: 6 });
  });
});
