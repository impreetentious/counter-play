# Counterplay

> A compensation plan is a mechanism. People respond to the mechanism, not to the intent behind it. This is the instrument that computes that response — before the plan ships.

## The problem

Sales compensation — quotas, commission tiers, accelerators, bonuses, caps — is mechanism design. Yet almost every plan is designed by benchmarking and gut feel, then debugged in production on real people and real revenue. Reps respond strategically to whatever ships: they choose how hard to work, sandbag pipeline into next quarter, pull deals forward to clear a cliff, bunch at bonus thresholds, and stop selling the moment a cap binds.

None of that is a surprise, and none of it needs to be a surprise. Once the plan and the population it targets are written down as explicit assumptions, the strategic response stops being an opinion. It can be computed.

## What it does

- **Model** — describe the rep population as explicit, inspectable assumptions: segments with ability, effort cost, risk aversion, and quota expectations. No live data required; this is a pre-data instrument.
- **Design** — specify the plan precisely: base/variable mix, tiered commission curves with accelerators and decelerators, quotas, lump-sum bonuses, caps.
- **Simulate** — every modeled segment best-responds to the plan. Out come the distributions that matter: attainment, payouts, total comp cost, revenue response, pay-for-performance.
- **Analyze** — a perverse-incentive linter flags dead zones, cliff exploits, cap-induced quit points, period-boundary gaming, and Goodhart divergence between the measured metric and the intended one. Monte Carlo over assumption uncertainty shows which assumption to validate first.
- **Communicate** — export a self-contained, seed-stamped design record that documents the plan, the assumptions, and the computed consequences.

## What it is not

Not an incentive-compensation-management or commission-tracking tool. It does not connect to a CRM, does not ingest payroll or attainment data, and does not compute anyone's actual paycheck. ICM suites answer "given these attainment scenarios, what do we pay?" This answers the prior question: "given this plan, what will people *do*?"

## How it is built

- **Client-side only.** No backend, no accounts, no analytics, no cookies. Scenarios persist locally, share by URL, and export as JSON you own.
- **Exact where it matters.** Solver-critical arithmetic runs on big-integer rationals; floating point appears only outside the solver's correctness paths.
- **Theory-anchored.** The engine is grounded in principal-agent economics — Holmström–Milgrom linear contracts and the deal-timing literature (Oyer 1998; Larkin 2014) — with metric-vs-value divergence surfaced as a Goodhart wedge report. It is tested against the closed-form results wherever they exist.
- **Replayable.** Every random element is seeded. Every run re-derives and displays a global payout-conservation identity. Counterfactuals are comparable across runs.

## Using it

The workspace opens on a pre-loaded template scenario, so the first screen is already live. From there:

1. Pick a template or start blank.
2. Adjust the population assumptions in **Model**.
3. Shape the plan in **Design** and watch the payout curve update; optionally add a variant plan to compare against.
4. Run **Simulate** for KPIs, distributions, and the per-segment response table.
5. Open **Analyze** to triage linter findings (each deep-links to the chart region that shows it), check period-boundary gaming, and run Monte Carlo to see which assumptions your conclusions hinge on.
6. Export the design record, save the scenario as JSON, or copy the share URL.

Scenarios live in your browser's local storage. Nothing is uploaded; a share URL carries the scenario itself.

## Stack

Next.js (App Router, static export) · React · TypeScript (strict) · Tailwind CSS · Zustand · Zod · hand-rolled SVG visualization · Vitest + fast-check · Playwright.

## Run locally

Requires Node `24.12.0` (see `.nvmrc`; `engine-strict` makes `npm ci` fail on a different version).

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

## Limitations

- **No pay floors.** Draws, clawbacks, and SPIFFs are not modelled. Following the linear-contract convention, stochastic mode can realize negative variable pay in the far-left tail; the app says so on the distribution surfaces.
- **Single- and two-period only.** There are no multi-period ratchet dynamics or dynamic quota-setting rules.
- **Segments, not individuals.** Reps are aggregated into segments; there is no team credit, split credit, or tournament competition between reps.
- **Goodhart is a report, not an engine.** Metric-vs-value divergence is surfaced as a wedge report; a full two-task multitasking engine is not implemented.
- **Accessibility.** Light and dark themes, built against WCAG 2.1 AA. It has not been independently audited.

## References

The engine's design draws on a specific slice of the principal-agent literature. This is a working bibliography — not an exhaustive review.

- Holmström, B. & Milgrom, P. (1987). Aggregation and linearity in the provision of intertemporal incentives. *Econometrica* 55(2). doi:[10.2307/1913238](https://doi.org/10.2307/1913238) — anchors the CARA-normal linear-contract path.
- Holmström, B. & Milgrom, P. (1991). Multitask principal–agent analyses. *Journal of Law, Economics, & Organization* 7 (special issue). — informs the Goodhart wedge report.
- Oyer, P. (1998). Fiscal year ends and nonlinear incentive contracts: the effect on business seasonality. *Quarterly Journal of Economics* 113(1). doi:[10.1162/003355398555559](https://doi.org/10.1162/003355398555559) — anchors bonus-cliff bunching and accelerator-driven timing games.
- Steenburgh, T. (2008). Effort or timing: the effect of lump-sum bonuses on the output of sales agents. *Quantitative Marketing and Economics* 6(3). doi:[10.1007/s11129-008-9039-7](https://doi.org/10.1007/s11129-008-9039-7) — anchors the bonus-cliff decomposition of effort vs timing.
- Larkin, I. (2014). The cost of high-powered incentives: employee gaming in enterprise software sales. *Journal of Labor Economics* 32(2). doi:[10.1086/673371](https://doi.org/10.1086/673371) — anchors accelerator-driven deal-closure timing gaming.
- Lazear, E. P. & Rosen, S. (1981). Rank-order tournaments as optimum labor contracts. *Journal of Political Economy* 89(5). — background on tournament-style incentives, which this engine does not model.

## License

MIT © Sidakpreet Singh — see [LICENSE](LICENSE).

---

**Version:** v0.12.1
