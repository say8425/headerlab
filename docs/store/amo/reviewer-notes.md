# Notes to reviewer

Paste the block below into **Notes to Reviewer** on every submission — the
first by hand, and thereafter it is what `amo-submit.yml` cannot fill in for
you (publish-browser-extension sends no `approval_notes`), so add it in the
Hub when a reviewer asks. The sources archive is required because the package
is bundled, and Mozilla's rule is that a reviewer rebuilds it and diffs: "There
must be no differences."

```text
Built with WXT 0.21 (Vite) and Tailwind CSS v4, so the package is bundled; the sources archive is the repository at the release tag, produced by `wxt zip -b firefox`, with docs/ and generated test/coverage reports left out (no build inputs there).

To reproduce, on any OS with Node 24 (the repository pins it in .nvmrc, which the archive omits as a dotfile):

  corepack enable                    # pnpm 11.20.0, from package.json's packageManager field
  pnpm install --frozen-lockfile
  pnpm build:firefox                 # → .output/firefox-mv3/

The contents of .output/firefox-mv3/ are the uploaded package, byte for byte. Measured on 2026-09-11 from a clean extraction of this archive with Node 24.16.0 and pnpm 11.20.0: all 12 files identical to the uploaded zip's, and again after a second build in the same tree.

The extension makes no network calls. `grep -rE 'fetch\(|XMLHttpRequest|WebSocket|sendBeacon' .output/firefox-mv3` returns nothing, and tests/unit/bundle.test.ts in the repository asserts the same against every build. It declares no host permissions at install; access is requested per site at runtime through optional_host_permissions.
```

**Why that measurement holds, and what would break it.** The one part of the
build that read beyond its inputs was Tailwind, which scanned the whole tree
for class names. In the repository it read test files this archive leaves out;
in an extraction, which has no `.gitignore`, it read the build's own
`.output/`. Both changed the popup CSS — 45,818 B against 45,274 B on
2026-09-11, the day it was found. `entrypoints/popup/style.css` now names the
four directories Tailwind may read, and `tests/unit/cssSources.test.ts` holds
that list to every file carrying markup.

Nothing re-runs the extraction before a release (owner's call, 2026-09-10), so a
reviewer's diff is the next measurement. If one names a difference, suspect the
Node major first, then anything new that reads outside its own inputs.
