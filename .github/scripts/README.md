# .github/scripts

Store release tooling: signing the Chrome package, submitting to the Chrome Web Store and
Firefox Add-ons, and read-only probes of what each store holds. Nothing here ships in the
extension.

These need the stores' credentials, so in practice only CI and the maintainer run them. When a
release PR is merged, `release-please.yml` calls `cws-submit.yml` and `amo-submit.yml`, which run
the scripts below from the checkout. The runbooks are `docs/store/checklist.md` and
`docs/store/amo/checklist.md`.

| File | What it does | Run by | Credentials |
| --- | --- | --- | --- |
| `pack-crx.mjs` | Signs the release zip into a CRX3, then reads it back: the header must declare this key and its id, and every payload file must match the zip by SHA-256 | `pnpm crx`; CI `cws-submit.yml` | signing key: `HEADERLAB_CRX_KEY` (a PEM path) |
| `store-submit.mjs` | Uploads the CRX, submits it for review and waits until the store reports it in review. It does not publish | CI `cws-submit.yml` only | `CWS_SERVICE_ACCOUNT_JSON`, `CWS_PUBLISHER_ID`, `CWS_EXPECTED_VERSION` |
| `store-probe.mjs` | Prints the Chrome Web Store's raw status for the item and what `lib/cws.mjs` makes of it. Read-only | `pnpm store:probe` | `CWS_SERVICE_ACCOUNT_JSON`, `CWS_PUBLISHER_ID` |
| `amo-submit.mjs` | Submits the Firefox zip with its sources archive (`wxt submit`); on the unlisted channel it waits for the signed `.xpi` | `pnpm amo:submit`; CI `amo-submit.yml` | `FIREFOX_JWT_ISSUER`, `FIREFOX_JWT_SECRET` |
| `amo-probe.mjs` | Prints what Firefox Add-ons holds: versions, previews, icon, privacy policy. Read-only | `pnpm amo:probe` | `FIREFOX_JWT_ISSUER`, `FIREFOX_JWT_SECRET` |
| `lib/cws.mjs` | Chrome Web Store API as decisions: may we upload, did the submission land, when to stop polling | imported | — |
| `lib/crx.mjs` | CRX3 header parsing, and the extension id a public key produces | imported | — |
| `lib/amo.mjs` | AMO's JWT claim set, endpoints, and readers for its responses | imported | — |

The `lib/` modules are pure and unit-tested without a network, a key or a store item
(`tests/unit/{cws,crx,amo}.test.ts`); each `.d.mts` beside them types the module for those
TypeScript tests.

In CI the credentials come from the `chrome-web-store` and `firefox-amo` environments. Run by
hand, `pack-crx.mjs`, `amo-submit.mjs` and `amo-probe.mjs` fall back to the maintainer's
1Password when the variables are unset; set the variables to use your own.

`pack-crx.mjs` also needs Google Chrome: set `CHROME` to the executable if it is not at the
default macOS path.
