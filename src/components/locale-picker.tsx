"use client";

import { localeOf, supportedLocales, t } from "@/i18n";
import { useScenarioStore } from "@/state/store";
import type { AppLocale } from "@/engine/types";

export function LocalePicker(): React.JSX.Element {
  const locale = useScenarioStore((state) => localeOf(state.scenario.settings.locale));
  const setLocale = useScenarioStore((state) => state.setLocale);
  return (
    <label className="locale-picker">
      <span className="visually-hidden">{t(locale, "locale.label")}</span>
      <select value={locale} aria-label={t(locale, "locale.label")} onChange={(event) => setLocale(event.target.value as AppLocale)}>
        {supportedLocales.map((option) => <option key={option} value={option}>{t(locale, `locale.${option}`)}</option>)}
      </select>
    </label>
  );
}
