import { EngineError } from "./errors";
import { Rat, R0 } from "./rat";
import type { Rationality } from "./types";

/** §3.3a tail flush: a play this far below the best one is not a modeled behavior. */
const MIN_LOG_WEIGHT = -64;

/** True when the §3.3a dial asks for the softmax response class rather than the exact one. */
export function isSoftmax(rationality: Rationality | null | undefined): rationality is Rationality {
  return rationality?.mode === "softmax";
}

function weightFromLog(logWeight: number): number {
  return logWeight < MIN_LOG_WEIGHT ? 0 : Math.exp(logWeight);
}

/**
 * §3.3a logit probabilities on the exact path. The exponential is the contract's one
 * deterministic-path float; every weight crosses back through `Rat.fromFloat64` before the
 * normalization runs in rationals, so the returned probabilities sum to exactly one.
 */
export function softmaxProbabilitiesExact(objectives: readonly Rat[], tau: Rat): Rat[] {
  if (objectives.length === 0)
    throw new EngineError("INTERNAL_INVARIANT", "Softmax needs at least one candidate.");
  const best = objectives.reduce((max, value) => value.max(max));
  const weights = objectives.map((value) =>
    Rat.fromFloat64(weightFromLog(value.sub(best).div(tau).toNumber())),
  );
  const total = weights.reduce((sum, weight) => sum.add(weight), R0);
  if (total.eq(R0)) throw new EngineError("INTERNAL_INVARIANT", "Softmax weights summed to zero.");
  return weights.map((weight) => weight.div(total));
}

/** §3.3a logit probabilities on the float path (§3.4 objectives are already float64). */
export function softmaxProbabilitiesFloat(objectives: readonly number[], tau: number): number[] {
  if (objectives.length === 0)
    throw new EngineError("INTERNAL_INVARIANT", "Softmax needs at least one candidate.");
  const best = Math.max(...objectives);
  const weights = objectives.map((value) => weightFromLog((value - best) / tau));
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  if (total === 0) throw new EngineError("INTERNAL_INVARIANT", "Softmax weights summed to zero.");
  return weights.map((weight) => weight / total);
}

/** Index of the largest probability, ties resolved toward the earlier (lower-effort) entry. */
export function modalIndex(probabilities: readonly Rat[]): number;
export function modalIndex(probabilities: readonly number[]): number;
export function modalIndex(probabilities: readonly (Rat | number)[]): number {
  let best = 0;
  for (let index = 1; index < probabilities.length; index += 1) {
    const candidate = probabilities[index];
    const incumbent = probabilities[best];
    if (candidate === undefined || incumbent === undefined) continue;
    const greater =
      typeof candidate === "number" && typeof incumbent === "number"
        ? candidate > incumbent
        : (candidate as Rat).gt(incumbent as Rat);
    if (greater) best = index;
  }
  return best;
}
