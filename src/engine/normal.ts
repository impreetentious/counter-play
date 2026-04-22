const SQRT_2 = Math.SQRT2;
const SQRT_2PI = Math.sqrt(2 * Math.PI);
const LOG_SQRT_2PI = Math.log(SQRT_2PI);

const ERF_T = [
  9.60497373987051638749, 90.0260197203842693578, 2232.00534594684319226, 7003.32514112805075473,
  55592.3013010394962768,
];
const ERF_U = [
  33.5617141647503099647, 521.357949780152679795, 4594.32382970980127987, 22629.0000613890934246,
  49267.3942608635921086,
];
const ERFC_P = [
  2.46196981473530512524e-10, 0.564189564831068821977, 7.46321056442269912687,
  48.6371970985681366614, 196.520832956077098242, 526.445194995477734035, 934.52852717195760754,
  1027.55188689515710272, 557.535335353699327526,
];
const ERFC_Q = [
  13.2281951154744992508, 86.7072140885989742329, 354.937778887819891993, 975.708501743205489753,
  1823.90916687909736289, 2246.33760818710981792, 1656.66309194161350182, 557.535340817727675546,
];
const ERFC_R = [
  0.564189583547755073984, 1.27536670759978104416, 5.01905042251180477414, 6.16021097993053585195,
  7.4097426995044893916, 2.9788666537210024067,
];
const ERFC_S = [
  2.2605286322011727659, 9.39603524938001434673, 12.0489539808096656605, 17.0814450747565897222,
  9.60896809063285878198, 3.3690764510008151605,
];

function polevl(value: number, coefficients: readonly number[]): number {
  let answer = coefficients[0] ?? 0;
  for (let index = 1; index < coefficients.length; index += 1)
    answer = answer * value + (coefficients[index] ?? 0);
  return answer;
}

function p1evl(value: number, coefficients: readonly number[]): number {
  let answer = value + (coefficients[0] ?? 0);
  for (let index = 1; index < coefficients.length; index += 1)
    answer = answer * value + (coefficients[index] ?? 0);
  return answer;
}

/** Cephes/Cody-style complementary error function, accurate in both normal tails. */
function erfc(value: number): number {
  const x = Math.abs(value);
  if (x < 1) return 1 - erf(value);
  const exponent = -x * x;
  if (exponent < -745) return value < 0 ? 2 : 0;
  const numerator = x < 8 ? polevl(x, ERFC_P) : polevl(x, ERFC_R);
  const denominator = x < 8 ? p1evl(x, ERFC_Q) : p1evl(x, ERFC_S);
  const answer = (Math.exp(exponent) * numerator) / denominator;
  return value < 0 ? 2 - answer : answer;
}

function erf(value: number): number {
  const x = Math.abs(value);
  if (x > 1) return 1 - erfc(value);
  const z = value * value;
  return (value * polevl(z, ERF_T)) / p1evl(z, ERF_U);
}

export function normalPdf(z: number): number {
  return Number.isFinite(z) ? Math.exp(-0.5 * z * z) / SQRT_2PI : 0;
}

export function normalCdf(z: number): number {
  if (z === Infinity) return 1;
  if (z === -Infinity) return 0;
  return 0.5 * erfc(-z / SQRT_2);
}

/** Stable log Φ for CARA tail terms. */
export function logNormalCdf(z: number): number {
  if (z === Infinity) return 0;
  if (z === -Infinity) return -Infinity;
  if (z >= -8) return Math.log(normalCdf(z));
  const inverseSquare = 1 / (z * z);
  const correction =
    -inverseSquare +
    3 * inverseSquare ** 2 -
    15 * inverseSquare ** 3 +
    105 * inverseSquare ** 4 -
    945 * inverseSquare ** 5 +
    10_395 * inverseSquare ** 6 -
    135_135 * inverseSquare ** 7 +
    2_027_025 * inverseSquare ** 8 -
    34_459_425 * inverseSquare ** 9;
  return -0.5 * z * z - Math.log(-z) - LOG_SQRT_2PI + Math.log1p(correction);
}

function log1mexp(value: number): number {
  if (value > 0) throw new RangeError("log1mexp expects a non-positive argument.");
  return value > -Math.LN2 ? Math.log(-Math.expm1(value)) : Math.log1p(-Math.exp(value));
}

/** log(Φ(upper) − Φ(lower)), avoiding catastrophic positive-tail subtraction. */
export function logNormalInterval(lower: number, upper: number): number {
  if (lower >= upper) return -Infinity;
  if (lower >= 0) {
    const high = logNormalCdf(-lower);
    const low = logNormalCdf(-upper);
    return high + log1mexp(low - high);
  }
  const high = logNormalCdf(upper);
  const low = logNormalCdf(lower);
  return high + log1mexp(low - high);
}

export function normalIntervalProbability(lower: number, upper: number): number {
  const logged = logNormalInterval(lower, upper);
  return logged < -745 ? 0 : Math.exp(logged);
}

export interface TruncatedMoments {
  probability: number;
  first: number;
  second: number;
}

/** E[X^k 1(l < X ≤ u)] for a normal X, with ±∞ endpoint limits. */
export function truncatedNormalMoments(
  mean: number,
  sd: number,
  lower: number,
  upper: number,
): TruncatedMoments {
  if (sd === 0) {
    const probability = lower < mean && mean <= upper ? 1 : 0;
    return { probability, first: probability * mean, second: probability * mean * mean };
  }
  const zLower = (lower - mean) / sd;
  const zUpper = (upper - mean) / sd;
  const probability = normalIntervalProbability(zLower, zUpper);
  const phiLower = normalPdf(zLower);
  const phiUpper = normalPdf(zUpper);
  const first = mean * probability + sd * (phiLower - phiUpper);
  const lowerTerm = Number.isFinite(zLower) ? zLower * phiLower : 0;
  const upperTerm = Number.isFinite(zUpper) ? zUpper * phiUpper : 0;
  const second =
    mean * mean * probability +
    2 * mean * sd * (phiLower - phiUpper) +
    sd * sd * (probability + lowerTerm - upperTerm);
  return { probability, first, second };
}

const ACKLAM_A = [
  -39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716,
  2.506628277459239,
];
const ACKLAM_B = [
  -54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572,
];
const ACKLAM_C = [
  -0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734,
  4.374664141464968, 2.938163982698783,
];
const ACKLAM_D = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];

function acklamTailDenominator(value: number): number {
  return (
    ((((ACKLAM_D[0] ?? 0) * value + (ACKLAM_D[1] ?? 0)) * value + (ACKLAM_D[2] ?? 0)) * value +
      (ACKLAM_D[3] ?? 0)) *
      value +
    1
  );
}

function acklamCenterDenominator(value: number): number {
  return (
    (((((ACKLAM_B[0] ?? 0) * value + (ACKLAM_B[1] ?? 0)) * value + (ACKLAM_B[2] ?? 0)) * value +
      (ACKLAM_B[3] ?? 0)) *
      value +
      (ACKLAM_B[4] ?? 0)) *
      value +
    1
  );
}

export function normalInv(probability: number): number {
  if (!(probability > 0 && probability < 1))
    throw new RangeError("normalInv requires p in (0, 1).");
  let estimate: number;
  if (probability < 0.02425) {
    const q = Math.sqrt(-2 * Math.log(probability));
    estimate = polevl(q, ACKLAM_C) / acklamTailDenominator(q);
  } else if (probability > 1 - 0.02425) {
    const q = Math.sqrt(-2 * Math.log(1 - probability));
    estimate = -polevl(q, ACKLAM_C) / acklamTailDenominator(q);
  } else {
    const q = probability - 0.5;
    const r = q * q;
    estimate = (q * polevl(r, ACKLAM_A)) / acklamCenterDenominator(r);
  }
  const error = normalCdf(estimate) - probability;
  const adjustment = error / normalPdf(estimate);
  return estimate - adjustment / (1 + 0.5 * estimate * adjustment);
}
