"use client";

import { useRef, useState } from "react";
import { calibrateHistoricalCsv, type CalibrationResult } from "@/state/calibration";
import { formatNumber } from "@/i18n";
import { useScenarioStore } from "@/state/store";

export function CalibrationPanel(): React.JSX.Element {
  const input = useRef<HTMLInputElement>(null);
  const domain = useScenarioStore((state) => state.domain);
  const activePlanId = useScenarioStore((state) => state.activePlanId);
  const locale = useScenarioStore((state) => state.scenario.settings.locale);
  const applyCalibration = useScenarioStore((state) => state.applyCalibration);
  const [result, setResult] = useState<CalibrationResult | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const importFile = async (file: File): Promise<void> => {
    if (!domain) return;
    try {
      const next = calibrateHistoricalCsv(await file.text(), domain, activePlanId);
      setResult(next);
      setMessage(
        `${next.rowsRead} local historical row${next.rowsRead === 1 ? "" : "s"} read. Nothing has been applied yet.`,
      );
    } catch (error) {
      setResult(null);
      setMessage(
        error instanceof Error ? error.message : "Could not parse this local calibration file.",
      );
    }
  };

  return (
    <section className="calibration-panel" aria-labelledby="calibration-heading">
      <header className="optimizer-header">
        <div>
          <p className="eyebrow">Local calibration</p>
          <h3 id="calibration-heading">Compare assumptions with historical attainment</h3>
        </div>
        <label className="import-file">
          Import attainment CSV
          <input
            ref={input}
            type="file"
            accept="text/csv,.csv"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void importFile(file);
              event.target.value = "";
            }}
          />
        </label>
      </header>
      <p className="optimizer-description">
        File-only and client-side. Required columns: <code>segment</code> plus{" "}
        <code>attainment</code>, or <code>revenue</code> and <code>quota</code>. The file is not
        persisted or uploaded; this proposes assumptions, not payroll or a causal fit.
      </p>
      {message ? (
        <p className="share-status ok" role="status">
          {message}
        </p>
      ) : null}
      {result ? (
        <>
          <div className="calibration-table-wrap">
            <table className="response-table">
              <caption>Historical descriptors and proposed assumption changes</caption>
              <thead>
                <tr>
                  <th>Segment</th>
                  <th>Rows</th>
                  <th>Mean attainment</th>
                  <th>Attainment spread</th>
                  <th>Proposed ability</th>
                  <th>Proposed noise σ</th>
                </tr>
              </thead>
              <tbody>
                {result.proposals.map((proposal) => (
                  <tr key={proposal.segmentId}>
                    <td>{proposal.segmentLabel}</td>
                    <td>{proposal.observations}</td>
                    <td>{formatNumber(proposal.meanAttainment, locale)}</td>
                    <td>{formatNumber(proposal.attainmentSD, locale)}</td>
                    <td>{proposal.ability ?? "—"}</td>
                    <td>{proposal.noiseSD ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {result.proposals.some((proposal) => proposal.unavailable) ? (
            <p className="field-note">
              {result.proposals.find((proposal) => proposal.unavailable)?.unavailable}
            </p>
          ) : null}
          <button
            type="button"
            onClick={() => {
              applyCalibration(result.proposals);
              setMessage(
                "Applied the usable ability and noise proposals. Re-run every reading; calibration does not validate a plan for you.",
              );
              setResult(null);
            }}
          >
            Apply usable proposals
          </button>
        </>
      ) : null}
    </section>
  );
}
