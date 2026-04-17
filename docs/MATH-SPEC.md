# Counterplay — Normative Math Contract

The normative mathematics for this repository: conventions and units, the payout function, the
deterministic and stochastic best-response paths, aggregation and KPIs, the global consistency
identities, the exact/float boundary, numerics, the perverse-incentive linter, the timing module,
Monte Carlo over assumption uncertainty, the oracle corpus and executable fixtures, team credit and
rank-order tournaments, local plan search and calibration, and the interaction/locale contract.

**This document is authoritative and permanent.** Source comments cite it by section number as
`docs/MATH-SPEC.md §X`; where a source comment and this document disagree, this document wins until
an owner ruling says otherwise. The golden values in `src/engine/v01.test.ts` … `v05.test.ts` are
hand-derived from the sections below, so the section numbering is contract: renumbering a section
breaks every citation that points at it.

---

This contract precedes all engine code (G-12: expected values here are law). Symbols: segment `s`, plan `π`, effort `e ≥ 0`, output/revenue `q`, quota `Q`, attainment `x = q / (Q·m_s)` where `m_s` is the segment quota multiplier.

### 3.0 Conventions & units

- Money is in abstract currency units (display label configurable; default "$"). Internally: exact rationals (det path) or float64 (stochastic path) per §3.7.
- All user numeric input is captured as decimal strings and parsed exactly to rationals (`"0.085"` → 17/200). The UI never round-trips through float on the way into state.
- Numeric field kinds: `n_s`, `mc.seed` (uint32), `mc.N`, and `schemaVersion` are plain JSON integers. **Every other numeric field is a decimal string** parsed exactly to a rational; grammar `[+-]?digits[.digits][(e|E)[+-]digits]` — the exponent shifts the scale exactly, so template values like `"1.2e-4"` are legal and exact.
- Attainment tiers are stored as `tiers: [{ from, rate }]` with `0 = from₁ < from₂ < … < from_M` and `rate_i = r_i ≥ 0` (a fraction of revenue). Tier `i` covers `x ∈ [from_i, from_{i+1})` with `from_{M+1} = ∞`: the last tier is open-ended unless capped. Derived bounds: `lo_i = from_i`, `hi_i = from_{i+1}`.
- **Effective cap `x̄`** (drives L-3 semantics, §3.9; **total** across cap/zero-run cases): `x̄` is the smallest attainment beyond which the marginal rate is _identically_ zero — formally, `x̄ = min( x_cap if present , from of the first tier in a maximal trailing zero-rate run if present )` (`min` so an explicit cap sitting after an earlier zero-run does not mask that earlier economic quit point; either or both may be absent). If the final effective rate is positive (no trailing zero run, no cap), `x̄` is undefined (`none`). L-1's zone semantics are defined independently of `x̄` (see §3.9).
- The payout function `W` is continuous except at the bonus threshold: the lump bonus `L ≥ 0` pays iff `x ≥ x_b` (closed on the right — landing exactly on the threshold earns it). Cap at `x_cap`: variable pay is frozen for `x > x_cap` (equivalently, marginal rate 0 beyond); the bonus indicator is on `x` itself and is **not** truncated by the cap (`x_b > x_cap` is legal and keeps a live incentive past the cap). Validation: `x_b > 0` (finite) if `L > 0`; `x_cap > 0` and `x_cap ≥ from_M` (the cap sits in the last tier) if present.
- Marginal rate at a breakpoint = right-limit. Ties in optimization break toward **smaller effort** (agents don't work extra for identical certainty-equivalent); in the timing module, toward **smaller |shift|**.

- **Input bounds (normative; enforced by Zod at every boundary — form input, import, URL decode).** These bounds exist to protect two invariants: every parsed value crosses to float64 finite, and bigint magnitudes stay small enough for the §4.7 performance budgets.

  _Grammar-level (applied before parsing):_
  - Decimal-string length ≤ 32 characters, with ≤ 15 significand digits (`0`–`9` after removing sign, exponent, and decimal point) and exponent magnitude ≤ 12 (so `1.2e-4` legal, `1e999999999` rejected at grammar level).
  - URL fragment ≤ 16 KB before decompression; decompressed JSON payload ≤ 512 KB; imported file ≤ 1 MB — all rejected with friendly messages _before_ Zod parsing.

  _Post-parse per-field ranges (`x` is the parsed rational; brackets follow standard math convention):_

  | Field                               | Range                   | Notes                                                                                                                               |
  | ----------------------------------- | ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
  | `B, L, Ū` (monetary)                | `[0, 1e12]`             | zero permitted                                                                                                                      |
  | `Q, a, k` (positive monetary)       | `(0, 1e12]`             | strictly positive per §3.1                                                                                                          |
  | `σ` (noise SD)                      | `[0, 1e12]`             | zero selects the deterministic fallback (§3.4)                                                                                      |
  | `rate` (tier r_i)                   | `[0, 10]`               | absolute rate; 10 = 1000% (headroom for stress tests)                                                                               |
  | `from` (tier lower edge)            | `[0, 1000]`             | attainment fraction; `from_1 = 0` per §3.0                                                                                          |
  | `m` (quotaMult)                     | `(0, 1000]`             | strictly positive per §3.1                                                                                                          |
  | `γ` (valueQuality)                  | `(0, 1000]`             | strictly positive per §3.1                                                                                                          |
  | `d_1, d_2` (seasonality)            | `(0, 1000]`             | strictly positive per §3.1                                                                                                          |
  | `ρ` (riskAversion)                  | `[0, 1]`                | 1/currency; `ρ = 0` = risk-neutral                                                                                                  |
  | `τ` (rationality temperature)       | `(0, 1e12]`             | currency units; §3.3a. Only present when `settings.rationality` is written; `τ = 0` is rejected (`mode: 'exact'` is the exact path) |
  | `δ` (discount)                      | `(0, 1]`                | `δ = 1` = no discount                                                                                                               |
  | `movable`                           | `[0, 0.5]`              | fraction; §3.1 default 0.10                                                                                                         |
  | `x_b, x_cap`                        | `(0, 1000]`             | strictly positive per §3.0                                                                                                          |
  | `tiers` length                      | 1 – 12                  | per plan                                                                                                                            |
  | `population` length (segments)      | 1 – 10                  | per scenario                                                                                                                        |
  | `plans` length                      | 1 – 3                   | per scenario                                                                                                                        |
  | `mc.N`                              | 100 – 5000              | per §3.1                                                                                                                            |
  | `mc.seed`                           | uint32 (`[0, 2³² − 1]`) | integer                                                                                                                             |
  | `label` (segment/plan)              | ≤ 60 chars              | Unicode string                                                                                                                      |
  | `id` (segment/plan)                 | per T-13 grammar        | `^[a-z][a-z0-9-]{0,31}$`                                                                                                            |
  | `meta.notes`                        | ≤ 2,000 chars           | per T-14                                                                                                                            |
  | `a₂` (`secondTask.ability`)         | `[0, 1e12]`             | §3.3b; `0` = the fully unmeasured task                                                                                              |
  | `v₂` (`secondTask.valuePerEffort`)  | `[0, 1e12]`             | §3.3b; currency per unit of task-2 effort                                                                                           |
  | `ψ` (`secondTask.costSubstitution`) | `[0, 0.95]`             | §3.3b; the ceiling keeps `1 − ψ²` bounded away from 0                                                                               |
  | `N` (`horizon.periods`)             | 2 – 12                  | integer; §3.10a                                                                                                                     |
  | `d_p` (`horizon.seasonality`)       | `(0, 1000]`             | §3.10a; exactly `N` entries                                                                                                         |
  | `λ` (`horizon.ratchet.weight`)      | `[0, 0.9]`              | §3.10a; the ceiling keeps `Q_{p+1} ≥ 0.1·Q_p > 0`                                                                                   |
  | `g` (`horizon.ratchet.growth`)      | `(0, 1000]`             | §3.10a; target growth on realised output                                                                                            |
  | `n` (`team.size`)                   | 2 – 50                  | integer; §3.14                                                                                                                      |
  | `s` (`team.split.creditShare`)      | `[0, 1]`                | §3.14; `0` = individual credit                                                                                                      |
  | `P` (`team.tournament.prize`)       | `[0, 1e12]`             | §3.14                                                                                                                               |
  | `w` (`team.tournament.winners`)     | 1 – `n − 1`             | integer; §3.14                                                                                                                      |

  Every §3.1 field has a row above. §4.7's performance budgets assume these bounds hold.

### 3.1 Primitives

**Entity identity (normative).** Both `Segment.id` and `Plan.id` follow the grammar `^[a-z][a-z0-9-]{0,31}$` (1–32 chars; leading lowercase letter, then lowercase alphanumerics and hyphens). Ids are **unique within their collection** (segments vs plans) — enforced by Zod `superRefine`. `MC.ranges.perSegment` keys reference `Segment.id` verbatim (§3.11). Ids are stable identifiers, not display labels — the human-readable `label` may be edited freely; the id may not (rename would break the range keys and any pending A/B compare context).

**Deterministic id allocator (G-11-consistent — no `Math.random`, no `Date.now`).** When the user adds or duplicates a segment (or plan), the new id is `seg-N` (or `plan-N`) where `N = 1 + max(numeric suffix of every existing id in the collection matching the `seg-<int>`/`plan-<int>` shape)`, or `N = 1` if no such existing id. Duplicate copies every field, uses the newly-allocated id, and appends `" (copy)"` to `label`. Imported ids are preserved verbatim (schema-validated on import); if an imported scenario ever contains a duplicate id within a collection, import rejects with a friendly message.

**Segment** `s`: `{ id, label, count n_s ∈ ℤ⁺, ability a_s > 0 (expected output at e = 1), costK k_s > 0 (effort cost k·e²/2, in currency), riskAversion ρ_s ≥ 0 (CARA, 1/currency), noiseSD σ_s ≥ 0 (stochastic mode), reservationCE Ū_s ≥ 0, quotaMult m_s > 0, valueQuality γ_s > 0 (true value per revenue unit, default 1), movable μ_s ∈ [0, 0.5] (fraction of the **source period's** output shiftable across the boundary, §3.10; default 0.10), secondTask?: { ability a₂ ≥ 0, valuePerEffort v₂ ≥ 0, costSubstitution ψ ∈ [0, 0.95] } (§3.3b two-task multitasking — absent ⇒ responses identical to §3.3/§3.4) }`.

**Plan** `π`: `{ id, label, base B ≥ 0, quota Q > 0, tiers [{from, rate}] (§3.0), bonus { L ≥ 0, x_b } | null, cap x_cap | null }`.

**Scenario**: `{ schemaVersion: 1, population: Segment[1..10], plans: Plan[1..3], settings: { mode: 'deterministic' | 'stochastic', periodLabel, currencyLabel, discount δ ∈ (0, 1] (timing, default 1), seasonality [d₁ > 0, d₂ > 0] (timing per-period demand multipliers, default [1, 1]), rationality?: { mode: 'exact' | 'softmax', τ > 0 } (§3.2a-style optional block — absent ⇒ `{ mode: 'exact' }`⇒ responses identical to §3.3/§3.4; §3.3a), horizon?: { periods N, seasonality [d_1…d_N], ratchet { weight λ, growth g }, response: 'myopic' | 'ratchetAware' } (§3.10a — absent ⇒ the two-period module of §3.10 is the whole timing story), team?: { mode: 'split' | 'tournament', size n, split?: { creditShare s }, tournament?: { prize P, winners w } } (§3.14 — absent ⇒ no equilibrium module runs), mc: { seed: uint32 (**schema default`1`** — templates and the blank scenario adopt this so blank/template scenarios validate without picking a seed by hand), N: 100..5000 (default 500), ranges } }, meta?: { notes: string (≤ 2,000 chars, default `""`; owner-authored decision notes, rendered on `/record` as plain text — never interpreted, never parsed; persists, shares, exports; counted by the codec's size guard) } }`.

`mc.ranges` (record-keyed schema, all optional; absent = off; values are decimal-string multipliers with `0 < lo ≤ hi` per §3.0 bounds):

```
ranges = {
  demand?: [lo, hi],
  perSegment?: Record<SegmentId, { a?: [lo, hi], k?: [lo, hi], sigma?: [lo, hi], gamma?: [lo, hi] }>
}
```

Zod validates: every key of `perSegment` references an existing `population[i].id` (superRefine); `lo ≤ hi` per range; bounds per §3.0.

### 3.2 Payout function

For segment `s` under plan `π`, with `Q_s = Q·m_s`, output `q ∈ ℝ` (the det path never produces `q < 0` since `q = a·e ≥ 0`; stochastic realizations can dip below zero and must have a defined payout — see the tier-1 extension term below):

```
V(q) = Σ_i r_i · ( min(q, Q_s·hi_i^eff) − Q_s·lo_i )⁺     (piecewise-linear commission; hi_i^eff = min(hi_i, x_cap))
W(q) = B + V(q) + r₁·min(q, 0) + L·1[ q ≥ x_b·Q_s ]         (tier-1's line extends below zero — Option B, ratified D-016+ in owner pass 2024-11-07; see §2.5)
```

where tiers past `x_cap` contribute 0 (the `(…)⁺` guard). The `r₁·min(q, 0)` term is zero for `q ≥ 0` and pays `r₁·q` (negative) on `q < 0` — i.e., tier-1's constant marginal rate `r₁ ≥ 0` extends across all of ℝ. Required API: `payout(q)`, `decompose(q) → { base, perTier[], bonus }` with the **exact identity** `base + Σ perTier + bonus = W(q)`, `marginalRate(q)` (right-limit), `kinks() → sorted list of q-values` (tier `from` values for i ≥ 2, bonus threshold, cap — all × `Q_s`).

Property (guaranteed by validation, asserted by tests): `W` is nondecreasing on all of ℝ (holds because `r₁ ≥ 0`).

#### 3.2a Payout-primitive extensions (V-01)

**Status.** Normative contract for V-01 payout primitives, authored before its engine code (D-007 oracle-first). The §6 ratification row for the v1.x reopening is still an owner action (Owner review list). The primitives are an **optional** `extras` block on the plan (`Plan.extras`, wire field `plans[].extras`); absent ⇒ identical `W` to §3.2, so every prior golden and every existing scenario is byte-unchanged (`extras` is additive-optional at `schemaVersion 1` — an absent field is not a breaking wire change; a future gate may promote it to a schemaVersion bump, but no existing data needs migration).

**The four primitives + one report.** Let `Q = Q_s`, and let `C(q) = V(q) + r₁·min(q,0)` be the **tier commission** of §3.2 (piecewise-linear, nondecreasing on ℝ; `= Σ perTier`). Extended payout, assembled in this fixed order:

```
C̃(q)    = max( C(q), D_nr )                         non-recoverable draw floors commission at D_nr ≥ 0 (else C̃ = C)
W_pre(q) = B + C̃(q)
           + L·1[ q ≥ x_b·Q ]                        bonus (§3.2, unchanged)
           + S·1[ q ≥ x_sp·Q ]                       SPIFF spot bonus, S ≥ 0, threshold x_sp > 0
           − K_c·1[ q < x_c·Q ]                       clawback, K_c ≥ 0, threshold x_c > 0 (lump penalty below x_c)
W(q)     = max( W_pre(q), F )                         pay-floor F clamps the whole payout (else W = W_pre)
```

- **Non-recoverable draw `D_nr`** — a guaranteed commission floor (`max(C, D_nr)`). Incentive-bearing: it flattens the low region.
- **SPIFF `S` at `x_sp`** — a second bonus lump, structurally identical to `L` on its own threshold (short-term promo).
- **Clawback `K_c` at `x_c`** — a lump penalty subtracted while `q < x_c·Q`. Modeled against realized output `q` (the engine has no deal-reversal variable); the mirror image of the bonus (a downward step below a floor), so **`W` stays nondecreasing** (the penalty binds only in the low region; crossing `x_c` upward _removes_ it). Chosen over a shortfall-rate or expected-haircut form as the cleanest monotone primitive a later reversal model can generalize.
- **Pay-floor `F`** — flips §3.2's Option-B negative-tail convention: instead of `W` dipping below `B` (or below 0) in the far-left tail, `W` is clamped at `F`. A plateau at `F` replaces the sub-`F` tail.
- **Recoverable draw `D_r` (report, not a payout term).** In this single-period static engine a fully-recovered advance nets against earned commission, so it changes neither `W` nor the optimized CE. Modeling it as an incentive-bearing floor would assert a recovery/timing dynamic the one-period engine cannot support (that is V-04, N-period). It is therefore surfaced as a **cash-flow report** on each `(segment, plan)` response: `cashAdvance = D_r`, `carry = (D_r − variablePay)⁺` where `variablePay = W(q) − B` (det: exact at `q = a·e*`; stoch: the _expected_ carry `E[(D_r + B − W(q))⁺]`, computed by the same positive-part integral as `floorTopUp` at level `D_r + B`). The response copy labels it "advance against commission; full-recovery assumption — multi-period recovery is V-04."

**Monotonicity (still guaranteed, asserted by tests).** `max(C, D_nr)`, the two up-steps (`L`, `S`), the below-threshold clawback (`= K_c·1[q≥x_c] − K_c`, an up-step minus a constant), and `max(·, F)` are each nondecreasing; their composition is nondecreasing. §3.5's monotone-`W` quantile logic and the §3.2 property both hold unchanged.

**Decomposition (exact identity extended).** `decompose(q)` gains four fields so conservation stays an independent check, not a tautology:
`{ base, perTier[], bonus, spiff, clawback, drawTopUp, floorTopUp, total }` with the **exact identity**

```
base + Σ perTier + bonus + spiff − clawback + drawTopUp + floorTopUp = W(q)
```

where `perTier` is the **raw** `C(q)` split (unchanged §3.2 formulas), `spiff = S·1[q≥x_sp Q]`, `clawback = K_c·1[q<x_c Q]` (stored as the positive amount subtracted), `drawTopUp = C̃ − C = (D_nr − C)⁺`, `floorTopUp = W − W_pre = (F − W_pre)⁺`. Algebra: `B + C + bonus + spiff − clawback + (C̃−C) + (W−W_pre) = W_pre + (W − W_pre) = W`. (I-1 in §3.6 sums all seven groups; identity.ts updated accordingly.)

**`kinks()` extension.** The candidate/piece breakpoint set gains: `x_sp·Q`, `x_c·Q`, the **draw crossing** `c_nr` (exact `q` where `C(q) = D_nr`, found by walking the tier pieces — `≥ 0` since `C(0)=0 ≤ D_nr`; omitted if `C` never reaches `D_nr`), and the **pay-floor crossing** `q_F` (exact `q` where `W_pre(q) = F` on its sloped piece; a jump that steps over `F` needs no added kink — the jump location is already one). All exact rationals. §3.3's deterministic candidate set is thereby complete for the extended `W`: flat pieces (draw/floor plateaus) are decreasing in `f(e)=W−ke²/2`, so their optima sit at a plateau endpoint, every one of which is now a seeded kink; sloped-piece optima remain the tier FOCs `r_i a/k`. (`e ≥ 0 ⇒ q ≥ 0`, so det ignores any `q_F < 0`; the stochastic piece set keeps it.)

**Stochastic path (float, §3.4).** CE, variance, `pieceProbabilities`, and `payoutCdf` are computed generically from `payoutPieces` (which probe the extended `payout`/`marginalRate` and split at the extended `kinks()`), so they extend with **no new closed form** — the floor plateau is a `β=0, α=F` piece; the steps are `α`-jumps; the draw plateau is `β=0, α=B+D_nr+…`. Only two things need explicit analytic work:

- **Expected decomposition.** `base, perTier_i, bonus` keep their §3.4 formulas; `spiff = S·P(q≥x_sp Q)`, `clawback = K_c·P(q<x_c Q)`. `drawTopUp = E[(D_nr − C(q))⁺]` and `floorTopUp = E[(F − W_pre(q))⁺]` use one shared analytic helper `expectedShortfall(pieces, T) → { prob: P(g<T), shortfall: E[(T−g)⁺] }` over the α+βq pieces of `g` (commission pieces for the draw term; pre-floor `W_pre` pieces for the floor term): per piece, intersect `[l,u]` with `{ (α−T)+βq < 0 }` (a lower sub-interval since `g` is nondecreasing) and add `(T−α)·P_sub − β·E[q·1_sub]` via §3.8 truncated moments. I-1 then checks `base + Σ + drawTopUp + floorTopUp` against the independent `E[W]` from `pieceMoments` (combined abs/rel tol per §3.6).
- **Optimizer ceiling `e_max` (§3.4).** The sufficiency bound `CE ≤ E[W] − ke²/2` needs the constant payout headroom widened to cover the new bounded lumps: replace `L` with `L⋆ = L + S + D_nr + F` in `ê_foc` (each is a nonnegative constant that can only raise `W`; the clawback and both floors only _reduce or bound_ the tail, so `c₀` stays a conservative over-estimate). `e_max` remains a provably sufficient over-estimate, so no optimum is missed; a looser ceiling only adds grid points.

**New float crossings (§3.7).** No new _kind_ of crossing: `expectedShortfall`, the extended `expectedDecomposition`, and the widened `e_max` all live in the existing Float64 column (stochastic KPIs / moments). The exact path (`decompose`, `payout`, `kinks` incl. the `c_nr`/`q_F` crossings) stays bigint-rational.

### 3.3 Deterministic best response (exact path)

`q = a_s·e` (σ ignored). The agent maximizes `f(e) = W(a_s·e) − k_s·e²/2`. `f` is piecewise concave-quadratic between kinks, so the global optimum is in the finite candidate set:

```
C = { 0 }
  ∪ { r_i·a_s / k_s  clamped to piece i's effort interval, for every tier i }   (interior FOC e° = r·a/k)
  ∪ { q̂ / a_s  for every q̂ ∈ kinks() }                                        (kinks, bonus threshold, cap)
```

Evaluate `f` exactly (rationals) at every candidate; take the max; tie-break to smaller `e`. Output per (segment, plan): `{ e*, q*, x*, payout, decomposition, ce = f(e*), marginalAtOpt, participation: ce ≥ Ū_s }`.

#### 3.3a Bounded-rationality response class (V-02)

**Status.** Normative contract for V-02 softmax response, authored before its engine code (D-007 oracle-first). The §6 ratification row for the v1.x reopening is still an owner action (Owner review list). B-001 adopted exact best response for v1 and kept the response interface pluggable "precisely so a rationality dial drops in without engine surgery" — this is that dial. It is **off by default**: `settings.rationality` is optional on the wire and defaults to `{ mode: 'exact' }`, under which every response, KPI, golden, and byte of every existing scenario is unchanged.

**The dial (Model-level).** `settings.rationality = { mode: 'exact' | 'softmax', tau τ }` — one population-wide decision-noise scale, edited on the **Model** surface (it describes how the population _chooses_, not what the plan pays). `τ` is a decimal string in **currency units** — the same units as CE — with the reading: _differences in certainty-equivalent much smaller than `τ` are invisible to the agent; differences much larger than `τ` are decisive._ Range `(0, 1e12]` per the §3.0 table; schema default `"5000"` (adopted when the dial is switched on; a scenario that never switches it on never writes the field). A per-segment `τ` is the obvious generalisation and is **not** built here — the dial is deliberately one number so the honesty framing stays legible.

**Choice set (finite, mode-dependent).** For segment `s` under plan `π`:

```
E_s(π) = C(π, s)  ∪  { e*_mode }
```

`C` is the §3.3 exact candidate set (deduplicated, sorted, `e ≥ 0`); `e*_mode` is the active mode's own optimum — already an element of `C` in deterministic mode, and the §3.4 refined optimum in stochastic mode (so the τ → 0⁺ limit reproduces the exact response in **both** modes). This is a **strategy menu, not a discretization**: `C` is exactly the set of efforts the plan itself makes salient — zero, each tier's interior FOC, and every threshold/kink crossing (bonus, SPIFF, clawback, cap, draw and pay-floor crossings per §3.2a). The modeling claim is that a boundedly-rational rep chooses noisily _among the plan's salient plays_, not that they sample a continuum. Consequently the τ → ∞ limit is the uniform distribution over that menu, which is a meaningful "reads the plan, picks arbitrarily" limit rather than an artifact of grid resolution.

**Weights (logit / Luce choice).** Let `f_j = f_s(e_j)` be the active mode's own objective at candidate `e_j` — deterministic: `W(a_s e_j) − k_s e_j²/2` (exact); stochastic: `CE(e_j)` per §3.4 (float) — and `f⋆ = max_j f_j`:

```
w_j = exp( (f_j − f⋆) / τ )              float64; the argmax has w = 1 exactly ⇒ Σ w ≥ 1 > 0
p_j = w_j / Σ_k w_k
```

Shifting by `f⋆` is normative, not an optimization: it makes the weights overflow-proof and guarantees a nonzero denominator at every τ. **Tail flush (normative):** a candidate with `(f_j − f⋆)/τ < −64` takes weight exactly `0` and drops out. Its probability would be below `1.6e-28` — 27 orders of magnitude below the best play, which is not a modeled behavior — and the cutoff bounds the dyadic denominators that the exact normalization below carries, so a probability always converts back to float64 in range (`exp(−64) ≈ 2⁻⁹²`, versus `2⁻¹⁰⁷⁴` for a subnormal weight, whose rational form no longer survives `Rat.toNumber`). **Ties:** candidates sharing `f⋆` each get weight `1`, so mass splits evenly among them and `p` does not depend on the §3.3 lower-effort tie-break. `mode = 'exact'` — not `τ = 0`, which the schema rejects — is the exact §3.3/§3.4 path with its tie-break intact.

**Exact/float seam (a new §3.7 crossing).** The exponential is float64, and in deterministic mode it is the **first** float on a previously all-exact path, so the crossing is pinned here: each `w_j` re-enters the exact path through `Rat.fromFloat64(w_j)` (exact dyadic conversion — the same seam §3.11 already ratifies for MC), and the normalization `p_j = w_j / Σ_k w_k` is then performed **in exact rationals**. Therefore `Σ_j p_j = 1` exactly, and every downstream deterministic quantity (payout, decomposition, KPIs, I-1) stays exact bigint-rational. In stochastic mode the weights stay float64 like the rest of §3.4. Recorded in §3.7's Float64 column as _softmax choice weights_.

**Response aggregation (the response becomes a mixture).** The response record keeps every field it had — each now the mixture aggregate — and gains the mixture itself. With `q_j = a_s e_j` and `W_j` the component payout (deterministic: `W(q_j)` exact; stochastic: `E[W | e = e_j]` per §3.4):

```
components_j  = { p_j, e_j, q_j, W_j, decomposition_j, f_j }
effort        = Σ p_j e_j                 output = Σ p_j q_j = a_s · effort
payout        = Σ p_j W_j                 decomposition = Σ p_j decomposition_j   (field-wise)
ce            = Σ p_j f_j                 the CE the population actually realises
ceGap         = f⋆ − ce ≥ 0               the honesty number: CE burned by not playing the optimum
modal         = argmax_j p_j              (ties → smaller e) — "where most reps sit"
attainment    = output / Q_s              marginalAtOpt = marginal rate at the modal component's output
participation = ce ≥ Ū_s                  (the realised, not the optimal, CE)
```

The §3.2a recoverable-draw report follows the same rule with the positive part taken **per component**: `carry = Σ_j p_j·(D_r − (W_j − B))⁺`, which is the mixture's expected carry and mirrors the stochastic `E[(D_r + B − W)⁺]` (never `(D_r − mean variable pay)⁺`, which would understate it by Jensen).

`decomposition` is aggregated field-wise, so the §3.2a identity `base + Σ perTier + bonus + spiff − clawback + drawTopUp + floorTopUp = payout` survives as a **convex combination of identities** — exactly in deterministic mode (I-1 exact), within the §3.6 tolerance in stochastic mode. Stochastic `pieceProbabilities` and `Var[W]` are mixture quantities: `P(piece) = Σ_j p_j P_j(piece)` (so I-2 still sums to 1) and `Var[W] = Σ_j p_j (Var_j + E_j²) − (Σ_j p_j E_j)²`. **`mode = 'exact'` is the one-component mixture `{ p = 1, e = e* }`, and every formula above reduces to §3.3/§3.4 bit-identically** — multiplication by an exact `1` (det) or a float `1` (stoch) — which is why no prior golden moves.

**KPIs (§3.5) under a mixture.** `expectedRevenue`, `totalComp`, `trueValue`, `compRatio`, and `effectiveCommissionRate` read the mixture means and their formulas are untouched. Two KPIs are restated because they were written against a single response:

- `quotaAttainRate = Σ_s n_s·p_s / Σ_s n_s` with `p_s = Σ_j p_j·1[x_j ≥ 1]` (det) or `p_s = Σ_j p_j·(1 − Φ((Q_s − q_j)/σ_s))` (stoch, `σ_s > 0`). Under a one-component mixture these are the §3.5 rules verbatim; under softmax a segment contributes a **fraction**, which is the correct reading of "this share of the roster clears quota".
- Payout quantiles: det = the weighted lower quantile over **every component** with weight `n_s·p_j` (rational weights; with one component per segment the integer-count rule of §3.5 is recovered exactly). Stoch = the same mixture bisection with `P(W_s ≤ w) = Σ_j p_j·Φ((q_w − q_j)/σ_s)`; `q_w = sup{ q : W(q) ≤ w }` is a property of `W` alone and is unchanged.

**Scope boundaries (deliberate, V-02).** The dial governs the **effort choice**. It does not silently spread anywhere else:

- **§3.10 timing keeps the exact best response** — per-period myopic efforts and the shift optimum `z*` stay exact, and L-7 is unchanged. A noisy joint choice over `(e₁, e₂, z)` is a different object and belongs with the N-period work (V-04). The boundary panel states this whenever the dial is on.
- **The §3.9 linter runs under the active response class**, so findings and the simulation never contradict each other. The two rules that key on _exact_ kink-bunching — L-1's warn branch (`x* = ` the zone floor) and L-3's deterministic cap-bunching branch — test the **modal** component; under `mode = 'exact'` the modal component _is_ `e*`, so LF-1…LF-6 are unchanged.
- **MC (§3.11) inherits the dial through `simulate`.** The draw protocol, canonical order, and RNG stream are untouched; softmax adds no randomness anywhere (the weights are a deterministic function of the objective).

**Goldens (hand-derived — §9; law).** Segment `a = 100, k = 100, ρ = 0, Ū = 0, m = 1`; plan `B = 10, Q = 100`, one tier `r = 0.1`. Then `C = {0, 0.1}` with `f(0) = 10` and `f(0.1) = 11 − 0.5 = 10.5`, so the gap is exactly `0.5` and at `τ = 0.5` the weights are `(e⁻¹, 1)` — the logistic. Values below are the closed forms evaluated to double precision; the implementation reproduces them, it does not define them (abs tol 1e-12).

| Golden                                                                         | Closed form                                          | Value                                                                                     |
| ------------------------------------------------------------------------------ | ---------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| G1 `p(e = 0.1)`                                                                | `1/(1 + e⁻¹)`                                        | `0.73105857863000490`                                                                     |
| G1 `p(e = 0)`                                                                  | `e⁻¹/(1 + e⁻¹)`                                      | `0.26894142136999510`                                                                     |
| G1 `effort`                                                                    | `0.1·p₁`                                             | `0.073105857863000487`                                                                    |
| G1 `payout`                                                                    | `10 + p₁`                                            | `10.731058578630005`                                                                      |
| G1 `ce`                                                                        | `10 + 0.5·p₁`                                        | `10.365529289315003`                                                                      |
| G1 `ceGap`                                                                     | `0.5·p₀`                                             | `0.13447071068499755`                                                                     |
| G2 (add bonus `L = 40, x_b = 1` ⇒ `C = {0, 0.1, 1}`, `f = (10, 10.5, 10)`) `p` | `(e⁻¹, 1, e⁻¹)/(1 + 2e⁻¹)`                           | `(0.21194155761708544, 0.57611688476582912, 0.21194155761708544)`                         |
| G2 `effort`                                                                    | `0.1·p₁ + 1·p₂`                                      | `0.26955324609366837`                                                                     |
| G2 `payout`                                                                    | `10p₀ + 11p₁ + 60p₂`                                 | `21.173194765620103`                                                                      |
| G2 `ce` / `ceGap`                                                              | `10 + 0.5·p₁` / `0.5·(p₀ + p₂)`                      | `10.288058442382916` / `0.21194155761708544`                                              |
| G2 `quotaAttainRate`                                                           | `p₂` (only `e = 1` reaches `x = 1`)                  | `0.21194155761708544`                                                                     |
| G3 τ → 0⁺ (`τ = 1e-9`)                                                         | exact response recovered                             | `effort = 0.1`, `ce = 10.5`, `ceGap = 0`                                                  |
| G3 τ → ∞ (`τ = 1e9`, G2 menu)                                                  | uniform over the menu                                | `effort → (0 + 0.1 + 1)/3 = 0.36666666666666670`                                          |
| G4 stochastic (`σ = 25, ρ = 0.01`, G1 plan)                                    | `CE(e) = 10 + 10e − ρβ²σ²/2 − 50e²`, gap again `0.5` | `effort = 0.073105857863000487`, `payout = 10.731058578630005`, `ce = 10.334279289315003` |

G4's `CE(0) = 9.96875` and `CE(0.1) = 10.46875` come from §3.4's single-piece sanity anchor (`CE = B + βμ − ρβ²σ²/2 − ke²/2`, `ρβ²σ²/2 = 0.01·0.01·625/2 = 0.03125`), so its gap is `0.5` exactly and the logit weights are G1's. Structural goldens that carry equal weight: `Σ_j p_j = 1` **exactly** (rational equality, det) for every scenario; `ceGap ≥ 0` always; and I-1 conservation holds exactly under a softmax mixture.

#### 3.3b Two-task multitasking response (V-03)

**Status.** Normative contract for V-03 multitasking engine, authored before its engine code (D-007 oracle-first). The §6 ratification row for the v1.x reopening is still an owner action (Owner review list). §2.5 shipped v1 with the Goodhart **wedge report** only (L-5); this is the effort-allocation model underneath it, so the wedge is _computed_ rather than flagged. It is **off by default**: `Segment.secondTask` is optional on the wire, and when it is absent every response, KPI, finding, and byte of every existing scenario is unchanged.

**The model (Holmström–Milgrom 1991, in the form this product needs).** The rep divides effort between two activities the plan **cannot tell apart** but the business values differently. Task 1 is the segment's existing activity (ability `a₁ = a_s`, value per revenue unit `γ_s`). Task 2 is the new block:

```
secondTask = { ability a₂ ≥ 0 , valuePerEffort v₂ ≥ 0 , costSubstitution ψ ∈ [0, 0.95] }
```

- **`a₂`** — **measured** revenue per unit of task-2 effort. `a₂ = 0` is the fully _unmeasured_ task (service, pipeline hygiene, mentoring): real value the plan never sees.
- **`v₂`** — **true value per unit of task-2 effort**, in currency. Deliberately _per effort_, not per revenue unit: an unmeasured task has no revenue to divide by. A task that is measured _and_ carries value quality `γ₂` is written `v₂ = γ₂·a₂`.
- **`ψ`** — cost substitutability. Effort cost `C(e₁, e₂) = (k_s/2)·(e₁² + 2ψ·e₁e₂ + e₂²)`; `ψ = 0` = independent activities, `ψ → 1` = one pot of effort. This is the HM 1991 mechanism itself: with separable costs, sharpening task-1 incentives cannot crowd out task 2. The `0.95` ceiling keeps `1 − ψ²` bounded away from zero (§3.0).

Measured revenue is `q = a₁e₁ + a₂e₂` — the only thing `W` ever sees. True value is `V = γ_s·a₁e₁ + v₂·e₂`.

**Exact reduction to one dimension.** For any target measured revenue `q` the rep buys it with the cheapest allocation. With `M = [[1, ψ], [ψ, 1]]` and `a = (a₁, a₂)`:

```
D        = a₁² − 2ψ·a₁a₂ + a₂²                       (> 0 under the §3.0 bounds)
interior ⟺ a₁ ≥ ψ·a₂  and  a₂ ≥ ψ·a₁                 (both efforts nonnegative)
S        = D / (1 − ψ²)            interior
         = max(a₁, a₂)²            corner  (all effort on the more productive task)
e(q)     = ( q(a₁ − ψa₂)/D , q(a₂ − ψa₁)/D )         interior
         = ( q/a_j on the corner task , 0 )          corner
cost     = C(e(q)) = k_s·q² / (2S)
```

`S` is the **task-portfolio efficiency**. The two branches agree where they meet (`ψ·max(a) = min(a)`), so `S` is continuous in `ψ` and the interior formulas may be evaluated whenever the interior test passes. The rep's problem therefore collapses to the §3.3 problem in `q`:

```
max_{q ≥ 0}  W(q) − k_s·q² / (2S)
```

which is **the existing solver run on the effective segment** `{ ability: a₁ , costK: k_s·a₁²/S }` — both exact rationals, every other field unchanged. Per-piece FOCs become `q = r_i·S/k_s`; the candidate set, `kinks()`, the lower-effort tie-break, the §3.3a softmax mixture, and the §3.4 CARA optimizer all carry over verbatim, and the response's reported `effort` is the revenue-equivalent effort `q/a₁` (the task split lives in the multitask report). **With no second task `S = a₁²`, the effective segment _is_ the segment** — so §3.3, §3.4, §3.3a, §3.5, §3.9, §3.10, §3.11 and every frozen golden are bit-unchanged. This is the whole reason the reduction is worth stating: V-03 adds no new solver.

**The distortion report (exact).** Let `g = (γ_s·a₁, v₂)` — true value per unit of each task's effort. The same construction with `g` in place of `a` gives the **value-efficient** portfolio efficiency `S_v`. At the realised effort cost `c* = k_s·q*²/(2S)`, the largest true value _any_ allocation costing the same `c*` could deliver is `V_max = √(2·c*·S_v / k_s)` — irrational in general, but `V_max²` is an exact rational. Per (segment, plan):

```
valueDelivered  = V(e*) = γ_s·a₁e₁* + v₂·e₂*
valueCeilingSq  = V_max² = 2·c*·S_v / k_s
distortionIndex = 1 − V(e*)² / V_max²        ∈ [0, 1]   (0 by definition when c* = 0)
```

`V(e*) ≤ V_max` is Cauchy–Schwarz in the `M`-inner product restricted to `e ≥ 0`, so `distortionIndex ∈ [0, 1]` is a provable invariant, not a hope — it is property-tested. The engine reports it exactly; the UI displays the value-efficiency percentage `√(1 − distortionIndex)`, a **render-boundary** conversion (§3.7), never a new engine float crossing. Reading: _this is the share of achievable value the plan's own incentives throw away at the effort level it induces._

**Consequences elsewhere (each deliberately small).**

- **§3.5 KPIs.** `trueValue = Σ_s n_s·V_s`. With no second task `V_s = γ_s·q_s`, so the §3.5 formula is recovered verbatim. Every other KPI reads measured revenue and is untouched.
- **§3.9 L-5.** The pairwise ranking-flip rule is unchanged. The single-plan branch additionally fires when any segment has `distortionIndex > 0`, carrying the allocation numbers as evidence — impossible without a second task, so **LF-1…LF-6 stay frozen**.
- **§3.10 timing.** The per-period demand multiplier `d_p` scales **both** abilities (`S → d_p²·S`, so `costK·a₁²/S` is invariant and only the effective ability moves) — the reduction is stable under seasonality.
- **§3.11 MC.** Ranges are **not** extended to `a₂`: the canonical draw order is contract-frozen and O-G's bit-replay depends on it. The global `demand` multiplier scales both abilities, consuming no extra RNG.

**Goldens (hand-derived — §9; law).** Segment `a₁ = 100, k = 100, γ = 1, ρ = 0, Ū = 0, m = 1`; plan `B = 0, Q = 10`, one tier `r = 0.1`, no bonus/cap. Exact rationals throughout.

| Golden | Second task                 | Expected                                                                                                                                              |
| ------ | --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| **M1** | absent                      | response deep-equals the §3.3 response (structural: the effective segment is the segment)                                                             |
| **M2** | `a₂ = 50, v₂ = 25, ψ = 0`   | `S = 12500`, `q* = 12.5`, `e* = (0.1, 0.05)`, payout `1.25`, `ce = 0.625`, `V = 11.25`, `distortionIndex = 4/85`                                      |
| **M3** | `a₂ = 50, v₂ = 25, ψ = 1/4` | `D = 10000`, `S = 32000/3`, `q* = 32/3`, `e* = (7/75, 2/75)`, payout `16/15`, `ce = 8/15`                                                             |
| **M4** | `a₂ = 50, v₂ = 25, ψ = 1/2` | boundary case `ψ·a₁ = a₂`: `S = 10000`, `q* = 10`, `e* = (0.1, 0)` — crowd-out is total, and the interior and corner formulas agree                   |
| **M5** | `a₂ = 0, v₂ = 40, ψ = 0`    | unmeasured task: `e₂* = 0` and the response is §3.3's exactly, yet `distortionIndex = 4/29` — pay only for what you measure and the rest gets nothing |

M2's arithmetic, end to end: `S = a₁² + a₂² = 12500`; `q* = r·S/k = 12.5`; `e* = q*(a₁, a₂)/D = (0.1, 0.05)`; `cost = k q*²/(2S) = 0.625`; `V = 1·100·0.1 + 25·0.05 = 11.25`; `S_v = 100² + 25² = 10625`; `V_max² = 2·0.625·10625/100 = 132.8125`; `V²/V_max² = 126.5625/132.8125 = 81/85`. Structural goldens carrying equal weight: `distortionIndex ∈ [0, 1]` for every scenario; `q₁ + q₂ = q` exactly; and `secondTask = null ⇒ byte-identical response`.

### 3.4 Stochastic best response (CARA-normal, float path)

`q = a_s·e + ε`, `ε ~ N(0, σ_s²)`, CARA utility `u(w) = −exp(−ρw)` for `ρ > 0`.

Write `W` as pieces `W(q) = α_j + β_j q` on `(l_j, u_j]` (fold the bonus lump into `α_j` for pieces at/above the threshold; outermost bounds ±∞; below `q = 0` treat as the first piece — negative `q` realizations are allowed and paid at the first tier's line; document this in UI copy). With `μ = a_s·e`:

```
E[exp(−ρW(q))] = Σ_j exp(−ρα_j − ρβ_j μ + ρ²β_j²σ²/2) · [ Φ((u_j − μ + ρβ_j σ²)/σ) − Φ((l_j − μ + ρβ_j σ²)/σ) ]

CE(e) = −(1/ρ)·ln( E[exp(−ρW(q))] ) − k_s e²/2
```

(from the truncated normal MGF `E[e^{tq}·1(l<q<u)] = e^{tμ + t²σ²/2}·[Φ((u−μ−tσ²)/σ) − Φ((l−μ−tσ²)/σ)]` with `t = −ρβ_j`).

**Sanity anchor (must hold analytically and in tests):** for a single-piece linear plan `W = B + βq`, this reduces exactly to `CE(e) = B + βμ − ρβ²σ²/2 − k e²/2`, so `e* = βa/k` independent of `ρ, σ`.

**ρ = 0 branch (risk-neutral):** `CE(e) = E[W(q)] − k e²/2` using truncated first moments (§3.8).

**Optimizer (deterministic, documented) — provably sufficient ceiling.** Maximize `CE(e)` on `[0, e_max]`,

```
ê_kink = max(kinks()) / a_s                                    (kinks include tier froms i≥2, bonus threshold, cap × Q_s — §3.2)
r̄     = max_i r_i
c₀    = (1/ρ)·ln( 1/2 + Φ(ρ·r₁·σ_s)·exp((ρ·r₁·σ_s)²/2) )      (Option B, §3.2; = 0 under Option A)
ê_foc = [ r̄·a_s + √( (r̄·a_s)² + 2·k_s·(L + 0.4·r̄·σ_s + c₀) ) ] / k_s
e_max = 1.05 · max( ê_kink + 6σ_s/a_s , ê_foc )
```

**Sufficiency proof (two lines):** `CE(e) ≤ E[W] − k e²/2 ≤ B + L + r̄·a·e + 0.4·r̄·σ − k e²/2` (using `E[q⁺] ≤ μ + σφ(0) = μ + σ/√(2π) ≤ μ + 0.4σ` and pay ≤ `B + L + r̄·(q⁺ + σ tail contribution)`); and `CE(e*) ≥ CE(0) ≥ B − c₀` (Option B lower-bounds `CE(0)` by the tier-1 left-tail cost `c₀`; under Option A, `c₀ = 0`). Combining: at any optimum, `k·e*²/2 − r̄·a·e* − (L + 0.4·r̄·σ + c₀) ≤ 0`, whose positive root is `ê_foc`. So every optimum satisfies `e* ≤ max(ê_kink, ê_foc)`; the 1.05× margin absorbs float slack.

**Verification:** the A1 counterexample (a=100, k=1, r=0.1, σ=0.01, ρ=1e-3) gives `ê_foc ≈ 20.0`, `e_max ≈ 21.0` — comfortably covers `e* = βa/k = 10`. The realistic Senior/T2/`m=1.5` case (`a=1.3e6, k=8.5e4, r̄=0.13, σ=2e5, ρ=5e-5, L=0`) gives `e_max ≈ 4.04` — covers `e° = 1.988`. Note all §3.3 seeds now lie inside `[0, e_max]` by construction: interior FOC seeds `r_i·a/k ≤ ê_foc` (since `r_i ≤ r̄`), and kinks `≤ ê_kink`.

**Candidate seeds and refinement (pinned):**

1. Evaluate `CE` at the union of a uniform 512-point grid on `[0, e_max]` and the deterministic candidate set `C` (§3.3).
2. Sort all evaluated points by `e` (ascending).
3. For each of the three points with the highest CE, form a bracket `(e_prev, e_next)` from its immediate sorted neighbours (clamp at 0 and `e_max`).
4. Golden-section-search each bracket to `|b − a| ≤ 1e-12 · max(1, e_max)`; take the best refined value.

`CE` can be multimodal (that is the economics — cliffs create local optima); the grid + candidate seeding guarantees globality to grid resolution, and every kink/bonus/cap candidate is seeded _exactly_ so cliff optima are hit without depending on grid resolution. No randomness anywhere in the optimizer.

**Float hygiene (normative):**

- Compute `E[exp(−ρW)]` in log-space **per-term** (tail-safe against pieces where `ΔΦ_j` has underflowed): with `A_j = −ρα_j − ρβ_j μ + ρ²β_j²σ²/2`, form `t_j = A_j + lnΔΦ_j` per piece (skip any piece with `ΔΦ_j = 0` exactly), then `ln E = t* + ln Σ_j exp(t_j − t*)` where `t* = max_j t_j`. A naive pivot that uses the `A_j` scale alone (then multiplies by `ΔΦ_j` afterward) is **not** tail-safe: when the argmax piece has an underflowed `ΔΦ` and every other piece's `exp(A_j − pivot)` also underflows, the sum is exactly zero and `CE = ±∞/NaN`. Use `lnΔΦ_j` computed via a stable `logPhi`:
  - for `z ≥ −8`, `ln(Φ(z))` directly (Φ safely above underflow);
  - for `z < −8`, the asymptotic `ln(φ(z)/(−z))·(1 − z⁻² + 3z⁻⁴ − 15z⁻⁶ + 105z⁻⁸)` expressed as `−z²/2 − ln(−z) − ln(2π)/2 + ln1p(−z⁻² + 3z⁻⁴ − 15z⁻⁶ + 105z⁻⁸)`.
    Compute interval log-probabilities `lnΔΦ_j = ln(Φ(z_u) − Φ(z_l))` on the survival side using the existing orientation flip (`Φ(u) − Φ(l) = Φ(−l) − Φ(−u)` when both endpoints are positive) plus `log1mexp(x) = ln(1 − exp(x))` for `x ≤ 0`. This prevents both overflow at large ρ·payout and the tail-collapse-to-zero failure mode.
- Compute each interval probability `ΔΦ_j` in the tail-stable orientation: when both endpoints are positive, use `Φ(u)−Φ(l) = Φ(−l)−Φ(−u)`.
- `σ_s = 0` in stochastic mode: that segment falls back to the deterministic response (§3.3), converted to float at aggregation; its distributions are point masses (no division by σ anywhere).
- `ρ_s > 0` but `ρ_s·(W(a_s·e_max) − W(0)) < 1e-8`: use the ρ = 0 branch (documented switch — avoids `ln(1−ε)/ρ` cancellation at tiny ρ).

**Distributions (analytic, no simulation):** given `e*`, `q ~ N(a_s e*, σ_s²)`. Tier-occupancy probabilities, expected payout `E[W]`, and `Var[W]` come from truncated moments per piece:
`E[W] = Σ_j (α_j P_j + β_j E[q·1_j])`, `E[W²] = Σ_j (α_j² P_j + 2α_j β_j E[q·1_j] + β_j² E[q²·1_j])`.

**Expected decomposition (drives I-1 in stochastic mode):** `base = B`; `bonus = L·P(q ≥ x_b·Q_s)`.

- **Tier 1** (extended below zero per §3.2): `perTier_1 = r_1·( E[q·1{q ≤ d_1}] + d_1·P(q > d_1) )` with `d_1 = Q_s·hi_1^eff`. This includes negative-`q` contributions (no positive-part guard on tier 1's lower side, since tier 1's line extends across ℝ) and folds the standard plateau term for `q > d_1`.
- **Tiers `i ≥ 2`:** `perTier_i = r_i·( E[(q − c)·1{c < q ≤ d}] + (d − c)·P(q > d) )` with `c = Q_s·lo_i`, `d = Q_s·hi_i^eff`.
- **`d = ∞` branch (uncapped final tier)** — required for T1/T2 templates; every formula that consumes `hi_i^eff` must branch on `∞`: `perTier_M = r_M·( E[(q − c)·1{q > c}] )` (no plateau term). Concretely `= r_M·( (μ − c)·(1 − Φ(z_c)) + σ·φ(z_c) )` with `z_c = (c − μ)/σ` for `M ≥ 2`; if `M = 1` (so `c = 0` too), it reduces to `r_1·μ`. The §3.8 raw truncated moments already handle `d = ∞` via the `zφ(z) → 0` limit; consumers of `hi_i^eff` (this decomposition, and any KPI that materializes `E[(min(q,d)−c)⁺]` per tier) must take the finite/`∞` split explicitly rather than relying on IEEE `∞·0 = NaN`.

Identity checked: `base + Σ perTier + bonus = E[W]` (rel ≤ 1e-9). This is preserved by the tier-1 extension: `E[V(q)] + r_1·E[min(q,0)] = Σ_i r_i·E[max(min(q,d_i)−c_i, 0)] + r_1·E[min(q,0)]`; for `i=1` (with `c_1=0`) the two tier-1 pieces telescope to `r_1·E[min(q, d_1)] = r_1·( E[q·1{q ≤ d_1}] + d_1·P(q > d_1) )`, and tiers `i ≥ 2` are unchanged.

### 3.5 Aggregation & KPIs

Per plan, over segments (weights `n_s`): expectedRevenue `= Σ n_s·a_s·e*_s`; totalComp `= Σ n_s·E[W_s]`; compRatio `= totalComp / expectedRevenue`; quotaAttainRate `= Σ n_s·p_s / Σ n_s` where `p_s = 1[x* ≥ 1]` (det) or (stoch) `1 − Φ((Q_s − a_s e*_s)/σ_s)` for `σ_s > 0` and `1[x*_s ≥ 1]` for `σ_s = 0` (point-mass fallback per §3.4); effectiveCommissionRate `= (totalComp − Σ n_s B) / expectedRevenue`; trueValue `= Σ n_s·V_s` where `V_s = γ_s·a_s·e*_s` — restated under §3.3b as `V_s = γ_s·a₁e₁* + v₂·e₂*`, which reduces to `γ_s·a_s·e*_s` verbatim when no second task is set; retentionRisk = list of segments with `CE < Ū`.

**Participation semantics.** All aggregates above are computed over the **full roster regardless of `participation`**; v1 does not model exit or churn. `participation` (derived from `CE ≥ Ū`) and `retentionRisk` are **diagnostics** that surface as L-4 findings — they never remove headcount from a KPI. KPI cards render the copy "assumes full roster; see retention risk" whenever any segment has `participation = false`, so a reader is not misled into treating totalComp as attrition-adjusted.

**Zero-revenue KPIs (degenerate populations).** When `expectedRevenue = 0` (e.g., an all-zero-rate no-bonus plan; or a `movable`-only population with `a = 0`), `compRatio` and `effectiveCommissionRate` are the sentinel `null` — never a divide, never `NaN`, never `Infinity`. UI renders "—" with a tooltip stating the population produced no expected revenue. `null` never enters downstream arithmetic (compare deltas, MC aggregates skip `null` and note the missing points; identity checks I-1/I-3 skip the KPI attestation for that plan).

**All-zero-rate no-bonus plan.** A plan with every `r_i = 0` and no bonus is schema-valid; it yields `e* = 0` for every segment (the FOC seed is `0` for every tier; `f(0) = B > f(e) = B − ke²/2` for `e > 0`), `p_s = 0` in det mode (unless `Q_s = 0`, which the §3.1 `Q > 0` rule forbids), and `null` for the ratio KPIs.

Population payout quantiles (P10/P50/P90): det = weighted lower quantile over point masses; stoch = bisection on the mixture CDF `F(w) = Σ n_s P(W_s ≤ w)/Σ n_s`. Per-segment `P(W_s ≤ w)` is analytic: for `σ_s > 0`, `Φ((q_w − μ)/σ)` with `q_w = sup{ q : W(q) ≤ w }` — the sup handles plateaus (cap, zero-rate tiers) and the bonus jump, where `W` is not strictly monotone; for `σ_s = 0` (point-mass fallback per §3.4), `P(W_s ≤ w) = 1[W(a_s·e*_s) ≤ w]` — no division by `σ`. Bisection bracket `[min_s W_s(a_s·e*_s − 12σ_s), max_s W_s(a_s·e*_s + 12σ_s)]` (left endpoint uses `W_s` — not `B` — because under §3.2's tier-1 extension `W` can dip below `B` in the far-left tail; for point-mass segments the 12σ envelope collapses to `W(a_s·e*_s)` on both sides), absolute tolerance 1e-9 × bracket width. **Constant-payout populations:** if the bracket width is already `≤` tolerance (every segment paying the same amount), return the lower endpoint as the quantile — no bisection required.

**Mixture responses (§3.3a).** When `settings.rationality.mode = 'softmax'` a segment's response is a mixture over its choice set, and `quotaAttainRate` and the payout quantiles are restated in §3.3a (fractional attainment share; component-weighted quantiles / mixture CDF). Every other KPI above reads the mixture mean and is unchanged. Under the default `mode: 'exact'` the mixture has one component and every rule in this section applies verbatim.

### 3.6 Global consistency identities (checked on EVERY simulation run)

- **I-1 Payout conservation:** totalComp computed as `Σ_s n_s·payout_s` must equal `Σ_s n_s·(base + Σ perTier + bonus + spiff − clawback + drawTopUp + floorTopUp)_s` (the last four groups are the §3.2a V-01 extension terms — zero when no `extras` are set) under every decomposition the UI displays. Under a §3.3a softmax mixture both sides are the same convex combination of per-component quantities, so the identity holds unchanged (and stays exact in det mode). Exact equality (rationals) in det mode; stoch mode uses the combined abs/rel tolerance `|lhs − rhs| ≤ 1e-9 · max(1, |totalComp|)` (guards against a purely-relative check at `totalComp = 0`, e.g., a degenerate all-base no-effort scenario).
- **I-2 Probability conservation (stoch):** per segment, tier-occupancy probabilities sum to 1 ± 1e-12.
- **I-3 Compare consistency:** every A−B delta shown in compare view equals recomputation from the two independent runs (exact / ≤ 1e-12).
- **I-4 Round-trip:** export → import reproduces a scenario that simulates to identical results (exact in det; bit-identical floats in stoch, same engine version).

`simulate()` returns identity attestations `{ id, pass, maxErr }`; a failed identity throws in dev and renders a blocking error state in the UI (never silently). The UI always shows the attestation badge (§4.6).

### 3.7 Exact/float boundary

| Exact (bigint rationals)                                                                                                          | Float64 (documented)                                                                                                                           |
| --------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| All plan arithmetic: `W`, decompose, kinks, marginal rates                                                                        | Everything through `exp/ln/Φ/φ`: stochastic CE, truncated moments, distributions                                                               |
| Deterministic best response end-to-end (candidates, CE compare, KPIs)                                                             | Stochastic optimizer and stochastic KPIs (tolerances stated per identity/oracle)                                                               |
| Softmax **normalization** and mixture aggregation, det path (`p_j = w_j / Σ w_k` in rationals ⇒ `Σ p_j = 1` exactly; §3.3a)       | Softmax **choice weights** `w_j = exp((f_j − f⋆)/τ)` (§3.3a) — the only float on the deterministic path; re-enters exact via `Rat.fromFloat64` |
| Timing-module shift optimization (det)                                                                                            | Monte Carlo sampling and aggregates                                                                                                            |
| §3.3b multitasking end-to-end: `S`, `S_v`, the effective segment, the allocation, `V`, `V_max²`, `distortionIndex`                | §3.14 tournament path: the Simpson quadrature for `C_{n,w}`, the win probability, and the best-response iteration                              |
| §3.10a horizon end-to-end: quota chain, `Λ`, the shadow rate, per-period efforts, adjacent shifts; §3.14 split-credit equilibrium | —                                                                                                                                              |
| Zod-validated user input (decimal-string → rational)                                                                              | SVG rendering coordinates (`toNumber` at the render boundary only)                                                                             |

**Render-boundary conversions are not float crossings.** §3.3b's value-efficiency display (`√(1 − distortionIndex)`) and every `toNumber()` in a component are the _existing_ SVG/render-boundary permission in the right column's last row — the engine value stays exact and nothing downstream of the display consumes the float. Only the tournament column above is a genuinely new float path, and it is new only in the sense that it uses `Φ`/`φ` — the same transcendentals §3.4 and §3.8 already own.

Rationals: `Rat = { n: bigint, d: bigint }`, normalized (gcd = 1, d > 0). Ops: add/sub/mul/div/neg/cmp/min/max, `fromDecimalString` (exact, grammar per §3.0 incl. exponent), `fromFloat64` (exact dyadic conversion of the IEEE-754 value; used only where §3.11 says), `toNumber` (lossy float crossing — **permitted only at (a) the SVG render boundary and (b) the §3.7 float column, i.e. stochastic-path input conversion**; every conversion asserts finiteness — unreachable under §3.0 bounds), `toFixed(dp)` with half-even rounding, `toDecimalString` (exact shortest decimal, **defined only for Rats whose reduced denominator has the form `2^a · 5^b`** — throws `INTERNAL_INVARIANT` otherwise; used by `serializeScenario`, §4.2/§4.3), `serialize "n/d"` (internal only, not for persistence).

**Three representations (normative) and the two boundary crossings — see §4.2/§4.3 for wiring:**

- **`ScenarioJson`** — the _wire_ form (decimal strings for every §3.0 decimal-string field; plain JSON integers for `n_s`, `mc.seed`, `mc.N`, `schemaVersion`). This is the **only** form ever written to persistence (localStorage), URL codec, or JSON export. `JSON.stringify` never sees a bigint.
- **`Scenario`** (domain) — Rat-typed; the Zustand store holds **this**; the engine consumes **this**. The domain types live in `engine/types.ts` (pure — G-11-clean); the import direction is `state → engine`, never the reverse (`engine/**` imports nothing from `state/`).
- **Form drafts** — raw strings in UI-local component state; a draft becomes a `Scenario` only via `parseScenario` (Zod-validated `ScenarioJson` → domain Rats).

Boundary functions in `state/schema.ts`:

- `parseScenario(json: ScenarioJson): Scenario` — Zod validates `json`, then converts every decimal-string field to a `Rat` via `fromDecimalString`; rejects on bounds violation.
- `serializeScenario(s: Scenario): ScenarioJson` — the inverse: every scenario Rat is converted to a decimal string via `toDecimalString`. Serialization is **exact** because every scenario Rat has a `2^a · 5^b` denominator by construction (inputs are decimal strings; scenario fields are never produced by arithmetic — MC's `fromFloat64` values live only in transient results, which are never persisted). `serializeScenario` throws `INTERNAL_INVARIANT` if any Rat fails the denominator check.

**Schema evolution.** Import of a scenario with `schemaVersion > 1` **hard-rejects** with a friendly message ("this file is from a newer version of Counterplay; upgrade to open"); this defines the direction of P9's migration stub (older versions may migrate up; newer versions never downgrade silently).

### 3.8 Numerics specifications

- **Φ (normal CDF):** `Φ(z) = erfc(−z/√2)/2`, erfc via Cody-style double-precision rational approximation. Micro-oracles: `Φ(0) = 0.5`, `Φ(1) = 0.841344746069`, `Φ(2) = 0.977249868052`, `Φ(3) = 0.998650101968`, `Φ(0.5) = 0.691462461274` (abs tol 1e-12); property `Φ(−z) = 1 − Φ(z)` (1e-15); cross-check property: Φ differences match Simpson quadrature of φ on random intervals (abs tol 1e-10).
- **`lnΦ` (log CDF, tail-stable — required by §3.4 float hygiene):** direct `ln(Φ(z))` for `z ≥ −8`; asymptotic branch for `z < −8` per §3.4. Micro-oracles: `lnΦ(−6) = −20.736768949975`, `lnΦ(−10) = −53.231285150512`, `lnΦ(−20) = −203.917155371097`, `lnΦ(−40) = −804.608442014` (abs tol 1e-9 for the first three; 1e-6 at `−40`, accepting the asymptotic expansion's residual).
- **Φ⁻¹ (quantiles):** Wichura AS241 (or Acklam + one Halley refinement step). Oracles: `Φ⁻¹(0.5) = 0`, `Φ⁻¹(0.975) = 1.959963984540`, `Φ⁻¹(0.99) = 2.326347874041` (abs tol 1e-10); property `Φ(Φ⁻¹(p)) = p` on `p ∈ [1e-12, 1 − 1e-12]` (1e-12).
- **Property test domains (contract-pinned):** the Φ-symmetry / Simpson-quadrature property (`Φ(−z) = 1 − Φ(z)` and Simpson cross-check) runs on `z ∈ [−37.5, 37.5]` with intervals restricted to subsets of `[−8, 8]` (outside `[−8, 8]` the direct `Φ(u) − Φ(l)` subtraction loses all significant digits and the property must use `lnΦ`/`log1mexp` instead). The Φ⁻¹ round-trip runs on `p ∈ [1e-12, 1 − 1e-12]`.
- **Truncated moments** for `X ~ N(μ, σ²)`, `z₁ = (l−μ)/σ`, `z₂ = (u−μ)/σ`, `P = Φ(z₂) − Φ(z₁)`:
  `E[X·1] = μP + σ(φ(z₁) − φ(z₂))`; `E[X²·1] = μ²P + 2μσ(φ(z₁) − φ(z₂)) + σ²(P + z₁φ(z₁) − z₂φ(z₂))` (with `zφ(z) → 0` at ±∞).
- **RNG:** splitmix64, seeded by user-visible uint32.
  - **Seed expansion:** `state = uint64(seed)`, zero-extended (the low 32 bits carry `seed`; the high 32 bits are 0).
  - **State update (Vigna's reference, normative):** `state = (state + 0x9E3779B97F4A7C15) mod 2⁶⁴` is applied **before** the mixing step; a builder who mixes the seed before the increment gets a first float of `0.6537157…` — wrong. The pinned outputs below disambiguate, but state the increment-before-mix rule explicitly.
  - **Float rule:** `float64 in [0, 1) = (z >> 11) / 2⁵³` where `z` is the mixed uint64 (top 53 bits).
  - **Contract goldens (seed 42) — pinned here, not generated by the implementation.** These values are computed from the reference splitmix64 algorithm; the implementation must reproduce them, not produce-and-freeze them (§9 addendum). First 8 uint64 outputs: `0xbdd732262feb6e95, 0x28efe333b266f103, 0x47526757130f9f52, 0x581ce1ff0e4ae394, 0x09bc585a244823f2, 0xde4431fa3c80db06, 0x37e9671c45376d5d, 0xccf635ee9e9e2fa4`. First two floats via the pinned rule: `0.7415648787718233, 0.1599103928769201` (all eight floats are derivable from the uint64 goldens by the float rule above).

### 3.9 Perverse-incentive linter

Findings are computed by **counterfactual engine runs**, not ad-hoc heuristics — each finding cites the counterfactual it ran. `Finding = { id, type, severity: info|warn|high, segments: SegmentId[] (may be empty for plan-level findings), plans?: PlanId[] (present on plan-scoped findings, e.g. L-5), evidence (numbers), explainer (template prose from evidence), deepLink }`. Counterfactual runs execute in the scenario's active mode; det-only sub-checks are marked on their rule. Rules that reference a cap operate on the **effective cap** `x̄` (§3.0) — an explicit cap and a trailing zero-rate tier run are the same phenomenon.

- **L-1 Dead zone.** Any _interior_ zero-rate region: a **maximal zero-rate tier run with a positive-rate tier strictly above it** (defined independently of `x̄` — the run is interior iff the plan resumes a positive rate above it, regardless of any later cap). Counterfactual: replace the zone's rates with the **nearest preceding** nonzero rate; if the interior run is a _leading_ zero run (no positive tier below it), use the **nearest following** nonzero rate instead — the counterfactual is always well-defined. Severity high if any segment's counterfactual optimum lands inside the zone (the zone is actively suppressing someone); warn if any segment's actual optimum sits at the zone's lower edge; else info.
- **L-2 Cliff dependence / bunching.** If `L > 0`: re-run with the bonus removed; report segments whose `e*` moves by > 5% relative to the no-bonus counterfactual (`|e*_with − e*_wo| > 0.05·e*_wo`; if `e*_wo = 0`, any positive `e*_with` counts) — they are bonus-driven. In det mode also report segments landing _exactly_ on the threshold (bunching mass). High severity if removal moves attainment across the quota line for ≥ 25% of headcount.
- **L-3 Cap quit point.** Fires on the effective cap `x̄` (§3.0's `min`-form definition — covers explicit caps and trailing zero-rate runs symmetrically). If no nonzero rate exists anywhere in the plan (a pure-base plan), L-3 does not fire; the info-level "plan has no variable component" observation may be emitted instead. Counterfactual: extend the last nonzero marginal rate beyond `x̄` to ∞. **Det mode trigger:** segment's optimum sits _exactly_ at `x̄` and the counterfactual `e*` is strictly higher. **Stoch mode trigger** (replaces "sits at x̄", which is a measure-zero event): `e*_counterfactual − e* > max(1e-9, 0.005·e*)` (0.5% relative threshold, floor 1e-9). Severity is high when the trigger covers at least 25% of plan headcount; otherwise warn. Evidence: revenue left on the table `Σ n_s·a_s·(e*_nocap − e*)`.
- **L-4 Retention risk.** Segments with `CE < Ū`. Evidence: the CE gap, and the base increase that would close it (solve linearly; base enters CE additively). Diagnostic only — segments flagged here still enter every aggregate (see §3.5 participation note); L-4 does not remove headcount from the roster.
- **L-5 Goodhart wedge** (extended by §3.3b). Compares `trueValue` vs `expectedRevenue` across plans; a **ranking flip** is defined pairwise: for any ordered plan pair `(A, B)`, if `expectedRevenue_A > expectedRevenue_B` yet `trueValue_A < trueValue_B` (or the strict reverse), the pair flips. High severity when any pair flips (≥ 2 plans). With a single plan: info-level wedge report when any `γ_s ≠ 1` **or** any segment's §3.3b `distortionIndex > 0` (which requires a second task, so the frozen goldens are untouched); the multitask branch carries the allocation and distortion numbers as evidence. L-5 findings are **plan-scoped** — the finding names the two plans in `plans: [A, B]` and leaves `segments` empty, except on the single-plan branch, which names the wedge segments.
- **L-6 Pay inversion guard.** Assert `W` nondecreasing on the kink lattice (defense-in-depth for future config classes; always-pass in v1).
- **L-7 Boundary gaming** (added by P8): segments with nonzero optimal shift `z*` in the timing module. Evidence: displaced revenue and pay gain. Severity: high if population displaced revenue `Σ n_s·|z*_s|` ≥ 5% of two-period expected revenue `Σ n_s·(q₁ + q₂)_s`, else warn.

- **L-8 Ratchet suppression** (added by V-04, §3.10a): fires only when `settings.horizon` is present. Trigger, evidence, and severity rubric are pinned in §3.10a.
- **L-9 Team free-riding** (added by V-05, §3.14): fires only when `settings.team` is present and its mode is `split`. Trigger, evidence, and severity rubric are pinned in §3.14.

Both new rules are gated on an optional settings block that no frozen fixture sets, so the L-1…L-7 golden corpus is provably unmoved by their arrival (§9's "adding a new golden at its rule's introduction phase is not regeneration" applies to their own fixtures).

Golden fixtures: **five L-1…L-6 goldens (frozen at P6) plus one L-7 golden (frozen at P8) = 5+1 total**, each triggering **exactly** its expected finding set (types, severities, segment lists/plans) — no more, no fewer. One of the five P6 goldens is a clean control plan expected to produce **zero** findings (guards against an over-firing linter). **Design rule for the five P6 goldens:** every segment in every P6 golden sets `movable = 0`, so the timing-module shift window collapses to `{0}` and L-7 (added at P8) is provably silent on all five — the P6 freeze is not mutated when L-7 arrives. **L-7 golden:** O-F2's scenario (§3.12), frozen at P8 as a sixth, separately versioned linter fixture with its expected L-7 finding set. Adding this L-7 golden at its rule's introduction phase is permitted (§9 oracle policy addendum — this is not regeneration).

### 3.10 Timing module (two periods, deterministic, exact)

Per-period demand: `q_p = d_p·a_s·e_p` with seasonality multipliers `(d₁, d₂)` from settings (default `(1, 1)`). Note that identical demand does **not** imply no gaming: with `δ < 1`, pulling forward is strictly profitable on any plan with a positive first-tier rate (slope `(1 − δ)·r₁` per unit shifted), and bonus thresholds can create paired `±z` optima resolved by the tie-break to `smallest |z|` then `z ≤ 0`. A gaming-free symmetric baseline requires `d_1 = d_2`, `δ = 1`, **and** no kink within either period's shift window. Efforts `e₁, e₂` are first solved per period — §3.3 with `a_s` replaced by `d_p·a_s` (myopic baseline; joint effort/shift re-optimization is v1.x — document the limitation in UI copy). Then the agent may shift realized output `z` across the boundary (`z > 0` = pull-forward into period 1), bounded by the **source** period: `z ∈ [−μ_s·q₁, +μ_s·q₂]`, maximizing

```
g(z) = W(q₁ + z) + δ·W(q₂ − z)
```

`g` is piecewise linear in `z`; the exact optimum is on the candidate set {0, the two window ends, every in-window z that lands `q₁+z` or `q₂−z` on a kink (per `kinks()`)}. Tie-break to smallest `|z|`, then to `z ≤ 0`. Report per segment: `z*`, pay gain, displaced revenue `n_s·|z*|`; feed L-7.

Known scope consequence (state in UI copy): with myopic efforts, output lands above the effective cap only when a bonus threshold sits beyond it, so cap-**push** gaming is exercised at unit level (O-F) rather than end-to-end; bonus-cliff and accelerator **pull-forward** is fully end-to-end (O-F2).

#### 3.10a N-period horizon, dynamic quota-setting, and the ratchet (V-04)

**Status.** Normative contract for V-04 generalisation, authored before its engine code (D-007 oracle-first). The §6 ratification row for the v1.x reopening is still an owner action (Owner review list). It is **off by default**: `settings.horizon` is optional on the wire, and when it is absent §3.10's two-period module runs exactly as before and every golden (including LF-6 / O-F2) is unchanged.

```
horizon = { periods N ∈ [2, 12] , seasonality [d_1 … d_N] (each > 0) ,
            ratchet { weight λ ∈ [0, 0.9] , growth g > 0 } ,
            response: 'myopic' | 'ratchetAware' }
```

**Quota rule (the ratchet).** `Q_1 = Q·m_s`, and thereafter

```
Q_{p+1} = (1 − λ)·Q_p + λ·g·q_p          q_p = the period's produced (pre-shift) output
```

`λ = 0` is a constant quota — the §3.10 world. `λ ∈ [0, 0.9]` (§3.0) guarantees `Q_{p+1} ≥ 0.1·Q_p > 0` by construction, so no floor constant is invented and attainment never divides by zero. `g` is the target-growth factor applied to realised output: `g = 1` sets next period's quota toward what the rep just did; `g = 1.1` demands ten percent more of it. This is the Weitzman ratchet, in the units a comp plan actually uses.

**Pinned convention — the ratchet reads _produced_, not _credited_, output.** The boundary shifts of §3.10 change what a period is _paid_ on, not what it is _measured_ to have produced. This is a scope decision, taken to break a genuine circularity: if quota keyed on credited output, then `Q_p` would depend on the shift at boundary `p−1`, which depends on `q_p`, which depends on `e_p`, which depends on `Q_p` — a joint fixed point over `(e, z, Q)` that is a different object from this contract's forward recursion. Stated in UI copy alongside §3.10's existing myopic-effort limitation.

**Effort stage.** In period `p` the rep solves the exact §3.3 problem against `(plan, Q_p, d_p)` plus one linear term:

```
max_{q ≥ 0}   W(q ; Q_p)  +  s_p·q  −  k_s·q² / (2S)          (S per §3.3b; S = a_s² with no second task)
s_p = δ · λ · g · Λ_{p+1}                                      ratchet shadow rate, s_N = 0
Λ_{p+1} = ∂W/∂Q evaluated at period p+1's ratchet-naive baseline
```

`s_p = 0` under `response: 'myopic'` — the rep does not see the ratchet coming, so the module reports its purely mechanical bite (quota creep, attainment drift). Under `'ratchetAware'` the rep prices one step of lookahead: a unit produced today raises tomorrow's quota by `λ·g`, worth `Λ_{p+1}` per unit of quota, discounted by `δ`. `Λ` is computed **exactly** (all rationals) from the tier structure at the baseline output `q`, term by term over the §3.2 commission: a tier contributes `0` if `q ≤ Q·lo_i`, `−r_i·lo_i` if `Q·lo_i < q ≤ Q·hi_i^eff`, and `+r_i·(hi_i^eff − lo_i)` if `q > Q·hi_i^eff`; the draw and pay-floor plateaus contribute `0` while they bind; lumps are jumps and contribute nothing to a derivative. For a single-tier plan `Λ = 0` — a flat commission on revenue genuinely does not care where quota sits, and the module says so rather than inventing an effect. For an accelerator `Λ < 0`, so `s_p < 0`: **the ratchet is a tax on today's output.**

The objective is piecewise concave-quadratic exactly as in §3.3, so the candidate set is finite and the solve is exact: `{0} ∪ { (r_i + s_p)·S/k_s clamped to piece i's q-range } ∪ kinks()`, evaluated exactly, ties to smaller effort. With `s_p = 0` this reproduces `respondDeterministic` value-for-value (property-tested).

**Baseline pinning.** `Λ_{p+1}` reads the **ratchet-naive chain** (`s ≡ 0`) — quotas and outputs from the myopic run. This is normative, not an approximation of convenience: evaluating `Λ` on the ratchet-aware chain would make the shadow rate a fixed point of itself, and a fixed point that need not be unique on a kinked plan.

**Shift stage.** After the quota chain and efforts are fixed, the `N − 1` adjacent boundaries are resolved **left to right**, each by the §3.10 optimizer generalised to two different quotas:

```
max_z  W(q_p + z ; Q_p) + δ·W(q_{p+1} − z ; Q_{p+1})       z ∈ [−μ_s·q_p , +μ_s·q_{p+1}]
```

candidates `{0, both window ends, every in-window z landing `q*p + z`on a kink of period p or`q*{p+1} − z` on a kink of period p+1}`, tie-break to smallest `|z|` then `z ≤ 0` — §3.10's rules verbatim. A shift consumes the source period's credited output, so a later boundary sees the earlier one's result; that sequencing is normative (the simultaneous joint optimum over all `z` is a different object and is not built).

**The rationality dial does not reach this module.** §3.3a promised V-04 would take up the noisy joint choice; the answer, taken deliberately, is that it does not belong here either. A softmax effort choice per period turns the quota chain into a distribution over quota _paths_ whose support grows multiplicatively with `N`; representing that faithfully needs a particle or enumeration engine, which is a different object with its own convergence contract. The horizon module therefore stays exact, and the panel says so on screen whenever the dial is on — the same honesty rule §3.10 already follows.

**Reported per (plan, segment).** Per period: `Q_p, d_p, e_p, q_p (produced), credited_p, W_p, attainment_p`; per boundary: `z*_p`, pay gain; horizon totals: produced revenue, credited revenue, discounted pay `Σ δ^{p−1}·W_p`, displaced revenue `Σ|z*_p|`, terminal quota `Q_N`, and the **ratchet drag** — the counterfactual `λ = 0` run's produced revenue minus this run's, i.e. the revenue the ratchet costs the firm.

**L-8 Ratchet suppression (new §3.9 rule).** Fires only when `settings.horizon` is present (so LF-1…LF-6 are provably silent). Trigger: the ratchet-aware chain produces materially less than the ratchet-naive chain — `withheld = Σ_s n_s·(revenue_naive − revenue_aware) > 0`. Severity **high** when `withheld ≥ 5%` of naive horizon revenue, else **warn**. Evidence: withheld revenue, terminal quota, first-to-last attainment drift, and the shadow rate `s_1`. Explainer (§4.8): _"Quota resets on what reps produce ({{lambda_pct}} weight, {{growth}}× growth). A rep who prices that in withholds {{withheld_currency}} of revenue across {{periods}} periods — the plan pays for output today by taxing it tomorrow."_

**Goldens (hand-derived — §9; law).** Segment `a = 100, k = 100, ρ = 0, Ū = 0, m = 1, movable = 0`; plan `B = 0, Q = 10`, tiers `[{0, 0.05}, {1, 0.2}]`, no bonus/cap; `δ = 1`, every `d_p = 1`.

| Golden | Setup                                   | Expected (exact)                                                                                                                                                                                                            |
| ------ | --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **H1** | `N = 3, λ = 0`, myopic                  | every period identical: `Q_p = 10`, `e_p = 0.2`, `q_p = 20`, `z* = 0`; matches three independent §3.3 responses                                                                                                             |
| **H2** | `N = 3, λ = 0.5, g = 1`, myopic         | **ratchet cycling**: `Q = (10, 15, 10)`, `e = (0.2, 0.05, 0.2)`, `q = (20, 5, 20)`; produced `45` vs `60` unratcheted — the quota reset knocks the rep out of the accelerator, then relents                                 |
| **H3** | `N = 2, λ = 0.1, g = 1`, `ratchetAware` | `Λ_2 = r₁ − r₂ = −0.15` (period-2 naive output `20` sits in tier 2 at `Q_2 = 11`), `s_1 = −0.015`, `e_1 = 0.185 < 0.2`, `q_1 = 18.5`, `Q_2 = 10.85`, `e_2 = 0.2`; withheld `1.5` = `3.75%` of the naive `40` ⇒ **L-8 warn** |
| **H4** | any `N`, single-tier plan               | `Λ ≡ 0` ⇒ `s_p ≡ 0` ⇒ the aware and naive chains coincide; the quota still ratchets and attainment still drifts                                                                                                             |

H2's period 2, hand-checked: at `Q_2 = 15` the candidates are `{0, 0.05, 0.15, 0.2}` with `f = (0, 0.125, −0.375, −0.25)`, so `e_2 = 0.05`. H3's period 1, hand-checked: with `s_1 = −0.015` the tier FOCs move to `e = r_i − 0.015`, giving `f(0.035) = 0.06125`, `f(0.185) = 0.21125`, `f(0.1) = −0.15` — so `e_1 = 0.185`. Structural goldens: `s_p ≡ 0 ⇒ the horizon efforts equal `respondDeterministic`'s`; `λ = 0 ⇒ Q_p ≡ Q_1`; `N = 2, λ = 0, movable > 0 ⇒ z*_1` equals §3.10's `optimizeShift`.

### 3.11 Monte Carlo over assumption uncertainty (float path)

Uncertainty ranges (uniform multipliers `[lo, hi]`, default off; shape per §3.1) attach to per-segment `a, k, σ, γ` and one global demand multiplier on all `a`. Seeded splitmix64 stream; **N** draws (default 500, max 5000). MC executes in the scenario's active mode. Mode seam: range endpoints are decimal strings (exact); joint-sampling draws are float64 and enter det-mode runs via `Rat.fromFloat64` (exact dyadic conversion, §3.7), so the det engine itself stays exact — only sampling and aggregation are float. Tornado endpoints use the exact decimal-string lo/hi directly.

**Draw protocol (normative — O-G bit-replay depends on this order).** For each draw `t = 0, 1, …, N − 1`, the RNG is consumed in strict canonical order and applied as a multiplier `lo + u·(hi − lo)` where `u = float(next())`:

1. `demand` (if `ranges.demand` present) — consumes one float; multiplies every segment's `a` for this draw.
2. Then, segments in **scenario order** (the order they appear in `population`), and within each segment its parameters in the fixed order `a, k, sigma, gamma`. A parameter with no range consumes nothing.

Exactly one multiplier per (segment, param, draw). **Common random numbers across plans:** the same draw vector is applied to every plan in the scenario (required for A/B/C comparability — `plan.a` and `plan.b` under draw `t` see the same perturbed population).

**Tornado bar order** = the same canonical order (demand first, then per-segment `a, k, sigma, gamma`), so tornado output ordering is a pure function of the scenario, not of implementation whim.

- **Tornado:** one-at-a-time — each uncertain parameter at lo/hi with others at base; bars = KPI delta (default KPI: totalComp; selectable: expectedRevenue, compRatio, quotaAttainRate), sorted by |impact| for display but computed in the canonical order above.
- **Bands:** full joint sampling → P10/P50/P90 of each KPI. **Empirical band-quantile convention: weighted lower quantile (inverse CDF, type 1)** — sort draws ascending, take the element at 0-based index `⌈p·N⌉ − 1`. Matches §3.5's det-mode population-quantile convention, so the two surfaces never disagree by choice of quantile rule.
- Every MC result is stamped `{ seed, N, engineVersion }` and **reproduces exactly on the same engine version and platform** from the stamp (O-G; see §4.6 for the honest-stamps rule — the UI never claims cross-platform bit-identity, since JS transcendental ULP variance is not spec-fixed).

**Det-mode range behavior** (documented in UI copy; no silent no-ops):

- `sigma` ranges have **no effect** on det-mode outputs (σ is ignored by §3.3); the σ control is _disabled_ in det mode with a tooltip stating so.
- `gamma` ranges move only `trueValue` (not `expectedRevenue`, `totalComp`, or CE); tornado bars for `gamma` therefore have positive width, but bars for `sigma` in det mode are zero-width — rendered as a zero-width bar, not hidden, so the reader sees "was in the sweep, contributed nothing" rather than "was omitted".

### 3.12 Oracle corpus (fixtures are contract values)

| ID       | Statement                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Tolerance                                          |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| **O-A**  | Linear plan, det: `e* = r·a/k`, `q* = r·a²/k`, payout `= B + r·q*`, CE closed form                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | exact (rationals)                                  |
| **O-B1** | Linear plan, stoch: engine `e*(β) = β·a/k` for all tested `ρ, σ` (emerges from the CARA integral). **Pinned matrix** (under T-02 Option B): `B = 0`, tuples `(a, k, σ, ρ) ∈ { (100, 1, 0.01, 1e-3), (50, 2, 5, 0.02), (1, 1, 1, 1) }` × `β ∈ { 0.05, 0.10, 0.50 }` — nine cases, each expecting `e* = β·a/k`. (Under a hypothetical Option A the `(1,1,1,1)` × `β=0.5` corner would need omission per the tilt rule `(μ* − ρβσ²)/σ ≥ 8`; Option B is ratified, so the matrix is exact.)                                                                                                                                                                                                                                                                                                                                                                                                                                             | abs 1e-12 on e\*                                   |
| **O-B2** | Holmström–Milgrom second-best: total surplus `S(β) = βa²/k − β²a²/(2k) − ρβ²σ²/2` peaks at `β* = a²/(a² + ρkσ²)`. Fixtures: (a,k,σ,ρ) = (1,1,1,1) → β* = 1/2; (2, 1/2, 2, 1/4) → β* = 8/9. Engine-side surplus per grid point is computed from engine outputs as `S = E[q] − E[W] + CE` (base-invariant — B cancels); it must peak at the grid point nearest β\*.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | grid resolution 0.01                               |
| **O-B3** | Optimizer ceiling covers a distant linear optimum (A1 counterexample). Uncapped linear plan `B=0, Q=1, m=1, single tier r=0.10`; segment `a=100, k=1, σ=0.01, ρ=1e-3`. Stoch engine `e* = 10` (= β·a/k with β=r=0.1); ceiling formula (§3.4) yields `e_max ≈ 21.0 ≥ 10`. Safe under either T-02 ruling (tilted tail mass ≈ Φ(−1000)).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | abs 1e-9 on e\*                                    |
| **O-C**  | Bunching, det: a=100, k=100, flat r=0.10, quota-bonus at q̂=16. With L=1: `q* = 16` exactly (jump; gain = 0.6 + L − 0.78 = 0.82 > 0) and payout includes L. With L=0.1: `q* = 10` (stay; gain −0.08 < 0).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | exact                                              |
| **O-D**  | Dead zone/cap, det: a=100, k=100, tiers r=0.10 on x∈[0,1), r=0 beyond, Q_s=8 → `e* = 0.08` exactly (kink), marginalAtOpt = 0, L-3 fires; counterfactual (rate continues) `e* = 0.10`, Δrevenue = 2.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | exact                                              |
| **O-E**  | Comparative statics, property-based: scaling all tier rates by λ > 1 weakly increases `e*` (Topkis); `e*` invariant to base B; det CE weakly increasing in every rate.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | exact                                              |
| **O-F**  | Shift-stage **unit oracle** — `q₁, q₂` and windows are posited directly to the shift optimizer, not produced by the pipeline (myopic efforts cannot generate these states; see §3.10). Timing signs (δ=1, flat r=0.1 unless noted): (pull) bonus L=1 at q̂=16, q₁=14, q₂=10, window 3 → `z* = +2` exactly (reaches the bonus; z=3 pays the same → tie-break picks 2). (push) cap at q=16, q₁=18, q₂=10 → `z* = −2` exactly (recovers rate on 2 units). (neutral) flat, no bonus/cap → `z* = 0`. **(δ-only asymmetry, no seasonality)** flat r=0.1, no bonus/cap, `q₁ = q₂ = 10`, `δ = 0.9`, window `±1` → `g(z) = 0.1·(10+z) + 0.9·0.1·(10−z) = 1.9 + 0.01z`, so `z* = +1` exactly (linear in z with positive slope), pay gain `0.01` — confirming that discounting alone produces boundary gaming even with identical demand periods.                                                                                               | exact                                              |
| **O-F2** | **End-to-end timing (pull), full pipeline:** segment {a=100, k=100, m=1, movable=0.3}, plan {B=0, Q=20, single tier r=0.1, bonus L=0.1 at x_b=0.8 (q̂=16)}, δ=1, seasonality (1, 1.5). Myopic: q₁=10 (bonus jump loses: 0.6+0.1−0.78 < 0, cf. O-C), q₂=22.5. Pull window μ·q₂ = 6.75; g gains +0.1 (both bonuses) exactly on z ∈ [6, 6.5] → tie-break → `z* = +6` exactly, pay gain 0.1, displaced revenue 6·n_s. Provides the **sixth linter golden** (L-7), frozen at P8 as a separately versioned fixture — outside the five-plan L-1…L-6 corpus (see §3.9): severity high (6/32.5 ≥ 5%).                                                                                                                                                                                                                                                                                                                                         | exact                                              |
| **O-G**  | MC replay: identical `{seed, N, ranges}` on the same engine version and platform → deep-equal results (self-consistency, not a golden — the per-run output is what the code produces; §9 addendum). Requires the §3.11 canonical draw protocol (demand → segments-in-order → params in `a, k, sigma, gamma`) and the common-random-numbers rule across plans; RNG values frozen per §3.8.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | bit-identical (same engine version, same platform) |
| **O-H**  | Convergence (**restricted to continuous plans** — no bonus jump within the search interval, since near a jump the noise-smoothed optimizer sits ≈ `σ·√(2·ln(1/σ))` above the threshold and violates the 1e-6 tolerance at the pinned σ). Fixture: Core segment × T1 (`a = 9e5, k = 7e4, r = 0.08`, B = 0, single tier, no cap, no bonus). σ-limb: `σ = 0.9` (= 1e-6·Q_s with Q_s = 9e5), stoch `e*` within `1e-6 rel` of det `e° = r·a/k = 72/70`. ρ-limb: `ρ = 1e-9` — verify `ρ · (W(a·e_max) − W(0)) ≥ 1e-8` over the search range so the CARA branch runs (else the §3.4 auto-switch already elects the risk-neutral formula and the match is trivial); expect risk-neutral branch match within `1e-9`. **Note:** a bonus-plan convergence oracle, if wanted, must be its own row with a one-sided assertion (`e*_stoch ≥ e*_det` and `e*_stoch − e*_det ≤ 8σ·√(ln(1/σ))/a` at the pinned σ), never the blanket 1e-6 tolerance. | as stated                                          |

| **O-I** | **Multitasking (V-03, §3.3b).** The M1–M5 goldens: the effective-segment reduction, the interior/corner allocation, the value ceiling, and `distortionIndex = 4/85` (M2) / `4/29` (M5). Structural: `distortionIndex ∈ [0, 1]` and `q₁ + q₂ = q` on arbitrary inputs; `secondTask` absent ⇒ byte-identical response. | exact (rationals) |
| **O-J** | **Horizon and ratchet (V-04, §3.10a).** The H1–H4 goldens: the quota chain, ratchet cycling (`q = 20, 5, 20`), the exact shadow rate `s₁ = −0.015` and its withheld `1.5`, and `Λ ≡ 0` on single-tier plans. Structural: `s ≡ 0` reproduces `respondDeterministic`; `λ = 0` freezes the quota; `N = 2, λ = 0` reproduces §3.10's `z*`. | exact (rationals) |
| **O-K** | **Team and tournaments (V-05, §3.14).** The T1–T5 goldens plus the `C_{n,w}` quadrature micro-oracles. Structural: every reported equilibrium passes its own best-response check; `s = 0` and `P = 0` reduce to §3.3/§3.4. | exact on the split path; abs 1e-12 on `C_{n,w}` and the T4 effort |

**Theory anchors — implemented vs informing.** Implemented and tested: Holmström–Milgrom CARA-normal linear contracts (O-B), nonlinear-plan timing games à la Oyer 1998 and Larkin 2014 (O-F, O-F2, L-7), cliff/bunching à la Oyer 1998 and Steenburgh 2008 (O-C, L-2), **Holmström–Milgrom 1991 multitasking (O-I, §3.3b, L-5's computed branch)**, **Weitzman/Oyer ratchet effects (O-J, §3.10a, L-8)**, and **Lazear–Rosen 1981 tournaments plus team-credit free-riding (O-K, §3.14, L-9)**. Informing only (cited in docs, not engine surface): the informativeness principle.

### 3.13 Executable scenario fixtures (contract data)

Every fixture below is a complete `ScenarioJson` (§3.7); shared shape defaults are stated once and applied unless the fixture overrides them. Every fixture uses ids per T-13's grammar (`seg-1`, `seg-2`, `seg-3`, `plan-1`, `plan-2`). Every fixture uses `settings.mode = "deterministic"` and `mc = { seed: 1, N: 500, ranges: {} }` unless stated.

**Shared population (three-segment templates T1/T2/T3):**

```
[
  { id: "seg-1", label: "Junior",  count: 6, ability: "600000",  costK: "60000", riskAversion: "1.2e-4", noiseSD: "100000", reservationCE: "62000", quotaMult: "0.6", valueQuality: "1", movable: "0.10" },
  { id: "seg-2", label: "Core",    count: 8, ability: "900000",  costK: "70000", riskAversion: "8e-5",   noiseSD: "140000", reservationCE: "75000", quotaMult: "1",   valueQuality: "1", movable: "0.10" },
  { id: "seg-3", label: "Senior",  count: 4, ability: "1300000", costK: "85000", riskAversion: "5e-5",   noiseSD: "200000", reservationCE: "95000", quotaMult: "1.5", valueQuality: "1", movable: "0.10" }
]
```

**Shared settings (all templates):** `mode: "deterministic"`, `periodLabel: "year"`, `currencyLabel: "$"`, `discount: "1"`, `seasonality: ["1", "1"]`, `mc: { seed: 1, N: 500, ranges: {} }`. `meta: { notes: "" }`.

- **Template T1 "Flat 8%"** — plans: `[{ id: "plan-1", label: "Flat 8%", base: "60000", quota: "900000", tiers: [{ from: "0", rate: "0.08" }], bonus: null, cap: null }]`.
- **Template T2 "Tiered accelerator"** (landing scenario per D-016+ pass ruling #5) — plans: `[{ id: "plan-1", label: "Tiered accelerator", base: "55000", quota: "900000", tiers: [{ from: "0", rate: "0.05" }, { from: "0.6", rate: "0.08" }, { from: "1", rate: "0.11" }, { from: "1.4", rate: "0.13" }], bonus: null, cap: null }]`.
- **Template T3 "Bonus + cap"** — plans: `[{ id: "plan-1", label: "Bonus + cap", base: "65000", quota: "900000", tiers: [{ from: "0", rate: "0.06" }], bonus: { L: "15000", x_b: "1" }, cap: "1.5" }]`.

**Blank scenario** (used by "start blank"; per pass ruling #5): shared settings; `population: [{ id: "seg-1", label: "Segment 1", count: 5, ability: "800000", costK: "70000", riskAversion: "1e-4", noiseSD: "120000", reservationCE: "70000", quotaMult: "1", valueQuality: "1", movable: "0.10" }]`; `plans: [{ id: "plan-1", label: "Plan 1", base: "60000", quota: "900000", tiers: [{ from: "0", rate: "0.08" }], bonus: null, cap: null }]`.

**Linter goldens — five P6 fixtures (L-1…L-6) + one P8 fixture (L-7), per §3.9's 5+1 rule.** Every P6 fixture sets `movable = "0"` on every segment (T-22 design rule — collapses the L-7 shift window to `{0}`), and shared settings apply unless noted. Every expected finding set below is exact — no more, no fewer. Expected numerical evidence values are hand-derived by the P6/P8 builder at freeze time (per T-22) and pinned into the golden file; the _scenario_ here is the contract fixture the builder starts from.

- **LF-1 "Interior dead zone" → expected `[L-1 warn, seg-1, seg-2]`.** Population: `[{ id: "seg-1", label: "Junior", count: 6, ability: "600000", costK: "60000", riskAversion: "0", noiseSD: "0", reservationCE: "0", quotaMult: "0.6", valueQuality: "1", movable: "0" }, { id: "seg-2", label: "Core", count: 8, ability: "900000", costK: "70000", riskAversion: "0", noiseSD: "0", reservationCE: "0", quotaMult: "1", valueQuality: "1", movable: "0" }, { id: "seg-3", label: "Senior", count: 4, ability: "1300000", costK: "85000", riskAversion: "0", noiseSD: "0", reservationCE: "0", quotaMult: "1.5", valueQuality: "1", movable: "0" }]`. Plans: `[{ id: "plan-1", label: "Zone", base: "60000", quota: "900000", tiers: [{ from: "0", rate: "0.08" }, { from: "0.5", rate: "0" }, { from: "0.8", rate: "0.11" }], bonus: null, cap: null }]`. Counterfactual optima are above the `[0.5, 0.8)` zone for every segment, so high does not apply. The actual Junior and Core optima sit at the zone's lower edge; Senior jumps past the zone. L-2/L-3/L-4/L-5/L-6 are silent.
- **LF-2 "Bonus cliff / bunching" → expected `[L-2 high, seg-1, seg-2, seg-3]`.** Same three-segment population as LF-1 (all `movable = "0"`). Plans: `[{ id: "plan-1", label: "Bonus @ 100%", base: "55000", quota: "900000", tiers: [{ from: "0", rate: "0.05" }], bonus: { L: "20000", x_b: "1" }, cap: null }]`. Design intent: with the bonus removed, every segment's `e*` moves by > 5% relative and at least 25% of headcount crosses the quota line (`x = 1`) — L-2 severity high; other rules silent.
- **LF-3 "Binding cap" → expected `[L-3 high, seg-1, seg-2, seg-3]`.** Same three-segment population, all `movable = "0"`. Plans: `[{ id: "plan-1", label: "Capped flat", base: "60000", quota: "900000", tiers: [{ from: "0", rate: "0.10" }], bonus: null, cap: "1" }]`. Every segment sits at its cap kink and has a strictly higher uncapped optimum (Junior: FOC 1.0 > cap effort 0.9; Core: 1.286 > 1.0; Senior: 1.529 > 1.038). All plan headcount is affected, so the §3.9 25% severity rule makes L-3 high; other rules are silent.
- **LF-4 "Goodhart wedge (ranking flip)" → expected `[L-5 high, plans: ["plan-1", "plan-2"]]`.** Population: `[{ id: "seg-1", label: "High-value low-throughput", count: 5, ability: "600000", costK: "60000", riskAversion: "0", noiseSD: "0", reservationCE: "0", quotaMult: "5", valueQuality: "2", movable: "0" }, { id: "seg-2", label: "Low-value high-throughput", count: 10, ability: "1500000", costK: "50000", riskAversion: "0", noiseSD: "0", reservationCE: "0", quotaMult: "0.2", valueQuality: "0.19", movable: "0" }]`. Plans: two — `plan-1` "Broad" `{ base: "60000", quota: "900000", tiers: [{ from: "0", rate: "0.08" }], bonus: null, cap: null }`; `plan-2` "Targeted accelerator" `{ base: "40000", quota: "900000", tiers: [{ from: "0", rate: "0.02" }, { from: "1", rate: "0.12" }], bonus: null, cap: null }`. Hand derivation: Broad yields revenue $38.4M and true value $11.64M; Targeted accelerator keeps seg-1 in its 2% tier and lifts seg-2 into its 12% tier, yielding revenue $54.6M but true value $11.46M. Revenue therefore ranks plan-2 above plan-1 while true value ranks plan-1 above plan-2, firing L-5 high.
- **LF-5 "Clean control" → expected `[]` (zero findings).** Population: `[{ id: "seg-1", label: "Balanced", count: 10, ability: "1000000", costK: "80000", riskAversion: "0", noiseSD: "0", reservationCE: "20000", quotaMult: "1", valueQuality: "1", movable: "0" }]`. Plans: `[{ id: "plan-1", label: "Simple", base: "60000", quota: "900000", tiers: [{ from: "0", rate: "0.08" }], bonus: null, cap: null }]`. Design intent: single-tier flat plan with `γ = 1`, no bonus/cap, no dead zone, `CE(e*) ≥ Ū` — no rule fires. Guards the linter against over-firing.
- **LF-6 (L-7 golden, P8-frozen)**: O-F2's scenario verbatim (§3.12) with expected `[L-7 high, seg-1, evidence: { z_star: "+6", pay_gain: "0.1", displaced_revenue: 6 · n_s }]`; `movable = "0.30"` on seg-1 (must be nonzero to exercise L-7 — this fixture is deliberately outside the P6 5-golden corpus so the `movable = 0` design rule does not apply).

Every fixture above passes through `parseScenario` unchanged (§3.7 round-trip) and produces its expected finding set exactly (per §3.9's "no more, no fewer").

### 3.14 Team credit and rank-order tournaments (V-05)

**Status.** Normative contract for V-05 equilibrium engine, authored before its engine code (D-007 oracle-first). The §6 ratification row for the v1.x reopening is still an owner action (Owner review list). B-003 kept v1 to independent best response because strategic interaction _between_ agents is a different engine class; this is that class. It is **off by default**: `settings.team` is optional on the wire, and when absent nothing anywhere changes.

```
team = { mode: 'split' | 'tournament' , size n ∈ [2, 50] ,
         split?:      { creditShare s ∈ [0, 1] } ,
         tournament?: { prize P ≥ 0 , winners w ∈ [1, n−1] } }
```

`n` is the **team or tournament group size within a segment** — the segment's headcount `n_s` may hold many such groups. The block is population-wide and reads on the Model surface, because it describes how reps are _organised_, not what the plan pays.

**Reported beside, never substituted into, the §3.5 KPIs (pinned scope).** The equilibrium response class answers a different question from the independent best response, and the two must never be silently mixed: `simulate()`, its identity attestations, and every existing KPI keep reading §3.3/§3.4 responses, and the team module reports the equilibrium alongside them with its own aggregates. Promoting equilibrium to the primary KPI path is a scope change and an owner ruling, not a default.

#### Split credit — exact symmetric equilibrium

A fraction `s` of everything the team books is pooled and split evenly; the rest stays individual. Rep `i`'s **credited** revenue is

```
q_i^cred = (1 − s)·q_i + (s/n)·Σ_j q_j = φ·q_i + c·Σ_{j≠i} q_j       φ = 1 − s·(n−1)/n ,  c = s/n
```

`φ` is the **own-output credit weight** — the only thing the rep's margin sees, and the whole 1/n free-riding problem in one number (`s = 0 ⇒ φ = 1`; `s = 1, n = 4 ⇒ φ = 1/4`). Rep `i` maximises `W(q_i^cred) − k_s e_i²/2` taking the others as given.

At a **symmetric** profile the two shares recombine — `φ + c·(n−1) = 1` — so credited revenue equals own output: **the ratchet of team credit is entirely marginal.** A rep at the symmetric effort is paid exactly what they produced; what changes is that only `φ` of an extra unit comes back. That collapses the equilibrium condition to a finite, exact candidate set:

```
E = { 0 } ∪ { r_i·φ·S/k_s clamped to piece i's own-output range } ∪ { q̂ / a_s : q̂ ∈ kinks() }
```

(`S` per §3.3b; `S = a_s²` with no second task — so this is §3.3's candidate set with the tier FOCs scaled by `φ` and the kink candidates untouched, which is exactly why the kinks stay rational.) A candidate `e ∈ E` **is** an equilibrium iff `x = e` maximises `W(a_sφx + a_s(1−φ)e) − k_s x²/2` over `x ≥ 0` — checked exactly against the same candidate machinery, evaluated at rational arithmetic throughout.

**Multiplicity is real, not an artifact.** Cliff plans genuinely support several symmetric equilibria (everyone reaches the bonus together, or nobody does). The engine enumerates all of them and reports the count. **Selection rule (pinned):** report the equilibrium with the highest common certainty-equivalent, tie-break to smaller effort — the Pareto-best symmetric play, matching §3.0's smaller-effort convention. The UI states the count whenever it exceeds one, because "there is another equilibrium here" is a design finding in its own right.

Split credit is **deterministic-exact only**. Pooling noise as well as output is a different object (the pooled signal's variance falls with `n`, which is a risk-sharing result, not an incentive one); in stochastic mode the panel reports the deterministic equilibrium and says so.

#### Rank-order tournament (Lazear–Rosen 1981) — float path

`n` reps compete on `q_i = a_s·e_i + ε_i`, `ε ~ N(0, σ_s²)` i.i.d.; the top `w` each win a prize `P` **on top of** plan pay. With everyone else at `e`, a rep at `x` shifts their score by `Δ = a_s(x − e)`, and the marginal win density at the symmetric point is

```
κ(n, w, σ) = C_{n,w} / σ           C_{n,w} = (n−1)·C(n−2, w−1)·∫ φ(u)²·(1−Φ(u))^{w−1}·Φ(u)^{n−1−w} du
```

The `1/σ` scaling is exact (substitute `t = σu`), so the integral is computed **once per `(n, w)`** on the standard normal. **Quadrature (pinned):** composite Simpson, `16384` subintervals on `[−12, 12]`. Closed-form micro-oracles the quadrature must reproduce (abs tol `1e-12`, and `1e-9` for the third):

| Case      | Closed form                                                                                | Value                 |
| --------- | ------------------------------------------------------------------------------------------ | --------------------- |
| `C_{2,1}` | `1/(2√π)`                                                                                  | `0.28209479177387814` |
| `C_{3,1}` | `2·∫φ²Φ = 2/(4√π) = 1/(2√π)` — _equal to `C_{2,1}`_, since `E[Φ(Z)] = 1/2`for`Z ~ N(0, ½)` | `0.28209479177387814` |
| `C_{4,1}` | `3/(2√π)·(1/4 + arcsin(1/3)/(2π))` — the bivariate orthant probability at `ρ = 1/3`        | `≈ 0.2573435`         |

These are contract values derived analytically, never printed from the implementation (§9). `C_{3,1} = C_{2,1}` from two structurally different integrands is the sharpest single check the quadrature has.

Each rep maximises the **risk-neutral** objective `E[W(a_s x + ε)] + P·Π(a_s(x − e)) − k_s x²/2`, with `E[W]` from the §3.4 piece moments and `Π` the win probability. **Risk aversion is ignored in the tournament objective** — a prize lottery under CARA is a different integral and is deliberately not built; the panel states it. **Solution protocol (pinned):** best-response iteration from the no-prize response, each step optimising `x` by the §3.4 grid-plus-golden-section procedure; **undamped for the first 40 steps** (a linear plan settles in one, since `Π''(0) = 0` makes the map locally flat) and **damped `1/2`** thereafter so a kinked plan that would cycle still converges; converged at `|Δe| ≤ 1e-7·max(1, e)`, at most `80` iterations. The `1e-7` is not slack, it is the floor: a derivative-free search on a locally quadratic objective resolves the argmax to about `√eps ≈ 1.5e-8`, because value differences below that are float noise. Pinning a tighter tolerance would only guarantee that `converged` is always false. The result carries `converged`, and a non-converged run is reported as such rather than as a number. The win integral is evaluated as `∫ φ(y − δ)·Ψ(y) dy` on a cached `(n, w)` node grid (Simpson, `4096` subintervals on `[−40, 40]`), so the whole `δ` dependence sits on the Gaussian and a best-response search costs one `exp` per node rather than one `Φ`. **`σ_s = 0` has no tournament equilibrium in pure strategies** (the contest becomes an all-pay auction) — the panel reports "needs positive noise" for that segment instead of inventing one.

**L-9 Team free-riding (new §3.9 rule).** Fires only when `settings.team` is present (so LF-1…LF-6 are provably silent). Trigger, split mode: the equilibrium revenue falls short of the independent best-response revenue by more than 5%. Severity **high** at ≥ 25% short, else **warn**. Evidence: `φ`, `n`, `s`, both efforts, and the revenue gap. Explainer (§4.8): _"Pooling {{credit_share_pct}} of credit across {{team_size}} reps leaves each one keeping {{phi_pct}} of their own marginal output. Equilibrium effort falls {{effort_gap_pct}} short of the individual best response — {{revenue_gap_currency}} of revenue never gets produced."_

**Goldens (hand-derived — §9; law).** Segment `a = 100, k = 100, ρ = 0, Ū = 0, m = 1`; plan `B = 0, Q = 10`, one tier `r = 0.1` unless noted.

| Golden | Setup                                                               | Expected                                                                                                                                                                                                            |
| ------ | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **T1** | split, `s = 0`                                                      | `φ = 1`; equilibrium effort `= 0.1` — the §3.3 response exactly (exact rational)                                                                                                                                    |
| **T2** | split, `n = 4, s = 1`                                               | `φ = 1/4`, equilibrium effort `0.025`, revenue `2.5` against an individual `10` — the 1/n problem, exactly                                                                                                          |
| **T3** | split, `n = 2, s = 1`, plus bonus `L = 1` at `x_b = 1.6` (`q̂ = 16`) | `φ = 1/2`; **two** symmetric equilibria, `e = 0.05` (payoff `0.375`) and `e = 0.16` (payoff `1.32`); selection reports `0.16`, `equilibriaCount = 2`                                                                |
| **T4** | tournament, `n = 2, w = 1, σ = 50, P = 100`                         | `κ = C_{2,1}/50`, `e* = (r·a + P·a·κ)/k = 0.66418958354775628` (abs tol `1e-6`, per the protocol's precision floor); `κ` itself must still match `C_{2,1}/50` to `1e-12`, and `P(win) = 1/2` at the symmetric point |
| **T5** | tournament, `P = 0`                                                 | `e* = r·a/k = 0.1` — the prize is the only thing the tournament adds                                                                                                                                                |
| **T6** | tournament, `n = 2, w = 1, σ = 1, P = 1`                            | **no pure-strategy equilibrium**: `converged = false`                                                                                                                                                               |

T6 is not a numerical failure, it is the model telling the truth. At `a/σ = 100` a single unit of effort decides the contest, so the local first-order condition sits on a knife edge that is beaten by conceding the prize outright — the all-pay-auction limit of Lazear–Rosen. A pure symmetric equilibrium needs `P·a²·max|Π''|/σ² < k` (for `n = 2`, `max|Π''| = max_u |u|φ(u)/2 ≈ 0.121`); T4's parameters satisfy it with room, T6's do not. Because the protocol's inner step is a **global** grid search, `converged = true` _is_ the global best-response check — the engine cannot report a first-order point that is not an equilibrium, and a non-converged run is surfaced as such.

T3 hand-checked: against `e = 0.16` the deviator's credited revenue is `50x + 8`, so `x = 0.16` lands exactly on the bonus (`16`) for `2.6 − 1.28 = 1.32`, beating the tier FOC's `0.925` and zero's `0.8`; against `e = 0.05` credited is `50x + 2.5`, reaching the bonus needs `x = 0.27` for `−1.045`, so the FOC play `0.05` wins at `0.375`. `e = 0` is **not** an equilibrium (`BR(0) = 0.05`), which the enumeration must also show. Structural goldens: `s = 0 ⇒ equilibrium = §3.3 response` exactly; `φ ∈ (0, 1]` always; `P = 0 ⇒ tournament effort = §3.4 response`; and every reported equilibrium passes its own best-response check.

### 3.15 Local plan search and calibration (V-06 / V-07)

**V-06 — optimizer.** The optimizer is a finite, deterministic _neighbourhood search_, never a claim of a global optimum. It only changes one live commission rate at a time, by one of the exact multipliers `{0.9, 0.95, 1.05, 1.1}`. Starting from the selected plan, it evaluates the current plan plus every valid one-step neighbour for at most four improving rounds; a round accepts the lexicographically best strictly better feasible neighbour. A candidate is feasible iff it has no `high` linter finding, no retention-risk segment, and its total comp is at most `1.25` times the baseline plan's total comp. Its score is `trueValue`, then (on an exact tie) lower total comp, then lexicographically lower `(tier index, multiplier)` so results are replayable. The engine returns the explored count, baseline/candidate KPI summary, and the complete rate-change list; it returns `null` when no feasible strict improvement exists. It does not search quota, base, bonuses, caps, or any non-rate primitive: those are qualitatively different plan choices and presenting a narrow hill climb as a universal plan author would be dishonest. The Analyze panel explicitly calls it **local search, not truth**, leaves linter and MC as the primary reading, and makes applying the suggestion an explicit user action.

All V-06 evaluation is through the existing exact deterministic `simulate`/linter path. If the scenario is stochastic, the search uses a derived deterministic scenario with otherwise identical assumptions; this is disclosed in the result because a float local optimiser over the CARA surface would introduce a new unpinned numerical protocol. No new float crossing is introduced.

**V-07 — local historical calibration.** A calibration file is a local CSV whose header is case-insensitive and must contain `segment` plus either `attainment` or both `revenue` and `quota`. Every data row maps `segment` to a unique current segment id or label; blank rows are ignored; a non-finite, negative, unknown, or ambiguous row rejects the _whole_ import. `attainment` is dimensionless; when only `revenue`/`quota` are supplied it is `revenue/quota`. Neither payroll nor personally identifying fields are accepted or persisted.

For each covered segment, `\bar x = n⁻¹ Σx_i` and `s_x = √(n⁻¹Σ(x_i−\bar x)²)` are sample descriptors. Calibration uses the active plan and that segment's current modelled deterministic attainment `x₀`: proposed ability is `a' = a·\bar x/x₀` when `x₀ > 0`; proposed noise is `σ' = Q_s·s_x`. A segment with `x₀ = 0` reports an unavailable ability proposal rather than dividing by zero. These are deliberately **assumption proposals**, not a fit, causal estimate, or payroll calculation. The UI never persists file rows; it shows the aggregate and requires an explicit Apply action to write the proposed `ability`/`noiseSD` decimal strings into the scenario. The parser/calculator lives outside `engine/**`, validates at the file boundary with Zod, and only uses float64 as a client-side descriptive-statistics/render boundary; it cannot change an engine result until its decimal proposal is sent back through the normal Zod + rational ScenarioJson boundary.

**Goldens (hand-derived — §9; law).** For an otherwise flat plan/segment with modelled `x₀ = 1`, CSV observations `0.8, 1.0, 1.2` give `\bar x = 1`, `s_x = √(0.08/3) = 0.16329931618554522`; ability is unchanged and `σ' = 0.16329931618554522·Q_s`. For `x₀ = 0`, the ability proposal is unavailable while the finite spread proposal remains available. Optimizer golden: with `a = 100`, `k = 100`, `γ = 1`, `B = 0`, `Q = 10`, one tier `r = 0.1`, a 10%-higher rate makes `e = 0.11`, `q = 11`, true value `11` versus baseline `10`, total comp `1.21` versus `1`; it is the first selected improving neighbour (tier 0 / `1.1`) under the stated score.

### 3.16 Interaction history, direct manipulation, and locale (V-08 / V-09 / V-10)

**V-08 — curve editing.** The Design payout curve exposes a focusable breakpoint handle for every editable tier lower edge and a focusable rate handle for every tier. A breakpoint is clamped strictly between adjacent lower edges (with a `0.001` attainment gap) and the rate is clamped to `[0, 10]`; pointer drags and keyboard arrows call the same normal store mutation. Breakpoints move in `0.001` attainment increments and rates in `0.005` increments; `Home`/`End` place a handle at its permitted extreme. The existing labelled tier table remains the canonical data-table twin and the drag handles are an addition, never the only editing path. This is a render-boundary interaction; it adds no engine arithmetic.

**V-09 — undo / redo.** Every successful scenario mutation records the previous valid-or-invalid wire snapshot in a bounded 50-entry undo stack and clears redo. Hydration is not a user mutation and begins with empty stacks. Undo moves the current snapshot to redo, restores the most recent prior snapshot through the same validation/persistence path, and preserves the active plan where possible; redo is the exact inverse. View-only state, Monte Carlo output, selection, and locale-independent UI state are not history. Toolbar buttons expose the operation, and `⌘/Ctrl+Z`, `⌘/Ctrl+Shift+Z`, and `Ctrl+Y` work unless focus is inside a native text editor.

**V-10 — locale.** `settings.locale` is an optional wire field (`en-US`, `en-GB`, `de-DE`), absent meaning `en-US` so old scenarios stay byte-identical. Locale selects in-repo core-copy dictionary entries and all new/updated money, percent, number, and record-prepared-date formatting uses `Intl.NumberFormat`/`Intl.DateTimeFormat`; no runtime dependency or locale API is added. `currencyLabel` stays an abstract display prefix rather than being silently reinterpreted as ISO currency. Machine-readable numbers, decimal form controls, exports, share payloads, and the math engine never change locale grammar.
