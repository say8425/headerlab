---
paths:
  - "package.json"
  - "pnpm-lock.yaml"
  - "pnpm-workspace.yaml"
  - ".oxlintrc.json"
  - ".oxfmtrc.json"
  - "tsconfig.json"
  - "wxt.config.ts"
  - "vitest.config.ts"
  - "playwright.config.ts"
  - ".gitignore"
  - ".nvmrc"
  - "entrypoints/popup/style.css"
  - ".github/actions/**"
  - "tests/support/build.ts"
  - "tests/unit/{lockfile,workspace,cssSources}.test.ts"
---

# Toolchain

## pnpm and the lockfile

- **Never re-resolve `pnpm-lock.yaml` on this machine.** The office proxy serves incomplete
  packuments for platform bindings: resolving here (a `pnpm import` from the old
  `package-lock.json`, before that file was deleted in `49f7804`) dropped every non-darwin
  `@oxfmt/binding-*` in silence — green on macOS, broken on Linux. Re-resolve only where the
  registry serves complete packuments (a CI runner, or a network outside the proxy); no
  workflow does this today. `tests/unit/lockfile.test.ts` pairs platforms (whatever
  `darwin-arm64` resolved, `linux-x64-gnu` must too), so this machine can catch the defect.
- Hand edits are safe only when they re-resolve nothing, like the empty workspace-importer
  entries `tests/unit/workspace.test.ts` explains.
- `pnpm install --frozen-lockfile` is the everyday command. `.github/actions/setup` runs
  `git diff --exit-code pnpm-lock.yaml` straight after it, because whether pnpm 11 fails or
  silently rewrites a lockfile missing a workspace importer has never been measured on the
  pinned version.
- The lockfile records no registry URL, so it installs from whatever registry the machine points
  at. There is nothing to rewrite before committing.
- To reproduce CI's install: `rm -rf node_modules && pnpm install --frozen-lockfile
  --ignore-scripts=false`. `npm_config_ignore_scripts=false` does **not** override pnpm's
  `.npmrc` — that gap is how a blocked build script once reached CI unseen.
- A dependency's own build script fails the install until it is answered. Answer with
  `pnpm approve-builds '!<pkg>'` and let it write the key (`allowBuilds` in pnpm 11; the other
  version's spelling is ignored in silence). `spawn-sync` is denied: it is reached only through
  wxt's Firefox runner, which needs the optional peer `web-ext` (not installed), so `pnpm dev`
  and `pnpm dev:firefox` print "Load … as an unpacked extension manually" and launch nothing.
  Installing `web-ext` would be a new dependency.
- `pnpm-workspace.yaml` names `packages/headerlab` and `packages/plugin` rather than globbing,
  so a new directory joins the release surface only as a visible diff
  (`tests/unit/workspace.test.ts` pins both, and that CI runs their tests).
- To check whether a package version is really published, ask the registry
  (`curl https://registry.npmjs.org/<pkg>`); `npm view` skips filters that `npm install`
  applies.

## Lint (oxlint)

- `correctness` only, as an error. Measured before choosing: correctness 6, perf 16, suspicious
  187, pedantic 220, restriction 1208, style 3990 findings — the large categories were noise
  (`react-in-jsx-scope` alone was 162) or oxfmt's job.
- `--deny-warnings` lives in the `lint` script, not in CI, so local and CI runs cannot disagree.
- `lint` chains `wxt prepare` for correctness: oxlint resolves `@/…` through `tsconfig.json` →
  `.wxt/tsconfig.json`, and without that file it exits 0 having checked nothing for the
  alias-resolving rules (`import/default`, `import/namespace`).
- `plugins` replaces oxlint's default set, and an override's `plugins` does not enable a plugin
  (`.oxlintrc.json` says so where it matters).
- Suppressions are per site and carry a reason — each one a rule that cannot see the intent, not
  a rule this repo disagrees with. The directive must be the line *immediately* before its
  subject; a two-line comment ending in the directive suppresses its own second line. List them
  with `git grep -n "oxlint-disable" -- ':!docs' ':!*.md'`.

## Format (oxfmt)

- Formats code, not prose: `entrypoints/popup/style.css` (hand-tuned 4-space), `docs/**`,
  `**/*.md` and `**/*.html` are in `ignorePatterns`, plus the three JSON files release-please
  rewrites wholesale on every release (`.oxfmtrc.json` explains; the `package.json` files it
  touches stay formatted). Re-derive a pattern's effect by dropping it and counting matched
  files — and only with the probe config in the repo root, since patterns resolve relative to
  the config file.
- `printWidth: 100` (least churn in a sweep of 80–120), `singleQuote: true`. oxfmt also sorts
  `package.json` keys.
- `format` and `format:check` deliberately do not chain `wxt prepare`: oxfmt reads no tsconfig
  and resolves nothing.

## TypeScript

- Under `typescript@7.0.2` (tsgo), `@types/chrome` is installed but not auto-included: a file
  touching `chrome.*` needs `/// <reference types="chrome" />` as its first line
  (`lib/bridge/port.ts`). Do not fix it with `tsconfig.json`'s `types` — that array replaces
  tsgo's auto-list instead of extending it.
- `typecheck` chains `wxt prepare` because `tsconfig.json` extends `./.wxt/tsconfig.json`.
- Hand-written `.d.mts` files type the `.mjs` modules imported from TypeScript (`allowJs` is
  off), and nothing checks they match their implementation. List them with
  `find . -name '*.d.mts' -not -path '*/node_modules/*'`.

## Build freshness

- `coverage/` is gitignored on purpose: untracked output joins `tests/support/build.ts`'s source
  set and reports both builds stale, so every build-reading test fails about staleness.
- Never cache or pass `.output/` between CI jobs: a restore writes fresh mtimes, so an artifact
  built from other sources reads as fresh — a silent false green. Both builds take about a
  second; rebuild in each job.

## Tailwind sources

- `entrypoints/popup/style.css` opens with `@import "tailwindcss" source(none)` and four
  `@source` lines — `components`, `entrypoints`, `lib`, `public`. That list, not
  auto-detection, decides what is source, which is what lets the Firefox sources archive
  rebuild byte-identically. **A UI file outside those four directories loses its CSS in
  silence**; `tests/unit/cssSources.test.ts` holds every tracked `.tsx`/`.html` outside `tests/`
  and `docs/` to them.
- Tailwind reads sources as raw text: **a class named in a comment inside those four
  directories ships its CSS.** Naming classes in tests, docs and `.md` files costs nothing.

## Node

- `.nvmrc` pins 24. npm trusted publishing needs npm ≥ 11.5.1 and Node ≥ 22.14.0.
