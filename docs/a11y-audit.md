# Accessibility evidence

Counterplay targets WCAG 2.1 AA. This document records reproducible automated checks and
code-inspected behavior; it is not a third-party accessibility certification.

## Automated checks

`e2e/axe.spec.ts` runs `@axe-core/playwright` with the `wcag2a`, `wcag2aa`, `wcag21a`, and
`wcag21aa` tag sets. A serious or critical violation fails the suite. The checks cover:

- Model, Design, Simulate, and Analyze surfaces
- the printable `/record` route
- the Model surface in dark theme
- Chromium, Firefox, and WebKit through the standard Playwright project matrix

`e2e/keyboard.spec.ts` verifies a keyboard-only route through Model → Design → Simulate → Analyze,
share-link creation, and the printable record. Additional end-to-end tests cover keyboard operation
for curve handles, history controls, locale selection, template replacement, and calibration.

Run the complete accessibility coverage with:

```bash
npm run build
PLAYWRIGHT_BROWSERS_PATH=0 npx playwright test e2e/axe.spec.ts e2e/keyboard.spec.ts e2e/workspace.spec.ts
```

## Structure and announcements

- Workspace navigation uses a named `tablist` with paired `tab` and `tabpanel` roles.
- Plan editors use a separate named tablist.
- Identity checks use `role="status"` and `aria-live="polite"`.
- Validation failures use `role="alert"`.
- Template replacement uses a named dialog with explicit Replace and Cancel actions.
- Data-bearing SVG charts have table equivalents so their meaning is not pointer-only.
- Record tables provide captions and column headers.
- Segment inputs have programmatic labels and explanatory titles.

Finding deep links identify the relevant surface without moving focus automatically. This avoids
unexpected focus changes when a linter result appears.

## Contrast

Current theme-token contrast ratios, calculated from the CSS colors using WCAG relative luminance:

| Pair                       | Light |  Dark |
| -------------------------- | ----: | ----: |
| `--ink` on `--canvas`      | 14.98 | 16.23 |
| `--muted` on `--canvas`    |  5.13 |  9.40 |
| `--accent` on `--canvas`   |  5.87 | 10.34 |
| Primary text on `--accent` |  6.51 | 10.34 |

Primary buttons use the theme-specific `--on-accent` token. Focus is drawn with a 3px
`--focus` outline.

## Reduced motion

The product has no decorative motion loops; charts are static SVG. Under
`prefers-reduced-motion: reduce`, smooth scrolling is disabled and animation and transition
durations collapse to `0.01ms`, preserving the same information architecture without motion.

## Known limits

- Automated axe checks do not replace testing with assistive technologies and disabled users.
- The current screen-reader evidence is structural and role-based; no independent manual audit has
  been completed.
