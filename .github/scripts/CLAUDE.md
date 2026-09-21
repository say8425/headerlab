# .github/scripts/

Store release tooling, run by CI (`cws-submit.yml`, `amo-submit.yml`) and by the maintainer.
`README.md` here lists each file, who runs it and which credentials it reads.

- **Every step here can fail after the release tag is cut.** A refusal must say what the store
  answered and what to do next; never swallow the cause, and never report more than the store
  confirmed. (On AMO's listed channel that confirmation is `wxt submit` passing validation;
  approval arrives by email, and the script says so.)
- **I/O in the top-level script, decisions in `lib/`.** Whatever decides what a response *means*
  (`mayUpload`, `readSignedFile`) is a pure function in `lib/`, unit-tested in
  `tests/unit/{cws,crx,amo}.test.ts`. Unknown states refuse; widen a set only from a real
  response, which is what the probes are for.
- **Exception, and untested:** `lib/crx.mjs` only *parses* a CRX. The checks that decide whether
  it is right — the version against `package.json`, the declared key against this key's DER, the
  signed id against the id that key derives, and the payload against the release zip by
  SHA-256 — run inline in `pack-crx.mjs`, and no unit test covers them.
- **Credentials:** environment variables first. Only `pack-crx.mjs`, `amo-submit.mjs` and
  `amo-probe.mjs` fall back to `op read` (the maintainer's 1Password). The AMO scripts refuse to
  reach the vault under `CI`; `pack-crx.mjs` has no such check and relies on `cws-submit.yml`
  setting `HEADERLAB_CRX_KEY`. A secret is never a command-line argument, and `amo-submit.mjs`
  redacts both credentials and anything JWT-shaped from the `wxt submit` output it prints.
- **No new dependencies**: plain Node, `fetch`, and what wxt already brings (`wxt submit`).
- Scripts find the repository root from their own location
  (`path.resolve(dirname, '..', '..')`); moving a file changes that depth.
- A module a TypeScript test imports needs a hand-written `.d.mts` beside it (`allowJs` is off);
  update both together.
- Changing a script's path also means updating: `package.json`, the workflow `run:` lines,
  `tests/unit/storeSubmit.test.ts` (invocation order) and `tests/unit/amo.test.ts` (spawns
  `amo-submit.mjs` by path), both runbooks' recovery tables, the `.claude/rules/` path lists, and
  the usage strings inside the scripts. `tests/unit/workspace.test.ts` fails if a workflow or a
  `package.json` script names a script that does not exist.
- Re-running a store job by `workflow_dispatch` takes the workflow from `main` but the scripts
  from the tag (or `ref`). A tag cut before 2026-09-21 has no `.github/scripts/`; pass
  `ref: main` for those.

Store specifics — the Chrome Web Store API schema, verified CRX, AMO throttling and JWT rules —
are in `.claude/rules/chrome-web-store.md`, `firefox-amo.md` and `ci-release.md`. Comments here
that cite a "CLAUDE.md … section" mean the root CLAUDE.md or the rules file its table maps that
section to.
