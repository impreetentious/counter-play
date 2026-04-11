"use client";

import { useMemo } from "react";
import { computeHorizon } from "@/engine/horizon";
import { formatCompactCurrency, formatNumber, formatPercent, localeOf } from "@/i18n";
import { useScenarioStore } from "@/state/store";

/** §3.10a V-04: the N-period quota chain, the ratchet, and what a rep does about it. */
export function HorizonPanel(): React.JSX.Element {
  const scenario = useScenarioStore((state) => state.scenario);
  const domain = useScenarioStore((state) => state.domain);
  const toggleHorizon = useScenarioStore((state) => state.toggleHorizon);
  const setHorizonPeriods = useScenarioStore((state) => state.setHorizonPeriods);
  const setHorizonSeasonality = useScenarioStore((state) => state.setHorizonSeasonality);
  const setRatchetField = useScenarioStore((state) => state.setRatchetField);
  const setHorizonResponse = useScenarioStore((state) => state.setHorizonResponse);
  const highlight = useScenarioStore((state) => state.highlight);

  const currency = scenario.settings.currencyLabel;
  const locale = localeOf(scenario.settings.locale);
  const wire = scenario.settings.horizon ?? null;
  const horizon = useMemo(() => (domain ? computeHorizon(domain) : null), [domain]);

  return (
    <section
      className={
        highlight?.chart === "horizon-table"
          ? "boundary-panel deep-link-highlight"
          : "boundary-panel"
      }
      aria-labelledby="horizon-heading"
      data-testid={highlight?.chart === "horizon-table" ? "deep-link-highlight" : undefined}
    >
      <header className="boundary-header">
        <div>
          <p className="eyebrow">Horizon</p>
          <h3 id="horizon-heading">Multi-period quota ratchet</h3>
        </div>
        <p className="boundary-description">
          Quota resets on what reps produce: <code>Q₍ₚ₊₁₎ = (1 − λ)·Qₚ + λ·g·qₚ</code>. A myopic rep
          never sees it coming and simply gets a harder number each period; a ratchet-aware rep
          prices one step of lookahead and holds output back. The quota rule reads produced output,
          not credited output, so the boundary shifts below move pay without moving next
          period&rsquo;s target.
        </p>
        {scenario.settings.rationality?.mode === "softmax" ? (
          <p className="boundary-description">
            The rationality dial does not reach this panel: a noisy effort choice per period turns
            the quota chain into a distribution over quota paths, which is a different object and is
            deliberately not modelled here.
          </p>
        ) : null}
        <div className="boundary-controls">
          <button
            type="button"
            className="button-primary"
            aria-pressed={Boolean(wire)}
            onClick={toggleHorizon}
          >
            {wire ? "Turn off the horizon" : "Model an N-period horizon"}
          </button>
        </div>
      </header>

      {wire ? (
        <>
          <div className="boundary-controls">
            <label className="mc-numeric">
              <span>Periods N</span>
              <input
                type="number"
                min={2}
                max={12}
                value={wire.periods}
                onChange={(event) => setHorizonPeriods(Number(event.target.value))}
              />
            </label>
            <label className="mc-numeric">
              <span>Ratchet weight λ</span>
              <input
                inputMode="decimal"
                value={wire.ratchet.weight}
                onChange={(event) => setRatchetField("weight", event.target.value)}
              />
            </label>
            <label className="mc-numeric">
              <span>Target growth g</span>
              <input
                inputMode="decimal"
                value={wire.ratchet.growth}
                onChange={(event) => setRatchetField("growth", event.target.value)}
              />
            </label>
            <div role="group" aria-label="Rep response to the ratchet" className="mode-toggle">
              <button
                type="button"
                aria-pressed={wire.response === "myopic"}
                onClick={() => setHorizonResponse("myopic")}
              >
                Myopic
              </button>
              <button
                type="button"
                aria-pressed={wire.response === "ratchetAware"}
                onClick={() => setHorizonResponse("ratchetAware")}
              >
                Ratchet-aware
              </button>
            </div>
          </div>
          <div className="boundary-controls">
            {wire.seasonality.map((value, index) => (
              <label className="mc-numeric" key={`demand-${index}`}>
                <span>Demand d{index + 1}</span>
                <input
                  inputMode="decimal"
                  value={value}
                  onChange={(event) => setHorizonSeasonality(index, event.target.value)}
                />
              </label>
            ))}
          </div>
        </>
      ) : null}

      {wire && horizon
        ? horizon.plans.map((plan) => (
            <div key={plan.planId} className="boundary-plan">
              <header>
                <h4>{plan.planLabel}</h4>
                <p className="boundary-plan-summary">
                  Produced{" "}
                  <strong>
                    {formatCompactCurrency(plan.producedRevenue.toNumber(), currency, locale)}
                  </strong>{" "}
                  · ratchet drag{" "}
                  <strong>
                    {formatCompactCurrency(plan.ratchetDrag.toNumber(), currency, locale)}
                  </strong>{" "}
                  · withheld{" "}
                  <strong>
                    {formatCompactCurrency(plan.withheldRevenue.toNumber(), currency, locale)}
                  </strong>
                </p>
              </header>
              {plan.perSegment.map((entry) => (
                <table
                  className={
                    highlight?.chart === "horizon-table" &&
                    highlight.highlight.segment === entry.segmentId
                      ? "boundary-table deep-link-highlight"
                      : "boundary-table"
                  }
                  key={entry.segmentId}
                >
                  <caption>{entry.segmentLabel} — quota path and output</caption>
                  <thead>
                    <tr>
                      <th>Period</th>
                      <th>Demand</th>
                      <th>Quota</th>
                      <th>Shadow rate</th>
                      <th>Effort</th>
                      <th>Produced</th>
                      <th>Credited</th>
                      <th>Attainment</th>
                      <th>Pay</th>
                    </tr>
                  </thead>
                  <tbody>
                    {entry.periods.map((period) => (
                      <tr key={period.period}>
                        <td>{formatNumber(period.period, locale, 0)}</td>
                        <td>{formatNumber(period.demand.toNumber(), locale, 2)}</td>
                        <td>{formatCompactCurrency(period.quota.toNumber(), currency, locale)}</td>
                        <td>{formatNumber(period.shadowRate.toNumber(), locale, 4)}</td>
                        <td>{formatNumber(period.effort.toNumber(), locale)}</td>
                        <td>
                          {formatCompactCurrency(period.produced.toNumber(), currency, locale)}
                        </td>
                        <td>
                          {formatCompactCurrency(period.credited.toNumber(), currency, locale)}
                        </td>
                        <td>{formatPercent(period.attainment.toNumber(), locale)}</td>
                        <td>{formatCompactCurrency(period.payout.toNumber(), currency, locale)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ))}
            </div>
          ))
        : null}
    </section>
  );
}
