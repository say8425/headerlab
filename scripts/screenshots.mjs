/**
 * Captures the README screenshots from the real, built extension.
 * `pnpm screenshots` builds first. See CLAUDE.md, Conventions.
 *
 * The loaded directory is the production build with one edit —
 * `host_permissions` for the example hosts — because `permissions.request()`
 * opens a dialog Playwright cannot click, and a *granted* row cannot otherwise
 * be photographed. The README says so under the images.
 */
import { chromium } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BUILD = path.join(ROOT, '.output', 'chrome-mv3');
const OUT = path.join(ROOT, 'docs', 'screenshots');

/** The popup's own dimensions, from entrypoints/popup/style.css. */
const VIEWPORT = { width: 748, height: 600 };

/** `internal.example.com` is deliberately absent, so the pending shot is real. */
const PRE_GRANTED = ['https://api.example.com/*', 'https://staging.example.com/*'];

function rule(over) {
  return {
    id: crypto.randomUUID(),
    enabled: true,
    target: 'request',
    operation: 'set',
    name: '',
    value: '',
    ...over,
  };
}

/** Built fresh per call: `rule()` mints an id, so a shared array would repeat ids. */
const headers = (debugUserOperation = 'set') => [
  rule({ name: 'Authorization', value: 'Bearer dev-eyJhbGciOiJIUzI1NiJ9' }),
  rule({ operation: debugUserOperation, name: 'X-Debug-User', value: 'qa@example.com' }),
  rule({ target: 'response', operation: 'remove', name: 'Content-Security-Policy' }),
  // Switched off, so the readout has an "off" count to show.
  rule({
    enabled: false,
    target: 'response',
    operation: 'set',
    name: 'Cache-Control',
    value: 'no-store',
  }),
];

function profile(domains, rows) {
  return {
    id: 'screenshot-profile',
    name: 'Default',
    color: 'green',
    enabled: true,
    order: 0,
    filter: {
      mode: 'structured',
      allSites: false,
      domains,
      excludedDomains: [],
      resourceTypes: ['xmlhttprequest', 'main_frame', 'sub_frame'],
    },
    tabLock: { enabled: false, tabId: null, tabTitle: null },
    headers: rows,
  };
}

/** WXT stores the item's version beside the value; seed both (CLAUDE.md, WXT specifics). */
const state = (domains, rows = headers()) => ({
  version: 2,
  globalPause: false,
  theme: 'system',
  profiles: [profile(domains, rows)],
});

/**
 * `problems` is asserted on every shot, not only the one that has one. Three
 * zeroes are what make the fourth shot's `1` mean anything: without them a
 * screenshot set that rendered an error on every row would pass, and the shot
 * whose whole subject is one row failing would be photographing noise.
 */
const SHOTS = [
  {
    file: 'popup-light.png',
    colorScheme: 'light',
    state: state(['api.example.com', 'staging.example.com']),
    expect: ['granted', 'granted'],
    problems: 0,
  },
  {
    file: 'popup-dark.png',
    colorScheme: 'dark',
    state: state(['api.example.com', 'staging.example.com']),
    expect: ['granted', 'granted'],
    problems: 0,
  },
  {
    file: 'popup-permission.png',
    colorScheme: 'light',
    state: state(['api.example.com', 'internal.example.com']),
    expect: ['granted', 'pending'],
    problems: 0,
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
  },
];

/**
 * `tests/support/build.ts` in miniature — it is TypeScript and not importable
 * here. Excludes `docs/screenshots/` or a second run calls the build stale on
 * account of its own output.
 */
function assertBuildFresh() {
  if (!existsSync(BUILD)) {
    throw new Error(
      `no build at ${path.relative(ROOT, BUILD)} — run \`pnpm screenshots\`, which builds first.`,
    );
  }
  const newestSource = execFileSync(
    'git',
    ['ls-files', '-z', '--cached', '--others', '--exclude-standard'],
    {
      cwd: ROOT,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    },
  )
    .split('\0')
    .filter((f) => f !== '' && !f.startsWith('tests/') && !f.startsWith('docs/screenshots/'))
    .reduce(
      (newest, f) => {
        const s = statSync(path.join(ROOT, f), { throwIfNoEntry: false });
        return s?.isFile() && s.mtimeMs > newest.mtimeMs ? { file: f, mtimeMs: s.mtimeMs } : newest;
      },
      { file: '', mtimeMs: 0 },
    );

  let oldestOutput = Infinity;
  for (const entry of readdirSync(BUILD, { withFileTypes: true, recursive: true })) {
    if (!entry.isFile()) continue;
    oldestOutput = Math.min(
      oldestOutput,
      statSync(path.join(entry.parentPath, entry.name)).mtimeMs,
    );
  }

  if (newestSource.mtimeMs > oldestOutput) {
    throw new Error(
      `${path.relative(ROOT, BUILD)} is stale: ${newestSource.file} was modified after it was built. ` +
        'These screenshots would show the previous UI — run `pnpm screenshots`, which builds first.',
    );
  }
}

assertBuildFresh();

// Named, not inlined: a directory whose path is only ever an argument cannot be
// deleted afterwards. The Chrome profile was that, and leaked 71MB over 5 runs.
const extension = mkdtempSync(path.join(tmpdir(), 'headerlab-shot-'));
const profileDir = mkdtempSync(path.join(tmpdir(), 'headerlab-profile-'));
// Staged, then copied only once every shot succeeds: writing straight to the
// destination left a half-updated set behind on a mid-run failure.
const staging = mkdtempSync(path.join(tmpdir(), 'headerlab-png-'));

try {
  cpSync(BUILD, extension, { recursive: true });
  const manifestPath = path.join(extension, 'manifest.json');
  writeFileSync(
    manifestPath,
    JSON.stringify(
      { ...JSON.parse(readFileSync(manifestPath, 'utf8')), host_permissions: PRE_GRANTED },
      null,
      2,
    ),
  );

  const context = await chromium.launchPersistentContext(profileDir, {
    channel: 'chromium',
    viewport: VIEWPORT,
    // Retina, so the PNG survives being scaled down in a README column.
    deviceScaleFactor: 2,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });

  try {
    let [worker] = context.serviceWorkers();
    if (!worker) worker = await context.waitForEvent('serviceworker');
    const extensionId = worker.url().split('/')[2];
    const page = await context.newPage();

    for (const shot of SHOTS) {
      await worker.evaluate(async (seed) => {
        await chrome.storage.local.set({ state: seed, state$: { v: 2 } });
      }, shot.state);

      // Before navigating: public/theme.js reads the media query at parse time.
      await page.emulateMedia({ colorScheme: shot.colorScheme });
      await page.goto(`chrome-extension://${extensionId}/popup.html`);

      // Hold, shoot, check again. Waiting for the states alone passed on the
      // optimistic first frame — `grantDiagnostics` starts `[]`, so every row
      // reads `granted` before the probe answers — while the screenshot was
      // taken later, against a different frame. Holding across frames rules
      // that frame out; the re-check afterwards is what speaks about the frame
      // actually captured.
      const read = () => ({
        sites: [...document.querySelectorAll('[data-testid="site"]')].map((row) =>
          row.getAttribute('data-state'),
        ),
        problems: document.querySelectorAll('[data-testid="rule-problem"]').length,
      });

      const want = { sites: shot.expect, problems: shot.problems };
      const same = (a, b) =>
        a.problems === b.problems &&
        a.sites.length === b.sites.length &&
        a.sites.every((state, i) => state === b.sites[i]);

      await page.waitForFunction(
        ({ want, frames }) => {
          const now = {
            sites: [...document.querySelectorAll('[data-testid="site"]')].map((row) =>
              row.getAttribute('data-state'),
            ),
            problems: document.querySelectorAll('[data-testid="rule-problem"]').length,
          };
          const ok =
            now.problems === want.problems &&
            now.sites.length === want.sites.length &&
            now.sites.every((state, i) => state === want.sites[i]);
          globalThis.__hlHeld = ok ? (globalThis.__hlHeld ?? 0) + 1 : 0;
          return globalThis.__hlHeld >= frames;
        },
        { want, frames: 20 },
        { timeout: 10_000 },
      );

      await page.screenshot({
        path: path.join(staging, shot.file),
        clip: { x: 0, y: 0, ...VIEWPORT },
      });

      const actual = await page.evaluate(read);
      if (!same(actual, want)) {
        throw new Error(
          `${shot.file}: the popup changed between the wait and the shot — ` +
            `expected ${JSON.stringify(want)}, captured ${JSON.stringify(actual)}.`,
        );
      }
    }
  } finally {
    await context.close();
  }

  // Every shot survived, so the set is coherent.
  mkdirSync(OUT, { recursive: true });
  for (const shot of SHOTS) {
    cpSync(path.join(staging, shot.file), path.join(OUT, shot.file));
  }
  console.log(SHOTS.map((s) => path.relative(ROOT, path.join(OUT, s.file))).join('\n'));
} finally {
  for (const dir of [extension, profileDir, staging]) {
    rmSync(dir, { recursive: true, force: true });
  }
}
