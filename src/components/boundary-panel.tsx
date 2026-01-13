"use client";

import { useMemo, useState, useEffect } from "react";
import { computeTiming } from "@/engine/timing";
import { useScenarioStore } from "@/state/store";

function formatCurrency(value: number, currency: string): string {
  if (!Number.isFinite(value)) return "—";
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  if (abs >= 1e6) return `${sign}${currency}${(abs / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${sign}${currency}${(abs / 1e3).toFixed(1)}K`;
  return `${sign}${currency}${abs.toFixed(2)}`;
}

function formatPercent(fraction: number): string {
  if (!Number.isFinite(fraction)) return "—";
  return `${(fraction * 100).toFixed(1)}%`;
}

export function BoundaryPanel(): React.JSX.Element | null {
  const scenario = useScenarioStore((state) => state.scenario);
  const domain = useScenarioStore((state) => state.domain);
  const setDiscount = useScenarioStore((state) => state.setDiscount);
  const setSeasonality = useScenarioStore((state) => state.setSeasonality);

  const currency = scenario.settings.currencyLabel;
  const timing = useMemo(() => (domain ? computeTiming(domain) : null), [domain]);

  const [discountDraft, setDiscountDraft] = useState(scenario.settings.discount);
  const [d1Draft, setD1Draft] = useState(scenario.settings.seasonality[0]);
  const [d2Draft, setD2Draft] = useState(scenario.settings.seasonality[1]);
  useEffect(() => setDiscountDraft(scenario.settings.discount), [scenario.settings.discount]);
  useEffect(() => setD1Draft(scenario.settings.seasonality[0]), [scenario.settings.seasonality[0]]);
  useEffect(() => setD2Draft(scenario.settings.seasonality[1]), [scenario.settings.seasonality[1]]);

  if (!domain || !timing) return null;

  return (
    <section className="boundary-panel" aria-labelledby="boundary-heading">
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
              <strong>{formatCurrency(plan.displacedRevenueTotal.toNumber(), currency)}</strong> ·
              two-period expected{" "}
              <strong>{formatCurrency(plan.twoPeriodExpectedRevenue.toNumber(), currency)}</strong>{" "}
              ·{" "}
              <strong>
                {plan.twoPeriodExpectedRevenue.toNumber() === 0
                  ? "—"
                  : formatPercent(
                      plan.displacedRevenueTotal.toNumber() /
                        plan.twoPeriodExpectedRevenue.toNumber(),
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
                <tr key={seg.segmentId}>
                  <td>{seg.segmentLabel}</td>
                  <td>{seg.e1.toFixed(3)}</td>
                  <td>{seg.e2.toFixed(3)}</td>
                  <td>{formatCurrency(seg.q1.toNumber(), currency)}</td>
                  <td>{formatCurrency(seg.q2.toNumber(), currency)}</td>
                  <td>
                    [{formatCurrency(seg.shiftWindow[0].toNumber(), currency)},{" "}
                    {formatCurrency(seg.shiftWindow[1].toNumber(), currency)}]
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
                    {formatCurrency(seg.zStar.toNumber(), currency)}
                  </td>
                  <td>{formatCurrency(seg.payGain.toNumber(), currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </section>
  );
}
