"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { computeLedger, type LedgerResult } from "@/engine/ledger";
import { Rat } from "@/engine/rat";
import {
  availableAxes,
  createSweepRun,
  sweepAxisLabel,
  type SweepAxis,
  type SweepResult,
} from "@/engine/sweep";
import { formatCompactCurrency, formatPercent, localeOf } from "@/i18n";
import { useScenarioStore } from "@/state/store";

const WIDTH = 640;
const HEIGHT = 320;
const MARGIN = { top: 20, right: 24, bottom: 52, left: 92 };

function axisKey(axis: SweepAxis): string {
  return axis.kind === "tierRate" ? `tierRate:${axis.tierIndex ?? 0}` : axis.kind;
}

export function LedgerPanel(): React.JSX.Element {
  const domain = useScenarioStore((state) => state.domain);
  const scenario = useScenarioStore((state) => state.scenario);
  const activePlanId = useScenarioStore((state) => state.activePlanId);
  const toggleObjective = useScenarioStore((state) => state.toggleObjective);
  const setObjectiveLimit = useScenarioStore((state) => state.setObjectiveLimit);

  const currency = scenario.settings.currencyLabel;
  const locale = localeOf(scenario.settings.locale);
  const declared = scenario.settings.objective ?? null;

  const ledger: LedgerResult | null = useMemo(
    () => (domain ? computeLedger(domain) : null),
    [domain],
  );

  const plan = domain?.plans.find((entry) => entry.id === activePlanId) ?? domain?.plans[0] ?? null;
  const catalogue = useMemo(() => (plan ? availableAxes(plan) : []), [plan]);
  const [traceKey, setTraceKey] = useState<string | null>(null);
  const [trace, setTrace] = useState<SweepResult | null>(null);
  const [tracing, setTracing] = useState(false);
  const [traceError, setTraceError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const token = useRef(0);

  useEffect(() => {
    setTrace(null);
    setTraceError(null);
    setTraceKey(catalogue[0] ? axisKey(catalogue[0]) : null);
  }, [catalogue]);

  useEffect(
    () => () => {
      token.current += 1;
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  // The sweep runs in a timer, so a throw inside it escapes React entirely: no error boundary
  // sees it, and `tracing` would stay set, leaving the button on "Tracing…" with nothing left to
  // clear it. Both ends are caught and reported, as the Analyze sweep panel already does.
  const runTrace = (): void => {
    const axis = catalogue.find((entry) => axisKey(entry) === traceKey);
    if (!domain || !plan || !axis) return;
    const current = ++token.current;
    if (timer.current) clearTimeout(timer.current);
    setTraceError(null);
    try {
      const runner = createSweepRun(domain, plan.id, { ...axis, steps: 40 });
      setTracing(true);
      setTrace(null);
      const drive = (): void => {
        if (current !== token.current) return;
        try {
          const deadline = performance.now() + 30;
          do runner.step(1);
          while (runner.completed < runner.total && performance.now() < deadline);
          if (runner.completed < runner.total) {
            timer.current = setTimeout(drive, 0);
            return;
          }
          timer.current = null;
          setTracing(false);
          setTrace(runner.result());
        } catch (caught) {
          if (current !== token.current) return;
          timer.current = null;
          setTracing(false);
          setTraceError(caught instanceof Error ? caught.message : "The trace could not complete.");
        }
      };
      timer.current = setTimeout(drive, 0);
    } catch (caught) {
      setTracing(false);
      setTraceError(caught instanceof Error ? caught.message : "The trace could not start.");
    }
  };

  if (!ledger) return <></>;

  const points = ledger.rows.map((row) => ({
    id: row.planId,
    label: row.planLabel,
    x: row.totalComp.toNumber(),
    y: row.trueValue.toNumber(),
    onFrontier: ledger.frontier.includes(row.planId),
    feasible: row.feasible,
  }));
  const tracePoints = (trace?.points ?? [])
    .filter((point) => point.kpis !== null)
    .map((point) => ({
      x: point.kpis!.totalComp!.toNumber(),
      y: point.kpis!.trueValue!.toNumber(),
    }));

  const allX = [...points.map((point) => point.x), ...tracePoints.map((point) => point.x)];
  const allY = [...points.map((point) => point.y), ...tracePoints.map((point) => point.y)];
  const xMin = Math.min(0, ...allX);
  const xMax = Math.max(...allX, 1);
  const yMin = Math.min(0, ...allY);
  const yMax = Math.max(...allY, 1);
  const plotWidth = WIDTH - MARGIN.left - MARGIN.right;
  const plotHeight = HEIGHT - MARGIN.top - MARGIN.bottom;
  const toX = (value: number): number =>
    MARGIN.left + ((value - xMin) / (xMax - xMin || 1)) * plotWidth;
  const toY = (value: number): number =>
    MARGIN.top + plotHeight - ((value - yMin) / (yMax - yMin || 1)) * plotHeight;

  const bestProfit = ledger.rows.reduce<(typeof ledger.rows)[number] | null>(
    (best, row) => (best === null || row.profit.gt(best.profit) ? row : best),
    null,
  );

  return (
    <section className="ledger-panel" aria-labelledby="ledger-heading">
      <header className="ledger-header">
        <div>
          <p className="eyebrow">The principal&apos;s ledger</p>
          <h3 id="ledger-heading">What the firm keeps</h3>
        </div>
        <p className="ledger-description">
          Expected profit is <code>true value − total comp</code> — both already computed, which is
          what <code>γ</code> was always for. The objective is{" "}
          <strong>declared, not discovered</strong>: nothing here searches for a better plan, and no
          plan is scored against another except where one is at least as good on both axes.
        </p>
      </header>

      <div className="ledger-objective">
        <label className="ledger-toggle">
          <input type="checkbox" checked={declared !== null} onChange={toggleObjective} />
          <span>Declare limits alongside the objective</span>
        </label>
        {declared ? (
          <div className="ledger-limits">
            <LimitField
              label="Comp-ratio ceiling"
              value={declared.compRatioCeiling ?? ""}
              onChange={(value) => setObjectiveLimit("compRatioCeiling", value || null)}
            />
            <LimitField
              label="Retention floor (share of headcount)"
              value={declared.retentionFloor ?? ""}
              onChange={(value) => setObjectiveLimit("retentionFloor", value || null)}
            />
          </div>
        ) : (
          <p className="ledger-note">
            Without declared limits every plan is feasible and the ledger reports profit alone.
          </p>
        )}
      </div>

      <div className="ledger-table-wrap">
        <table className="ledger-table">
          <thead>
            <tr>
              <th>Plan</th>
              <th>True value</th>
              <th>Total comp</th>
              <th>Profit</th>
              <th>Goodhart wedge</th>
              <th>Retained</th>
              <th>Against the declared standard</th>
            </tr>
          </thead>
          <tbody>
            {ledger.rows.map((row) => (
              <tr key={row.planId} className={row.feasible ? undefined : "ledger-row-infeasible"}>
                <th scope="row">{row.planLabel}</th>
                <td>{formatCompactCurrency(row.trueValue.toNumber(), currency, locale)}</td>
                <td>{formatCompactCurrency(row.totalComp.toNumber(), currency, locale)}</td>
                <td className="ledger-profit">
                  {formatCompactCurrency(row.profit.toNumber(), currency, locale)}
                </td>
                <td>
                  {formatCompactCurrency(row.wedge.toNumber(), currency, locale)}
                  {row.wedgePerRevenue ? (
                    <span className="ledger-sub">
                      {" "}
                      ({formatPercent(row.wedgePerRevenue.toNumber(), locale)} of revenue)
                    </span>
                  ) : null}
                </td>
                <td>{formatPercent(row.retainedShare.toNumber(), locale)}</td>
                <td>
                  {row.constraints.length === 0
                    ? "—"
                    : row.constraints
                        .map(
                          (constraint) =>
                            `${constraint.label}: ${constraint.satisfied ? "met" : "missed"}`,
                        )
                        .join("; ")}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {ledger.dominance.length > 0 ? (
        <ul className="ledger-dominance">
          {ledger.dominance.map((pair) => (
            <li key={`${pair.dominantPlanId}>${pair.dominatedPlanId}`}>
              <strong>{pair.dominantPlanId}</strong> dominates {pair.dominatedPlanId} on the
              declared objective:{" "}
              {formatCompactCurrency(pair.profitGap.toNumber(), currency, locale)} more profit for{" "}
              {formatCompactCurrency(pair.compSaving.toNumber(), currency, locale)} less comp. No
              exchange rate between money and value is needed to prefer it.
            </li>
          ))}
        </ul>
      ) : ledger.rows.length > 1 ? (
        <p className="ledger-note">
          No plan dominates another here — each buys its value at a different price, so the choice
          is a judgement the ledger will not make for you.
          {bestProfit ? ` ${bestProfit.planLabel} earns the most profit as declared.` : ""}
        </p>
      ) : null}

      <figure className="chart ledger-figure" aria-label="Cost and value frontier">
        <figcaption>
          <span>Plans in (total comp, true value) space</span>
          {catalogue.length > 0 ? (
            <span className="ledger-trace-controls">
              <label>
                <span className="visually-hidden">Trace a swept scalar through the frontier</span>
                <select
                  value={traceKey ?? ""}
                  onChange={(event) => setTraceKey(event.target.value)}
                >
                  {catalogue.map((axis) => (
                    <option key={axisKey(axis)} value={axisKey(axis)}>
                      {sweepAxisLabel(axis, plan ?? undefined)}
                    </option>
                  ))}
                </select>
              </label>
              <button type="button" onClick={runTrace} disabled={tracing || !plan}>
                {tracing ? "Tracing…" : "Trace this scalar"}
              </button>
              {traceError ? (
                <span role="alert" className="surface-error">
                  {traceError}
                </span>
              ) : null}
            </span>
          ) : null}
        </figcaption>
        <svg
          role="group"
          aria-labelledby="ledger-frontier-title"
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          className="chart-svg"
        >
          <title id="ledger-frontier-title">
            Each plan as a point: what it costs against what it is worth. Plans up and to the left
            are better on both axes.
          </title>
          <rect
            x={MARGIN.left}
            y={MARGIN.top}
            width={plotWidth}
            height={plotHeight}
            className="chart-plot-bg"
          />
          {tracePoints.length > 1 ? (
            <path
              d={tracePoints
                .map((point, index) => `${index === 0 ? "M" : "L"}${toX(point.x)} ${toY(point.y)}`)
                .join(" ")}
              className="ledger-trace"
              fill="none"
            />
          ) : null}
          {points.map((point) => (
            <g key={point.id}>
              <circle
                cx={toX(point.x)}
                cy={toY(point.y)}
                r={point.onFrontier ? 7 : 5}
                className={
                  point.feasible
                    ? point.onFrontier
                      ? "ledger-dot-frontier"
                      : "ledger-dot"
                    : "ledger-dot-infeasible"
                }
              >
                <title>
                  {`${point.label}: ${formatCompactCurrency(point.y, currency, locale)} of value for ${formatCompactCurrency(point.x, currency, locale)} of comp`}
                </title>
              </circle>
              <text
                x={toX(point.x)}
                y={toY(point.y) - 12}
                className="chart-axis-label"
                textAnchor="middle"
              >
                {point.label}
              </text>
            </g>
          ))}
          <text
            x={MARGIN.left}
            y={MARGIN.top + plotHeight + 20}
            className="chart-axis-label"
            textAnchor="start"
          >
            {formatCompactCurrency(xMin, currency, locale)}
          </text>
          <text
            x={MARGIN.left + plotWidth}
            y={MARGIN.top + plotHeight + 20}
            className="chart-axis-label"
            textAnchor="end"
          >
            {formatCompactCurrency(xMax, currency, locale)}
          </text>
          <text
            x={MARGIN.left + plotWidth / 2}
            y={MARGIN.top + plotHeight + 40}
            className="chart-axis-title"
            textAnchor="middle"
          >
            Total comp
          </text>
          <text
            x={MARGIN.left - 12}
            y={MARGIN.top + plotHeight}
            className="chart-axis-label"
            textAnchor="end"
          >
            {formatCompactCurrency(yMin, currency, locale)}
          </text>
          <text
            x={MARGIN.left - 12}
            y={MARGIN.top + 10}
            className="chart-axis-label"
            textAnchor="end"
          >
            {formatCompactCurrency(yMax, currency, locale)}
          </text>
        </svg>
        <p className="chart-summary">
          {ledger.frontier.length === ledger.rows.length
            ? "Every plan sits on the frontier: none is beaten on both cost and value."
            : `On the frontier: ${ledger.frontier.join(", ")}. The others are beaten on both axes at once.`}
          {trace
            ? ` The traced line is ${sweepAxisLabel(trace.axis, plan ?? undefined)} swept across its range — where it bends is where the population changes what it plays.`
            : ""}
        </p>
      </figure>
    </section>
  );
}

interface LimitFieldProps {
  label: string;
  value: string;
  onChange(value: string): void;
}

function LimitField({ label, value, onChange }: LimitFieldProps): React.JSX.Element {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <label className="ledger-limit">
      <span>{label}</span>
      <input
        type="text"
        inputMode="decimal"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => {
          const trimmed = draft.trim();
          if (trimmed === "") {
            onChange("");
            return;
          }
          try {
            Rat.fromDecimalString(trimmed);
            onChange(trimmed);
          } catch {
            setDraft(value);
          }
        }}
      />
    </label>
  );
}
