# .github/scripts/

Store release tooling, run by CI (`cws-submit.yml`, `amo-submit.yml`) and by the maintainer.
`README.md` here lists each file, who runs it and which credentials it reads.

- **Every step here can fail after the release tag is cut.** A refusal must say what the store
  answered and what to do next; never swallow the cause, and never report success without
  reading it back from the store.
- **I/O in the top-level script, decisions in `lib/`.** Whatever decides what a response *means*
  (`mayUpload`, `readSignedFile`, the CRX header check) is a pure function in `lib/`, unit-tested
  in `tests/unit/{cws,crx,amo}.test.ts`. Unknown states refuse; widen a set only from a real
  response, which is what the probes are for.
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
- Changing a script's path or a workflow's invocation also means updating `package.json` and
  `tests/unit/storeSubmit.test.ts`, which pins the invocation order in the workflows.

Store specifics — the Chrome Web Store API schema, verified CRX, AMO throttling and JWT rules —
are in `.claude/rules/chrome-web-store.md`, `firefox-amo.md` and `ci-release.md`.
