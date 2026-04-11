import { describe, expect, it } from "vitest";
import { applyStressPreset } from "./presets";
import { templateT1, templateT2 } from "./templates";

describe("stress presets", () => {
  it("uses exact decimal transforms and preserves the source scenario", () => {
    const accelerated = applyStressPreset(templateT2, "aggressive-accelerator");
    const noisy = applyStressPreset(templateT1, "high-noise");
    expect(accelerated.plans[0]?.tiers.at(-1)?.rate).toBe("0.195");
    expect(noisy.population[0]?.noiseSD).toBe("200000");
    expect(templateT2.plans[0]?.tiers.at(-1)?.rate).toBe("0.13");
  });

  it("sets or lowers a cap to 110% attainment without raising a tighter cap", () => {
    expect(applyStressPreset(templateT1, "tight-cap").plans[0]?.cap).toBe("1.1");
    const tight = { ...templateT1, plans: [{ ...templateT1.plans[0]!, cap: "1.05" }] };
    expect(applyStressPreset(tight, "tight-cap").plans[0]?.cap).toBe("1.05");
  });
});
