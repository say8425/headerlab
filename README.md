# HeaderLab

Add, modify and remove HTTP request and response headers, in Chrome, with no
host access until you grant it.

A replacement for ModHeader, which was pulled from the Chrome Web Store in July
2026 after a hidden tracker was found in it. That is the whole reason this
exists, and it is why the trust posture below is a hard constraint rather than a
feature list.

| Light | Dark |
|---|---|
| ![The HeaderLab popup in light theme: three of four rules live, two granted sites, four header rules](docs/screenshots/popup-light.png) | ![The same popup in dark theme, which follows the operating system setting](docs/screenshots/popup-dark.png) |

Access is asked for per site, on the row that names the site — never as a side
effect of typing a hostname or flipping a switch. Until you press **Grant**, the
row is amber and says so:

![A site row for internal.example.com in the pending state, amber, with a Grant button](docs/screenshots/popup-permission.png)

Anything that would stop a rule going out is said on that rule's own row, and
counted in the rail. Here the second rule asks Chrome to `append` a request
header it will not append — the row says which and what to do instead, the
readout reads **2 of 4 rules live · 1 off · 1 blocked**, and nothing moves to
make room for the message:

![The rules list with the second row showing "Use Set. Chrome does not append request headers." in red where its value would be, and the rail reading 2 of 4 rules live, 1 off, 1 blocked](docs/screenshots/popup-blocked.png)

<sub>Captured from the real production build loaded in Chrome. Only the manifest
was patched, to pre-grant the two example hosts so the granted state could be
photographed without a native permission dialog.</sub>

## Trust posture

- **No host permissions at install.** The manifest's `permissions` is exactly
  `storage` and `declarativeNetRequestWithHostAccess`. It also declares
  `optional_host_permissions: ["<all_urls>"]`, which grants nothing on its own —
  Chrome refuses to let an extension request an origin it never declared, so
  that line is what makes the runtime Grant button legal, not what makes it
  unnecessary. Site access is granted by you, per host, at runtime, and can be
  revoked from Chrome at any time.
- **No network calls.** No analytics, telemetry, remote config or update pings.
  The shipped bundle never *calls* a network primitive, and you can check that
  yourself rather than believe it:

  ```bash
  pnpm build
  grep -rE 'fetch\(|XMLHttpRequest|WebSocket|sendBeacon' .output/chrome-mv3
  ```

  That returns nothing. The pattern matches call and constructor forms on
  purpose: a bare case-insensitive search for those words does hit the bundle
  about fourteen times, and every one of them is a string or an identifier
  rather than a call — React DOM's `prefetchDNS`, `fetchPriority` and
  `dns-prefetch`, and the literals `"xmlhttprequest"` and `"websocket"`, which
  are two of Chrome's declarativeNetRequest resource-type names and appear
  because you can filter on them in the popup. Said here so that finding them
  reads as expected rather than as a caught lie.
- **No content scripts.** Nothing is injected into any page. Headers are changed
  by Chrome's `declarativeNetRequest` engine, which never hands request contents
  to the extension.
- **No external resources.** No CDN, no web fonts, no remote images.
- **No silent failures.** Anything that stops a rule going out is stated on
  screen — a missing permission, an unusable hostname, a header name Chrome will
  reject. A rule that is not applying always says why.

## What it does

- **Set, append or remove** any header, on the **request** or the **response**
  side. `append` is limited by Chrome to a 21-header allowlist on requests, and
  HeaderLab names the rule that falls outside it — which matters more than it
  sounds, because Chrome rejects a ruleset as a whole rather than per rule, so
  one such rule stops every other one too. That is reported, not silent: the
  popup shows the registration failure.
- **Scope by site.** Sites are matched by host: a port or a path is dropped when
  you add one, and the stored value is the value that operates, so what the rail
  shows is what goes on the wire.
- **Apply everywhere**, as an explicit mode rather than an empty site list. It
  costs `<all_urls>`, and the switch does not ask for it — the Grant button
  beside it does.
- **Filter by request type** — eight of Chrome's resource types, checkable
  individually. `main_frame` is on by default, because DNR's own default
  silently excludes it.
- **Pause everything** with one switch. The toolbar icon greys out to match, and
  is re-applied when the service worker wakes.
- **Follows your OS theme**, light or dark, before first paint.

## Install

There is no Chrome Web Store listing. Take the zip attached to the latest
[release](../../releases) and unpack it, or build it yourself:

```bash
corepack enable          # pnpm comes from package.json's packageManager field
pnpm install
pnpm build               # → .output/chrome-mv3
```

Then open `chrome://extensions`, turn on **Developer mode**, choose **Load
unpacked**, and select the unpacked directory.

Chrome only. Edge is untested — it is the same engine and should work, but no
one has run the suite against it.

## Development

```bash
pnpm dev             # WXT dev server → load .output/chrome-mv3-dev unpacked
pnpm check           # four of CI's five jobs: typecheck · lint · format · unit tests
pnpm test            # wxt build && vitest run — unit tests, no browser
pnpm test:e2e        # wxt build --mode e2e && playwright test — real Chrome
pnpm typecheck       # wxt prepare && tsc --noEmit
pnpm lint            # oxlint          (pnpm lint:fix to apply fixes)
pnpm format          # oxfmt           (pnpm format:check to only report)
pnpm build           # production build → .output/chrome-mv3
pnpm screenshots     # rebuild the images in this README from the real popup
```

**pnpm, not npm.** `package.json` names the exact version under
`packageManager`, so `corepack enable` gives you that one and nothing else needs
installing. There is no `package-lock.json`; `pnpm-lock.yaml` is the lockfile CI
installs from with `--frozen-lockfile`.

**Run `pnpm test`, not a bare `pnpm exec vitest run`.** Several suites assert
against *built* output, and the bare tools do not build. A stale artifact has
produced both a false green that silently disabled a guard and a false red that
cost an hour, so `tests/support/build.ts` now detects staleness and fails with
the command to run.

**`pnpm install` may not run `postinstall`.** `ignore-scripts=true` is a common
hardening default in a user `.npmrc`, and pnpm reads it — which skips the
`wxt prepare` that generates `.wxt/`, and `tsconfig.json` extends
`./.wxt/tsconfig.json`. `pnpm typecheck` chains the prepare itself for that
reason, so it works on a fresh clone either way.

**Linting and formatting** are [oxlint](https://oxc.rs) and oxfmt. `pnpm lint`
fails on any warning; `pnpm format:check` reports files that would change.
oxfmt is scoped to code — the hand-tuned `entrypoints/popup/style.css`, the
design mocks under `docs/` and the Markdown are left alone.

**`pnpm test:e2e` and `pnpm screenshots` both need a browser Playwright
does not install by default:**

```bash
pnpm exec playwright install --with-deps --no-shell chromium
```

`--no-shell` matters. Playwright's default headless download is
`chromium-headless-shell`, a stripped build that cannot load extensions — and
both of those commands exist to load one. Without the full binary they fail in a
way that looks like a code problem rather than a missing dependency.

`pnpm screenshots` overwrites the tracked PNGs under `docs/screenshots/`.
That is its job, but it means a run leaves changes in `git status`; commit them
only when the UI actually changed.

`pnpm test:e2e` builds into `.output/chrome-mv3-e2e`, a second output
directory beside the production one. That build carries a loopback host
permission (`http://127.0.0.1/*`) the shipped build does not, so the suite can
drive a local echo server without a runtime prompt Playwright cannot click.
`tests/unit/manifest.test.ts` asserts it never reaches production. Running the
e2e suite does not touch `.output/chrome-mv3` — run `pnpm build` for a fresh
production build.

## Architecture

```
lib/model/       types, zod schema, defaults, migrations   pure
lib/compile/     AppState → DNR rules + diagnostics        pure
lib/permissions/ origins.ts, audit.ts pure · probe.ts calls the browser
lib/view/        popup view models                         pure
lib/storage/     state.ts, session.ts, useAppState.ts
lib/sync/        ruleSync.ts (reconcile), icon.ts
components/      popup UI
entrypoints/     background.ts, popup/
```

**All correctness lives in a pure layer that never imports `chrome.*`.**
`compile()` turns the whole application state into declarativeNetRequest rules
plus a list of diagnostics, and the popup runs that same function on that same
state — so what the screen says and what the browser was told cannot disagree.

**One reconcile loop.** Every trigger — a storage change, worker startup, a
permission granted or revoked — funnels into `reconcile()` in
`lib/sync/ruleSync.ts`, which recompiles from scratch and replaces the ruleset
wholesale. It is idempotent, and there is no second path by which state can
drift down.

This shape is forced rather than chosen: `@webext-core/fake-browser` implements
`declarativeNetRequest` and `permissions.*` as throwing stubs, so
browser-imitation testing is unavailable. Making the browser irrelevant to the
logic is the response.

Design documents live in `docs/superpowers/specs/`, and the measured platform
constraints behind them in `docs/research/`.

## Testing

Three layers: pure logic with no browser, adapters driven by hand-planted spies,
and end-to-end against a genuinely loaded extension. Two of the eleven e2e tests
put a real request on the wire through a local echo server and read the headers
back off it — those are the strongest evidence in the repo.

At the time of writing: 639 unit tests across 30 files, plus 11 e2e tests.

## Status

The popup is complete and the extension works: rules compile, sync, and
demonstrably modify real headers.

Deliberately not built yet, and worth knowing before you look for them:

- **One rule set.** The popup shows a single rule set; the data model carries
  multiple profiles and the compiler handles them, but there is no UI for
  switching between them, and storage holding more than one is truncated to what
  the screen can show rather than left applying invisibly.
- **No JSON export/import.** If it is ever built, its validation has to come
  first — import is what makes the unvalidated surfaces reachable.
- **No tab lock UI.** The compile path exists and is tested; nothing can turn it
  on.
- **No regex scoping UI**, and no RE2 validation to go with it.
- **No manual theme toggle.** The theme follows the OS.

## License

Apache-2.0. See [LICENSE](LICENSE).
