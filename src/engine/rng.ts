const INCREMENT = 0x9e3779b97f4a7c15n;
const MASK64 = 0xffffffffffffffffn;

function mix(state: bigint): bigint {
  let z = state;
  z = ((z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n) & MASK64;
  z = ((z ^ (z >> 27n)) * 0x94d049bb133111ebn) & MASK64;
  z = (z ^ (z >> 31n)) & MASK64;
  return z;
}

export interface SplitMix64 {
  nextUint64(): bigint;
  nextFloat(): number;
}

export function createSplitMix64(seed: number): SplitMix64 {
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) throw new RangeError("Seed must be a uint32 integer.");
  let state = BigInt(seed);
  return {
    nextUint64(): bigint {
      state = (state + INCREMENT) & MASK64;
      return mix(state);
    },
    nextFloat(): number {
      const value = this.nextUint64();
      return Number(value >> 11n) / 2 ** 53;
    },
  };
}
