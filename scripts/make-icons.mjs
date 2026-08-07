/**
 * Renders the toolbar icons from one SVG source.
 *
 * Chrome's `icons` and `action.default_icon` take PNG, not SVG, and no image
 * tooling is installed. Rather than add one — the registry is under a 72-hour
 * publish quarantine — this borrows the rasteriser the repo already ships: the
 * Playwright Chromium the e2e suite runs against. Same engine that will draw
 * the icon in the toolbar, so what is measured here is what ships.
 *
 * Run with `node scripts/make-icons.mjs`. Outputs are committed alongside this
 * file so a size or palette change is a re-run, not an excavation.
 *
 *   node scripts/make-icons.mjs            # write public/icon/*.png
 *   node scripts/make-icons.mjs --preview  # also write the legibility sheet
 */
import { chromium } from '@playwright/test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'public', 'icon');

/**
 * The popup's own mark, scaled up.
 *
 * The glyph is the same three-line path the rail header draws (`M1.5 2h8
 * M1.5 5.5h5 M1.5 9h8` in an 11-unit box), kept at the same proportion inside
 * its rounded square — roughly 65% — so the toolbar and the popup header are
 * recognisably one product rather than two.
 *
 * What could not carry over is the colour. In the popup the square is
 * `--hl-ink`, which *flips* between themes — near-black on light, near-white on
 * dark — and a PNG cannot. A toolbar icon has to supply its own contrast
 * against a browser theme it does not control, so both states use a mid-tone
 * fill with white lines: legible on Chrome's light toolbar and its dark one.
 */
/**
 * Per state, because the two are asked for by different things. `icons` — the
 * extensions page and the store — only ever shows the active mark, while
 * `setIcon` swaps 16 and 32 in the toolbar. Generating a paused 48 and 128 to
 * match would ship ~2.8KB that nothing loads, and a test pinning their
 * existence would hold that dead weight in place. Add a size back here if
 * something starts asking for it.
 */
const SIZES = { active: [16, 32, 48, 128], paused: [16, 32] };

const FILL = {
  // The palette's "live" green, the same hue the Active bar and live dots use.
  active: '#136b3e',
  // Not the active fill with its saturation removed — that lands on a dark
  // grey that vanishes into a dark toolbar. A mid grey keeps the mark visible
  // on both themes, which is what "paused" has to stay: readable, not hidden.
  paused: '#6b7280',
};

function svg(fill) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128">
  <rect width="128" height="128" rx="28" fill="${fill}"/>
  <path d="M34 38h60M34 64h38M34 90h60" stroke="#ffffff" stroke-width="12"
        stroke-linecap="round" fill="none"/>
</svg>`;
}

const page = await (await chromium.launch()).newPage();
mkdirSync(OUT, { recursive: true });

async function render(fill, size) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(
    `<style>html,body{margin:0;padding:0;background:transparent}
     svg{display:block;width:${size}px;height:${size}px}</style>${svg(fill)}`,
  );
  return page.screenshot({ omitBackground: true });
}

const written = [];
for (const [state, fill] of Object.entries(FILL)) {
  for (const size of SIZES[state]) {
    const file = path.join(OUT, `${state}-${size}.png`);
    writeFileSync(file, await render(fill, size));
    written.push(path.relative(ROOT, file));
  }
}

if (process.argv.includes('--preview')) {
  // The check that matters is not "does the file look right in a viewer" but
  // "is it legible at 16px against a toolbar" — and Chrome has two toolbars.
  const shot = (s, n) =>
    `<img src="data:image/png;base64,${readFileSync(path.join(OUT, `${s}-${n}.png`)).toString(
      'base64',
    )}" width="${n}" height="${n}">`;
  const row = (bg, label) => `
    <div style="background:${bg};padding:14px 18px;display:flex;gap:22px;align-items:center">
      <span style="font:600 11px system-ui;color:${bg === '#292a2d' ? '#e8eaed' : '#3c4043'};
                   width:96px">${label}</span>
      ${['active', 'paused'].flatMap((s) => [16, 32].map((n) => shot(s, n))).join('')}
    </div>`;
  await page.setViewportSize({ width: 420, height: 150 });
  await page.setContent(
    `<style>body{margin:0;font-family:system-ui}</style>
     ${row('#f1f3f4', 'Chrome light')}${row('#292a2d', 'Chrome dark')}
     <div style="padding:8px 18px;font:400 10px system-ui;color:#5f6368">
       active 16 · active 32 · paused 16 · paused 32
     </div>`,
  );
  const preview = path.join(ROOT, '.icon-preview.png');
  writeFileSync(preview, await page.screenshot());
  written.push(path.relative(ROOT, preview));
}

console.log(written.join('\n'));
await page.context().browser().close();
