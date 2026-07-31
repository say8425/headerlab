# HeaderLab

Add, modify and remove HTTP request and response headers. Chrome (Edge is
untested — an Edge run of the E2E suite is planned for Phase 3).

A replacement for ModHeader, which was removed from both stores in July 2026
after a hidden tracker was found in it.

## Trust posture

- **No network calls.** No analytics, telemetry, remote config, or update pings.
- **No content scripts.** Nothing is injected into any page.
- **No host permissions at install.** Site access is granted by you, per site or
  all at once, and can be revoked at any time.
- **No external resources.** No CDN, no web fonts.

## Development

```bash
npm install
npx playwright install --with-deps --no-shell chromium  # see note below
npm run dev          # load .output/chrome-mv3-dev as an unpacked extension
npm test             # unit tests, no browser required
npm run test:e2e     # end-to-end, proves headers change on the wire
npm run compile      # type check
npm run build        # production build
```

`npm install` does not fetch Playwright's browser binaries — that's a separate
step. `--no-shell` matters: Playwright's default headless build is
`chromium-headless-shell`, a stripped build that cannot load extensions. Without
the full Chromium binary, `npm run test:e2e` fails in a way that looks like a
code problem rather than a missing dependency.

`npm run test:e2e` builds into `.output/chrome-mv3-e2e`, a second output
directory alongside the production `.output/chrome-mv3`. The e2e build carries
a loopback host permission (`http://127.0.0.1/*`) that the shipped build does
not, so the suite can drive the local echo server without a runtime permission
prompt Playwright cannot click. `npm run test:e2e` does not touch
`.output/chrome-mv3` — run `npm run build` to get a fresh production build.

## Architecture

All correctness lives in a pure layer that never imports `chrome.*`:

- `lib/compile/` — application state to declarativeNetRequest rules
- `lib/permissions/origins.ts` — filters to origin patterns

One thin adapter, `lib/sync/ruleSync.ts`, is the only module that calls
`chrome.declarativeNetRequest`. A single `reconcile()` in the background service
worker recompiles from storage and replaces every rule atomically; storage
changes, worker startup, and permission changes all funnel into it.

This shape is forced rather than chosen: `@webext-core/fake-browser` does not
implement `declarativeNetRequest`, so browser-imitation testing is unavailable.
Making the browser irrelevant to the logic is the response.

See `docs/superpowers/specs/` for the design and `docs/research/` for the
verified platform constraints behind it.

## Status

Phase 1 (walking skeleton) complete: rules compile, sync, and demonstrably
modify real headers. Diagnostics, permission UX, the full Data Grid UI, themes,
and tab lock are Phase 2.
