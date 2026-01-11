"use client";

import { useMemo } from "react";
import { computeTeam } from "@/engine/team";
import { useScenarioStore } from "@/state/store";

function formatCurrency(value: number, currency: string): string {
  if (!Number.isFinite(value)) return "—";
  const size = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  if (size >= 1e6) return `${sign}${currency}${(size / 1e6).toFixed(2)}M`;
  if (size >= 1e3) return `${sign}${currency}${(size / 1e3).toFixed(1)}K`;
  return `${sign}${currency}${size.toFixed(2)}`;
}

function formatPercent(fraction: number | null): string {
  return fraction === null || !Number.isFinite(fraction) ? "—" : `${(fraction * 100).toFixed(1)}%`;
}

/** §3.14 V-05: the equilibrium response class, reported beside the independent best response. */
export function TeamPanel(): React.JSX.Element {
  const scenario = useScenarioStore((state) => state.scenario);
  const domain = useScenarioStore((state) => state.domain);
  const toggleTeam = useScenarioStore((state) => state.toggleTeam);
  const setTeamMode = useScenarioStore((state) => state.setTeamMode);
  const setTeamSize = useScenarioStore((state) => state.setTeamSize);
  const setCreditShare = useScenarioStore((state) => state.setCreditShare);
  const setTournamentField = useScenarioStore((state) => state.setTournamentField);

  const currency = scenario.settings.currencyLabel;
  const wire = scenario.settings.team ?? null;
  const team = useMemo(() => (domain ? computeTeam(domain) : null), [domain]);

  return (
    <section className="boundary-panel" aria-labelledby="team-heading">
      <header className="boundary-header">
        <div>
          <p className="eyebrow">Team</p>
          <h3 id="team-heading">Split credit and tournaments</h3>
        </div>
        <p className="boundary-description">
          This is the one place reps play against each other rather than against the plan. Pooled credit leaves each rep
          only <code>φ = 1 − s(n − 1)/n</code> of their own marginal output, which is the free-riding problem exactly; a
          rank-order prize pushes the other way. These equilibrium numbers sit <strong>beside</strong> the KPIs on
          Simulate — they never replace them, because the two answer different questions.
        </p>
        <div className="boundary-controls">
          <button type="button" className="button-primary" aria-pressed={Boolean(wire)} onClick={toggleTeam}>
            {wire ? "Turn off team play" : "Model team play"}
          </button>
        </div>
      </header>

      {wire ? (
        <div className="boundary-controls">
          <div role="group" aria-label="Team mode" className="mode-toggle">
            <button type="button" aria-pressed={wire.mode === "split"} onClick={() => setTeamMode("split")}>Split credit</button>
            <button type="button" aria-pressed={wire.mode === "tournament"} onClick={() => setTeamMode("tournament")}>Tournament</button>
          </div>
          <label className="mc-numeric">
            <span>Group size n</span>
            <input type="number" min={2} max={50} value={wire.size} onChange={(event) => setTeamSize(Number(event.target.value))} />
          </label>
          {wire.mode === "split" ? (
            <label className="mc-numeric">
              <span>Pooled credit s</span>
              <input inputMode="decimal" value={wire.split?.creditShare ?? ""} onChange={(event) => setCreditShare(event.target.value)} />
            </label>
          ) : (
            <>
              <label className="mc-numeric">
                <span>Prize P ({currency})</span>
                <input inputMode="decimal" value={wire.tournament?.prize ?? ""} onChange={(event) => setTournamentField("prize", event.target.value)} />
              </label>
              <label className="mc-numeric">
                <span>Winners w</span>
                <input type="number" min={1} max={Math.max(1, wire.size - 1)} value={wire.tournament?.winners ?? 1} onChange={(event) => setTournamentField("winners", event.target.value)} />
              </label>
            </>
          )}
        </div>
      ) : null}

      {wire && team
        ? team.plans.map((plan) => (
          <div key={plan.planId} className="boundary-plan">
            <header>
              <h4>{plan.planLabel}</h4>
              <p className="boundary-plan-summary">
                Independent <strong>{formatCurrency(plan.individualRevenue.toNumber(), currency)}</strong>
                {" "}· equilibrium <strong>{formatCurrency(plan.equilibriumRevenue.toNumber(), currency)}</strong>
                {" "}· gap <strong>{formatCurrency(plan.revenueGap.toNumber(), currency)}</strong>
              </p>
            </header>
            <table className="boundary-table">
              <caption>Per-segment equilibrium against the independent best response</caption>
              <thead>
                <tr>
                  <th>Segment</th>
                  <th>φ</th>
                  <th>Individual effort</th>
                  <th>Equilibrium effort</th>
                  <th>Individual revenue</th>
                  <th>Equilibrium revenue</th>
                  <th>Equilibria</th>
                </tr>
              </thead>
              <tbody>
                {plan.perSegment.map((entry) => (
                  <tr key={entry.segmentId}>
                    <td>{entry.segmentLabel}</td>
                    <td>{formatPercent(entry.creditWeight)}</td>
                    <td>{entry.individualEffort.toFixed(3)}</td>
                    <td>
                      {entry.unavailable ? "—" : entry.equilibriumEffort.toFixed(3)}
                      {!entry.unavailable && !entry.converged ? " (not converged)" : ""}
                    </td>
                    <td>{formatCurrency(entry.individualRevenue, currency)}</td>
                    <td>{entry.unavailable ? "—" : formatCurrency(entry.equilibriumRevenue, currency)}</td>
                    <td>{entry.unavailable ? "—" : entry.equilibriaCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {plan.perSegment.filter((entry) => entry.unavailable).map((entry) => (
              <p className="field-note" key={`${entry.segmentId}-note`}>{entry.segmentLabel}: {entry.unavailable}</p>
            ))}
            {plan.perSegment.some((entry) => entry.equilibriaCount > 1) ? (
              <p className="field-note">
                More than one symmetric equilibrium exists here — everyone clears the cliff together, or nobody does. The
                table reports the one the group would prefer; the other is equally stable.
              </p>
            ) : null}
          </div>
        ))
        : null}
    </section>
  );
}
