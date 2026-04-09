# Development Notes

Local development uses deterministic, repo-owned ports:

- `npm run dev` serves the Next.js dev server on port 3001.
- `npm run start` serves the static export from `out/` on port 4001.
- `npm run test:e2e` uses repo-local Playwright browsers via `PLAYWRIGHT_BROWSERS_PATH=0`.

Dependency maintenance notes:

- `next@16.1.x` can pin nested `postcss` and `sharp` ranges; explicit overrides are required when advisories land below Next.
- The `serve-handler` `brace-expansion@~1.1.12` override is load-bearing for local static serving and Playwright.
- Overrides on direct dependencies must use npm's `$name` self-reference form or npm raises `EOVERRIDE`.
