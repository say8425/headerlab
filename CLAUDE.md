# HeaderLab

Chrome MV3 extension that modifies HTTP request and response headers. It replaces
ModHeader, which was pulled from the Chrome Web Store in July 2026 after a hidden
tracker was found in it.

**That history is the reason the project exists, and it decides arguments.** The trust
posture below and the "no silent failures" rule are not preferences — they are the
product. When a change trades either away for convenience, the change is wrong.

## Commands

```bash
pnpm check           # typecheck · lint · format:check · test — four of CI's six jobs, in one command
pnpm test            # wxt build && vitest run  — the build is not optional, see below
pnpm test:e2e        # wxt build --mode e2e && wxt build --mode bridge-e2e && playwright test
pnpm test:packages   # pnpm -r test — the agent-bridge packages, node:test, invisible to vitest
pnpm check:all       # pnpm check && pnpm -r test — everything above, in one command
pnpm typecheck       # wxt prepare && tsc --noEmit
pnpm lint            # wxt prepare && oxlint --deny-warnings   (lint:fix to apply fixes)
pnpm format:check    # oxfmt --check            (pnpm format to write)
pnpm build           # production build → .output/chrome-mv3
pnpm zip             # builds, then → .output/headerlab-<version>-chrome.zip
pnpm dev             # WXT dev server
pnpm screenshots     # wxt build && node scripts/screenshots.mjs → docs/screenshots/
pnpm store:assets    # wxt build && node scripts/store-assets.mjs → docs/store/assets/
pnpm crx             # wxt zip, then signs → .output/headerlab-<version>-chrome.crx
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
lib/bridge/      protocol.ts (command schema), apply.ts (reducer),
                 query.ts (state → StatusPayload) pure ·
                 port.ts is its one browser caller
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
scripts/         make-icons.mjs, screenshots.mjs, store-assets.mjs — generators,
                 not shipped · lib/popup-shots.mjs is the freshness guard, the
                 stored-state fixtures and the capture loop the last two share
packages/        the agent-bridge pnpm workspace — headerlab (the `headerlab`
                 CLI plus the native-messaging host it installs, published to
                 npm), plugin (Claude Code / Codex skill, not published).
                 Zero runtime deps, node:test, own CI job. See README's
                 "Agent bridge" section for the design.
```

**Decision logic lives in a pure layer; browser calls live in one thin adapter each.**
This is not taste. `@webext-core/fake-browser` defines `declarativeNetRequest`,
`permissions.*` and `chrome.action` as **throwing stubs**, so anything touching them
must be isolated and tested with a hand-planted spy. The architecture is what that
constraint produced.

`tests/unit/purity.test.ts` enforces it, and **it does not cover everything the tree
above calls pure.** Two directories are auto-discovered, so a new file in either is
guarded for free: `lib/compile/` and `lib/view/`. Everything else is a hand-written list
of exactly eight files — `lib/permissions/origins.ts`, `lib/permissions/audit.ts`,
`lib/model/migrate.ts`, `lib/model/defaults.ts`, `lib/bridge/protocol.ts`,
`lib/bridge/apply.ts`, `lib/bridge/query.ts` and `lib/model/schema.ts`.
`lib/permissions/` and `lib/bridge/`
each also hold an adapter that must *not* be guarded — `probe.ts` and `port.ts` — so
neither directory has a directory-shaped rule to apply. That is also why
`lib/bridge/query.ts` — the pure module answering every read command — had to be added
to the list by hand when it was written; the count above was seven and went stale in the
same branch that added it, which is the whole hazard this paragraph exists to describe.
`defaults.ts`
and `schema.ts` are named individually for the same one-hop reason: the guard only scans
a file's own source, so if guarded `lib/bridge/apply.ts` imports either as a runtime
value — `bootstrapProfile`/`newRule` from `defaults.ts`, `parseAppState` from `schema.ts`
(a value import, not the `import type` that would be erased) — a browser dependency
arriving through it would slip past unnoticed. `types.ts` and `lib/utils.ts` are pure by
convention and unguarded in fact. A new pure file outside those two directories is
unguarded until someone adds it by name.

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
  **`optional_permissions` is `["nativeMessaging"]`, and the install-time `permissions`
  list is still exactly the same two strings.** `manifest.test.ts` pins all three arrays.
  If Chrome ever makes this particular permission optional-ineligible, the failure is
  silent by construction: `permissions_parser.cc` drops it from the list and leaves only
  an install warning, and the one consistency check (a `DCHECK_EQ`) is compiled out of
  release builds — so the manifest string alone proves nothing. The real guard is the
  runtime grant actually succeeding, and only `tests/e2e/bridge.spec.ts` exercises that.
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
  DOM's `prefetchDNS`/`fetchPriority`/`dns-prefetch`, and two DNR resource-type names —
  `xmlhttprequest`, which the popup offers as a checkbox labelled `xhr`, and `websocket`,
  which it does not: that one is in the bundle only as a member of `schema.ts`'s
  fifteen-value `resourceType` enum), and matching words would need exactly the exception list
  this claim promises there isn't one of. Two of the tests in that file exist to hold
  that line: one plants each forbidden form and requires the patterns to match, the other
  feeds them the benign substrings and requires they do not.
- **No new dependencies.** The rule stands; the thing that used to enforce it
  mechanically is **gone**, and as of 2026-08-15 it is gone from npm too. npm here ran
  under a rolling publish quarantine — `min-release-age=3` in the developer's `~/.npmrc`,
  which npm resolves into a `before` timestamp — and **pnpm never read it**. Measured:
  `pnpm config get before` is `undefined` while `npm config list` still showed the
  resolved timestamp, because `min-release-age`/`before` is an npm setting. pnpm's own
  equivalent is `minimumReleaseAge`, and it is unset. So a fresh package installs quietly
  under either tool now; a successful install is not evidence that anything is old enough.
  **The way that setting announced itself is worth keeping, because the obvious diagnostic
  lies.** `npm i -g headerlab` failed with `ENOVERSIONS / No versions available` about an
  hour after `headerlab@0.1.2` was published — not `ETARGET`, which is what a *specific*
  filtered-out version produces; a package whose only version is inside the window has
  nothing left after the filter, so npm reports the name as versionless. Meanwhile
  `npm view headerlab versions` printed `0.1.2` throughout: **`view` does not apply the
  filter and `install` does**, so the first thing anyone reaches for says the package is
  fine. `curl https://registry.npmjs.org/<pkg>` is the check that actually settles it.
  `--before=<date>` is not the override — npm rejects it outright with
  `--min-release-age cannot be provided when using --before`; `--min-release-age=0` is.
  npm's own default is `null`, so this was never something every user of a fresh package
  hits, which is why `packages/headerlab/README.md` says nothing about it.
  **Assume lifecycle scripts do not run.** `ignore-scripts=true` is read by pnpm too —
  measured: `pnpm config get ignore-scripts` is `true`, and `rm -rf .wxt` followed by
  `pnpm install` leaves `.wxt/` absent, so the declared `postinstall: wxt prepare` has
  still never once fired here. **Chain setup into the script body**, never into a
  lifecycle hook — `pnpm test` runs `wxt build && vitest run` for exactly this reason, and
  `typecheck` is `wxt prepare && tsc --noEmit` rather than `tsc --noEmit` alone because
  `tsconfig.json` extends `./.wxt/tsconfig.json` and a fresh clone would otherwise
  type-check against a file that does not exist yet. `wxt prepare` is 177ms and
  idempotent; running it every time costs less than the trap does.
  `ignore-scripts` comes from the developer's `~/.npmrc`, **not from this repo** — there is
  no `.npmrc` here, so it is not reproducible from a clone. `min-release-age` sat beside it
  until 2026-08-15 and is now gone; the paragraph above is its record, not a live setting.
  **A dependency's own build script is a separate mechanism, and an unanswered one fails
  the install rather than warning.** Exactly one package here asks: `spawn-sync`, reached
  through `wxt → web-ext-run → fx-runner`, WXT's Firefox runner, which this Chrome-only
  extension never invokes. `pnpm-workspace.yaml` denies it by name and says why. Answer the
  next one with `pnpm approve-builds '!<pkg>'` and let it write the key rather than
  hand-writing it — it is `allowBuilds` in pnpm 11 and was `ignoredBuiltDependencies` in
  10, and the version that does not own a spelling ignores it in silence.
  **`pnpm-workspace.yaml` also declares `packages:`** — `packages/headerlab`,
  `packages/plugin`, named rather than globbed, so a directory joining the release surface
  shows up as a diff instead of silently matching a glob (`tests/unit/workspace.test.ts`
  pins the exact two, and the same file guards CI actually running their tests — see
  the CI section below). The extension itself stays at the repository root, and that is
  load-bearing rather than tidy: release-please prefixes every output with the package
  path once that path is not `.`, which would leave conditions in `release-please.yml`
  evaluating false — tagging a release with no check, no zip and no attached artifact, in
  the one job holding `contents: write`, with nothing going red. That reasoning otherwise
  lives only in a YAML comment; `docs/superpowers/specs/2026-08-11-agent-bridge-design.md`
  §6.1 has the fuller version.
  **`npm_config_ignore_scripts=false` does not override pnpm's `.npmrc`.
  `--ignore-scripts=false` does**, and the gap between them is why CI found this rather
  than this machine: the first form was measured here, reported nothing blocked, and this
  file was written to say "no package in this tree declares a build script at all". All
  five jobs failed on the first push. To reproduce what CI does, run
  `rm -rf node_modules && pnpm install --frozen-lockfile --ignore-scripts=false`.
- **`packages/headerlab` is published. The extension and the plugin are not.**
  That package carries no `private: true`, and that flag's absence is the whole
  safety switch — with it gone, npm no longer rejects an accidental `npm
  publish` with `EPRIVATE`. What actually reaches the tarball is decided by
  `package.json`'s `files` field, and *believing* `files` is not the same as
  *checking* it: run `npm pack --dry-run` from `packages/headerlab` and read
  the listing. Measured this way: **21 files**, `bin/` and `lib/` plus the
  three npm always adds regardless of `files` — `package.json`, `README.md`
  and `LICENSE` — with `test/` sitting beside them on disk and correctly
  absent from the tarball (`cd packages/headerlab && npm pack --dry-run`).
  The figure was 13, and re-measuring found **both** an increase and an error
  in the old one. The increase is real: the clig.dev redesign added six `lib/`
  files (`commands`, `help`, `suggest`, `exit`, `render`, `output`), 12+6+1=19.
  The error is that 13 was exactly `bin/`+`lib/`+`package.json` at the time
  (`git ls-tree 8665df1^` counts 12 there), so README.md and LICENSE were left
  out of a number claiming to be the tarball's — and `git ls-tree` shows both
  files sitting in that directory on the same commit, so they were in the
  tarball then too. npm adds those three whatever `files` says, which is the
  one thing reading the listing was supposed to teach. Re-run the command
  rather than trusting the number; the number is a snapshot and the CLI moves.
  Publishing happens from `release-please.yml`'s `npm publish --provenance`
  step, on a release. **The first published version is the one exception, and
  it is a forced one.** npm is retiring the tokens that let CI publish without
  a one-time password — the observed failure is `EOTP`, twice, each time
  *after* release-please had already created the tag and the GitHub release —
  and its replacement, trusted publishing over OIDC, can only be configured
  for a package that already exists on the registry. So the first version is
  published by hand, from a network that can reach `registry.npmjs.org`; this
  one cannot, and `npm view` against it times out through the office proxy
  even though `npm config get registry` names it. Every version after that is
  signed by the workflow. Do not read this as licence to publish by hand
  again.
  **One package rather than two, and it is not tidiness.** `bridge install`
  writes a launcher that names the native-messaging host's entry file by
  absolute path (`lib/manifest.mjs`'s `launcherScript`). A CLI published
  without that host would still write the launcher — the install step cannot
  see that the file it is naming does not exist on the target machine — and
  Chrome would report the resulting failure with the same message it uses for
  a rejected manifest or a mismatched extension id, indistinguishable without
  reading the log by hand. Shipping both from the one tarball `bridge install`
  reads makes that failure mode structurally impossible rather than merely
  documented.
  **The publish direction has been measured separately from the install
  direction, and it does not hit the same proxy.** `npm config get registry`
  here resolves to `https://registry.npmjs.org/`, unrewritten — every proxy
  incident this file records elsewhere (the `nexus.mng.musinsa.io` rewrite,
  the dropped platform bindings) is from *installing*, and this is the first
  time the *publish* direction has been checked at all. `npm publish
  --dry-run` from `packages/headerlab` passes clean (`+ headerlab@0.0.0`, no
  name rejection), and separately `npm whoami` returns 401 here — confirming
  the clean dry-run is dry-run behaviour and not a stray local credential
  standing in for CI's.

## Toolchain

**oxlint runs `correctness` only, as an error.** Measured on this tree before choosing:
correctness 6, perf 16, suspicious 187, pedantic 220, restriction 1208, style 3990. The
big numbers are not defects — 162 of `suspicious` are `react-in-jsx-scope`, a rule for
the *old* JSX transform that React 19 does not use, and most of `style` is now oxfmt's
job. A category that needs a page of suppressions to go green is a category nobody
reads. **`--deny-warnings` lives in the `lint` script itself, not in CI** — `ci.yml`'s lint
job is a bare `pnpm lint` — so a rule that arrives at warning level in a future release
stops a local run and the build alike. An earlier version of this line said CI adds it,
which would have meant `pnpm lint` passing locally on something CI rejects; it does not,
and the two cannot drift apart while the flag stays where it is.

**`lint` chains `wxt prepare`, and that is a correctness fix rather than a convenience.**
`tsconfig.json` extends `./.wxt/tsconfig.json`, which is what oxlint resolves `@/…` imports
through. With that file missing — a fresh clone under `ignore-scripts=true` — oxlint does
not complain. It **exits 0 having checked nothing** for the alias-resolving rules that
`correctness` enables (`import/default`, `import/namespace`), across 189 `@/…` imports
(126 when this was written, then 141; the count is whatever `grep -rhoE "from '@/" components
entrypoints lib tests | wc -l` says today, and it is the repo-wide figure because oxlint
lints the tests too).
Reproduced both ways with a one-line probe importing a non-existent default: an error with
`.wxt/tsconfig.json` present, silence and exit 0 with it moved aside. A lint that passes
because it looked at nothing is "no silent failures" inverted. `format`/`format:check` are
deliberately *not* chained — oxfmt reads no tsconfig and resolves nothing.

**`@types/chrome` is installed but not auto-included, under this repo's `typescript@7.0.2`
(tsgo).** Ambient auto-inclusion does not pick it up, so a file that touches `chrome.*`
needs `/// <reference types="chrome" />` as its literal first line — `lib/bridge/port.ts`
carries one for exactly this reason. Reproduced by deleting the directive: five
`TS2503`/`TS2304` errors. **Do not fix this in `tsconfig.json`'s `types` key** — that array
*replaces* tsgo's auto-list rather than extending it, so naming `chrome` there would drop
whatever tsgo would otherwise have included on its own.

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

**Suppressions are per-site and carry a reason.** Eight exist — counted by grepping for the
disable comments themselves (`grep -rn "oxlint-disable"`) rather than trusting a stated
number, which is how this count was corrected twice: an earlier version of this line said
four, naming only one `no-empty-pattern` site when the tree already carried four, and Task 7b
then added a fifth `no-control-regex` site without updating the total at all. Each of the
eight is a rule that cannot see the intent rather than a rule this repo disagrees with:
three `no-control-regex` — two on `/^[\x00-\x7F]/` ASCII range checks
(`lib/permissions/origins.ts`, `lib/compile/filterDiagnostics.ts`) and a third on
`packages/headerlab/test/render.test.mjs`'s ANSI-stripping regex, which means to match the
ESC control byte rather than check a range, so the same rule and the same "cannot see the
intent" reason cover a genuinely different pattern; four `no-empty-pattern` on Playwright's
`async ({}, use)` fixture idiom, one per fixture that declares no dependency
(`tests/e2e/fixtures.ts`'s `context`; `tests/e2e/bridge-fixtures.ts`'s `context`,
`derivedId`, `bridgeSocketDir`); and one `react-hooks/exhaustive-deps` on the truncating
effect in App.tsx. The disable comment must be the line *immediately* before its subject —
a two-line comment ending in the directive suppresses the second comment line and nothing
else, which reads as working and is not.

**Three more entries are release-please's output, not ours**, and they are the one group in
`ignorePatterns` excluded for authorship rather than for content: `.release-please-manifest.json`
and the two plugin manifests under `packages/plugin/.claude-plugin/` and `.codex-plugin/`.
release-please regenerates all three wholesale on every release, in compact JSON oxfmt
rejects — so the `format` job fails on the release PR itself and formatting cannot fix it,
because the next release rewrites them again. Measured on the first two-package release:
PR #18 failed on the manifest alone, #19 on the manifest plus both plugin manifests, while
`main` was clean. **The `package.json` files release-please also touches are deliberately
not here** — it edits only their `version` line and leaves every other byte alone (verified
against both PRs' diffs), so they stay ours to format. Re-derive the whole exclusion by
dropping the three patterns and re-running: the matched-file count moves 129 → 132, and
that count is what proves a pattern matches rather than merely parses.

**oxfmt formats code, not prose.** `entrypoints/popup/style.css`, `docs/**`, `**/*.md` and
`**/*.html` are in `ignorePatterns`. The stylesheet is hand-tuned at 4-space indent, and
taking it off the list rewrites **144 of its 347 lines** — re-measured by dropping the
pattern, running `oxfmt`, and counting `git diff --numstat`. Two changes, both cosmetic:
4-space to 2-space throughout, and `"` to `'` inside the attribute selectors of the seven
`@custom-variant` blocks. The old figure was 1124, taken when the file was 1143 lines of
hand-written component classes; the redesign deleted every one of them and the file is now
a token bridge. **The ratio is what carried the decision and it barely moved — 98% of the
file then, 41% now** — so the answer is still to keep it ignored, but on a number someone
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
used on an element and its CSS is emitted. (Testing's mutation-verify paragraph records
the same collision from the other side: a class named in a comment is also what a
first-occurrence string replace edits, so a mutation lands in the prose and the suite
stays green.) Measured: the 143 B this repo's popup CSS grew
during the documentation task came entirely from prose — docblocks and test comments
naming classes while explaining a bug — and excluding `tests/` and `scripts/` leaves the
remaining CSS byte-identical across those commits. Currently `tests/` contributes 324 B
and `scripts/` 30 B, 0.8% of 43,790 B, which is not worth two more `@source not` lines;
that is a re-measurable ruling, not a permanent one. One thing not to waste time on: **`.md` files are not scanned at all** — probed by
planting a unique utility in CLAUDE.md and rebuilding, which changed nothing.

**And one thing that cost time, because this file got the reason wrong.** It said
`.superpowers/` contributes exactly 0 B "because auto-detection skips dot-directories".
The 0 B is right and the reason is not: **detection skips gitignored paths**, and
`.superpowers/` is in `.gitignore` (`git check-ignore -v .superpowers/` names the line —
citing a line number here was itself wrong within one commit, because the comment added
beside it moved the entry from 10 to 19). A dot in the name buys nothing. Measured
2026-08-24 on `.design/`, an untracked scratch directory of design mocks that had been
sitting in this tree for four days: the popup CSS built **105,485 B** with it present and
**45,818 B** with it gitignored — same directory on disk, one line added — and 45,818 is
exactly what CI builds, so that directory was the entire difference between a local build
and the released one. 658 selectors, ~59 kB, from files nobody thought were source.
`.design/` and `.zcode/` are in `.gitignore` now for that reason rather than for tidiness.
The rule to carry forward is that **untracked is not excluded**: anything Tailwind can read
as text and git does not ignore is source. That is why `@source not "../../docs"`
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

**A prediction about `--frozen-lockfile` and a missing workspace importer was made twice,
and both times the answer was already sitting in this repository, unread.** Two reviews,
two days apart, predicted that the install fails outright when `pnpm-workspace.yaml`
declares a package the lockfile's `importers:` block has no entry for. Neither is what
happens: commit `6220afe` reproduced it in a scratch copy and found the install
*succeeds*, silently writing the missing entries into the committed file — worse than a
red job, because nothing says it happened. That commit's own message carries the caveat
that got lost when the reasoning was later copied into `tests/unit/workspace.test.ts`'s
docblock: it was measured on **pnpm 10.33.0**, the version this machine's broken pnpm
resolves to, and CI pins **11.20.0** — so neither "it fails" nor "it silently rewrites" has
ever been reproduced on the pnpm that actually runs the workflow. `1b89b45` restored the
caveat to the docblock rather than picking a side. `.github/actions/setup/action.yml` runs
`git diff --exit-code pnpm-lock.yaml` immediately after the install for exactly this
reason — it is the right guard under either resolution, since a silent rewrite shows up as
an uncommitted diff and a hard failure never reaches that step at all. The lesson worth
keeping is not which way the flag behaves; it is to run `git log -S` against a tooling
claim before restating it a third time — the answer was already here twice.

**corepack cannot fetch pnpm through the proxy**, so `corepack enable` is a CI-only
instruction. It builds the tarball URL as `<registry>/pnpm-11.20.0/-/pnpm-11.20.0.tgz`,
which 404s — the same path-shape bug that made `replace-registry-host` useless above.
Locally, install pnpm however you like and let the pin do the work: pnpm 10 and later read
`packageManager` and switch themselves to it, measured here by a pnpm 11.20.0 binary
reporting `9.15.9` while the field still said so. **Do not put a `+sha512…` integrity
suffix on that field** — corepack accepts that form, pnpm does not, and 9.15.9 refused
every command with `Invalid package manager specification … expected a semver version`.

## CI

**CI references actions by floating major — `actions/checkout@v7`, not a SHA and not
`@v7.0.1`.** This went SHA → exact tag → major, each step trading supply-chain strength
for legibility, and the trade is worth naming rather than discovering: a moved tag is a
real attack and a SHA is the only thing that forecloses it. What makes it acceptable here
is that those actions are published by GitHub itself, `ci.yml` holds only
`contents: read` with `persist-credentials: false`, and it never interpolates
`github.event.*`, so the blast radius of a hijacked action is this repository's own
source — which is public.

**Every action, third-party included, is a floating major (owner's call, 2026-08-27).**
`googleapis/release-please-action@v5`, not the commit it used to name. The rule is now one
rule with no exception: target the latest major and let patches and minors arrive on their
own.

**That is a loosening, and the paragraph above is why it is worth writing down rather than
just doing.** The three things that made a floating major cheap for the GitHub-published
actions — GitHub publishes them, the job holds only `contents: read`, it interpolates no
`github.event.*` — are precisely the three `release-please-action` does *not* clear. It runs
in the job holding `contents: write`, `pull-requests: write` and `id-token: write`, and that
OIDC token is what publishes to npm. A moved upstream tag reaches all of it, and nothing in
this repository forecloses that; a SHA was the only thing that did.

Two things bound it rather than remove it. The CRX signing key is **not** in this job — it
is an environment secret readable only by `store-submit.yml`'s own job, which uses no
third-party action at all. And `main` now requires a pull request with code-owner review, so
a *local* change to which action runs cannot land alone. Neither of those helps against the
upstream tag moving, which is the actual residual risk.

There is no dependabot here, so a major bump stays a manual bother — deliberately.

**CI is six jobs, one per check, and the split is what replaced `if: ${{ !cancelled() }}`.**
Typecheck, lint, format, unit and e2e used to be steps in one job, with that condition on
each so a push reported every failure instead of one per round trip. Separate jobs do the
same thing without the trick, and name the failing check in the PR's check list rather
than burying it in one job's log. **Every job's `name:` is the check it performs, not the
thing it looks at** — that is why the sixth is `package tests (node:test)` rather than
`packages`, which named a directory and had stopped being plural besides once the host
merged into the CLI. What distinguishes it from `unit` is the runner: it covers the
`packages/*/test/*.mjs` suites `vitest.config.ts`'s glob does not reach, so `pnpm test`
never runs them — see Commands' `test:packages` line. The cost is honest and small: each job installs dependencies again,
and `format:check` takes 82ms against a setup measured in seconds. It buys per-check
status, and it is what was asked for.

**The setup those jobs share is a local composite action, `.github/actions/setup`.**
Six copies of the same six steps is the shape that drifts. Two things in it are surprising
at the point of use and carry a comment there: `corepack enable` runs *after* setup-node so
the shims land in the Node the job will use, and `cache: pnpm` is therefore unusable
because setup-node resolves the store before pnpm exists — hence the explicit
`pnpm store path` and `actions/cache` pair. A local action is in-repo source, so it adds no
supply-chain surface.

## Release

**Release is `release-please.yml`, on push to `main`.** It opens and grooms a release PR
from the conventional-commit subjects; merging that PR is what tags, releases, and — only
then — builds `pnpm zip` and attaches `.output/headerlab-<version>-chrome.zip` to the
release.

**Both packages name themselves in their tags, and that is about the release title rather
than the tag.** release-please builds the GitHub release name as `<component>: v<x.y.z>`,
and the component reaches it only by being in the tag — measured on a sibling repository
using the same action: tag `diffdeck-v1.3.2`, release titled `diffdeck: v1.3.2`. The
extension held the bare `v<version>` namespace until 2026-08-14, which left its releases
titled `v1.1.0` with nothing saying what had been released. It now carries
`"component": "extension"`, so the page reads `extension: v1.1.1` beside `cli: v0.1.1`.
**Leaving
`component` unset does not mean "no component"**: it defaults to the package name, and the
root's is `headerlab`, which would title the extension's release `headerlab: v1.1.1` and
make it unreadable beside the CLI's.

**The two bare-namespace tags are gone, and how they went is the reusable part.** `v1.0.0`
and `v1.1.0` were deleted on 2026-08-15, so every tag here now names its package. They were
not deleted with their releases: a release carries assets, and `v1.0.0`'s
`headerlab-1.0.0-chrome.zip` had already been downloaded once — deleting the release
destroys the artifact and the count with it. **`PATCH /repos/{o}/{r}/releases/{id}` accepts
`tag_name`, so a release can be moved to a different tag in place** (`gh release edit <old>
--tag <new> --title …`), keeping its id, its assets and their download counts. The order
matters and is not recoverable if reversed: create the destination tag, move the release,
*then* delete the old tag — deleting first orphans the release. `extension-v1.1.0` already
existed as an alias on the same commit (`6d277c2`) and simply became the real tag;
`extension-v1.0.0` was created at `dbd1b39` for the move. **A tag that a release does not
point at can be created by `gh release edit --tag` itself, at `target_commitish`** — which
is why the destination tag is pushed first and verified rather than left to that fallback.
The compare links inside the moved bodies were rewritten in the same pass, since
`compare/v1.0.0...v1.1.0` 404s the moment those tags go; `CHANGELOG.md` carried one copy of
the same link and was the only file in the tree that did.

**`exclude-paths` on the root package keeps CLI commits out of the extension's changelog,
and it changes nothing today.** The root's path is the whole repository, so every commit
under `packages/` is otherwise the extension's too. The schema's wording is the whole
mechanism — *"if all files from commit belong to one of the paths it will be skipped"* — so
a commit survives the filter by touching one file outside it, and measured across all 14
commits from `extension-v1.0.0` to `extension-v1.1.2`, **every one does**. The two entries
that read as CLI-only (#23, #26) each also edited a root file, so they belong where they
are and were left alone; hand-editing them out would have been the changelog claiming a
root file never changed. What the setting buys is the commit that lives entirely under
`packages/headerlab/`, which is what CLI work looks like once its README stops moving.
`packages/plugin` is deliberately not on the list: it is not a release-please package — it
is version-bumped through the CLI's `extra-files` — so excluding it would leave a
skill-only commit in no changelog at all. `tests/unit/workspace.test.ts` derives the list
from the configured packages rather than pinning the literal, so a third released package
added without an exclusion fails there.

**That leak reaches the version number, not just the changelog, and it cost a wrong major.**
The paragraph above is about which entries appear in whose changelog; the same rule decides
which package sees a `BREAKING CHANGE:` footer. Measured on 2026-08-16: the CLI's clig.dev
rework squash-merged as one commit with a footer naming five changes to *the CLI's* contract,
and because that commit also touched **16** files outside `packages/headerlab` — among them
CLAUDE.md, five READMEs, the three `lib/bridge/*.ts` the read query added, SKILL.md, and four
files under `tests/` — release-please proposed **`extension 2.0.0`** with a changelog whose
breaking-changes section read "five changes to the CLI's contract." The extension had no
breaking change; it had gained a read query, which is a minor. A footer is scoped to a
*commit*, and this repository squash-merges, so a footer is scoped to a whole branch —
including every root file that branch happened to touch. Count that set with
`git show --name-only --format='' <sha> | sed '/^$/d' | grep -vc '^packages/headerlab/'`;
piping `--stat` through `awk '{print $1}'` gives 17, because `--stat`'s summary line counts
as a row.

**Two settings fix the two halves, and only one of them is a config key.** `Release-As:
<version>` in a commit footer forces a package's next version, and in manifest mode it is
attributed by path like any other commit — so a commit touching only root files reaches the
extension and not the CLI. That is the mechanism that pulls `extension 2.0.0` back to
`1.2.0`; **confirm the release PR regenerates with the new number before merging it**, because
nothing else tells you the footer landed. Do not reach for the `release-as` **config** key
instead: the pinned schema marks it deprecated and points at the commit footer. Separately,
`bump-minor-pre-major: true` on the CLI is what makes a breaking change on a `0.x` package
bump the minor rather than jumping to `1.0.0` — without it, release-please read the same footer
and proposed `cli 1.0.0` where the design said `0.2.0`. Spell that key from the schema, not
from memory: `extractReleaserConfig` reads a fixed list of known keys and **discards the rest
with no log line**, and the schema's per-package objects carry no `additionalProperties: false`
either, so a typo is invisible in the editor and at runtime alike and the first symptom is a
version nobody chose. `tests/unit/workspace.test.ts` pins the key by value for that reason.

**The footer has to be a line-initial `Release-As:` in the commit message, and describing it
anywhere else does nothing.** This was learned by doing it wrong: PR #43 was written entirely
around a footer that was never in the commit, and every check short of reading the raw commit
object passed — the PR body said it was there, the diff was correct, CI was green. Two things
make the mistake easy. This repository squash-merges with
`squash_merge_commit_message: COMMIT_MESSAGES` (`gh api repos/<owner>/<repo>`), so the merged
body comes from the branch's commit messages and not from the PR body at all; and a
`Release-As:` written mid-sentence inside prose is not a footer token the conventional-commits
parser will lift. Verify with `git log -1 --format=%B <ref> | grep -c '^Release-As:'` before
merging, not by re-reading what you wrote about it.

**The footer fixes the version and not the changelog, and editing `CHANGELOG.md` on the
release PR branch does not reach the GitHub release notes.** This is the same episode's
second half. `Release-As: 1.2.0` did pull `extension 2.0.0` back to `1.2.0`, but the
generated changelog still carried a `### ⚠ BREAKING CHANGES` section reading "five changes
to the CLI's contract" — a CLI change, in the extension's changelog, because the footer
scopes the *version* and the leak described above still decided which entries appeared.
Deleting that section from `CHANGELOG.md` on the PR branch before merging fixed the file on
`main` and nothing else: **release-please builds the release body from its own stored notes,
not from the file in the tree**, so the GitHub release created minutes later still carried
the false section. Those notes are the release PR's own body — which is *not* what was
edited, and **whether editing the PR body before merging would have carried through was not
measured**; the releases were already cut by the time the question came up. What is measured
is the after-the-fact remedy: `gh release edit <tag> --notes-file <file>`, a
`PATCH /repos/{o}/{r}/releases/{id}`, which keeps the release id and its assets (verified:
`headerlab-1.2.0-chrome.zip` survived the edit, download count intact).
So a changelog defect noticed on the release PR is **two** fixes, and doing only the
obvious one leaves the wrong text on the page most people actually read.

**And merging one release PR conflicts the other.** `separate-pull-requests: true` gives
each package its own PR, and both edit `.release-please-manifest.json` — so merging the
extension's PR made the CLI's `CONFLICTING`, and release-please did **not** rebase it on
its next run. The branch has to be rebased by hand, resolving the manifest to hold both new
versions rather than either side's copy:

```json
{".":"1.2.0","packages/headerlab":"0.2.0"}
```

Taking either side wholesale is the trap: "theirs" drops the release that just shipped and
"ours" drops the one about to. Expect this whenever both packages have a release PR open at
once — read `CONFLICTING` on the second one as arithmetic rather than as a sign something
went wrong. Observed once, on the release described here.

**`npm publish --provenance` requires `--access public` even for an unscoped name.** The
flag is not about the name — unscoped packages are public by default — it is about
provenance: npm cannot infer publicity for a package that does not exist yet and refuses
to sign one. Measured on the first real attempt: `EUSAGE / Can't generate provenance for
new or private package`. Nothing was uploaded, because the check fires before the tarball
moves — but the tag and the GitHub release had already been created by the step above, so
the job went red **after** the irreversible half had happened. That ordering is worth
remembering for anything else added to this job.

**Publishing is now OIDC, and there is no npm token.** `--access public` went with it:
it was only ever required because provenance cannot be generated for a package that does
not exist, and `headerlab` exists. The workflow authenticates against a trusted publisher
configured on the package — this repository, this workflow file — which is what
`id-token: write` is for. That replaced a token because npm is retiring the kind that
publishes without a one-time password, and this repository hit that wall twice with
`EOTP`. **`--provenance` is redundant under trusted publishing and is kept on purpose**:
npm attaches an attestation automatically, so the flag changes nothing while the
configuration holds and fails the job loudly if it ever stops holding. The package README
tells readers every CI release is signed and to check with `npm audit signatures`;
shipping an unsigned tarball under that promise is the silent failure the flag prevents.
Trusted publishing needs npm 11.5.1 and Node 22.14.0 at minimum — `.nvmrc` pins 24, whose
npm is 11.13.0.

**As of `cli-v0.2.0` that mechanism is exercised rather than merely configured, and the
distinction was load-bearing for longer than it looks.** Everything above was written
before the workflow had ever published anything: `headerlab@0.1.2` went up by hand for the
reason this section already gives — npm cannot configure a trusted publisher for a package
that does not exist — and release-please built no CLI release in the window that followed,
so the `npm publish --provenance` step never ran. Note that is about releases *of that
package*: `extension-v1.2.0` shipped four minutes before `cli-v0.2.0` and its commit range
includes the CLI rework, but an extension release runs no publish step. It ran on
2026-08-16. The step reported `success`, and its log carries
`npm notice 📦  headerlab@0.2.0` and `npm notice total files: 21`. **Keep the by-hand
paragraph above as written** — it is the record of why the first version had to be the
exception, and nothing about this run licenses a second hand publish. What has changed is
only that "every version after that is signed by the workflow" is now an observation
instead of a plan. The tarball count agreeing with the 21 recorded elsewhere in this file
is the incidental confirmation, not the point; re-measure it with `cd packages/headerlab
&& npm pack --dry-run` rather than trusting either number.

**This file said a release PR "does not trigger `ci.yml`" and that is wrong in the letter,
measured 2026-08-26.** Runs *are* created for the release branches, on the `pull_request`
event: `gh run list --workflow ci.yml --json databaseId,conclusion,event,headBranch` shows
`32704922032` at `action_required` and `32707908398`, `32733647879` and (on the CLI branch)
`32646285014` at `success` — three of them approved by hand. Why one sat at
`action_required` was not measured; do not restate a mechanism here without a run id beside
it, which is the mistake this paragraph is replacing.

What follows from the correction is smaller than it looks. The release PR *can* be checked,
so `pnpm check` inside the release job is not there to cover an unchecked commit. It is
there because `ci.yml` and `release-please.yml` both fire on the push to `main` and neither
waits for the other, so `ci.yml` passing is never a fact the release job can act on — and
because everything below the release-please step runs with the tag already cut.

**There is a Chrome Web Store step now** (2026-08-26), and it is `store-submit.yml` rather
than `wxt submit`. It signs the release's own zip into a CRX and submits it. Three things
about it are load-bearing and none is obvious from the YAML:

- **It submits for review. It does not publish.** The store's `:publish` is a submission —
  "The item will be submitted for review and published when the item passes" — so the
  furthest a green run means is `PENDING_REVIEW`. `skipReview` is not available here: it
  wants `declarativeNetRequest` as a *required* permission and changes confined to
  `rule_resources`, and this manifest has `declarativeNetRequestWithHostAccess` and no
  `rule_resources` at all. Any sentence anywhere claiming a merge publishes the extension
  is wrong.
- **It is called, not triggered.** `on: release` would never fire — release-please creates
  the release with the default `GITHUB_TOKEN`, and `release` is not one of the exceptions
  to the loop-prevention rule. So it is a `workflow_call` job in the release run, which
  also keeps `GITHUB_REF` at `refs/heads/main` — the ref the `chrome-web-store`
  environment's branch rule names. A tag rule there would match nothing while reading as
  strict.
- **`workflow_dispatch` is the recovery path, and which knob you turn depends on where it
  broke.** The tag is cut before this can run, so a failure always leaves a released version
  that is not on the store, and re-cutting a version is never the fix. A transient failure —
  the network, the token, the store — is a plain re-run against the same tag. A failure *in
  the scripts* is not: the checkout supplies only the scripts, since the CRX's payload always
  comes from the release's own zip, so a tag-pinned re-run replays the same broken script
  forever. That is what the optional `ref` input exists for, and the likeliest instance is
  `UPLOADABLE_STATES` in `scripts/lib/cws.mjs` refusing an item state the store really does
  use — deliberately fail-closed, and therefore deliberately something that may need widening
  once. `ref: main` only works while `main` still carries the tag's version, because
  `pack-crx.mjs` refuses an archive whose manifest disagrees with `package.json`; past that
  the two constraints genuinely conflict and the answer is a local `pnpm crx` and the
  dashboard. `docs/store/checklist.md` §10 carries the table.

**The first run started from zero tags and zero releases**, so it read the whole history and
its first changelog held every commit this repository had — expected, not a
misconfiguration; it proposed a version from `package.json`'s `1.0.0` and the
conventional-commit subjects above it rather than releasing `1.0.0` itself. That is history
now: there are twelve tags and twelve releases (`git tag | wc -l` and `gh release list
--limit 30 | wc -l`, both `12` on 2026-08-17, after `extension-v1.3.0`, `extension-v1.3.1`
and `cli-v0.3.0`), and a run
finds the previous release through the `extension-v*` / `cli-v*` tag formats. **That count
goes stale on every release, so re-run the two commands rather than reading it** — it said
seven until the clig.dev release and nine until this one, five releases' worth of drift in
a file that treats a stale measurement as a defect. Kept because the same paragraph is what a fresh
fork of this setup would need.

**The workflows carry almost no comments, and that is deliberate.** They had many, and they
restated what this file already says at more length. The reasoning lives here; the YAML
should be readable as YAML. What stayed is only what is surprising *at the point of use* —
the two in the composite action, why `--with-deps` runs on a cache hit, why `pnpm zip`
needs no build step before it, and why the release job checks out
unconditionally when the action that runs next needs no worktree (the step after it is a
*local* action, and a local action with no checkout is the "Can't find action.yml" failure;
hanging that on a conditional step is how it would be discovered on a release rather than
on a push).

## Chrome Web Store

**It is listed.** `kgapijlldieckifoenckgninnepafhnn`, published 2026-08-25 at version
1.7.0, category Developer Tools. `docs/store/checklist.md` is still the runbook for what a
submission needs; what changed is that the READMEs no longer say there is no listing, and
`store-submit.yml` now does the upload that used to be a manual dashboard step.

**The v2 `fetchStatus` response was guessed wrong, and `pnpm store:probe` is what caught
it (2026-08-28).** The guess was a top-level `itemState` and `crxVersion`. The real body
has neither. Measured against the live listing:

```json
{ "name": …, "itemId": …, "publicKey": …,
  "publishedItemRevisionStatus": { "state": "PUBLISHED",
    "distributionChannels": [ { "deployPercentage": 100, "crxVersion": "1.7.0" } ] },
  "submittedItemRevisionStatus": { … }, "lastAsyncUploadState": …,
  "takenDown": false, "warned": false }
```

Four things follow, and every one of them was wrong before the probe ran. **The state lives
on a revision, and there are two** — `publishedItemRevisionStatus` and
`submittedItemRevisionStatus`, either unset. **The submitted one is what a release asks
about**: after `:publish` the new version becomes the *submitted* revision while the
published one still holds the old version, so reading the published side would wait for
something that only happens when review passes, days later. **The version is nested another
level down**, in `distributionChannels[].crxVersion`. And **the upload state on a status
response is `lastAsyncUploadState`**, not `uploadState` — that name belongs to the upload
response, and only that one.

The enums were guesswork too, and mostly wrong: `UploadState` is
`UPLOAD_STATE_UNSPECIFIED`/`SUCCEEDED`/`IN_PROGRESS`/`FAILED`/`NOT_FOUND` — not `SUCCESS`,
which is what the code looked for, so a *successful* upload would have been read as
unrecognised and refused. `ItemState` is `ITEM_STATE_UNSPECIFIED`/`PENDING_REVIEW`/`STAGED`/
`PUBLISHED`/`PUBLISHED_TO_TESTERS`/`REJECTED`/`CANCELLED`; there is no `IN_REVIEW`, which the
code had invented, and `STAGED` — approved and awaiting publication — it had never heard of.
One documented contradiction survives and is handled rather than resolved: `media.upload`'s
field docs say `UPLOAD_IN_PROGRESS` while the enum page says `IN_PROGRESS`, so both are
accepted.

**The transferable part is the method, not the schema.** Three functions read that body, and
a single wrong guess broke all three at once in a way no unit test could see, because the
tests were written from the same guess. What separated them was one read-only request against
the real thing. `pnpm store:probe` is that request, kept: it prints the raw body and then what
`scripts/lib/cws.mjs` makes of it, so the next schema drift is one command away from being
visible instead of one release away.

**The five READMEs carry a Chrome Web Store badge and a three-route Install section**
(store · release asset · build it yourself), and the badge URL is one string repeated in
all five. Nothing checks that they agree — `tests/unit/storeListing.test.ts` holds the five
*descriptions* to one shape, not the READMEs.

**The item's title and its summary are not listing fields. The store reads them out of
the manifest**, and the dashboard says so itself: that tab is for "information about your
item that isn't included in the metadata of the manifest." So the title is
`manifest.name` and the summary is `manifest.description`, and changing either means
shipping a version rather than editing a form. Chrome's limit on the summary is 132
characters.

**The package declares no locales, and that is a decision (owner's call, 2026-08-23).**
The dashboard's language dropdown offers exactly the locales the uploaded zip carries under
`_locales/`, so this one offers only the default. It used to carry
`public/_locales/{en,ko,ja,zh_CN,es}/` with `default_locale: 'en'`, which made the store
report five supported languages — while those five files translated **one** string between
them (`extDescription`) and the popup called `i18n` nowhere. A person installing in Korean
got an entirely English UI. `docs/superpowers/specs/2026-07-31-headerlab-design.md` said
"UI language: English" from the first week; the directories were what drifted away from the
prose, and the dashboard reported the directories.

The indirection went rather than being narrowed to `en`. With one locale it resolves an
English string to an English string, and its only remaining property is a failure mode —
which is exactly the "declared but paints nothing" shape this file records hunting down in
the palette. `description` is a literal in `wxt.config.ts` now, and the production-manifest
suite pins the absence of all three pieces (`_locales`, `default_locale`, `__MSG_`)
separately, and they do not fail alike. Measured 2026-08-23 by loading each variant in real
Chromium: `default_locale` without `_locales` is refused, `_locales` without
`default_locale` is refused, and **a `__MSG_` reference with neither loads** — shipping the
literal `__MSG_extDescription__` as the store summary, with nothing throwing and e2e green.
So two of the three are caught by any real load and the third is caught only by that
assertion. All three returning together is quiet in its own way: the dashboard re-offers
four listings nobody writes. `name` stays a literal for a
reason that survived the change: the store item's **title** is `manifest.name`, so editing
it is a release rather than a form edit.

The cost, stated because it is real: four translated listings and their twenty screenshots
are gone, and the summary under the item title is English for everyone. The four
descriptions are in git history; reversing the decision means bringing all three manifest
pieces back together.

Whether the store counts UTF-16 units or code points has **not** been measured, and no
longer needs to be. The limit assertion counts UTF-16 units (`.length`), which outside the
BMP is the larger of the two readings and therefore cannot under-report either way — the
counting closes the ambiguity, which is why the old "stays inside the BMP" assertion could
go with the locales rather than being kept as its guarantee.

**Localisable and not, from the store's own wording:** the detailed description, the
screenshots and the promo video are per-locale; "The small tile and Marquee promo tile
cannot be localized", and neither can the category or the URLs.

**A privacy policy is required, and "we store it locally" is not the exemption it looks
like.** The policy is explicit — extensions must disclose how they handle user data
"even when data is processed or stored locally on a user's device and is not transmitted
to external servers or third parties." `PRIVACY.md` at the repository root is what the
listing points at. `docs/store/privacy.md` carries the tab's answers and flags the one
judgment nobody should make on the owner's behalf: whether a free-text header field that
users commonly fill with a bearer token means "Authentication information" gets ticked.

**Trader/non-trader is required of every developer, and the *trader* route publishes
contact details.** That distinction was blurred here until it mattered: declaring as a
trader puts a verified address, email and SMS-confirmed phone number on the listing, and
**what a non-trader has published has not been measured** — the policy pages describe only
the trader case. Do not assume either way. Google is explicit that the developer
self-declares and that it cannot decide for anyone.

**This repository's owner declared non-trader (2026-08-21), and that does not restrict
distribution.** Checked rather than assumed, because `docs/store/checklist.md` sets the
Distribution tab to all regions in the same file: nothing in the policy ties the
declaration to a region. The documented effect is that consumers are told
consumer-protection rights do not apply to contracts with a non-trader — and a free,
unmonetised Apache-2.0 extension forms no such contract. The status is a fact about the
publisher rather than about the extension, so it can go stale without a line of code
moving.

**`pnpm store:assets` generates all 8 images** — 5 screenshots at 1280×800 (five states),
the store icon, the small tile and the marquee. It reads each file's PNG IHDR after writing
and refuses a set the store would reject, so a stylesheet that made the page one pixel
wider fails here rather than at the upload. One failure mode it cannot see and which needs
eyes: nothing in this repository reads a pixel's colour. (The missing-CJK-fonts hazard went
with the translated captions — every line burnt into these images is English now.)

**The store icon is not the toolbar icon.** The store wants 96×96 of artwork inside 16px
of transparent padding; `public/icon/active-128.png` is full bleed because a toolbar slot
has none to give. Same glyph, wrapped in `translate(16,16) scale(0.75)` rather than
redrawn at new coordinates, so the two cannot drift apart by arithmetic.

**The all-sites screenshot's saved sites read `idle`, not `granted`, and that was measured
rather than predicted.** The shot was first written expecting `granted` and the capture
loop's state guard refused it: all-sites keeps the stored list and compiles none of it, so
those hosts hold their permission and scope nothing — the rows say "Not in use while All
sites is on". It is the better picture anyway, being what makes the mode legibly
reversible. The same distinction CLAUDE.md draws elsewhere between `scopingHosts` and
`filter.domains`, arriving through a screenshot.

**`tests/unit/storeListing.test.ts` holds the five descriptions to one shape** — same line
skeleton, every API name and URL verbatim, no Markdown (the store renders none, so a `**`
reaches the reader as itself) — and compares `listing.md`'s summary table against the
message files rather than trusting it. **It does not catch two bullets swapping places**,
measured by doing exactly that across the two lists and watching all seven stay green; the
skeleton is positional. That limit is written into the file beside the assertion.

**This listing will not accept a ZIP, as of 2026-08-24.** What is *observed* is one thing:
the owner uploaded `headerlab-1.7.0-chrome.zip` to the dashboard and it answered *"There
was a problem uploading your file… You must update your item with a crx package"*. That is
their report of their screen, not something measured here. What follows from it without
any inference is the operational half — `pnpm zip` is no longer a file this listing takes,
`pnpm crx` is, and the checklist's CRX step is a requirement rather than an option.

**The round trip then settled it, which a UI label would not have.** The refusal was
followed by `pnpm crx`'s output being uploaded and **accepted**, and the item entering
review (owner-reported, 2026-08-24). A store that holds no public key for an item has
nothing to verify a signature against and no reason to demand a CRX in the first place, so
the pair — ZIP refused, then a CRX signed with the 1Password key accepted — establishes
both that verified uploads is on and that **the key on the item is the key in 1Password**.
That second half is what a Package tab reading "enabled" would *not* have told anyone.

Two things follow. **A never-published draft item can opt in** — listed as unestablished
by the research done the same day, because the store's wording about repackaging "with the
existing private key" reads as assuming a key it already holds. It does not. And
`scripts/pack-crx.mjs`'s local checks have now been confirmed by an independent one: the
packer asserts the header declares this key's DER and signs over the id that key derives,
and the store's own verification agreed. `tests/unit/crx.test.ts`'s docblock says the live
end-to-end evidence is the packer's own check, since CI has no browser; there is a second
check now, and it is the one that actually gates publication.

**What was written here before that upload is worth keeping as a method note.** This
paragraph first asserted the refusal was "the message only a verified item produces" —
unsourced, and exactly the shape the rest of this section exists to correct; Chrome's page
carries no error strings at all. It was then rewritten to separate the observed half from
the inferred half, and the inference happened to be right. Being right is not what made
the rewrite correct: at the time, nothing distinguished it from the `genpair` claim two
bullets down, which was also the obvious reading and was false.

Below is the reasoning that led to switching it on, kept because it is what a later reader
needs to judge whether the trade still holds.
The store signs every extension with a key it manages, and it does that automatically on
upload — so until this is opted into, holding the dashboard account is the whole of what it
takes to publish as this item. Opting in gives the store an RSA public key and makes it
reject anything not signed by the matching private one. For an extension that exists
because a trusted one shipped a hidden tracker, that is the product rather than a
preference, which is why `docs/store/checklist.md` carries it as a step instead of an
option. **Four things about it were measured rather than assumed:**

- **Opting out is not self-service.** No dashboard toggle reverts it; CWS support does, on
  no published timeline. Treat the opt-in as one-way.
- **ZIP uploads stop being accepted** the moment it is on. `pnpm zip` still builds what
  `release-please.yml` attaches to the GitHub release; `pnpm crx` builds what the store
  will take. The same page says the API is still a route for a verified item — upload with
  `X-Goog-Upload-Protocol: raw` and `X-Goog-Upload-File-Name: <name>.crx` — but that
  sentence is written for the Update API **v1.1, which retires 2026-10-15**, and the v2
  documentation does not mention CRX at all. So "a signed CRX can be uploaded by an
  automated job" is documented for an API with weeks left and undocumented for its
  replacement. Do not build a release path on it without measuring it first.
- **The published extension id does not change.** A verified upload is repackaged with the
  store's existing key before publication, so the id the packer prints — the one this
  signing key derives — is not the listing's and is not meant to be. `scripts/pack-crx.mjs`
  says so in the line where it prints it, because the two ids sitting side by side is
  exactly where somebody concludes something has gone wrong.
- **This list said Chrome's documentation gives a command that does not exist. It does
  not, and the claim is retracted.** The page shows `openssl genpkey -algorithm RSA
  -pkeyopt rsa_keygen_bits:2048 -out privatekey.pem`, quoted verbatim on 2026-08-24. What
  was true and remains true is only the half that was measured here: `openssl genpair` is
  not a subcommand, and OpenSSL 3.6.3 answers `Invalid command 'genpair'`. **Where the
  false half came from is the part worth keeping.** The `genpair` spelling arrived from a
  *summarised* fetch of that page rather than from its literal text, and was written down
  as a quotation. Testing's rule about reading a grep's real output instead of a
  description of it is the same rule — a claim about what another document literally says
  has to come from the literal bytes, and a summarising reader is not those bytes. Whether
  the page ever said `genpair` cannot now be established, which is itself the cost: the
  claim was unfalsifiable from the moment it was recorded second-hand.

**The key is now in CI as well as in 1Password (owner's call, 2026-08-26), and the argument
against that is kept below rather than deleted, because it is still the cost.** A repository
whose claim is that a stranger who trusts none of it can verify the bundle now holds a
secret that publishes on its behalf. Chrome's own page argues the same way from the other
side — "Don't store your private key in your Google Account. This means someone with access
to the Developer Dashboard through your Google Account could publish on your behalf" — the
point of Verified CRX being to survive a compromised publishing account, which a key sitting
beside the publishing identity weakens.

What was traded for it: merging the release PR is now the only human action in a release.
The alternative on the table cost exactly the same number of actions — merge, then one local
`pnpm crx` — so this bought convenience of *place*, not of count. Read that as the honest
size of the trade rather than as a reason to widen it.

What narrows it, and each of these is load-bearing rather than decorative:
`CRX_SIGNING_KEY` is an **environment** secret on `chrome-web-store`, so it is readable only
by the one job that names that environment and only when that job starts — not by the
release job beside it, and not when the run is queued. The environment's deployment branch
rule is `Branch → main`, so no other ref can reach it. `tests/unit/storeSubmit.test.ts` pins
the environment name, because a typo does not fail: GitHub silently creates an unprotected
environment of that name and the job runs ungated with an empty key. And `main` now requires
a pull request with code-owner review (`.github/CODEOWNERS`, plus the `pull_request` rule on
the `main` ruleset), so landing a workflow that reads the key is not something a future
collaborator can do alone. The residual risk is a malicious change reaching `main` — not
zero, and smaller than a repository secret would be.

**The local path is unchanged and is still the fallback.** `pnpm crx` reads the key out of
`op://Personal/HeaderLab CRX signing key`,
writes it to a 0600 file inside a 0700 temp directory, and removes that directory on the way
out. **A `try/finally` is not what does that, and believing it was is a defect this branch
shipped and a review caught.** `process.exit()` does not throw, so it ends the process
without running any `finally` on the stack — measured with a probe that writes a file, calls
`process.exit(1)` inside a `try` and logs from the `finally`: nothing printed, file still
there. Every refusal in that script exits that way, so the key survived on exactly the six
paths where somebody then opens the directory to find out what went wrong.
`process.on('exit', …)` **does** run on `process.exit()`, synchronously, which is all
`rmSync` needs; it is registered immediately after `mkdtempSync` so nothing can be added in
front of it, and a `SIGINT` handler calls `process.exit` so Ctrl-C at the slow Chrome step
goes through the same door. The same shape Testing records for an installer's teardown:
register it so it cannot be skipped. `HEADERLAB_CRX_KEY` names a PEM path for anyone without
1Password. `.gitignore` carries `*.pem` and `*.crx` so a key that reaches this tree at all
cannot be what `git add -A` discovers.

**The packer reads the bytes back rather than trusting Chrome's exit code**, and the reason
is where the alternative fails: the store performs the same signature check itself, at
upload time, which is *after* release-please has tagged and released. So
`scripts/pack-crx.mjs` parses the CRX3 header it just produced, requires the declared
public key to be this key's DER and the signed crx id to be the one that key derives — both,
because a header naming one key while signing over another's id is precisely the mismatch
the store rejects and is invisible if only one is read. It then unpacks the CRX's own ZIP
payload and compares every file against the release archive by SHA-256. Chrome rebuilds the
archive, so the two ZIPs are *not* byte-identical and comparing them as containers would
fail on metadata while proving nothing about what ships. **`pnpm zip` is not
byte-reproducible either, and its contents are** — measured, two runs off one tree: different
archive hashes, and `diff -r` of the two extracted trees empty. That is why the packer
compares contents rather than archives, and why `docs/store/checklist.md` says to pack from
the downloaded release asset while calling it a preference rather than a requirement. `scripts/lib/crx.mjs` holds the
parsing, pure, and `tests/unit/crx.test.ts` tests it against synthetic headers — a real CRX
needs the key, which CI does not have, so the live end-to-end evidence is the packer's own
check and the reader's evidence is the unit suite.

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
`{ state, state$: { v: 2 } }`. **Two e2e modes exist — `e2e` and `bridge-e2e`** —
because granting `nativeMessaging` outright in the shared build put every popup test
into the bridge's error state; `wxt.config.ts`'s `bridge-e2e` branch carries the full
reasoning at the point of use.

**The host and the CLI must never resolve `HEADERLAB_SOCKET_DIR` — or any socket
directory — independently.** `socketDir()` in `packages/headerlab/lib/socket.mjs` reads the
override once, inside itself, rather than trusting either call site to apply it the same
way. The host inherits Chrome's environment and the CLI inherits the terminal's, so if
either half applied an override — or fell back to `$TMPDIR` — on its own, the two could
silently resolve to different directories with nothing failing to show it. Same reasoning
as branch 2 of that function shelling out to `getconf DARWIN_USER_TEMP_DIR` by absolute
path instead of trusting either inherited `$TMPDIR` copy.

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
must reach the screen.

**The asymmetry used to be "headers skip per row, domains suppress the whole profile".
It is narrower now (owner's call, 2026-08-20): an unusable domain is skipped per entry
too, and only the LAST one suppresses.** One typo taking every good host down with it
was the complaint, and it was a bigger hammer than the danger needed. The danger is
real and unchanged, so read the pairing before touching either half:
`conditions.ts` drops unusable entries before they reach `requestDomains`, and
`suppressionReason` fails the profile closed exactly when nothing usable is left.
Filtering without that check would widen an all-invalid profile from "these hosts" to
every site; the check without the filter would hand `updateDynamicRules` a malformed
domain, and that call is transactional — it would reject every other rule in the batch.
Neither half is safe alone, which is why the old code chose the hammer.
A skipped entry is still *said*: `invalid-domain` is raised for any unusable entry now,
as a `warning` when its neighbours still apply and an `error` when nothing is left, and
the row itself says the remedy in red on its own second line.

**Applying everywhere is a mode, not an empty list.** `filter.domains: []` used to mean
both "not scoped yet" and "deliberately everywhere", and the standing warning about it
existed only because the code could not tell those apart. `filter.allSites` names the
second one, so the first can mean what it looks like: nothing applies, stated calmly
rather than warned about. **Where it is stated moved on 2026-08-19, and the two
same-named types are the trap.** It used to be a `no-scope` *diagnostic* of severity
`incomplete`, rendered as a note above the site list; the note and the diagnostic went
together, and the saying-so is now the readout's own always-on-screen count — "N
blocked" — which never appears or departs, so it costs the rail nothing. **That count
carried its cause as a suffix until 2026-08-20** (" until a site is set", " by an
unusable site", " while paused", " until access is granted"); the suffix is gone and
the count is not, which is the half to defend: `blocked` exists in `ruleTally` so this
line cannot read "no problems" while zero rules go out. Measured before dropping it —
the line has 171px, one blamed clause runs 142-176px, and it truncated the moment a
second segment joined. Each cause is now said where it can be acted on: on the row
(red text saying the remedy, on the row that holds the bad value), on the run-state switch, and in
the readout's own "N sites need access" clause. `suppressionReason` still returns `'no-scope'` and
`lib/bridge/query.ts` still ships it to the CLI, because that is a **`SuppressionReason`**
(`lib/compile/suppression.ts`) and always was; the identically-spelled `DiagnosticKind`
member was retired with its producer, since nothing emitted it any more. Do not read the
surviving string as evidence the diagnostic is back. All-sites keeps the stored
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

**The rule has three recorded carve-outs, and they are not a licence to make more.**
A reservation costs its space in every state, including the states where nothing is
wrong — which is most of them, and in this rail that cost is charged to the site
list. Each time the trade was looked at on screen rather than reasoned about, it came
out the other way:

1. The readout's second line reserved a blank 20px under the big number. Fixed
   **without giving anything up**, by making the line always say something true
   (`no problems`) so its box never changes. **That is the shape to reach for
   first.**
2. `AddSiteField` reserved a 15px line for a duplicate-site complaint. No such
   answer — "no duplicate" is noise — so the reservation went and the movement came
   back, bounded by a guarantee that survives it: the note is exactly one line
   whatever the hostname's length, truncated with `title` carrying the full value.
3. **The rail's rows themselves, 2026-08-21, and this one is the largest.** Both the
   site rows and the all-sites row reserved a second line sized to the Grant button
   they might never hold. `h-[60px]`, `h-4` and `h-6` are gone from both; the
   all-sites row lost that line entirely, with Grant moving up beside the switch.
   Measured, and re-measured after the follow-up fix below: the all-sites row
   60px → **40px in all four of its states**, a site row 60px → 50 granted /
   50 unusable / 60 pending, and the list's cap 174px → 200px, which is two
   whole rows visible becoming three. What it costs: Grant arriving grows its
   own row and the rows under it move. The first pass left the all-sites row
   content-sized too — 34.39 off, 40 awaiting — which moved the whole list on
   the one control whose own click causes it; the fix was a height on the 52px
   slot that already reserved Grant's width, so the reservation covers both
   axes of the one box that varies.

**Before removing a reservation, look for the first shape.** If there is none, say in
the diff what the movement costs and what bounds it, and rewrite the guard that
promised otherwise rather than leaving it describing nothing — three were rewritten
for (3), each into a sharper claim than the one it replaced. The reflow guard now
*bounds* the middle instead of freezing it, and writing that bound is what found a
second contributor nobody had counted: the add field moved 9.61px where the site row
had gained 4, because the all-sites row was growing 34.39 → 40 on the same toggle.

**A state-dependent line is ONE line, always — owner's rule, 2026-08-21.** This is
what replaced the reservation in (3), and it is the rule to reach for whenever a box's
height would otherwise follow its text. Three parts, and all three are load-bearing:

1. **Make wrapping impossible, not unlikely.** `truncate` on the line
   (`white-space: nowrap` and an ellipsis) means no string can ever add a second line,
   so the row's height cannot follow its copy. Short copy alone is not the rule — copy
   is prose and prose grows.
2. **Measure every string against the space the TEXT gets, not against the box.**
   `site-line` measures 155px and spends 20 of it on `pl-5`, so the budget is
   **135px**. Getting this wrong is not hypothetical: the first version of this
   rule said 155, which would have licensed a ~150px string that clips, and it
   made the string that started all this look 3.8px over when it was 23.8.
   Measured in the built popup: `Access granted` 85px (37% headroom),
   `Use a bare hostname` 115px at 600 weight (15%), `All sites is on` 70.7px
   (47%). The last of those replaced `Overridden by All sites` (121px) **because
   10% headroom is not enough** — this suite's own notes record CI's Linux
   fallback fonts changing a note's line count, and the truncation check is
   exact-zero-tolerance. A truncated line is an unreadable line, so (1) is a
   floor and this is the actual requirement.
3. **Guard both halves.** One line *and* not clipped. `measureLines` in
   `tests/e2e/header-modification.spec.ts` reports `truncated` for exactly this.

**No chips in that line.** The unusable state wore a destructive Badge reading
`invalid` until this rule arrived; a chip inside a 14px line is a second box with its
own height, and it stood that row at 56px against its neighbours' 50. It is plain red
text now, and it says the *remedy* (`Use a bare hostname`) rather than the complaint —
the colour and the barred glyph already carry the complaint, and the full sentence with
its example stays in the `title`.

**The measurement that started it:** `Not in use while All sites is on` was 158.8px
against the **135px** the text actually gets — **23.8px over**, so it wrapped, and that
one row stood 14px taller than every other row in the list. Nothing failed; it just
looked wrong.

**That "23.8" was "3.8" here until a code review**, because this section had measured
against `site-line`'s 155px outer box and forgotten its own `pl-5`. The error was not in
the fix — the string really was too long and the row really was 14px taller — but in the
budget the rule then handed the next person, which was 20px more generous than the box.
A measurement quoted without the padding it sits inside is the same class of defect as a
measurement quoted without its state, which the rail-leftover table below already
records four instances of.

**Covering that state needed its own test, and finding out why is the transferable
part.** The overflow spec pins each row state's line height — and its fixture has
all-sites *off*, so it renders no `idle` row and never saw this string at all. Putting
the over-long copy back left it green. The `idle` case is asserted in the reflow guard
instead, which toggles all-sites and therefore has such a row. **Before trusting a
guard over a state, check the fixture actually reaches that state**; a mutation that
does not turn a test red is the only thing that tells you.

**Width is a different rule from height, and (3) kept it.** The all-sites row still
reserves the Grant button's *width*, because without it the switch slides 50px left
the instant the mode goes pending — under the pointer that just pressed it. That
reservation is paid out of slack rather than out of the label: the label's text
measures 46.8px against the 67px it leaves.

This applies to any element whose presence is state-dependent, which in the rail is
most of them: Grant, the pending and unusable notes, the tooltip, the mode switch's
own sub-line. When adding one, ask what its absence looks like — if the answer is
"everything else sits higher", the layout is wrong, not the element.

**State changes appearance, not geometry.** Colour, weight, opacity and content may
follow state freely; box dimensions and positions should not.

**The rail gave up its readout on 2026-08-20, and every figure below predates that.**
The count — a 24px number over a line naming what was held — was the rail's opening
card and cost it roughly 48px at the top, which is the part that runs out first as the
site list grows. It reads in the panel head now, right-aligned beside "Rules"
(`RulePanel`), where the measured space is 453px against a worst realistic line of
323px — so it no longer truncates, which is what it did in the rail's 171px. The card
that held it keeps the two switches. **Re-measure before spending any number in this
section**: the one figure already re-taken is the site list under pressure, which
stopped yielding at all with a single note up (it sat at its 108px cap) and needed both
error notes planted to press again. The e2e overflow guard carries that measurement.

**The rail once carried zero slack, measured.** Adding the bridge row cost 21px the
layout did not have to spare: `docs/design/2026-08-12-agent-bridge-rail-budget.html`
measured the *built* popup and found 7px genuinely free, not the 28px a source-level
reading of the Tailwind classes suggested. The remaining 21px came from four existing
margins each giving up one notch on Tailwind's 4px scale (the readout card's and the
sites section's own `mt-4`→`mt-3`, the types section's `pt-3`→`pt-2`, the bridge row's
own `mt-2`→`mt-1` — 16px) plus the site list's `max-height` dropping `132px`→`127px`
(5px). Budget 576px, used 576px, slack 0 at that point.

**That zero is history, and the number that replaced it was itself wrong twice.** The
switch/label branch spent 8px on the all-sites row's padding (`h-12`/4px →
`h-14`/8px), then freed 27px above the site list by deleting two reservations — the
scope note's stacked `mt-3` and `AddSiteField`'s fixed `h-[15px]` line. Between those
two commits the list's cap was written down as 119px, correctly against the tree of the
day and wrongly against the tree three commits later; it is 127px again. Re-measure
with that design file's `measure()` before spending any figure below — each has moved
on reasoning that was sound when written.

**The leftover is one row of a table, not a property of the rail.** A single number was
wrong four times for the same reason every time: the leftover depends on what else is
on screen, and a figure quoted without its state gets read in the state it was not
measured in. Measured in the built popup at four saved sites (2026-08-17, headed;
re-measured 2026-08-18 twice — first when the all-sites bar grew 4px for the standard
shadcn `xs` Grant, then when the site rows grew to 60px for the all-sites-matching
8px padding and the list's cap came down 127→108 to keep a cut row visible at all;
every note-state list figure below is space-squeezed and did not move with row
height):

| state of the rail                                  | site list | real leftover |
| -------------------------------------------------- | --------- | ------------- |
| no notes above the list  (re-measured 2026-08-22)  | 200px     | **13px**      |
| one error note (`sync-error` or `icon-error`)      | ~43–61px  | **0px**       |
| both error notes                                   | ~63px     | **0px**       |

**Only the first and last rows survive the 2026-08-21 row-height change**, and they
were re-measured for it — 108→200 as the cap rose, and 26→63 under both notes because
there is more list to give away before the rail runs out. The middle row is from
before and has not been re-taken; read it as an order of magnitude, not a figure. The
list under both notes is no longer 0: it yields, it is not erased, which is what
`tests/e2e/header-modification.spec.ts` bounds rather than pins.

Under the states that read 0, the shortfall was paid by *overprinting* — the section's
`overflow` was `visible`, so the add field painted across the request-types heading
below (measured: 30.5px of two texts in the same pixels). The sites section now clips
(`overflow-hidden` on the `min-h-0` flex column), so the same pressure costs the list
instead of a section that never moved; the reserved-slot redesign that would give the
notes a real home is the open design pass Known gaps records. The popup's other
pressure axis — browser zoom, where the fixed 748×600 stops fitting — is handled the
same way in kind: since the `overflow: hidden` on `html, body` came out (style.css),
a shortfall is a scrollbar rather than deleted controls. Nominal size is untouched;
the e2e width guard asserts `scrollWidth === clientWidth` there.

**Measuring "is this rail full" has two traps that both silently report "no
problem."** `clientHeight − scrollHeight` is structurally always 0 here: the site list
is `flex-shrink: 1`, so it absorbs any deficit before the rail itself can overflow, and
the request-types section's `mt-auto` eats the leftover as margin — summing computed
margins then counts that same free space a second time. Measure the height the rail
was *asked* for instead: correct the list's contribution to `min(max-height,
scrollHeight)` and skip auto margins entirely. A working implementation is `measure()`
in the rail-budget design file above.

## Testing

Three layers: pure logic without a browser, adapters with hand-planted spies, e2e
against a loaded extension. Two of the eighteen e2e tests drive a real request through the
loopback echo server and read the headers back off it; those two are the strongest
evidence in the repo — do not weaken them. A third checks that a row Chrome would refuse
never reaches declarativeNetRequest while its sibling still does. Ten more cover
the popup rendering from stored state and nine layout guards: nothing wider than what
holds it, a control appearing moves nothing, an overflowing list clips nothing while its
neighbours stay put, a rule row's gutter chips match size *and* the row keeps its height
when toggled off (one test, not two), the ghost row at the end matches a minimum rule
row's height *and* answers the pointer without changing it, the badge and the chip each
keep a focus ring that reaches the screen, the add-site field and the ghost row each keep
theirs inside what clips them, an
error diagnostic replacing a value never resizes the row or moves the rows below it, and
the bridge row does not push the rail past its own column.
**That count said seventeen and eight until 2026-08-24**, and the enumeration was missing
the add-site/ghost focus-ring guard — which is why it is worth re-deriving rather than
reading. `pnpm exec playwright test --list` with no file argument ends in
`Total: 18 tests in 3 files`, which is the figure this sentence states.
`grep -cE '^test\(' tests/e2e/*.spec.ts` gives the same 13 + 4 + 1 and needs no browser,
but **it agrees only because of three things that are absent today**: a `test.describe`
wrapper indents every inner `test(` out of a line-initial match, `test.each` collapses N
tests into one line, and `test.skip(` drops out entirely. There are none of any of those in
`tests/e2e/` right now. Playwright resolves all three itself, so prefer `--list` and read
the grep as a cross-check.

The remaining five are the bridge's own, in `tests/e2e/bridge.spec.ts` and
`tests/e2e/bridge-rail.spec.ts`. One confirms the id `bridge install` computed from
`--load-path` is byte-for-byte the id Chrome actually assigned the loaded extension —
design §8.3's self-verification, performed against a running browser rather than argued
for. One drives a real `headerlab site add` through a real installed host, through the
socket, into real storage, and reads the result back off `chrome.storage` rather than off
the CLI's own reply. One drives a *read* the same way — `rule ls` after a `site add` —
and asserts absence before presence: first that `chrome.storage` still holds exactly what
the write left, then that the reply's `scopingHosts` and `state` match it. Checking the
reply against storage rather than against the CLI's own claim is the point; a read that
answered from a stale copy is invisible to a test that only asks whether it wrote nothing. One confirms the popup reads "Bridge
live" once that command has landed. The fifth is a layout guard in the same family as the
eight above: an unreachable bridge leaves the rail exactly where a live one leaves it.

**The CLI's presentation layer is pure, and every decision it makes is testable without
a terminal.** `lib/render.mjs`, `lib/help.mjs`, `lib/commands.mjs`, `lib/suggest.mjs` and
`lib/exit.mjs` take their inputs as arguments and return strings, so the human-facing
output is tested without spawning anything — none of those tests is a subprocess.
`lib/output.mjs` decides *where* a string goes and *whether* it is coloured,
and the plan it returns is what `bin/headerlab.mjs` writes; **it still takes the streams
and the environment as arguments** (`resolveMode(globals, streams)`,
`resolveColor(globals, env, stream)`), which is why table-driven tests can reach a
branch that only lights up when stdout is a pty.
**Read the grep's real output, not a summary of it.** An earlier draft of this paragraph
offered `grep -rn 'isTTY\|process\.env' lib/ bin/`, run from `packages/headerlab`, and
then described output the command does not produce — it said the hits are in
`bin/headerlab.mjs` and `socket.mjs` and "none in `output.mjs`", while `socket.mjs` is in
fact the first thing that grep prints, and the enumeration also omitted `install.mjs:154`.
What is true is narrower and worth stating carefully: `output.mjs`'s `isTTY` hits are all
`streams.stdout?.isTTY` / `stream?.isTTY` on **injected arguments**, which is the design
being celebrated rather than a counterexample; the reads of the real process are
`bin/headerlab.mjs` (`process.stdin.isTTY`, and `process.env` passed into `resolveColor`),
`socket.mjs`'s one `HEADERLAB_SOCKET_DIR` lookup, and `install.mjs:154` handing
`process.env` to a spawned child. Line numbers are deliberately absent except that one:
they went stale twice.
What genuinely needs a real process is `test/process.test.mjs` — a closed stdout pipe,
SIGINT (both of its two sentences), and the terminal-only branches.
**The terminal branches are reached without a pty, and how matters.**
`test-support/tty-harness.mjs` sets `process.stdin.isTTY = true` on a real pipe and then
imports the CLI, so `state set -`'s guard and `state set`'s confirmation prompt are ordinary
subprocess tests. It exercises the branch, not the terminal: line discipline, echo and a
real Ctrl-C are not simulated. One measured consequence is baked into the CLI —
`process.stdin.pause()` releases the event loop on a pty but **not** on a pipe, so the
prompt calls `unref()` too, and without that the y-path hangs forever on a terminal with
nothing in the suite able to see it.

**The five READMEs are held together by their commands, not by their line counts.**
`packages/headerlab/test/docs.test.mjs` extracts every line inside a `bash`-tagged fence
that starts with `headerlab ` and asserts all five files produce the same list, byte for byte
— prose is translated and commands are not. Counting `grep -c 'headerlab '` per file was
the obvious check and it is wrong: it counts prose mentions, which the four translations
render differently by construction, so the counts are unequal on a tree where nothing is
broken. Two narrowings in that extractor were each found by measurement rather than
reasoned to: it must restrict to `bash`-tagged fences, because the Spanish architecture
block (untagged) contains the prose line `headerlab (la CLI más…`; and it must strip
indentation, because the `bridge install` example sits inside a numbered list and is
indented three spaces in all five.

**The same file binds `SKILL.md` to the CLI in three guards, and what they cannot see is
the point.** Every path in `commands.mjs` must appear in it, so a command cannot exist
with nothing telling an agent about it. Every code in `ERROR_CODES` must appear inside
**backticks** — the backticks because every code name is ordinary English words
(`unknown-rule`, `invalid-state`) that prose matches by accident, at the deliberate cost
that a code appearing only inside a fenced JSON example does not satisfy it. And the
skill's nested list of extension-side codes must equal the codes `exitFor` sends to exit
1, less `install-failed`, which binds the *layer* a code is filed under rather than merely
its presence. **The first two bind names, not claims** — mutation-verified: list all
sixteen codes in backticks and write every explanation false, and the suite stays green.
The third exists because that gap is where the skill actually drifted; the Conventions
rule that sends you here carries the incident.

**A contrast pair is not a pixel, and nothing here reads one automatically.**
`tests/unit/contrast.test.ts` reads the two palettes out of the stylesheet and asserts
token against token, so a colour produced by alpha compositing or by tailwind-merge
picking a class the author did not expect is outside it by construction — the file now
says so at its top. It went green through a grey box that was plainly visible on screen.

**The e2e suite barely covers that gap, and "barely" is one element.** It reads geometry
throughout — `grep -rn getBoundingClientRect tests/e2e | wc -l` is 28 lines and `-rho …` 30
occurrences — and, as of 2026-08-24, **exactly one colour**: the ghost row's hovered
`backgroundColor`, compared against the sibling rule row's own computed fill rather than
against an `rgb()` literal, in `tests/e2e/header-modification.spec.ts`. There is still no
snapshot comparison configured and zero `toHaveScreenshot`/`toMatchSnapshot` calls. So the
only output with pixels *in quantity* is `pnpm screenshots`, and **a human is what reads
it**; that is how the grey box was found. A colour defect born of alpha or merge order
still has no automated guard anywhere but that one line. **This paragraph said "no colour
at all" for one commit after that line existed**, which is the ordinary way a claim about
coverage goes stale: the branch that closes a documented gap is the branch least likely to
re-read the paragraph documenting it.

Re-derive the colour claim with a command that asks the colour question, not one that
inventories properties:

```bash
grep -rnE '\.(backgroundColor|outlineColor|borderColor|[a-zA-Z]*[Cc]olor)\b' tests/e2e/
```

One line today, and no false positives — the fixtures' `color: 'green'` are object keys
rather than property accesses. It matches the property *access*, not the call, which is
what makes it survive the bound idiom that defeated the obvious command; the cost is that
it matches a colour read named in a **comment** too (measured: a planted
`// someday: assert cs.color here` is a hit). That is the same prose-versus-behaviour
collision as the two notes above, now for the third time in this file, and here it is the
right way round: over-reporting sends somebody to look, under-reporting is what shipped. **The obvious command is the wrong one, and how it fails is
this file's own named defect.** Histogramming
`getComputedStyle(…).<prop>` sees only the immediate-access form: 6 of the suite's 13 call
sites, because the other 7 bind first (`const cs = getComputedStyle(el)`) and that is the
idiom every older test uses. Measured by planting `const cs = getComputedStyle(el); const
ink = cs.color;` — the histogram went on printing `backgroundColor 1` while the sentence
beside it was false, and the grep above caught it. An assertion that cannot fail, attached
to the one sentence the paragraph exists for.

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

**A mutation that does not land looks exactly like a guard that does not work, and this
repo's own documentation style is what causes it.** Comments here name the utilities and
identifiers they discuss, so a class such as `hover:bg-card` exists in a file twice — once
as prose about the behaviour, once as the behaviour. A first-occurrence string replace
edits the paragraph. Measured, on the branch that added that class: the mutation
"applied", the build succeeded, the suite stayed green, and the conclusion on offer was
that the newly written assertion was blind. It was not; the mutation was. That is a false
negative in the one procedure whose entire job is to rule false negatives out, and it is
the most convincing kind, because every step reports success.

**So mutate by line number, and confirm the mutation landed by re-reading the line you
changed** — never by trusting the edit's exit code. Same collision the Toolchain section
records from the other direction, where Tailwind emits CSS for a class named only in a
comment: what a file *says* and what a file *does* are different surfaces, and any check
that cannot tell them apart will eventually be fooled by prose.

**Mutation-testing an installer writes to real user directories.** The mutations that
disable a test's own scratch-path isolation are, by definition, exactly the ones that
escape it — and an assertion failing partway through skips whatever cleanup sat after it
in the test body. Register teardown so it cannot be skipped (`t.after`, registered before
the install runs, not a cleanup call at the end of the test), and check
`~/.headerlab/bin` and the real per-user socket directory by hand afterward regardless.

**The one "flaky" test was a real race, and calling it flaky is what kept it alive.**
`packages/headerlab/test/headerlab-host.test.mjs`'s "closed stdin shuts the host down, well
under the two-second SIGKILL budget, with everything cleaned up" was recorded here as a flake
— failing under concurrent load, passing in isolation and on re-run. That description was
accurate and useless: it named the symptom and stopped. The cause is an ordering window in the
test, not load. `waitForSocket` polled for the **socket** file, which `lib/host.mjs`'s
`await listenWithRestrictedPermissions(...)` creates, and the assertion sixteen lines later
checked the **registry entry**, which `writeRegistryEntry(...)` writes afterwards. Between
those two the host has a socket and no registry file, and the test asserted inside that gap.

**Reproduce it deterministically rather than waiting for load**: plant
`await new Promise((r) => setTimeout(r, 300))` immediately before that `writeRegistryEntry`
call and the old test fails every time, at the same assertion CI reported
(`actual: false, expected: true`). That is how it was diagnosed, and how the fix was checked —
the repaired test passes with the delay still planted, and its own gate was mutation-verified
by never writing the entry at all, which produces a timeout naming which half is missing
instead of a bare `false !== true`.

The host's ordering was never wrong and was not changed: writing the registry entry only after
a successful bind is what makes its presence evidence of a full start. The test now waits for
**both** files and asserts only what the wait does not establish — the origin round-tripping
through argv, and `startedAt` parsing as a timestamp. Waiting for the registry file and then
asserting it exists would have traded the race for a tautology.

Every other socket+registry fixture in `packages/headerlab/test/` writes the registry entry
**before** binding, so no window exists in any of them; this file was the only one that spawns
the real `bin/headerlab-host.mjs` and watches it from outside.

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
- **Touching the CLI means reviewing the skill in the same change.** Any work under
  `packages/headerlab/` carries a question no test asks: does
  `packages/plugin/skills/headerlab/SKILL.md` still describe the CLI correctly? That file
  is the only reference a model reads before driving this CLI, and it is the one surface
  where being wrong is invisible — a human reads `--help`, an agent reads the skill. Three
  guards in `packages/headerlab/test/docs.test.mjs` hold it mechanically and Testing, above,
  says what each of them covers; two of the three bind names rather than claims, and that
  is the gap this rule fills. **Re-read the claims against the four files that decide
  them**: `lib/commands.mjs` for what exists, `lib/exit.mjs` for the contract and its exit
  codes, `bin/headerlab.mjs` for what the CLI refuses itself, and `lib/bridge/port.ts` with
  `apply.ts` for what the extension refuses. Measured, on the skill as it stood: it filed
  `invalid-command` under "a `state set` source that could not be read, was too large, or
  was not valid JSON" — all three of those are the CLI's own refusal, `invalid-args`/exit 2
  at `bin/headerlab.mjs`, while `invalid-command` is the extension's and exits 1, so the one
  paragraph teaching a model to branch on the layer named the wrong layer. And it said "and
  four more" when seven were left, so `invalid-state`, `unknown-rule` and `unknown-domain`
  had no name anywhere. Every guard there was stayed green through both; the third guard
  was written afterwards, and it goes red on both.

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
- **A note that appears cannot live in this rail, and two pre-existing ones already
  break it.** `sync-error` and `icon-error` are plain conditional blocks, and the rail
  carried zero slack from the bridge row until the switch/label branch freed 27px above
  the list (see Interface, whose table is the current figures). Measured at
  four saved sites *at the time*: the site list's cap is 127px with neither note showing,
  65px with only `sync-error`, 34px with only `icon-error`, and 0px with both — the
  user's saved sites pushed off screen by an error message about something else. The
  leftover those freed (13px then, 9px since the `xs` Grant re-measure) softens those
  three figures without changing the shape of the problem, and they
  have not been re-measured since. **A third offender joined them**: `AddSiteField`'s
  duplicate-site note is now created rather than reserved, so it too costs the list
  ~21px when it appears. That one is bounded — it is guaranteed one line, asserted in
  both suites — which the two above are not. Two things have since been fixed about the
  worst state: with both notes up, the section's `overflow: hidden` (added 2026-08-17)
  makes the shortfall clip inside the sites section instead of letting the add field
  overprint the request-types heading — but the list still collapses to 0px, so the
  *reservation* problem stands. **A fourth offender was retired rather than fixed, and
  how is the reusable part**: the unusable-site note was an appearing note in this same
  rail, and it is gone (2026-08-19) because its message moved onto the object it was
  about — the row holding the bad value says the remedy in red on its own second line,
  in the slot a pending row gives its Grant button, so the note's whole cost became zero
  without a reservation being added anywhere. (It was an `invalid` Badge until
  2026-08-21, when the owner replaced the chip with plain text: a chip inside a 14px line
  is a second box with its own height, and it stood that row 6px above its neighbours.) That is a third fix shape, alongside the two
  below: not "reserve the space" and not "fold into an existing row", but *re-home the
  message on the thing it names*. It only works when such a thing exists on screen —
  which is exactly what `sync-error` and `icon-error` lack (they are about the rule set
  as a whole, not about any one row), and why they are still here.
  None is the same fix shape as the bridge row's own note
  (that one folded into an existing fixed-height row; these are prose with no existing
  row to fold into), so this needs its own design pass rather than a while-we-are-here
  patch.
- **The bridge's `status()` cannot see grants, so its tally can over-report.** The
  popup's readout holds rules out of `live` when no scoping host is granted
  (`Liveness.access`, App.tsx computes it from `byHost` and the `<all_urls>` probe).
  The CLI bridge's `status()` builds its payload synchronously and never probes, so it
  leaves the field absent — which the type documents as "unanswered", never "granted",
  but which leaves `tally.live` claiming rules are going out for a host the extension
  has no permission for: the same lie the popup used to tell. Fixing it means making
  the payload builder async (probeGrants through the socket handler) and re-deriving
  the CLI's own wording; until then the popup is the surface that tells the truth
  here.
- **Five hand-written declaration files exist** — `packages/headerlab/lib/manifest.d.mts`,
  `socket.d.mts` and `install.d.mts` beside it, plus `scripts/lib/png.d.mts` and
  `scripts/lib/crx.d.mts` — because `tests/` and `tests/e2e/` import `.mjs` modules from
  TypeScript and `allowJs` is off. Nothing checks that any of them still matches its
  implementation. **This entry said "three" and named only the `packages/` ones while
  `png.d.mts` had already existed for the same reason**, so re-derive the list rather than
  trusting it: `find . -name '*.d.mts' -not -path './node_modules/*'`.
- **The bridge's `idle` state means "the permission is held and no port is open," not
  "a CLI is not attached."** The extension has no way to see the host's socket clients —
  it can only see its own `connectNative` port — and giving it that visibility would turn
  the host from a dumb relay into a protocol participant, which `packages/headerlab/lib/bridge.mjs`
  argues against by name. So `idle` in practice names the state most people land in first:
  the bridge switch turned on, `headerlab bridge install` never run.
- **`bridge install` points its launcher at `~/.headerlab/bin/headerlab-host`, which
  execs the entry path of whichever installed copy of `packages/headerlab` wrote it —
  a clone for a contributor, the global `node_modules` for `npm i -g headerlab`.**
  Moving or deleting that copy orphans the entry the same way either way: a clone
  moved or deleted, or `npm uninstall -g headerlab`, an `npm i -g headerlab@next`
  upgrade, or an nvm switch that moves the global prefix. Nothing in Chrome or the
  extension will ever say so — `headerlab bridge status` is the only thing that reads
  the launcher back and reports `entryMissing`.
- **`headerlab diagnostics` and the `state set` snapshot are both decided
  against, not merely absent.** `diagnostics` because `status` carries the
  same payload and a second name for one query is not a feature; the
  snapshot-before-every-raw-write and the `state snapshots`/`state restore
  <id>` that would have read it back because the owner ruled against them on
  2026-08-22 (#35, closed as not planned). Design spec §2 and §3 promised
  both and now record the decision beside the promise — that file keeps its
  original text on purpose, so nothing there was deleted. **The consequence is not softened by the
  decision: `state set` passes zod validation and nothing else, so a raw
  write cannot be undone from the CLI.** What stands between a mistake and
  the stored bytes is that a payload failing validation is refused whole
  (`invalid-state`, nothing written) and that `--force` is required off a
  terminal. `headerlab state get --json | jq .state > backup.json` is the
  only backup there is. The README promised none of this, so nothing false
  has shipped publicly.
