# HeaderLab

Chrome MV3 extension that modifies HTTP request and response headers. It replaces
ModHeader, which was pulled from the Chrome Web Store in July 2026 after a hidden
tracker was found in it.

**That history is the reason the project exists, and it decides arguments.** The trust
posture below and the "no silent failures" rule are not preferences — they are the
product. When a change trades either away for convenience, the change is wrong.

## Commands

```bash
npm run check        # typecheck · lint · format:check · test — what CI runs, in one command
npm test             # wxt build && vitest run  — the build is not optional, see below
npm run test:e2e     # wxt build --mode e2e && playwright test
npm run typecheck    # wxt prepare && tsc --noEmit
npm run lint         # oxlint --deny-warnings   (npm run lint:fix to apply fixes)
npm run format:check # oxfmt --check            (npm run format to write)
npm run build        # production build → .output/chrome-mv3
npm run dev          # WXT dev server
npm run screenshots  # wxt build && node scripts/screenshots.mjs → docs/screenshots/
```

**`typecheck`, not `compile`.** The script was renamed when CI arrived; the dated plans
under `docs/superpowers/plans/` still say `npm run compile` because they are records of
what was run at the time, not instructions for now.

**Run `npm test`, not `npx vitest run`.** Several tests assert against *built* output,
and the bare tools do not build. Running them directly reports on a stale artifact —
this has produced both a false green that silently disabled a guard and a false red
that cost an hour. `tests/support/build.ts` now detects staleness and fails loudly with
the right command, so a bare run tells you rather than lying; do not work around it.

## Architecture

```
lib/model/       types, zod schema, defaults, migrate.ts   pure
lib/compile/     AppState → DNR rules + diagnostics        pure
lib/permissions/ origins.ts, audit.ts pure · probe.ts is its one browser caller
lib/view/        popup view models                         pure
lib/storage/     state.ts, session.ts, useAppState.ts
lib/sync/        ruleSync.ts — the single reconcile loop · icon.ts
components/      popup UI
entrypoints/     background.ts, popup/
public/          copied to the output root — theme.js, icon/
scripts/         make-icons.mjs, screenshots.mjs — generators, not shipped
```

**Decision logic lives in a pure layer; browser calls live in one thin adapter each.**
This is not taste. `@webext-core/fake-browser` defines `declarativeNetRequest`,
`permissions.*` and `chrome.action` as **throwing stubs**, so anything touching them
must be isolated and tested with a hand-planted spy. The architecture is what that
constraint produced.

`tests/unit/purity.test.ts` enforces it, and **it does not cover everything the tree
above calls pure.** Two directories are auto-discovered, so a new file in either is
guarded for free: `lib/compile/` and `lib/view/`. Everything else is a hand-written list
of exactly three files — `lib/permissions/origins.ts`, `lib/permissions/audit.ts` and
`lib/model/migrate.ts` — because `lib/permissions/` also holds the adapter (`probe.ts`)
that must *not* be guarded, so there is no directory-shaped rule to apply. `schema.ts`,
`defaults.ts` and `types.ts` are pure by convention and unguarded in fact. A new pure
file outside those two directories is unguarded until someone adds it by name.

**One reconcile loop.** Every trigger — storage change, worker startup, permission
grant or revoke — funnels into `reconcile()` in `lib/sync/ruleSync.ts`. It recompiles
from scratch and replaces the rules wholesale, so it is idempotent and there is no
second path for state to drift down. Add a trigger, not a parallel writer.

## Non-negotiables

- **Zero host permissions at install.** `permissions` is exactly
  `["storage", "declarativeNetRequestWithHostAccess"]` and `host_permissions` must be
  absent. `tests/unit/manifest.test.ts` asserts the exact list. Access is requested at
  runtime, per host, through the Grant flow.
  **`optional_host_permissions` is the other half of that and is not optional.** It is
  exactly `["<all_urls>"]`, and `permissions.request()` rejects any origin the manifest
  did not declare as optional — so dropping it leaves the all-sites switch flipping into
  a mode whose grant can never be obtained, with nothing failing until somebody clicks
  Grant. The same test pins the value, not merely the key.
- **No network primitives in the shipped bundle** — no `fetch`, `XMLHttpRequest`,
  `WebSocket` or `sendBeacon`. Checkable by reading `.output/chrome-mv3` with no
  exception list, which is the point: the claim is verifiable by a stranger who trusts
  none of this file. (Vite's modulepreload polyfill once left a dead `fetch(` literal in
  the bundle; `build.modulePreload: false` removes it.)
  **Nothing automates that check.** It is the only non-negotiable here with no test
  behind it — `grep -rE 'fetch\(|XMLHttpRequest|WebSocket|sendBeacon' .output/chrome-mv3`
  is currently a thing a person has to remember to run, and it currently returns
  nothing. The other two are pinned by `tests/unit/manifest.test.ts`; this one is a
  standing offer to regress silently, and a suite that reads the build already exists to
  put it in.
- **No new dependencies.** npm here runs under a rolling 72-hour publish quarantine, so
  a recently published package fails with `ETARGET`. Do not bypass it, and do not run
  `npm audit fix`.
  **Assume lifecycle scripts do not run.** `ignore-scripts=true` silently skips
  `postinstall`, `pretest` and `prepare`. **Chain setup into the script body**, never
  into a lifecycle hook — `npm test` runs `wxt build && vitest run` for exactly this
  reason.
  Both settings come from the developer's `~/.npmrc`, **not from this repo** — there is
  no `.npmrc` here, so neither is reproducible from a clone and a contributor on npm's
  defaults sees the opposite behaviour on both counts. `npm config list` is what
  actually answers it: the quarantine shows up as a resolved `before` date (npm reads
  `min-release-age` in days and turns 3 into a timestamp 72 hours back), and
  `ignore-scripts` shows up verbatim. `package.json` still declares
  `postinstall: wxt prepare`, and here it has never once fired — which is why
  `typecheck` is `wxt prepare && tsc --noEmit` rather than `tsc --noEmit` alone.
  `tsconfig.json` extends `./.wxt/tsconfig.json`, so without that chained prepare a
  fresh clone type-checks against a file that does not exist yet. `wxt prepare` is
  177ms and idempotent; running it every time costs less than the trap does.

## Toolchain

**oxlint runs `correctness` only, as an error.** Measured on this tree before choosing:
correctness 6, perf 16, suspicious 187, pedantic 220, restriction 1208, style 3990. The
big numbers are not defects — 162 of `suspicious` are `react-in-jsx-scope`, a rule for
the *old* JSX transform that React 19 does not use, and most of `style` is now oxfmt's
job. A category that needs a page of suppressions to go green is a category nobody
reads. CI adds `--deny-warnings` so a rule that arrives at warning level in a future
release still stops the build.

**`lint` chains `wxt prepare`, and that is a correctness fix rather than a convenience.**
`tsconfig.json` extends `./.wxt/tsconfig.json`, which is what oxlint resolves `@/…` imports
through. With that file missing — a fresh clone under `ignore-scripts=true` — oxlint does
not complain. It **exits 0 having checked nothing** for the alias-resolving rules that
`correctness` enables (`import/default`, `import/namespace`), across 126 `@/…` imports.
Reproduced both ways with a one-line probe importing a non-existent default: an error with
`.wxt/tsconfig.json` present, silence and exit 0 with it moved aside. A lint that passes
because it looked at nothing is "no silent failures" inverted. `format`/`format:check` are
deliberately *not* chained — oxfmt reads no tsconfig and resolves nothing.

**`coverage/` is gitignored on purpose.** `@vitest/coverage-v8` is installed, so
`--coverage` is one flag away, and its output is untracked — which puts it in
`tests/support/build.ts`'s source set and reports **both** builds stale. Every
build-reading test then fails with a message about staleness rather than about coverage.
Never cache or pass `.output/` between CI jobs for the mirror-image reason: a restore
writes fresh mtimes *after* checkout, so `isStale()` returns false against sources the
artifact was not built from — a silent false green, which is the exact thing the guard
exists to prevent. Both builds are under a second; rebuild in each job.

**Setting `plugins` replaces oxlint's base set; it does not extend it.** The three that
are on by default (typescript, unicorn, oxc) have to be re-listed or they silently stop
running. And an override's `plugins` key does **not** enable a plugin — measured: with
`vitest` declared only in the `tests/**` override, `oxlint tests/unit/schema.test.ts`
reported nothing while `oxlint --vitest-plugin` on the same file reported four. Overrides
retune rules; only the top-level list turns a plugin on.

**Suppressions are per-site and carry a reason.** Four exist, and each is a rule that
cannot see the intent rather than a rule this repo disagrees with: two `no-control-regex`
on `/^[\x00-\x7F]/` ASCII range checks, one `no-empty-pattern` on Playwright's
`async ({}, use)` fixture idiom, one `react-hooks/exhaustive-deps` on the truncating
effect in App.tsx. The disable comment must be the line *immediately* before its subject —
a two-line comment ending in the directive suppresses the second comment line and nothing
else, which reads as working and is not.

**oxfmt formats code, not prose.** `entrypoints/popup/style.css`, `docs/**`, `**/*.md` and
`**/*.html` are in `ignorePatterns`: the stylesheet is hand-tuned at 4-space indent with a
comment explaining why, and reformatting it to 2-space is 1124 lines of churn for a
machine's opinion. `printWidth: 100` was chosen by sweeping 80/90/96/100/110/120 and taking
the minimum churn (40 files at 100, against 50 at 80 and 45 at 120). `singleQuote: true`
matches what the repo already wrote. **oxfmt also sorts `package.json` keys** by default —
that is why `dependencies` now precedes `devDependencies`.

**`package-lock.json` records canonical `registry.npmjs.org` URLs, never the proxy's.**
A `resolved` URL naming `nexus.mng.musinsa.io` is unreachable from anywhere but this
office, and 420 of them were in the lockfile — a public repository that only its author
can install. `replace-registry-host=always` does **not** fix it: it swaps the host and
keeps the path, producing `registry.npmjs.org/repository/npm-all/zod/-/zod-4.4.3.tgz`,
which 404s. Measured on CI. The whole base has to be rewritten —
`https://nexus.mng.musinsa.io/repository/npm-all/` → `https://registry.npmjs.org/` — and
that is safe because the `integrity` hashes are untouched: the URL says where to look,
the hash says what is acceptable. Locally npm rewrites canonical URLs back to the
configured registry on its own, which is why the 428 entries that were already in this
form have always worked. **If a future lockfile write reintroduces proxy URLs, rewrite
them before committing.**

**A local `npm install` will corrupt the lockfile. `npm ci` will not.** The proxy serves
stale metadata for oxlint's and oxfmt's per-platform native bindings — it carries
`binding-darwin-arm64` at the current version and nothing newer than oxlint 1.43.0 /
oxfmt 0.58.0 for linux, and asking for a newer one 404s instead of refreshing the
packument. So an `npm install` here writes the 18 non-darwin bindings as entries with **no
version at all**, and both `npm ci` *and* `npm install` then die on those stubs with
`Invalid Version:` before touching the network. `registry.npmjs.org` is unreachable from
this machine (503), so the correct entries cannot be produced here at all.

They came from CI, which can see the whole registry, and are committed. **Use `npm ci`.**
If you must `npm install` — adding a dependency — check `git diff package-lock.json` for
versionless entries and proxy URLs before committing, or get the lockfile back from a CI
run's install step. The 18 entries carry `os`/`cpu` constraints, so `npm ci` on macOS
skips fetching the ones it cannot use; having them in the file costs nothing locally and
is what makes the repository installable anywhere else.

The workaround is visible rather than silent: the `check` job diffs `package-lock.json`
after installing, warns when it drifted, and uploads the resolved lockfile as an artifact.
**Commit that artifact and switch the install step back to `npm ci`** — that is the fix,
and the workflow is written to hand it to you rather than to hide the gap.

**CI pins every action to a commit SHA**, with the tag it resolved from in a comment
beside it. A tag is mutable by the account that owns it, and this repository's premise is
that its supply chain is checkable. Re-resolve with
`gh api repos/<owner>/<repo>/git/ref/tags/<tag> --jq .object.sha` when bumping; update the
SHA and the comment together.

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
judged an all-sites profile narrow.

**The mode costs `<all_urls>`, and the switch does not ask for it.** The toggle sets the
mode; `permissions.request()` is called only from the Grant button. Flipping a switch is
not consent to the largest grant this extension can request, and adding a site does not
prompt either — it produces a pending row with a Grant button. All-sites reaches the same
state, so it must offer the same remedy rather than a second vocabulary. The gap between
"mode on" and "access held" is legible instead: `data-granted="no"`, amber (the pending
palette, never the error one — the mode is incomplete, not wrong), and a dot named
"Awaiting permission" in the same words a pending site row uses.

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

## Interface

**A control appearing must not resize what holds it.** Reserve the space instead:
size the container to its largest state and let the element occupy or vacate it. A
Grant button that pushes the rows below it down, a note that grows its panel, a
badge that widens a header — each moves everything downstream by a few pixels at the
moment the user is reading it, and in a popup this size that is most of the screen.
Hide-and-show reflow is the single thing that most makes an interface feel unfinished.

This applies to any element whose presence is state-dependent, which in the rail is
most of them: Grant, the pending and unusable notes, the tooltip, the mode switch's
own sub-line. When adding one, ask what its absence looks like — if the answer is
"everything else sits higher", the layout is wrong, not the element.

**State changes appearance, not geometry.** Colour, weight, opacity and content may
follow state freely; box dimensions and positions should not.

## Testing

Three layers: pure logic without a browser, adapters with hand-planted spies, e2e
against a loaded extension. Two of the five e2e tests drive a real request through the
loopback echo server and read the headers back off it; those two are the strongest
evidence in the repo — do not weaken them. The other three cover the popup rendering
from stored state and the two layout guards (nothing wider than what holds it; a control
appearing moves nothing).

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
- **The README screenshots are generated, never cropped by hand.** `npm run screenshots`
  builds, loads the production bundle in real Chrome and photographs the popup, so a UI
  change is a re-run rather than an excavation — the same bargain `scripts/make-icons.mjs`
  makes. Its one edit to the loaded copy is `host_permissions` for the example hosts,
  because `permissions.request()` opens a dialog Playwright cannot click and a *granted*
  row cannot otherwise be photographed; the README states that under the images rather
  than letting them imply a grant flow that did not happen. Its waits are written as the
  row states each shot expects, since the popup renders every row optimistically green
  in the frame before the permission probe answers — a duration would photograph
  whichever frame the machine landed on.

## Known gaps

- `stateItem.watch` puts values into state without validation. Pre-existing; reachable
  only by an external writer.
- The Tailwind, shadcn, Radix and Lucide packages are **dead code**. Nothing imports
  `components/ui/`, whose three files are the only importers of `lib/utils.ts` (`cn`),
  no shell file uses a Tailwind class, and none of them reach the bundle. The UI is
  React plus one hand-written stylesheet. They stay in `package.json` only because
  touching the lockfile under the publish quarantine is a risk with no upside.
- **The popup shows one rule set.** `AppState.profiles` is an array and `compile()`
  handles the whole array, but `resolveSingleProfile` picks one and App.tsx *truncates
  storage* to it — an extra profile the screen cannot show would otherwise go on
  modifying headers invisibly. So the multi-profile machinery is live code with no UI,
  not a dormant feature.
- **Tab lock is half-built, not absent.** `allocate` already routes a locked profile to
  the session ruleset and `filterToCondition` already takes the `tabId`, both under
  test; what does not exist is any way to set `tabLock.enabled`. Do not delete that path
  as dead — delete the guard only when its subject is gone.
- Not built at all, deliberately: JSON export/import, the regex/`pathPattern` UI and its
  RE2 validation, the theme toggle (the theme follows the OS). If import is ever built,
  its validation must come first — import is what makes the regex surface reachable.
