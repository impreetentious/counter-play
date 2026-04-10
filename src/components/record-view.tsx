"use client";

import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import Link from "next/link";
import { brandName } from "@/brand";
import { engineVersion } from "@/engine/version";
import { lintScenario, type Finding, type FindingType } from "@/engine/linter";
import {
  simulate,
  type DeterministicPlanResult,
  type StochasticPlanResult,
} from "@/engine/simulate";
import { computeTiming } from "@/engine/timing";
import { loadPersistedScenario } from "@/state/persist";
import { useScenarioStore } from "@/state/store";
import { formatCompactCurrency, formatPercent, formatPreparedDate } from "@/i18n";

const appVersion = "0.14.0";

function fmtCurrency(
  value: number,
  currency: string,
  locale?: "en-US" | "en-GB" | "de-DE" | null,
): string {
  return formatCompactCurrency(value, currency, locale);
}

function fmtPercent(value: number | null, locale?: "en-US" | "en-GB" | "de-DE" | null): ReactNode {
  if (value === null || !Number.isFinite(value)) {
    return (
      <span
        title="No expected revenue in this population — see per-segment table"
        aria-label="No expected revenue in this population — see per-segment table"
      >
        —
      </span>
    );
  }
  return formatPercent(value, locale);
}

const findingLabel: Record<FindingType, string> = {
  "L-1": "Dead zone",
  "L-2": "Cliff dependence",
  "L-3": "Cap quit point",
  "L-4": "Retention risk",
  "L-5": "Goodhart wedge",
  "L-6": "Pay inversion",
  "L-7": "Boundary gaming",
  "L-8": "Ratchet suppression",
  "L-9": "Team free-riding",
};

export function RecordView(): React.JSX.Element {
  const hydrate = useScenarioStore((state) => state.hydrate);
  const hydrated = useScenarioStore((state) => state.hydrated);
  const scenario = useScenarioStore((state) => state.scenario);
  const domain = useScenarioStore((state) => state.domain);
  const domainError = useScenarioStore((state) => state.domainError);
  const mcResult = useScenarioStore((state) => state.mcResult);
  const [now, setNow] = useState<string>("");

  useEffect(() => {
    if (!hydrated) hydrate(loadPersistedScenario());
  }, [hydrate, hydrated]);

  useEffect(() => {
    setNow(new Date().toISOString());
  }, [scenario]);

  const simulation = useMemo(() => {
    if (!domain) return null;
    try {
      return simulate(domain);
    } catch (error) {
      return error instanceof Error ? error : new Error(String(error));
    }
  }, [domain]);

  const findings = useMemo<Finding[]>(() => (domain ? lintScenario(domain) : []), [domain]);
  const timing = useMemo(() => (domain ? computeTiming(domain) : null), [domain]);

  const currency = scenario.settings.currencyLabel;
  const locale = scenario.settings.locale;

  return (
    <main className="record-view">
      <header className="record-header no-print">
        <div>
          <p className="eyebrow">Design record</p>
          <h1>{brandName}</h1>
        </div>
        <div className="record-actions">
          <Link href="/">Back to workspace</Link>
          <button type="button" className="button-primary" onClick={() => window.print()}>
            Print or save PDF
          </button>
        </div>
      </header>

      <section className="record-section record-cover" aria-labelledby="cover-heading">
        <h2 id="cover-heading">Compensation Design Record</h2>
        <dl className="record-meta">
          <div>
            <dt>Mode</dt>
            <dd>{scenario.settings.mode}</dd>
          </div>
          <div>
            <dt>Response class</dt>
            <dd>
              {scenario.settings.rationality?.mode === "softmax"
                ? `bounded (softmax, τ=${scenario.settings.rationality.tau})`
                : "exact best response"}
            </dd>
          </div>
          <div>
            <dt>Multitasking</dt>
            <dd>
              {scenario.population.some((segment) => segment.secondTask)
                ? `two-task allocation on ${scenario.population.filter((segment) => segment.secondTask).length} segment(s)`
                : "single task"}
            </dd>
          </div>
          <div>
            <dt>Horizon</dt>
            <dd>
              {scenario.settings.horizon
                ? `${scenario.settings.horizon.periods} periods, ratchet λ=${scenario.settings.horizon.ratchet.weight}, ${scenario.settings.horizon.response === "ratchetAware" ? "ratchet-aware" : "myopic"} reps`
                : "two-period timing only"}
            </dd>
          </div>
          <div>
            <dt>Team play</dt>
            <dd>
              {scenario.settings.team
                ? scenario.settings.team.mode === "split"
                  ? `split credit, n=${scenario.settings.team.size}, s=${scenario.settings.team.split?.creditShare ?? "0"}`
                  : `tournament, n=${scenario.settings.team.size}, prize ${scenario.settings.team.tournament?.prize ?? "0"}`
                : "individual credit"}
            </dd>
          </div>
          <div>
            <dt>Period</dt>
            <dd>{scenario.settings.periodLabel}</dd>
          </div>
          <div>
            <dt>Currency</dt>
            <dd>{scenario.settings.currencyLabel}</dd>
          </div>
          <div>
            <dt>Engine</dt>
            <dd>v{engineVersion}</dd>
          </div>
          <div>
            <dt>App</dt>
            <dd>v{appVersion}</dd>
          </div>
          <div>
            <dt>Prepared</dt>
            <dd suppressHydrationWarning>{now ? formatPreparedDate(now, locale) : "—"}</dd>
          </div>
        </dl>
      </section>

      {domainError ? (
        <section className="record-section" aria-labelledby="record-error-heading">
          <h3 id="record-error-heading">Scenario is not currently valid</h3>
          <p role="alert" className="surface-error">
            {domainError}
          </p>
          <p>Return to the workspace, fix the flagged inputs, and reload this page.</p>
        </section>
      ) : null}

      <section className="record-section" aria-labelledby="assumptions-heading">
        <h3 id="assumptions-heading">Segment assumptions</h3>
        <table className="record-table">
          <caption>
            {scenario.population.length} segment{scenario.population.length === 1 ? "" : "s"}
          </caption>
          <thead>
            <tr>
              <th>Segment</th>
              <th>Count</th>
              <th>Ability (a)</th>
              <th>Cost k</th>
              <th>Risk ρ</th>
              <th>Noise σ</th>
              <th>Reservation Ū</th>
              <th>Quota × m</th>
              <th>γ</th>
              <th>Movable μ</th>
            </tr>
          </thead>
          <tbody>
            {scenario.population.map((segment) => (
              <tr key={segment.id}>
                <td>
                  <strong>{segment.label}</strong> <span className="muted">({segment.id})</span>
                </td>
                <td>{segment.count}</td>
                <td>{segment.ability}</td>
                <td>{segment.costK}</td>
                <td>{segment.riskAversion}</td>
                <td>{segment.noiseSD}</td>
                <td>{segment.reservationCE}</td>
                <td>{segment.quotaMult}</td>
                <td>{segment.valueQuality}</td>
                <td>{segment.movable}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="record-section" aria-labelledby="plan-heading">
        <h3 id="plan-heading">Plan specification</h3>
        {scenario.plans.map((plan) => (
          <article key={plan.id} className="record-plan">
            <h4>
              {plan.label} <span className="muted">({plan.id})</span>
            </h4>
            <dl className="record-meta">
              <div>
                <dt>Base</dt>
                <dd>{plan.base}</dd>
              </div>
              <div>
                <dt>Quota</dt>
                <dd>{plan.quota}</dd>
              </div>
              <div>
                <dt>Bonus</dt>
                <dd>{plan.bonus ? `${plan.bonus.L} @ x_b=${plan.bonus.x_b}` : "none"}</dd>
              </div>
              <div>
                <dt>Cap</dt>
                <dd>{plan.cap ?? "none"}</dd>
              </div>
              {plan.extras?.drawNonRecoverable != null ? (
                <div>
                  <dt>Non-recoverable draw</dt>
                  <dd>{plan.extras.drawNonRecoverable}</dd>
                </div>
              ) : null}
              {plan.extras?.spiff != null ? (
                <div>
                  <dt>SPIFF</dt>
                  <dd>
                    {plan.extras.spiff.amount} @ x={plan.extras.spiff.threshold}
                  </dd>
                </div>
              ) : null}
              {plan.extras?.clawback != null ? (
                <div>
                  <dt>Clawback</dt>
                  <dd>
                    {plan.extras.clawback.amount} below x={plan.extras.clawback.threshold}
                  </dd>
                </div>
              ) : null}
              {plan.extras?.payFloor != null ? (
                <div>
                  <dt>Pay-floor</dt>
                  <dd>{plan.extras.payFloor}</dd>
                </div>
              ) : null}
              {plan.extras?.drawRecoverable != null ? (
                <div>
                  <dt>Recoverable draw</dt>
                  <dd>{plan.extras.drawRecoverable} (cash-flow report)</dd>
                </div>
              ) : null}
            </dl>
            <table className="record-table">
              <caption>Tier structure</caption>
              <thead>
                <tr>
                  <th>#</th>
                  <th>from (attainment)</th>
                  <th>rate</th>
                </tr>
              </thead>
              <tbody>
                {plan.tiers.map((tier, index) => (
                  <tr key={index}>
                    <td>{index + 1}</td>
                    <td>{tier.from}</td>
                    <td>{tier.rate}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </article>
        ))}
      </section>

      {simulation && !(simulation instanceof Error) ? (
        <>
          <section className="record-section" aria-labelledby="kpi-heading">
            <h3 id="kpi-heading">Simulated KPIs ({simulation.mode})</h3>
            <div className="record-kpi-grid">
              {simulation.mode === "deterministic"
                ? simulation.plans.map((plan) => (
                    <DetKpi key={plan.plan.id} plan={plan} currency={currency} locale={locale} />
                  ))
                : simulation.plans.map((plan) => (
                    <StochKpi key={plan.plan.id} plan={plan} currency={currency} locale={locale} />
                  ))}
            </div>
            <h4>Identity attestations</h4>
            <ul className="attestation-list">
              {simulation.attestations.map((att) => (
                <li key={att.id}>
                  <strong>{att.id}</strong>: {att.pass ? "pass" : "FAIL"} · max error{" "}
                  {att.maxErr.toExponential(2)}
                </li>
              ))}
            </ul>
            <p className="record-stamp">
              Analytic stamp:{" "}
              <code>
                mode={simulation.mode}, engineVersion={engineVersion}
              </code>
            </p>
          </section>

          <section className="record-section" aria-labelledby="findings-heading">
            <h3 id="findings-heading">Linter findings</h3>
            {findings.length === 0 ? (
              <p>No findings. The linter had nothing quantitative to raise on this scenario.</p>
            ) : (
              <ul className="record-findings">
                {findings.map((finding) => (
                  <li key={finding.id} className={`record-finding severity-${finding.severity}`}>
                    <p>
                      <strong>
                        {finding.type} — {findingLabel[finding.type]}
                      </strong>
                      <span className="muted"> · {finding.severity}</span>
                      {finding.planId ? <span className="muted"> · {finding.planId}</span> : null}
                    </p>
                    {finding.segments.length > 0 ? (
                      <p className="muted">Segments: {finding.segments.join(", ")}</p>
                    ) : null}
                    {finding.plans && finding.plans.length > 0 ? (
                      <p className="muted">Plans: {finding.plans.join(", ")}</p>
                    ) : null}
                    <details>
                      <summary>Evidence</summary>
                      <pre>{JSON.stringify(finding.evidence, null, 2)}</pre>
                    </details>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {timing ? (
            <section className="record-section" aria-labelledby="timing-heading">
              <h3 id="timing-heading">Two-period timing summary</h3>
              <p className="muted">
                Discount δ={scenario.settings.discount}, seasonality (d₁, d₂)=(
                {scenario.settings.seasonality[0]}, {scenario.settings.seasonality[1]}).
              </p>
              {timing.plans.map((plan) => (
                <div key={plan.planId} className="record-timing">
                  <p>
                    <strong>{plan.planLabel}</strong> — total displaced revenue{" "}
                    {fmtCurrency(plan.displacedRevenueTotal.toNumber(), currency, locale)},
                    two-period expected{" "}
                    {fmtCurrency(plan.twoPeriodExpectedRevenue.toNumber(), currency, locale)}
                  </p>
                </div>
              ))}
            </section>
          ) : null}

          {mcResult ? (
            <section className="record-section" aria-labelledby="mc-heading">
              <h3 id="mc-heading">Monte Carlo bands</h3>
              <p className="record-stamp">
                Stamp:{" "}
                <code>
                  seed={mcResult.stamp.seed}, N={mcResult.stamp.N}, engineVersion=
                  {mcResult.stamp.engineVersion}, mode={mcResult.stamp.mode}
                </code>
              </p>
              {mcResult.plans.map((plan) => {
                const rows: Array<{
                  label: string;
                  key:
                    | "expectedRevenue"
                    | "totalComp"
                    | "compRatio"
                    | "quotaAttainRate"
                    | "trueValue";
                  kind: "currency" | "percent";
                }> = [
                  { label: "Total comp", key: "totalComp", kind: "currency" },
                  { label: "Expected revenue", key: "expectedRevenue", kind: "currency" },
                  { label: "Comp ratio", key: "compRatio", kind: "percent" },
                  { label: "Quota attain rate", key: "quotaAttainRate", kind: "percent" },
                  { label: "True value", key: "trueValue", kind: "currency" },
                ];
                const cell = (kind: "currency" | "percent", value: number | null) =>
                  kind === "currency"
                    ? value === null
                      ? "—"
                      : fmtCurrency(value, currency, locale)
                    : fmtPercent(value, locale);
                return (
                  <div key={plan.planId} className="record-mc-plan">
                    <h4>{plan.planLabel}</h4>
                    <table className="record-table">
                      <thead>
                        <tr>
                          <th>KPI</th>
                          <th>P10</th>
                          <th>P50</th>
                          <th>P90</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((row) => {
                          const band = plan.quantiles[row.key];
                          if (!band)
                            return (
                              <tr key={row.key}>
                                <td>{row.label}</td>
                                <td colSpan={3}>—</td>
                              </tr>
                            );
                          return (
                            <tr key={row.key}>
                              <td>{row.label}</td>
                              <td>{cell(row.kind, band.p10)}</td>
                              <td>{cell(row.kind, band.p50)}</td>
                              <td>{cell(row.kind, band.p90)}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                );
              })}
            </section>
          ) : (
            <section className="record-section" aria-labelledby="mc-heading">
              <h3 id="mc-heading">Monte Carlo bands</h3>
              <p className="muted">
                No Monte Carlo run has been captured. Open Analyze → Monte Carlo, run the sweep, and
                reload this record to include bands.
              </p>
            </section>
          )}
        </>
      ) : (
        <section className="record-section" aria-labelledby="sim-error-heading">
          <h3 id="sim-error-heading">Simulation unavailable</h3>
          <p>
            {simulation instanceof Error
              ? simulation.message
              : "The scenario has not been parsed yet."}
          </p>
        </section>
      )}

      <section className="record-section" aria-labelledby="notes-heading">
        <h3 id="notes-heading">Decision notes</h3>
        {scenario.meta.notes.trim().length === 0 ? (
          <p className="muted">No decision notes recorded. Add them from the workspace footer.</p>
        ) : (
          <p className="record-notes">{scenario.meta.notes}</p>
        )}
      </section>

      <footer className="record-footer">
        <p className="muted">
          Rendered from the current scenario. Every number above reproduces exactly on the same
          engine version and platform.
        </p>
      </footer>
    </main>
  );
}

function DetKpi({
  plan,
  currency,
  locale,
}: {
  plan: DeterministicPlanResult;
  currency: string;
  locale?: "en-US" | "en-GB" | "de-DE" | null;
}): React.JSX.Element {
  return (
    <article className="kpi-card">
      <header>
        <p className="eyebrow">Plan</p>
        <h4>{plan.plan.label}</h4>
      </header>
      <dl>
        <div>
          <dt>Expected revenue</dt>
          <dd>{fmtCurrency(plan.kpis.expectedRevenue.toNumber(), currency, locale)}</dd>
        </div>
        <div>
          <dt>Total comp</dt>
          <dd>{fmtCurrency(plan.kpis.totalComp.toNumber(), currency, locale)}</dd>
        </div>
        <div>
          <dt>Comp ratio</dt>
          <dd>{fmtPercent(plan.kpis.compRatio?.toNumber() ?? null, locale)}</dd>
        </div>
        <div>
          <dt>Quota attain</dt>
          <dd>{fmtPercent(plan.kpis.quotaAttainRate.toNumber(), locale)}</dd>
        </div>
        <div>
          <dt>Effective comm rate</dt>
          <dd>{fmtPercent(plan.kpis.effectiveCommissionRate?.toNumber() ?? null, locale)}</dd>
        </div>
        <div>
          <dt>True value</dt>
          <dd>{fmtCurrency(plan.kpis.trueValue.toNumber(), currency, locale)}</dd>
        </div>
      </dl>
      {plan.kpis.retentionRisk.length > 0 ? (
        <p className="retention-flag">Retention risk: {plan.kpis.retentionRisk.join(", ")}</p>
      ) : null}
    </article>
  );
}

function StochKpi({
  plan,
  currency,
  locale,
}: {
  plan: StochasticPlanResult;
  currency: string;
  locale?: "en-US" | "en-GB" | "de-DE" | null;
}): React.JSX.Element {
  return (
    <article className="kpi-card">
      <header>
        <p className="eyebrow">Plan</p>
        <h4>{plan.plan.label}</h4>
      </header>
      <dl>
        <div>
          <dt>Expected revenue</dt>
          <dd>{fmtCurrency(plan.kpis.expectedRevenue, currency, locale)}</dd>
        </div>
        <div>
          <dt>Expected comp</dt>
          <dd>{fmtCurrency(plan.kpis.totalComp, currency, locale)}</dd>
        </div>
        <div>
          <dt>Comp ratio</dt>
          <dd>{fmtPercent(plan.kpis.compRatio, locale)}</dd>
        </div>
        <div>
          <dt>Quota attain</dt>
          <dd>{fmtPercent(plan.kpis.quotaAttainRate, locale)}</dd>
        </div>
        <div>
          <dt>Effective comm rate</dt>
          <dd>{fmtPercent(plan.kpis.effectiveCommissionRate, locale)}</dd>
        </div>
        <div>
          <dt>True value</dt>
          <dd>{fmtCurrency(plan.kpis.trueValue, currency, locale)}</dd>
        </div>
      </dl>
      {plan.kpis.retentionRisk.length > 0 ? (
        <p className="retention-flag">Retention risk: {plan.kpis.retentionRisk.join(", ")}</p>
      ) : null}
    </article>
  );
}
