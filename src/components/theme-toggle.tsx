"use client";

import { useEffect, useState } from "react";

type Theme = "light" | "dark";
const storageKey = "settings.v1";

function readTheme(): Theme | null {
  try {
    const raw = window.localStorage.getItem(storageKey);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === "object" && (parsed as { theme?: unknown }).theme === "dark"
      ? "dark"
      : parsed && typeof parsed === "object" && (parsed as { theme?: unknown }).theme === "light"
        ? "light"
        : null;
  } catch {
    return null;
  }
}

function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
}

export function ThemeToggle(): React.JSX.Element {
  const [theme, setTheme] = useState<Theme>("light");

  useEffect(() => {
    const stored = readTheme();
    const resolved = stored ?? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    applyTheme(resolved);
    setTheme(resolved);
  }, []);

  function toggleTheme(): void {
    const next = theme === "dark" ? "light" : "dark";
    applyTheme(next);
    setTheme(next);
    try {
      window.localStorage.setItem(storageKey, JSON.stringify({ theme: next }));
    } catch {
      // Storage is optional; the visible preference still changes for this visit.
    }
  }

  return (
    <button className="theme-toggle" type="button" onClick={toggleTheme} aria-label="Toggle color theme">
      <span aria-hidden="true">{theme === "dark" ? "◐" : "◑"}</span>
      {theme === "dark" ? "Dark" : "Light"}
    </button>
  );
}
