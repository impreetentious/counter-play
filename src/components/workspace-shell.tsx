"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { brandName } from "@/brand";
import { loadPersistedScenario } from "@/state/persist";
import { decodeShare } from "@/state/codec";
import { useScenarioStore } from "@/state/store";
import { ThemeToggle } from "./theme-toggle";
import { TemplatePicker } from "./template-picker";
import { ModelSurface } from "./model-surface";
import { DesignSurface } from "./design-surface";
import { SimulateSurface } from "./simulate-surface";
import { AnalyzeSurface } from "./analyze-surface";
import { ErrorBoundary } from "./error-boundary";
import { SharePanel } from "./share-panel";

const surfaces = ["Model", "Design", "Simulate", "Analyze"] as const;
type Surface = (typeof surfaces)[number];

export function WorkspaceShell(): React.JSX.Element {
  const [active, setActive] = useState<Surface>("Model");
  const [shareLoadNotice, setShareLoadNotice] = useState<string | null>(null);
  const hydrate = useScenarioStore((state) => state.hydrate);
  const hydrated = useScenarioStore((state) => state.hydrated);
  const replaceScenario = useScenarioStore((state) => state.replaceScenario);

  useEffect(() => {
    if (hydrated) return;
    const fragment = typeof window !== "undefined" && window.location.hash.length > 1 ? window.location.hash.slice(1) : "";
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

  return (
    <main className="workspace-shell">
      <header className="workspace-header">
        <div>
          <p className="eyebrow">Compensation Design Instrument</p>
          <h1>{brandName}</h1>
        </div>
        <ThemeToggle />
      </header>
      <p className="workspace-intro">
        Model the incentives before the plan reaches the field. Every keystroke updates the payout preview and the engine
        runs exactly against your assumptions.
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
      {shareLoadNotice ? <p className="share-status ok" role="status">{shareLoadNotice}</p> : null}
      <ErrorBoundary>
        {active === "Model" ? <ModelSurface /> : null}
        {active === "Design" ? <DesignSurface /> : null}
        {active === "Simulate" ? <SimulateSurface /> : null}
        {active === "Analyze" ? <AnalyzeSurface /> : null}
      </ErrorBoundary>
      <SharePanel />
      <p className="record-footer" style={{ marginTop: 24 }}>
        <Link href="/record">Open printable design record →</Link>
      </p>
    </main>
  );
}
