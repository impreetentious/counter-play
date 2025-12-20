"use client";

import { useState } from "react";
import { segmentQuota } from "@/engine/plan";
import type { DeterministicPlanResult, StochasticPlanResult } from "@/engine/simulate";
import type { Scenario } from "@/engine/types";

export interface PfPData {
  segmentId: string;
  label: string;
  count: number;
  revenue: number;
  pay: number;
}

export function pfpFromDet(scenario: Scenario, result: DeterministicPlanResult): PfPData[] {
  return result.responses.map((item) => {
    const segment = scenario.population.find((candidate) => candidate.id === item.segmentId);
    return { segmentId: item.segmentId, label: segment?.label ?? item.segmentId, count: item.count, revenue: item.response.output.toNumber(), pay: item.response.payout.toNumber() };
  });
}

export function pfpFromStoch(scenario: Scenario, result: StochasticPlanResult): PfPData[] {
  return result.responses.map((item) => {
    const segment = scenario.population.find((candidate) => candidate.id === item.segmentId);
    return { segmentId: item.segmentId, label: segment?.label ?? item.segmentId, count: item.count, revenue: item.response.output, pay: item.response.payout };
  });
}

function niceCurrency(value: number): string {
  const sign = value < 0 ? "-" : "";
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(1)}k`;
  return `${sign}$${abs.toFixed(0)}`;
}

interface DeterministicChartsProps {
  scenario: Scenario;
  result: DeterministicPlanResult;
}

interface StochasticChartsProps {
  scenario: Scenario;
  result: StochasticPlanResult;
}

export function AttainmentHistogram({ scenario, result }: DeterministicChartsProps): React.JSX.Element {
  const points = result.responses.map((item) => {
    const segment = scenario.population.find((candidate) => candidate.id === item.segmentId);
    return { attain: item.response.attainment.toNumber(), count: item.count, label: segment?.label ?? item.segmentId };
  });
  const width = 640;
  const height = 220;
  const margin = { top: 18, right: 18, bottom: 40, left: 60 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;
  const maxAttain = Math.max(1.6, ...points.map((point) => point.attain + 0.1));
  const maxCount = Math.max(1, ...points.map((point) => point.count));
  const xToPx = (attain: number): number => margin.left + (attain / maxAttain) * plotWidth;
  const yToPx = (count: number): number => margin.top + plotHeight - (count / maxCount) * plotHeight;
  const [showTable, setShowTable] = useState(false);
  return (
    <figure className="chart">
      <figcaption>
        <span>Attainment histogram</span>
        <button type="button" className="chart-twin-toggle" onClick={() => setShowTable((value) => !value)}>
          {showTable ? "Hide data table" : "Show data table"}
        </button>
      </figcaption>
      <svg role="img" viewBox={`0 0 ${width} ${height}`} className="chart-svg" aria-label="Attainment histogram">
        <rect x={margin.left} y={margin.top} width={plotWidth} height={plotHeight} className="chart-plot-bg" />
        {[0.5, 1, 1.5].filter((tick) => tick <= maxAttain).map((tick) => (
          <g key={tick}>
            <line x1={xToPx(tick)} x2={xToPx(tick)} y1={margin.top} y2={margin.top + plotHeight} className="chart-gridline" />
            <text x={xToPx(tick)} y={margin.top + plotHeight + 18} textAnchor="middle" className="chart-axis-label">{Math.round(tick * 100)}%</text>
          </g>
        ))}
        {points.map((point) => (
          <line key={point.label} x1={xToPx(point.attain)} x2={xToPx(point.attain)} y1={yToPx(0)} y2={yToPx(point.count)} className="chart-strip-line" />
        ))}
        <text x={margin.left - 12} y={margin.top} textAnchor="end" className="chart-axis-label">{maxCount}</text>
      </svg>
      <p className="chart-summary">Point-mass stems show every segment&apos;s best-response attainment weighted by rep count.</p>
      {showTable ? (
        <div className="chart-table">
          <table>
            <thead>
              <tr><th>Segment</th><th>Attainment</th><th>Count</th></tr>
            </thead>
            <tbody>
              {points.map((point) => (
                <tr key={point.label}><td>{point.label}</td><td>{Math.round(point.attain * 100)}%</td><td>{point.count}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </figure>
  );
}

export function AttainmentDensity({ scenario, result }: StochasticChartsProps): React.JSX.Element {
  const width = 640;
  const height = 220;
  const margin = { top: 18, right: 18, bottom: 40, left: 60 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;
  const totalCount = result.responses.reduce((sum, item) => sum + item.count, 0);
  const samples = 120;
  const stats = result.responses.map((item) => {
    const segment = scenario.population.find((candidate) => candidate.id === item.segmentId);
    if (!segment) throw new Error("Missing segment.");
    const quota = segmentQuota(result.plan, segment).toNumber();
    return { count: item.count, mean: item.response.output / quota, sigmaAttain: item.response.sigma / quota, quota };
  });
  const maxAttain = Math.max(1.6, ...stats.map((stat) => stat.mean + 3 * stat.sigmaAttain));
  const step = maxAttain / samples;
  const density: number[] = [];
  for (let index = 0; index <= samples; index += 1) {
    const attain = index * step;
    let value = 0;
    for (const stat of stats) {
      if (stat.sigmaAttain === 0) {
        if (Math.abs(attain - stat.mean) < step * 0.75) value += stat.count / totalCount / step;
        continue;
      }
      const z = (attain - stat.mean) / stat.sigmaAttain;
      value += (stat.count / totalCount) * Math.exp(-0.5 * z * z) / (stat.sigmaAttain * Math.sqrt(2 * Math.PI));
    }
    density.push(value);
  }
  const maxDensity = Math.max(0.001, ...density);
  const xToPx = (attain: number): number => margin.left + (attain / maxAttain) * plotWidth;
  const yToPx = (value: number): number => margin.top + plotHeight - (value / maxDensity) * plotHeight;
  const linePath = density.map((value, index) => `${index === 0 ? "M" : "L"}${xToPx(index * step).toFixed(2)},${yToPx(value).toFixed(2)}`).join(" ");
  const [showTable, setShowTable] = useState(false);
  return (
    <figure className="chart">
      <figcaption>
        <span>Attainment density</span>
        <button type="button" className="chart-twin-toggle" onClick={() => setShowTable((value) => !value)}>{showTable ? "Hide data table" : "Show data table"}</button>
      </figcaption>
      <svg role="img" viewBox={`0 0 ${width} ${height}`} className="chart-svg" aria-label="Attainment density">
        <rect x={margin.left} y={margin.top} width={plotWidth} height={plotHeight} className="chart-plot-bg" />
        {[0.5, 1, 1.5].filter((tick) => tick <= maxAttain).map((tick) => (
          <g key={tick}>
            <line x1={xToPx(tick)} x2={xToPx(tick)} y1={margin.top} y2={margin.top + plotHeight} className="chart-gridline" />
            <text x={xToPx(tick)} y={margin.top + plotHeight + 18} textAnchor="middle" className="chart-axis-label">{Math.round(tick * 100)}%</text>
          </g>
        ))}
        <path d={linePath} fill="none" className="chart-curve" />
      </svg>
      <p className="chart-summary">Analytic mixture density across segments — heights are relative probability density.</p>
      {showTable ? (
        <div className="chart-table">
          <table>
            <thead>
              <tr><th>Segment</th><th>Mean attainment</th><th>Sigma (attain)</th><th>Count</th></tr>
            </thead>
            <tbody>
              {stats.map((stat, index) => (
                <tr key={index}><td>{result.responses[index]?.segmentId}</td><td>{Math.round(stat.mean * 100)}%</td><td>{Math.round(stat.sigmaAttain * 100)}%</td><td>{stat.count}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </figure>
  );
}

interface PfPChartProps {
  points: PfPData[];
}

export function PayForPerformanceChart({ points }: PfPChartProps): React.JSX.Element {
  const width = 640;
  const height = 220;
  const margin = { top: 18, right: 18, bottom: 40, left: 70 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;
  const maxRevenue = Math.max(1, ...points.map((point) => point.revenue)) * 1.1;
  const maxPay = Math.max(1, ...points.map((point) => point.pay)) * 1.1;
  const xToPx = (revenue: number): number => margin.left + (revenue / maxRevenue) * plotWidth;
  const yToPx = (pay: number): number => margin.top + plotHeight - (pay / maxPay) * plotHeight;
  const [showTable, setShowTable] = useState(false);
  return (
    <figure className="chart">
      <figcaption>
        <span>Pay-for-performance</span>
        <button type="button" className="chart-twin-toggle" onClick={() => setShowTable((value) => !value)}>{showTable ? "Hide data table" : "Show data table"}</button>
      </figcaption>
      <svg role="img" viewBox={`0 0 ${width} ${height}`} className="chart-svg" aria-label="Pay-for-performance">
        <rect x={margin.left} y={margin.top} width={plotWidth} height={plotHeight} className="chart-plot-bg" />
        <line x1={margin.left} x2={margin.left + plotWidth} y1={margin.top + plotHeight} y2={margin.top + plotHeight} className="chart-gridline" />
        {points.map((point) => (
          <circle key={point.segmentId} cx={xToPx(point.revenue)} cy={yToPx(point.pay)} r={Math.max(4, Math.sqrt(point.count) * 3)} className="chart-kink" />
        ))}
        <text x={margin.left} y={margin.top + plotHeight + 20} className="chart-axis-title">Revenue → Pay</text>
      </svg>
      <p className="chart-summary">Segment optima placed by (expected revenue, expected pay); marker area scales with rep count.</p>
      {showTable ? (
        <div className="chart-table">
          <table>
            <thead>
              <tr><th>Segment</th><th>Revenue</th><th>Pay</th><th>Count</th></tr>
            </thead>
            <tbody>
              {points.map((point) => (
                <tr key={point.segmentId}><td>{point.label}</td><td>{niceCurrency(point.revenue)}</td><td>{niceCurrency(point.pay)}</td><td>{point.count}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </figure>
  );
}

interface PayoutDistributionProps {
  quantiles: { p10: number; p50: number; p90: number };
  currency: string;
}

export function PayoutDistribution({ quantiles, currency }: PayoutDistributionProps): React.JSX.Element {
  const width = 640;
  const height = 120;
  const margin = { top: 18, right: 18, bottom: 30, left: 60 };
  const plotWidth = width - margin.left - margin.right;
  const min = Math.min(quantiles.p10, quantiles.p50, quantiles.p90);
  const max = Math.max(quantiles.p10, quantiles.p50, quantiles.p90);
  const range = max - min || Math.max(1, Math.abs(max) * 0.1);
  const xToPx = (value: number): number => margin.left + ((value - (min - 0.1 * range)) / (range * 1.2)) * plotWidth;
  return (
    <figure className="chart">
      <figcaption><span>Payout distribution ({currency})</span></figcaption>
      <svg role="img" viewBox={`0 0 ${width} ${height}`} className="chart-svg" aria-label="Payout quantiles">
        <line x1={xToPx(quantiles.p10)} x2={xToPx(quantiles.p90)} y1={margin.top + 30} y2={margin.top + 30} className="chart-strip-line" />
        <circle cx={xToPx(quantiles.p10)} cy={margin.top + 30} r={5} className="chart-kink" />
        <circle cx={xToPx(quantiles.p50)} cy={margin.top + 30} r={7} className="chart-bonus" />
        <circle cx={xToPx(quantiles.p90)} cy={margin.top + 30} r={5} className="chart-kink" />
        <text x={xToPx(quantiles.p10)} y={margin.top + 60} textAnchor="middle" className="chart-axis-label">P10 {niceCurrency(quantiles.p10)}</text>
        <text x={xToPx(quantiles.p50)} y={margin.top + 60} textAnchor="middle" className="chart-axis-label">P50 {niceCurrency(quantiles.p50)}</text>
        <text x={xToPx(quantiles.p90)} y={margin.top + 60} textAnchor="middle" className="chart-axis-label">P90 {niceCurrency(quantiles.p90)}</text>
      </svg>
      <p className="chart-summary">Weighted quantiles across the population; the middle marker is the median payout.</p>
    </figure>
  );
}
