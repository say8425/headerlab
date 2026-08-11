# HeaderLab

Chrome MV3 extension that modifies HTTP request and response headers. It replaces
ModHeader, which was pulled from the Chrome Web Store in July 2026 after a hidden
tracker was found in it.

**That history is the reason the project exists, and it decides arguments.** The trust
posture below and the "no silent failures" rule are not preferences — they are the
product. When a change trades either away for convenience, the change is wrong.

## Commands

```bash
pnpm check           # typecheck · lint · format:check · test — four of CI's five jobs, in one command
pnpm test            # wxt build && vitest run  — the build is not optional, see below
pnpm test:e2e        # wxt build --mode e2e && playwright test
pnpm typecheck       # wxt prepare && tsc --noEmit
pnpm lint            # wxt prepare && oxlint --deny-warnings   (lint:fix to apply fixes)
pnpm format:check    # oxfmt --check            (pnpm format to write)
pnpm build           # production build → .output/chrome-mv3
pnpm zip             # builds, then → .output/headerlab-<version>-chrome.zip
pnpm dev             # WXT dev server
pnpm screenshots     # wxt build && node scripts/screenshots.mjs → docs/screenshots/
```

**pnpm, not npm, and the version is pinned.** `package.json`'s `packageManager` names
`pnpm@11.20.0`; `corepack enable` is the whole setup. Everything under `docs/superpowers/`
and `docs/research/` says `npm run …` because those are records of what was run at the
time, not instructions for now — the same reason they say `npm run compile` for what is
now `typecheck`.

**Run `pnpm test`, not a bare `vitest run`.** Several tests assert against *built* output,
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
lib/utils.ts     cn — twMerge(clsx(…)); every components/ui/ file calls it
components/      popup UI — AddSiteField RuleCard RulePanel ScopeRail SiteRow
                 TypeChecklist
components/ui/   shadcn primitives, vendored: badge button checkbox input
                 separator switch tooltip. Source this repo owns and edits.
entrypoints/     background.ts, popup/ · popup/style.css is the Tailwind entry
                 point — two hand-written palettes, the @theme inline bridge
                 that exposes them as utilities, and the shadcn data-* variants
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
`defaults.ts`, `types.ts` and `lib/utils.ts` are pure by convention and unguarded in
fact. A new pure file outside those two directories is unguarded until someone adds it
by name.

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
  `tests/unit/bundle.test.ts` guards it, and it reads the **build**, not the sources —
  the modulepreload incident is the proof that this arrives from tooling rather than from
  authored code, so a source-level check would have missed the only instance there has
  ever been. Mutation-verified: a `fetch()` planted in `entrypoints/background.ts` fails
  it naming `background.js`. Note the first attempt at that mutation planted an unused
  export in `lib/storage/session.ts` and the suite stayed green — correctly, because
  tree-shaking meant it never shipped. Plant in an entrypoint or you are testing nothing.
  The patterns match **call and construction forms**, never bare words: `fetch`,
  `websocket` and `xmlhttprequest` all occur in the bundle as harmless substrings (React
  DOM's `prefetchDNS`/`fetchPriority`/`dns-prefetch`, and two DNR resource-type names the
  popup offers as checkboxes), and matching words would need exactly the exception list
  this claim promises there isn't one of. Two of the tests in that file exist to hold
  that line: one plants each forbidden form and requires the patterns to match, the other
  feeds them the benign substrings and requires they do not.
- **No new dependencies.** The rule stands; the thing that used to enforce it
  mechanically is **gone**. npm here ran under a rolling 72-hour publish quarantine, so a
  recently published package failed with `ETARGET` — and **pnpm does not read it**.
  Measured: `pnpm config get before` is `undefined` while `npm config list` still shows
  the resolved timestamp, because `min-release-age`/`before` is an npm setting. pnpm's own
  equivalent is `minimumReleaseAge`, and it is unset. So a fresh package now installs
  quietly; a successful install is no longer evidence that anything is old enough.
  **Assume lifecycle scripts do not run.** `ignore-scripts=true` is read by pnpm too —
  measured: `pnpm config get ignore-scripts` is `true`, and `rm -rf .wxt` followed by
  `pnpm install` leaves `.wxt/` absent, so the declared `postinstall: wxt prepare` has
  still never once fired here. **Chain setup into the script body**, never into a
  lifecycle hook — `pnpm test` runs `wxt build && vitest run` for exactly this reason, and
  `typecheck` is `wxt prepare && tsc --noEmit` rather than `tsc --noEmit` alone because
  `tsconfig.json` extends `./.wxt/tsconfig.json` and a fresh clone would otherwise
  type-check against a file that does not exist yet. `wxt prepare` is 177ms and
  idempotent; running it every time costs less than the trap does.
  Both settings come from the developer's `~/.npmrc`, **not from this repo** — there is
  no `.npmrc` here, so neither is reproducible from a clone.
  **A dependency's own build script is a separate mechanism, and an unanswered one fails
  the install rather than warning.** Exactly one package here asks: `spawn-sync`, reached
  through `wxt → web-ext-run → fx-runner`, WXT's Firefox runner, which this Chrome-only
  extension never invokes. `pnpm-workspace.yaml` denies it by name and says why. Answer the
  next one with `pnpm approve-builds '!<pkg>'` and let it write the key rather than
  hand-writing it — it is `allowBuilds` in pnpm 11 and was `ignoredBuiltDependencies` in
  10, and the version that does not own a spelling ignores it in silence.
  **`npm_config_ignore_scripts=false` does not override pnpm's `.npmrc`.
  `--ignore-scripts=false` does**, and the gap between them is why CI found this rather
  than this machine: the first form was measured here, reported nothing blocked, and this
  file was written to say "no package in this tree declares a build script at all". All
  five jobs failed on the first push. To reproduce what CI does, run
  `rm -rf node_modules && pnpm install --frozen-lockfile --ignore-scripts=false`.

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
`correctness` enables (`import/default`, `import/namespace`), across 141 `@/…` imports
(126 when this was written; the design-system branch added 15).
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
`**/*.html` are in `ignorePatterns`. The stylesheet is hand-tuned at 4-space indent, and
taking it off the list rewrites **150 of its 325 lines** — re-measured by dropping the
pattern, running `oxfmt`, and counting `git diff --numstat`. Two changes, both cosmetic:
4-space to 2-space throughout, and `"` to `'` inside the attribute selectors of the seven
`@custom-variant` blocks. The old figure was 1124, taken when the file was 1143 lines of
hand-written component classes; the redesign deleted every one of them and the file is now
a token bridge. **The ratio is what carried the decision and it barely moved — 98% of the
file then, 46% now** — so the answer is still to keep it ignored, but on a number someone
can reproduce rather than one three redesigns out of date. Re-derive both halves if you
touch that file; the denominator went stale once inside the very task that fixed it, by
nine lines added two commits earlier. (An earlier version of this sentence also said the
file carries "a comment explaining why" the indent is 4-space. It does not, and neither
did the file on `main`.)
Measured, one pattern at a time: dropping the stylesheet exposes it,
dropping `**/*.md` exposes CLAUDE.md and README.md, and `docs/**` and `**/*.html` **overlap**
— each alone can go without exposing anything, but dropping both exposes the two design
mocks under `docs/design/`. Note the measurement only works with the probe config written
into the repo root: `ignorePatterns` resolve relative to the config file, so a copy in
`/tmp` silently matches nothing and every pattern looks load-bearing.
`printWidth: 100` was chosen by sweeping 80/90/96/100/110/120 and taking the minimum churn
— 48 files at 100 against 58 at 80 and 53 at 120, counted over everything the config
actually formats. (An earlier note said 40/50/45; that was a narrower hand-written glob
set, and the *ordering* is what the choice rests on, which reproduces either way.)
`singleQuote: true` matches what the repo already wrote. **oxfmt also sorts `package.json`
keys** by default — that is why `dependencies` now precedes `devDependencies`.

**Writing about a utility ships it.** Tailwind v4 auto-detects sources by scanning the
tree as raw text, so a class name quoted in a *comment* is indistinguishable from one
used on an element and its CSS is emitted. Measured: the 143 B this repo's popup CSS grew
during the documentation task came entirely from prose — docblocks and test comments
naming classes while explaining a bug — and excluding `tests/` and `scripts/` leaves the
remaining CSS byte-identical across those commits. Currently `tests/` contributes 324 B
and `scripts/` 30 B, 0.8% of 43,790 B, which is not worth two more `@source not` lines;
that is a re-measurable ruling, not a permanent one. Two things not to waste time on:
`.superpowers/` contributes exactly **0 B** because auto-detection skips dot-directories,
and **`.md` files are not scanned at all** — probed by planting a unique utility in
CLAUDE.md and rebuilding, which changed nothing. That is why `@source not "../../docs"`
exists for the `.html` mocks in that tree rather than for its prose, and why class names
may be quoted freely *here* but cost bytes in a `.ts` comment.

**`pnpm-lock.yaml` records no URL at all, and that deletes a whole defect class.** The
`package-lock.json` it replaced carried a `resolved` URL per package, and this office's
proxy kept writing `nexus.mng.musinsa.io` into them — 397 on one base commit, a public
repository only its author could install, and `replace-registry-host=always` did not fix
it because it swapped the host and kept the path (`registry.npmjs.org/repository/npm-all/
zod/-/zod-4.4.3.tgz`, which 404s). pnpm's lockfile 9.0 carries `resolution:
{integrity: sha512-…}` and nothing else: measured on the committed file, **zero**
occurrences of the proxy host, zero of `registry.npmjs.org`, zero `tarball:` keys. The
registry is a config value read at install time, so one lockfile installs from whichever
registry the machine points at. There is nothing left to rewrite before committing.

**Never write the lockfile on this machine. `pnpm import` drops packages here, in
silence.** It converts `package-lock.json` rather than re-resolving, so the 812 versions
are the ones CI had already picked — but platform bindings are *optional* dependencies, and
for those it goes back to the registry. The proxy's packument for
`@oxfmt/binding-linux-x64-gnu` stops at **0.58.0** while `package.json` pins oxfmt
**0.60.0**, so the 18 non-darwin entries could not resolve and were dropped without a word.
The same run kept all 19 `@oxlint/binding-*@1.76.0`, because that packument does reach
1.77.0 — one tool silently mutilated, its neighbour intact, from one command.

**Nothing local can see it.** macOS never loads those bindings, so `pnpm check`,
`pnpm test:e2e` and a clean `--frozen-lockfile` install were all green on a lockfile that
could not install on Linux. Four of the five CI jobs passed too; `format` was the one that
died, with `Cannot find module '@oxfmt/binding-linux-x64-gnu'`.
`tests/unit/lockfile.test.ts` now closes that gap by pairing the platforms — whatever
`darwin-arm64` was resolved for, `linux-x64-gnu` must have been resolved for too — which
is a guard the machine that causes the defect can run.

The committed file came from CI: the same `pnpm import`, against a registry that can see
everything, uploaded as an artifact. **That is the loop to re-run** whenever a dependency
changes, and the diff proves it converts rather than drifts — 188 insertions, **zero**
deletions, all 18 of them the missing bindings. `pnpm install --frozen-lockfile`
re-resolves nothing and is the everyday command.

**corepack cannot fetch pnpm through the proxy**, so `corepack enable` is a CI-only
instruction. It builds the tarball URL as `<registry>/pnpm-11.20.0/-/pnpm-11.20.0.tgz`,
which 404s — the same path-shape bug that made `replace-registry-host` useless above.
Locally, install pnpm however you like and let the pin do the work: pnpm 10 and later read
`packageManager` and switch themselves to it, measured here by a pnpm 11.20.0 binary
reporting `9.15.9` while the field still said so. **Do not put a `+sha512…` integrity
suffix on that field** — corepack accepts that form, pnpm does not, and 9.15.9 refused
every command with `Invalid package manager specification … expected a semver version`.

**CI references actions by floating major — `actions/checkout@v7`, not a SHA and not
`@v7.0.1`.** This went SHA → exact tag → major, each step trading supply-chain strength
for legibility, and the trade is worth naming rather than discovering: a moved tag is a
real attack and a SHA is the only thing that forecloses it. What makes it acceptable here
is that those actions are published by GitHub itself, `ci.yml` holds only
`contents: read` with `persist-credentials: false`, and it never interpolates
`github.event.*`, so the blast radius of a hijacked action is this repository's own
source — which is public.

**The third-party action has arrived, and it is pinned to a SHA as promised.**
`googleapis/release-please-action` is the only one, and it sits in the only job holding
`contents: write` and `pull-requests: write`, so it clears none of the three conditions
above. `release-please.yml` names it by commit with the tag in a comment beside it. Resolve
a new one with `gh api repos/<owner>/<repo>/git/ref/tags/<tag> --jq .object.sha`; commit
`a1f8122` has the last version that did this for every action.

Patches and minors arrive on their own; a major bump is a manual bother, deliberately —
there is no dependabot here yet.

**CI is five jobs, one per check, and the split is what replaced `if: ${{ !cancelled() }}`.**
Typecheck, lint, format, unit and e2e used to be steps in one job, with that condition on
each so a push reported every failure instead of one per round trip. Separate jobs do the
same thing without the trick, and name the failing check in the PR's check list rather
than burying it in one job's log. The cost is honest and small: each job installs
dependencies again, and `format:check` takes 82ms against a setup measured in seconds. It
buys per-check status, and it is what was asked for.

**The setup those jobs share is a local composite action, `.github/actions/setup`.**
Five copies of the same six steps is the shape that drifts. Two things in it are surprising
at the point of use and carry a comment there: `corepack enable` runs *after* setup-node so
the shims land in the Node the job will use, and `cache: pnpm` is therefore unusable
because setup-node resolves the store before pnpm exists — hence the explicit
`pnpm store path` and `actions/cache` pair. A local action is in-repo source, so it adds no
supply-chain surface.

**Release is `release-please.yml`, on push to `main`.** It opens and grooms a release PR
from the conventional-commit subjects; merging that PR is what tags, releases, and — only
then — builds `pnpm zip` and attaches `.output/headerlab-<version>-chrome.zip` to the
release. Two things to know before wondering why something did not happen. **A release PR
opened with the default `GITHUB_TOKEN` does not trigger `ci.yml`**, which is GitHub's own
loop-prevention rule, so that PR shows no checks; a `workflow_dispatch` or a PAT is what
changes that, and neither is set up. And **there is no Chrome Web Store step**, unlike the
workflow this was modelled on: there is no listing, so a `wxt submit` step would need four
secrets that do not exist and would fail every release. Add it with the listing, not before.
The first run starts from **zero tags and zero releases**, so it reads the whole history and
its first changelog will hold every commit this repository has — expected, not a
misconfiguration. It proposes a version from `package.json`'s `1.0.0` and the
conventional-commit subjects above it rather than releasing `1.0.0` itself.

**The workflows carry almost no comments, and that is deliberate.** They had many, and they
restated what this file already says at more length. The reasoning lives here; the YAML
should be readable as YAML. What stayed is only what is surprising *at the point of use* —
the two in the composite action, why `--with-deps` runs on a cache hit, why `pnpm zip`
needs no build step before it, why one action is a hash, and why the release job checks out
unconditionally when the action that runs next needs no worktree (the step after it is a
*local* action, and a local action with no checkout is the "Can't find action.yml" failure;
hanging that on a conditional step is how it would be discovered on a release rather than
on a push).

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

**`cn` is `twMerge(clsx(…))`, and tailwind-merge groups by variant, not by property.**
So `bg-transparent` passed to a shadcn primitive does **not** displace that primitive's
own `dark:bg-input/30` — different group, both survive, and the `dark:` one wins wherever
it applies. Measured: `twMerge('dark:bg-input/30', 'bg-transparent')` returns both
classes; `twMerge('dark:bg-input/30', 'dark:bg-transparent')` returns one. This branch
paid for it twice — a switch track override that appeared to do nothing, and a grey box
under the header name input in dark only, which is `--card` under 30% `--input` at
rgb(44,52,62) and nothing a palette check can see. **To override a `dark:`-prefixed
default you must write the `dark:` form too**; `AddSiteField` and `RuleCard` both carry
an explicit `dark:bg-transparent` for exactly this reason.

**A layout measured headless is not a layout measured headed.** `::-webkit-scrollbar`
alone reserves 0px headless and 8px headed — same CSS, same build, and the whole of
`offsetWidth − clientWidth`. The 2×2 sits in `entrypoints/popup/style.css` beside
`scroll-list`, with the reproduction script in
`docs/research/2026-08-09-headless-vs-headed-scrollbar-gutter.md`. The trap is not the
scrollbar; it is that **every e2e test in this repo
runs headless** (`tests/e2e/fixtures.ts` passes no `headless` option and Playwright's
default is headless), so a layout fact established there may not be the user's. An
earlier spike concluded that styling the scrollbar cannot take Chromium out of overlay
mode — true headless, false headed, and it read as general because nothing recorded
which mode produced it. `scroll-list` sets the gutter *and* the scrollbar style because
that combination is the one row of the table where both modes agree. When adding a
layout assertion to the e2e suite, ask whether the thing being measured is mode-invariant;
when it is not, a screenshot is the instrument, not an assertion.

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
against a loaded extension. Two of the eleven e2e tests drive a real request through the
loopback echo server and read the headers back off it; those two are the strongest
evidence in the repo — do not weaken them. A third checks that a row Chrome would refuse
never reaches declarativeNetRequest while its sibling still does. The other eight cover
the popup rendering from stored state and seven layout guards: nothing wider than what
holds it, a control appearing moves nothing, an overflowing list clips nothing while its
neighbours stay put, a rule row's gutter chips match size *and* the row keeps its height
when toggled off (one test, not two), the ghost row at the end matches a minimum rule
row's height, the badge and the chip each keep a focus ring that reaches the screen, and
an error diagnostic replacing a value never resizes the row or moves the rows below it.

**A contrast pair is not a pixel, and nothing here reads one automatically.**
`tests/unit/contrast.test.ts` reads the two palettes out of the stylesheet and asserts
token against token, so a colour produced by alpha compositing or by tailwind-merge
picking a class the author did not expect is outside it by construction — the file now
says so at its top. It went green through a grey box that was plainly visible on screen.

**The e2e suite does not cover that gap.** It reads geometry — `getBoundingClientRect`
in eight places, `getComputedStyle(el).overflowY` in two — and no colour at all; there is
no snapshot comparison configured and zero `toHaveScreenshot`/`toMatchSnapshot` calls. So
the only output with pixels in it is `pnpm screenshots`, and **a human is what reads
it**; that is how the grey box was found. A colour defect born of alpha or merge order has
no automated guard today. Building one means adding a colour read or a snapshot comparison
to e2e — say so plainly rather than assuming a green run already covered it.

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

- Commits and pull requests: **English**, as of 2026-08-11. Everything before commit
  `49f7804` is Korean and stays that way — history is a record, not a style guide, and
  rewriting it would break every SHA this file cites. `<type>: <description>`. Types: feat,
  fix, refactor,
  docs, test, chore, perf, ci.
- The repo allows **squash merges only**.
- Design docs in `docs/superpowers/specs/`, plans in `docs/superpowers/plans/`,
  measured spikes in `docs/research/`. A spike that contradicts a design is a success —
  fix the design.
- **The README screenshots are generated, never cropped by hand.** `pnpm screenshots`
  builds, loads the production bundle in real Chrome and photographs the popup, so a UI
  change is a re-run rather than an excavation — the same bargain `scripts/make-icons.mjs`
  makes. Its one edit to the loaded copy is `host_permissions` for the example hosts,
  because `permissions.request()` opens a dialog Playwright cannot click and a *granted*
  row cannot otherwise be photographed; the README states that under the images rather
  than letting them imply a grant flow that did not happen. Its waits are written as the
  screen state each shot expects — the site-row states *and* the number of rule rows
  showing a problem — since the popup renders every row optimistically green in the frame
  before the permission probe answers, and a duration would photograph whichever frame the
  machine landed on. The problem count is asserted on all four shots and is `0` on three
  of them: those zeroes are what make `popup-blocked.png`'s `1` mean something, because a
  build that errored on every row would otherwise pass the shot whose whole subject is one
  row failing.

## Known gaps

- `stateItem.watch` puts values into state without validation. Pre-existing; reachable
  only by an external writer.
- `components/ui/separator.tsx` is the one primitive nothing imports. Every other file
  in that directory has a call site; this one was pulled in with them and never placed.
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
- **`COLOR_TOKENS` in `tests/unit/contrast.test.ts` catches declaration drift, not
  orphaning.** It asserts both palettes declare exactly the same named set, so a renamed
  or dropped token fails loudly. It does not ask whether a token either palette still
  declares is actually painted by anything — a token can sit in both palettes, pass
  every check in that file, and correspond to nothing on screen. `--pending-border` and
  `--live-bg` were exactly this: zero consumers in `components/`/`entrypoints/` and zero
  `var(--pending-border)`/`var(--live-bg)` in the built CSS, found by grepping for them
  by hand and removed, under the subject "아무것도 칠하지 않는 토큰 둘과 그 가드를
  걷어낸다". **Search that with `--grep`, not by reading a log.** This repo squash-merges,
  so that subject is a line inside `5b99d40`'s *body* rather than a subject of its own,
  and the commit that carried it is unreachable from `main` — measured, `git log
  --oneline -- entrypoints/popup/style.css` prints 16 commits and none of them is it.
  It is the only subject this file cites — the three other commit citations are hashes,
  which squashing does not touch — so what carries forward is the mechanism, not this
  instance: a subject from inside a squashed branch is never a subject on `main`. Nothing
  runs that grep automatically; finding the next one means doing it again.
