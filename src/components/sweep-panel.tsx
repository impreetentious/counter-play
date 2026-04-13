"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Rat } from "@/engine/rat";
import {
  SWEEP_GRID_MAX_STEPS,
  SWEEP_KPI_KEYS,
  SWEEP_MAX_STEPS,
  SWEEP_MIN_STEPS,
  availableAxes,
  createSweepGridRun,
  createSweepRun,
  sweepAxisLabel,
  type SweepAxis,
  type SweepGridResult,
  type SweepKpiKey,
  type SweepResult,
} from "@/engine/sweep";
import type { AppLocale, Plan } from "@/engine/types";
import { formatCompactCurrency, formatNumber, formatPercent, localeOf } from "@/i18n";
import { useScenarioStore } from "@/state/store";

const kpiLabels: Record<SweepKpiKey, string> = {
  expectedRevenue: "Expected revenue",
  totalComp: "Total comp",
  compRatio: "Comp ratio",
  quotaAttainRate: "Quota-attain rate",
  effectiveCommissionRate: "Eff. commission rate",
  trueValue: "True value",
  profit: "Profit (true value − comp)",
};

const rateLike = new Set<SweepKpiKey>(["compRatio", "quotaAttainRate", "effectiveCommissionRate"]);

function formatKpi(
  value: number | null,
  kpi: SweepKpiKey,
  currency: string,
  locale: AppLocale,
): string {
  if (value === null || !Number.isFinite(value)) return "—";
  return rateLike.has(kpi)
    ? formatPercent(value, locale)
    : formatCompactCurrency(value, currency, locale);
}

/** Axis values are attainments or rates for some axes and money for others. */
function formatAxisValue(
  value: number,
  axis: SweepAxis,
  currency: string,
  locale: AppLocale,
): string {
  if (axis.kind === "base" || axis.kind === "bonusAmount")
    return formatCompactCurrency(value, currency, locale);
  if (axis.kind === "tierRate") return formatPercent(value, locale, 2);
  return formatPercent(value, locale, 1);
}

interface AxisDraft {
  key: string;
  lo: string;
  hi: string;
  steps: number;
}

function axisKey(axis: SweepAxis): string {
  return axis.kind === "tierRate" ? `tierRate:${axis.tierIndex ?? 0}` : axis.kind;
}

function draftFrom(axis: SweepAxis, steps: number): AxisDraft {
  return {
    key: axisKey(axis),
    lo: axis.lo.toDecimalString(),
    hi: axis.hi.toDecimalString(),
    steps,
  };
}

function resolveAxis(draft: AxisDraft, catalogue: readonly SweepAxis[]): SweepAxis | null {
  const template = catalogue.find((axis) => axisKey(axis) === draft.key);
  if (!template) return null;
  try {
    const lo = Rat.fromDecimalString(draft.lo.trim());
    const hi = Rat.fromDecimalString(draft.hi.trim());
    if (hi.lte(lo)) return null;
    return { ...template, lo, hi, steps: draft.steps };
  } catch {
    return null;
  }
}

type SweepView = "curve" | "pair";

export function SweepPanel(): React.JSX.Element {
  const domain = useScenarioStore((state) => state.domain);
  const scenario = useScenarioStore((state) => state.scenario);
  const activePlanId = useScenarioStore((state) => state.activePlanId);

  const currency = scenario.settings.currencyLabel;
  const locale = localeOf(scenario.settings.locale);

  const plan: Plan | null = useMemo(
    () => domain?.plans.find((entry) => entry.id === activePlanId) ?? domain?.plans[0] ?? null,
    [domain, activePlanId],
  );
  const catalogue = useMemo(() => (plan ? availableAxes(plan) : []), [plan]);

  const [view, setView] = useState<SweepView>("curve");
  const [kpi, setKpi] = useState<SweepKpiKey>("profit");
  const [primary, setPrimary] = useState<AxisDraft | null>(null);
  const [secondary, setSecondary] = useState<AxisDraft | null>(null);
  const [curve, setCurve] = useState<SweepResult | null>(null);
  const [grid, setGrid] = useState<SweepGridResult | null>(null);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const runToken = useRef(0);

  // A new plan means a new axis catalogue; drop stale drafts and stale curves together.
  useEffect(() => {
    const first = catalogue[0];
    const second = catalogue[1] ?? catalogue[0];
    setPrimary(first ? draftFrom(first, 40) : null);
    setSecondary(second ? draftFrom(second, 16) : null);
    setCurve(null);
    setGrid(null);
  }, [catalogue]);

  const stop = useCallback(() => {
    runToken.current += 1;
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setRunning(false);
  }, []);

  useEffect(() => stop, [stop]);

  const primaryAxis = primary ? resolveAxis(primary, catalogue) : null;
  const secondaryAxis = secondary ? resolveAxis(secondary, catalogue) : null;

  const run = (): void => {
    if (!domain || !plan || !primaryAxis) return;
    if (view === "pair" && (!secondaryAxis || axisKey(primaryAxis) === axisKey(secondaryAxis)))
      return;
    stop();
    const token = ++runToken.current;
    setError(null);
    setCurve(null);
    setGrid(null);
    try {
      const runner =
        view === "curve"
          ? createSweepRun(domain, plan.id, primaryAxis)
          : createSweepGridRun(domain, plan.id, primaryAxis, secondaryAxis!);
      setRunning(true);
      setProgress({ done: 0, total: runner.total });
      const drive = (): void => {
        if (token !== runToken.current) return;
        try {
          const deadline = performance.now() + 30;
          do runner.step(1);
          while (runner.completed < runner.total && performance.now() < deadline);
          setProgress({ done: runner.completed, total: runner.total });
          if (runner.completed < runner.total) {
            timer.current = setTimeout(drive, 0);
            return;
          }
          timer.current = null;
          setRunning(false);
          const output = runner.result();
          if ("cells" in output) setGrid(output);
          else setCurve(output);
        } catch (caught) {
          if (token !== runToken.current) return;
          setRunning(false);
          setError(caught instanceof Error ? caught.message : "The sweep could not complete.");
        }
      };
      timer.current = setTimeout(drive, 0);
    } catch (caught) {
      setRunning(false);
      setError(caught instanceof Error ? caught.message : "The sweep could not start.");
    }
  };

  const runnable =
    !running &&
    domain !== null &&
    plan !== null &&
    primaryAxis !== null &&
    (view === "curve" ||
      (secondaryAxis !== null && axisKey(primaryAxis) !== axisKey(secondaryAxis)));

  return (
    <section className="sweep-panel" aria-labelledby="sweep-heading">
      <header className="sweep-header">
        <div>
          <p className="eyebrow">Plan-space sweep</p>
          <h3 id="sweep-heading">Comparative statics on the plan itself</h3>
        </div>
        <p className="sweep-description">
          Monte Carlo sweeps the <em>assumptions</em>; this sweeps the <em>plan</em>. One scalar
          moves across a stated range and every KPI is recomputed from scratch. There is no
          suggested plan and no ranking here — where the curve turns is the finding. Like the local
          rate search, it evaluates the exact deterministic response even in CARA mode.
        </p>
      </header>

      {catalogue.length === 0 || !plan ? (
        <p className="sweep-empty">Fix the scenario inputs before sweeping a plan.</p>
      ) : (
        <>
          <div className="sweep-controls">
            <fieldset className="sweep-view">
              <legend>Sweep</legend>
              <label>
                <input
                  type="radio"
                  name="sweep-view"
                  checked={view === "curve"}
                  onChange={() => setView("curve")}
                />
                <span>One scalar</span>
              </label>
              <label>
                <input
                  type="radio"
                  name="sweep-view"
                  checked={view === "pair"}
                  onChange={() => setView("pair")}
                />
                <span>A pair</span>
              </label>
            </fieldset>

            <AxisControls
              legend={view === "pair" ? "Horizontal axis" : "Swept scalar"}
              draft={primary}
              catalogue={catalogue}
              plan={plan}
              maxSteps={view === "pair" ? SWEEP_GRID_MAX_STEPS : SWEEP_MAX_STEPS}
              onChange={setPrimary}
            />
            {view === "pair" ? (
              <AxisControls
                legend="Vertical axis"
                draft={secondary}
                catalogue={catalogue}
                plan={plan}
                maxSteps={SWEEP_GRID_MAX_STEPS}
                onChange={setSecondary}
              />
            ) : null}

            <label className="sweep-kpi">
              <span>Read-out</span>
              <select value={kpi} onChange={(event) => setKpi(event.target.value as SweepKpiKey)}>
                {SWEEP_KPI_KEYS.map((key) => (
                  <option key={key} value={key}>
                    {kpiLabels[key]}
                  </option>
                ))}
              </select>
            </label>

            <button type="button" className="button-primary" onClick={run} disabled={!runnable}>
              {running ? "Sweeping…" : "Run sweep"}
            </button>
            {running ? (
              <button type="button" onClick={stop}>
                Cancel
              </button>
            ) : null}
          </div>

          {running ? (
            <div
              role="progressbar"
              aria-label="Sweep progress"
              aria-valuemin={0}
              aria-valuemax={progress.total}
              aria-valuenow={progress.done}
              className="sweep-progress"
            >
              {formatNumber(progress.done, locale, 0)} of {formatNumber(progress.total, locale, 0)}{" "}
              plans evaluated
            </div>
          ) : null}

          {error ? (
            <p role="alert" className="surface-error">
              {error}
            </p>
          ) : null}

          {curve ? (
            <SweepCurve result={curve} kpi={kpi} currency={currency} locale={locale} plan={plan} />
          ) : null}
          {grid ? (
            <SweepHeatmap result={grid} kpi={kpi} currency={currency} locale={locale} plan={plan} />
          ) : null}
        </>
      )}
    </section>
  );
}

interface AxisControlsProps {
  legend: string;
  draft: AxisDraft | null;
  catalogue: readonly SweepAxis[];
  plan: Plan;
  maxSteps: number;
  onChange(draft: AxisDraft): void;
}

function AxisControls({
  legend,
  draft,
  catalogue,
  plan,
  maxSteps,
  onChange,
}: AxisControlsProps): React.JSX.Element | null {
  if (!draft) return null;
  const steps = Math.min(draft.steps, maxSteps);
  return (
    <fieldset className="sweep-axis">
      <legend>{legend}</legend>
      <label>
        <span className="visually-hidden">{`${legend} scalar`}</span>
        <select
          value={draft.key}
          onChange={(event) => {
            const next = catalogue.find((axis) => axisKey(axis) === event.target.value);
            if (next) onChange(draftFrom(next, steps));
          }}
        >
          {catalogue.map((axis) => (
            <option key={axisKey(axis)} value={axisKey(axis)}>
              {sweepAxisLabel(axis, plan)}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span>From</span>
        <input
          type="text"
          inputMode="decimal"
          value={draft.lo}
          onChange={(event) => onChange({ ...draft, lo: event.target.value })}
        />
      </label>
      <label>
        <span>To</span>
        <input
          type="text"
          inputMode="decimal"
          value={draft.hi}
          onChange={(event) => onChange({ ...draft, hi: event.target.value })}
        />
      </label>
      <label>
        <span>Steps</span>
        <input
          type="number"
          min={SWEEP_MIN_STEPS}
          max={maxSteps}
          step={1}
          value={steps}
          onChange={(event) => {
            const parsed = Number(event.target.value);
            if (Number.isInteger(parsed) && parsed >= SWEEP_MIN_STEPS && parsed <= maxSteps)
              onChange({ ...draft, steps: parsed });
          }}
        />
      </label>
    </fieldset>
  );
}

interface CurveProps {
  result: SweepResult;
  kpi: SweepKpiKey;
  currency: string;
  locale: AppLocale;
  plan: Plan;
}

const WIDTH = 720;
const HEIGHT = 300;
const MARGIN = { top: 16, right: 24, bottom: 44, left: 84 };

function SweepCurve({ result, kpi, currency, locale, plan }: CurveProps): React.JSX.Element {
  const [showTable, setShowTable] = useState(false);
  const plotWidth = WIDTH - MARGIN.left - MARGIN.right;
  const plotHeight = HEIGHT - MARGIN.top - MARGIN.bottom;

  const samples = result.points.map((point) => ({
    x: point.value.toNumber(),
    y: point.kpis?.[kpi]?.toNumber() ?? null,
    infeasible: point.infeasible,
    plays: point.plays,
    highFindings: point.highFindings,
  }));
  const xs = samples.map((sample) => sample.x);
  const ys = samples
    .map((sample) => sample.y)
    .filter((value): value is number => value !== null && Number.isFinite(value));

  const xMin = Math.min(...xs);
  const xMax = Math.max(...xs);
  const rawMin = ys.length ? Math.min(...ys) : 0;
  const rawMax = ys.length ? Math.max(...ys) : 1;
  const pad = rawMax === rawMin ? Math.max(Math.abs(rawMax) * 0.1, 1) : (rawMax - rawMin) * 0.08;
  const yMin = rawMin - pad;
  const yMax = rawMax + pad;

  const toX = (value: number): number =>
    MARGIN.left + (xMax === xMin ? 0 : ((value - xMin) / (xMax - xMin)) * plotWidth);
  const toY = (value: number): number =>
    MARGIN.top + plotHeight - ((value - yMin) / (yMax - yMin || 1)) * plotHeight;

  // Infeasible points break the path rather than being bridged across.
  const segments: string[] = [];
  let open: string[] = [];
  for (const sample of samples) {
    if (sample.y === null || !Number.isFinite(sample.y)) {
      if (open.length > 1) segments.push(open.join(" "));
      open = [];
      continue;
    }
    open.push(`${open.length === 0 ? "M" : "L"}${toX(sample.x)} ${toY(sample.y)}`);
  }
  if (open.length > 1) segments.push(open.join(" "));

  const located = result.crossings.filter((crossing) => crossing.at !== null);
  const bracketed = result.crossings.filter((crossing) => crossing.at === null);
  const summary =
    result.crossings.length === 0
      ? `${kpiLabels[kpi]} moves continuously across this range — no segment changes the play it is making.`
      : `${kpiLabels[kpi]} across ${sweepAxisLabel(result.axis, plan)}, with ${result.crossings.length} point${result.crossings.length === 1 ? "" : "s"} where a segment switches plays.`;

  return (
    <figure className="chart sweep-figure" aria-label={`Sweep of ${kpiLabels[kpi]}`}>
      <figcaption>
        <span>
          {kpiLabels[kpi]} · <strong>{result.planLabel}</strong> ·{" "}
          {sweepAxisLabel(result.axis, plan)}
        </span>
        <button
          type="button"
          className="chart-twin-toggle"
          onClick={() => setShowTable((value) => !value)}
        >
          {showTable ? "Hide data table" : "Show data table"}
        </button>
      </figcaption>
      <svg
        role="group"
        aria-labelledby="sweep-curve-title"
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="chart-svg"
      >
        <title id="sweep-curve-title">{summary}</title>
        <rect
          x={MARGIN.left}
          y={MARGIN.top}
          width={plotWidth}
          height={plotHeight}
          className="chart-plot-bg"
        />
        {samples.map((sample) =>
          sample.infeasible ? (
            <line
              key={`gap-${sample.x}`}
              x1={toX(sample.x)}
              x2={toX(sample.x)}
              y1={MARGIN.top}
              y2={MARGIN.top + plotHeight}
              className="sweep-infeasible"
            />
          ) : null,
        )}
        {located.map((crossing, index) => (
          <g key={`cross-${index}`}>
            <line
              x1={toX(crossing.at!.toNumber())}
              x2={toX(crossing.at!.toNumber())}
              y1={MARGIN.top}
              y2={MARGIN.top + plotHeight}
              className="sweep-crossing"
            />
            <text
              x={toX(crossing.at!.toNumber())}
              y={MARGIN.top - 4}
              className="chart-axis-label"
              textAnchor="middle"
            >
              {formatAxisValue(crossing.at!.toNumber(), result.axis, currency, locale)}
            </text>
          </g>
        ))}
        {bracketed.map((crossing, index) => (
          <rect
            key={`bracket-${index}`}
            x={toX(crossing.bracket[0].toNumber())}
            y={MARGIN.top}
            width={Math.max(
              1,
              toX(crossing.bracket[1].toNumber()) - toX(crossing.bracket[0].toNumber()),
            )}
            height={plotHeight}
            className="sweep-crossing-bracket"
          />
        ))}
        {segments.map((path, index) => (
          <path key={`path-${index}`} d={path} className="chart-curve" fill="none" />
        ))}
        <text x={MARGIN.left - 12} y={MARGIN.top + 6} className="chart-axis-label" textAnchor="end">
          {formatKpi(rawMax, kpi, currency, locale)}
        </text>
        <text
          x={MARGIN.left - 12}
          y={MARGIN.top + plotHeight}
          className="chart-axis-label"
          textAnchor="end"
        >
          {formatKpi(rawMin, kpi, currency, locale)}
        </text>
        <text
          x={MARGIN.left}
          y={MARGIN.top + plotHeight + 20}
          className="chart-axis-label"
          textAnchor="start"
        >
          {formatAxisValue(xMin, result.axis, currency, locale)}
        </text>
        <text
          x={MARGIN.left + plotWidth}
          y={MARGIN.top + plotHeight + 20}
          className="chart-axis-label"
          textAnchor="end"
        >
          {formatAxisValue(xMax, result.axis, currency, locale)}
        </text>
        <text
          x={MARGIN.left + plotWidth / 2}
          y={MARGIN.top + plotHeight + 38}
          className="chart-axis-title"
          textAnchor="middle"
        >
          {sweepAxisLabel(result.axis, plan)}
        </text>
      </svg>
      <p className="chart-summary">{summary}</p>

      {result.crossings.length > 0 ? (
        <ul className="sweep-crossing-list">
          {result.crossings.map((crossing, index) => (
            <li key={`crossing-row-${index}`}>
              <strong>
                {crossing.at
                  ? formatAxisValue(crossing.at.toNumber(), result.axis, currency, locale)
                  : `between ${formatAxisValue(crossing.bracket[0].toNumber(), result.axis, currency, locale)} and ${formatAxisValue(crossing.bracket[1].toNumber(), result.axis, currency, locale)}`}
              </strong>{" "}
              — {crossing.segmentId} switches from <em>{crossing.fromBranch}</em> (
              {formatCompactCurrency(crossing.fromOutput.toNumber(), currency, locale)}) to{" "}
              <em>{crossing.toBranch}</em> (
              {formatCompactCurrency(crossing.toOutput.toNumber(), currency, locale)}).
              {crossing.at ? (
                <span className="sweep-crossing-note">
                  {" "}
                  Both plays earn exactly the same certainty equivalent there.
                </span>
              ) : (
                <span className="sweep-crossing-note">
                  {" "}
                  The exact crossing is not a rational value, so the interval is reported instead of
                  a point inside it.
                </span>
              )}
            </li>
          ))}
        </ul>
      ) : null}

      {showTable ? (
        <div className="chart-table">
          <table>
            <thead>
              <tr>
                <th>{sweepAxisLabel(result.axis, plan)}</th>
                {SWEEP_KPI_KEYS.map((key) => (
                  <th key={key}>{kpiLabels[key]}</th>
                ))}
                <th>High findings</th>
                <th>Plays</th>
              </tr>
            </thead>
            <tbody>
              {result.points.map((point, index) => (
                <tr key={`row-${index}`}>
                  <td>{formatAxisValue(point.value.toNumber(), result.axis, currency, locale)}</td>
                  {SWEEP_KPI_KEYS.map((key) => (
                    <td key={key}>
                      {point.infeasible
                        ? "—"
                        : formatKpi(point.kpis?.[key]?.toNumber() ?? null, key, currency, locale)}
                    </td>
                  ))}
                  <td>{point.highFindings ?? "—"}</td>
                  <td>
                    {point.infeasible ??
                      point.plays.map((play) => `${play.segmentId}: ${play.branch}`).join("; ")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </figure>
  );
}

interface HeatmapProps {
  result: SweepGridResult;
  kpi: SweepKpiKey;
  currency: string;
  locale: AppLocale;
  plan: Plan;
}

function SweepHeatmap({ result, kpi, currency, locale, plan }: HeatmapProps): React.JSX.Element {
  const [showTable, setShowTable] = useState(false);
  const rows = result.cells.length;
  const columns = result.cells[0]?.length ?? 0;
  const values = result.cells
    .flat()
    .map((cell) => cell.kpis?.[kpi]?.toNumber() ?? null)
    .filter((value): value is number => value !== null && Number.isFinite(value));
  const min = values.length ? Math.min(...values) : 0;
  const max = values.length ? Math.max(...values) : 1;
  const span = max - min || 1;

  const cellWidth = plotSize(columns);
  const cellHeight = plotSize(rows);
  const width = MARGIN.left + columns * cellWidth + MARGIN.right;
  const height = MARGIN.top + rows * cellHeight + MARGIN.bottom;
  const regimes = new Set(result.cells.flat().map((cell) => cell.signature ?? "infeasible"));
  const summary = `${kpiLabels[kpi]} over ${sweepAxisLabel(result.axisX, plan)} and ${sweepAxisLabel(result.axisY, plan)}; ${regimes.size} distinct play regime${regimes.size === 1 ? "" : "s"} appear in this rectangle.`;

  return (
    <figure className="chart sweep-figure" aria-label={`Pair sweep of ${kpiLabels[kpi]}`}>
      <figcaption>
        <span>
          {kpiLabels[kpi]} · <strong>{result.planLabel}</strong>
        </span>
        <button
          type="button"
          className="chart-twin-toggle"
          onClick={() => setShowTable((value) => !value)}
        >
          {showTable ? "Hide data table" : "Show data table"}
        </button>
      </figcaption>
      <svg
        role="group"
        aria-labelledby="sweep-heatmap-title"
        viewBox={`0 0 ${width} ${height}`}
        className="chart-svg"
      >
        <title id="sweep-heatmap-title">{summary}</title>
        {result.cells.map((row, rowIndex) =>
          row.map((cell, columnIndex) => {
            const value = cell.kpis?.[kpi]?.toNumber() ?? null;
            const x = MARGIN.left + columnIndex * cellWidth;
            // Row 0 holds the lowest y value, so it is drawn at the bottom.
            const y = MARGIN.top + (rows - 1 - rowIndex) * cellHeight;
            const intensity = value === null ? null : (value - min) / span;
            const left = row[columnIndex - 1];
            const below = result.cells[rowIndex - 1]?.[columnIndex];
            return (
              <g key={`cell-${rowIndex}-${columnIndex}`}>
                <rect
                  x={x}
                  y={y}
                  width={cellWidth}
                  height={cellHeight}
                  className={intensity === null ? "sweep-cell-void" : "sweep-cell"}
                  style={
                    intensity === null ? undefined : { opacity: 0.15 + 0.85 * clamp01(intensity) }
                  }
                >
                  <title>
                    {`${formatAxisValue(cell.x.toNumber(), result.axisX, currency, locale)} × ${formatAxisValue(cell.y.toNumber(), result.axisY, currency, locale)}: ${cell.infeasible ?? formatKpi(value, kpi, currency, locale)}`}
                  </title>
                </rect>
                {left && left.signature !== cell.signature ? (
                  <line x1={x} x2={x} y1={y} y2={y + cellHeight} className="sweep-regime-edge" />
                ) : null}
                {below && below.signature !== cell.signature ? (
                  <line
                    x1={x}
                    x2={x + cellWidth}
                    y1={y + cellHeight}
                    y2={y + cellHeight}
                    className="sweep-regime-edge"
                  />
                ) : null}
              </g>
            );
          }),
        )}
        <text
          x={MARGIN.left}
          y={MARGIN.top + rows * cellHeight + 20}
          className="chart-axis-label"
          textAnchor="start"
        >
          {formatAxisValue(result.axisX.lo.toNumber(), result.axisX, currency, locale)}
        </text>
        <text
          x={MARGIN.left + columns * cellWidth}
          y={MARGIN.top + rows * cellHeight + 20}
          className="chart-axis-label"
          textAnchor="end"
        >
          {formatAxisValue(result.axisX.hi.toNumber(), result.axisX, currency, locale)}
        </text>
        <text
          x={MARGIN.left + (columns * cellWidth) / 2}
          y={MARGIN.top + rows * cellHeight + 38}
          className="chart-axis-title"
          textAnchor="middle"
        >
          {sweepAxisLabel(result.axisX, plan)}
        </text>
        <text
          x={MARGIN.left - 12}
          y={MARGIN.top + rows * cellHeight}
          className="chart-axis-label"
          textAnchor="end"
        >
          {formatAxisValue(result.axisY.lo.toNumber(), result.axisY, currency, locale)}
        </text>
        <text
          x={MARGIN.left - 12}
          y={MARGIN.top + 10}
          className="chart-axis-label"
          textAnchor="end"
        >
          {formatAxisValue(result.axisY.hi.toNumber(), result.axisY, currency, locale)}
        </text>
      </svg>
      <p className="chart-summary">
        {summary} Darker cells are higher {kpiLabels[kpi].toLowerCase()}; the outlined edges are
        where the population changes the play it makes, which is where the KPI surface bends.
      </p>
      {showTable ? (
        <div className="chart-table">
          <table>
            <thead>
              <tr>
                <th>{sweepAxisLabel(result.axisX, plan)}</th>
                <th>{sweepAxisLabel(result.axisY, plan)}</th>
                <th>{kpiLabels[kpi]}</th>
                <th>Play regime</th>
              </tr>
            </thead>
            <tbody>
              {result.cells.flat().map((cell, index) => (
                <tr key={`cell-row-${index}`}>
                  <td>{formatAxisValue(cell.x.toNumber(), result.axisX, currency, locale)}</td>
                  <td>{formatAxisValue(cell.y.toNumber(), result.axisY, currency, locale)}</td>
                  <td>
                    {cell.infeasible
                      ? "—"
                      : formatKpi(cell.kpis?.[kpi]?.toNumber() ?? null, kpi, currency, locale)}
                  </td>
                  <td>{cell.infeasible ?? cell.signature}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </figure>
  );
}

function plotSize(count: number): number {
  if (count <= 0) return 1;
  return Math.max(8, Math.min(28, Math.round(560 / count)));
}

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}
