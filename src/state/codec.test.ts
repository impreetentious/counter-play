import { describe, expect, it } from "vitest";
import { EngineError } from "@/engine/errors";
import { simulateDeterministic } from "@/engine/simulate";
import { decodeShare, encodeShare, exportScenarioJsonString, importScenarioJsonString } from "./codec";
import { parseScenario, serializeScenario, type ScenarioJson } from "./schema";
import { blankScenario, templateT1, templateT2, templateT3 } from "./templates";

const notedScenario: ScenarioJson = { ...templateT2, meta: { notes: "Ship this after Q3 QBR." } };

describe("state/codec — JSON round-trip (I-4)", () => {
  it("exports and re-imports every pinned template to identical wire form", () => {
    for (const scenario of [templateT1, templateT2, templateT3, blankScenario, notedScenario]) {
      const text = exportScenarioJsonString(scenario);
      const round = importScenarioJsonString(text);
      expect(round).toEqual(scenario);
    }
  });

  it("preserves deterministic simulation results across export → import (I-4)", () => {
    for (const scenario of [templateT1, templateT2, templateT3]) {
      const text = exportScenarioJsonString(scenario);
      const round = importScenarioJsonString(text);
      const before = simulateDeterministic(parseScenario(scenario));
      const after = simulateDeterministic(parseScenario(round));
      for (let index = 0; index < before.plans.length; index += 1) {
        const priorPlan = before.plans[index]!;
        const laterPlan = after.plans[index]!;
        expect(priorPlan.kpis.expectedRevenue.eq(laterPlan.kpis.expectedRevenue)).toBe(true);
        expect(priorPlan.kpis.totalComp.eq(laterPlan.kpis.totalComp)).toBe(true);
        expect(priorPlan.kpis.trueValue.eq(laterPlan.kpis.trueValue)).toBe(true);
      }
      for (const attestation of after.attestations) expect(attestation.pass).toBe(true);
    }
  });

  it("hard-rejects future schema versions with a friendly message", () => {
    const text = JSON.stringify({ ...templateT1, schemaVersion: 2 });
    expect(() => importScenarioJsonString(text)).toThrow(/newer version of Counterplay/);
  });

  it("rejects malformed JSON with a friendly message", () => {
    expect(() => importScenarioJsonString("{not-json")).toThrow(/valid JSON/);
    expect(() => importScenarioJsonString("\"just a string\"")).toThrow(EngineError);
  });

  it("rejects imports larger than the 1 MB boundary", () => {
    const oversized = " ".repeat(1024 * 1024 + 1);
    expect(() => importScenarioJsonString(oversized)).toThrow(/1 MB/);
  });
});

describe("state/codec — URL share round-trip", () => {
  it("round-trips a template through the compressed URL fragment", async () => {
    const share = await encodeShare(templateT2);
    expect(share.hash.startsWith("s=")).toBe(true);
    expect(share.oversized).toBe(false);
    const round = await decodeShare(share.hash);
    expect(round).toEqual(templateT2);
  });

  it("accepts a leading '#' on the fragment", async () => {
    const share = await encodeShare(blankScenario);
    const round = await decodeShare(`#${share.hash}`);
    expect(round).toEqual(blankScenario);
  });

  it("fails closed on an unrecognized prefix", async () => {
    await expect(decodeShare("garbage=abc")).rejects.toThrow(/Unrecognized/);
  });

  it("preserves the schemaVersion migration on the URL path", async () => {
    // Build a raw base64url payload manually so we can inject schemaVersion 2 and verify the reject.
    const bogus = { ...templateT1, schemaVersion: 2 };
    const rawBytes = new TextEncoder().encode(JSON.stringify(bogus));
    const b64 = Buffer.from(rawBytes).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
    await expect(decodeShare(`s0=${b64}`)).rejects.toThrow(/newer version/);
  });

  it("preserves the wire form byte-for-byte across encode → decode → serialize", async () => {
    const share = await encodeShare(notedScenario);
    const round = await decodeShare(share.hash);
    expect(round.meta.notes).toBe("Ship this after Q3 QBR.");
    expect(serializeScenario(parseScenario(round))).toEqual(serializeScenario(parseScenario(notedScenario)));
  });
});
