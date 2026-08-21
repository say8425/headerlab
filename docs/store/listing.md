# Chrome Web Store — Store listing tab

Everything the **Store listing** tab asks for, ready to paste. The per-locale
detailed descriptions are beside this file as `description.<locale>.md`.

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
| Summary, under the title | `manifest.description` | `__MSG_extDescription__`, resolved per locale — see below |

So the summary is changed by editing `public/_locales/<locale>/messages.json`
and shipping a new package, never by editing the listing.

### The summary, per locale

Chrome's limit is 132 characters. `tests/unit/i18n.test.ts` fails the build
before an over-long one can reach an upload.

| Locale | Characters | Summary |
| --- | --- | --- |
| `en` | 119 | Set, append or remove HTTP request and response headers, per site. No host access until you grant it. No network calls. |
| `ko` | 75 | HTTP 요청·응답 헤더를 사이트별로 설정·추가·삭제합니다. 허용하기 전에는 사이트 접근 권한이 없고, 네트워크 통신도 하지 않습니다. |
| `ja` | 75 | HTTP リクエスト・レスポンスヘッダーをサイトごとに設定・追加・削除します。許可するまでサイトへのアクセス権限はなく、ネットワーク通信も行いません。 |
| `zh_CN` | 53 | 按站点设置、追加或删除 HTTP 请求与响应头。在你授权之前不持有任何站点访问权限，也不发起任何网络请求。 |
| `es` | 121 | Establece, añade o elimina cabeceras HTTP de petición y respuesta. Sin acceso hasta que lo concedas. Sin llamadas de red. |

Re-measure rather than trusting the column: `node -e` over the message files, or
just read the test, which counts code points.

## Fields that are on this tab

| Field | Value |
| --- | --- |
| Category | **Developer Tools** |
| Language | **English (United States)** as the default; the dropdown then offers `es`, `ja`, `ko` and `zh_CN` because the package declares them |
| Detailed description | `description.<locale>.md`, one per language |
| Official URL | `https://github.com/say8425/headerlab` |
| Homepage URL | `https://github.com/say8425/headerlab` |
| Support URL | `https://github.com/say8425/headerlab/issues` |
| YouTube video | none |
| Mature content | **No** |

## Localising the listing

The language dropdown at the top of the tab offers exactly the locales the
uploaded package carries under `_locales/`. Five directories ship, so five
listings are available:

```
public/_locales/{en,ko,ja,zh_CN,es}/messages.json
```

**Localisable:** the detailed description, the screenshots, and the promotional
video.

**Not localisable:** the small promo tile and the marquee promo tile — the
store's own wording is "The small tile and Marquee promo tile cannot be
localized." Category and the URLs above are single values too.

Setting the four non-default languages is optional in the sense that the store
falls back to English. Leaving them empty wastes the package work, so upload all
five.

## Graphic assets

Everything below is generated — `pnpm store:assets` — and lands in
`docs/store/assets/`. Nothing here is cropped by hand, and the popup in every
screenshot is the production build photographed in real Chrome.

| Slot | File | Size |
| --- | --- | --- |
| Store icon | `store-icon-128.png` | 128×128 |
| Small promo tile | `promo-small-440x280.png` | 440×280 |
| Marquee promo tile | `promo-marquee-1400x560.png` | 1400×560 |
| Screenshots | `screenshot-{1..5}-*.<locale>.png` | 1280×800 |

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
| 4 | `screenshot-4-allsites` | All-sites mode on, permission not held, saved sites reading "Not in use while All sites is on" |
| 5 | `screenshot-5-dark` | The same popup following a dark OS theme |

Repeat the five for each of the five locales; the filename carries the locale
after the state.

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
