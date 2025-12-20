"use client";

import { useEffect, useState } from "react";
import { brandName } from "@/brand";
import { loadPersistedScenario } from "@/state/persist";
import { useScenarioStore } from "@/state/store";
import { ThemeToggle } from "./theme-toggle";
import { TemplatePicker } from "./template-picker";
import { ModelSurface } from "./model-surface";
import { DesignSurface } from "./design-surface";
import { SimulateSurface } from "./simulate-surface";
import { AnalyzeSurface } from "./analyze-surface";
import { ErrorBoundary } from "./error-boundary";

const surfaces = ["Model", "Design", "Simulate", "Analyze"] as const;
type Surface = (typeof surfaces)[number];

export function WorkspaceShell(): React.JSX.Element {
  const [active, setActive] = useState<Surface>("Model");
  const hydrate = useScenarioStore((state) => state.hydrate);
  const hydrated = useScenarioStore((state) => state.hydrated);

  useEffect(() => {
    if (!hydrated) hydrate(loadPersistedScenario());
  }, [hydrate, hydrated]);

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
      <ErrorBoundary>
        {active === "Model" ? <ModelSurface /> : null}
        {active === "Design" ? <DesignSurface /> : null}
        {active === "Simulate" ? <SimulateSurface /> : null}
        {active === "Analyze" ? <AnalyzeSurface /> : null}
      </ErrorBoundary>
    </main>
  );
}
