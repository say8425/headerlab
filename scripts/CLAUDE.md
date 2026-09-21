# scripts/

Generators of committed images. Not shipped, needs no credential, not run by CI.
`README.md` here lists each file, how it runs and where its output goes.

- Keep release tooling out of this directory: anything CI runs, or anything that needs a store
  credential, belongs in `.github/scripts/`.
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
- The toolbar mark is drawn in `make-icons.mjs` and again in `store-assets.mjs` (`MARK`). Change
  both, and re-run both generators.
- Images are read by a human, not by a test: nothing checks pixel colour or text rendering. Look
  at the output before committing it.

Store-listing specifics (sizes, the store icon's padding, the listing copy) are in
`.claude/rules/chrome-web-store.md`.
