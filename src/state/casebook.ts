import type { FindingType } from "@/engine/linter";
import type { ScenarioJson, SegmentJson } from "./schema";

/**
 * The casebook. Five published findings from the empirical compensation literature, each
 * encoded as a scenario this engine can run.
 *
 * The README's bibliography claims a lineage; these episodes are that claim made executable.
 * Every entry states what the paper found, how the finding is written down as assumptions, and
 * which linter rules the encoding is expected to fire — and the test suite holds the engine to
 * the last of those, so the casebook doubles as a regression corpus for the rules themselves.
 *
 * What these are not: replications. Each is a *stylised* encoding chosen so the paper's
 * mechanism is the thing driving the result, with round numbers rather than the study's own
 * estimates. The point is that the mechanism reproduces, not that the coefficients match.
 */

export interface CasebookEntry {
  id: string;
  title: string;
  citation: string;
  /** What the paper found. */
  finding: string;
  /** How that finding is written down as this scenario's assumptions. */
  encoding: string;
  /** What to do once it is loaded — the interactive half of the essay. */
  tryThis: string;
  /** The rules the encoding is designed to fire. Held by the regression suite. */
  expects: FindingType[];
  scenario: ScenarioJson;
}

const baseSettings: ScenarioJson["settings"] = {
  mode: "deterministic",
  periodLabel: "half",
  currencyLabel: "$",
  discount: "1",
  seasonality: ["1", "1"],
  mc: { seed: 1, N: 500, ranges: {} },
};

function seller(overrides: Partial<SegmentJson> & { id: string; label: string }): SegmentJson {
  return {
    count: 10,
    ability: "1000000",
    costK: "80000",
    riskAversion: "0",
    noiseSD: "0",
    reservationCE: "0",
    quotaMult: "1",
    valueQuality: "1",
    movable: "0",
    ...overrides,
  };
}

/**
 * Oyer 1998. The quota bonus is a cliff, and a cliff plus a movable pipeline is a timing game.
 * The threshold sits at 170% deliberately: inside sales can reach it on effort alone and does,
 * while field sales cannot make the jump pay — but *can* pull enough of a fat second half
 * across the boundary to land on it for free. One plan, one threshold, two different responses.
 */
const oyer1998: ScenarioJson = {
  schemaVersion: 1,
  population: [
    seller({
      id: "seg-1",
      label: "Inside sales",
      ability: "1600000",
      costK: "100000",
      movable: "0",
    }),
    seller({
      id: "seg-2",
      label: "Field sales",
      ability: "1200000",
      costK: "100000",
      movable: "0.4",
    }),
  ],
  plans: [
    {
      id: "plan-1",
      label: "Bonus at 170% attainment",
      base: "50000",
      quota: "1000000",
      tiers: [{ from: "0", rate: "0.05" }],
      bonus: { L: "30000", x_b: "1.7" },
      cap: null,
    },
  ],
  settings: { ...baseSettings, seasonality: ["1", "2"] },
  meta: { notes: "" },
};

/**
 * Steenburgh 2008. The contribution is a decomposition: bonuses raise *effort*, not only the
 * timing of orders. The encoding puts the timing channel within reach — a lopsided second half,
 * a threshold sitting between the two periods' unconstrained optima — and then closes it with
 * `movable = 0`. Reopening it is the experiment, and the result is the paper's: nothing moves.
 */
const steenburgh2008: ScenarioJson = {
  schemaVersion: 1,
  population: [
    seller({ id: "seg-1", label: "Junior", ability: "700000", costK: "60000", movable: "0" }),
    seller({ id: "seg-2", label: "Core", ability: "1000000", costK: "80000", movable: "0" }),
    seller({ id: "seg-3", label: "Senior", ability: "1400000", costK: "95000", movable: "0" }),
  ],
  plans: [
    {
      id: "plan-1",
      label: "Bonus at quota, no timing",
      base: "55000",
      quota: "1000000",
      tiers: [{ from: "0", rate: "0.05" }],
      bonus: { L: "40000", x_b: "1" },
      cap: null,
    },
  ],
  settings: { ...baseSettings, seasonality: ["1", "1.3"] },
  meta: { notes: "" },
};

/**
 * Larkin 2014. Accelerators reward the *sequence* of deals, so sellers manage timing — and pay
 * for it with discounts the firm never wanted. The discount is what `valueQuality < 1` is:
 * revenue the business books at less than face. So the encoding is an accelerator plus a
 * movable pipeline plus γ below one, and both the gaming and its cost show up.
 */
const larkin2014: ScenarioJson = {
  schemaVersion: 1,
  population: [
    seller({
      id: "seg-1",
      label: "Enterprise AE",
      ability: "1200000",
      costK: "70000",
      movable: "0.3",
      valueQuality: "0.85",
    }),
  ],
  plans: [
    {
      id: "plan-1",
      label: "Three-step accelerator",
      base: "45000",
      quota: "1000000",
      tiers: [
        { from: "0", rate: "0.04" },
        { from: "0.6", rate: "0.08" },
        { from: "1", rate: "0.14" },
      ],
      bonus: null,
      cap: null,
    },
  ],
  settings: { ...baseSettings, discount: "0.9" },
  meta: { notes: "" },
};

/**
 * Lazear 2000 — the Safelite study. Roughly half the productivity gain from moving to piece
 * rates was *sorting*: different people, not harder work. This is the one episode the sorting
 * module makes runnable. Two plans are offered as a menu; the high-ability, low-effort-cost
 * segment takes the piece rate and the other stays on salary. The linter is expected to stay
 * quiet on the menu itself, because a menu that separates people is a menu that works — and a
 * silent rule is a finding too.
 */
const lazear2000: ScenarioJson = {
  schemaVersion: 1,
  population: [
    seller({
      id: "seg-1",
      label: "High-throughput installer",
      count: 8,
      ability: "1400000",
      costK: "50000",
      reservationCE: "40000",
    }),
    seller({
      id: "seg-2",
      label: "Steady installer",
      count: 12,
      ability: "800000",
      costK: "160000",
      reservationCE: "40000",
    }),
  ],
  plans: [
    {
      id: "salary",
      label: "Salary",
      base: "60000",
      quota: "1000000",
      tiers: [{ from: "0", rate: "0.01" }],
      bonus: null,
      cap: null,
    },
    {
      id: "piece-rate",
      label: "Piece rate",
      base: "10000",
      quota: "1000000",
      tiers: [{ from: "0", rate: "0.12" }],
      bonus: null,
      cap: null,
    },
  ],
  settings: { ...baseSettings, menu: { walkAwayAllowed: true } },
  meta: { notes: "" },
};

/**
 * The cap-quit composite. Not one paper but the practice failure the cap rule exists for: past
 * the cap the marginal rate is zero, so the rational play is to stop, and the plan's own
 * arithmetic says how much revenue that costs. The reservation values are set so the segment
 * that stops also has the least reason to stay.
 */
const capQuit: ScenarioJson = {
  schemaVersion: 1,
  population: [
    seller({
      id: "seg-1",
      label: "Top quartile",
      count: 5,
      ability: "1600000",
      costK: "70000",
      reservationCE: "160000",
    }),
    seller({ id: "seg-2", label: "Core", count: 15, ability: "1000000", costK: "80000" }),
  ],
  plans: [
    {
      id: "plan-1",
      label: "Capped at 110%",
      base: "60000",
      quota: "1000000",
      tiers: [{ from: "0", rate: "0.09" }],
      bonus: null,
      cap: "1.1",
    },
  ],
  settings: baseSettings,
  meta: { notes: "" },
};

export const casebook: readonly CasebookEntry[] = [
  {
    id: "oyer-1998",
    title: "The fiscal year ends, and so does the selling",
    citation:
      "Oyer, P. (1998). Fiscal Year Ends and Non-Linear Incentive Contracts. Quarterly Journal of Economics 113(1).",
    finding:
      "Firms book disproportionate revenue at the close of the fiscal year. Oyer's argument is that this is not demand — it is the sales force responding to a non-linear contract, moving orders to whichever side of the boundary pays better.",
    encoding:
      "Two segments on one plan: a flat 5% plus a $30k lump at 170% attainment. Inside sales can reach the threshold on effort and does. Field sales cannot make that jump pay — but it has 40% of a pipeline it can move, and a second half twice the size of the first.",
    tryThis:
      "Open Analyze and read the boundary panel: field sales moves nearly a million of revenue across the boundary and buys exactly the bonus with it, at no extra effort. Then set the bonus to zero on Design and the shift collapses to nothing — the cliff, not the calendar, is what moves the deals.",
    expects: ["L-2", "L-7"],
    scenario: oyer1998,
  },
  {
    id: "steenburgh-2008",
    title: "Bonuses buy effort, not only timing",
    citation:
      "Steenburgh, T. (2008). Effort or Timing: The Effect of Lump-Sum Bonuses. Quantitative Marketing and Economics 6(3).",
    finding:
      "The obvious objection to any bonus is that it only rearranges when orders are booked. Steenburgh separates the two channels and finds the effort response is real: output rises rather than merely relocating.",
    encoding:
      "Three segments, a $40k bonus at quota, and a second half 30% stronger than the first — the conditions a timing story needs. Then `movable` is set to zero, closing the channel by construction, so whatever the bonus does here it does through effort.",
    tryThis:
      "Raise `movable` to 0.3 on the Model surface and re-read Analyze. The effort finding stays; no timing finding joins it. Every segment is already sitting on the threshold in both periods, so moving an order can only lose one of the two bonuses — which is Steenburgh's answer, computed rather than asserted.",
    expects: ["L-2"],
    scenario: steenburgh2008,
  },
  {
    id: "larkin-2014",
    title: "The accelerator gets gamed, and the discount pays for it",
    citation:
      "Larkin, I. (2014). The Cost of High-Powered Incentives: Employee Gaming in Enterprise Software Sales. Journal of Labor Economics 32(2).",
    finding:
      "Sellers on accelerating commission schedules time deals to land in the highest-paying period, and buy that timing with price concessions. Larkin puts the cost to the firm at several percent of revenue — a cost the commission plan itself creates.",
    encoding:
      "A three-step accelerator, 30% of the pipeline movable, a discount factor below one so pulling forward is worth something on its own, and value quality at 0.85 — the concession, written as revenue the business books at less than face.",
    tryThis:
      "The Goodhart wedge on the ledger is the discount in dollars. Raise value quality to 1 and the wedge disappears while the timing finding remains: gaming and its cost are separate mechanisms that this plan happens to trigger together.",
    expects: ["L-5", "L-7"],
    scenario: larkin2014,
  },
  {
    id: "lazear-2000",
    title: "Half the gain was who showed up",
    citation:
      "Lazear, E. (2000). Performance Pay and Productivity. American Economic Review 90(5).",
    finding:
      "When Safelite moved from hourly wages to piece rates, output per worker rose about 44%. Roughly half of that was the same workers working harder. The other half was sorting: the piece rate attracted and retained people who were good at the job, and the others left.",
    encoding:
      "Two plans offered as a menu rather than as alternatives, and two segments who differ in the cost of effort rather than in anything the plan can see. Each takes the plan that suits it, and the sorting map shows which. Both carry the same reservation value: the outside option is the labour market, and it does not care which plan a firm is offering.",
    tryThis:
      "Read the sorting map on Simulate: the high-throughput segment takes the piece rate and the steady one keeps the salary. The retention rule fires on the piece rate for the steady segment, and that is the sorting result stated as a warning — on a piece rate those people would rather be somewhere else, which is exactly what Safelite observed. Then set both segments' effort cost equal and re-read it: with nobody left to sort, the menu collapses onto one plan and the menu rule says so.",
    expects: ["L-4"],
    scenario: lazear2000,
  },
  {
    id: "cap-quit",
    title: "The cap is a quit point",
    citation:
      "Composite of standard practice; the mechanism is the zero marginal rate of Holmström & Milgrom (1987) linear contracts truncated at a ceiling.",
    finding:
      "Capping commission is usually defended as budget protection. Past the cap the marginal rate is zero, so the rational play is to stop selling — and the revenue that never gets booked is rarely counted against the budget the cap protected.",
    encoding:
      "A flat 9% capped at 110% attainment, with a top-quartile segment whose unconstrained optimum sits well above the ceiling and whose reservation value is high enough that being throttled matters to it.",
    tryThis:
      "The cap finding carries the revenue left on the table as evidence. Then sweep the cap on Analyze: the revenue curve climbs until the cap stops binding and is flat after — the whole argument in one line.",
    expects: ["L-3", "L-4"],
    scenario: capQuit,
  },
];
