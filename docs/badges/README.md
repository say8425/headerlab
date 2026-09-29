# Store badges

The two store badges the five READMEs show under `## Install`. Both are the stores' own
artwork, downloaded unmodified and committed here.

**Do not edit either file.** Resizing is the only change Google's branding guidelines allow,
and the READMEs do that in the `<img>` tag, never in the file. A badge redrawn, recoloured or
cropped is no longer the badge the store licenses.

| File | Source | sha256 |
|---|---|---|
| `chrome-web-store.png` | <https://developer.chrome.com/static/docs/webstore/branding/image/iNEddTyWiMfLSwFD6qGq.png> | `fbf289fca885e58a1507cc8c69a9df68f35e83e683825b3ad6cd617b0a17d79c` |
| `firefox-add-ons.svg` | <https://blog.mozilla.org/addons/files/2020/04/get-the-addon-fx-apr-2020.svg> | `38e327e26e8972b23e4b8a6b93bd3614af0efd1653ed451dd9d2df30a5d8c2ee` |

Both hashes re-derive with:

```bash
curl -sL <source url> | shasum -a 256   # measured 2026-09-23, matches the file here
```

The Chrome file is the **medium, with-border** variant (340×96) of the six the
[branding page](https://developer.chrome.com/docs/webstore/branding) offers. The border is not
decoration: the plain variant is transparent, so its grey wordmark sits on `#0d1117` in GitHub's
dark theme and stops being legible — and "make sure the badge is legible" is one of that page's
rules. The bordered file is opaque white and reads on both themes. It is also larger than the
206×58 variant on purpose, so the badge stays sharp on HiDPI at its rendered 205×58.

The Firefox file is the `.svg` that Mozilla's
[Promoting your extension](https://extensionworkshop.com/documentation/publish/promoting-your-extension/)
page offers beside its two PNGs. It is vector, so it needs no second size.

**Why these are committed rather than hotlinked.** Badge URLs rot. The six
`storage.googleapis.com/web-dev-uploads/…` files that Google's own `?hl=ko` branding page still
links return HTTP 403 today, and Mozilla serves its PNGs from paths carrying a site build hash
(`get-the-addon-178x60px.dad84b42.png`), which changes when that site is rebuilt.

`tests/unit/readmeLiterals.test.ts` holds the five READMEs to these files: it resolves every
badge `src` against the README's own directory and fails if one does not exist.
