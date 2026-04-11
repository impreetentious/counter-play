"use client";

import { useMemo, useState, useEffect } from "react";
import { computeTiming } from "@/engine/timing";
import { formatCompactCurrency, formatNumber, formatPercent, localeOf } from "@/i18n";
import { useScenarioStore } from "@/state/store";

export function BoundaryPanel(): React.JSX.Element | null {
  const scenario = useScenarioStore((state) => state.scenario);
  const domain = useScenarioStore((state) => state.domain);
  const setDiscount = useScenarioStore((state) => state.setDiscount);
  const setSeasonality = useScenarioStore((state) => state.setSeasonality);
  const highlight = useScenarioStore((state) => state.highlight);

  const currency = scenario.settings.currencyLabel;
  const locale = localeOf(scenario.settings.locale);
  const timing = useMemo(() => (domain ? computeTiming(domain) : null), [domain]);

  const [discountDraft, setDiscountDraft] = useState(scenario.settings.discount);
  const [d1Draft, setD1Draft] = useState(scenario.settings.seasonality[0]);
  const [d2Draft, setD2Draft] = useState(scenario.settings.seasonality[1]);
  useEffect(() => setDiscountDraft(scenario.settings.discount), [scenario.settings.discount]);
  useEffect(() => setD1Draft(scenario.settings.seasonality[0]), [scenario.settings.seasonality[0]]);
  useEffect(() => setD2Draft(scenario.settings.seasonality[1]), [scenario.settings.seasonality[1]]);

  if (!domain || !timing) return null;

  return (
    <section
      className={
        highlight?.chart === "timing-table"
          ? "boundary-panel deep-link-highlight"
          : "boundary-panel"
      }
      aria-labelledby="boundary-heading"
      data-testid={highlight?.chart === "timing-table" ? "deep-link-highlight" : undefined}
    >
      <header className="boundary-header">
        <div>
          <p className="eyebrow">Timing</p>
          <h3 id="boundary-heading">Two-period boundary game</h3>
        </div>
        <p className="boundary-description">
          Efforts are chosen myopically per period (§3.10); shift optimization then moves output
          across the boundary within each segment&apos;s source-period window{" "}
          <code>[−μ·q₁, +μ·q₂]</code>. The discount alone can produce gaming even when the two
          periods have identical demand — pulling forward is worth <code>(1 − δ)·r₁</code> per unit.
          End-to-end gaming above the effective cap is not modelled in v1.
        </p>
        {scenario.settings.rationality?.mode === "softmax" ? (
          <p className="boundary-description">
            The rationality dial does not reach this panel: per-period efforts and the shift optimum
            stay on the exact best response (§3.3a scope boundary), so these numbers read the same
            whether or not bounded rationality is on.
          </p>
        ) : null}
      </header>

      <div className="boundary-controls">
        <label className="mc-numeric">
          <span>Discount δ (0, 1]</span>
          <input
            type="text"
            inputMode="decimal"
            value={discountDraft}
            onChange={(event) => setDiscountDraft(event.target.value)}
            onBlur={() => setDiscount(discountDraft)}
          />
        </label>
        <label className="mc-numeric">
          <span>Seasonality d₁</span>
          <input
            type="text"
            inputMode="decimal"
            value={d1Draft}
            onChange={(event) => setD1Draft(event.target.value)}
            onBlur={() => setSeasonality([d1Draft, d2Draft])}
          />
        </label>
        <label className="mc-numeric">
          <span>Seasonality d₂</span>
          <input
            type="text"
            inputMode="decimal"
            value={d2Draft}
            onChange={(event) => setD2Draft(event.target.value)}
            onBlur={() => setSeasonality([d1Draft, d2Draft])}
          />
        </label>
      </div>

      {timing.plans.map((plan) => (
        <div key={plan.planId} className="boundary-plan">
          <header>
            <h4>{plan.planLabel}</h4>
            <p className="boundary-plan-summary">
              Displaced revenue{" "}
              <strong>
                {formatCompactCurrency(plan.displacedRevenueTotal.toNumber(), currency, locale)}
              </strong>{" "}
              · two-period expected{" "}
              <strong>
                {formatCompactCurrency(plan.twoPeriodExpectedRevenue.toNumber(), currency, locale)}
              </strong>{" "}
              ·{" "}
              <strong>
                {plan.twoPeriodExpectedRevenue.toNumber() === 0
                  ? "—"
                  : formatPercent(
                      plan.displacedRevenueTotal.toNumber() /
                        plan.twoPeriodExpectedRevenue.toNumber(),
                      locale,
                    )}
              </strong>{" "}
              displaced share
            </p>
          </header>
          <table className="boundary-table">
            <caption>Per-segment timing outcomes</caption>
            <thead>
              <tr>
                <th>Segment</th>
                <th>e₁</th>
                <th>e₂</th>
                <th>q₁</th>
                <th>q₂</th>
                <th>Window</th>
                <th>z*</th>
                <th>Pay gain</th>
              </tr>
            </thead>
            <tbody>
              {plan.perSegment.map((seg) => (
                <tr
                  key={seg.segmentId}
                  className={
                    highlight?.chart === "timing-table" &&
                    highlight.highlight.segment === seg.segmentId
                      ? "deep-link-highlight"
                      : undefined
                  }
                >
                  <td>{seg.segmentLabel}</td>
                  <td>{formatNumber(seg.e1.toNumber(), locale)}</td>
                  <td>{formatNumber(seg.e2.toNumber(), locale)}</td>
                  <td>{formatCompactCurrency(seg.q1.toNumber(), currency, locale)}</td>
                  <td>{formatCompactCurrency(seg.q2.toNumber(), currency, locale)}</td>
                  <td>
                    [{formatCompactCurrency(seg.shiftWindow[0].toNumber(), currency, locale)},{" "}
                    {formatCompactCurrency(seg.shiftWindow[1].toNumber(), currency, locale)}]
                  </td>
                  <td
                    className={
                      seg.zStar.toNumber() > 0
                        ? "boundary-shift-pull"
                        : seg.zStar.toNumber() < 0
                          ? "boundary-shift-push"
                          : ""
                    }
                  >
                    {formatCompactCurrency(seg.zStar.toNumber(), currency, locale)}
                  </td>
                  <td>{formatCompactCurrency(seg.payGain.toNumber(), currency, locale)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </section>
  );
}
