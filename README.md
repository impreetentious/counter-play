# Counterplay

> A compensation plan is a mechanism. People respond to the mechanism, not to the intent behind it. This is the instrument that computes that response — before the plan ships.

## The problem

Sales compensation — quotas, commission tiers, accelerators, bonuses, caps — is mechanism design. Yet almost every plan is designed by benchmarking and gut feel, then debugged in production on real people and real revenue. Reps respond strategically to whatever ships: they choose how hard to work, sandbag pipeline into next quarter, pull deals forward to clear a cliff, bunch at bonus thresholds, and stop selling the moment a cap binds.

None of that is a surprise, and none of it needs to be a surprise. Once the plan and the population it targets are written down as explicit assumptions, the strategic response stops being an opinion. It can be computed.

## What it does

- **Model** — describe the rep population as explicit, inspectable assumptions: segments with ability, effort cost, risk aversion, and quota expectations. A segment can also carry a second activity the plan cannot measure but the business still values, and reps can be assumed to play the plan approximately rather than perfectly. No live data required; this is a pre-data instrument.
- **Design** — specify the plan precisely: base/variable mix, tiered commission curves with accelerators and decelerators, quotas, lump-sum bonuses, caps — plus the primitives that ride on top: recoverable and non-recoverable draws, clawbacks, spot bonuses, and a pay floor.
- **Simulate** — every modeled segment best-responds to the plan. Out come the distributions that matter: attainment, payouts, total comp cost, revenue response, pay-for-performance, and — where a second activity exists — how effort splits between what is measured and what is merely valuable. Beside those numbers sit the two questions the KPI cards cannot answer: who actually stays once a reservation value is a real alternative, and — when the plans are offered as a menu rather than compared as designs — which segment chooses which plan. Declare the firm's objective and each plan is read back against it in expected profit, with the Goodhart wedge priced rather than only flagged.
- **Analyze** — a perverse-incentive linter flags dead zones, cliff exploits, cap-induced quit points, period-boundary gaming, quota-ratchet suppression, team free-riding, and Goodhart divergence between the measured metric and the intended one. Run the plan across a multi-period horizon where quotas reset on what reps produced; put reps in a credit-sharing team or a rank-order tournament and read the equilibrium. Compare nearby commission-rate schedules with an explicitly bounded local search, or load a local attainment CSV to propose refreshed assumptions. Monte Carlo over assumption uncertainty shows which assumption to validate first; a plan-space sweep does the complementary job, moving one plan scalar across a range and marking the exact values where a segment changes the play it makes.
- **Communicate** — export a self-contained, seed-stamped design record that documents the plan, the assumptions, and the computed consequences. The casebook goes the other way: five published findings from the literature, encoded as scenarios the engine runs, each loadable in one click.

## What it is not

Not an incentive-compensation-management or commission-tracking tool. It does not connect to a CRM, does not ingest payroll or attainment data, and does not compute anyone's actual paycheck. ICM suites answer "given these attainment scenarios, what do we pay?" This answers the prior question: "given this plan, what will people _do_?"

## How it is built

- **Client-side only.** No backend, no accounts, no analytics, no cookies. Scenarios persist locally, share by URL, and export as JSON you own.
- **Exact where it matters.** Solver-critical arithmetic runs on big-integer rationals; floating point appears only outside the solver's correctness paths.
- **Theory-anchored.** The engine is grounded in principal-agent economics — Holmström–Milgrom linear contracts and multitask analysis, the deal-timing literature (Oyer 1998; Larkin 2014), the Weitzman ratchet, and Lazear–Rosen rank-order tournaments. It is tested against the closed-form results wherever they exist.
- **Replayable.** Every random element is seeded. Every run re-derives and displays a global payout-conservation identity. Counterfactuals are comparable across runs.

## Using it

The workspace opens on a pre-loaded template scenario, so the first screen is already live. From there:

1. Pick a template or start blank.
2. Adjust the population assumptions in **Model**.
3. Shape the plan in **Design** and watch the payout curve update; optionally add a variant plan to compare against.
4. Run **Simulate** for KPIs, distributions, and the per-segment response table.
5. Open **Analyze** to triage linter findings (each deep-links to the chart region that shows it), check period-boundary gaming, stretch the plan across a multi-period quota ratchet, test it under split credit or a tournament, compare a nearby rate schedule, optionally calibrate assumptions from a local attainment CSV, and run Monte Carlo to see which assumptions your conclusions hinge on.
6. Export the design record, save the scenario as JSON, or copy the share URL.

Scenarios live in your browser's local storage. Nothing is uploaded; a share URL carries the scenario itself.

## Stack

Next.js (App Router, static export) · React · TypeScript (strict) · Tailwind CSS · Zustand · Zod · hand-rolled SVG visualization · Vitest + fast-check · Playwright.

## Run locally

Requires Node `24.14.0` (see `.nvmrc`; `engine-strict` makes `npm ci` fail on a different version).

```bash
npm ci
npm run dev
```

Open `http://localhost:3001`.

## Verify

```bash
npm run typecheck
npm run lint
npm run test
npm run build
npm run test:e2e
```

Or `npm run test:all` to run all of the above in sequence.

## Build and deploy

```bash
npm run build
```

This emits a plain static site in `out/`, which serves from any static host. `npm run start` serves that build locally at `http://localhost:4001`. There is no hosted instance — run it locally or deploy the bundle yourself.

The supported PDF route is browser print-to-PDF from `/record`; no generated-PDF runtime dependency is shipped.

Whatever host you use should send the response headers documented in [docs/STATIC-HOST-HEADERS.md](docs/STATIC-HOST-HEADERS.md). `vercel.json` applies them on Vercel and `serve.json` applies the same policy to `npm run start`, so the browser suite runs against the real policy across all three engines. `npm run check:csp` fails if the two host configs and the document ever disagree.

The GitHub remote is authoritative and carries the only pipeline; `.github/workflows/ci.yml` runs every gate. The GitLab remote is a backup mirror kept in sync, deliberately without a `.gitlab-ci.yml` — there is no second publication target to gate, and a mirrored pipeline would only create a second place for gate drift.

## Limitations

- **Segments, not individuals.** Reps are aggregated into segments, and every rep inside a segment is identical. Team credit and tournaments model a symmetric group within a segment — not heterogeneous rivals, and not an org chart.
- **Team results sit beside the plan's numbers, never inside them.** The equilibrium under split credit or a tournament answers a different question from the individual best response, so it is reported separately rather than folded into the headline KPIs. Split credit is computed in deterministic mode only, and the tournament objective ignores risk aversion.
- **Multi-period is a quota ratchet, not a full dynamic program.** Two to twelve periods, with each quota reset on what reps actually produced. A rep who anticipates the ratchet is modelled as looking one reset ahead, not to an unbounded horizon.
- **Negative variable pay is possible.** Following the linear-contract convention, stochastic mode can realize negative variable pay in the far-left tail unless the plan sets a pay floor; the app says so on the distribution surfaces.
- **Suggestions are local, not prescriptions.** The rate-schedule helper explores only a small neighbourhood with explicit cost, retention, and linter guards; it does not identify a globally optimal plan or replace the linter and uncertainty reading.
- **Calibration is local and descriptive.** It accepts a local attainment CSV and proposes ability/noise assumptions; no files are uploaded or retained, and it is not a payroll import, causal estimate, or connector to a CRM.
- **Sorting and exit are reported beside the KPIs, never inside them.** Headline KPIs stay full-roster by design, and say so. Who leaves, who chooses what, and what those readings change are computed separately, because folding them together would make both unreadable.
- **The sweep is an instrument, not an optimiser.** It moves one plan scalar and recomputes; it never nominates a plan. Where a crossing is an irrational number it reports the interval rather than a point inside it.
- **The declared objective is declared.** Expected profit and any limits beside it are what the owner writes down, not something the engine infers or defends. The only ranking it will make is dominance — better on both cost and value at once.
- **The casebook encodes mechanisms, not estimates.** Each episode is a stylised scenario chosen so a published mechanism drives the result; the round numbers are not the studies' coefficients and no episode is a replication.
- **Accessibility.** Light and dark themes, built against WCAG 2.1 AA. It has not been independently audited.

## References

The engine's design draws on a specific slice of the principal-agent literature. This is a working bibliography — not an exhaustive review.

- Holmström, B. & Milgrom, P. (1987). Aggregation and linearity in the provision of intertemporal incentives. _Econometrica_ 55(2). doi:[10.2307/1913238](https://doi.org/10.2307/1913238) — anchors the CARA-normal linear-contract path.
- Holmström, B. & Milgrom, P. (1991). Multitask principal–agent analyses. _Journal of Law, Economics, & Organization_ 7 (special issue). — anchors the two-task effort-allocation model behind the Goodhart wedge.
- Oyer, P. (1998). Fiscal year ends and nonlinear incentive contracts: the effect on business seasonality. _Quarterly Journal of Economics_ 113(1). doi:[10.1162/003355398555559](https://doi.org/10.1162/003355398555559) — anchors bonus-cliff bunching and accelerator-driven timing games.
- Steenburgh, T. (2008). Effort or timing: the effect of lump-sum bonuses on the output of sales agents. _Quantitative Marketing and Economics_ 6(3). doi:[10.1007/s11129-008-9039-7](https://doi.org/10.1007/s11129-008-9039-7) — anchors the bonus-cliff decomposition of effort vs timing.
- Larkin, I. (2014). The cost of high-powered incentives: employee gaming in enterprise software sales. _Journal of Labor Economics_ 32(2). doi:[10.1086/673371](https://doi.org/10.1086/673371) — anchors accelerator-driven deal-closure timing gaming.
- Lazear, E. P. (2000). Performance pay and productivity. _American Economic Review_ 90(5). doi:[10.1257/aer.90.5.1346](https://doi.org/10.1257/aer.90.5.1346) — anchors the sorting half of the response to incentive pay, and the casebook episode built on it.
- Lazear, E. P. & Rosen, S. (1981). Rank-order tournaments as optimum labor contracts. _Journal of Political Economy_ 89(5). — anchors the rank-order tournament equilibrium.
- Weitzman, M. L. (1980). The "ratchet principle" and performance incentives. _Bell Journal of Economics_ 11(1). — anchors the multi-period quota ratchet.

## License

MIT © Sidakpreet Singh — see [LICENSE](LICENSE).

---

**Version:** v0.16.3
