# Chrome Web Store listing

Everything the [published listing](https://chromewebstore.google.com/detail/headerlab/kgapijlldieckifoenckgninnepafhnn)
is made of. Written before the first submission, kept because every field here
is still what the dashboard holds and a second listing would need all of it
again. Nothing here ships in the extension.

**Start with [`checklist.md`](checklist.md).** It runs top to bottom and points
at the other files as it goes. Its last two sections are the ones that stay
useful now that the item exists: what releasing to the store does on its own,
and what it deliberately does not.

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

**One language, and that is a decision (owner's call, 2026-08-23).** The
listing-language dropdown offers exactly the locales the zip carries under
`_locales/`, and this package carries none. It used to carry five, which made
the dashboard report five supported languages — while those five files
translated one string between them and the popup called `i18n` nowhere, so a
person installing in Korean got an entirely English UI.

What that cost, stated rather than buried: four translated store listings and
their twenty screenshots are gone, and the summary under the item title is
English for everyone. The four descriptions are recoverable from git history if
the decision is ever reversed, but reversing it means bringing back
`_locales/`, `default_locale` and the `__MSG_` reference together. Two of the
three refuse the install on their own; the third does not. Measured 2026-08-23:
a `__MSG_` reference with no `_locales` and no `default_locale` **loads**, and
ships the literal `__MSG_extDescription__` as the store summary. The
production-manifest unit suite pins all three absences, and that third one is
the reason it has to.

**The store icon is not the toolbar icon.** The store wants 96×96 of artwork
inside 16px of transparent padding; `public/icon/active-128.png` is full bleed,
because a toolbar slot has no padding to give. `assets/store-icon-128.png` is
the one to upload.

## Regenerating the images

```bash
pnpm store:assets
```

Builds the extension, loads it in real Chrome, photographs the popup in five
states, and composes 8 files into `assets/`: five 1280×800 screenshots, the
128×128 store icon, the 440×280 small promo tile and the 1400×560 marquee.

Every file's pixel dimensions are checked after it is written, and the run
aborts rather than writing a set the store would reject. One failure mode it
cannot see, so look at the output:

- **Colour and contrast.** Nothing in this repository reads a pixel's colour.

(The missing-CJK-fonts hazard went with the translated captions: every line
burnt into these images is English now.)

The popup in every screenshot is the production build. The one thing staged is
the *route* by which two example hosts became granted: `permissions.request()`
opens a dialog Playwright cannot click, so the generator patches
`host_permissions` into the loaded copy. `listing.md` says so, and the pending
row in screenshot 2 is genuine — `internal.example.com` is deliberately left out
of that patch.
