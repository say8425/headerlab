import { readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { pngSize } from '../../scripts/lib/png.mjs';
import { REPO_ROOT } from '../support/build';

/**
 * Guards the committed Chrome Web Store images.
 *
 * `docs/store/listing.md` and `docs/store/checklist.md` both tell a person to
 * upload these files **by name**, in the numeric order the names carry. Nothing
 * else in `pnpm check` looks at that directory, so a file deleted, renamed or
 * regenerated at the wrong size stayed invisible until somebody was twenty
 * uploads into a submission — which is precisely the failure `store-assets.mjs`
 * guards against at write time and nothing guarded afterwards.
 *
 * Reads the committed images, not a fresh run: regenerating takes a browser, and
 * the question here is whether what is in the repository is uploadable.
 *
 * The decode is `scripts/lib/png.mjs`, the same module the generator checks its
 * own output with, so the two cannot disagree about what a valid 1280x800 file
 * is.
 */

const ASSETS = path.join(REPO_ROOT, 'docs', 'store', 'assets');

/**
 * The five states, in the order they are uploaded.
 *
 * Restated here rather than imported: `scripts/store-assets.mjs` performs its
 * whole generation at module scope, so requiring it would launch a browser and
 * rewrite the directory this test is meant to be inspecting.
 *
 * That restatement cannot drift silently, which is the reason it is acceptable.
 * A key added to the script produces five files this list does not name, and a
 * key removed leaves five it names missing — the exact-set assertion below fails
 * either way.
 */
const SHOT_KEYS = ['scoped', 'permission', 'blocked', 'allsites', 'dark'] as const;

/** 1280x800 or 640x400 are the store's two options; these are the former. */
const SCREENSHOT = { width: 1280, height: 800 };

/**
 * The three that carry no locale. The two promo tiles cannot be localized —
 * that is the store's rule, not a shortcut — and the icon is one image.
 */
const UNLOCALIZED: ReadonlyArray<readonly [string, number, number]> = [
  ['store-icon-128.png', 128, 128],
  ['promo-small-440x280.png', 440, 280],
  ['promo-marquee-1400x560.png', 1400, 560],
];

const screenshotNames = (): string[] =>
  SHOT_KEYS.map((key, index) => `screenshot-${index + 1}-${key}.png`);

describe('the committed store assets', () => {
  it('are exactly the files the listing instructions name', () => {
    // Exact, in both directions. A missing file is an upload that cannot happen;
    // a stray one is a file somebody will upload without knowing what it is.
    const expected = [...screenshotNames(), ...UNLOCALIZED.map(([file]) => file)].sort();
    expect(readdirSync(ASSETS).sort()).toEqual(expected);
  });

  it('are all 1280x800, which is the size the store accepts', () => {
    for (const file of screenshotNames()) {
      expect(pngSize(path.join(ASSETS, file)), `${file} is not 1280x800`).toEqual(SCREENSHOT);
    }
  });

  it('give the icon and the two promo tiles their own required sizes', () => {
    // Each is a different slot with a different fixed size, and uploading one
    // into another's slot is rejected — so the sizes are what tell them apart
    // once the filenames stop being trusted.
    for (const [file, width, height] of UNLOCALIZED) {
      expect(pngSize(path.join(ASSETS, file)), `${file} is the wrong size for its slot`).toEqual({
        width,
        height,
      });
    }
  });
});
