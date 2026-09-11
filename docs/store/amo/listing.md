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
| Add-on URL (slug) | `headerlab` — free when measured on 2026-09-09: `GET /api/v5/addons/addon/headerlab/` answered 404 both anonymously and with the developer's JWT. The Hub is what finally decides; if it refuses, pick another and change `amo/checklist.md` §7's badge and links with it |
| Description | `description.en.md`, the fenced block, as plain text |
| Categories | **Web Development** (slug `web-development`). The second of the two slots is left empty, as Chrome's single category is; `privacy-security` is the candidate if the owner wants one |
| Support email | none — the Chrome listing has none either. Owner's call |
| Support website | `https://github.com/say8425/headerlab/issues` |
| Homepage | `https://github.com/say8425/headerlab` |
| License | **Apache License 2.0** (slug `Apache-2.0`) |
| Privacy policy | the body of `../../../PRIVACY.md`, pasted. **Text, not a URL** — this is the first thing that differs from Chrome's form |
| Notes to reviewer | `reviewer-notes.md` |
| Compatibility | Firefox desktop only. Do not tick Firefox for Android: the popup is 748×600 and was never measured on a phone |
| This add-on is experimental / requires payment | No / No |
| Tags | none |

## Images

| Slot | File | Size | Note |
| --- | --- | --- | --- |
| Icon | `../../../public/icon/active-128.png` | 128×128 | Full bleed. AMO does not ask for the 16px padding the Chrome store does and draws icons edge to edge in a rounded frame; the padded `../assets/store-icon-128.png` would read smaller than its neighbours. Same glyph — swap it if the two stores should match |
| Screenshots | `../assets/screenshot-{1..5}-*.png` | 1280×800 | AMO's own recommendation is 1280×800, "the maximum image display size". Upload in numeric order |

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
