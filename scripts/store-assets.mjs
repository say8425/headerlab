/**
 * Generates every image the Chrome Web Store listing needs, from the real,
 * built extension. `pnpm store:assets` builds first.
 *
 * The same bargain `scripts/screenshots.mjs` and `scripts/make-icons.mjs` make:
 * a UI change is a re-run, not an excavation. Nothing here is cropped by hand,
 * and the popup in every screenshot is the production bundle photographed in
 * Chrome rather than a mock.
 *
 *   node scripts/store-assets.mjs
 *
 * What it writes, and why each size:
 *
 *   screenshot-N-<state>.png           1280x800, five states.
 *                                       The store accepts 1280x800 or 640x400,
 *                                       at most five.
 *   store-icon-128.png                  128x128. NOT the toolbar icon: the store
 *                                       asks for 96x96 of artwork inside 16px of
 *                                       transparent padding on every side, while
 *                                       public/icon/active-128.png is full bleed
 *                                       because a toolbar slot wants every pixel.
 *   promo-small-440x280.png             Required in practice — the store ranks an
 *                                       item without one lower in search.
 *   promo-marquee-1400x560.png          Optional, used only if the item is picked
 *                                       for the marquee.
 *
 * Nothing here is localised, because the package declares no locales — see
 * `tests/unit/manifest.test.ts`. The store would not have allowed it for the
 * tiles in any case, and that rule is worth keeping on record: "The small tile
 * and Marquee promo tile cannot be localized."
 */
import { chromium } from '@playwright/test';
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pngSize } from './lib/png.mjs';
import { assertBuildFresh, capturePopupShots, headers, ROOT, state } from './lib/popup-shots.mjs';

const BUILD = path.join(ROOT, '.output', 'chrome-mv3');
const OUT = path.join(ROOT, 'docs', 'store', 'assets');

/** `internal.example.com` is deliberately absent, so the pending shot is real. */
const PRE_GRANTED = ['https://api.example.com/*', 'https://staging.example.com/*'];

/**
 * The five states, in the order they should be uploaded — the store shows them
 * in the order they are given, and the first is the one most people ever see.
 *
 * `problems` and `allSites` are asserted on every shot rather than only on the
 * one that has something to show. Four zeroes are what make the third shot's
 * `1` mean anything, and four `off`s are what make the fourth shot's
 * `Awaiting permission` mean anything: without them a build that rendered an
 * error on every row, or flipped the mode on globally, would be photographed
 * without comment and the shot whose whole subject is that state would be
 * showing noise.
 */
const SHOTS = [
  {
    key: 'scoped',
    file: 'scoped.png',
    colorScheme: 'light',
    state: state(['api.example.com', 'staging.example.com']),
    expect: ['granted', 'granted'],
    problems: 0,
    allSites: 'off',
  },
  {
    key: 'permission',
    file: 'permission.png',
    colorScheme: 'light',
    state: state(['api.example.com', 'internal.example.com']),
    expect: ['granted', 'pending'],
    problems: 0,
    allSites: 'off',
  },
  {
    // `append` on a request header outside Chrome's 21-name allowlist. Chrome
    // rejects a ruleset whole rather than rule by rule, so this row would take
    // the other three down with it — which is exactly why it must be said.
    key: 'blocked',
    file: 'blocked.png',
    colorScheme: 'light',
    state: state(['api.example.com', 'staging.example.com'], headers('append')),
    expect: ['granted', 'granted'],
    problems: 1,
    allSites: 'off',
  },
  {
    // All-sites mode on, `<all_urls>` deliberately not in PRE_GRANTED. The row
    // goes amber and says "Awaiting permission" — the picture of the claim that
    // flipping a switch is not consent to the largest grant this extension can
    // ask for.
    //
    // The two saved sites read `idle`, not `granted`, and that was measured
    // here rather than predicted: this shot was first written expecting
    // `granted` and the state guard refused it. All-sites keeps the stored list
    // and compiles none of it, so those hosts hold their permission and scope
    // nothing — the rows say "Not in use while All sites is on". That is the
    // better picture anyway, because it is what makes the mode legibly
    // reversible instead of looking like the list was thrown away.
    key: 'allsites',
    file: 'allsites.png',
    colorScheme: 'light',
    state: state(['api.example.com', 'staging.example.com'], headers(), true),
    expect: ['idle', 'idle'],
    problems: 0,
    allSites: 'Awaiting permission',
  },
  {
    key: 'dark',
    file: 'dark.png',
    colorScheme: 'dark',
    state: state(['api.example.com', 'staging.example.com']),
    expect: ['granted', 'granted'],
    problems: 0,
    allSites: 'off',
  },
];

/**
 * One line per shot, burnt into the image.
 *
 * Terminology follows the READMEs rather than being written afresh, so a reader
 * who arrives from the repository meets the same words.
 *
 * Flat, keyed by shot. It was keyed by locale first and this map held five
 * blocks; the package stopped declaring locales on 2026-08-23, and the four
 * non-English blocks went with `LOCALES` rather than being left behind — the
 * completeness check below iterated the locale list, so a leftover block was a
 * thing nothing would ever look at again.
 */
const CAPTIONS = {
  scoped: 'Set, append or remove headers — on the sites you choose',
  permission: 'No host access until you grant it, one site at a time',
  blocked: 'Nothing fails quietly. A blocked rule says why, on its own row',
  allsites: 'Apply everywhere is a mode — and the switch never asks for the permission',
  dark: 'Follows your system theme, light or dark',
};

/** One line, English, like everything else this script burns into an image. */
const TILE_TAGLINE = 'HTTP headers, per site';

// ---------------------------------------------------------------------------
// Guards that run before anything is drawn.
// ---------------------------------------------------------------------------

/**
 * A missing caption would otherwise render as `undefined` in a 1280x800 image
 * nobody looks at closely until it is live on the store. Both directions are
 * checked: a shot with no caption, and a caption for a shot that no longer
 * exists — the second is how a set goes stale silently.
 */
function assertCaptionsComplete() {
  const wanted = SHOTS.map((shot) => shot.key).sort();
  const got = Object.keys(CAPTIONS).sort();
  if (got.join() !== wanted.join()) {
    throw new Error(
      `CAPTIONS does not match the shot list — has [${got}], the shots are [${wanted}].`,
    );
  }
  for (const [key, line] of Object.entries(CAPTIONS)) {
    if (typeof line !== 'string' || line.trim() === '') {
      throw new Error(`CAPTIONS.${key} is empty.`);
    }
  }
}

/**
 * Read back rather than trusted, because the failure it catches is silent by
 * construction — a stylesheet that made the page one pixel wider produces a
 * perfectly good-looking image the store rejects on upload, and finding that out
 * on upload means finding it out twenty-five times.
 *
 * The decode itself lives in `./lib/png.mjs`, shared with the unit test that
 * checks the *committed* images, so the two cannot disagree about what a valid
 * 1280x800 file is.
 */
function assertPngSize(file, width, height) {
  const actual = pngSize(file);
  if (actual.width !== width || actual.height !== height) {
    throw new Error(
      `${path.basename(file)} is ${actual.width}x${actual.height}, not the ${width}x${height} ` +
        'the Chrome Web Store requires.',
    );
  }
}

// ---------------------------------------------------------------------------
// The look.
// ---------------------------------------------------------------------------

/**
 * Deliberately dark. The popup is near-white in four of the five shots and
 * near-black in the fifth, and one background has to hold both — a light one
 * would let the light shots dissolve into it. It also answers the store's own
 * advice for the tiles, which asks for saturated colour and well-defined edges
 * against the light grey the store draws behind them.
 *
 * `--brand` is the same green `scripts/make-icons.mjs` fills the toolbar mark
 * with, lightened for a dark ground: #136b3e is the palette's "live" green and
 * reads as almost black at this size against #0a0f14.
 */
const BRAND = '#136b3e';
const BRAND_LIT = '#34a86a';

/**
 * System fonts only — no webfont, because this must render with no network and
 * the CJK captions need whatever the machine already has. macOS resolves the
 * per-script faces below; a Linux runner without Noto CJK installed would draw
 * tofu, which is the one failure mode of this script that a dimension check
 * cannot see. Look at the images.
 */
const FONT =
  "-apple-system, BlinkMacSystemFont, 'Apple SD Gothic Neo', 'Hiragino Sans', " +
  "'PingFang SC', 'Noto Sans CJK KR', 'Noto Sans CJK JP', 'Noto Sans CJK SC', " +
  "'Helvetica Neue', Arial, sans-serif";

/** The popup's own mark, as make-icons.mjs draws it, on a transparent ground. */
const MARK = (size, radius = 28) => `
  <svg width="${size}" height="${size}" viewBox="0 0 128 128" style="display:block">
    <rect width="128" height="128" rx="${radius}" fill="${BRAND_LIT}"/>
    <path d="M34 38h60M34 64h38M34 90h60" stroke="#ffffff" stroke-width="12"
          stroke-linecap="round" fill="none"/>
  </svg>`;

const PAGE_BASE = `
  *{margin:0;padding:0;box-sizing:border-box}
  html,body{width:100%;height:100%;overflow:hidden}
  body{
    font-family:${FONT};
    background:#0a0f14;
    color:#fff;
    -webkit-font-smoothing:antialiased;
  }
  .glow{
    position:absolute;inset:0;
    background:
      radial-gradient(120% 90% at 8% -10%, ${BRAND}66 0%, transparent 60%),
      radial-gradient(90% 70% at 100% 110%, #0f3a2688 0%, transparent 65%);
  }`;

/**
 * One screenshot: a fixed 176px caption band over a fixed 624px stage.
 *
 * Both heights are fixed rather than flexed so the popup lands at exactly the
 * same size and position in all twenty-five images. A flexed band would let a
 * caption that wraps to two lines shrink its own screenshot, and the set would
 * jitter as the store paged through it — the same reasoning as the popup's own
 * rule that a control appearing must not resize what holds it.
 */
function screenshotHtml(popupDataUri, caption) {
  return `<style>
    ${PAGE_BASE}
    .band{position:relative;height:176px;padding:34px 80px 0;display:flex;flex-direction:column}
    .lockup{display:flex;align-items:center;gap:10px;margin-bottom:14px}
    .wordmark{font-size:17px;font-weight:600;letter-spacing:.01em;color:#cfe6da}
    .caption{
      font-size:30px;line-height:1.3;font-weight:600;letter-spacing:-.01em;
      max-width:1060px;
      display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden;
    }
    .stage{position:relative;height:624px;display:flex;align-items:center;justify-content:center}
    .shot{
      height:560px;width:auto;display:block;border-radius:14px;
      box-shadow:0 26px 60px -12px rgba(0,0,0,.75), 0 0 0 1px rgba(255,255,255,.08);
    }
  </style>
  <div class="glow"></div>
  <div class="band">
    <div class="lockup">${MARK(26, 30)}<span class="wordmark">HeaderLab</span></div>
    <div class="caption">${caption}</div>
  </div>
  <div class="stage"><img class="shot" src="${popupDataUri}"></div>`;
}

/**
 * The 440x280 tile, and the 1400x560 marquee from the same lockup at a
 * different scale.
 *
 * The store's advice for both is the same and unusually specific: fill the
 * region, keep the edges well defined, prefer saturated colour, and stay legible
 * at half size. So the wordmark is the largest thing here and the tagline is one
 * short line — 220x140 is what a person actually sees in a search result.
 */
function tileHtml({ mark, wordmark, tagline, gap, pad, shot, shotWidth = 0, shotHeight = 0 }) {
  return `<style>
    ${PAGE_BASE}
    body{display:flex;align-items:center;overflow:hidden}
    .glow{background:
      radial-gradient(100% 120% at 0% 0%, ${BRAND}88 0%, transparent 62%),
      radial-gradient(90% 90% at 100% 100%, #0f3a26aa 0%, transparent 60%);}
    .copy{position:relative;z-index:1;padding:0 ${pad}px;flex:1 1 auto;min-width:0}
    .lockup{display:flex;align-items:center;gap:${gap}px;margin-bottom:${Math.round(gap * 0.9)}px}
    .wordmark{font-size:${wordmark}px;font-weight:700;letter-spacing:-.02em;line-height:1;
              white-space:nowrap}
    .tagline{font-size:${tagline}px;font-weight:500;color:#a9c6b6;letter-spacing:.005em}
    /* A column of its own rather than an absolutely positioned image: the first
       attempt floated the screenshot over the whole tile and it landed on top
       of the wordmark, clipping the final letter. Giving it a track means the
       text can never be what the picture overlaps. */
    .stage{position:relative;flex:0 0 ${shotWidth}px;align-self:stretch;overflow:hidden}
    .bleed{
      position:absolute;left:80px;top:50%;transform:translateY(-50%) rotate(-4deg);
      height:${shotHeight}px;width:auto;border-radius:18px;
      box-shadow:0 40px 90px -20px rgba(0,0,0,.85), 0 0 0 1px rgba(255,255,255,.08);
    }
  </style>
  <div class="glow"></div>
  <div class="copy">
    <div class="lockup">${MARK(mark, 30)}<span class="wordmark">HeaderLab</span></div>
    <div class="tagline">${TILE_TAGLINE}</div>
  </div>
  ${shot ? `<div class="stage"><img class="bleed" src="${shot}"></div>` : ''}`;
}

/**
 * The store icon, which is not the toolbar icon.
 *
 * 96x96 of artwork inside 16px of transparent padding on every side, per the
 * store's image guidelines — where public/icon/active-128.png fills all 128
 * because a toolbar slot has no padding to give. Same glyph, wrapped in the
 * transform rather than redrawn at new coordinates, so the two marks cannot
 * drift apart by arithmetic.
 */
const STORE_ICON_HTML = `<style>
  *{margin:0;padding:0}
  html,body{width:128px;height:128px;background:transparent}
</style>
<svg width="128" height="128" viewBox="0 0 128 128" style="display:block">
  <g transform="translate(16,16) scale(0.75)">
    <rect width="128" height="128" rx="28" fill="${BRAND}"/>
    <path d="M34 38h60M34 64h38M34 90h60" stroke="#ffffff" stroke-width="12"
          stroke-linecap="round" fill="none"/>
  </g>
</svg>`;

// ---------------------------------------------------------------------------
// Run.
// ---------------------------------------------------------------------------

assertBuildFresh({
  build: BUILD,
  // `docs/store/` and not just `docs/store/assets/`: the listing copy beside
  // these images is prose, and rewording it does not change what the popup
  // looks like. Without this a re-run after an edit to the description would
  // report a stale build and refuse to draw anything.
  ignore: ['tests/', 'docs/store/'],
  fix: 'run `pnpm store:assets`, which builds first',
});
assertCaptionsComplete();

const staging = mkdtempSync(path.join(tmpdir(), 'headerlab-store-'));
const popups = mkdtempSync(path.join(tmpdir(), 'headerlab-popup-'));

try {
  await capturePopupShots({ build: BUILD, shots: SHOTS, outDir: popups, preGranted: PRE_GRANTED });

  const dataUri = (file) =>
    `data:image/png;base64,${readFileSync(path.join(popups, file)).toString('base64')}`;
  const shots = Object.fromEntries(SHOTS.map((shot) => [shot.key, dataUri(shot.file)]));

  const browser = await chromium.launch();
  const written = [];

  // `newPage` belongs inside the try, not beside `launch`. Between a launched
  // browser and the `finally` that closes it, a throw leaks a Chromium process
  // — the same class of mistake as the profile directory that leaked 71MB over
  // five runs, recorded in ./lib/popup-shots.mjs. `written` stays outside
  // because the copy-out below reads it.
  try {
    const page = await browser.newPage();

    /** Renders one page at exactly `width`x`height` device pixels and checks it. */
    async function draw(file, html, width, height, omitBackground = false) {
      await page.setViewportSize({ width, height });
      await page.setContent(html);

      // The caption band clamps to two lines and hides what does not fit, so a
      // caption too long for it is cut with no mark on the image. Measured
      // today: all 25 render on **one** line, so there is a whole line of
      // headroom — which is precisely the condition under which a future
      // translation grows past it and nobody notices. The band's height is
      // fixed on purpose (see `screenshotHtml`) and must stay that way, so the
      // check is that the text fits rather than that the box grew.
      const clipped = await page.evaluate(() => {
        const caption = document.querySelector('.caption');
        return caption && caption.scrollHeight > caption.clientHeight ? caption.textContent : null;
      });
      if (clipped !== null) {
        throw new Error(
          `${file}: the caption does not fit the band and is being cut — ${JSON.stringify(clipped)}. ` +
            'Shorten it, or give the band a line and take it back off the stage.',
        );
      }

      const full = path.join(staging, file);
      writeFileSync(full, await page.screenshot({ omitBackground }));
      assertPngSize(full, width, height);
      written.push(file);
    }

    for (const [index, shot] of SHOTS.entries()) {
      await draw(
        `screenshot-${index + 1}-${shot.key}.png`,
        screenshotHtml(shots[shot.key], CAPTIONS[shot.key]),
        1280,
        800,
      );
    }

    await draw('store-icon-128.png', STORE_ICON_HTML, 128, 128, true);
    await draw(
      'promo-small-440x280.png',
      tileHtml({ mark: 60, wordmark: 40, tagline: 15, gap: 14, pad: 38 }),
      440,
      280,
    );
    await draw(
      'promo-marquee-1400x560.png',
      tileHtml({
        mark: 104,
        wordmark: 70,
        tagline: 26,
        gap: 24,
        pad: 96,
        shot: shots.scoped,
        // 620 of the 1400 for the picture, 780 for the copy — the lockup needs
        // about 610 of that at this size. The screenshot is 470 tall against a
        // 560 tile, which after the 4-degree tilt occupies roughly 520 and so
        // keeps a margin top and bottom, while its 586 of width from 80 means
        // it runs off the right edge on purpose.
        shotWidth: 620,
        shotHeight: 470,
      }),
      1400,
      560,
    );
  } finally {
    await browser.close();
  }

  // Every image survived its own size check, so the set is coherent.
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  for (const file of written) cpSync(path.join(staging, file), path.join(OUT, file));

  const total = written.reduce((sum, f) => sum + statSync(path.join(OUT, f)).size, 0);
  console.log(written.map((f) => path.relative(ROOT, path.join(OUT, f))).join('\n'));
  console.log(`\n${written.length} images, ${(total / 1024 / 1024).toFixed(2)} MB`);
} finally {
  for (const dir of [staging, popups]) rmSync(dir, { recursive: true, force: true });
}
