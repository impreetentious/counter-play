"use client";

import { useMemo, useState } from "react";
import type { DeterministicPlanResult, DeterministicSimulationResult, PlanComparison, StochasticPlanResult, StochasticSimulationResult } from "@/engine/simulate";
import { comparePlans, simulate } from "@/engine/simulate";
import { engineVersion } from "@/engine/version";
import { useScenarioStore } from "@/state/store";
import { IdentityBadge } from "./identity-badge";
import { AttainmentDensity, AttainmentHistogram, PayForPerformanceChart, PayoutDistribution, pfpFromDet, pfpFromStoch } from "./simulate-charts";

function niceCurrency(value: number): string {
  const sign = value < 0 ? "-" : "";
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(1)}k`;
  return `${sign}$${abs.toFixed(0)}`;
}

function nicePercent(value: number | null): string {
  if (value === null) return "—";
  return `${(value * 100).toFixed(1)}%`;
}

function DetKpiCard({ plan, active }: { plan: DeterministicPlanResult; active: boolean }): React.JSX.Element {
  const expectedRevenue = plan.kpis.expectedRevenue.toNumber();
  const totalComp = plan.kpis.totalComp.toNumber();
  const compRatio = plan.kpis.compRatio?.toNumber() ?? null;
  const effectiveRate = plan.kpis.effectiveCommissionRate?.toNumber() ?? null;
  const trueValue = plan.kpis.trueValue.toNumber();
  return (
    <article className={active ? "kpi-card active" : "kpi-card"}>
      <header>
        <p className="eyebrow">Plan</p>
        <h3>{plan.plan.label}</h3>
      </header>
      <dl>
        <div><dt>Expected revenue</dt><dd>{niceCurrency(expectedRevenue)}</dd></div>
        <div><dt>Total comp</dt><dd>{niceCurrency(totalComp)}</dd></div>
        <div><dt>Comp ratio</dt><dd>{nicePercent(compRatio)}</dd></div>
        <div><dt>Quota attain rate</dt><dd>{nicePercent(plan.kpis.quotaAttainRate.toNumber())}</dd></div>
        <div><dt>Effective comm rate</dt><dd>{nicePercent(effectiveRate)}</dd></div>
        <div><dt>True value</dt><dd>{niceCurrency(trueValue)}</dd></div>
      </dl>
      {plan.kpis.retentionRisk.length > 0 ? <p className="retention-flag">Retention risk: {plan.kpis.retentionRisk.join(", ")}</p> : null}
    </article>
  );
}

function StochKpiCard({ plan, active }: { plan: StochasticPlanResult; active: boolean }): React.JSX.Element {
  return (
    <article className={active ? "kpi-card active" : "kpi-card"}>
      <header>
        <p className="eyebrow">Plan</p>
        <h3>{plan.plan.label}</h3>
      </header>
      <dl>
        <div><dt>Expected revenue</dt><dd>{niceCurrency(plan.kpis.expectedRevenue)}</dd></div>
        <div><dt>Expected comp</dt><dd>{niceCurrency(plan.kpis.totalComp)}</dd></div>
        <div><dt>Comp ratio</dt><dd>{nicePercent(plan.kpis.compRatio)}</dd></div>
        <div><dt>Quota attain rate</dt><dd>{nicePercent(plan.kpis.quotaAttainRate)}</dd></div>
        <div><dt>Effective comm rate</dt><dd>{nicePercent(plan.kpis.effectiveCommissionRate)}</dd></div>
        <div><dt>True value</dt><dd>{niceCurrency(plan.kpis.trueValue)}</dd></div>
      </dl>
      {plan.kpis.retentionRisk.length > 0 ? <p className="retention-flag">Retention risk: {plan.kpis.retentionRisk.join(", ")}</p> : null}
    </article>
  );
}

function ResponseTableDet({ result }: { result: DeterministicPlanResult }): React.JSX.Element {
  return (
    <table className="response-table">
      <caption>Per-segment best responses ({result.plan.label})</caption>
      <thead>
        <tr><th>Segment</th><th>Effort e*</th><th>Attainment x*</th><th>Pay</th><th>CE</th><th>Participation</th></tr>
      </thead>
      <tbody>
        {result.responses.map((row) => (
          <tr key={row.segmentId}>
            <td>{row.segmentId}</td>
            <td>{row.response.effort.toNumber().toFixed(3)}</td>
            <td>{nicePercent(row.response.attainment.toNumber())}</td>
            <td>{niceCurrency(row.response.payout.toNumber())}</td>
            <td>{niceCurrency(row.response.ce.toNumber())}</td>
            <td>{row.response.participation ? "Yes" : "No"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ResponseTableStoch({ result }: { result: StochasticPlanResult }): React.JSX.Element {
  return (
    <table className="response-table">
      <caption>Per-segment best responses ({result.plan.label})</caption>
      <thead>
        <tr><th>Segment</th><th>Effort e*</th><th>Mean revenue</th><th>Mean pay</th><th>CE</th><th>Participation</th></tr>
      </thead>
      <tbody>
        {result.responses.map((row) => (
          <tr key={row.segmentId}>
            <td>{row.segmentId}</td>
            <td>{row.response.effort.toFixed(3)}</td>
            <td>{niceCurrency(row.response.output)}</td>
            <td>{niceCurrency(row.response.payout)}</td>
            <td>{niceCurrency(row.response.ce)}</td>
            <td>{row.response.participation ? "Yes" : "No"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function CompareCards({ comparisons }: { comparisons: PlanComparison[] }): React.JSX.Element {
  if (comparisons.length === 0) return <p className="chart-summary">Add a second plan on the Design surface to compare.</p>;
  return (
    <div className="compare-grid">
      {comparisons.map((cmp) => (
        <article key={`${cmp.leftPlanId}-${cmp.rightPlanId}`} className="kpi-card">
          <header>
            <p className="eyebrow">Delta</p>
            <h3>{cmp.leftPlanId} − {cmp.rightPlanId}</h3>
          </header>
          <dl>
            <div><dt>Revenue Δ</dt><dd>{niceCurrency(cmp.expectedRevenueDelta.toNumber())}</dd></div>
            <div><dt>Comp Δ</dt><dd>{niceCurrency(cmp.totalCompDelta.toNumber())}</dd></div>
            <div><dt>True value Δ</dt><dd>{niceCurrency(cmp.trueValueDelta.toNumber())}</dd></div>
            <div><dt>Comp ratio Δ</dt><dd>{nicePercent(cmp.compRatioDelta?.toNumber() ?? null)}</dd></div>
          </dl>
        </article>
      ))}
    </div>
  );
}

export function SimulateSurface(): React.JSX.Element {
  const scenario = useScenarioStore((state) => state.scenario);
  const domain = useScenarioStore((state) => state.domain);
  const domainError = useScenarioStore((state) => state.domainError);
  const setMode = useScenarioStore((state) => state.setMode);
  const activePlanId = useScenarioStore((state) => state.activePlanId);
  const setActivePlanId = useScenarioStore((state) => state.setActivePlanId);
  const [runtimeError, setRuntimeError] = useState<Error | null>(null);

  const runOutcome = useMemo(() => {
    if (!domain) return null;
    try {
      return simulate(domain);
    } catch (error) {
      return error instanceof Error ? error : new Error(String(error));
    }
  }, [domain]);

  if (domainError) return (
    <section className="surface" id="surface-simulate" aria-labelledby="simulate-heading">
      <p className="eyebrow">Simulate</p>
      <h2 id="simulate-heading">Fix scenario inputs first</h2>
      <p role="alert" className="surface-error">{domainError}</p>
    </section>
  );

  if (!runOutcome || runOutcome instanceof Error) {
    return (
      <section className="surface" id="surface-simulate" aria-labelledby="simulate-heading" role="alert">
        <p className="eyebrow">Simulate</p>
        <h2 id="simulate-heading">Engine could not run</h2>
        <p className="surface-error">{runOutcome instanceof Error ? runOutcome.message : "Scenario has not been parsed yet."}</p>
        <button type="button" onClick={() => setRuntimeError(null)}>Retry</button>
      </section>
    );
  }

  const result = runOutcome;
  const activePlan = result.plans.find((plan) => plan.plan.id === activePlanId) ?? result.plans[0];
  if (!activePlan) return <section className="surface"><p>No plans available.</p></section>;

  const comparisons: PlanComparison[] = result.mode === "deterministic" && result.plans.length > 1
    ? result.plans.slice(1).map((plan) => comparePlans(result, result.plans[0]!.plan.id, plan.plan.id))
    : [];

  return (
    <section className="surface" id="surface-simulate" aria-labelledby="simulate-heading">
      <header className="surface-heading">
        <div>
          <p className="eyebrow">Simulate</p>
          <h2 id="simulate-heading">Best-response outcomes</h2>
        </div>
        <div className="surface-heading-actions">
          <div role="group" aria-label="Simulation mode" className="mode-toggle">
            <button type="button" aria-pressed={result.mode === "deterministic"} onClick={() => setMode("deterministic")}>Deterministic</button>
            <button type="button" aria-pressed={result.mode === "stochastic"} onClick={() => setMode("stochastic")}>Stochastic (CARA)</button>
          </div>
        </div>
      </header>
      <IdentityBadge attestations={result.attestations} mode={result.mode} engineVersion={engineVersion} />
      <div className="kpi-grid">
        {result.mode === "deterministic"
          ? result.plans.map((plan) => <DetKpiCard key={plan.plan.id} plan={plan} active={plan.plan.id === activePlan.plan.id} />)
          : result.plans.map((plan) => <StochKpiCard key={plan.plan.id} plan={plan} active={plan.plan.id === activePlan.plan.id} />)}
      </div>
      <nav aria-label="Plans">
        <div role="tablist" aria-label="Plans" className="plan-tabs">
          {result.plans.map((plan) => (
            <button
              key={plan.plan.id}
              type="button"
              role="tab"
              id={`simulate-tab-${plan.plan.id}`}
              aria-selected={plan.plan.id === activePlan.plan.id}
              aria-controls={`simulate-panel-${plan.plan.id}`}
              className={plan.plan.id === activePlan.plan.id ? "plan-tab active" : "plan-tab"}
              onClick={() => setActivePlanId(plan.plan.id)}
            >{plan.plan.label}</button>
          ))}
        </div>
      </nav>
      <div id={`simulate-panel-${activePlan.plan.id}`} role="tabpanel" aria-labelledby={`simulate-tab-${activePlan.plan.id}`} className="plan-panel">
        <PayoutDistribution
          quantiles={result.mode === "deterministic" ? {
            p10: (activePlan as DeterministicPlanResult).kpis.payoutQuantiles.p10.toNumber(),
            p50: (activePlan as DeterministicPlanResult).kpis.payoutQuantiles.p50.toNumber(),
            p90: (activePlan as DeterministicPlanResult).kpis.payoutQuantiles.p90.toNumber(),
          } : (activePlan as StochasticPlanResult).kpis.payoutQuantiles}
          currency={scenario.settings.currencyLabel}
        />
        {result.mode === "deterministic"
          ? <AttainmentHistogram scenario={domain!} result={activePlan as DeterministicPlanResult} />
          : <AttainmentDensity scenario={domain!} result={activePlan as StochasticPlanResult} />}
        <PayForPerformanceChart
          points={result.mode === "deterministic" ? pfpFromDet(domain!, activePlan as DeterministicPlanResult) : pfpFromStoch(domain!, activePlan as StochasticPlanResult)}
        />
        {result.mode === "deterministic"
          ? <ResponseTableDet result={activePlan as DeterministicPlanResult} />
          : <ResponseTableStoch result={activePlan as StochasticPlanResult} />}
      </div>
      {result.mode === "deterministic" ? (
        <div className="compare-block">
          <h3>Compare plans</h3>
          <CompareCards comparisons={comparisons} />
        </div>
      ) : null}
    </section>
  );
}
