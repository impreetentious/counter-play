"use client";

import { useMemo, useState } from "react";
import type { Plan, Scenario, Segment } from "@/engine/types";
import { kinks, marginalRate, payout, segmentQuota } from "@/engine/plan";
import { Rat } from "@/engine/rat";

interface PayoutChartProps {
  scenario: Scenario;
  plan: Plan;
}

interface Point {
  q: number;
  y: number;
  rate: number;
}

function niceCurrency(value: number): string {
  const sign = value < 0 ? "-" : "";
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(1)}k`;
  return `${sign}$${abs.toFixed(0)}`;
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

export function PayoutChart({ scenario, plan }: PayoutChartProps): React.JSX.Element {
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
  const linePath = points.map((point, index) => `${index === 0 ? "M" : "L"}${xToPx(point.q).toFixed(2)},${yToPx(point.y).toFixed(2)}`).join(" ");
  const attainmentTicks = [0, 0.5, 1, xMax].filter((value, index, array) => index === 0 || value > (array[index - 1] ?? 0));

  return (
    <figure className="chart" aria-label="Payout curve for the active plan">
      <figcaption>
        <span>Payout curve · <strong>{plan.label}</strong> · segment {segment.label} · quota {niceCurrency(quota)}</span>
        <button type="button" className="chart-twin-toggle" onClick={() => setShowTable((value) => !value)}>
          {showTable ? "Hide data table" : "Show data table"}
        </button>
      </figcaption>
      <svg role="img" aria-labelledby="payout-chart-title" viewBox={`0 0 ${width} ${height + stripHeight + 24}`} className="chart-svg">
        <title id="payout-chart-title">Piecewise payout as a function of revenue, with kink markers and a marginal-rate strip.</title>
        <rect x={margin.left} y={margin.top} width={plotWidth} height={plotHeight} className="chart-plot-bg" />
        {attainmentTicks.map((attain) => (
          <g key={`tick-${attain}`}>
            <line x1={xToPx(attain * quota)} x2={xToPx(attain * quota)} y1={margin.top} y2={margin.top + plotHeight} className="chart-gridline" />
            <text x={xToPx(attain * quota)} y={margin.top + plotHeight + 20} className="chart-axis-label" textAnchor="middle">{Math.round(attain * 100)}%</text>
          </g>
        ))}
        <text x={margin.left} y={margin.top + plotHeight + 36} className="chart-axis-title">Attainment</text>
        <text x={margin.left - 12} y={margin.top} className="chart-axis-label" textAnchor="end">{niceCurrency(maxY)}</text>
        <text x={margin.left - 12} y={margin.top + plotHeight} className="chart-axis-label" textAnchor="end">{niceCurrency(minY)}</text>
        <path d={linePath} className="chart-curve" fill="none" />
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
        <text x={margin.left - 12} y={stripYToPx(maxRate)} className="chart-axis-label" textAnchor="end">{Math.round(maxRate * 100)}%</text>
        <text x={margin.left - 12} y={stripYToPx(0)} className="chart-axis-label" textAnchor="end">0%</text>
      </svg>
      <p className="chart-summary">
        This curve shows what {segment.label} would be paid at each revenue level under {plan.label}. Kink markers sit at every tier edge{plan.bonus ? ", the bonus threshold" : ""}{plan.cap ? ", and the cap" : ""}.
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
                  <td>{niceCurrency(point.q)}</td>
                  <td>{niceCurrency(point.y)}</td>
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
