"use client";

import { useMemo } from "react";
import { computeTeam } from "@/engine/team";
import { formatCompactCurrency, formatNumber, formatPercent, localeOf } from "@/i18n";
import { useScenarioStore } from "@/state/store";

/** §3.14 V-05: the equilibrium response class, reported beside the independent best response. */
export function TeamPanel(): React.JSX.Element {
  const scenario = useScenarioStore((state) => state.scenario);
  const domain = useScenarioStore((state) => state.domain);
  const toggleTeam = useScenarioStore((state) => state.toggleTeam);
  const setTeamMode = useScenarioStore((state) => state.setTeamMode);
  const setTeamSize = useScenarioStore((state) => state.setTeamSize);
  const setCreditShare = useScenarioStore((state) => state.setCreditShare);
  const setTournamentField = useScenarioStore((state) => state.setTournamentField);
  const highlight = useScenarioStore((state) => state.highlight);

  const currency = scenario.settings.currencyLabel;
  const locale = localeOf(scenario.settings.locale);
  const wire = scenario.settings.team ?? null;
  const team = useMemo(() => (domain ? computeTeam(domain) : null), [domain]);

  return (
    <section
      className={
        highlight?.chart === "team-table" ? "boundary-panel deep-link-highlight" : "boundary-panel"
      }
      aria-labelledby="team-heading"
      data-testid={highlight?.chart === "team-table" ? "deep-link-highlight" : undefined}
    >
      <header className="boundary-header">
        <div>
          <p className="eyebrow">Team</p>
          <h3 id="team-heading">Split credit and tournaments</h3>
        </div>
        <p className="boundary-description">
          This is the one place reps play against each other rather than against the plan. Pooled
          credit leaves each rep only <code>φ = 1 − s(n − 1)/n</code> of their own marginal output,
          which is the free-riding problem exactly; a rank-order prize pushes the other way. These
          equilibrium numbers sit <strong>beside</strong> the KPIs on Simulate — they never replace
          them, because the two answer different questions.
        </p>
        <div className="boundary-controls">
          <button
            type="button"
            className="button-primary"
            aria-pressed={Boolean(wire)}
            onClick={toggleTeam}
          >
            {wire ? "Turn off team play" : "Model team play"}
          </button>
        </div>
      </header>

      {wire ? (
        <div className="boundary-controls">
          <div role="group" aria-label="Team mode" className="mode-toggle">
            <button
              type="button"
              aria-pressed={wire.mode === "split"}
              onClick={() => setTeamMode("split")}
            >
              Split credit
            </button>
            <button
              type="button"
              aria-pressed={wire.mode === "tournament"}
              onClick={() => setTeamMode("tournament")}
            >
              Tournament
            </button>
          </div>
          <label className="mc-numeric">
            <span>Group size n</span>
            <input
              type="number"
              min={2}
              max={50}
              value={wire.size}
              onChange={(event) => setTeamSize(Number(event.target.value))}
            />
          </label>
          {wire.mode === "split" ? (
            <label className="mc-numeric">
              <span>Pooled credit s</span>
              <input
                inputMode="decimal"
                value={wire.split?.creditShare ?? ""}
                onChange={(event) => setCreditShare(event.target.value)}
              />
            </label>
          ) : (
            <>
              <label className="mc-numeric">
                <span>Prize P ({currency})</span>
                <input
                  inputMode="decimal"
                  value={wire.tournament?.prize ?? ""}
                  onChange={(event) => setTournamentField("prize", event.target.value)}
                />
              </label>
              <label className="mc-numeric">
                <span>Winners w</span>
                <input
                  type="number"
                  min={1}
                  max={Math.max(1, wire.size - 1)}
                  value={wire.tournament?.winners ?? 1}
                  onChange={(event) => setTournamentField("winners", event.target.value)}
                />
              </label>
            </>
          )}
        </div>
      ) : null}

      {wire && scenario.settings.mode === "stochastic" && wire.mode === "split" ? (
        <p className="field-note">
          Split-credit equilibrium is deterministic-exact; stochastic CARA response does not change
          the calculation shown here.
        </p>
      ) : null}
      {wire && wire.mode === "tournament" ? (
        <p className="field-note">
          The tournament objective is risk-neutral, so risk aversion is ignored in this result.
        </p>
      ) : null}
      {wire && scenario.settings.rationality?.mode === "softmax" ? (
        <p className="field-note">
          The bounded-rationality dial does not reach the team equilibrium calculation.
        </p>
      ) : null}

      {wire && team
        ? team.plans.map((plan) => (
            <div key={plan.planId} className="boundary-plan">
              <header>
                <h4>{plan.planLabel}</h4>
                <p className="boundary-plan-summary">
                  Independent{" "}
                  <strong>
                    {formatCompactCurrency(plan.individualRevenue.toNumber(), currency, locale)}
                  </strong>{" "}
                  · equilibrium{" "}
                  <strong>
                    {formatCompactCurrency(plan.equilibriumRevenue.toNumber(), currency, locale)}
                  </strong>{" "}
                  · gap{" "}
                  <strong>
                    {formatCompactCurrency(plan.revenueGap.toNumber(), currency, locale)}
                  </strong>
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
                    <tr
                      key={entry.segmentId}
                      className={
                        highlight?.chart === "team-table" &&
                        highlight.highlight.segment === entry.segmentId
                          ? "deep-link-highlight"
                          : undefined
                      }
                    >
                      <td>{entry.segmentLabel}</td>
                      <td>
                        {entry.creditWeight === null
                          ? "—"
                          : formatPercent(entry.creditWeight, locale)}
                      </td>
                      <td>{formatNumber(entry.individualEffort, locale)}</td>
                      <td>
                        {entry.unavailable ? "—" : formatNumber(entry.equilibriumEffort, locale)}
                        {!entry.unavailable && !entry.converged ? " (not converged)" : ""}
                      </td>
                      <td>{formatCompactCurrency(entry.individualRevenue, currency, locale)}</td>
                      <td>
                        {entry.unavailable
                          ? "—"
                          : formatCompactCurrency(entry.equilibriumRevenue, currency, locale)}
                      </td>
                      <td>
                        {entry.unavailable ? "—" : formatNumber(entry.equilibriaCount, locale, 0)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {plan.perSegment
                .filter((entry) => entry.unavailable)
                .map((entry) => (
                  <p className="field-note" key={`${entry.segmentId}-note`}>
                    {entry.segmentLabel}: {entry.unavailable}
                  </p>
                ))}
              {plan.perSegment.some((entry) => entry.equilibriaCount > 1) ? (
                <p className="field-note">
                  More than one symmetric equilibrium exists here — everyone clears the cliff
                  together, or nobody does. The table reports the one the group would prefer; the
                  other is equally stable.
                </p>
              ) : null}
            </div>
          ))
        : null}
    </section>
  );
}
