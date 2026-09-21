# scripts/

Generators of committed images. Not shipped, needs no credential, invoked by no workflow (CI's
unit job only imports `lib/png.mjs` through `tests/unit/storeAssets.test.ts`). `README.md` here
lists each file, how it runs and where its output goes.

- Keep release tooling out of this directory: anything a workflow invokes, or anything that needs
  a store credential, belongs in `.github/scripts/`.
- Photograph the real built extension, never a mock, and wait for the screen *state* each shot
  claims — never a duration. That logic lives once, in `lib/popup-shots.mjs`; extend it rather
  than copying it into a generator.
- `lib/png.mjs` is the one PNG size decoder, shared with `tests/unit/storeAssets.test.ts` so the
  generator and the test cannot disagree about a valid image. Do not add a second one.
- A module a TypeScript test imports needs a hand-written `.d.mts` beside it (`allowJs` is off),
  and nothing checks the declaration against the implementation — update both together.
- Scripts find the repository root from their own location — `..` at the top level, `../..` in
  `lib/popup-shots.mjs`, which the two photographers import `ROOT` from. Moving a file changes
  that depth.
- The toolbar mark is drawn three times — `make-icons.mjs` (`svg()`) and `store-assets.mjs`
  (`MARK`, `STORE_ICON_HTML`). Change all three, and re-run both generators.
- `make-icons.mjs` and the store tiles launch Playwright's default headless shell; the popup
  captures use `channel: 'chromium'`. Keep it that way: switching the icon renderer to the full
  Chromium changes every committed icon's anti-aliasing.
- Images are read by a human, not by a test: nothing checks pixel colour or text rendering. Look
  at the output before committing it.

Store-listing specifics (sizes, the store icon's padding, the listing copy) are in
`.claude/rules/chrome-web-store.md`. Comments here that cite a "CLAUDE.md … section" mean the
root CLAUDE.md or the rules file its table maps that section to.
