"use client";

import { useEffect, useMemo, useState } from "react";
import { KPI_KEYS, type KpiKey } from "@/engine/mc";
import { useScenarioStore } from "@/state/store";
import type { ScenarioJson, SegmentJson } from "@/state/schema";

const kpiLabels: Record<KpiKey, string> = {
  expectedRevenue: "Expected revenue",
  totalComp: "Total comp",
  compRatio: "Comp ratio",
  quotaAttainRate: "Quota-attain rate",
  effectiveCommissionRate: "Eff. commission rate",
  trueValue: "True value",
};

function formatCompact(value: number | null, currency: string): string {
  if (value === null || !Number.isFinite(value)) return "—";
  const abs = Math.abs(value);
  if (abs >= 1e9) return `${currency}${(value / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${currency}${(value / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${currency}${(value / 1e3).toFixed(1)}K`;
  return `${currency}${value.toFixed(1)}`;
}

function formatRate(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "—";
  return `${(value * 100).toFixed(1)}%`;
}

function formatKpi(value: number | null, kpi: KpiKey, currency: string): string {
  if (kpi === "quotaAttainRate" || kpi === "compRatio" || kpi === "effectiveCommissionRate")
    return formatRate(value);
  return formatCompact(value, currency);
}

interface RangeRowProps {
  label: string;
  hint?: string;
  active: boolean;
  value: [string, string] | null;
  onToggle(active: boolean): void;
  onChange(range: [string, string]): void;
  disabled?: boolean;
  disabledHint?: string;
}

function RangeRow({
  label,
  hint,
  active,
  value,
  onToggle,
  onChange,
  disabled,
  disabledHint,
}: RangeRowProps): React.JSX.Element {
  const [lo, setLo] = useState(value?.[0] ?? "0.9");
  const [hi, setHi] = useState(value?.[1] ?? "1.1");
  useEffect(() => {
    if (value) {
      setLo(value[0]);
      setHi(value[1]);
    }
  }, [value]);
  return (
    <div className={`mc-range-row${disabled ? " disabled" : ""}`}>
      <label className="mc-range-label">
        <input
          type="checkbox"
          checked={active}
          onChange={(event) => onToggle(event.target.checked)}
          disabled={disabled}
        />
        <span>{label}</span>
      </label>
      <div className="mc-range-inputs">
        <label>
          <span className="visually-hidden">{`${label} lower multiplier`}</span>
          <input
            type="text"
            inputMode="decimal"
            aria-label={`${label} lower multiplier`}
            value={lo}
            disabled={!active || disabled}
            onChange={(event) => setLo(event.target.value)}
            onBlur={() => onChange([lo, hi])}
          />
        </label>
        <span aria-hidden="true">→</span>
        <label>
          <span className="visually-hidden">{`${label} upper multiplier`}</span>
          <input
            type="text"
            inputMode="decimal"
            aria-label={`${label} upper multiplier`}
            value={hi}
            disabled={!active || disabled}
            onChange={(event) => setHi(event.target.value)}
            onBlur={() => onChange([lo, hi])}
          />
        </label>
      </div>
      {hint || (disabled && disabledHint) ? (
        <p className="mc-range-hint">{disabled ? disabledHint : hint}</p>
      ) : null}
    </div>
  );
}

interface SegmentRangeGroupProps {
  segment: SegmentJson;
  ranges: NonNullable<ScenarioJson["settings"]["mc"]["ranges"]["perSegment"]>[string] | undefined;
  isDet: boolean;
}

function SegmentRangeGroup({ segment, ranges, isDet }: SegmentRangeGroupProps): React.JSX.Element {
  const setSegmentRange = useScenarioStore((state) => state.setSegmentRange);
  const paramLabels: Record<"a" | "k" | "sigma" | "gamma", string> = {
    a: `${segment.label} · ability (a)`,
    k: `${segment.label} · cost K`,
    sigma: `${segment.label} · noise σ`,
    gamma: `${segment.label} · value γ`,
  };
  return (
    <div className="mc-segment-group">
      <h4>{segment.label}</h4>
      {(["a", "k", "sigma", "gamma"] as const).map((param) => {
        const value = ranges?.[param] ?? null;
        const active = value !== null;
        const disabled = isDet && param === "sigma";
        return (
          <RangeRow
            key={param}
            label={paramLabels[param]}
            hint={`Multiplier applied to ${segment.label}'s ${param}.`}
            active={active}
            value={value}
            onToggle={(next) =>
              setSegmentRange(segment.id, param, next ? (value ?? ["0.9", "1.1"]) : null)
            }
            onChange={(range) => setSegmentRange(segment.id, param, range)}
            disabled={disabled}
            disabledHint="σ has no effect in deterministic mode. Range is preserved but skipped for this run."
          />
        );
      })}
    </div>
  );
}

interface QuantileBarProps {
  label: string;
  p10: number;
  p50: number;
  p90: number;
  min: number;
  max: number;
  format(value: number): string;
}

function QuantileBar({
  label,
  p10,
  p50,
  p90,
  min,
  max,
  format,
}: QuantileBarProps): React.JSX.Element {
  const range = max - min || 1;
  const leftPct = ((p10 - min) / range) * 100;
  const widthPct = ((p90 - p10) / range) * 100;
  const midPct = ((p50 - min) / range) * 100;
  return (
    <div className="mc-band-row">
      <div className="mc-band-label">{label}</div>
      <div
        className="mc-band-track"
        role="img"
        aria-label={`${label}: P10 ${format(p10)}, P50 ${format(p50)}, P90 ${format(p90)}`}
      >
        <div className="mc-band-fill" style={{ left: `${leftPct}%`, width: `${widthPct}%` }} />
        <div className="mc-band-median" style={{ left: `${midPct}%` }} />
      </div>
      <div className="mc-band-values">
        <span>{format(p10)}</span>
        <span className="mc-band-median-value">{format(p50)}</span>
        <span>{format(p90)}</span>
      </div>
    </div>
  );
}

function tornadoDomain(
  bars: readonly {
    perPlan: readonly { base: number | null; low: number | null; high: number | null }[];
  }[],
): { min: number; max: number } {
  let min = Infinity;
  let max = -Infinity;
  for (const bar of bars) {
    for (const plan of bar.perPlan) {
      for (const value of [plan.base, plan.low, plan.high]) {
        if (value === null || !Number.isFinite(value)) continue;
        min = Math.min(min, value);
        max = Math.max(max, value);
      }
    }
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) return { min: 0, max: 1 };
  if (min === max) {
    const spread = Math.max(Math.abs(min) * 0.1, 1);
    return { min: min - spread, max: max + spread };
  }
  return { min, max };
}

export function McPanel(): React.JSX.Element {
  const scenario = useScenarioStore((state) => state.scenario);
  const domain = useScenarioStore((state) => state.domain);
  const domainError = useScenarioStore((state) => state.domainError);
  const mcResult = useScenarioStore((state) => state.mcResult);
  const mcTornado = useScenarioStore((state) => state.mcTornado);
  const mcRunning = useScenarioStore((state) => state.mcRunning);
  const mcError = useScenarioStore((state) => state.mcError);
  const mcTornadoKpi = useScenarioStore((state) => state.mcTornadoKpi);
  const setMcSeed = useScenarioStore((state) => state.setMcSeed);
  const setMcN = useScenarioStore((state) => state.setMcN);
  const setDemandRange = useScenarioStore((state) => state.setDemandRange);
  const setTornadoKpi = useScenarioStore((state) => state.setTornadoKpi);
  const runMonteCarloAction = useScenarioStore((state) => state.runMonteCarloAction);

  const isDet = scenario.settings.mode === "deterministic";
  const currency = scenario.settings.currencyLabel;
  const demandRange = scenario.settings.mc.ranges.demand ?? null;
  const perSegment = scenario.settings.mc.ranges.perSegment ?? {};

  const domainForTornado = useMemo(
    () => (mcTornado ? tornadoDomain(mcTornado.bars) : { min: 0, max: 1 }),
    [mcTornado],
  );
  const formatForKpi = (value: number): string => formatKpi(value, mcTornadoKpi, currency);

  const [seedDraft, setSeedDraft] = useState(String(scenario.settings.mc.seed));
  const [nDraft, setNDraft] = useState(String(scenario.settings.mc.N));
  useEffect(() => setSeedDraft(String(scenario.settings.mc.seed)), [scenario.settings.mc.seed]);
  useEffect(() => setNDraft(String(scenario.settings.mc.N)), [scenario.settings.mc.N]);

  const runDisabled = mcRunning || !domain || domainError !== null;

  return (
    <section className="mc-panel" aria-labelledby="mc-panel-heading">
      <header className="mc-panel-header">
        <div>
          <p className="eyebrow">Monte Carlo</p>
          <h3 id="mc-panel-heading">Assumption uncertainty</h3>
        </div>
        <p className="mc-panel-description">
          Sweep uncertain multipliers over your population and demand. Ranges are uniform on their
          bounds; every draw is the same across plans (common random numbers). σ ranges are inert in
          deterministic mode — they still consume the same RNG sequence so the seed remains
          reproducible across mode switches.
        </p>
      </header>

      <div className="mc-controls">
        <label className="mc-numeric">
          <span>Seed (uint32)</span>
          <input
            type="number"
            inputMode="numeric"
            min={0}
            max={2 ** 32 - 1}
            step={1}
            value={seedDraft}
            onChange={(event) => setSeedDraft(event.target.value)}
            onBlur={() => {
              const parsed = Number(seedDraft);
              if (Number.isInteger(parsed) && parsed >= 0 && parsed <= 2 ** 32 - 1)
                setMcSeed(parsed);
              else setSeedDraft(String(scenario.settings.mc.seed));
            }}
          />
        </label>
        <label className="mc-numeric">
          <span>Draws (100–5000)</span>
          <input
            type="number"
            inputMode="numeric"
            min={100}
            max={5000}
            step={50}
            value={nDraft}
            onChange={(event) => setNDraft(event.target.value)}
            onBlur={() => {
              const parsed = Number(nDraft);
              if (Number.isInteger(parsed) && parsed >= 100 && parsed <= 5000) setMcN(parsed);
              else setNDraft(String(scenario.settings.mc.N));
            }}
          />
        </label>
        <button
          type="button"
          className="mc-run-button"
          onClick={() => runMonteCarloAction()}
          disabled={runDisabled}
        >
          {mcRunning ? "Running…" : "Run Monte Carlo"}
        </button>
      </div>

      <div className="mc-ranges" role="group" aria-label="Uncertainty ranges">
        <RangeRow
          label="Demand (global × ability)"
          hint="A single multiplier applied to every segment's ability each draw."
          active={demandRange !== null}
          value={demandRange}
          onToggle={(next) => setDemandRange(next ? (demandRange ?? ["0.9", "1.1"]) : null)}
          onChange={(range) => setDemandRange(range)}
        />
        <div className="mc-per-segment">
          {scenario.population.map((segment) => (
            <SegmentRangeGroup
              key={segment.id}
              segment={segment}
              ranges={perSegment[segment.id]}
              isDet={isDet}
            />
          ))}
        </div>
      </div>

      {mcError ? (
        <p role="alert" className="surface-error">
          {mcError}
        </p>
      ) : null}

      {mcResult ? (
        <section className="mc-results" aria-label="Monte Carlo results">
          <header className="mc-stamp">
            <h4>Bands</h4>
            <p className="mc-stamp-line">
              Stamp: seed <code>{mcResult.stamp.seed}</code> · N <code>{mcResult.stamp.N}</code> ·
              engine <code>v{mcResult.stamp.engineVersion}</code> · mode{" "}
              <code>{mcResult.stamp.mode}</code>
            </p>
            <p className="mc-stamp-note">
              Reproduces exactly on the same engine version and platform.
            </p>
          </header>

          {mcResult.plans.map((plan) => (
            <div key={plan.planId} className="mc-plan-bands">
              <h5>{plan.planLabel}</h5>
              {KPI_KEYS.map((kpi) => {
                const quantiles = plan.quantiles[kpi];
                if (!quantiles)
                  return (
                    <p key={kpi} className="mc-band-empty">
                      {kpiLabels[kpi]}: —
                    </p>
                  );
                const draws = plan.draws
                  .map((sample) => sample[kpi])
                  .filter(
                    (value): value is number => typeof value === "number" && Number.isFinite(value),
                  );
                const min = draws.length ? Math.min(...draws) : quantiles.p10;
                const max = draws.length ? Math.max(...draws) : quantiles.p90;
                const format = (value: number): string => formatKpi(value, kpi, currency);
                return (
                  <QuantileBar
                    key={kpi}
                    label={kpiLabels[kpi]}
                    p10={quantiles.p10}
                    p50={quantiles.p50}
                    p90={quantiles.p90}
                    min={min}
                    max={max}
                    format={format}
                  />
                );
              })}
              <details className="mc-draw-table">
                <summary>Raw draws (first 20)</summary>
                <table>
                  <thead>
                    <tr>
                      <th>#</th>
                      {KPI_KEYS.map((kpi) => (
                        <th key={kpi}>{kpiLabels[kpi]}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {plan.draws.slice(0, 20).map((draw, index) => (
                      <tr key={index}>
                        <td>{index + 1}</td>
                        {KPI_KEYS.map((kpi) => (
                          <td key={kpi}>{formatKpi(draw[kpi], kpi, currency)}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </details>
            </div>
          ))}
        </section>
      ) : null}

      {mcTornado ? (
        <section className="mc-tornado" aria-label="Tornado sensitivity">
          <header>
            <h4>Tornado</h4>
            <label>
              <span>Sensitivity KPI</span>
              <select
                value={mcTornadoKpi}
                onChange={(event) => setTornadoKpi(event.target.value as KpiKey)}
              >
                {KPI_KEYS.map((kpi) => (
                  <option key={kpi} value={kpi}>
                    {kpiLabels[kpi]}
                  </option>
                ))}
              </select>
            </label>
          </header>
          <p className="mc-tornado-note">
            One parameter at a time, others at base. Bars use exact lo/hi endpoints (§3.11);
            ordering is canonical (demand → segments in scenario order, params{" "}
            <code>a, k, σ, γ</code>).
          </p>
          {mcTornado.bars.length === 0 ? (
            <p className="mc-tornado-empty">
              Enable at least one range above to compute a tornado.
            </p>
          ) : (
            mcTornado.bars.map((bar) => (
              <div key={bar.id} className="mc-tornado-bar" role="group" aria-label={bar.label}>
                <div className="mc-tornado-label">{bar.label}</div>
                {bar.perPlan.map((plan) => (
                  <TornadoRow
                    key={plan.planId}
                    label={plan.planLabel}
                    base={plan.base}
                    low={plan.low}
                    high={plan.high}
                    min={domainForTornado.min}
                    max={domainForTornado.max}
                    format={formatForKpi}
                  />
                ))}
              </div>
            ))
          )}
        </section>
      ) : null}
    </section>
  );
}

interface TornadoRowProps {
  label: string;
  base: number | null;
  low: number | null;
  high: number | null;
  min: number;
  max: number;
  format(value: number): string;
}

function TornadoRow({
  label,
  base,
  low,
  high,
  min,
  max,
  format,
}: TornadoRowProps): React.JSX.Element {
  if (base === null || low === null || high === null) {
    return (
      <div className="mc-tornado-row">
        <div className="mc-tornado-plan">{label}</div>
        <div className="mc-tornado-track" aria-hidden="true">
          <div className="mc-tornado-empty-tick" />
        </div>
        <div className="mc-tornado-values">no effect</div>
      </div>
    );
  }
  const range = max - min || 1;
  const barLo = Math.min(low, high);
  const barHi = Math.max(low, high);
  const left = ((barLo - min) / range) * 100;
  const width = Math.max(0.5, ((barHi - barLo) / range) * 100);
  const basePct = ((base - min) / range) * 100;
  const summary = `${label}: base ${format(base)}, low ${format(low)}, high ${format(high)}`;
  return (
    <div className="mc-tornado-row" role="img" aria-label={summary}>
      <div className="mc-tornado-plan">{label}</div>
      <div className="mc-tornado-track">
        <div className="mc-tornado-fill" style={{ left: `${left}%`, width: `${width}%` }} />
        <div className="mc-tornado-base" style={{ left: `${basePct}%` }} />
      </div>
      <div className="mc-tornado-values">
        <span>{format(low)}</span>
        <span className="mc-tornado-base-value">base {format(base)}</span>
        <span>{format(high)}</span>
      </div>
    </div>
  );
}
