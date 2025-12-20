# Counterplay

Pre-build (documentation only)

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

Not an incentive-compensation-management or commission-tracking tool. It does not connect to a CRM, does not ingest payroll or attainment data, and does not compute anyone's actual paycheck. ICM suites answer "given these attainment scenarios, what do we pay?" — none we reviewed models what people will *do*. This answers the prior question: "given this plan, what will people *do*?"

## How it is built

- **Client-side only.** No backend, no accounts, no analytics, no cookies. Scenarios persist locally, share by URL, and export as JSON you own.
- **Exact where it matters.** Solver-critical arithmetic runs on big-integer rationals; floating point appears only where the math contract explicitly justifies it.
- **Theory-anchored.** The engine is grounded in principal-agent economics — Holmström–Milgrom linear contracts and the deal-timing literature (Oyer 1998; Larkin 2014) — with metric-vs-value divergence surfaced as a Goodhart wedge report; multitasking and tournament engines are deliberately out of v1. It is tested against the closed-form results wherever they exist.
- **Replayable.** Every random element is seeded. Every run re-derives and displays a global payout-conservation identity. Counterfactuals are comparable across runs.
- **Accessible.** Light and dark themes; WCAG 2.1 AA intent, with a recorded audit before any stronger claim.

## Stack (planned)

Next.js (App Router, static export) · React · TypeScript (strict) · Tailwind CSS · Zustand · Zod · hand-rolled SVG visualization · Vitest + fast-check · Playwright.

## Status

P0–P1 complete (v0.3.0); P2 (Deterministic best response) is next.

## References

The engine's design draws on a specific slice of the principal-agent literature. This is a working bibliography — not an exhaustive review.

- Holmström, B. & Milgrom, P. (1987). Aggregation and linearity in the provision of intertemporal incentives. *Econometrica* 55(2). doi:[10.2307/1913238](https://doi.org/10.2307/1913238) — anchors the CARA-normal linear-contract path (O-B family).
- Holmström, B. & Milgrom, P. (1991). Multitask principal–agent analyses. *Journal of Law, Economics, & Organization* 7 (special issue). — informs the L-5 Goodhart wedge report; the full multitask engine is deferred to v1.x.
- Oyer, P. (1998). Fiscal year ends and nonlinear incentive contracts: the effect on business seasonality. *Quarterly Journal of Economics* 113(1). doi:[10.1162/003355398555559](https://doi.org/10.1162/003355398555559) — anchors bonus-cliff bunching (O-C, L-2) and accelerator-driven timing games (O-F, O-F2, L-7).
- Steenburgh, T. (2008). Effort or timing: the effect of lump-sum bonuses on the output of sales agents. *Quantitative Marketing and Economics* 6(3). doi:[10.1007/s11129-008-9039-7](https://doi.org/10.1007/s11129-008-9039-7) — anchors the bonus-cliff decomposition of effort vs timing (O-C, L-2).
- Larkin, I. (2014). The cost of high-powered incentives: employee gaming in enterprise software sales. *Journal of Labor Economics* 32(2). doi:[10.1086/673371](https://doi.org/10.1086/673371) — anchors accelerator-driven deal-closure timing gaming (O-F, O-F2, L-7).
- Lazear, E. P. & Rosen, S. (1981). Rank-order tournaments as optimum labor contracts. *Journal of Political Economy* 89(5). — informs a v1.x tournament engine (not implemented in v1).

## License

MIT © Sidakpreet Singh

---

## AI Agent Instructions

Before making any new commits, update the **Product Version** string below in this file with the current IST time of commit (`Asia/Kolkata`). Keep the same numeric release version in `package.json` and the root package entries of `package-lock.json` (once `package.json` exists — from P0 on).

This IST timestamp rule is permanent for all future workflows, commits, and AI agents working in this repository.

Follow this format for version control:

* **Base Format Version:** 0.0.0 — the version of the version-block schema itself (the shape of these lines); it is bumped only when this block's structure changes, not on every commit.
* **Product Version:** `v0.3.0_2025-12-20_23:51:05` (IST)
