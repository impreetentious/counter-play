"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { brandName } from "@/brand";
import { loadPersistedScenario } from "@/state/persist";
import { decodeShare } from "@/state/codec";
import { useScenarioStore } from "@/state/store";
import { ThemeToggle } from "./theme-toggle";
import { LocalePicker } from "./locale-picker";
import { localeOf, t } from "@/i18n";
import { TemplatePicker } from "./template-picker";
import { ModelSurface } from "./model-surface";

// F-001 — only one surface is mounted at a time and Model is always the one that
// renders first, so Design/Simulate/Analyze were paying for themselves in the
// first-load bundle without ever being on screen at first paint. They carry the
// heaviest dependencies in the app (Monte Carlo, the sweep engine, the chart
// stack), and the first-load gzip ceiling had 1.2 KB of headroom left. Loading
// them on demand is the only lever that reduces first load without a stack change.
//
// `ssr: false` is correct rather than convenient: these are client-only surfaces
// behind a tab that is never active during prerender, so there is no server pass
// to preserve. The visible fallback keeps the tab switch honest instead of
// showing nothing while a chunk arrives.
// The fallback must be the tab panel, not a bare message. Each surface renders
// `<section id="surface-<name>">`, and the tab above it carries
// `aria-controls="surface-<name>"`. If the fallback omitted that id, then for the
// moment the chunk is in flight `aria-controls` would point at nothing — which axe
// reports as a critical `aria-valid-attr-value` failure, and which is a real defect
// for anyone navigating by that relationship, not merely a test artifact.
const surfaceLoading = (name: string, id: string) => (
  <section className="surface" id={id} aria-busy="true">
    <p role="status">Loading the {name} surface…</p>
  </section>
);

const DesignSurface = dynamic(
  () => import("./design-surface").then((module) => module.DesignSurface),
  { ssr: false, loading: () => surfaceLoading("Design", "surface-design") },
);
const SimulateSurface = dynamic(
  () => import("./simulate-surface").then((module) => module.SimulateSurface),
  { ssr: false, loading: () => surfaceLoading("Simulate", "surface-simulate") },
);
const AnalyzeSurface = dynamic(
  () => import("./analyze-surface").then((module) => module.AnalyzeSurface),
  { ssr: false, loading: () => surfaceLoading("Analyze", "surface-analyze") },
);
import { ErrorBoundary } from "./error-boundary";
import { SharePanel } from "./share-panel";

const surfaces = ["Model", "Design", "Simulate", "Analyze"] as const;

export function WorkspaceShell(): React.JSX.Element {
  const [shareLoadNotice, setShareLoadNotice] = useState<string | null>(null);
  const hydrate = useScenarioStore((state) => state.hydrate);
  const hydrated = useScenarioStore((state) => state.hydrated);
  const replaceScenario = useScenarioStore((state) => state.replaceScenario);
  const undo = useScenarioStore((state) => state.undo);
  const redo = useScenarioStore((state) => state.redo);
  const canUndo = useScenarioStore((state) => state.historyPast.length > 0);
  const canRedo = useScenarioStore((state) => state.historyFuture.length > 0);
  const locale = useScenarioStore((state) => localeOf(state.scenario.settings.locale));
  const active = useScenarioStore((state) => state.activeSurface);
  const setActive = useScenarioStore((state) => state.setActiveSurface);

  useEffect(() => {
    if (hydrated) return;
    const fragment =
      typeof window !== "undefined" && window.location.hash.length > 1
        ? window.location.hash.slice(1)
        : "";
    if (fragment.startsWith("s=") || fragment.startsWith("s0=")) {
      // A share link takes precedence over autosave — mark hydrated so autosave doesn't clobber later.
      hydrate(null);
      decodeShare(fragment)
        .then((wire) => {
          replaceScenario(wire);
          setShareLoadNotice("Scenario loaded from share link.");
          window.history.replaceState(null, "", window.location.pathname);
        })
        .catch((error: Error) => {
          setShareLoadNotice(`Could not read share link: ${error.message}`);
        });
      return;
    }
    hydrate(loadPersistedScenario());
  }, [hydrate, hydrated, replaceScenario]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null;
      if (target?.matches("input, textarea, select, [contenteditable='true']")) return;
      if (!(event.metaKey || event.ctrlKey)) return;
      if (event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
      } else if (event.ctrlKey && event.key.toLowerCase() === "y") {
        event.preventDefault();
        redo();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [redo, undo]);

  return (
    <main className="workspace-shell">
      <header className="workspace-header">
        <div>
          <p className="eyebrow">Compensation Design Instrument</p>
          <h1>{brandName}</h1>
        </div>
        <div className="workspace-tools">
          <div className="history-controls" role="group" aria-label="Scenario history">
            <button
              type="button"
              onClick={undo}
              disabled={!canUndo}
              aria-label={`${t(locale, "history.undo")} (Control Z)`}
            >
              {t(locale, "history.undo")}
            </button>
            <button
              type="button"
              onClick={redo}
              disabled={!canRedo}
              aria-label={`${t(locale, "history.redo")} (Control Shift Z)`}
            >
              {t(locale, "history.redo")}
            </button>
          </div>
          <LocalePicker />
          <ThemeToggle />
        </div>
      </header>
      <p className="workspace-intro">
        Model the incentives before the plan reaches the field. Every keystroke updates the payout
        preview and the engine runs exactly against your assumptions.
      </p>
      <TemplatePicker />
      <nav aria-label="Workspace surfaces">
        <div role="tablist" aria-label="Workspace surfaces" className="surface-tabs">
          {surfaces.map((surface, index) => (
            <button
              key={surface}
              type="button"
              role="tab"
              aria-selected={active === surface}
              aria-controls={`surface-${surface.toLowerCase()}`}
              id={`tab-${surface.toLowerCase()}`}
              className={active === surface ? "surface-tab active" : "surface-tab"}
              onClick={() => setActive(surface)}
            >
              <span className="tab-index">0{index + 1}</span>
              {surface}
            </button>
          ))}
        </div>
      </nav>
      {shareLoadNotice ? (
        <p className="share-status ok" role="status">
          {shareLoadNotice}
        </p>
      ) : null}
      <ErrorBoundary>
        {active === "Model" ? <ModelSurface /> : null}
        {active === "Design" ? <DesignSurface /> : null}
        {active === "Simulate" ? <SimulateSurface /> : null}
        {active === "Analyze" ? <AnalyzeSurface /> : null}
      </ErrorBoundary>
      <SharePanel />
      <p className="record-footer" style={{ marginTop: 24 }}>
        <Link href="/record">Open printable design record →</Link>
        {" · "}
        <Link href="/casebook">Read the casebook: five published findings, runnable →</Link>
      </p>
    </main>
  );
}
