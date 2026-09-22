---
paths:
  - ".github/scripts/pack-crx.mjs"
  - ".github/scripts/store-*.mjs"
  - ".github/scripts/lib/{cws,crx}.mjs"
  - "scripts/store-assets.mjs"
  - "scripts/make-icons.mjs"
  - "scripts/lib/{png,popup-shots}.mjs"
  - "docs/store/*.md"
  - "docs/store/assets/**"
  - "PRIVACY.md"
  - ".github/workflows/cws-submit.yml"
  - "tests/unit/{crx,cws,storeListing,storeSubmit}.test.ts"
---

# Chrome Web Store

Listed as `kgapijlldieckifoenckgninnepafhnn` (Developer Tools). `docs/store/checklist.md` is the
runbook.

## Submitting

- `cws-submit.yml` signs the release's own zip into a CRX and **submits it for review; it does
  not publish.** The store's `:publish` is a submission, so the furthest a green run gets is
  `PENDING_REVIEW`. `skipReview` is unavailable (it needs `declarativeNetRequest` as a required
  permission and changes confined to `rule_resources`). Never write that a merge publishes the
  extension.
- **Verified CRX uploads are on, and one-way** — no dashboard toggle reverts it; only CWS support
  does. ZIP uploads are refused: `pnpm crx` builds what the store takes, `pnpm zip` what the
  GitHub release carries. An accepted CRX proved the store's key is the one in 1Password
  (`op://Personal/HeaderLab CRX signing key`); `HEADERLAB_CRX_KEY` names a PEM path for anyone
  without 1Password.
- The key is also the `chrome-web-store` environment secret `CRX_SIGNING_KEY` (owner's call,
  2026-08-26). That weakens the point of verified uploads — surviving a compromised publishing
  account — and bought convenience of place, not of steps. It is narrowed by being an
  environment secret (read only by that one job, only when it starts), the environment's
  `main`-only branch rule, and `main` refusing direct pushes. The job uses no third-party action.
- The extension id `pack-crx.mjs` prints is derived from the signing key and is not the
  listing's id; the store repackages with its own key. The script says so where it prints it.
- `pack-crx.mjs` reads the bytes back rather than trusting Chrome's exit code: the declared
  public key must be this key's DER **and** the signed crx id must be the one this key derives
  (the store rejects a mismatch of either, after the tag is cut), and every payload file is
  compared with the release archive by SHA-256. Compare contents, never archives — `pnpm zip`
  is not byte-reproducible, though its contents are. `.github/scripts/lib/crx.mjs` holds the pure
  parsing, tested against synthetic headers in `tests/unit/crx.test.ts`.
- `pnpm crx` writes the key to a 0600 file in a 0700 temp directory and removes it from a
  `process.on('exit')` handler registered right after `mkdtempSync`, with a `SIGINT` handler
  routing through `process.exit`. A `try/finally` is not enough: `process.exit()` skips it.
  `.gitignore` carries `*.pem` and `*.crx`.
- The v1.1 Update API (the only one documenting CRX upload) retires 2026-10-15, and v2's
  documentation does not mention CRX. Measure before building on either.

## Store API (v2)

- **Run `pnpm store:probe` before changing anything that reads the API.** It prints the raw
  `fetchStatus` body and what `.github/scripts/lib/cws.mjs` makes of it. The schema was first
  written from a guess, and tests written from the same guess could not see it.
- State lives on two revisions, `publishedItemRevisionStatus` and `submittedItemRevisionStatus`,
  either possibly unset. After `:publish`, the new version is the **submitted** revision while
  the published one keeps the old version until review passes. The version is in
  `distributionChannels[].crxVersion`. A status response's upload state is
  `lastAsyncUploadState`; `uploadState` belongs to the upload response only.
- `UploadState`: `UPLOAD_STATE_UNSPECIFIED`, `SUCCEEDED`, `IN_PROGRESS`, `FAILED`, `NOT_FOUND`
  (also accept `UPLOAD_IN_PROGRESS`, which the field docs use). `ItemState`:
  `ITEM_STATE_UNSPECIFIED`, `PENDING_REVIEW`, `STAGED`, `PUBLISHED`, `PUBLISHED_TO_TESTERS`,
  `REJECTED`, `CANCELLED` — there is no `IN_REVIEW`.
- `mayUpload` in `.github/scripts/lib/cws.mjs` is fail-closed: it refuses any submitted-revision
  state it cannot name. If it refuses a state the store really uses, widen the sets in that file from
  the probe's output, and re-run the store job with `ref` (ci-release rules).

## Listing

- The item's title is `manifest.name` and its summary is `manifest.description` (≤ 132
  characters, counted in UTF-16 units by `tests/unit/manifest.test.ts`). Changing either is a
  release, not a form edit.
- **No locales, by decision** (owner's call, 2026-08-23): no `_locales/`, no `default_locale`,
  no `__MSG_`. The production-manifest suite pins all three absences separately; a `__MSG_`
  reference with neither of the others loads fine and ships the placeholder as the store
  summary. Bringing locales back means all three pieces together, and translated listings.
- A privacy policy is required even when data never leaves the device. The listing points at
  `PRIVACY.md`; `docs/store/privacy.md` holds the privacy tab's answers and flags the owner's
  call on whether a header field holding bearer tokens is "Authentication information".
- Trader status is the developer's self-declaration (non-trader, 2026-08-21) and does not limit
  distribution. Never decide it, or assume what either route publishes, for the owner.
- Detailed description, screenshots and promo video are per-locale; the small tile, marquee,
  category and URLs cannot be localised.
- `pnpm store:assets` generates all 8 images (5 screenshots at 1280×800, the store icon, small
  tile, marquee) and refuses a set whose PNG IHDR sizes the store would reject. Nothing reads a
  pixel's colour — look at them. The store icon is 96×96 artwork inside 16px of padding: the
  toolbar glyph wrapped in `translate(16,16) scale(0.75)`, never redrawn.
- `tests/unit/storeListing.test.ts` holds `docs/store/description.en.md` and the AMO copy each
  to a positional skeleton (no Markdown — the store renders none, so `**` reaches readers as
  itself) and lists by name every line the AMO copy adds. A skeleton cannot see two bullets
  swapping places.
