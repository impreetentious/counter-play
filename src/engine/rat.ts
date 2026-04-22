import { EngineError } from "./errors";

const DECIMAL_RE = /^([+-]?)(\d+)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/;
const ZERO = BigInt(0);
const ONE = BigInt(1);
const TWO = BigInt(2);

function abs(value: bigint): bigint {
  return value < ZERO ? -value : value;
}

function gcd(left: bigint, right: bigint): bigint {
  let a = abs(left);
  let b = abs(right);
  while (b !== ZERO) {
    const next = a % b;
    a = b;
    b = next;
  }
  return a;
}

function pow10(exponent: number): bigint {
  if (!Number.isSafeInteger(exponent) || exponent < 0 || exponent > 1_000_000) {
    throw new EngineError("INVALID_INPUT", "Decimal exponent is outside the supported range.");
  }
  return BigInt(10) ** BigInt(exponent);
}

function powBigInt(base: bigint, exponent: number): bigint {
  if (!Number.isSafeInteger(exponent) || exponent < 0 || exponent > 1_000_000) {
    throw new EngineError("INVALID_INPUT", "Exponent is outside the supported range.");
  }
  return base ** BigInt(exponent);
}

/** Exact normalized bigint rational used by all deterministic engine paths. */
export class Rat {
  readonly n: bigint;
  readonly d: bigint;

  private constructor(numerator: bigint, denominator: bigint) {
    if (denominator === ZERO) {
      throw new EngineError("INVALID_INPUT", "A rational denominator cannot be zero.");
    }

    if (numerator === ZERO) {
      this.n = ZERO;
      this.d = ONE;
      return;
    }

    const sign = denominator < ZERO ? -ONE : ONE;
    const divisor = gcd(numerator, denominator);
    this.n = (numerator / divisor) * sign;
    this.d = abs(denominator / divisor);
  }

  static zero(): Rat {
    return new Rat(ZERO, ONE);
  }

  static one(): Rat {
    return new Rat(ONE, ONE);
  }

  static from(numerator: bigint | number, denominator: bigint | number = 1): Rat {
    if (typeof numerator === "number" && !Number.isSafeInteger(numerator)) {
      throw new EngineError("INVALID_INPUT", "Numeric rational numerators must be safe integers.");
    }
    if (typeof denominator === "number" && !Number.isSafeInteger(denominator)) {
      throw new EngineError(
        "INVALID_INPUT",
        "Numeric rational denominators must be safe integers.",
      );
    }
    return new Rat(BigInt(numerator), BigInt(denominator));
  }

  static fromDecimalString(input: string): Rat {
    const match = DECIMAL_RE.exec(input);
    if (!match) {
      throw new EngineError("INVALID_INPUT", `Invalid decimal string: ${input}`);
    }

    const sign = match[1] === "-" ? -ONE : ONE;
    const integerPart = match[2] ?? "0";
    const fractionPart = match[3] ?? "";
    const exponentText = match[4] ?? "0";
    const exponent = Number(exponentText);
    if (!Number.isSafeInteger(exponent)) {
      throw new EngineError("INVALID_INPUT", "Decimal exponent is outside the supported range.");
    }

    const digits = `${integerPart}${fractionPart}`;
    let numerator = sign * BigInt(digits);
    const scale = fractionPart.length - exponent;
    if (scale >= 0) {
      return new Rat(numerator, pow10(scale));
    }
    numerator *= pow10(-scale);
    return new Rat(numerator, ONE);
  }

  /** Converts the actual IEEE-754 bit pattern, never a decimal rendering, to a Rat. */
  static fromFloat64(value: number): Rat {
    if (!Number.isFinite(value)) {
      throw new EngineError("INVALID_INPUT", "Only finite float64 values can become rationals.");
    }
    if (value === 0) return Rat.zero();

    const buffer = new ArrayBuffer(8);
    const view = new DataView(buffer);
    view.setFloat64(0, value, false);
    const high = view.getUint32(0, false);
    const low = view.getUint32(4, false);
    const negative = high >>> 31 === 1;
    const exponentBits = (high >>> 20) & 0x7ff;
    const fraction = (BigInt(high & 0x000f_ffff) << BigInt(32)) | BigInt(low);

    let significand: bigint;
    let binaryExponent: number;
    if (exponentBits === 0) {
      significand = fraction;
      binaryExponent = -1074;
    } else {
      significand = (ONE << BigInt(52)) | fraction;
      binaryExponent = exponentBits - 1023 - 52;
    }

    let numerator = negative ? -significand : significand;
    if (binaryExponent >= 0) {
      numerator <<= BigInt(binaryExponent);
      return new Rat(numerator, ONE);
    }
    return new Rat(numerator, ONE << BigInt(-binaryExponent));
  }

  add(other: Rat): Rat {
    return new Rat(this.n * other.d + other.n * this.d, this.d * other.d);
  }

  sub(other: Rat): Rat {
    return new Rat(this.n * other.d - other.n * this.d, this.d * other.d);
  }

  mul(other: Rat): Rat {
    return new Rat(this.n * other.n, this.d * other.d);
  }

  div(other: Rat): Rat {
    if (other.n === ZERO) {
      throw new EngineError("INVALID_INPUT", "Cannot divide by zero.");
    }
    return new Rat(this.n * other.d, this.d * other.n);
  }

  neg(): Rat {
    return new Rat(-this.n, this.d);
  }

  abs(): Rat {
    return new Rat(abs(this.n), this.d);
  }

  cmp(other: Rat): -1 | 0 | 1 {
    const difference = this.n * other.d - other.n * this.d;
    return difference < ZERO ? -1 : difference > ZERO ? 1 : 0;
  }

  eq(other: Rat): boolean {
    return this.n === other.n && this.d === other.d;
  }

  lt(other: Rat): boolean {
    return this.cmp(other) < 0;
  }

  lte(other: Rat): boolean {
    return this.cmp(other) <= 0;
  }

  gt(other: Rat): boolean {
    return this.cmp(other) > 0;
  }

  gte(other: Rat): boolean {
    return this.cmp(other) >= 0;
  }

  min(other: Rat): Rat {
    return this.lte(other) ? this : other;
  }

  max(other: Rat): Rat {
    return this.gte(other) ? this : other;
  }

  toNumber(): number {
    const value = Number(this.n) / Number(this.d);
    if (!Number.isFinite(value)) {
      throw new EngineError("INTERNAL_INVARIANT", "Rational to float64 conversion overflowed.");
    }
    return value;
  }

  /** Exact finite decimal representation, only for terminating decimal denominators. */
  toDecimalString(): string {
    let denominator = this.d;
    let twos = 0;
    let fives = 0;
    while (denominator % TWO === ZERO) {
      denominator /= TWO;
      twos += 1;
    }
    while (denominator % BigInt(5) === ZERO) {
      denominator /= BigInt(5);
      fives += 1;
    }
    if (denominator !== ONE) {
      throw new EngineError(
        "INTERNAL_INVARIANT",
        "A non-terminating rational cannot be serialized as an exact decimal.",
      );
    }

    const scale = Math.max(twos, fives);
    let scaled = this.n;
    scaled *= powBigInt(TWO, scale - twos);
    scaled *= powBigInt(BigInt(5), scale - fives);
    const sign = scaled < ZERO ? "-" : "";
    let digits = abs(scaled).toString();
    if (scale === 0) return `${sign}${digits}`;
    digits = digits.padStart(scale + 1, "0");
    const whole = digits.slice(0, -scale);
    const fraction = digits.slice(-scale).replace(/0+$/, "");
    return fraction ? `${sign}${whole}.${fraction}` : `${sign}${whole}`;
  }

  /** Fixed decimal formatting with contract-required half-even rounding. */
  toFixed(decimalPlaces: number): string {
    if (!Number.isSafeInteger(decimalPlaces) || decimalPlaces < 0 || decimalPlaces > 1_000_000) {
      throw new EngineError("INVALID_INPUT", "Decimal places must be a non-negative safe integer.");
    }
    const scale = pow10(decimalPlaces);
    const unsignedNumerator = abs(this.n) * scale;
    let rounded = unsignedNumerator / this.d;
    const remainder = unsignedNumerator % this.d;
    const comparison = remainder * TWO - this.d;
    if (comparison > ZERO || (comparison === ZERO && rounded % TWO !== ZERO)) {
      rounded += ONE;
    }
    const sign = this.n < ZERO && rounded !== ZERO ? "-" : "";
    let digits = rounded.toString();
    if (decimalPlaces === 0) return `${sign}${digits}`;
    digits = digits.padStart(decimalPlaces + 1, "0");
    return `${sign}${digits.slice(0, -decimalPlaces)}.${digits.slice(-decimalPlaces)}`;
  }

  serialize(): string {
    return `${this.n}/${this.d}`;
  }
}

export const R0 = Rat.zero();
