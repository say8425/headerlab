# Chrome Web Store listing

Everything needed to publish HeaderLab to the Chrome Web Store, prepared ahead
of the submission. Nothing here ships in the extension.

**Start with [`checklist.md`](checklist.md).** It runs top to bottom and points
at the other files as it goes.

| File | What it is |
| --- | --- |
| [`checklist.md`](checklist.md) | The runbook: account, package, upload, both tabs, submit, aftermath |
| [`listing.md`](listing.md) | Store listing tab — category, URLs, the asset-to-slot mapping, and which fields are read from the manifest rather than typed |
| [`description.en.md`](description.en.md) | Detailed description, English |
| [`description.ko.md`](description.ko.md) | Detailed description, 한국어 |
| [`description.ja.md`](description.ja.md) | Detailed description, 日本語 |
| [`description.zh_CN.md`](description.zh_CN.md) | Detailed description, 简体中文 |
| [`description.es.md`](description.es.md) | Detailed description, Español |
| [`privacy.md`](privacy.md) | Privacy practices tab — single purpose, a justification per permission, data-use answers |
| [`../../PRIVACY.md`](../../PRIVACY.md) | The privacy policy itself. This is the URL the store is given |
| `assets/` | Every image, generated — see below |

## Three things that are easy to get wrong

**The title and the summary are not listing fields.** The store reads both out
of the uploaded package — `manifest.name` and `manifest.description`. Changing
either means shipping a new version, not editing the listing. `listing.md` has
the current values and the character counts.

**Five languages is a property of the package, not of the dashboard.** The
listing-language dropdown offers exactly the locales the zip carries under
`_locales/`. That is why `public/_locales/` exists and why
`tests/unit/i18n.test.ts` guards it — drop a locale directory and four listings
silently become unavailable.

**The store icon is not the toolbar icon.** The store wants 96×96 of artwork
inside 16px of transparent padding; `public/icon/active-128.png` is full bleed,
because a toolbar slot has no padding to give. `assets/store-icon-128.png` is
the one to upload.

## Regenerating the images

```bash
pnpm store:assets
```

Builds the extension, loads it in real Chrome, photographs the popup in five
states, and composes 28 files into `assets/`: twenty-five 1280×800 screenshots
(five states × five locales), the 128×128 store icon, the 440×280 small promo
tile and the 1400×560 marquee.

Every file's pixel dimensions are checked after it is written, and the run
aborts rather than writing a set the store would reject. Two failure modes it
cannot see, so look at the output:

- **Missing CJK fonts.** On a machine without Korean, Japanese and Chinese faces
  the captions render as empty boxes and every check still passes.
- **Colour and contrast.** Nothing in this repository reads a pixel's colour.

The popup in every screenshot is the production build. The one thing staged is
the *route* by which two example hosts became granted: `permissions.request()`
opens a dialog Playwright cannot click, so the generator patches
`host_permissions` into the loaded copy. `listing.md` says so, and the pending
row in screenshot 2 is genuine — `internal.example.com` is deliberately left out
of that patch.
