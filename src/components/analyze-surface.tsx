"use client";

import { useMemo } from "react";
import { lintScenario, type Finding, type FindingType } from "@/engine/linter";
import type { AppLocale } from "@/engine/types";
import { formatCompactCurrency, localeOf } from "@/i18n";
import { useScenarioStore } from "@/state/store";
import { McPanel } from "./mc-panel";
import { BoundaryPanel } from "./boundary-panel";
import { HorizonPanel } from "./horizon-panel";
import { TeamPanel } from "./team-panel";
import { OptimizerPanel } from "./optimizer-panel";
import { CalibrationPanel } from "./calibration-panel";

const explainerTemplates: Record<
  FindingType,
  (evidence: Record<string, unknown>, currency: string, locale: AppLocale) => string
> = {
  "L-1": (evidence) =>
    `Rates drop to zero between ${evidence.zone_lo_pct} and ${evidence.zone_hi_pct} attainment. In the counterfactual (rate = ${evidence.cf_rate} across the zone), the segments below would land inside the dead zone — signalling suppressed effort.`,
  "L-2": (evidence) =>
    `The bonus at ${evidence.x_b_pct} attainment moves ${evidence.affected_headcount_pct} of headcount by more than 5% effort. Without it, ${evidence.crossers_pct} of headcount fall below quota — the plan depends on the bonus to reach its own line.`,
  "L-3": (evidence, currency, locale) =>
    `The segments below sit at the effective cap (${evidence.x_bar_pct}). Extending the last live rate to infinity would raise their optimal effort; the plan leaves ~${compactCurrency(evidence.revenue_left_currency, currency, locale)} of revenue on the table.`,
  "L-4": (evidence, currency, locale) =>
    `Retention risk: certainty-equivalent trails reservation by ${compactCurrency(evidence.ce_gap_currency, currency, locale)}. A base increase of about ${compactCurrency(evidence.base_delta_currency, currency, locale)} would close the gap.`,
  "L-5": (evidence) => {
    if (evidence.plan_high_revenue === undefined) {
      const gammaSegments = Array.isArray(evidence.gamma_neq_one_segments)
        ? evidence.gamma_neq_one_segments.join(", ")
        : "the flagged segments";
      return `True value diverges from measured revenue: ${gammaSegments} weight revenue by γ ≠ 1, so revenue does not track intent.`;
    }
    return `Goodhart wedge: plan ${evidence.plan_high_revenue} leads on revenue but plan ${evidence.plan_high_value} leads on true value — the measured winner is not the actual winner.`;
  },
  "L-6": (evidence, currency, locale) =>
    `Payout function is not monotone: a higher-revenue outcome pays less than a lower-revenue one at ${compactCurrency(evidence.q_flip_currency, currency, locale)} — the plan is misconfigured.`,
  "L-7": (evidence, currency, locale) =>
    `Boundary gaming: segments would shift ${compactCurrency(evidence.z_star_currency, currency, locale)} of revenue across the period boundary for ${compactCurrency(evidence.pay_gain_currency, currency, locale)} of pay gain. Displaced revenue is ~${evidence.displaced_pct} of two-period demand.`,
  "L-8": (evidence, currency, locale) =>
    `Quota resets on what reps produce (${evidence.lambda_pct} weight, ${evidence.growth}× growth). A rep who prices that in withholds ${compactCurrency(evidence.withheld_currency, currency, locale)} of revenue across ${evidence.periods} periods — the plan pays for output today by taxing it tomorrow.`,
  "L-9": (evidence, currency, locale) =>
    `Pooling ${evidence.credit_share_pct} of credit across ${evidence.team_size} reps leaves each one keeping ${evidence.phi_pct} of their own marginal output. Equilibrium effort falls ${evidence.effort_gap_pct} short of the individual best response — ${compactCurrency(evidence.revenue_gap_currency, currency, locale)} of revenue never gets produced.`,
};

function compactCurrency(value: unknown, currency: string, locale: AppLocale): string {
  return formatCompactCurrency(Number(value), currency, locale);
}

const deepLinkTargets: Record<FindingType, string> = {
  "L-1": "Design",
  "L-2": "Design + Simulate",
  "L-3": "Design + Simulate",
  "L-4": "Simulate",
  "L-5": "Simulate",
  "L-6": "Design",
  "L-7": "Analyze",
  "L-8": "Analyze / Horizon",
  "L-9": "Analyze / Team",
};

function severityBadge(severity: Finding["severity"]): string {
  return severity === "high" ? "High" : severity === "warn" ? "Warn" : "Info";
}

export function AnalyzeSurface(): React.JSX.Element {
  const scenario = useScenarioStore((state) => state.scenario);
  const domain = useScenarioStore((state) => state.domain);
  const domainError = useScenarioStore((state) => state.domainError);
  const applyStressPreset = useScenarioStore((state) => state.applyStressPreset);
  const focusDeepLink = useScenarioStore((state) => state.focusDeepLink);
  const findings = useMemo(() => (domain ? lintScenario(domain) : []), [domain]);

  if (domainError)
    return (
      <section className="surface" id="surface-analyze" aria-labelledby="analyze-heading">
        <p className="eyebrow">Analyze</p>
        <h2 id="analyze-heading">Fix scenario inputs first</h2>
        <p role="alert" className="surface-error">
          {domainError}
        </p>
        <p className="surface-summary">
          Return to Model or Design and clear the flagged inputs. The linter, boundary panel, and
          Monte Carlo all require a valid scenario.
        </p>
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
      <p className="surface-summary">
        Every finding cites the counterfactual it ran against. Zero findings does not prove a plan
        is safe — it does mean the linter has nothing quantitative to raise.
      </p>
      {findings.length === 0 ? (
        <div className="empty-findings">
          <p>
            <strong>No findings.</strong> Try one of the stress presets to probe the plan:
          </p>
          <ul>
            <li>
              <button type="button" onClick={() => applyStressPreset("aggressive-accelerator")}>
                Aggressive accelerator
              </button>{" "}
              — multiply the top-tier rate by 1.5.
            </li>
            <li>
              <button type="button" onClick={() => applyStressPreset("tight-cap")}>
                Tight cap
              </button>{" "}
              — set the cap to 110% attainment.
            </li>
            <li>
              <button type="button" onClick={() => applyStressPreset("high-noise")}>
                High noise
              </button>{" "}
              — double every segment&apos;s noiseSD.
            </li>
          </ul>
        </div>
      ) : (
        <ul className="findings-list" role="list">
          {findings.map((finding) => (
            <li key={finding.id} className={`finding-card severity-${finding.severity}`}>
              <header>
                <span className="finding-badge">{severityBadge(finding.severity)}</span>
                <h3>
                  {finding.type}
                  {finding.planId ? ` · ${finding.planId}` : ""}
                </h3>
                <button
                  type="button"
                  className="finding-deep-link"
                  onClick={() => focusDeepLink(finding.deepLink)}
                >
                  Show me: {deepLinkTargets[finding.type]} / {finding.deepLink.chart}
                </button>
              </header>
              <p>
                {explainerTemplates[finding.type](
                  finding.evidence,
                  scenario.settings.currencyLabel,
                  localeOf(scenario.settings.locale),
                )}
              </p>
              {finding.segments.length > 0 ? (
                <p className="finding-segments">Segments: {finding.segments.join(", ")}</p>
              ) : null}
              {finding.plans && finding.plans.length > 0 ? (
                <p className="finding-segments">Plans: {finding.plans.join(", ")}</p>
              ) : null}
              <details className="finding-evidence">
                <summary>Evidence</summary>
                <pre>{JSON.stringify(finding.evidence, null, 2)}</pre>
              </details>
            </li>
          ))}
        </ul>
      )}
      <OptimizerPanel />
      <CalibrationPanel />
      <BoundaryPanel />
      <HorizonPanel />
      <TeamPanel />
      <McPanel />
    </section>
  );
}
