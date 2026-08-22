/**
 * Captures the README screenshots from the real, built extension.
 * `pnpm screenshots` builds first. See CLAUDE.md, Conventions.
 *
 * The loaded directory is the production build with one edit —
 * `host_permissions` for the example hosts — because `permissions.request()`
 * opens a dialog Playwright cannot click, and a *granted* row cannot otherwise
 * be photographed. The README says so under the images.
 *
 * The freshness guard, the stored-state fixtures and the capture loop live in
 * `./lib/popup-shots.mjs`, shared with `scripts/store-assets.mjs`.
 */
import { cpSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { assertBuildFresh, capturePopupShots, headers, ROOT, state } from './lib/popup-shots.mjs';

const BUILD = path.join(ROOT, '.output', 'chrome-mv3');
const OUT = path.join(ROOT, 'docs', 'screenshots');

/** `internal.example.com` is deliberately absent, so the pending shot is real. */
const PRE_GRANTED = ['https://api.example.com/*', 'https://staging.example.com/*'];

/**
 * `problems` is asserted on every shot, not only the one that has one. Three
 * zeroes are what make the fourth shot's `1` mean anything: without them a
 * screenshot set that rendered an error on every row would pass, and the shot
 * whose whole subject is one row failing would be photographing noise.
 *
 * `allSites` is asserted for the same reason and reads `off` on all four: these
 * images are of the site-scoped mode, and a build that flipped the mode on
 * would otherwise be photographed without comment.
 */
const SHOTS = [
  {
    file: 'popup-light.png',
    colorScheme: 'light',
    state: state(['api.example.com', 'staging.example.com']),
    expect: ['granted', 'granted'],
    problems: 0,
    allSites: 'off',
  },
  {
    file: 'popup-dark.png',
    colorScheme: 'dark',
    state: state(['api.example.com', 'staging.example.com']),
    expect: ['granted', 'granted'],
    problems: 0,
    allSites: 'off',
  },
  {
    file: 'popup-permission.png',
    colorScheme: 'light',
    state: state(['api.example.com', 'internal.example.com']),
    expect: ['granted', 'pending'],
    problems: 0,
    allSites: 'off',
  },
  {
    // `append` on a request header outside Chrome's 21-name allowlist. The
    // README claims nothing fails quietly; this is the picture of it, and it is
    // the case that costs the most when it *is* quiet — Chrome rejects a
    // ruleset whole, so this row takes the other three down with it.
    file: 'popup-blocked.png',
    colorScheme: 'light',
    state: state(['api.example.com', 'staging.example.com'], headers('append')),
    expect: ['granted', 'granted'],
    problems: 1,
    allSites: 'off',
  },
];

assertBuildFresh({
  build: BUILD,
  ignore: ['tests/', 'docs/screenshots/'],
  fix: 'run `pnpm screenshots`, which builds first',
});

// Staged, then copied only once every shot succeeds: writing straight to the
// destination left a half-updated set behind on a mid-run failure.
const staging = mkdtempSync(path.join(tmpdir(), 'headerlab-png-'));

try {
  await capturePopupShots({ build: BUILD, shots: SHOTS, outDir: staging, preGranted: PRE_GRANTED });

  // Every shot survived, so the set is coherent.
  mkdirSync(OUT, { recursive: true });
  for (const shot of SHOTS) {
    cpSync(path.join(staging, shot.file), path.join(OUT, shot.file));
  }
  console.log(SHOTS.map((s) => path.relative(ROOT, path.join(OUT, s.file))).join('\n'));
} finally {
  rmSync(staging, { recursive: true, force: true });
}
