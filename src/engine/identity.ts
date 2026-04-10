import { EngineError } from "./errors";
import { Rat, R0 } from "./rat";
import type { PayoutDecomposition } from "./plan";
import type { FloatDecomposition } from "./respond.cara";

export interface IdentityAttestation {
  id: "I-1" | "I-2" | "I-3" | "I-4";
  pass: boolean;
  maxErr: number;
}

export interface DeterministicPayoutLine {
  count: number;
  payout: Rat;
  decomposition: PayoutDecomposition;
}

export interface StochasticPayoutLine {
  count: number;
  payout: number;
  decomposition: FloatDecomposition;
}

type CompareValue = Rat | number | null;

/**
 * I-3 compares the deltas shown in the UI with values rebuilt from independent plan runs.
 * Deterministic values must agree exactly; analytic stochastic values use a relative tolerance.
 * A missing ratio is deliberately not comparable (§3.5), so it is skipped rather than coerced.
 */
export function checkCompareConsistency(
  displayed: readonly CompareValue[],
  recomputed: readonly CompareValue[],
): IdentityAttestation {
  if (displayed.length !== recomputed.length) {
    throw new EngineError("INTERNAL_INVARIANT", "I-3 compared different KPI sets.");
  }
  let maxErr = 0;
  for (let index = 0; index < displayed.length; index += 1) {
    const shown = displayed[index];
    const rebuilt = recomputed[index];
    if (shown === null || rebuilt === null) continue;
    if (shown instanceof Rat && rebuilt instanceof Rat) {
      if (!shown.eq(rebuilt)) {
        throw new EngineError(
          "INTERNAL_INVARIANT",
          `I-3 exact compare consistency failed for KPI ${index}: ${shown.serialize()} != ${rebuilt.serialize()}.`,
        );
      }
      continue;
    }
    if (typeof shown !== "number" || typeof rebuilt !== "number") {
      throw new EngineError(
        "INTERNAL_INVARIANT",
        `I-3 compared incompatible KPI values at ${index}.`,
      );
    }
    const error = Math.abs(shown - rebuilt);
    maxErr = Math.max(maxErr, error);
    if (error > 1e-12 * Math.max(1, Math.abs(rebuilt))) {
      throw new EngineError(
        "INTERNAL_INVARIANT",
        `I-3 stochastic compare consistency failed for KPI ${index}: ${shown} != ${rebuilt}.`,
      );
    }
  }
  return { id: "I-3", pass: true, maxErr };
}

/** Exact I-1 checker used on every deterministic simulation path. */
export function checkPayoutConservation(
  lines: readonly DeterministicPayoutLine[],
): IdentityAttestation {
  const direct = lines.reduce((sum, line) => sum.add(line.payout.mul(Rat.from(line.count))), R0);
  const rebuilt = lines.reduce((sum, line) => {
    const parts = line.decomposition.perTier
      .reduce((tierSum, value) => tierSum.add(value), line.decomposition.base)
      .add(line.decomposition.bonus)
      .add(line.decomposition.spiff)
      .sub(line.decomposition.clawback)
      .add(line.decomposition.drawTopUp)
      .add(line.decomposition.floorTopUp);
    return sum.add(parts.mul(Rat.from(line.count)));
  }, R0);
  const pass = direct.eq(rebuilt);
  if (!pass) {
    throw new EngineError(
      "INTERNAL_INVARIANT",
      `I-1 payout conservation failed: ${direct.serialize()} != ${rebuilt.serialize()}.`,
    );
  }
  return { id: "I-1", pass, maxErr: 0 };
}

/** Float I-1 uses the contract's combined absolute/relative tolerance. */
export function checkStochasticPayoutConservation(
  lines: readonly StochasticPayoutLine[],
): IdentityAttestation {
  const direct = lines.reduce((sum, line) => sum + line.count * line.payout, 0);
  const rebuilt = lines.reduce((sum, line) => {
    const d = line.decomposition;
    const parts =
      d.base +
      d.perTier.reduce((tierSum, value) => tierSum + value, 0) +
      d.bonus +
      d.spiff -
      d.clawback +
      d.drawTopUp +
      d.floorTopUp;
    return sum + line.count * parts;
  }, 0);
  const error = Math.abs(direct - rebuilt);
  const pass = error <= 1e-9 * Math.max(1, Math.abs(direct));
  if (!pass)
    throw new EngineError(
      "INTERNAL_INVARIANT",
      `I-1 stochastic payout conservation failed: ${direct} != ${rebuilt}.`,
    );
  return { id: "I-1", pass, maxErr: error };
}

export function checkProbabilityConservation(
  probabilities: readonly number[],
): IdentityAttestation {
  const error = Math.abs(probabilities.reduce((sum, value) => sum + value, 0) - 1);
  const pass = error <= 1e-12;
  if (!pass)
    throw new EngineError(
      "INTERNAL_INVARIANT",
      `I-2 probability conservation failed with error ${error}.`,
    );
  return { id: "I-2", pass, maxErr: error };
}
