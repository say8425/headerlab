# HeaderLab

English | [한국어](docs/README.ko.md) | [日本語](docs/README.ja.md) | [中文](docs/README.zh.md) | [Español](docs/README.es.md)

Add, modify and remove HTTP request and response headers, in Chrome, with no host access
until you grant it.

[![CI](https://github.com/say8425/headerlab/actions/workflows/ci.yml/badge.svg)](https://github.com/say8425/headerlab/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/headerlab?logo=npm&logoColor=%23CC3534&color=%23CC3534)](https://www.npmjs.com/package/headerlab)

| Light | Dark |
|---|---|
| ![The HeaderLab popup in light theme: the count beside the Rules heading reads 3 of 4 live, 1 off, with two granted sites in the rail and four header rules](docs/screenshots/popup-light.png) | ![The same popup in dark theme, which follows the operating system setting](docs/screenshots/popup-dark.png) |

## Install

There is no Chrome Web Store listing. Take the zip attached to the latest
[release](../../releases) and unpack it, or build it yourself:

```bash
corepack enable          # pnpm comes from package.json's packageManager field
pnpm install
pnpm build               # → .output/chrome-mv3
```

Then open `chrome://extensions`, turn on **Developer mode**, choose **Load unpacked**, and
select the unpacked directory. Chrome only — see [Limitations](#limitations).

### The CLI

```bash
npm i -g headerlab
```

That puts `headerlab` on your PATH, for driving the extension from a terminal — see
[Agent bridge](#agent-bridge). It runs straight from a clone too, with no install step at
all, because the package has zero runtime dependencies:
`node packages/headerlab/bin/headerlab.mjs`. The line above is how a person uses this; the
clone is what a contributor does, and the two are ordered that way on purpose.

### The agent skill

`packages/plugin` packages the CLI as a skill for Claude Code and for Codex, from one
`skills/` tree under two manifests. Neither is published to a directory, so both install
from this repository:

```bash
# Claude Code
claude plugin marketplace add say8425/headerlab
claude plugin install headerlab@headerlab

# Codex
codex plugin marketplace add say8425/headerlab
```

The skill runs `command -v headerlab` before its own content reaches the model, so a
missing CLI arrives as a fact rather than as a surprise mid-task. **It reports `bridge-off`
until the bridge is turned on.** Installing the CLI globally is not a prerequisite: the
plugin carries its own shim to `packages/headerlab`. Running `npm i -g headerlab` as well
is not a conflict either — PATH resolves the global copy first.

Ask in your own words; the skill maps the request onto the CLI:

```text
What is HeaderLab doing right now?
Add an X-Debug: on request header and scope it to staging.example.com
Stop sending the Referer header on api.example.com
Pause every rule, then turn them back on
Which sites am I actually allowed to modify?
```

The first and last are reads — `status`, `site ls`, `rule ls` and `state get` answer
without writing anything. The middle three write, and one detail is worth expecting:
adding a site scopes a rule to it but does not grant access to it. That site stays pending
until you press Grant in the popup, and the skill is told to say so rather than let you
read the write as if the site were already live.

## What it does

- **Set, append or remove** any header, on the **request** or the **response** side.
  `append` is limited by Chrome to a 21-header allowlist on requests, and HeaderLab names
  the rule that falls outside it — which matters more than it sounds, because Chrome
  rejects a ruleset as a whole rather than per rule, so one such rule stops every other one
  too. That is reported, not silent: the popup shows the registration failure.
- **Scope by site.** Sites are matched by host: a port or a path is dropped when you add
  one, and the stored value is the value that operates, so what the rail shows is what goes
  on the wire.
- **Apply everywhere**, as an explicit mode rather than an empty site list. It costs
  `<all_urls>`, and the switch does not ask for it — the Grant button beside it does.
- **Filter by request type** — eight of Chrome's resource types, checkable individually.
  `main_frame` is on by default, because DNR's own default silently excludes it.
- **Pause everything** with one switch. The toolbar icon greys out to match, and is
  re-applied when the service worker wakes.
- **Follows your OS theme**, light or dark, before first paint.

Access is asked for per site, on the row that names the site — never as a side effect of
typing a hostname or flipping a switch. Until you press **Grant**, the row is amber and
says so — and the count beside **Rules** refuses to flatter it: a rule scoped only to
hosts you have not granted is counted **blocked**, never live, and the hosts still waiting
are named beside it, so the count stays honest on both ends
("3 of 4 live · 1 off · 1 site needs access"):

![A site row for internal.example.com in the pending state, amber, with a Grant button, and the count beside the Rules heading reading 3 of 4 live, 1 off, 1 site needs access](docs/screenshots/popup-permission.png)

Anything that would stop a rule going out is said on that rule's own row, and counted
beside the **Rules** heading. Here the second rule asks Chrome to `append` a request header
it will not append — the row says which and what to do instead, the count reads
**2 of 4 live · 1 off · 1 blocked**, and nothing moves to make room for the message:

![The rules list with the second row showing "Use Set. Chrome does not append request headers." in red where its value would be, and the count beside the Rules heading reading 2 of 4 live, 1 off, 1 blocked](docs/screenshots/popup-blocked.png)

<sub>Captured from the real production build loaded in Chrome. Only the manifest was
patched, to pre-grant the two example hosts so the granted state could be photographed
without a native permission dialog.</sub>

## Trust posture

- **No host permissions at install.** The manifest's `permissions` is exactly `storage` and
  `declarativeNetRequestWithHostAccess`. It also declares
  `optional_host_permissions: ["<all_urls>"]`, which grants nothing on its own — Chrome
  refuses to let an extension request an origin it never declared, so that line is what
  makes the runtime Grant button legal, not what makes it unnecessary. Site access is
  granted by you, per host, at runtime, and can be revoked from Chrome at any time.
- **No network calls.** No analytics, telemetry, remote config or update pings. The shipped
  bundle never *calls* a network primitive, and you can check that yourself rather than
  believe it:

  ```bash
  pnpm build
  grep -rE 'fetch\(|XMLHttpRequest|WebSocket|sendBeacon' .output/chrome-mv3
  ```

  That returns nothing. The pattern matches call and constructor forms on purpose: a bare
  case-insensitive search for those words does hit the bundle sixteen times, and
  every one is a string or an identifier rather than a call — React DOM's `prefetchDNS`,
  `fetchPriority` and `dns-prefetch`, and the literals `"xmlhttprequest"` and `"websocket"`.
  Those last two are declarativeNetRequest resource-type names, and they arrive by
  different routes: `xmlhttprequest` is one of the eight the popup offers as checkboxes
  (labelled `xhr` there), while `websocket` is only ever a member of the fifteen-value
  resource-type enum the stored state is validated against. Said here so that finding them
  reads as expected rather than as a caught lie.
- **No content scripts.** Nothing is injected into any page. Headers are changed by
  Chrome's `declarativeNetRequest` engine, which never hands request contents to the
  extension.
- **No external resources.** No CDN, no web fonts, no remote images.
- **No silent failures.** Anything that stops a rule going out is stated on screen — a
  missing permission, an unusable hostname, a header name Chrome will reject. A rule that
  is not applying always says why.

## Agent bridge

An AI agent can drive HeaderLab from a terminal instead of a person clicking through the
popup:

```bash
headerlab site add staging.example.com
headerlab rule add --target request --op set --name Authorization --value "Bearer $TOKEN"
```

The bridge is off until a human turns on its switch in the popup, and the CLI can neither
grant site access nor turn it on — Chrome takes both only from a user gesture. Nothing
leaves the machine: CLI, host and extension meet on a unix domain socket in a per-user
directory, never a network socket.

[`docs/agent-bridge.md`](docs/agent-bridge.md) is the whole of it — the protocol, the
commands, the exit codes, how to turn it on, and the five claims not to get wrong.

## Limitations

**This is a Chrome MV3 build and nothing else.** `wxt.config.ts` declares no other target,
and no build has been run on another browser. Edge is the same engine and should work, but
nobody has run the suite against it.

The table below is the *platform ceiling a port would meet*, not a support matrix — it is
[MDN's browser-compat data](https://github.com/mdn/browser-compat-data) for the APIs this
extension is built on, read at the versions each browser first shipped them. Edge's column
is `✓` rather than a number because BCD records it as `mirror` — it tracks Chrome's:

| | Chrome | Edge | Firefox | Safari |
|---|---|---|---|---|
| Request headers (`RuleAction.requestHeaders`) | 86 | ✓ | 113 | 16.4 |
| Response headers (`RuleAction.responseHeaders`) | 86 | ✓ | 113 | **none** |
| Per-site runtime grant (`optional_host_permissions`) | 102 | ✓ | 128 | 15.5 |
| Tab-scoped rules (`RuleCondition.tabIds`) | 92 | ✓ | 113 | **none** |
| Native messaging (`runtime.connectNative`) | 29 | ✓ | 50 | 14 (containing app) |

Two of those are worth spelling out:

- **Safari cannot modify response headers at all.** That is half of what this extension
  does, so a Safari port would be a different, smaller product rather than the same one
  recompiled.
- **Safari's native messaging goes to a containing macOS app**, per Apple's documented
  model, rather than to a host manifest on disk. `headerlab bridge install` writes exactly
  such a manifest, so the agent bridge has nothing to install into there.

Features deliberately not built yet are tracked as issues:
[#30](../../issues/30) one rule set · [#31](../../issues/31) JSON import/export ·
[#32](../../issues/32) tab lock UI · [#33](../../issues/33) regex scoping ·
[#34](../../issues/34) manual theme toggle · [#35](../../issues/35) the bridge's
remaining commands.

## Architecture

```
lib/model/       types, zod schema, defaults, migrations   pure
lib/compile/     AppState → DNR rules + diagnostics        pure
lib/permissions/ origins.ts, audit.ts pure · probe.ts calls the browser
lib/view/        popup view models                         pure
lib/bridge/      protocol.ts (command schema), apply.ts (reducer),
                 query.ts (state → StatusPayload)                  pure
lib/storage/     state.ts, session.ts, useAppState.ts
lib/sync/        ruleSync.ts (reconcile), icon.ts
components/      popup UI
entrypoints/     background.ts, popup/
packages/        the agent bridge, outside the extension bundle — headerlab
                 (the CLI plus the native-messaging host, published to npm),
                 plugin. Zero deps, node:test, their own CI job
```

**All correctness lives in a pure layer that never imports `chrome.*`.** `compile()` turns
the whole application state into declarativeNetRequest rules plus a list of diagnostics,
and the popup runs that same function on that same state — so what the screen says and what
the browser was told cannot disagree.

**One reconcile loop.** Every trigger — a storage change, worker startup, a permission
granted or revoked — funnels into `reconcile()` in `lib/sync/ruleSync.ts`, which recompiles
from scratch and replaces the ruleset wholesale. It is idempotent, and there is no second
path by which state can drift down.

This shape is forced rather than chosen: `@webext-core/fake-browser` implements
`declarativeNetRequest` and `permissions.*` as throwing stubs, so browser-imitation testing
is unavailable. Making the browser irrelevant to the logic is the response.

Design documents live in `docs/superpowers/specs/`, and the measured platform constraints
behind them in `docs/research/`.

## Development

```bash
pnpm dev             # WXT dev server → load .output/chrome-mv3-dev unpacked
pnpm check           # four of CI's six jobs: typecheck · lint · format · unit tests
pnpm test            # wxt build && vitest run — unit tests, no browser
pnpm test:packages   # the agent-bridge packages, under node:test — vitest's
                     # glob does not reach them, so this is its own CI job
pnpm check:all       # pnpm check && pnpm test:packages
pnpm test:e2e        # builds both e2e modes, then playwright test — real Chrome
pnpm typecheck       # wxt prepare && tsc --noEmit
pnpm lint            # wxt prepare && oxlint --deny-warnings   (lint:fix to fix)
pnpm format:check    # oxfmt --check             (pnpm format to write)
pnpm build           # production build → .output/chrome-mv3
pnpm screenshots     # rebuild the images in this README from the real popup
```

**pnpm, not npm.** `package.json` names the exact version under `packageManager`, so
`corepack enable` gives you that one and nothing else needs installing. There is no
`package-lock.json`; `pnpm-lock.yaml` is the lockfile CI installs from with
`--frozen-lockfile`.

**Run `pnpm test`, not a bare `pnpm exec vitest run`.** Several suites assert against
*built* output, and the bare tools do not build. A stale artifact has produced both a false
green that silently disabled a guard and a false red that cost an hour, so
`tests/support/build.ts` detects staleness and fails with the command to run.

**`pnpm test:e2e` and `pnpm screenshots` need a browser Playwright does not install by
default:**

```bash
pnpm exec playwright install --with-deps --no-shell chromium
```

`--no-shell` matters. Playwright's default headless download is `chromium-headless-shell`,
a stripped build that cannot load extensions — and both of those commands exist to load
one. Without the full binary they fail in a way that looks like a code problem rather than
a missing dependency.

**`pnpm screenshots` overwrites the tracked PNGs** under `docs/screenshots/`. That is its
job, but it means a run leaves changes in `git status`; commit them only when the UI
actually changed.

**The e2e build carries a host permission the shipped build does not, and that is worth
saying out loud given the first claim on this page.** `pnpm test:e2e` builds into
`.output/chrome-mv3-e2e` and `.output/chrome-mv3-bridge-e2e`, beside the production
directory. The first of those declares `http://127.0.0.1/*` (`wxt.config.ts`) so the suite
can drive a local echo server without a runtime prompt Playwright cannot click, and the
second grants `nativeMessaging` outright. `tests/unit/manifest.test.ts` asserts neither
ever reaches production, and running the e2e suite does not touch `.output/chrome-mv3` —
run `pnpm build` for a fresh production build.

`CLAUDE.md` carries the rest: why `lint` chains `wxt prepare`, why `postinstall` may never
run, what oxfmt does and does not format, and the platform traps that have already cost
someone time.

## Testing

Three layers: pure logic with no browser, adapters driven by hand-planted spies, and
end-to-end against a genuinely loaded extension. Two of the e2e tests put a real request on
the wire through a local echo server and read the headers back off it — those are the
strongest evidence in the repo. The bridge has its own, including one that drives a real
`headerlab site add` through a real installed host, through the socket, and into real
storage.

`packages/headerlab` carries a suite of its own, run by Node's built-in test runner rather
than vitest, because the package has no dependency and should not acquire one.
`vitest.config.ts`'s glob cannot reach them, which is why they get a CI job of their own:
for a while they were merging unexecuted, and a suite nothing runs is worse than one that
does not exist, because it reports success.

## License

Apache-2.0. See [LICENSE](LICENSE).
