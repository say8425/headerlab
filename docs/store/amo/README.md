# Firefox Add-ons (AMO) listing

Everything the Firefox Add-ons listing is made of, beside the Chrome Web
Store's in `../`. Not yet published: the first submission is a person's
(`checklist.md` §3), and until it lands nothing in the five READMEs points
here. The two listings share `../assets/` and almost all of their copy; what
differs is named below so nobody has to diff two runbooks.

**Start with [`checklist.md`](checklist.md).** It runs top to bottom, once;
its last section is the one that stays useful afterwards.

| File | What it is |
| --- | --- |
| [`checklist.md`](checklist.md) | The runbook: account, archives, the first submission by hand, the form, privacy, reviewer notes, after publication, releasing from here on |
| [`listing.md`](listing.md) | Every field on the form with its value, the images, the screenshot order and captions |
| [`description.en.md`](description.en.md) | The detailed description — the Chrome copy with its Chrome-specific words made neutral, and the agent bridge marked Chrome-only |
| [`reviewer-notes.md`](reviewer-notes.md) | Notes to Reviewer: how to rebuild the package from the sources archive |
| [`../../../PRIVACY.md`](../../../PRIVACY.md) | The privacy policy. AMO takes it as pasted text, not as a URL |
| `../assets/` | The five 1280×800 screenshots, generated for Chrome and reused |

## Three things that differ from the Chrome Web Store

**The privacy policy is pasted, not linked.** Chrome's form takes a URL and
this repository gives it `PRIVACY.md` on `main`; AMO's form takes the text.
Same file, and it is written for both.

**The sources archive is required, and it is reviewed by rebuilding.** The
package is bundled, so Mozilla's policy asks for the source and a reviewer
"uses a diff tool to compare the generated sources to those in the extension.
There must be no differences." `pnpm zip` writes `headerlab-<v>-sources.zip`
beside the package, the release attaches it, and `amo-submit.yml` uploads it
with every version. The README inside it, under "Build it yourself", is the
reviewer's instruction sheet.

**Only the first submission is by hand.** `wxt submit` — which is what
`amo-submit.yml` runs — starts by fetching the add-on and cannot create one. So
the first version goes through the Developer Hub with both archives, and every
version after it goes through the release workflow, on the channel the
`firefox-amo` environment names.

## What is reused, and its cost

The five screenshots are photographs of the Chrome popup and each shows the
agent bridge row, which the Firefox popup does not render. Reused on the
owner's instruction (2026-09-10); `listing.md` says what the captions leave
out and where the Firefox-side screenshot helper already is.
