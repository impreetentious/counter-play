import { Rat } from "@/engine/rat";
import type { ScenarioJson } from "./schema";

export type StressPresetId = "aggressive-accelerator" | "tight-cap" | "high-noise";

const ONE_POINT_ONE = Rat.from(11, 10);
const MAX_RATE = Rat.from(10);

function multiplyDecimal(value: string, factor: Rat): string {
  return Rat.fromDecimalString(value).mul(factor).toDecimalString();
}

/** Exact wire-level stress transforms; callers apply the returned scenario through Zod validation. */
export function applyStressPreset(scenario: ScenarioJson, preset: StressPresetId): ScenarioJson {
  switch (preset) {
    case "aggressive-accelerator":
      return {
        ...scenario,
        plans: scenario.plans.map((plan) => ({
          ...plan,
          tiers: plan.tiers.map((tier, index) =>
            index === plan.tiers.length - 1
              ? {
                  ...tier,
                  rate: Rat.fromDecimalString(tier.rate)
                    .mul(Rat.from(3, 2))
                    .min(MAX_RATE)
                    .toDecimalString(),
                }
              : { ...tier },
          ),
        })),
      };
    case "tight-cap":
      return {
        ...scenario,
        plans: scenario.plans.map((plan) => {
          const existing = plan.cap ? Rat.fromDecimalString(plan.cap) : null;
          return {
            ...plan,
            tiers: plan.tiers.map((tier) => ({ ...tier })),
            cap:
              !existing || existing.gt(ONE_POINT_ONE) ? ONE_POINT_ONE.toDecimalString() : plan.cap,
          };
        }),
      };
    case "high-noise":
      return {
        ...scenario,
        population: scenario.population.map((segment) => ({
          ...segment,
          noiseSD: multiplyDecimal(segment.noiseSD, Rat.from(2)),
        })),
      };
  }
}
