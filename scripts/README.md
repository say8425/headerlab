# scripts

Generators for the images this repository commits. Nothing here ships in the extension, nothing
here needs a credential, and no workflow runs it — anyone with a clone can run all of it.

Store release tooling (signing, submitting, probing the stores) is not here; it lives in
[`.github/scripts/`](../.github/scripts/README.md), because CI runs it.

| File | What it does | Run with | Writes |
| --- | --- | --- | --- |
| `make-icons.mjs` | Renders the toolbar icons from one SVG source | `node scripts/make-icons.mjs` — no pnpm script, nothing else runs it | `public/icon/active-{16,32,48,128}.png`, `paused-{16,32}.png` |
| `screenshots.mjs` | Photographs the real production popup for the five READMEs | `pnpm screenshots` (builds first) | `docs/screenshots/*.png` |
| `store-assets.mjs` | Generates the 8 Chrome Web Store images and checks each PNG's size | `pnpm store:assets` (builds first) | `docs/store/assets/` (emptied first) |
| `lib/popup-shots.mjs` | The capture loop `screenshots.mjs` and `store-assets.mjs` share: build freshness, stored-state fixtures, waiting until the popup shows the state its caption claims | imported | — |
| `lib/png.mjs` | Reads a PNG's size from its own bytes; shared by `store-assets.mjs` and `tests/unit/storeAssets.test.ts` | imported | — |

`lib/png.d.mts` types `png.mjs` for the TypeScript test that imports it (`allowJs` is off).

## Where the outputs go

- `public/icon/*.png` → the manifest's icons (`wxt.config.ts`) and the running/paused toolbar
  icon (`lib/sync/icon.ts`).
- `docs/screenshots/` → the five READMEs.
- `docs/store/assets/` → uploaded to the Chrome Web Store by hand (`docs/store/checklist.md`);
  the five screenshots are reused on Firefox Add-ons. `tests/unit/storeAssets.test.ts` checks the
  committed sizes.

## Before you run them

- Install **both** of Playwright's Chromium builds: `pnpm exec playwright install --with-deps
  chromium` (without `--no-shell`). The popup captures (`lib/popup-shots.mjs`) load the extension
  and need the full Chromium; `make-icons.mjs` and `store-assets.mjs`'s tiles render with
  `chromium.launch()`, which uses the headless shell. The `--no-shell` install in the root
  README is enough for the e2e suite but not for these two.
  Do not switch those two to the full Chromium to save the download: measured, it changes the
  anti-aliasing of every committed icon, up to fully flipped edge pixels at 16px.
- The outputs are tracked files, so a run leaves changes in `git status`. Commit them only when
  the UI or the artwork actually changed.
- Every popup capture — the README screenshots and the store screenshots alike — loads the
  production build with one edit, `host_permissions` for the example hosts
  (`lib/popup-shots.mjs`), because Playwright cannot click a permission dialog. The READMEs say
  so under the images.
- `make-icons.mjs --preview` also writes `.icon-preview.png` at the repository root, a
  legibility sheet. It is gitignored.
- The icon's artwork is drawn three times: `make-icons.mjs` (`svg()`), and `store-assets.mjs`
  twice (`MARK` and `STORE_ICON_HTML`). Change all three together — nothing checks they agree.
