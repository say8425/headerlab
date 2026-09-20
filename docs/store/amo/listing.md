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
listing's icon, homepage, screenshots and privacy policy were set, straight from
the files and captions below. Three of the five screenshots went up on
2026-09-18, before the throttle below asked for an hour; the last two and the
policy went up on 2026-09-19, after it.

**`pnpm amo:probe` is what says so, and reading it is cheaper than trusting this
page.** It prints the icon, `has_privacy_policy`, and every preview with its
size and caption in position order — five at 1280×800, in the caption order of
the table further down. Those fields ride on the add-on response the probe
already asks for, so the read below is one `GET` rather than three.

| What | Call |
| --- | --- |
| Everything already set | `GET /api/v5/addons/addon/headerlab/` — `icon_url`, `previews[]` with `image_size` and `caption`, `has_privacy_policy`. This is `pnpm amo:probe` |
| Homepage and the other text fields | `PATCH /api/v5/addons/addon/headerlab/`, JSON, translated fields as `{ "en-US": … }` |
| Icon | the same `PATCH`, as `multipart/form-data` with an `icon` part |
| A screenshot | `POST /api/v5/addons/addon/headerlab/previews/`, multipart, parts `image` and `position` |
| Its caption | `PATCH …/previews/<id>/`, JSON, `caption` as a translated field |
| The privacy policy | `PATCH /api/v5/addons/addon/headerlab/eula_policy/`, JSON, `privacy_policy` |

A translated field comes back as a locale map unless the request names a `lang`,
and as a flat string when it does. Read only `field['en-US']` and a listing that
is filled reports itself empty — which is exactly what the one-off script that
filled this listing did with a homepage it had just set. That script is not in
this repository, so the trap is written here rather than cited.

**AMO throttles these writes, and the release shares the same budget.** That is
the expensive half of the lesson, learned on 2026-09-18: filling the listing by
hand left no allowance for the 1.8.0 release an hour later, and its
`amo-submit` job uploaded the package, passed validation, and then took a
`429` on the one call that creates the version. Observed waits, all from one
afternoon — the last one in that job's own log, the first three read off the API
by hand here and recorded nowhere else: 56 seconds after three quick writes,
1571 seconds before the privacy policy would go, 3433 seconds before a fourth
screenshot, 933 seconds for the release's version-create. The privacy policy is
one `PATCH` like any other write; the plain-text copy beside `PRIVACY.md` is
about Markdown, not about this. Read the waits as a bucket per account rather
than per endpoint.

So: **do not fill the listing in the hours before merging a release PR**, pace
what you do send, read the listing back before retrying, and upload only what is
missing — a repeated `POST` to `previews/` adds a second copy rather than
replacing the first. If a release does take the `429`, `amo/checklist.md` §8
has the recovery.

### Reading the privacy policy back: AMO linkifies it

**The stored policy is never byte-identical to the file, and that is AMO's doing
rather than a failed write.** Measured 2026-09-19, straight after the `PATCH
…/eula_policy/` that filled it: 6,416 characters stored against the file's
5,672, the same 71 lines, and unwrapping the four `<a … rel="nofollow">`
elements AMO inserted leaves the two identical.

**Those 744 characters are mostly href**, because the anchor does not carry the
URL that was in the text. Mozilla rewrites each one into its outgoing-link
wrapper:

```html
<a href="https://prod.outgoing.prod.webservices.mozgcp.net/v1/<64 hex>/http%3A//api.example.com" rel="nofollow">api.example.com</a>
```

187 characters replacing 15, twice; the two real URLs cost 236 replacing 43 and
264 replacing 57. 172 + 172 + 193 + 207 = 744. Assume instead the plain
`<a href="<the url>" rel="nofollow">` shape — 30 fixed characters around the URL
the text already had — and the total comes to **250**, or to 264 if you also
guess the `http://` AMO prefixes onto the bare domain — which is what the
`http%3A//` above is. Either lands far enough short to read as an error in this
page rather than as a mechanism it failed to mention.

Two of the four wrap real URLs — the issues page and `PRIVACY.md`. The other two
wrap `api.example.com`, the example domain the policy uses to say what a header
rule does, so the listing renders that example as a clickable link. Cosmetic,
and left as it is: `example.com` is reserved for documentation (RFC 2606 §3)
precisely so it can be written without owning it. Compare with the anchors
unwrapped, or a correct write reads as a mismatch.

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
