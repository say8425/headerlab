# HeaderLab

Chrome and Firefox MV3 extension that modifies HTTP request and response headers. It replaces
ModHeader, which was pulled from the Chrome Web Store in July 2026 after a hidden tracker was
found in it.

**That history is the reason the project exists, and it decides arguments.** The trust posture
(Non-negotiables) and "No silent failures" are the product, not preferences. When a change
trades either away for convenience, the change is wrong.

<!-- Maintainer note, stripped before this file reaches Claude's context. On 2026-09-21 this
file was cut from 2,058 lines to this root plus path-scoped rules in .claude/rules/, following
https://code.claude.com/docs/en/memory. The dated measurements, incident narratives and
corrections of this file's own earlier wording now live only in git: read the version before
the commit that added .claude/rules/. Keep repository counts out of both places; write the
command that re-derives them instead. -->

## Commands

```bash
pnpm check           # typecheck · lint · format:check · test — four of CI's six jobs
pnpm check:all       # pnpm check && pnpm -r test
pnpm test            # wxt build && wxt build -b firefox && vitest run — builds first, see below
pnpm test:packages   # pnpm -r test — packages/*/test/*.mjs under node:test, which vitest never runs
pnpm test:e2e        # three e2e builds (chrome e2e · bridge-e2e · firefox e2e) && playwright test
pnpm typecheck       # wxt prepare && tsc --noEmit
pnpm lint            # wxt prepare && oxlint --deny-warnings   (lint:fix to apply fixes)
pnpm format:check    # oxfmt --check   (pnpm format to write)
pnpm build           # production builds → .output/chrome-mv3 and .output/firefox-mv3
pnpm zip             # → .output/headerlab-<version>-{chrome,firefox,sources}.zip
pnpm crx             # wxt zip, then sign → .output/headerlab-<version>-chrome.crx
pnpm dev             # WXT dev server; dev:firefox → .output/firefox-mv3-dev. Neither launches a
                     # browser here: load the printed directory unpacked
pnpm screenshots     # README screenshots → docs/screenshots/
pnpm store:assets    # Chrome Web Store images → docs/store/assets/
pnpm store:probe     # read-only: raw Chrome Web Store status, and what .github/scripts/lib/cws.mjs reads
pnpm amo:probe       # read-only: what Firefox Add-ons holds
pnpm amo:submit      # build Firefox archives, then submit; credentials from env or 1Password
```

Single builds: `build:firefox`, `build:e2e`, `build:bridge-e2e`, `build:firefox-e2e`.

- **pnpm, not npm; the version is pinned** by `package.json`'s `packageManager`. CI runs
  `corepack enable`; on this machine corepack cannot fetch pnpm through the proxy, so install
  pnpm any other way — pnpm 10+ reads `packageManager` and switches itself to the pinned
  version. Never add a `+sha512…` suffix to that field: pnpm rejects it.
- `docs/superpowers/` and `docs/research/` say `npm run …` because they record what was run at
  the time. They are records, not instructions.
- **Run `pnpm test`, not a bare `vitest run`.** Several tests read the *built* output, and
  `tests/support/build.ts` fails loudly with the right command when the build is stale. Do not
  work around it.
- **Assume lifecycle scripts never run** (`ignore-scripts=true` in the developer's `~/.npmrc`,
  which pnpm reads; `postinstall: wxt prepare` has never fired here). Chain setup into the
  script body, as `test`, `typecheck` and `lint` do, never into a lifecycle hook.

## Architecture

```
lib/model/       types, zod schema (z comes from zod.ts), defaults, migrate.ts   pure
lib/compile/     AppState → DNR rules + diagnostics                              pure
                 capabilities.ts — the one table of what each target accepts
lib/permissions/ origins.ts, audit.ts pure · probe.ts is its one browser caller
lib/view/        popup view models                                               pure
lib/bridge/      protocol.ts (command schema), apply.ts (reducer), query.ts
                 (state → StatusPayload) pure · port.ts is its one browser caller
lib/storage/     state.ts, session.ts, useAppState.ts
lib/sync/        ruleSync.ts — the single reconcile loop · icon.ts
lib/target.ts    TARGET — the only reader of import.meta.env.BROWSER; pure code takes a Target
lib/utils.ts     cn — twMerge(clsx(…)); every components/ui/ file calls it
components/      popup UI · components/ui/ is vendored shadcn this repo owns and edits
entrypoints/     background.ts, popup/ · popup/style.css is the Tailwind entry point
public/          copied to the output root — theme.js, icon/
scripts/         not shipped: generators of committed images (icons, README
                 screenshots, store images) — scripts/README.md
.github/scripts/ not shipped: store release tooling, run by CI and by the maintainer
                 (sign, submit, probe) — .github/scripts/README.md
packages/        pnpm workspace: headerlab (CLI + native-messaging host, published to npm),
                 plugin (Claude Code / Codex skill, not published)
```

**Decision logic lives in a pure layer; browser calls live in one thin adapter each.**
`@webext-core/fake-browser` defines `declarativeNetRequest`, `permissions.*` and `chrome.action`
as throwing stubs, so anything touching them is isolated and tested with a hand-planted spy.

`tests/unit/purity.test.ts` enforces this for every file in `lib/compile/` and `lib/view/`, and
for the hand-written `EXPLICIT` list elsewhere. **A new pure file outside those two
directories is unguarded until you add it to `EXPLICIT` by name** — and so is any pure module
a guarded file imports as a runtime value, because the guard scans each file's own source only.
Never list the adapters (`lib/permissions/probe.ts`, `lib/bridge/port.ts`).

**One reconcile loop.** Every trigger — storage change, worker startup, permission grant or
revoke — funnels into `reconcile()` in `lib/sync/ruleSync.ts`, which recompiles from scratch and
replaces the rules wholesale. Add a trigger, never a parallel writer.

## Non-negotiables

- **Zero host permissions at install.** `permissions` is exactly
  `["storage", "declarativeNetRequestWithHostAccess"]`, `host_permissions` is absent, and
  `optional_host_permissions` is exactly `["<all_urls>"]` — `permissions.request()` rejects any
  origin not declared optional, so dropping it breaks Grant with nothing failing until someone
  clicks it. Chrome's `optional_permissions` is exactly `["nativeMessaging"]`; Firefox declares
  none (event pages close native ports, so there is no bridge there) and carries a pinned
  `browser_specific_settings.gecko` block. `tests/unit/manifest.test.ts` pins all of it. Access
  is requested at runtime, per host, from the Grant button only.
- **No network primitives in the shipped bundle** — no `fetch`, `XMLHttpRequest`, `WebSocket`
  or `sendBeacon` in `.output/chrome-mv3` or `.output/firefox-mv3`, with no exception list, so a
  stranger can verify it. `tests/unit/bundle.test.ts` reads the *builds*, because the only
  violation ever found came from tooling (Vite's modulepreload polyfill; `build.modulePreload:
  false` removes it). Its patterns match call and construction forms, never bare words. To
  mutation-test it, plant the call in an entrypoint — tree-shaking drops it anywhere else.
- **No new dependencies.** Nothing enforces this mechanically: a package installs quietly
  however new it is, so a successful install is no evidence of anything.
- **`packages/headerlab` is published to npm; the extension and the plugin are not.** Only the
  absence of `private: true` separates it from an accidental publish. See what ships with
  `cd packages/headerlab && npm pack --dry-run`. CI publishes on release; never publish by hand.

## No silent failures

The diagnostics layer exists so nothing fails quietly.

- **Never suppress without saying so.** A profile with no usable domain is not applied —
  a filter with no domain condition matches *every site* — and that must reach the screen.
- **An unusable domain is skipped per entry; only the last one suppresses the profile.**
  `conditions.ts` drops unusable entries before they reach `requestDomains`, and
  `suppressionReason` fails the profile closed when nothing usable is left. Neither half is safe
  alone: the filter without the check widens an all-invalid profile to every site; the check
  without the filter hands the transactional `updateDynamicRules` a malformed domain and loses
  every rule in the batch. A skipped entry is still said: `invalid-domain` is a warning while
  neighbours apply and an error when none do, and the row itself says the remedy.
- **Applying everywhere is a mode (`filter.allSites`), not an empty list.** All-sites keeps the
  stored list and compiles none of it, so ask `scopingHosts`, never `filter.domains`.
- **The mode costs `<all_urls>`, and the switch does not ask for it.** `permissions.request()` is
  called only from the Grant button; flipping a switch or adding a site is not consent. Mode on
  without access shows the pending (amber, never error) state, worded like a pending site row.
- **Never show something the user cannot reach.** Storage holding state the UI cannot display
  must not go on modifying headers. Equally, never overwrite a user's stored bytes to simplify
  the UI: a store that fails validation is not compiled, so there is nothing to neutralise.
- **One predicate, one definition.** The most expensive defect here was "is this profile alive"
  written four times and diverging. `isSuppressed` lives once in `lib/compile/suppression.ts`:
  call it, and ask `suppressionReason` for *why*. `HEADER_TOKEN`, `scopingHosts` and the
  profile colour list are the same lesson.
- The Rules panel's readout counts `blocked` so it can never read healthy while zero rules go
  out; each cause is said where it can be acted on (the row, the run-state switch, "N sites need
  access").

## Testing

Three layers: pure logic without a browser, adapters with hand-planted spies, e2e against a
loaded extension. The e2e tests that send a real request through the loopback echo server and
read the headers back are the strongest evidence in the repo — do not weaken them.

- **The recurring defect is an assertion that cannot fail.** For every assertion ask *what wrong
  implementation would still pass this?* Prefer `toEqual`/`toHaveLength`; use `toContain` only
  where a partial match is the intent, with a comment saying why. Assert absence before
  presence.
- **Mutation-verify**: break the implementation, watch that test go red, restore. Commit first —
  a `git checkout --` revert has discarded real edits here. Mutate by line number and re-read
  the line: comments here name the identifiers they discuss, so a first-occurrence replace can
  land in prose and every step reports success.
- **Before trusting a guard over a state, check its fixture reaches that state.**
- **Guards guard something.** Delete a guard only when its subject is gone; if the behaviour
  survives in a new form, move the test. Watch for guards pinning elements that no longer render.
- jsdom needs a per-file `// @vitest-environment jsdom` docblock (the global environment is
  `node`). `@testing-library/jest-dom` is not installed: plain vitest matchers only.

## Conventions

- Commits and pull requests in **English**; history before `49f7804` is Korean and stays.
  `<type>: <description>` with feat, fix, refactor, docs, test, chore, perf, ci. **Squash merges
  only.**
- Design docs in `docs/superpowers/specs/`, plans in `docs/superpowers/plans/`, measured spikes
  in `docs/research/`. A spike that contradicts a design is a success — fix the design.
- README screenshots are generated by `pnpm screenshots`, never cropped by hand. The five READMEs
  (`README.md`, `docs/README.{ko,ja,zh,es}.md`) share their `bash` commands (`docs.test.mjs`
  checks), the store badge URL and "Node 24" in words (neither is checked).
- **Touching `packages/headerlab/` means reviewing
  `packages/plugin/skills/headerlab/SKILL.md` in the same change** (`.claude/rules/cli-bridge.md`).
- Measure rather than recall: back every figure you write down with the command that
  re-derives it, and state the state it was measured in.

## Path-scoped rules

`.claude/rules/` loads each file when you read a matching path. Before an operation that starts
without reading files — cutting a release, submitting to a store, publishing — read the matching
file yourself. Code comments that cite a CLAUDE.md section by its old name mean the file in the
last column.

| File | Covers | Old section |
| --- | --- | --- |
| `toolchain.md` | pnpm, lockfile, install scripts, oxlint, oxfmt, TypeScript, Tailwind | Toolchain |
| `ci-release.md` | CI jobs, action pinning, release-please, tags, changelogs, npm | CI, Release |
| `chrome-web-store.md` | listing, verified CRX signing, store API, store assets | Chrome Web Store |
| `firefox-amo.md` | AMO submission, credentials, throttling, listing, sources archive | Firefox Add-ons |
| `extension-runtime.md` | DNR, permissions, WXT, migrations, Firefox, runtime gaps | Platform traps |
| `popup-ui.md` | layout rules, one-line text, styling traps, measuring the rail | Interface |
| `testing.md` | suites, e2e, colour coverage, mutation and race discipline, CLI tests | Testing |
| `cli-bridge.md` | the published CLI, native-messaging host, socket, skill review | — |

The old Known gaps section was split by area: into these files and the list below.

## Known gaps

- **The popup shows one rule set.** `compile()` handles all of `AppState.profiles`, but
  `resolveSingleProfile` picks one and `App.tsx` *truncates storage* to it, so a profile the
  screen cannot show cannot modify headers invisibly. Live code with no UI, not a dormant feature.
- **Tab lock is half-built.** `allocate` routes a locked profile to the session ruleset and
  `filterToCondition` takes the `tabId`, both tested; nothing sets `tabLock.enabled`. Not dead.
- Not built, deliberately: JSON export/import, the regex/`pathPattern` UI and its RE2
  validation, a theme toggle (the theme follows the OS). If import is ever built, its validation
  comes first — import is what makes the regex surface reachable.
