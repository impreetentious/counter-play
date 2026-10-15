"use client";

import { useState } from "react";
import { selectTemplates, useScenarioStore } from "@/state/store";
import type { TemplateEntry } from "@/state/templates";

export function TemplatePicker(): React.JSX.Element {
  const applyTemplate = useScenarioStore((state) => state.applyTemplate);
  const recoveryBytes = useScenarioStore((state) => state.recoveryBytes);
  const scenario = useScenarioStore((state) => state.scenario);
  const [pending, setPending] = useState<TemplateEntry | null>(null);
  const templates = selectTemplates();

  function handleApply(template: TemplateEntry): void {
    if (scenario.plans.length > 1 || scenario.population.length > 1) {
      setPending(template);
      return;
    }
    applyTemplate(template);
  }

  return (
    <section className="template-picker" aria-labelledby="template-heading">
      <div className="template-picker-heading">
        <p className="eyebrow">Templates</p>
        <h2 id="template-heading">Start from a designed scenario</h2>
      </div>
      <p className="template-summary">
        Every template exercises the plan primitives and is safe to edit end-to-end.
      </p>
      <ul className="template-list" role="list">
        {templates.map((template) => (
          <li key={template.id}>
            <button type="button" className="template-card" onClick={() => handleApply(template)}>
              <span className="template-name">{template.name}</span>
              <span className="template-summary-text">{template.summary}</span>
            </button>
          </li>
        ))}
      </ul>
      {pending ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="template-confirm-title"
          className="template-dialog"
        >
          <div className="template-dialog-body">
            <h3 id="template-confirm-title">Replace current scenario?</h3>
            <p>
              Loading {pending.name} will replace the current segments and plans.{" "}
              {recoveryBytes !== null
                ? "Saved recovery data remains untouched until you explicitly replace the saved workspace."
                : "Autosave will overwrite the stored scenario."}
            </p>
            <div className="template-dialog-actions">
              <button type="button" onClick={() => setPending(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="button-primary"
                onClick={() => {
                  applyTemplate(pending);
                  setPending(null);
                }}
              >
                Replace
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
