# HeaderLab

Chrome MV3 extension that modifies HTTP request and response headers. It replaces
ModHeader, which was pulled from the Chrome Web Store after a hidden tracker was found
in it.

**That history is the reason the project exists, and it decides arguments.** The trust
posture below and the "no silent failures" rule are not preferences — they are the
product. When a change trades either away for convenience, the change is wrong.

## Commands

```bash
npm test           # wxt build && vitest run  — the build is not optional, see below
npm run test:e2e   # wxt build --mode e2e && playwright test
npm run compile    # tsc --noEmit
npm run build      # production build → .output/chrome-mv3
npm run dev        # WXT dev server
```

**Run `npm test`, not `npx vitest run`.** Several tests assert against *built* output,
and the bare tools do not build. Running them directly reports on a stale artifact —
this has produced both a false green that silently disabled a guard and a false red
that cost an hour. `tests/support/build.ts` now detects staleness and fails loudly with
the right command, so a bare run tells you rather than lying; do not work around it.

## Architecture

```
lib/model/       types, zod schema, defaults          pure
lib/compile/     AppState → DNR rules + diagnostics   pure
lib/permissions/ origins.ts, audit.ts pure · probe.ts is the only browser caller
lib/view/        popup view models                    pure
lib/storage/     state.ts, session.ts, useAppState.ts
lib/sync/        ruleSync.ts — the single reconcile loop
components/      popup UI
entrypoints/     background.ts, popup/
```

**Decision logic lives in a pure layer; browser calls live in one thin adapter each.**
This is not taste. `@webext-core/fake-browser` defines `declarativeNetRequest`,
`permissions.*` and `chrome.action` as **throwing stubs**, so anything touching them
must be isolated and tested with a hand-planted spy. The architecture is what that
constraint produced.

`tests/unit/purity.test.ts` enforces it. It auto-discovers `lib/compile/*.ts` but covers
`lib/permissions/` and `lib/model/` by an **explicit list** — a new pure file elsewhere
is unguarded unless you add it.

**One reconcile loop.** Every trigger — storage change, worker startup, permission
grant or revoke — funnels into `reconcile()` in `lib/sync/ruleSync.ts`. It recompiles
from scratch and replaces the rules wholesale, so it is idempotent and there is no
second path for state to drift down. Add a trigger, not a parallel writer.

## Non-negotiables

- **Zero host permissions at install.** `permissions` is exactly
  `["storage", "declarativeNetRequestWithHostAccess"]` and `host_permissions` must be
  absent. `tests/unit/manifest.test.ts` asserts the exact list. Access is requested at
  runtime, per host, through the Grant flow.
- **No network primitives in the shipped bundle** — no `fetch`, `XMLHttpRequest`,
  `WebSocket` or `sendBeacon`. Checkable by reading `.output/chrome-mv3` with no
  exception list. (Vite's modulepreload polyfill once left a dead `fetch(` literal in
  the bundle; `build.modulePreload: false` removes it.)
- **No new dependencies.** The npm registry has a rolling 72-hour publish quarantine —
  recently published packages fail with `ETARGET`. Do not bypass it, and do not run
  `npm audit fix`. `.npmrc` also sets `ignore-scripts=true`, so `postinstall`,
  `pretest` and `prepare` **never fire**; chain setup into the script body instead.

## Platform traps that have already cost time

Each of these was found the expensive way. Do not re-derive them.

**MV3 blocks inline scripts.** Extension pages run under `script-src 'self'` with no
`unsafe-inline`, so an inline `<script>` in `popup.html` silently never executes. The
theme bootstrap lives in `public/theme.js` as a classic script — not a module, which
would defer past first paint and flash.

**`updateDynamicRules` is transactional.** One malformed entry invalidates the entire
batch, not its own rule. `lib/compile/validate.ts` exists because of this. Known
triggers: a header name violating RFC 7230, and `append` on a request header outside
Chrome's 21-header allowlist.

**`permissions.contains()` throws on a malformed match pattern** rather than returning
false, and **a throw poisons the whole call** — a valid origin batched beside a bad one
loses its answer too. `lib/permissions/probe.ts` therefore probes one origin per call,
each caught individually.

**The permission ladder has six rungs, not four.** `contains()` is a subset check, so
`*://` demands both schemes and an `http://`-only grant matches none of the `https`/
`*://` rungs. Without the `http` rungs, `localhost` shows a false "needs permission" —
measured in `docs/research/2026-08-01-permission-audit-spike.md`.

**DNR's `requestDomains` is host-only** and silently accepts ports, schemes and paths,
producing a rule that never matches. **Normalize, don't reject** — that spike's
conclusion. `analyzeDomain` strips a leading `*.`/`.`, a trailing `.` (each to a fixed
point) and a trailing port; `effectiveDomain` is applied at write time so the stored
value *is* the value that operates. The port strip deliberately does **not** loop:
looping would reduce `example.com:80:90` to a plausible-looking host.

**WXT specifics.** Storage via `#imports`, not `wxt/storage`. Keys carry an area prefix
(`local:`, `session:`). `public/` is copied to the output root. Output directories are
mode-suffixed — `--mode e2e` lands in `chrome-mv3-e2e`. E2E fixtures seeding storage
must also seed the companion version key at the **current** `STATE_VERSION`:
`{ state, state$: { v: 2 } }`.

**Migrations run once, at module evaluation — not per read.** WXT builds the migration
promise inside `defineItem`, and every `getValue()` awaits that one promise. A value
written to `local:state` *after* `lib/storage/state.ts` was imported is therefore never
migrated, which is why a fixture planting an old shape has to plant the matching version
too rather than relying on the migration to fix it. Testing the migration itself needs
`vi.resetModules()` before importing both fake-browser and `state.ts`, so the seed lands
in front of the read — `tests/unit/migrate.test.ts` does this.

## No silent failures

The diagnostics layer exists so nothing fails quietly. Two rules follow from it:

**Never suppress without saying so.** A profile with no usable domain is not applied —
because a filter with no domain condition matches *every site* — and that suppression
must reach the screen. Fail-open is asymmetric here: headers skip per row, domains
suppress the whole profile.

**Applying everywhere is a mode, not an empty list.** `filter.domains: []` used to mean
both "not scoped yet" and "deliberately everywhere", and the standing warning about it
existed only because the code could not tell those apart. `filter.allSites` names the
second one, so the first can mean what it looks like: nothing applies, stated calmly
(`no-scope`, severity `incomplete`) rather than warned about. All-sites keeps the stored
site list and compiles none of it, so the switch is reversible — which means **what the
list holds and what scopes the rule are no longer the same thing.** Ask `scopingHosts`,
never `filter.domains`; the conflict detector read the list directly and would have
judged an all-sites profile narrow. The mode costs `<all_urls>`, requested in the click
that turns it on.

**Never show something the user cannot reach.** Storage holding state the UI cannot
display must not go on modifying headers. Equally, do not write over a user's stored
bytes to make the UI simpler: a store that fails validation is never compiled, so
there is nothing to neutralise and nothing to justify an unprompted overwrite.

**One predicate, one definition.** The most expensive defect in this repo's history was
"is this profile alive" implemented four times and then diverging. `isSuppressed` lives
once in `lib/compile/suppression.ts` — call it, never restate it, and when you need to
know *why* a profile is suppressed ask `suppressionReason` rather than re-reading the
fields: the rail and the diagnostics both word themselves from it. `HEADER_TOKEN`,
`scopingHosts` and the profile colour list are the same lesson.

## Testing

Three layers: pure logic without a browser, adapters with hand-planted spies, e2e
against a loaded extension. The two e2e tests proving headers change on the wire are the
strongest evidence in the repo — do not weaken them.

**The recurring failure mode is an assertion that cannot fail.** One phase shipped nine
defects and every one was this: `toContain` where an exact value was available, a
fixture satisfying one of two conditions so a mutation stayed invisible, a single-click
test for three-step behaviour, an assertion pinning an element that can no longer
render. Later reviews found the sharper version — assertions that were *absent*, not
weak.

So, for every assertion: **what wrong implementation would still pass this?** Prefer
`toEqual`/`toHaveLength`; use `toContain` only where a partial match is the actual
intent, with a comment saying why. Assert absence *before* presence — a DOM-text check
survives an "always rendered" mutation.

**Mutation-verify.** Break the implementation, watch that specific test go red, restore.
Do this on uncommitted work at your peril: a `git checkout --` revert has discarded real
edits here. Commit first.

**jsdom** needs a per-file `// @vitest-environment jsdom` docblock; the global
environment is `node`. **`@testing-library/jest-dom` is not installed** — plain vitest
matchers only, no `toBeInTheDocument`.

**Guards guard something.** Delete a guard only when its subject is gone; if the
behaviour survives in a new form, the test moves rather than dies. Watch for the
opposite too — the contrast guard has twice been caught pinning a pair for an element
that no longer renders, passing while describing nothing.

## Conventions

- Commits: `<type>: <description>`, Korean subject line. Types: feat, fix, refactor,
  docs, test, chore, perf, ci.
- The repo allows **squash merges only**.
- Design docs in `docs/superpowers/specs/`, plans in `docs/superpowers/plans/`,
  measured spikes in `docs/research/`. A spike that contradicts a design is a success —
  fix the design.

## Known gaps

- `stateItem.watch` puts values into state without validation. Pre-existing; reachable
  only by an external writer.
- The Tailwind, shadcn, Radix and Lucide packages are **dead code**. Nothing imports
  `components/ui/`, no shell file uses a Tailwind class, and none of them reach the
  bundle. The UI is React plus one hand-written stylesheet. They stay in
  `package.json` only because touching the lockfile under the publish quarantine is a
  risk with no upside.
- Not built, deliberately: JSON export/import, tab lock, regex/`pathPattern` UI and
  their RE2 validation, theme toggle. If import is ever built, its validation must come
  first — import is what makes the regex surface reachable.
