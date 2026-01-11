import type { AppLocale } from "@/engine/types";

export const supportedLocales: readonly AppLocale[] = ["en-US", "en-GB", "de-DE"] as const;
export const defaultLocale: AppLocale = "en-US";

type CopyKey = "locale.label" | "locale.en-US" | "locale.en-GB" | "locale.de-DE" | "history.undo" | "history.redo";

const copy: Record<AppLocale, Record<CopyKey, string>> = {
  "en-US": { "locale.label": "Display language", "locale.en-US": "English (United States)", "locale.en-GB": "English (United Kingdom)", "locale.de-DE": "German (Germany)", "history.undo": "Undo", "history.redo": "Redo" },
  "en-GB": { "locale.label": "Display language", "locale.en-US": "English (United States)", "locale.en-GB": "English (United Kingdom)", "locale.de-DE": "German (Germany)", "history.undo": "Undo", "history.redo": "Redo" },
  "de-DE": { "locale.label": "Anzeigesprache", "locale.en-US": "Englisch (Vereinigte Staaten)", "locale.en-GB": "Englisch (Vereinigtes Königreich)", "locale.de-DE": "Deutsch (Deutschland)", "history.undo": "Rückgängig", "history.redo": "Wiederholen" },
};

export function localeOf(value: AppLocale | null | undefined): AppLocale {
  return value ?? defaultLocale;
}

export function t(locale: AppLocale | null | undefined, key: CopyKey): string {
  return copy[localeOf(locale)][key];
}

function number(locale: AppLocale | null | undefined, value: number, digits: number): string {
  return new Intl.NumberFormat(localeOf(locale), { maximumFractionDigits: digits, minimumFractionDigits: 0 }).format(value);
}

/** Currency labels are intentionally abstract scenario prefixes, not silently coerced to ISO codes. */
export function formatCompactCurrency(value: number, currency: string, locale?: AppLocale | null): string {
  const sign = value < 0 ? "-" : "";
  const absolute = Math.abs(value);
  if (absolute >= 1_000_000) return `${sign}${currency}${number(locale, absolute / 1_000_000, 2)}M`;
  if (absolute >= 1_000) return `${sign}${currency}${number(locale, absolute / 1_000, 1)}k`;
  return `${sign}${currency}${number(locale, absolute, 0)}`;
}

export function formatPercent(value: number, locale?: AppLocale | null, digits = 1): string {
  return new Intl.NumberFormat(localeOf(locale), { style: "percent", maximumFractionDigits: digits, minimumFractionDigits: 0 }).format(value);
}

export function formatNumber(value: number, locale?: AppLocale | null, digits = 3): string {
  return number(locale, value, digits);
}

export function formatPreparedDate(iso: string, locale?: AppLocale | null): string {
  const date = new Date(iso);
  return Number.isNaN(date.valueOf()) ? "—" : new Intl.DateTimeFormat(localeOf(locale), { dateStyle: "medium", timeStyle: "short" }).format(date);
}
