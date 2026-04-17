# Static-host security headers

Counterplay is a static client-side application. Every scenario is modelled, simulated, and stored in
the browser; there is no backend, no accounts, no telemetry, and no third-party embed. The policy
below makes that architectural claim enforceable by the host rather than merely asserted in prose.

`vercel.json` applies these headers on Vercel and `serve.json` applies the identical policy to
`npm run start`, which is also what the Playwright suite runs against — so all three browsers
exercise every surface under the real policy before release. Any alternate static host should apply
the equivalent response headers to every route and static asset:

```http
Content-Security-Policy: default-src 'self'; base-uri 'self'; connect-src 'self'; font-src 'self'; form-action 'self'; frame-ancestors 'none'; frame-src 'none'; img-src 'self' data:; manifest-src 'self'; media-src 'self'; object-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; worker-src 'none'
Referrer-Policy: no-referrer
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Resource-Policy: same-origin
Permissions-Policy: camera=(), geolocation=(), microphone=(), payment=(), usb=()
```

## Why each non-obvious directive is what it is

- **`worker-src 'none'`** — Counterplay has no Web Worker and no service worker; Monte Carlo runs
  chunked on the main thread. `'none'` is therefore the honest value, and it is deliberately
  stricter than the sibling repos that do run workers. If a future change moves the simulation off
  the main thread, this directive must be widened to `'self'` in the same commit — `npm run
check:csp` will not catch that, because a missing worker is not a broken build until it runs.
- **`connect-src 'self'`** — the product opens no connections of its own, so `'none'` looks
  tempting. It is wrong here: the App Router prefetches same-origin route payloads for the `/record`
  and `/casebook` links on the home route, and `'none'` would block that. `'self'` still forbids
  every off-origin destination, which is the property that matters.
- **`script-src`/`style-src` inline allowances** — required by the framework's static bootstrap and
  its generated critical styles. They permit no remote origin.
- **`img-src 'self' data:`** — charts are drawn as inline SVG; `data:` covers inlined assets. No
  remote image host is permitted.
- **`frame-ancestors 'none'` plus `X-Frame-Options: DENY`** — there is no embeddable surface. Both
  are set because some hosts and older agents honour only one.

## Changing this policy

`npm run check:csp` fails if `vercel.json`, `serve.json`, and this document disagree, if a required
directive goes missing, if a wildcard or unsafe execution token appears, or if the built `out/` gains
an off-origin reference. Update all three together, then re-run `npm run test:all` — the e2e suite
serves `out/` under this exact policy across Chromium, Firefox, and WebKit, so a policy that breaks a
surface fails the gate rather than shipping.

Host-specific tuning and verification of the deployed response headers remain an owner step at deploy
time; nothing here has been checked against a live host.
