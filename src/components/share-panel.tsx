"use client";

import { useEffect, useRef, useState } from "react";
import { EngineError } from "@/engine/errors";
import {
  decodeShare,
  encodeShare,
  exportScenarioJsonString,
  importScenarioJsonString,
  MAX_HASH_BYTES,
} from "@/state/codec";
import { useScenarioStore } from "@/state/store";

type Status =
  | { kind: "idle" }
  | { kind: "ok"; message: string }
  | { kind: "error"; message: string };

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof EngineError) return error.message;
  if (error instanceof Error) return error.message;
  return fallback;
}

export function SharePanel(): React.JSX.Element {
  const scenario = useScenarioStore((state) => state.scenario);
  const replaceScenario = useScenarioStore((state) => state.replaceScenario);
  const setNotes = useScenarioStore((state) => state.setNotes);

  const [shareUrl, setShareUrl] = useState<string>("");
  const [shareStatus, setShareStatus] = useState<Status>({ kind: "idle" });
  const [jsonStatus, setJsonStatus] = useState<Status>({ kind: "idle" });
  const [pastedLink, setPastedLink] = useState<string>("");
  const [pastedStatus, setPastedStatus] = useState<Status>({ kind: "idle" });
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // Any scenario edit invalidates a previously-copied URL — clear it so the user regenerates.
    setShareUrl("");
    setShareStatus({ kind: "idle" });
  }, [scenario]);

  const buildShareUrl = async (): Promise<void> => {
    try {
      const share = await encodeShare(scenario);
      if (share.oversized) {
        setShareStatus({
          kind: "error",
          message: `Share link is ${share.bytes} bytes — exceeds the ${MAX_HASH_BYTES} byte fragment budget. Use JSON export for a full handoff.`,
        });
        return;
      }
      const origin =
        typeof window === "undefined" ? "" : `${window.location.origin}${window.location.pathname}`;
      const url = `${origin}#${share.hash}`;
      setShareUrl(url);
      const base = `${share.bytes} bytes · ${share.compressed ? "deflate-raw" : "uncompressed"} · payload contains scenario only (results always recompute)`;
      if (typeof navigator !== "undefined" && navigator.clipboard) {
        try {
          await navigator.clipboard.writeText(url);
          setShareStatus({ kind: "ok", message: `${base} · copied to clipboard.` });
        } catch {
          setShareStatus({
            kind: "ok",
            message: `${base} · clipboard blocked — select the link and copy manually.`,
          });
        }
      } else {
        setShareStatus({ kind: "ok", message: `${base} · select the link and copy manually.` });
      }
    } catch (error) {
      setShareStatus({
        kind: "error",
        message: errorMessage(error, "Failed to build a share link."),
      });
    }
  };

  const loadPastedLink = async (): Promise<void> => {
    const text = pastedLink.trim();
    if (text.length === 0) {
      setPastedStatus({ kind: "error", message: "Paste a share link first." });
      return;
    }
    try {
      const fragment = text.includes("#") ? text.slice(text.indexOf("#") + 1) : text;
      const decoded = await decodeShare(fragment);
      replaceScenario(decoded);
      setPastedStatus({ kind: "ok", message: "Scenario loaded from link." });
      setPastedLink("");
    } catch (error) {
      setPastedStatus({
        kind: "error",
        message: errorMessage(error, "Could not read that share link."),
      });
    }
  };

  const downloadJson = (): void => {
    try {
      const text = exportScenarioJsonString(scenario);
      const blob = new Blob([text], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "scenario.json";
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      URL.revokeObjectURL(url);
      setJsonStatus({ kind: "ok", message: "Downloaded scenario.json." });
    } catch (error) {
      setJsonStatus({
        kind: "error",
        message: errorMessage(error, "Failed to export the scenario."),
      });
    }
  };

  const importFile = async (file: File): Promise<void> => {
    try {
      const text = await file.text();
      const wire = importScenarioJsonString(text);
      replaceScenario(wire);
      setJsonStatus({ kind: "ok", message: `Imported ${file.name}.` });
    } catch (error) {
      setJsonStatus({
        kind: "error",
        message: errorMessage(error, "Could not read that scenario file."),
      });
    }
  };

  const notesLength = scenario.meta.notes.length;

  return (
    <section className="share-panel" aria-labelledby="share-heading">
      <h2 id="share-heading">Share & export</h2>
      <p className="share-panel-summary">
        Share links carry the scenario only — every result recomputes on load, so seeded MC runs and
        analytic outputs stay honest. The full JSON export is the complete handoff (identity,
        ranges, decision notes, everything).
      </p>
      <div className="share-grid">
        <div className="share-block">
          <h3>Share URL</h3>
          <p>
            Copies a link with the current scenario compressed into the URL fragment. The link is
            regenerated after every edit.
          </p>
          <div className="share-actions">
            <button type="button" className="button-primary" onClick={buildShareUrl}>
              Build share link
            </button>
          </div>
          {shareUrl ? (
            <input
              aria-label="Share URL"
              className="share-link-input"
              readOnly
              value={shareUrl}
              onFocus={(event) => event.currentTarget.select()}
            />
          ) : null}
          {shareStatus.kind !== "idle" ? (
            <p className={`share-status ${shareStatus.kind}`}>{shareStatus.message}</p>
          ) : null}

          <h3 style={{ marginTop: 20 }}>Open a shared link</h3>
          <p>
            Paste a full URL (with the fragment) or just the fragment starting with <code>s=</code>{" "}
            or <code>s0=</code>.
          </p>
          <label className="visually-hidden" htmlFor="share-paste">
            Paste a share link
          </label>
          <input
            id="share-paste"
            className="share-link-input"
            value={pastedLink}
            onChange={(event) => setPastedLink(event.target.value)}
            placeholder="https://…/#s=…"
          />
          <div className="share-actions" style={{ marginTop: 8 }}>
            <button type="button" onClick={loadPastedLink}>
              Load from link
            </button>
          </div>
          {pastedStatus.kind !== "idle" ? (
            <p className={`share-status ${pastedStatus.kind}`}>{pastedStatus.message}</p>
          ) : null}
        </div>

        <div className="share-block">
          <h3>JSON handoff</h3>
          <p>
            Export as JSON for a complete handoff (schemaVersion, ranges, notes, everything). Import
            replaces the current scenario — future schema versions are politely refused.
          </p>
          <div className="share-actions">
            <button type="button" className="button-primary" onClick={downloadJson}>
              Export JSON
            </button>
            <label className="import-file">
              Import JSON
              <input
                ref={fileInput}
                type="file"
                accept="application/json,.json"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void importFile(file);
                  event.target.value = "";
                }}
              />
            </label>
          </div>
          {jsonStatus.kind !== "idle" ? (
            <p className={`share-status ${jsonStatus.kind}`}>{jsonStatus.message}</p>
          ) : null}

          <h3 style={{ marginTop: 20 }}>Decision notes</h3>
          <p>
            Free-text notes travel with the scenario in every export and every share link. Rendered
            on the printable record verbatim.
          </p>
          <label className="visually-hidden" htmlFor="scenario-notes">
            Decision notes
          </label>
          <textarea
            id="scenario-notes"
            className="notes-textarea"
            value={scenario.meta.notes}
            onChange={(event) => setNotes(event.target.value.slice(0, 2000))}
            placeholder="Why this plan? What did you consider and reject? What do you plan to watch for?"
            maxLength={2000}
          />
          <p className="notes-count">{notesLength} / 2000</p>
        </div>
      </div>
    </section>
  );
}
