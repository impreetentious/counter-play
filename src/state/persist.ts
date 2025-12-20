import { ScenarioJsonSchema, type ScenarioJson } from "./schema";

const scenarioKey = "scenario.v1";

export function loadPersistedScenario(): ScenarioJson | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(scenarioKey);
    if (!raw) return null;
    const parsed = ScenarioJsonSchema.safeParse(JSON.parse(raw));
    return parsed.success ? (parsed.data as ScenarioJson) : null;
  } catch {
    return null;
  }
}

export function persistScenario(scenario: ScenarioJson): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(scenarioKey, JSON.stringify(scenario));
  } catch {
    // Persistence is best-effort; the in-memory scenario is unaffected.
  }
}

export function clearPersistedScenario(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(scenarioKey);
  } catch {
    // Ignore storage failures.
  }
}
