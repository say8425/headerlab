---
paths:
  - "tests/**"
  - "packages/*/test/**"
  - "packages/*/test-support/**"
  - "vitest.config.ts"
  - "playwright.config.ts"
---

# Testing

The core discipline — assertions that can fail, mutation-verify, guards guard something — is in
CLAUDE.md. This file carries the detail.

## Suites

- `pnpm test`: vitest over `tests/unit`, after both builds, since several tests read `.output/`.
  `pnpm test:packages`: `node:test` suites in `packages/*/test/*.mjs`, which vitest's glob never
  reaches. `pnpm test:e2e`: Playwright for Chrome, and Firefox through Marionette
  (`tests/support/firefox.ts`) — Playwright cannot load a Firefox extension, and WebDriver BiDi
  refuses `moz-extension://` navigation.
- Count e2e tests with `pnpm exec playwright test --list`. `grep -cE '^test\(' tests/e2e/*.spec.ts`
  agrees only while no `test.describe`, `test.each` or `test.skip` exists.
- The strongest evidence in the repo: the e2e tests that send a real request through the
  loopback echo server and read the headers back (Chrome and Firefox), and the bridge tests that
  check `bridge install`'s computed id against the one Chrome assigned and read the result off
  `chrome.storage` rather than off the CLI's own reply. Do not weaken them.
- A red Firefox e2e job in CI is a real signal: the harness is proven both on this Mac and on
  `ubuntu-latest` headless under xvfb.

## Assertions

- A guard over a state is only as good as its fixture. The overflow spec runs with all-sites
  off, so it renders no `idle` row and stayed green over an over-long string there; the `idle`
  case lives in the reflow guard, which toggles all-sites. Only a mutation that turns the test
  red proves coverage.
- **Read a grep's real output, never a description of it.** Claims about what a file or command
  literally says come from the bytes.
- Colour coverage is thin: the e2e suite asserts geometry almost everywhere and one colour (the
  ghost row's hovered background, compared against its sibling row's computed fill), with no
  snapshot comparisons. Find colour reads with
  `grep -rnE '\.(backgroundColor|outlineColor|borderColor|[a-zA-Z]*[Cc]olor)\b' tests/e2e/` —
  it matches the property access, so it survives `const cs = getComputedStyle(el)`, and it
  over-reports comments rather than missing reads. Histogramming `getComputedStyle(…).<prop>`
  misses the bound form.

## Mutation testing

- Mutating an installer writes to real user directories: the mutations that break a test's
  scratch-path isolation are exactly the ones that escape it. Register teardown with `t.after`
  before the install runs — never a cleanup call at the end of the test body — and check
  `~/.headerlab/bin` and the real per-user socket directory by hand afterwards.

## Races

- "Flaky" names a symptom. Reproduce deterministically by planting a delay in the suspected
  window (for example `await new Promise((r) => setTimeout(r, 300))` before
  `writeRegistryEntry` in `packages/headerlab/lib/host.mjs`). Wait for every file an assertion
  depends on, then assert only what the wait did not already establish — waiting for a file and
  asserting it exists is a tautology.

## CLI tests (`packages/headerlab`)

- The presentation layer — `lib/render.mjs`, `help.mjs`, `commands.mjs`, `suggest.mjs`,
  `exit.mjs` — is pure; test it without spawning. `lib/output.mjs` takes streams and
  environment as arguments (`resolveMode(globals, streams)`, `resolveColor(globals, env,
  stream)`), so tty-only branches are table-testable. Only `test/process.test.mjs` needs a real
  process (closed stdout pipe, SIGINT, terminal-only branches).
- `test-support/tty-harness.mjs` sets `process.stdin.isTTY = true` on a real pipe before
  importing the CLI: it reaches the branch, not a terminal. `process.stdin.pause()` releases the
  event loop on a pty but not on a pipe, so the prompt also calls `unref()`.
- `test/docs.test.mjs` holds the five READMEs to the same list of `headerlab …` lines inside
  `bash`-tagged fences (commands are not translated; indentation is stripped), and binds
  `SKILL.md` to the CLI: every command path appears, every `ERROR_CODES` code appears in
  backticks, and the skill's extension-side code list equals the codes `exitFor` sends to exit 1
  less `install-failed`. The first two bind names, not claims — writing every explanation false
  leaves them green. Re-read the prose (cli-bridge rules).
