"use client";

import { useMemo } from "react";
import { computeSorting, type RosterDelta, type SortingResult } from "@/engine/sorting";
import type { AppLocale } from "@/engine/types";
import { formatCompactCurrency, formatPercent, localeOf } from "@/i18n";
import { useScenarioStore } from "@/state/store";

function signedCurrency(value: number, currency: string, locale: AppLocale): string {
  const formatted = formatCompactCurrency(Math.abs(value), currency, locale);
  if (value === 0) return formatted;
  return `${value > 0 ? "+" : "−"}${formatted}`;
}

export function SortingPanel(): React.JSX.Element {
  const domain = useScenarioStore((state) => state.domain);
  const scenario = useScenarioStore((state) => state.scenario);
  const toggleMenu = useScenarioStore((state) => state.toggleMenu);
  const setMenuWalkAway = useScenarioStore((state) => state.setMenuWalkAway);

  const currency = scenario.settings.currencyLabel;
  const locale = localeOf(scenario.settings.locale);
  const menu = scenario.settings.menu ?? null;

  const sorting: SortingResult | null = useMemo(
    () => (domain ? computeSorting(domain) : null),
    [domain],
  );
  if (!sorting) return <></>;

  const totalHeadcount = scenario.population.reduce((sum, segment) => sum + segment.count, 0);

  return (
    <section className="sorting-panel" aria-labelledby="sorting-heading">
      <header className="sorting-header">
        <div>
          <p className="eyebrow">Selection and sorting</p>
          <h3 id="sorting-heading">Who ends up on this plan</h3>
        </div>
        <p className="sorting-description">
          Every KPI card above assumes the full roster stays, and says so. This panel asks the other
          question: with a reservation value to walk to, who actually takes the plan? It is reported{" "}
          <em>beside</em> those KPIs and never folded into them — the two answer different questions
          and mixing them would make both unreadable.
        </p>
      </header>

      <div className="sorting-roster">
        <h4>Roster response, plan by plan</h4>
        <div className="sorting-table-wrap">
          <table className="sorting-table">
            <thead>
              <tr>
                <th>Plan</th>
                <th>Leaves</th>
                <th>Revenue (full → surviving)</th>
                <th>Comp (full → surviving)</th>
                <th>Comp ratio</th>
                <th>What the full-roster reading hides</th>
              </tr>
            </thead>
            <tbody>
              {sorting.roster.map((row) => (
                <RosterRow
                  key={row.planId}
                  row={row}
                  currency={currency}
                  locale={locale}
                  headcount={totalHeadcount}
                />
              ))}
            </tbody>
          </table>
        </div>
        <p className="sorting-note">
          {sorting.roster.every((row) => row.exitingHeadcount === 0)
            ? "No segment's certainty equivalent trails its reservation value on any plan, so full-roster and surviving-roster KPIs coincide."
            : "Where a plan sheds headcount, its comp ratio can improve for the worst possible reason: the people it could not pay enough are no longer in the denominator."}
        </p>
      </div>

      <div className="sorting-menu">
        <div className="sorting-menu-controls">
          <label className="sorting-toggle">
            <input type="checkbox" checked={menu !== null} onChange={toggleMenu} />
            <span>Offer these plans as a menu, not as alternatives</span>
          </label>
          {menu ? (
            <label className="sorting-toggle">
              <input
                type="checkbox"
                checked={menu.walkAwayAllowed}
                onChange={(event) => setMenuWalkAway(event.target.checked)}
              />
              <span>Reservation value is a real outside option</span>
            </label>
          ) : null}
        </div>
        <p className="sorting-note">
          {menu
            ? "Each segment takes its certainty-equivalent-maximising plan. Ties go to the plan that induces less effort, then to the plan written first."
            : "Switched off, the plans above are read as designs to compare. Switch it on to read them as a menu people choose from — and to have the linter check whether the menu actually screens anyone."}
        </p>

        {menu ? (
          <>
            <div className="sorting-table-wrap">
              <table className="sorting-table" id="sorting-map">
                <thead>
                  <tr>
                    <th>Segment</th>
                    <th>Heads</th>
                    <th>Chooses</th>
                    <th>Its CE</th>
                    <th>Reservation</th>
                    <th>Beats the runner-up by</th>
                    <th>Certainty equivalent per plan</th>
                  </tr>
                </thead>
                <tbody>
                  {sorting.choices.map((choice) => (
                    <tr
                      key={choice.segmentId}
                      className={choice.chosenPlanId === null ? "sorting-row-exit" : undefined}
                    >
                      <th scope="row">{choice.segmentLabel}</th>
                      <td>{choice.count}</td>
                      <td>
                        {choice.chosenPlanId ?? "walks away"}
                        {choice.chosenPlanId !== null && choice.surplus.toNumber() < 0
                          ? " (under duress)"
                          : ""}
                      </td>
                      <td>
                        {formatCompactCurrency(choice.realisedCe.toNumber(), currency, locale)}
                      </td>
                      <td>
                        {formatCompactCurrency(choice.reservation.toNumber(), currency, locale)}
                      </td>
                      <td>
                        {choice.separation === null
                          ? "—"
                          : signedCurrency(choice.separation.toNumber(), currency, locale)}
                      </td>
                      <td className="sorting-ce-list">
                        {choice.options
                          .map(
                            (option) =>
                              `${option.planLabel}: ${formatCompactCurrency(option.ce.toNumber(), currency, locale)}`,
                          )
                          .join(" · ")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <dl className="sorting-kpis">
              <div>
                <dt>Menu revenue</dt>
                <dd>
                  {formatCompactCurrency(
                    sorting.menuKpis.expectedRevenue.toNumber(),
                    currency,
                    locale,
                  )}
                </dd>
              </div>
              <div>
                <dt>Menu comp</dt>
                <dd>
                  {formatCompactCurrency(sorting.menuKpis.totalComp.toNumber(), currency, locale)}
                </dd>
              </div>
              <div>
                <dt>Menu profit</dt>
                <dd>
                  {formatCompactCurrency(sorting.menuKpis.profit.toNumber(), currency, locale)}
                </dd>
              </div>
              <div>
                <dt>Placed headcount</dt>
                <dd>
                  {sorting.menuKpis.headcount} of {totalHeadcount}
                </dd>
              </div>
            </dl>

            <p className="sorting-note">
              {sorting.deadOptions.length > 0
                ? `Nobody chooses ${sorting.deadOptions.join(", ")}. `
                : ""}
              {sorting.sorting.filter((entry) => entry.headcount > 0).length === 1 &&
              scenario.plans.length > 1
                ? "Everyone who stays pools onto a single plan — the menu is not separating anyone. "
                : ""}
              {sorting.walkAwayHeadcount > 0
                ? `${sorting.walkAwayHeadcount} of ${totalHeadcount} heads take nothing on offer.`
                : "Every segment finds something worth taking."}
            </p>
          </>
        ) : null}
      </div>
    </section>
  );
}

interface RosterRowProps {
  row: RosterDelta;
  currency: string;
  locale: AppLocale;
  headcount: number;
}

function RosterRow({ row, currency, locale }: RosterRowProps): React.JSX.Element {
  const hides =
    row.exitingHeadcount === 0
      ? "nothing — everybody stays"
      : `${signedCurrency(row.delta.expectedRevenue.toNumber(), currency, locale)} revenue, ${signedCurrency(row.delta.profit.toNumber(), currency, locale)} profit`;
  return (
    <tr className={row.exitingHeadcount > 0 ? "sorting-row-exit" : undefined}>
      <th scope="row">{row.planLabel}</th>
      <td>
        {row.exitingHeadcount === 0
          ? "—"
          : `${row.exitingHeadcount} (${row.exitingSegmentIds.join(", ")})`}
      </td>
      <td>
        {formatCompactCurrency(row.fullRoster.expectedRevenue.toNumber(), currency, locale)} →{" "}
        {formatCompactCurrency(row.surviving.expectedRevenue.toNumber(), currency, locale)}
      </td>
      <td>
        {formatCompactCurrency(row.fullRoster.totalComp.toNumber(), currency, locale)} →{" "}
        {formatCompactCurrency(row.surviving.totalComp.toNumber(), currency, locale)}
      </td>
      <td>
        {row.fullRoster.compRatio
          ? formatPercent(row.fullRoster.compRatio.toNumber(), locale)
          : "—"}{" "}
        →{" "}
        {row.surviving.compRatio ? formatPercent(row.surviving.compRatio.toNumber(), locale) : "—"}
      </td>
      <td>{hides}</td>
    </tr>
  );
}
