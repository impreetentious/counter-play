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

/** Exact I-1 checker used on every deterministic simulation path. */
export function checkPayoutConservation(lines: readonly DeterministicPayoutLine[]): IdentityAttestation {
  const direct = lines.reduce((sum, line) => sum.add(line.payout.mul(Rat.from(line.count))), R0);
  const rebuilt = lines.reduce((sum, line) => {
    const parts = line.decomposition.perTier.reduce((tierSum, value) => tierSum.add(value), line.decomposition.base)
      .add(line.decomposition.bonus);
    return sum.add(parts.mul(Rat.from(line.count)));
  }, R0);
  const pass = direct.eq(rebuilt);
  if (!pass) {
    throw new EngineError("INTERNAL_INVARIANT", `I-1 payout conservation failed: ${direct.serialize()} != ${rebuilt.serialize()}.`);
  }
  return { id: "I-1", pass, maxErr: 0 };
}

/** Float I-1 uses the contract's combined absolute/relative tolerance. */
export function checkStochasticPayoutConservation(lines: readonly StochasticPayoutLine[]): IdentityAttestation {
  const direct = lines.reduce((sum, line) => sum + line.count * line.payout, 0);
  const rebuilt = lines.reduce((sum, line) => sum + line.count * (line.decomposition.base + line.decomposition.perTier.reduce((tierSum, value) => tierSum + value, 0) + line.decomposition.bonus), 0);
  const error = Math.abs(direct - rebuilt);
  const pass = error <= 1e-9 * Math.max(1, Math.abs(direct));
  if (!pass) throw new EngineError("INTERNAL_INVARIANT", `I-1 stochastic payout conservation failed: ${direct} != ${rebuilt}.`);
  return { id: "I-1", pass, maxErr: error };
}

export function checkProbabilityConservation(probabilities: readonly number[]): IdentityAttestation {
  const error = Math.abs(probabilities.reduce((sum, value) => sum + value, 0) - 1);
  const pass = error <= 1e-12;
  if (!pass) throw new EngineError("INTERNAL_INVARIANT", `I-2 probability conservation failed with error ${error}.`);
  return { id: "I-2", pass, maxErr: error };
}
