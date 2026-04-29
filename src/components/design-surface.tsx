"use client";

import { useScenarioStore, findIssuesForPath } from "@/state/store";
import { PayoutChart } from "./payout-chart";

export function DesignSurface(): React.JSX.Element {
  const scenario = useScenarioStore((state) => state.scenario);
  const domain = useScenarioStore((state) => state.domain);
  const domainError = useScenarioStore((state) => state.domainError);
  const issuesList = useScenarioStore((state) => state.issues);
  const activePlanId = useScenarioStore((state) => state.activePlanId);
  const setActivePlanId = useScenarioStore((state) => state.setActivePlanId);
  const setPlanField = useScenarioStore((state) => state.setPlanField);
  const setTierField = useScenarioStore((state) => state.setTierField);
  const addTier = useScenarioStore((state) => state.addTier);
  const deleteTier = useScenarioStore((state) => state.deleteTier);
  const toggleBonus = useScenarioStore((state) => state.toggleBonus);
  const setBonusField = useScenarioStore((state) => state.setBonusField);
  const toggleCap = useScenarioStore((state) => state.toggleCap);
  const setCap = useScenarioStore((state) => state.setCap);
  const toggleExtra = useScenarioStore((state) => state.toggleExtra);
  const setExtraScalar = useScenarioStore((state) => state.setExtraScalar);
  const setExtraLump = useScenarioStore((state) => state.setExtraLump);
  const addPlan = useScenarioStore((state) => state.addPlan);
  const duplicatePlan = useScenarioStore((state) => state.duplicatePlan);
  const deletePlan = useScenarioStore((state) => state.deletePlan);
  const highlight = useScenarioStore((state) => state.highlight);

  const activePlan = scenario.plans.find((plan) => plan.id === activePlanId) ?? scenario.plans[0];
  const domainPlan = domain?.plans.find((plan) => plan.id === activePlan?.id);
  if (!activePlan) {
    return (
      <section className="surface" id="surface-design" aria-labelledby="design-heading">
        <p className="eyebrow">Design</p>
        <h2 id="design-heading">No plans configured</h2>
        <p className="surface-summary">
          A scenario needs at least one plan. Load a template above, or import a JSON export that
          includes a plan.
        </p>
      </section>
    );
  }

  const planIndex = scenario.plans.findIndex((plan) => plan.id === activePlan.id);
  const planPath = `plans.${planIndex}`;
  const planIssues = findIssuesForPath({ issues: issuesList }, planPath);

  return (
    <section className="surface" id="surface-design" aria-labelledby="design-heading">
      <header className="surface-heading">
        <div>
          <p className="eyebrow">Design</p>
          <h2 id="design-heading">Plan structure and payout preview</h2>
        </div>
        <div className="surface-heading-actions">
          <button
            type="button"
            className="button-primary"
            onClick={addPlan}
            disabled={scenario.plans.length >= 3}
          >
            Add plan
          </button>
          <button
            type="button"
            onClick={() => duplicatePlan(activePlan.id)}
            disabled={scenario.plans.length >= 3}
          >
            Duplicate plan
          </button>
          <button
            type="button"
            onClick={() => deletePlan(activePlan.id)}
            disabled={scenario.plans.length <= 1}
          >
            Delete plan
          </button>
        </div>
      </header>
      <p className="surface-summary">
        Shape base, quota, tiered commission rates, bonus, and cap. The preview curve updates every
        keystroke — kink markers sit at every tier edge, the bonus threshold, and the cap.
      </p>
      <div role="tablist" aria-label="Plans" className="plan-tabs">
        {scenario.plans.map((plan) => (
          <button
            key={plan.id}
            type="button"
            role="tab"
            id={`plan-tab-${plan.id}`}
            aria-selected={plan.id === activePlan.id}
            aria-controls={`plan-panel-${plan.id}`}
            className={plan.id === activePlan.id ? "plan-tab active" : "plan-tab"}
            onClick={() => setActivePlanId(plan.id)}
          >
            {plan.label}
          </button>
        ))}
      </div>
      <div
        id={`plan-panel-${activePlan.id}`}
        role="tabpanel"
        aria-labelledby={`plan-tab-${activePlan.id}`}
        className="plan-panel"
      >
        {domainError ? (
          <p role="alert" className="surface-error">
            {domainError}
          </p>
        ) : null}
        <div className="plan-grid">
          <div>
            <label htmlFor={`plan-${activePlan.id}-label`}>Plan label</label>
            <input
              id={`plan-${activePlan.id}-label`}
              value={activePlan.label}
              onChange={(event) => setPlanField(activePlan.id, "label", event.target.value)}
            />
          </div>
          <div>
            <label htmlFor={`plan-${activePlan.id}-base`}>Base salary</label>
            <input
              id={`plan-${activePlan.id}-base`}
              inputMode="decimal"
              value={activePlan.base}
              onChange={(event) => setPlanField(activePlan.id, "base", event.target.value)}
            />
          </div>
          <div>
            <label htmlFor={`plan-${activePlan.id}-quota`}>Quota</label>
            <input
              id={`plan-${activePlan.id}-quota`}
              inputMode="decimal"
              value={activePlan.quota}
              onChange={(event) => setPlanField(activePlan.id, "quota", event.target.value)}
            />
          </div>
        </div>
        <fieldset className="tier-block">
          <legend>Attainment tiers</legend>
          <p className="fieldset-help">
            Rates apply to revenue between each lower edge and the next; the first tier must begin
            at 0.
          </p>
          <table className="tier-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Lower edge (attainment)</th>
                <th>Rate</th>
                <th aria-label="Row actions" />
              </tr>
            </thead>
            <tbody>
              {activePlan.tiers.map((tier, index) => (
                <tr key={`tier-${index}`}>
                  <td>{index + 1}</td>
                  <td>
                    <label className="sr-only" htmlFor={`plan-${activePlan.id}-tier-${index}-from`}>
                      Tier {index + 1} lower edge
                    </label>
                    <input
                      id={`plan-${activePlan.id}-tier-${index}-from`}
                      inputMode="decimal"
                      value={tier.from}
                      disabled={index === 0}
                      onChange={(event) =>
                        setTierField(activePlan.id, index, "from", event.target.value)
                      }
                    />
                  </td>
                  <td>
                    <label className="sr-only" htmlFor={`plan-${activePlan.id}-tier-${index}-rate`}>
                      Tier {index + 1} rate
                    </label>
                    <input
                      id={`plan-${activePlan.id}-tier-${index}-rate`}
                      inputMode="decimal"
                      value={tier.rate}
                      onChange={(event) =>
                        setTierField(activePlan.id, index, "rate", event.target.value)
                      }
                    />
                  </td>
                  <td>
                    <button
                      type="button"
                      onClick={() => deleteTier(activePlan.id, index)}
                      disabled={index === 0 || activePlan.tiers.length <= 1}
                      aria-label={`Delete tier ${index + 1}`}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <button
            type="button"
            onClick={() => addTier(activePlan.id)}
            disabled={activePlan.tiers.length >= 12}
          >
            Add tier
          </button>
        </fieldset>
        <fieldset className="bonus-block">
          <legend>Bonus</legend>
          <label className="inline-toggle">
            <input
              type="checkbox"
              checked={activePlan.bonus !== null}
              onChange={() => toggleBonus(activePlan.id)}
            />
            <span>Include a lump bonus above threshold</span>
          </label>
          {activePlan.bonus ? (
            <div className="plan-grid">
              <div>
                <label htmlFor={`plan-${activePlan.id}-bonus-L`}>Bonus amount</label>
                <input
                  id={`plan-${activePlan.id}-bonus-L`}
                  inputMode="decimal"
                  value={activePlan.bonus.L}
                  onChange={(event) => setBonusField(activePlan.id, "L", event.target.value)}
                />
              </div>
              <div>
                <label htmlFor={`plan-${activePlan.id}-bonus-x`}>Threshold (attainment)</label>
                <input
                  id={`plan-${activePlan.id}-bonus-x`}
                  inputMode="decimal"
                  value={activePlan.bonus.x_b}
                  onChange={(event) => setBonusField(activePlan.id, "x_b", event.target.value)}
                />
              </div>
            </div>
          ) : null}
        </fieldset>
        <fieldset className="cap-block">
          <legend>Cap</legend>
          <label className="inline-toggle">
            <input
              type="checkbox"
              checked={activePlan.cap !== null}
              onChange={() => toggleCap(activePlan.id)}
            />
            <span>Freeze variable pay past a cap attainment</span>
          </label>
          {activePlan.cap ? (
            <div>
              <label htmlFor={`plan-${activePlan.id}-cap`}>Cap (attainment)</label>
              <input
                id={`plan-${activePlan.id}-cap`}
                inputMode="decimal"
                value={activePlan.cap}
                onChange={(event) => setCap(activePlan.id, event.target.value)}
              />
            </div>
          ) : null}
        </fieldset>
        <fieldset className="extras-block">
          <legend>Advanced payout primitives</legend>
          <p className="field-note">
            Optional §3.2a extensions to the payout curve. Leave every box unchecked for a standard
            plan.
          </p>
          <label className="inline-toggle">
            <input
              type="checkbox"
              checked={activePlan.extras?.drawNonRecoverable != null}
              onChange={() => toggleExtra(activePlan.id, "drawNonRecoverable")}
            />
            <span>Non-recoverable draw (guarantee commission floor)</span>
          </label>
          {activePlan.extras?.drawNonRecoverable != null ? (
            <div>
              <label htmlFor={`plan-${activePlan.id}-draw-nr`}>Guaranteed commission</label>
              <input
                id={`plan-${activePlan.id}-draw-nr`}
                inputMode="decimal"
                value={activePlan.extras.drawNonRecoverable}
                onChange={(event) =>
                  setExtraScalar(activePlan.id, "drawNonRecoverable", event.target.value)
                }
              />
            </div>
          ) : null}

          <label className="inline-toggle">
            <input
              type="checkbox"
              checked={activePlan.extras?.spiff != null}
              onChange={() => toggleExtra(activePlan.id, "spiff")}
            />
            <span>SPIFF spot bonus above a threshold</span>
          </label>
          {activePlan.extras?.spiff != null ? (
            <div className="plan-grid">
              <div>
                <label htmlFor={`plan-${activePlan.id}-spiff-amount`}>SPIFF amount</label>
                <input
                  id={`plan-${activePlan.id}-spiff-amount`}
                  inputMode="decimal"
                  value={activePlan.extras.spiff.amount}
                  onChange={(event) =>
                    setExtraLump(activePlan.id, "spiff", "amount", event.target.value)
                  }
                />
              </div>
              <div>
                <label htmlFor={`plan-${activePlan.id}-spiff-threshold`}>
                  Threshold (attainment)
                </label>
                <input
                  id={`plan-${activePlan.id}-spiff-threshold`}
                  inputMode="decimal"
                  value={activePlan.extras.spiff.threshold}
                  onChange={(event) =>
                    setExtraLump(activePlan.id, "spiff", "threshold", event.target.value)
                  }
                />
              </div>
            </div>
          ) : null}

          <label className="inline-toggle">
            <input
              type="checkbox"
              checked={activePlan.extras?.clawback != null}
              onChange={() => toggleExtra(activePlan.id, "clawback")}
            />
            <span>Clawback penalty below a threshold</span>
          </label>
          {activePlan.extras?.clawback != null ? (
            <div className="plan-grid">
              <div>
                <label htmlFor={`plan-${activePlan.id}-clawback-amount`}>Clawback amount</label>
                <input
                  id={`plan-${activePlan.id}-clawback-amount`}
                  inputMode="decimal"
                  value={activePlan.extras.clawback.amount}
                  onChange={(event) =>
                    setExtraLump(activePlan.id, "clawback", "amount", event.target.value)
                  }
                />
              </div>
              <div>
                <label htmlFor={`plan-${activePlan.id}-clawback-threshold`}>
                  Threshold (attainment)
                </label>
                <input
                  id={`plan-${activePlan.id}-clawback-threshold`}
                  inputMode="decimal"
                  value={activePlan.extras.clawback.threshold}
                  onChange={(event) =>
                    setExtraLump(activePlan.id, "clawback", "threshold", event.target.value)
                  }
                />
              </div>
            </div>
          ) : null}

          <label className="inline-toggle">
            <input
              type="checkbox"
              checked={activePlan.extras?.payFloor != null}
              onChange={() => toggleExtra(activePlan.id, "payFloor")}
            />
            <span>Pay-floor (clamp total pay, override the negative tail)</span>
          </label>
          {activePlan.extras?.payFloor != null ? (
            <div>
              <label htmlFor={`plan-${activePlan.id}-pay-floor`}>Minimum total pay</label>
              <input
                id={`plan-${activePlan.id}-pay-floor`}
                inputMode="decimal"
                value={activePlan.extras.payFloor}
                onChange={(event) => setExtraScalar(activePlan.id, "payFloor", event.target.value)}
              />
            </div>
          ) : null}

          <label className="inline-toggle">
            <input
              type="checkbox"
              checked={activePlan.extras?.drawRecoverable != null}
              onChange={() => toggleExtra(activePlan.id, "drawRecoverable")}
            />
            <span>Recoverable draw (cash-flow report only)</span>
          </label>
          {activePlan.extras?.drawRecoverable != null ? (
            <div>
              <label htmlFor={`plan-${activePlan.id}-draw-r`}>Advance against commission</label>
              <input
                id={`plan-${activePlan.id}-draw-r`}
                inputMode="decimal"
                value={activePlan.extras.drawRecoverable}
                onChange={(event) =>
                  setExtraScalar(activePlan.id, "drawRecoverable", event.target.value)
                }
              />
              <p className="field-note">
                Full-recovery assumption — CE-neutral in the one-period model; multi-period recovery
                is outside the current model.
              </p>
            </div>
          ) : null}
        </fieldset>
        {planIssues.length > 0 ? (
          <ul className="issue-list" role="list">
            {planIssues.slice(0, 6).map((issue) => (
              <li key={`${issue.path}-${issue.message}`}>
                {issue.path}: {issue.message}
              </li>
            ))}
          </ul>
        ) : null}
        {domain && domainPlan ? (
          <PayoutChart
            scenario={domain}
            plan={domainPlan}
            highlight={highlight}
            editable={{
              tierFrom: (index, value) => setTierField(activePlan.id, index, "from", value),
              tierRate: (index, value) => setTierField(activePlan.id, index, "rate", value),
            }}
          />
        ) : (
          <p className="chart-empty">Fix the highlighted inputs to see the payout preview.</p>
        )}
      </div>
    </section>
  );
}
