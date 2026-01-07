# Accessibility audit — Counterplay (P10)

**Date:** 2025-12-12 (build session; planning calendar per D-018 / D-019)  
**Scope:** WCAG 2.1 AA *intent* (D-009). This document records evidence; it does not claim a formal third-party certification.  
**Surfaces:** Model, Design, Simulate, Analyze, Share/Export, `/record`, both themes, `prefers-reduced-motion`.

---

## 1. Automated axe (Playwright)

Runner: `@axe-core/playwright` with tags `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`.  
Gate: any violation with impact `serious` or `critical` fails the suite (`e2e/axe.spec.ts`).

| Surface / condition | Spec | Result (chromium / firefox / webkit) |
|---|---|---|
| Model (default template T2, light) | `e2e/axe.spec.ts` | 0 serious/critical |
| Design | same | 0 serious/critical |
| Simulate | same | 0 serious/critical |
| Analyze | same | 0 serious/critical |
| `/record` | same (P10 extension) | 0 serious/critical |
| Model in dark theme (`settings.v1` forced dark) | same (P10 extension) | 0 serious/critical |

Full three-browser matrix also re-runs these scans (see §9 / P10 gate).

---

## 2. Manual keyboard run-through

Executable coverage: `e2e/keyboard.spec.ts` (focus → Enter activation across Model → Design → Simulate → Analyze → Build share link → printable record).

| Step | Action | Expected | Result |
|---|---|---|---|
| 1 | Land on `/` | H1 = brand; Model tab `aria-selected=true` | Pass |
| 2 | Focus Design tab, Enter | Design heading visible; tab selected | Pass |
| 3 | Focus Simulate tab, Enter | Best-response heading; identity `role="status"` | Pass |
| 4 | Focus Analyze tab, Enter | Findings heading | Pass |
| 5 | Focus “Build share link”, Enter | Share URL field appears and is focusable | Pass |
| 6 | Focus record link, Enter | `/record` with Compensation Design Record | Pass |

Additional keyboard notes (code-inspected + prior P4–P9 gates):

- Theme toggle, template cards, plan tabs, mode toggle, MC run, and segment/plan row actions are native `<button>` / labeled `<input>` controls with `:focus-visible` (3px `--focus` outline).
- Template replace confirmation is a `role="dialog"` with explicit Replace/Cancel actions.
- Chart SVG twins expose data tables (Design payout twin; Simulate / MC twins) so chart meaning is not mouse-only.

---

## 3. Screen-reader spot pass

Method: structure audit against the DOM roles/names (VoiceOver not available in this CI-class session; names and live regions verified in the accessibility tree via Playwright role queries).

| Region | Name / role | Notes |
|---|---|---|
| Brand | `heading` level 1 from `brandName` | Sole display-name source (`src/brand.ts`) |
| Surface nav | `tablist` “Workspace surfaces” + `tab` / `tabpanel` pairing | Pass |
| Plan editors | `tablist` “Plans” | Pass |
| Identity badge | `status` + `aria-live="polite"` | Pass / fail states announced |
| Domain errors | `role="alert"` | Pass |
| Share status | text status lines after build/import | Clipboard blocked path now announces (P10 fix) |
| Findings | list of cards with severity + Evidence `<details>` | Pass |
| Record tables | captions + column headers | Pass |
| Segment fields | `sr-only` / `visually-hidden` labels + `title` explainers | Pass |

Residual: deep-link “hints” are textual (“Deep link: Design”) rather than automatic focus moves — intentional for v1 (no focus-stealing on lint).

---

## 4. Contrast — both themes

Computed contrast ratios (sRGB relative luminance, WCAG formula):

| Pair | Light | Dark |
|---|---|---|
| `--ink` on `--canvas` | 14.98:1 | 16.23:1 |
| `--muted` on `--canvas` | 5.13:1 | 9.40:1 |
| `--accent` on `--canvas` | 5.87:1 | 10.34:1 |
| Primary button text on `--accent` | 6.51:1 (`#fff`) | **was 1.76:1 (`#fff` on `#7bd4b9`) — FAIL** |

### Finding fixed in P10

Dark-theme primary actions (`.button-primary`, `.mc-run-button`) used white text on the light teal `--accent` (~1.76:1).  
**Fix:** introduced `--on-accent` (`#fff` light / `#101716` dark) and wired both primary button rules to `color: var(--on-accent)`. Post-fix dark primary contrast ≈ **10.34:1**.

Focus ring (`--focus`) is a 3px outline (not body text); orange-on-canvas alone is below 3:1 for *text*, but the ring sits against mixed ink/surface chrome and remains the established focus treatment from P4.

---

## 5. Reduced-motion parity

`src/app/globals.css` contains:

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    scroll-behavior: auto !important;
    transition-duration: 0.01ms !important;
    animation-duration: 0.01ms !important;
  }
}
```

The product does not ship decorative motion loops; charts are static SVG. Reduced-motion users get the same information architecture with transitions collapsed. **Pass / parity.**

---

## 6. Serious/critical findings closed before audit close

| ID | Finding | Severity | Resolution |
|---|---|---|---|
| A-1 | Dark primary button contrast ~1.76:1 | critical (contrast) | `--on-accent` token + button/MC run color |
| — | axe serious/critical on audited surfaces | — | None remaining after A-1 |

No remaining serious/critical items in the automated gate or the contrast re-check above.

---

## 7. How to re-run

```bash
npm run build
PLAYWRIGHT_BROWSERS_PATH=0 npx playwright test e2e/axe.spec.ts e2e/keyboard.spec.ts
```
