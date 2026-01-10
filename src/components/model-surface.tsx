"use client";

import { useScenarioStore, findIssuesForPath } from "@/state/store";
import type { SegmentJson } from "@/state/schema";

const explainers: Record<keyof SegmentJson, string> = {
  secondTask: "The optional quality task shares the rep's effort budget with revenue work.",
  id: "Stable identifier used by charts and share links.",
  label: "Short display name — appears in tables and the design record.",
  count: "How many reps this segment represents; drives every aggregate.",
  ability: "Peak revenue this segment can produce at maximum effort.",
  costK: "Effort cost coefficient — higher means work is more expensive per unit.",
  riskAversion: "CARA risk aversion ρ; larger values discount volatile pay.",
  noiseSD: "Standard deviation of revenue noise around the effort choice.",
  reservationCE: "The certainty-equivalent below which reps quit.",
  quotaMult: "Segment-specific multiplier on the plan quota (Q · m_s).",
  valueQuality: "Weight relating revenue to true business value (γ).",
  movable: "Fraction of pipeline this segment can shift across the period boundary.",
};

const numericFields: Array<keyof SegmentJson> = ["count", "ability", "costK", "riskAversion", "noiseSD", "reservationCE", "quotaMult", "valueQuality", "movable"];

/** §3.3a V-02: the population's response class — exact best response, or a bounded softmax draw. */
function RationalityDial(): React.JSX.Element {
  const rationality = useScenarioStore((state) => state.scenario.settings.rationality);
  const currency = useScenarioStore((state) => state.scenario.settings.currencyLabel);
  const issuesList = useScenarioStore((state) => state.issues);
  const setRationalityMode = useScenarioStore((state) => state.setRationalityMode);
  const setRationalityTau = useScenarioStore((state) => state.setRationalityTau);
  const mode = rationality?.mode ?? "exact";
  const tauIssues = findIssuesForPath({ issues: issuesList }, "settings.rationality.tau");

  return (
    <fieldset className="rationality-block">
      <legend>Rep rationality</legend>
      <p className="field-note">
        Exact assumes every rep finds the plan&rsquo;s optimal effort. Bounded assumes they choose among the plan&rsquo;s salient
        plays — zero effort, each tier&rsquo;s own optimum, each threshold — with noise, so the modeled response is deliberately
        <strong> not the exact optimum</strong>. Boundary gaming stays on the exact response; every other surface follows this dial.
      </p>
      <div role="group" aria-label="Response class" className="mode-toggle">
        <button type="button" aria-pressed={mode === "exact"} onClick={() => setRationalityMode("exact")}>Exact best response</button>
        <button type="button" aria-pressed={mode === "softmax"} onClick={() => setRationalityMode("softmax")}>Bounded (softmax)</button>
      </div>
      {mode === "softmax" ? (
        <div className="rationality-tau">
          <label htmlFor="rationality-tau">Temperature τ ({currency})</label>
          <input
            id="rationality-tau"
            inputMode="decimal"
            value={rationality?.tau ?? ""}
            aria-invalid={tauIssues.length > 0 || undefined}
            aria-describedby="rationality-tau-help"
            onChange={(event) => setRationalityTau(event.target.value)}
          />
          <span id="rationality-tau-help" className="field-note">
            Certainty-equivalent differences far below τ are invisible to the rep; differences far above it are decisive.
          </span>
        </div>
      ) : null}
      {tauIssues.length > 0 ? <p role="alert" className="surface-error">{tauIssues[0]?.message}</p> : null}
    </fieldset>
  );
}

export function ModelSurface(): React.JSX.Element {
  const scenario = useScenarioStore((state) => state.scenario);
  const domain = useScenarioStore((state) => state.domain);
  const issuesList = useScenarioStore((state) => state.issues);
  const domainError = useScenarioStore((state) => state.domainError);
  const setSegmentField = useScenarioStore((state) => state.setSegmentField);
  const addSegment = useScenarioStore((state) => state.addSegment);
  const duplicateSegment = useScenarioStore((state) => state.duplicateSegment);
  const deleteSegment = useScenarioStore((state) => state.deleteSegment);

  const totalHeadcount = domain ? domain.population.reduce((sum, segment) => sum + segment.count, 0) : scenario.population.reduce((sum, segment) => sum + segment.count, 0);

  return (
    <section className="surface" id="surface-model" aria-labelledby="model-heading">
      <header className="surface-heading">
        <div>
          <p className="eyebrow">Model</p>
          <h2 id="model-heading">Rep population assumptions</h2>
        </div>
        <div className="surface-heading-actions">
          <button type="button" className="button-primary" onClick={addSegment} disabled={scenario.population.length >= 10}>Add segment</button>
        </div>
      </header>
      <p className="surface-summary">
        Every segment aggregates one or more reps sharing an ability, effort cost, and risk profile. The engine reads these
        values exactly; keep numbers as decimals ({"e.g. 0.085"}) so the payout calculation stays lossless.
      </p>
      <div className="population-summary" aria-live="polite">
        <span>{scenario.population.length} segment{scenario.population.length === 1 ? "" : "s"}</span>
        <span>{totalHeadcount} rep{totalHeadcount === 1 ? "" : "s"} total</span>
      </div>
      {domainError ? <p role="alert" className="surface-error">{domainError}</p> : null}
      <div className="segment-table-wrapper">
        <table className="segment-table">
          <thead>
            <tr>
              <th scope="col">Segment</th>
              <th scope="col">Count</th>
              <th scope="col">Ability</th>
              <th scope="col">Cost k</th>
              <th scope="col">Risk ρ</th>
              <th scope="col">Noise σ</th>
              <th scope="col">Reservation Ū</th>
              <th scope="col">Quota mult m</th>
              <th scope="col">Value γ</th>
              <th scope="col">Movable</th>
              <th scope="col" aria-label="Row actions" />
            </tr>
          </thead>
          <tbody>
            {scenario.population.map((segment, index) => {
              const path = `population.${index}`;
              const rowIssues = findIssuesForPath({ issues: issuesList }, path);
              return (
                <tr key={segment.id}>
                  <td>
                    <label className="sr-only" htmlFor={`segment-${segment.id}-label`}>Label for {segment.label}</label>
                    <input id={`segment-${segment.id}-label`} value={segment.label} onChange={(event) => setSegmentField(segment.id, "label", event.target.value)} />
                  </td>
                  {numericFields.map((field) => (
                    <td key={field}>
                      <label className="sr-only" htmlFor={`segment-${segment.id}-${field}`}>{explainers[field]}</label>
                      <input
                        id={`segment-${segment.id}-${field}`}
                        inputMode="decimal"
                        value={String(segment[field])}
                        aria-invalid={rowIssues.some((issue) => issue.path === `${path}.${field}`) || undefined}
                        title={explainers[field]}
                        onChange={(event) => setSegmentField(segment.id, field, field === "count" ? (Number(event.target.value) as SegmentJson[typeof field]) : (event.target.value as SegmentJson[typeof field]))}
                      />
                    </td>
                  ))}
                  <td>
                    <div className="row-actions">
                      <button type="button" onClick={() => duplicateSegment(segment.id)} aria-label={`Duplicate ${segment.label}`}>Duplicate</button>
                      <button type="button" onClick={() => deleteSegment(segment.id)} aria-label={`Delete ${segment.label}`} disabled={scenario.population.length <= 1}>Delete</button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <RationalityDial />
      {issuesList.length > 0 ? (
        <ul className="issue-list" role="list">
          {issuesList.filter((issue) => issue.path.startsWith("population")).slice(0, 6).map((issue) => (
            <li key={`${issue.path}-${issue.message}`}>{issue.path}: {issue.message}</li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
