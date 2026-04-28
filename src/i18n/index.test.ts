import { describe, expect, it } from "vitest";
import { formatCompactCurrency, formatPercent, formatPreparedDate, localeOf, t } from "./index";

describe("locale helpers", () => {
  it("keeps an absent locale on the byte-stable en-US default", () => {
    expect(localeOf(undefined)).toBe("en-US");
    expect(t(undefined, "history.undo")).toBe("Undo");
  });

  it("uses Intl separators without changing the abstract currency prefix", () => {
    expect(formatCompactCurrency(1234, "$", "en-US")).toBe("$1.2k");
    expect(formatCompactCurrency(1234, "€", "de-DE")).toBe("€1,2k");
    expect(formatPercent(0.125, "de-DE")).toContain("12,5");
  });

  it("formats only a presentation date and never exposes an invalid timestamp", () => {
    expect(formatPreparedDate("not-a-date", "en-US")).toBe("—");
    expect(formatPreparedDate("2026-01-02T03:04:05.000Z", "en-GB")).toMatch(/2026/);
  });
});
