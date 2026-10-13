# Development Notes

Use Node `24.21.0` and npm `11.19.0`, as declared by `.nvmrc`, `engines`, and `packageManager`.
Install with `npm ci`; `engine-strict` rejects a different Node runtime.

Local development uses deterministic, repo-owned ports:

- `npm run dev` serves the Next.js dev server on port 3001.
- `npm run start` serves the static export from `out/` on port 4001.
- `npm run test:e2e` uses repo-local Playwright browsers via `PLAYWRIGHT_BROWSERS_PATH=0`.

Before opening a pull request, install the Playwright browsers once and run the full gate:

```bash
PLAYWRIGHT_BROWSERS_PATH=0 npx playwright install chromium firefox webkit
npm run test:all
```

The full gate includes the production build before performance and CSP checks because both inspect
the generated `out/` directory. CI additionally runs `npm audit --audit-level=high`.
