# Firefox Add-ons — the listing form

Every field the Developer Hub asks for on a listed submission, with its value.
The detailed description is beside this file as `description.en.md`; the
privacy policy is `../../../PRIVACY.md`, pasted; reviewer notes are
`reviewer-notes.md`.

## Fields read out of the package

| What the visitor sees | Where it comes from | Current value |
| --- | --- | --- |
| Name | `manifest.name` | `HeaderLab` |
| Summary (pre-filled, editable) | `manifest.description` | the string in `../listing.md` — 119 characters against AMO's limit of **250** |
| Data collection | `browser_specific_settings.gecko.data_collection_permissions` | `none` — the listing says the extension collects no data, and there is no form field for it |
| Version, permissions | the manifest | shown as uploaded |

AMO's summary limit is 250 characters; Chrome's is 132, and
`tests/unit/manifest.test.ts` pins the shipped string under the smaller one, so
whatever passes for Chrome fits here. The string itself and its measured length
are in `../listing.md`, compared against the built manifest by
`tests/unit/storeListing.test.ts` — one row, one place.

## Fields on the form

| Field | Value |
| --- | --- |
| Add-on URL (slug) | `headerlab` — taken, and live at <https://addons.mozilla.org/firefox/addon/headerlab/> |
| Description | `description.en.md`, the fenced block, as plain text |
| Categories | **Web Development** (slug `web-development`). The second of the two slots is left empty, as Chrome's single category is; `privacy-security` is the candidate if the owner wants one |
| Support email | none — the Chrome listing has none either. Owner's call |
| Support website | `https://github.com/say8425/headerlab/issues` |
| Homepage | `https://github.com/say8425/headerlab` |
| License | **Apache License 2.0** (slug `Apache-2.0`) |
| Privacy policy | the block in `privacy.en.md`, pasted. **Text, not a URL** — this is the first thing that differs from Chrome's form, and AMO renders no Markdown |
| Notes to reviewer | `reviewer-notes.md` |
| Compatibility | Firefox desktop only. Do not tick Firefox for Android: the popup is 748×600 and was never measured on a phone |
| This add-on is experimental / requires payment | No / No |
| Tags | none |

## Images

| Slot | File | Size | Note |
| --- | --- | --- | --- |
| Icon | `../../../public/icon/active-128.png` | 128×128 | Full bleed. AMO does not ask for the 16px padding the Chrome store does and draws icons edge to edge in a rounded frame; the padded `../assets/store-icon-128.png` would read smaller than its neighbours. Same glyph — swap it if the two stores should match |
| Screenshots | `../assets/screenshot-{1..5}-*.png` | 1280×800 | AMO's own recommendation is 1280×800, "the maximum image display size". Upload in numeric order |

### Filling the images and the URLs after publication

The Hub is not the only way: the API takes all of it, and that is how this
listing's icon, homepage and screenshots were set on 2026-09-18, straight from
the files and captions below. Three of the five screenshots went up before the
throttle below asked for an hour; the last two follow it.

| What | Call |
| --- | --- |
| Homepage and the other text fields | `PATCH /api/v5/addons/addon/headerlab/`, JSON, translated fields as `{ "en-US": … }` |
| Icon | the same `PATCH`, as `multipart/form-data` with an `icon` part |
| A screenshot | `POST /api/v5/addons/addon/headerlab/previews/`, multipart, parts `image` and `position` |
| Its caption | `PATCH …/previews/<id>/`, JSON, `caption` as a translated field |
| The privacy policy | `PATCH /api/v5/addons/addon/headerlab/eula_policy/`, JSON, `privacy_policy` |

**AMO throttles these writes, and the release shares the same budget.** That is
the expensive half of the lesson, learned on 2026-09-18: filling the listing by
hand left no allowance for the 1.8.0 release an hour later, and its
`amo-submit` job uploaded the package, passed validation, and then took a
`429` on the one call that creates the version. Observed waits, all from one
afternoon: 56 seconds after three quick writes, 1571 seconds before the privacy
policy would go, 3433 seconds before a fourth screenshot, 933 seconds for the
release's version-create. Read them as a bucket per account rather than per
endpoint.

So: **do not fill the listing in the hours before merging a release PR**, pace
what you do send, read the listing back before retrying, and upload only what is
missing — a repeated `POST` to `previews/` adds a second copy rather than
replacing the first. If a release does take the `429`, `amo/checklist.md` §8
has the recovery.

### Screenshot order and captions

The captions are AMO's, per image, and are the "What it shows" column of
`../listing.md` with one word changed where a Chrome-only thing was named.

| # | File stem | Caption |
| --- | --- | --- |
| 1 | `screenshot-1-scoped` | Four rules across two granted sites — the ordinary working state |
| 2 | `screenshot-2-permission` | A pending site, amber, with its Grant button |
| 3 | `screenshot-3-blocked` | A rule the browser would refuse, named on its own row, counted 1 blocked |
| 4 | `screenshot-4-allsites` | All-sites mode on, permission not held, saved sites reading "All sites is on" |
| 5 | `screenshot-5-dark` | The same popup following a dark OS theme |

### What the screenshots do not show, and one thing they show that Firefox does not

Everything `../listing.md` says under "What the screenshots do not claim"
holds here: the granted rows were staged through a patched manifest, shot 4's
rows are `idle` on purpose, shot 2's pending row is genuine.

**And the five are photographs of the Chrome popup.** Each carries the agent
bridge row at the bottom of the rail, and the Firefox popup renders no such row
(the build declares no `nativeMessaging` and the popup does not offer the
bridge — CLAUDE.md, "Non-negotiables"). Reused on the owner's instruction,
2026-09-10, because the rest of the popup is pixel-identical and the store's
recommended size is exactly what they are. The captions above do not mention
the row. Photographing the Firefox popup is a recorded follow-up:
`tests/support/firefox.ts` already has a `screenshot()` that produced the
images in the Firefox support PR (#86).
