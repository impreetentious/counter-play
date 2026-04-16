"use client";

import Link from "next/link";
import { useState } from "react";
import { brandName } from "@/brand";
import { casebook, type CasebookEntry } from "@/state/casebook";
import { useScenarioStore } from "@/state/store";

const ruleNames: Record<string, string> = {
  "L-1": "dead zone",
  "L-2": "cliff dependence",
  "L-3": "cap quit point",
  "L-4": "retention risk",
  "L-5": "Goodhart wedge",
  "L-6": "pay inversion",
  "L-7": "boundary gaming",
  "L-8": "ratchet suppression",
  "L-9": "team free-riding",
  "L-10": "menu screening",
};

export function CasebookView(): React.JSX.Element {
  const replaceScenario = useScenarioStore((state) => state.replaceScenario);
  const [loaded, setLoaded] = useState<string | null>(null);

  const load = (entry: CasebookEntry): void => {
    replaceScenario(entry.scenario);
    setLoaded(entry.id);
  };

  return (
    <main className="casebook">
      <header className="casebook-header">
        <p className="eyebrow">Casebook</p>
        <h1>Findings you can run</h1>
        <p className="casebook-intro">
          {brandName} cites a literature. These five episodes are that citation made executable:
          each is a published finding written down as a population and a plan, loaded into the
          workspace in one click, and checked by the test suite against the rules it is supposed to
          trigger. They are stylised encodings, not replications — the claim is that the mechanism
          reproduces, not that the coefficients match.
        </p>
        <p className="casebook-intro">
          <Link href="/">Back to the workspace</Link>
        </p>
      </header>

      <ol className="casebook-list">
        {casebook.map((entry) => (
          <li key={entry.id} className="casebook-entry" id={entry.id}>
            <header>
              <h2>{entry.title}</h2>
              <p className="casebook-citation">{entry.citation}</p>
            </header>
            <div className="casebook-body">
              <section>
                <h3>The finding</h3>
                <p>{entry.finding}</p>
              </section>
              <section>
                <h3>The encoding</h3>
                <p>{entry.encoding}</p>
                <p className="casebook-rules">
                  {entry.expects.length === 0
                    ? "No linter rule fires on this scenario — which is the point of this one."
                    : `Fires: ${entry.expects.map((rule) => `${rule} (${ruleNames[rule] ?? rule})`).join(", ")}.`}
                </p>
              </section>
              <section>
                <h3>Try this</h3>
                <p>{entry.tryThis}</p>
              </section>
            </div>
            <footer className="casebook-actions">
              <button type="button" className="button-primary" onClick={() => load(entry)}>
                Load into the workspace
              </button>
              {loaded === entry.id ? (
                <span role="status" className="casebook-loaded">
                  Loaded. <Link href="/">Open the workspace</Link> — it replaced whatever was there,
                  and undo will bring it back.
                </span>
              ) : null}
            </footer>
          </li>
        ))}
      </ol>
    </main>
  );
}
