# Chrome Web Store — Store listing tab

Everything the **Store listing** tab asks for, ready to paste. The detailed
description is beside this file as `description.en.md`.

> Paste the descriptions as **plain text**. The store does not render Markdown —
> it keeps your line breaks and nothing else, which is why those files put the
> text to paste inside a fenced block and use `•` and capitalised headings
> rather than `-` and `##`.

## Fields that are not on this tab

Two of the most visible things in a listing are read out of the uploaded
package, not typed into the dashboard. The tab says so itself: it is for
"information about your item that isn't included in the metadata of the
manifest."

| What the shopper sees | Where it comes from | Current value |
| --- | --- | --- |
| Item title | `manifest.name` | `HeaderLab` |
| Summary, under the title | `manifest.description` | the string below |

So the summary is changed by editing the `description` literal in
`wxt.config.ts` and shipping a new package, never by editing the listing.

### The summary

Chrome's limit is 132 characters. `tests/unit/manifest.test.ts` fails the build
before an over-long one can reach an upload.

| Locale | Characters | Summary |
| --- | --- | --- |
| `en` | 119 | Set, append or remove HTTP request and response headers, per site. No host access until you grant it. No network calls. |

Re-measure rather than trusting the column — `tests/unit/storeListing.test.ts`
compares this row against the built manifest, counting UTF-16 units, which is
the reading that cannot under-report whichever way the store counts.

## Fields that are on this tab

| Field | Value |
| --- | --- |
| Category | **Developer Tools** |
| Language | **English (United States)**. The package declares no locales, so the dropdown offers nothing else |
| Detailed description | `description.en.md` |
| Official URL | `https://github.com/say8425/headerlab` |
| Homepage URL | `https://github.com/say8425/headerlab` |
| Support URL | `https://github.com/say8425/headerlab/issues` |
| YouTube video | none |
| Mature content | **No** |

## One language, and why

The language dropdown at the top of the tab offers exactly the locales the
uploaded package carries under `_locales/`. **This package carries none**, so
the dropdown offers only the default set here.

That is a decision rather than an omission (owner's call, 2026-08-23). The
package used to declare five locales, which made the dashboard report five
supported languages — while those five files translated exactly one string
between them and the popup UI was English in all of them. The design documents
said "UI language: English" from the first week; the directories were what
drifted. `tests/unit/manifest.test.ts` now pins their absence.

The store's own localisable/not-localisable split is worth keeping on record,
because it is a rule about the store rather than about this package:

**Localisable:** the detailed description, the screenshots, and the promotional
video.

**Not localisable:** the small promo tile and the marquee promo tile — the
store's own wording is "The small tile and Marquee promo tile cannot be
localized." Category and the URLs above are single values too.

## Graphic assets

Everything below is generated — `pnpm store:assets` — and lands in
`docs/store/assets/`. Nothing here is cropped by hand, and the popup in every
screenshot is the production build photographed in real Chrome.

| Slot | File | Size |
| --- | --- | --- |
| Store icon | `store-icon-128.png` | 128×128 |
| Small promo tile | `promo-small-440x280.png` | 440×280 |
| Marquee promo tile | `promo-marquee-1400x560.png` | 1400×560 |
| Screenshots | `screenshot-{1..5}-*.png` | 1280×800 |

**The store icon is not `public/icon/active-128.png`.** The store asks for 96×96
of artwork centred inside 16px of transparent padding; the toolbar icon is full
bleed, because a toolbar slot has no padding to give. Same glyph, different
frame, and uploading the toolbar one would leave the mark visibly larger than
every neighbour on a category page.

### Screenshot order

The store shows them in the order they are uploaded, and the first is the one
most people ever see. Upload in the numeric order the filenames carry:

| # | File stem | What it shows |
| --- | --- | --- |
| 1 | `screenshot-1-scoped` | Four rules across two granted sites — the ordinary working state |
| 2 | `screenshot-2-permission` | A pending site, amber, with its Grant button |
| 3 | `screenshot-3-blocked` | A rule Chrome would refuse, named on its own row, counted `1 blocked` |
| 4 | `screenshot-4-allsites` | All-sites mode on, permission not held, saved sites reading "All sites is on" |
| 5 | `screenshot-5-dark` | The same popup following a dark OS theme |

## What the screenshots do not claim

Shots 1, 2, 3 and 5 each show at least one site reading "Access granted". Real
grants come from a Chrome permission dialog that Playwright cannot click, so the
generator loads the production build with `host_permissions` patched in for two
example hosts. The images are of the real popup rendering real state; the
*route* by which those two hosts became granted is the only thing staged.

**Shot 4 is the exception and is not a granted shot at all.** Its two hosts hold
the same patched permission, and its rows still read "Not in use while All sites
is on" — because all-sites mode keeps the stored list and compiles none of it,
so those hosts scope nothing. Granted at the Chrome level, `idle` on screen.

Shot 2 is where the pending state is genuine: `internal.example.com` is
deliberately left out of the patch, so its amber row and its Grant button are
real, sitting beside a granted `api.example.com` that is not.

That distinction is worth having ready if a reviewer asks.
