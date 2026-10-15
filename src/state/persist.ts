import { parseScenario, ScenarioJsonSchema, type ScenarioJson } from "./schema";

const scenarioKey = "scenario.v1";

export type PersistenceRead =
  | { kind: "absent" }
  | { kind: "valid"; scenario: ScenarioJson }
  | { kind: "invalid"; raw: string; message: string }
  | { kind: "unavailable"; message: string };
export type PersistenceWrite = { ok: true } | { ok: false; message: string };

export function loadPersistedScenario(): PersistenceRead {
  if (typeof window === "undefined")
    return { kind: "unavailable", message: "Browser storage is unavailable." };
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(scenarioKey);
  } catch (error) {
    return {
      kind: "unavailable",
      message: error instanceof Error ? error.message : "Browser storage could not be read.",
    };
  }
  if (raw === null) return { kind: "absent" };
  try {
    const scenario = ScenarioJsonSchema.parse(JSON.parse(raw)) as ScenarioJson;
    parseScenario(scenario);
    return { kind: "valid", scenario };
  } catch {
    return {
      kind: "invalid",
      raw,
      message:
        "Saved workspace is unreadable or unsupported. Autosave is paused until you explicitly replace it.",
    };
  }
}

export function persistScenario(scenario: ScenarioJson): PersistenceWrite {
  if (typeof window === "undefined")
    return { ok: false, message: "Browser storage is unavailable." };
  try {
    window.localStorage.setItem(scenarioKey, JSON.stringify(scenario));
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "The workspace could not be saved.",
    };
  }
}
