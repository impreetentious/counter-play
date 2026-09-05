import { z } from "zod";
import { segmentQuota } from "@/engine/plan";
import { respondDeterministic } from "@/engine/respond.det";
import type { Scenario } from "@/engine/types";

const MAX_CALIBRATION_BYTES = 512 * 1024;
const MAX_CALIBRATION_ROWS = 10_000;
const MAX_MONEY = 1_000_000_000_000;

interface CalibrationProposal {
  segmentId: string;
  segmentLabel: string;
  observations: number;
  meanAttainment: number;
  attainmentSD: number;
  modeledAttainment: number;
  ability: string | null;
  noiseSD: string | null;
  unavailable: string | null;
}

export interface CalibrationResult {
  rowsRead: number;
  proposals: CalibrationProposal[];
}

/** Small CSV reader with RFC4180-style doubled quote support; deliberately no upload or network path. */
function readCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index] ?? "";
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') quoted = false;
      else cell += char;
      continue;
    }
    if (char === '"') {
      quoted = true;
      continue;
    }
    if (char === ",") {
      row.push(cell.trim());
      cell = "";
      continue;
    }
    if (char === "\n") {
      row.push(cell.trim());
      rows.push(row);
      row = [];
      cell = "";
      continue;
    }
    if (char !== "\r") cell += char;
  }
  if (quoted) throw new Error("CSV has an unclosed quoted field.");
  if (cell.length > 0 || row.length > 0) {
    row.push(cell.trim());
    rows.push(row);
  }
  return rows;
}

function finiteNonnegative(
  value: string | undefined,
  label: string,
  required: boolean,
): number | undefined {
  if (value == null || value.trim() === "") {
    if (required) throw new Error(`${label} is required on every historical row.`);
    return undefined;
  }
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0)
    throw new Error(`${label} must be a finite non-negative number.`);
  return number;
}

function toWireDecimal(value: number): string | null {
  if (!Number.isFinite(value) || value < 0 || value > MAX_MONEY) return null;
  // Below 1e-12 `toString` emits an exponent the wire format rejects (its magnitude cap is 12),
  // so such a proposal is reported as unavailable rather than offered and then refused on apply.
  if (value > 0 && value < 1e-12) return null;
  // 12 significant digits stays below the scenario's 15-digit wire guard and parses exactly.
  return Number(value.toPrecision(12)).toString();
}

const rowSchema = z
  .object({
    segment: z.string().trim().min(1, "segment is required"),
    attainment: z.string().optional(),
    revenue: z.string().optional(),
    quota: z.string().optional(),
  })
  .strict();

function namedRow(
  headers: readonly string[],
  cells: readonly string[],
  line: number,
): z.infer<typeof rowSchema> {
  if (cells.length !== headers.length)
    throw new Error(`CSV row ${line} has ${cells.length} cells; expected ${headers.length}.`);
  const record = Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? ""]));
  const parsed = rowSchema.safeParse(record);
  if (!parsed.success)
    throw new Error(`CSV row ${line}: ${parsed.error.issues[0]?.message ?? "is invalid"}.`);
  return parsed.data;
}

/**
 * §3.15. Parses a local attainment CSV and proposes, but never writes, model assumptions.
 * Historical rows are transient: callers must explicitly apply the returned proposal to the store.
 */
export function calibrateHistoricalCsv(
  text: string,
  scenario: Scenario,
  planId: string,
): CalibrationResult {
  if (new TextEncoder().encode(text).byteLength > MAX_CALIBRATION_BYTES)
    throw new Error("Calibration CSV exceeds the 512 KB local-file limit.");
  const rows = readCsv(text);
  const header = rows.shift();
  if (!header) throw new Error("Calibration CSV needs a header row.");
  const headers = header.map((value) => value.trim().toLowerCase());
  if (new Set(headers).size !== headers.length)
    throw new Error("Calibration CSV headers must be unique.");
  if (!headers.includes("segment")) throw new Error("Calibration CSV needs a segment column.");
  const hasAttainment = headers.includes("attainment");
  if (!hasAttainment && !(headers.includes("revenue") && headers.includes("quota"))) {
    throw new Error("Calibration CSV needs attainment, or both revenue and quota columns.");
  }
  if (rows.length === 0) throw new Error("Calibration CSV has no historical rows.");
  if (rows.length > MAX_CALIBRATION_ROWS)
    throw new Error("Calibration CSV exceeds the 10,000-row local limit.");

  const plan = scenario.plans.find((candidate) => candidate.id === planId);
  if (!plan) throw new Error("Choose a current plan before calibrating historical attainment.");
  const values = new Map<string, number[]>();
  for (const [index, cells] of rows.entries()) {
    if (cells.every((cell) => cell.trim() === "")) continue;
    const row = namedRow(headers, cells, index + 2);
    const matches = scenario.population.filter(
      (segment) => segment.id === row.segment || segment.label === row.segment,
    );
    if (matches.length !== 1)
      throw new Error(`CSV row ${index + 2}: segment “${row.segment}” is unknown or ambiguous.`);
    const attainment = hasAttainment
      ? finiteNonnegative(row.attainment, `CSV row ${index + 2} attainment`, true)
      : (() => {
          const revenue = finiteNonnegative(row.revenue, `CSV row ${index + 2} revenue`, true) ?? 0;
          const quota = finiteNonnegative(row.quota, `CSV row ${index + 2} quota`, true) ?? 0;
          if (quota <= 0) throw new Error(`CSV row ${index + 2} quota must be greater than zero.`);
          return revenue / quota;
        })();
    const segment = matches[0]!;
    values.set(segment.id, [...(values.get(segment.id) ?? []), attainment ?? 0]);
  }
  if (values.size === 0) throw new Error("Calibration CSV has no non-blank historical rows.");

  const proposals: CalibrationProposal[] = [];
  for (const segment of scenario.population) {
    const observations = values.get(segment.id);
    if (!observations || observations.length === 0) continue;
    const meanAttainment =
      observations.reduce((sum, value) => sum + value, 0) / observations.length;
    const attainmentSD = Math.sqrt(
      observations.reduce((sum, value) => sum + (value - meanAttainment) ** 2, 0) /
        observations.length,
    );
    const modeledAttainment = respondDeterministic(plan, segment).attainment.toNumber();
    const quota = segmentQuota(plan, segment).toNumber();
    const ability =
      modeledAttainment > 0
        ? toWireDecimal((segment.ability.toNumber() * meanAttainment) / modeledAttainment)
        : null;
    const noiseSD = toWireDecimal(quota * attainmentSD);
    const unavailable =
      modeledAttainment <= 0
        ? "The current exact model produces zero attainment, so ability cannot be scaled from this baseline."
        : !ability || !noiseSD
          ? "The proposed value exceeds the scenario input bounds."
          : null;
    proposals.push({
      segmentId: segment.id,
      segmentLabel: segment.label,
      observations: observations.length,
      meanAttainment,
      attainmentSD,
      modeledAttainment,
      ability,
      noiseSD,
      unavailable,
    });
  }
  return {
    rowsRead: [...values.values()].reduce((sum, entries) => sum + entries.length, 0),
    proposals,
  };
}
