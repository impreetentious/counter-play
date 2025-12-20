import { z } from "zod";
import { EngineError } from "@/engine/errors";
import { Rat, R0 } from "@/engine/rat";
import type {
  Bonus,
  MonteCarloSettings,
  MultiplierRange,
  Plan,
  Scenario,
  ScenarioSettings,
  Segment,
  SegmentRanges,
  Tier,
} from "@/engine/types";

export interface SegmentJson {
  id: string;
  label: string;
  count: number;
  ability: string;
  costK: string;
  riskAversion: string;
  noiseSD: string;
  reservationCE: string;
  quotaMult: string;
  valueQuality: string;
  movable: string;
}

export interface TierJson {
  from: string;
  rate: string;
}

export interface PlanJson {
  id: string;
  label: string;
  base: string;
  quota: string;
  tiers: TierJson[];
  bonus: { L: string; x_b: string } | null;
  cap: string | null;
}

export interface ScenarioJson {
  schemaVersion: 1;
  population: SegmentJson[];
  plans: PlanJson[];
  settings: {
    mode: "deterministic" | "stochastic";
    periodLabel: string;
    currencyLabel: string;
    discount: string;
    seasonality: [string, string];
    mc: {
      seed: number;
      N: number;
      ranges: {
        demand?: [string, string];
        perSegment?: Record<string, { a?: [string, string]; k?: [string, string]; sigma?: [string, string]; gamma?: [string, string] }>;
      };
    };
  };
  meta: { notes: string };
}

const decimalPattern = /^[+-]?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/;
const idPattern = /^[a-z][a-z0-9-]{0,31}$/;
const maxUint32 = 2 ** 32 - 1;

type DecimalBounds = { min: Rat; max: Rat; minExclusive?: boolean; label: string };

function decimalIssues(value: string, ctx: z.RefinementCtx): void {
  if (value.length > 32) {
    ctx.addIssue({ code: "custom", message: "Decimal strings are limited to 32 characters." });
    return;
  }
  if (!decimalPattern.test(value)) {
    ctx.addIssue({ code: "custom", message: "Use an exact decimal such as 0.085 or 1.2e-4." });
    return;
  }
  const exponent = /[eE]([+-]?\d+)$/.exec(value)?.[1];
  if (exponent && Math.abs(Number(exponent)) > 12) {
    ctx.addIssue({ code: "custom", message: "Decimal exponent magnitude must be at most 12." });
  }
  const significand = value.replace(/^[+-]/, "").replace(/[.eE+-]/g, "").replace(/^0+/, "") || "0";
  if (significand.length > 15) {
    ctx.addIssue({ code: "custom", message: "Decimal values may contain at most 15 significand digits." });
  }
}

function decimal(bounds: DecimalBounds) {
  return z.string().superRefine((value, ctx) => {
    decimalIssues(value, ctx);
    if (ctx.issues.length > 0) return;
    const parsed = Rat.fromDecimalString(value);
    const below = bounds.minExclusive ? parsed.lte(bounds.min) : parsed.lt(bounds.min);
    if (below || parsed.gt(bounds.max)) {
      const lower = bounds.minExclusive ? "greater than" : "at least";
      ctx.addIssue({ code: "custom", message: `${bounds.label} must be ${lower} ${bounds.min.toDecimalString()} and at most ${bounds.max.toDecimalString()}.` });
    }
  });
}

const money = decimal({ min: R0, max: Rat.from(1_000_000_000_000), label: "Money" });
const positiveMoney = decimal({ min: R0, max: Rat.from(1_000_000_000_000), minExclusive: true, label: "Value" });
const rate = decimal({ min: R0, max: Rat.from(10), label: "Rate" });
const attainment = decimal({ min: R0, max: Rat.from(1000), label: "Attainment" });
const positiveAttainment = decimal({ min: R0, max: Rat.from(1000), minExclusive: true, label: "Attainment" });
const riskAversion = decimal({ min: R0, max: Rat.from(1), label: "Risk aversion" });
const movable = decimal({ min: R0, max: Rat.from(1, 2), label: "Movable pipeline" });
const discount = decimal({ min: R0, max: Rat.one(), minExclusive: true, label: "Discount" });
const rangeMultiplier = decimal({ min: R0, max: Rat.from(1000), minExclusive: true, label: "Range multiplier" });

const id = z.string().regex(idPattern, "Ids start with a lowercase letter and use only lowercase letters, digits, and hyphens.");
const label = z.string().max(60, "Labels are limited to 60 characters.");
const tierSchema = z.object({ from: attainment, rate }).strict();

const bonusSchema = z.object({ L: money, x_b: positiveAttainment }).strict();
const planSchema = z.object({
  id,
  label,
  base: money,
  quota: positiveMoney,
  tiers: z.array(tierSchema).min(1).max(12),
  bonus: bonusSchema.nullable(),
  cap: positiveAttainment.nullable(),
}).strict().superRefine((plan, ctx) => {
  const first = plan.tiers[0];
  if (!first || !Rat.fromDecimalString(first.from).eq(R0)) {
    ctx.addIssue({ code: "custom", path: ["tiers", 0, "from"], message: "The first tier must begin at 0 attainment." });
  }
  for (let index = 1; index < plan.tiers.length; index += 1) {
    const prior = plan.tiers[index - 1];
    const current = plan.tiers[index];
    if (!prior || !current) continue;
    if (Rat.fromDecimalString(current.from).lte(Rat.fromDecimalString(prior.from))) {
      ctx.addIssue({ code: "custom", path: ["tiers", index, "from"], message: "Tier lower edges must be strictly increasing." });
    }
  }
  const last = plan.tiers.at(-1);
  if (plan.cap && last && Rat.fromDecimalString(plan.cap).lt(Rat.fromDecimalString(last.from))) {
    ctx.addIssue({ code: "custom", path: ["cap"], message: "A cap must sit in or after the final tier." });
  }
});

const segmentSchema = z.object({
  id,
  label,
  count: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  ability: positiveMoney,
  costK: positiveMoney,
  riskAversion,
  noiseSD: money,
  reservationCE: money,
  quotaMult: decimal({ min: R0, max: Rat.from(1000), minExclusive: true, label: "Quota multiplier" }),
  valueQuality: decimal({ min: R0, max: Rat.from(1000), minExclusive: true, label: "Value quality" }),
  movable,
}).strict();

const multiplierRange = z.tuple([rangeMultiplier, rangeMultiplier]).superRefine((pair, ctx) => {
  if (Rat.fromDecimalString(pair[0]).gt(Rat.fromDecimalString(pair[1]))) {
    ctx.addIssue({ code: "custom", message: "A range lower bound cannot exceed its upper bound." });
  }
});

const segmentRangesSchema = z.object({
  a: multiplierRange.optional(),
  k: multiplierRange.optional(),
  sigma: multiplierRange.optional(),
  gamma: multiplierRange.optional(),
}).strict();

const rangesSchema = z.object({
  demand: multiplierRange.optional(),
  perSegment: z.record(id, segmentRangesSchema).optional(),
}).strict();

const settingsSchema = z.object({
  mode: z.enum(["deterministic", "stochastic"]),
  periodLabel: z.string().min(1).max(40),
  currencyLabel: z.string().min(1).max(12),
  discount,
  seasonality: z.tuple([decimal({ min: R0, max: Rat.from(1000), minExclusive: true, label: "Seasonality" }), decimal({ min: R0, max: Rat.from(1000), minExclusive: true, label: "Seasonality" })]),
  mc: z.object({
    seed: z.number().int().min(0).max(maxUint32),
    N: z.number().int().min(100).max(5000),
    ranges: rangesSchema,
  }).strict(),
}).strict();

export const ScenarioJsonSchema = z.object({
  schemaVersion: z.literal(1),
  population: z.array(segmentSchema).min(1).max(10),
  plans: z.array(planSchema).min(1).max(3),
  settings: settingsSchema,
  meta: z.object({ notes: z.string().max(2000) }).strict().default({ notes: "" }),
}).strict().superRefine((scenario, ctx) => {
  const segmentIds = new Set<string>();
  for (const [index, segment] of scenario.population.entries()) {
    if (segmentIds.has(segment.id)) {
      ctx.addIssue({ code: "custom", path: ["population", index, "id"], message: "Segment ids must be unique." });
    }
    segmentIds.add(segment.id);
  }
  const planIds = new Set<string>();
  for (const [index, plan] of scenario.plans.entries()) {
    if (planIds.has(plan.id)) {
      ctx.addIssue({ code: "custom", path: ["plans", index, "id"], message: "Plan ids must be unique." });
    }
    planIds.add(plan.id);
  }
  for (const key of Object.keys(scenario.settings.mc.ranges.perSegment ?? {})) {
    if (!segmentIds.has(key)) {
      ctx.addIssue({ code: "custom", path: ["settings", "mc", "ranges", "perSegment", key], message: "Each MC range key must reference an existing segment id." });
    }
  }
});

function toRat(value: string): Rat {
  return Rat.fromDecimalString(value);
}

function toSegment(json: SegmentJson): Segment {
  return {
    ...json,
    ability: toRat(json.ability),
    costK: toRat(json.costK),
    riskAversion: toRat(json.riskAversion),
    noiseSD: toRat(json.noiseSD),
    reservationCE: toRat(json.reservationCE),
    quotaMult: toRat(json.quotaMult),
    valueQuality: toRat(json.valueQuality),
    movable: toRat(json.movable),
  };
}

function toPlan(json: PlanJson): Plan {
  const bonus: Bonus | null = json.bonus ? { L: toRat(json.bonus.L), x_b: toRat(json.bonus.x_b) } : null;
  const tiers: Tier[] = json.tiers.map((tier) => ({ from: toRat(tier.from), rate: toRat(tier.rate) }));
  return { ...json, base: toRat(json.base), quota: toRat(json.quota), tiers, bonus, cap: json.cap ? toRat(json.cap) : null };
}

function toRange(range: [string, string]): MultiplierRange {
  return [toRat(range[0]), toRat(range[1])];
}

function toRanges(json: ScenarioJson["settings"]["mc"]["ranges"]): MonteCarloSettings["ranges"] {
  const perSegment = json.perSegment
    ? Object.fromEntries(Object.entries(json.perSegment).map(([segmentId, ranges]) => [segmentId, {
      ...(ranges.a ? { a: toRange(ranges.a) } : {}),
      ...(ranges.k ? { k: toRange(ranges.k) } : {}),
      ...(ranges.sigma ? { sigma: toRange(ranges.sigma) } : {}),
      ...(ranges.gamma ? { gamma: toRange(ranges.gamma) } : {}),
    } satisfies SegmentRanges]))
    : undefined;
  return { ...(json.demand ? { demand: toRange(json.demand) } : {}), ...(perSegment ? { perSegment } : {}) };
}

function toSettings(json: ScenarioJson["settings"]): ScenarioSettings {
  return {
    ...json,
    discount: toRat(json.discount),
    seasonality: [toRat(json.seasonality[0]), toRat(json.seasonality[1])],
    mc: { ...json.mc, ranges: toRanges(json.mc.ranges) },
  };
}

function zodMessage(error: z.ZodError): string {
  return error.issues.map((issue) => `${issue.path.join(".") || "scenario"}: ${issue.message}`).join("; ");
}

/** Validates the JSON wire form and makes the only wire-to-domain conversion. */
export function parseScenario(input: unknown): Scenario {
  if (input && typeof input === "object" && "schemaVersion" in input && (input as { schemaVersion?: unknown }).schemaVersion !== 1) {
    const version = (input as { schemaVersion?: unknown }).schemaVersion;
    if (typeof version === "number" && version > 1) {
      throw new EngineError("INVALID_INPUT", "This file is from a newer version of Counterplay; upgrade to open it.");
    }
  }
  const result = ScenarioJsonSchema.safeParse(input);
  if (!result.success) {
    throw new EngineError("INVALID_INPUT", zodMessage(result.error));
  }
  const json = result.data as ScenarioJson;
  return {
    schemaVersion: 1,
    population: json.population.map(toSegment),
    plans: json.plans.map(toPlan),
    settings: toSettings(json.settings),
    meta: json.meta,
  };
}

function decimalOf(value: Rat): string {
  return value.toDecimalString();
}

function fromSegment(segment: Segment): SegmentJson {
  return {
    ...segment,
    ability: decimalOf(segment.ability),
    costK: decimalOf(segment.costK),
    riskAversion: decimalOf(segment.riskAversion),
    noiseSD: decimalOf(segment.noiseSD),
    reservationCE: decimalOf(segment.reservationCE),
    quotaMult: decimalOf(segment.quotaMult),
    valueQuality: decimalOf(segment.valueQuality),
    movable: decimalOf(segment.movable),
  };
}

function fromPlan(plan: Plan): PlanJson {
  return {
    ...plan,
    base: decimalOf(plan.base),
    quota: decimalOf(plan.quota),
    tiers: plan.tiers.map((tier) => ({ from: decimalOf(tier.from), rate: decimalOf(tier.rate) })),
    bonus: plan.bonus ? { L: decimalOf(plan.bonus.L), x_b: decimalOf(plan.bonus.x_b) } : null,
    cap: plan.cap ? decimalOf(plan.cap) : null,
  };
}

function fromRange(range: MultiplierRange): [string, string] {
  return [decimalOf(range[0]), decimalOf(range[1])];
}

/** Makes the only domain-to-wire conversion; it intentionally rejects non-decimal Rats. */
export function serializeScenario(scenario: Scenario): ScenarioJson {
  const perSegment = scenario.settings.mc.ranges.perSegment
    ? Object.fromEntries(Object.entries(scenario.settings.mc.ranges.perSegment).map(([segmentId, ranges]) => [segmentId, {
      ...(ranges.a ? { a: fromRange(ranges.a) } : {}),
      ...(ranges.k ? { k: fromRange(ranges.k) } : {}),
      ...(ranges.sigma ? { sigma: fromRange(ranges.sigma) } : {}),
      ...(ranges.gamma ? { gamma: fromRange(ranges.gamma) } : {}),
    }]))
    : undefined;
  const wire: ScenarioJson = {
    schemaVersion: 1,
    population: scenario.population.map(fromSegment),
    plans: scenario.plans.map(fromPlan),
    settings: {
      mode: scenario.settings.mode,
      periodLabel: scenario.settings.periodLabel,
      currencyLabel: scenario.settings.currencyLabel,
      discount: decimalOf(scenario.settings.discount),
      seasonality: [decimalOf(scenario.settings.seasonality[0]), decimalOf(scenario.settings.seasonality[1])],
      mc: {
        seed: scenario.settings.mc.seed,
        N: scenario.settings.mc.N,
        ranges: {
          ...(scenario.settings.mc.ranges.demand ? { demand: fromRange(scenario.settings.mc.ranges.demand) } : {}),
          ...(perSegment ? { perSegment } : {}),
        },
      },
    },
    meta: { notes: scenario.meta.notes },
  };
  const checked = ScenarioJsonSchema.safeParse(wire);
  if (!checked.success) {
    throw new EngineError("INTERNAL_INVARIANT", zodMessage(checked.error));
  }
  return checked.data as ScenarioJson;
}

/** G-11-safe identity allocation used by P4 editors and import helpers. */
export function allocateId(prefix: "seg" | "plan", ids: readonly string[]): string {
  const pattern = new RegExp(`^${prefix}-(\\d+)$`);
  let max = 0;
  for (const current of ids) {
    const match = pattern.exec(current);
    if (match) max = Math.max(max, Number(match[1]));
  }
  return `${prefix}-${max + 1}`;
}
