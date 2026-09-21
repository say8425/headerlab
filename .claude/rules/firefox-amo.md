---
paths:
  - ".github/scripts/amo-*.mjs"
  - ".github/scripts/lib/amo.mjs"
  - "docs/store/amo/**"
  - ".github/workflows/amo-submit.yml"
  - "PRIVACY.md"
  - "tests/unit/amo.test.ts"
---

# Firefox Add-ons (AMO)

Listed at <https://addons.mozilla.org/firefox/addon/headerlab/> — add-on id 3071835, slug
`headerlab`. `docs/store/amo/checklist.md` is the runbook. `pnpm amo:probe` reads what AMO holds
(versions, what `readSignedFile` makes of each, the five previews, the icon,
`has_privacy_policy`) without writing anything.

## Submitting

- `amo-submit.yml` runs `node .github/scripts/amo-submit.mjs --channel <c> --expect-version <v>`: it
  checks the release's Firefox zip is that version, runs `wxt submit` with the sources archive,
  and on `unlisted` waits for the signature and attaches `headerlab-<v>-firefox.xpi` to the
  release. Green means AMO validated the upload and created the version — not published; listed
  approval arrives by email.
- `wxt submit` is `publish-browser-extension` (a wxt dependency) under an alias, so it adds no
  dependency. It cannot create an add-on and never fetches the signed file; the script polls the
  version-detail endpoint through `readSignedFile`, fail-closed on any file status the API does
  not document (`public`, `unreviewed`, `disabled`). AMO refuses a version it already holds.
- The signed-file download is the one unmeasured path: it follows at most three redirects, only
  to AMO or `addons.cdn.mozilla.net` (`downloadHop`), sends the JWT to AMO only, and checks the
  sha256 from the authenticated version response. The first unlisted release is the
  measurement.
- The channel is `FIREFOX_CHANNEL` on the `firefox-amo` environment (`listed` when unset),
  overridable per `workflow_dispatch`. Unlisted installs do not auto-update — no `update_url`,
  by decision.
- The script refuses to run while `.env.submit` exists (the publisher reads it, and it is
  gitignored), strips ambient `CHROME_*`, `EDGE_*`, `OPERA_*`, `FIREFOX_*` and `DRY_RUN` from
  the child's environment (`submitEnvironment`), and puts `node_modules/.bin` first on its
  PATH — outside `pnpm run` the alias cannot find `wxt-publish-extension` and exits 1 with no
  output. `--dry-run` proves the credentials and the add-on's existence and uploads nothing.

## Credentials

- AMO wants `Authorization: JWT <token>`: HS256 over `{ iss, jti, iat, exp }` with `exp` at most
  five minutes after `iat`, which `claimSet` enforces. The key pair is the 1Password item
  **Firefox AMO Token** (Personal): `username` is the issuer (`user:<id>:<key>`), `password` the
  secret. The scripts `op read` them when the environment has neither; half a pair is refused,
  and under `CI` the vault is never asked. Treat the issuer as a secret too. Neither value is
  ever an argument, and child output is redacted before printing.
- `op` reads through the 1Password app's CLI integration: there is no `op signin`, the app asks
  for biometrics on the first read, and `op whoami` saying "account is not signed in" before
  that read is not a failure — try the read.

## Throttling

- AMO throttles writes per account, and **a release spends from the same budget as listing
  edits**: filling the listing by hand once made the next release's version-create take a `429`.
  Do not edit the listing in the hours before merging a release PR. Pace writes, read the
  listing back and upload only what is missing — a repeated `POST …/previews/` adds a second copy.
- After a `429`: wait out the seconds it names, run `pnpm amo:probe`, then `workflow_dispatch`
  `amo-submit.yml` against the same tag with `ref` empty. A `429` inside the unlisted signature
  poll lands after the version exists, so a blind re-run there meets AMO's duplicate refusal.

## Listing

- Fields are an API away: `PATCH /addons/addon/headerlab/` (JSON for text, multipart for the
  icon), `POST`/`PATCH …/previews/`, `PATCH …/eula_policy/`. `docs/store/amo/listing.md` has the
  table and what the captions leave out.
- Summary ≤ 250 characters, up to two categories (`web-development`), licence `Apache-2.0`,
  screenshots at 1280×800. The five screenshots are the Chrome captures (owner's call,
  2026-09-10) and show the bridge row the Firefox popup lacks; `tests/support/firefox.ts`'s
  `screenshot()` is the tool for a Firefox set.
- The privacy policy is pasted text, not a link, and AMO renders no Markdown:
  `docs/store/amo/privacy.en.md` is `PRIVACY.md` as plain text, held to it by
  `tests/unit/storeListing.test.ts`. **AMO linkifies what it stores**, rewriting each URL into
  Mozilla's outgoing-link wrapper, so unwrap the `<a>` elements before comparing a read-back
  with the file — otherwise a correct store reads as a mismatch.
- The data-collection declaration renders from the manifest's `data_collection_permissions`.

## Sources archive

- Required: a reviewer rebuilds it and diffs ("There must be no differences"). `wxt zip -b
  firefox` writes it by globbing `**/*` without reading `.gitignore`, so `wxt.config.ts`
  excludes `docs/**` and the report directories; inspect with
  `unzip -Z1 .output/headerlab-<v>-sources.zip`. Dotfiles are left out, `.nvmrc` included, which
  is why the READMEs' "Build it yourself" states Node 24 in words.
- It rebuilds byte-identically only because the popup CSS reads a fixed `@source` list
  (toolchain rules); that was measured by extracting, installing and building on Node 24 and
  diffing every output file. **Nothing re-checks it** (owner's call, 2026-09-10), so anything
  that starts reading outside its own inputs reaches a reviewer before it reaches CI.
- The release attaches this archive beside the two zips, and `amo-submit.yml` submits that file
  rather than rebuilding it.

## Validator warnings

- Expected, and none from this repository's code: "The Function constructor is eval" (zod's JIT
  probe — `lib/model/zod.ts` sets `jitless` so it never runs, and every schema must take `z`
  from there; `tests/unit/zodConfig.test.ts` refuses a direct import), "Unsafe assignment to
  innerHTML" (React DOM's `dangerouslySetInnerHTML` handler, unused here), and the Android half
  of the `data_collection_permissions` minimum-version warning (the listing is desktop only;
  the gecko floor is 140 for the desktop half). `docs/store/amo/reviewer-notes.md` tells the
  reviewer.
