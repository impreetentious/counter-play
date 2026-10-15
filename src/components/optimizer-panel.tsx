"use client";

import { useState } from "react";
import { optimizePlan, type OptimizerSuggestion } from "@/engine/optimizer";
import { formatCompactCurrency } from "@/i18n";
import { useScenarioStore } from "@/state/store";

export function OptimizerPanel(): React.JSX.Element {
  const revision = useScenarioStore((state) => state.revision);
  const domain = useScenarioStore((state) => state.domain);
  const activePlanId = useScenarioStore((state) => state.activePlanId);
  const scenario = useScenarioStore((state) => state.scenario);
  const applyOptimizedPlanRates = useScenarioStore((state) => state.applyOptimizedPlanRates);
  const [captured, setCaptured] = useState<{
    result: OptimizerSuggestion;
    revision: number;
    planId: string;
    tierFrom: string[];
  } | null>(null);
  const suggestion =
    captured?.revision === revision && captured.planId === activePlanId ? captured.result : null;
  const [status, setStatus] = useState<string | null>(null);

  const findSuggestion = (): void => {
    if (!domain) return;
    try {
      const next = optimizePlan(domain, activePlanId);
      setCaptured(
        next
          ? {
              result: next,
              revision,
              planId: activePlanId,
              tierFrom: scenario.plans
                .find((plan) => plan.id === activePlanId)!
                .tiers.map((tier) => tier.from),
            }
          : null,
      );
      setStatus(
        next
          ? null
          : "No feasible strict improvement was found in this plan's local rate neighbourhood.",
      );
    } catch (error) {
      setCaptured(null);
      setStatus(
        error instanceof Error ? error.message : "Local search could not evaluate this plan.",
      );
    }
  };

  const applySuggestion = (): void => {
    if (!suggestion) return;
    if (
      !captured ||
      !applyOptimizedPlanRates({
        revision: captured.revision,
        planId: captured.planId,
        tierFrom: captured.tierFrom,
        rates: suggestion.plan.tiers.map((tier) => tier.rate.toDecimalString()),
      })
    ) {
      setStatus("This suggestion is no longer applicable. Run the local search again.");
      setCaptured(null);
      return;
    }
    setStatus(
      "Applied the local suggestion. Re-run the linter and Monte Carlo before making a decision.",
    );
    setCaptured(null);
  };

  const currency = scenario.settings.currencyLabel;
  const locale = scenario.settings.locale;
  return (
    <section className="optimizer-panel" aria-labelledby="optimizer-heading">
      <header className="optimizer-header">
        <div>
          <p className="eyebrow">Local search</p>
          <h3 id="optimizer-heading">Suggest a nearby rate schedule</h3>
        </div>
        <button
          type="button"
          className="button-primary"
          onClick={findSuggestion}
          disabled={!domain}
        >
          Explore local rates
        </button>
      </header>
      <p className="optimizer-description">
        This is local search, not truth. It changes one live commission rate at a time, accepts only
        nearby plans with no high-severity finding or retention risk, and keeps comp within 25% of
        the current plan. It evaluates exact deterministic responses even when the workspace is in
        CARA mode.
      </p>
      {status ? (
        <p className="share-status ok" role="status">
          {status}
        </p>
      ) : null}
      {suggestion ? (
        <div className="optimizer-result">
          <p>
            <strong>Candidate:</strong> {suggestion.rateChanges.length} rate adjustment
            {suggestion.rateChanges.length === 1 ? "" : "s"} after {suggestion.rounds} accepted
            round{suggestion.rounds === 1 ? "" : "s"} ({suggestion.explored} plans explored).
          </p>
          <ul className="optimizer-change-list">
            {suggestion.rateChanges.map((change) => (
              <li key={change.tier}>
                Tier {change.tier + 1}: {change.from.toDecimalString()} →{" "}
                {change.to.toDecimalString()}
              </li>
            ))}
          </ul>
          <dl className="optimizer-kpis">
            <div>
              <dt>True value</dt>
              <dd>
                {formatCompactCurrency(suggestion.baseline.trueValue.toNumber(), currency, locale)}{" "}
                →{" "}
                {formatCompactCurrency(suggestion.candidate.trueValue.toNumber(), currency, locale)}
              </dd>
            </div>
            <div>
              <dt>Total comp</dt>
              <dd>
                {formatCompactCurrency(suggestion.baseline.totalComp.toNumber(), currency, locale)}{" "}
                →{" "}
                {formatCompactCurrency(suggestion.candidate.totalComp.toNumber(), currency, locale)}
              </dd>
            </div>
            <div>
              <dt>Revenue</dt>
              <dd>
                {formatCompactCurrency(
                  suggestion.baseline.expectedRevenue.toNumber(),
                  currency,
                  locale,
                )}{" "}
                →{" "}
                {formatCompactCurrency(
                  suggestion.candidate.expectedRevenue.toNumber(),
                  currency,
                  locale,
                )}
              </dd>
            </div>
          </dl>
          <button type="button" onClick={applySuggestion}>
            Apply this candidate
          </button>
        </div>
      ) : null}
    </section>
  );
}
