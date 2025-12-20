"use client";

import { useMemo } from "react";
import { lintScenario, type Finding, type FindingType } from "@/engine/linter";
import { useScenarioStore } from "@/state/store";
import { McPanel } from "./mc-panel";
import { BoundaryPanel } from "./boundary-panel";

const explainerTemplates: Record<FindingType, (evidence: Record<string, unknown>, plan?: string) => string> = {
  "L-1": (evidence) => `Rates drop to zero between ${evidence.zone_lo_pct} and ${evidence.zone_hi_pct} attainment. In the counterfactual (rate = ${evidence.cf_rate} across the zone), the segments below would land inside the dead zone — signalling suppressed effort.`,
  "L-2": (evidence) => `The bonus at ${evidence.x_b_pct} attainment moves ${evidence.affected_headcount_pct} of headcount by more than 5% effort. Without it, ${evidence.crossers_pct} of headcount fall below quota — the plan depends on the bonus to reach its own line.`,
  "L-3": (evidence) => `The segments below sit at the effective cap (${evidence.x_bar_pct}). Extending the last live rate to infinity would raise their optimal effort; the plan leaves ~$${Number(evidence.revenue_left_currency).toFixed(0)} of revenue on the table.`,
  "L-4": (evidence) => `Retention risk: certainty-equivalent trails reservation by $${Number(evidence.ce_gap_currency).toFixed(0)}. A base increase of about $${Number(evidence.base_delta_currency).toFixed(0)} would close the gap.`,
  "L-5": (evidence, _plan) => `Goodhart wedge: plan ${evidence.plan_high_revenue} leads on revenue but plan ${evidence.plan_high_value} leads on true value — the measured winner is not the actual winner.`,
  "L-6": (evidence) => `Payout function is not monotone: a higher-revenue outcome pays less than a lower-revenue one at $${Number(evidence.q_flip_currency).toFixed(0)} — the plan is misconfigured.`,
  "L-7": (evidence) => `Boundary gaming: segments would shift $${evidence.z_star_currency} of revenue across the period boundary for $${evidence.pay_gain_currency} of pay gain.`,
};

const deepLinkTargets: Record<FindingType, string> = {
  "L-1": "Design",
  "L-2": "Design + Simulate",
  "L-3": "Design + Simulate",
  "L-4": "Simulate",
  "L-5": "Simulate",
  "L-6": "Design",
  "L-7": "Analyze",
};

function severityBadge(severity: Finding["severity"]): string {
  return severity === "high" ? "High" : severity === "warn" ? "Warn" : "Info";
}

export function AnalyzeSurface(): React.JSX.Element {
  const domain = useScenarioStore((state) => state.domain);
  const domainError = useScenarioStore((state) => state.domainError);
  const findings = useMemo(() => (domain ? lintScenario(domain) : []), [domain]);

  if (domainError) return (
    <section className="surface" id="surface-analyze" aria-labelledby="analyze-heading">
      <p className="eyebrow">Analyze</p>
      <h2 id="analyze-heading">Fix scenario inputs first</h2>
      <p role="alert" className="surface-error">{domainError}</p>
    </section>
  );

  return (
    <section className="surface" id="surface-analyze" aria-labelledby="analyze-heading">
      <header className="surface-heading">
        <div>
          <p className="eyebrow">Analyze</p>
          <h2 id="analyze-heading">Perverse-incentive findings</h2>
        </div>
      </header>
      <p className="surface-summary">Every finding cites the counterfactual it ran against. Zero findings does not prove a plan is safe — it does mean the linter has nothing quantitative to raise.</p>
      {findings.length === 0 ? (
        <div className="empty-findings">
          <p><strong>No findings.</strong> Try one of the stress presets to probe the plan:</p>
          <ul>
            <li>Aggressive accelerator — multiply the top-tier rate by 1.5.</li>
            <li>Tight cap — set the cap to 110% attainment.</li>
            <li>High noise — double every segment&apos;s noiseSD.</li>
          </ul>
        </div>
      ) : (
        <ul className="findings-list" role="list">
          {findings.map((finding) => (
            <li key={finding.id} className={`finding-card severity-${finding.severity}`}>
              <header>
                <span className="finding-badge">{severityBadge(finding.severity)}</span>
                <h3>{finding.type}{finding.planId ? ` · ${finding.planId}` : ""}</h3>
                <span className="finding-deep-link">Deep link: {deepLinkTargets[finding.type]}</span>
              </header>
              <p>{explainerTemplates[finding.type](finding.evidence, finding.planId)}</p>
              {finding.segments.length > 0 ? <p className="finding-segments">Segments: {finding.segments.join(", ")}</p> : null}
              {finding.plans && finding.plans.length > 0 ? <p className="finding-segments">Plans: {finding.plans.join(", ")}</p> : null}
              <details className="finding-evidence">
                <summary>Evidence</summary>
                <pre>{JSON.stringify(finding.evidence, null, 2)}</pre>
              </details>
            </li>
          ))}
        </ul>
      )}
      <BoundaryPanel />
      <McPanel />
    </section>
  );
}
