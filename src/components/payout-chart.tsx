"use client";

import { useMemo, useState, type KeyboardEvent, type PointerEvent } from "react";
import type { Plan, Scenario, Segment } from "@/engine/types";
import { kinks, marginalRate, payout, segmentQuota } from "@/engine/plan";
import { Rat } from "@/engine/rat";
import { formatCompactCurrency } from "@/i18n";

interface PayoutChartProps {
  scenario: Scenario;
  plan: Plan;
  editable?: {
    tierFrom(index: number, value: string): void;
    tierRate(index: number, value: string): void;
  };
}

interface Point {
  q: number;
  y: number;
  rate: number;
}

function findPreviewSegment(scenario: Scenario): Segment {
  const first = scenario.population[0];
  if (!first) throw new Error("Scenario has no segments.");
  return first;
}

function computePoints(plan: Plan, segment: Segment, xMax: number, quota: number, samples: number): Point[] {
  const step = xMax / samples;
  const kinkSet = kinks(plan, segment).map((rat) => rat.toNumber() / quota);
  const xValues = new Set<number>();
  for (let index = 0; index <= samples; index += 1) xValues.add(index * step);
  for (const kinkAttain of kinkSet) if (kinkAttain <= xMax + 1e-9) xValues.add(kinkAttain);
  const sorted = [...xValues].sort((left, right) => left - right);
  return sorted.map((attain) => {
    const q = attain * quota;
    const output = Rat.fromFloat64(q);
    const y = payout(plan, segment, output).toNumber();
    const rate = marginalRate(plan, segment, output).toNumber();
    return { q, y, rate };
  });
}

function rounded(value: number, places = 3): string {
  return Number(value.toFixed(places)).toString();
}

export function PayoutChart({ scenario, plan, editable }: PayoutChartProps): React.JSX.Element {
  const [showTable, setShowTable] = useState(false);
  const segment = findPreviewSegment(scenario);
  const analysis = useMemo(() => {
    const quota = segmentQuota(plan, segment).toNumber();
    if (quota <= 0) return null;
    const capAttain = plan.cap ? plan.cap.toNumber() : 0;
    const bonusAttain = plan.bonus ? plan.bonus.x_b.toNumber() : 0;
    const xMax = Math.max(1.6, capAttain + 0.1, bonusAttain + 0.1);
    const points = computePoints(plan, segment, xMax, quota, 220);
    const maxY = points.reduce((peak, point) => Math.max(peak, point.y), 0);
    const minY = Math.min(0, ...points.map((point) => point.y));
    const maxRate = points.reduce((peak, point) => Math.max(peak, point.rate), 0);
    const bonusPoint = plan.bonus ? points.find((point) => Math.abs(point.q - plan.bonus!.x_b.toNumber() * quota) < 1e-6) ?? null : null;
    const kinkPoints = kinks(plan, segment)
      .map((rat) => rat.toNumber())
      .filter((q) => q >= 0 && q <= xMax * quota + 1e-9)
      .map((q) => ({ q, y: payout(plan, segment, Rat.fromFloat64(q)).toNumber(), rate: marginalRate(plan, segment, Rat.fromFloat64(q)).toNumber() }));
    return { quota, xMax, points, maxY, minY, maxRate, bonusPoint, kinkPoints };
  }, [plan, segment]);

  if (!analysis) return <div className="chart-empty">Add a positive quota to preview the payout curve.</div>;
  const { quota, xMax, points, maxY, minY, maxRate, bonusPoint, kinkPoints } = analysis;
  const currency = scenario.settings.currencyLabel;
  const locale = scenario.settings.locale;

  const width = 640;
  const height = 300;
  const stripHeight = 60;
  const margin = { top: 18, right: 18, bottom: 42, left: 68 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;
  const xToPx = (q: number): number => margin.left + (q / (xMax * quota)) * plotWidth;
  const yPeak = maxY <= minY ? minY + 1 : maxY;
  const yToPx = (y: number): number => margin.top + plotHeight - ((y - minY) / (yPeak - minY)) * plotHeight;
  const stripYToPx = (rate: number): number => plotHeight + margin.top + 18 + (stripHeight - ((rate / Math.max(0.01, maxRate + 0.02)) * stripHeight));
  const rateScaleMax = Math.max(0.01, maxRate + 0.02);
  const linePath = points.map((point, index) => `${index === 0 ? "M" : "L"}${xToPx(point.q).toFixed(2)},${yToPx(point.y).toFixed(2)}`).join(" ");
  const attainmentTicks = [0, 0.5, 1, xMax].filter((value, index, array) => index === 0 || value > (array[index - 1] ?? 0));

  const pointerAttainment = (event: PointerEvent<SVGElement>): number => {
    const svg = event.currentTarget.ownerSVGElement;
    if (!svg) return 0;
    const rect = svg.getBoundingClientRect();
    const px = ((event.clientX - rect.left) / rect.width) * width;
    return ((px - margin.left) / plotWidth) * xMax;
  };
  const pointerRate = (event: PointerEvent<SVGElement>): number => {
    const svg = event.currentTarget.ownerSVGElement;
    if (!svg) return 0;
    const rect = svg.getBoundingClientRect();
    const py = ((event.clientY - rect.top) / rect.width) * width;
    return ((plotHeight + margin.top + 18 + stripHeight - py) / stripHeight) * rateScaleMax;
  };
  const moveBreakpoint = (event: PointerEvent<SVGElement>, index: number): void => {
    if (!editable || event.buttons === 0) return;
    const lower = (plan.tiers[index - 1]?.from.toNumber() ?? 0) + 0.001;
    const upper = (plan.tiers[index + 1]?.from.toNumber() ?? xMax) - 0.001;
    editable.tierFrom(index, rounded(Math.min(upper, Math.max(lower, pointerAttainment(event)))));
  };
  const moveRate = (event: PointerEvent<SVGElement>, index: number): void => {
    if (!editable || event.buttons === 0) return;
    editable.tierRate(index, rounded(Math.min(10, Math.max(0, pointerRate(event)))));
  };
  const breakpointKey = (event: KeyboardEvent<SVGElement>, index: number): void => {
    if (!editable) return;
    const current = plan.tiers[index]?.from.toNumber() ?? 0;
    const lower = (plan.tiers[index - 1]?.from.toNumber() ?? 0) + 0.001;
    const upper = (plan.tiers[index + 1]?.from.toNumber() ?? xMax) - 0.001;
    const delta = event.key === "ArrowLeft" ? -0.001 : event.key === "ArrowRight" ? 0.001 : 0;
    if (event.key !== "Home" && event.key !== "End" && delta === 0) return;
    event.preventDefault();
    editable.tierFrom(index, rounded(event.key === "Home" ? lower : event.key === "End" ? upper : Math.min(upper, Math.max(lower, current + delta))));
  };
  const rateKey = (event: KeyboardEvent<SVGElement>, index: number): void => {
    if (!editable) return;
    const current = plan.tiers[index]?.rate.toNumber() ?? 0;
    const delta = event.key === "ArrowDown" ? -0.005 : event.key === "ArrowUp" ? 0.005 : 0;
    if (event.key !== "Home" && event.key !== "End" && delta === 0) return;
    event.preventDefault();
    editable.tierRate(index, rounded(event.key === "Home" ? 0 : event.key === "End" ? 10 : Math.min(10, Math.max(0, current + delta))));
  };

  return (
    <figure className="chart" aria-label="Payout curve for the active plan">
      <figcaption>
        <span>Payout curve · <strong>{plan.label}</strong> · segment {segment.label} · quota {formatCompactCurrency(quota, currency, locale)}</span>
        <button type="button" className="chart-twin-toggle" onClick={() => setShowTable((value) => !value)}>
          {showTable ? "Hide data table" : "Show data table"}
        </button>
      </figcaption>
      <svg role="group" aria-labelledby="payout-chart-title" viewBox={`0 0 ${width} ${height + stripHeight + 24}`} className="chart-svg">
        <title id="payout-chart-title">Piecewise payout as a function of revenue, with kink markers and a marginal-rate strip.</title>
        <rect x={margin.left} y={margin.top} width={plotWidth} height={plotHeight} className="chart-plot-bg" />
        {attainmentTicks.map((attain) => (
          <g key={`tick-${attain}`}>
            <line x1={xToPx(attain * quota)} x2={xToPx(attain * quota)} y1={margin.top} y2={margin.top + plotHeight} className="chart-gridline" />
            <text x={xToPx(attain * quota)} y={margin.top + plotHeight + 20} className="chart-axis-label" textAnchor="middle">{Math.round(attain * 100)}%</text>
          </g>
        ))}
        <text x={margin.left} y={margin.top + plotHeight + 36} className="chart-axis-title">Attainment</text>
        <text x={margin.left - 12} y={margin.top} className="chart-axis-label" textAnchor="end">{formatCompactCurrency(maxY, currency, locale)}</text>
        <text x={margin.left - 12} y={margin.top + plotHeight} className="chart-axis-label" textAnchor="end">{formatCompactCurrency(minY, currency, locale)}</text>
        <path d={linePath} className="chart-curve" fill="none" />
        {editable ? plan.tiers.slice(1).map((tier, offset) => {
          const index = offset + 1;
          const lower = (plan.tiers[index - 1]?.from.toNumber() ?? 0) + 0.001;
          const upper = (plan.tiers[index + 1]?.from.toNumber() ?? xMax) - 0.001;
          const q = tier.from.toNumber() * quota;
          const pay = payout(plan, segment, Rat.fromFloat64(q)).toNumber();
          return (
            <circle
              key={`edit-break-${index}`} cx={xToPx(q)} cy={yToPx(pay)} r={7} className="chart-edit-handle"
              role="slider" tabIndex={0} aria-label={`Tier ${index + 1} lower edge`} aria-valuemin={lower} aria-valuemax={upper} aria-valuenow={tier.from.toNumber()}
              onPointerDown={(event) => event.currentTarget.setPointerCapture(event.pointerId)}
              onPointerMove={(event) => moveBreakpoint(event, index)} onKeyDown={(event) => breakpointKey(event, index)}
            />
          );
        }) : null}
        {kinkPoints.map((point) => (
          <circle key={`kink-${point.q}`} cx={xToPx(point.q)} cy={yToPx(point.y)} r={4} className="chart-kink" />
        ))}
        {bonusPoint ? <circle cx={xToPx(bonusPoint.q)} cy={yToPx(bonusPoint.y)} r={6} className="chart-bonus" /> : null}
        <text x={margin.left} y={plotHeight + margin.top + 12} className="chart-strip-label">Marginal rate</text>
        {points.map((point, index, array) => {
          const next = array[index + 1];
          if (!next) return null;
          return (
            <line
              key={`rate-${index}`}
              x1={xToPx(point.q)} x2={xToPx(next.q)}
              y1={stripYToPx(point.rate)} y2={stripYToPx(point.rate)}
              className="chart-strip-line"
            />
          );
        })}
        {editable ? plan.tiers.map((tier, index) => {
          const left = tier.from.toNumber() * quota;
          return (
            <circle
              key={`edit-rate-${index}`} cx={xToPx(left)} cy={stripYToPx(tier.rate.toNumber())} r={6} className="chart-rate-handle"
              role="slider" tabIndex={0} aria-label={`Tier ${index + 1} rate`} aria-valuemin={0} aria-valuemax={10} aria-valuenow={tier.rate.toNumber()}
              onPointerDown={(event) => event.currentTarget.setPointerCapture(event.pointerId)}
              onPointerMove={(event) => moveRate(event, index)} onKeyDown={(event) => rateKey(event, index)}
            />
          );
        }) : null}
        <text x={margin.left - 12} y={stripYToPx(maxRate)} className="chart-axis-label" textAnchor="end">{Math.round(maxRate * 100)}%</text>
        <text x={margin.left - 12} y={stripYToPx(0)} className="chart-axis-label" textAnchor="end">0%</text>
      </svg>
      <p className="chart-summary">
        This curve shows what {segment.label} would be paid at each revenue level under {plan.label}. Kink markers sit at every tier edge{plan.bonus ? ", the bonus threshold" : ""}{plan.cap ? ", and the cap" : ""}.
        {editable ? " Drag the outlined curve markers to move tier edges and the strip markers to change rates; use arrow keys when a marker has focus. The tier table remains the precise keyboard-editable data twin." : ""}
      </p>
      {showTable ? (
        <div className="chart-table">
          <table>
            <caption className="visually-hidden">Payout data table twin for the payout curve.</caption>
            <thead>
              <tr><th>Attainment</th><th>Revenue</th><th>Payout</th><th>Marginal rate</th></tr>
            </thead>
            <tbody>
              {kinkPoints.map((point) => (
                <tr key={`row-${point.q}`}>
                  <td>{Math.round((point.q / quota) * 100)}%</td>
                  <td>{formatCompactCurrency(point.q, currency, locale)}</td>
                  <td>{formatCompactCurrency(point.y, currency, locale)}</td>
                  <td>{Math.round(point.rate * 100)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </figure>
  );
}
