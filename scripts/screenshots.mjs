/**
 * Captures the README screenshots from the real, built extension.
 *
 * Run it as `npm run screenshots`, which builds first — the same bargain
 * `npm test` makes, and for the same reason: a script that photographs
 * `.output/chrome-mv3` without building it will happily publish a picture of
 * last week's UI, and nothing about the resulting PNG says so.
 *
 * **The bundle is the shipped bundle.** The directory loaded here is a copy of
 * the production build with exactly one edit: `host_permissions` is added for
 * the example hosts. Chrome grants a manifest host permission to an unpacked
 * extension at load with no prompt, which is the only way to photograph a
 * *granted* site row — `permissions.request()` opens a native dialog, and
 * Playwright cannot click Chrome's own chrome. Every other byte, including all
 * of the popup and the whole compile path, is what ships. The README says this
 * under the images rather than leaving the reader to assume it.
 *
 * **The waits are assertions — and the first version of them was not.** Each
 * shot declares the row states it expects. The popup renders once before the
 * permission probe answers, and in that first frame `grantDiagnostics` is still
 * `[]`, so *every* row reads `granted`. A wait that merely looked for the
 * expected states was therefore satisfiable by a frame that meant nothing, and
 * `page.screenshot()` ran afterwards against whatever the probe had since
 * produced: the wait and the photograph were looking at different frames.
 * Measured — swapping the pending shot's expectation to `granted` passed, which
 * is exactly the assertion-that-cannot-fail this repo keeps catching.
 *
 * So the states must now hold across 20 consecutive animation frames, which the
 * optimistic frame cannot do because the probe replaces it, and they are checked
 * **again after the screenshot**. That second check is the one that matters: it
 * is the only assertion in the file that speaks about the frame actually
 * captured rather than about some frame. Both mutations fail now.
 *
 * The outputs land in `docs/screenshots/`, which `tests/support/build.ts` counts
 * as source — so a capture run leaves the build stale until the next build. That
 * is the source set being deliberately over-broad rather than hand-listed
 * (see its comment); `npm test` builds first, so it never surfaces. This file's
 * own freshness check excludes `docs/screenshots/` for the same reason, or a
 * second run in a row would call the build stale on account of its own output.
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

/**
 * The hosts the loaded copy is given at install. Both appear in the shots as
 * granted rows; `internal.example.com` is deliberately absent so the pending
 * state has something real to be pending on.
 */
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

function profile(domains) {
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
    headers: [
      rule({ name: 'Authorization', value: 'Bearer dev-eyJhbGciOiJIUzI1NiJ9' }),
      rule({ name: 'X-Debug-User', value: 'qa@example.com' }),
      rule({ target: 'response', operation: 'remove', name: 'Content-Security-Policy' }),
      // Switched off, so the readout has an "off" count to show. A shot where
      // every rule is live cannot demonstrate that the count means anything.
      rule({
        enabled: false,
        target: 'response',
        operation: 'set',
        name: 'Cache-Control',
        value: 'no-store',
      }),
    ],
  };
}

/** WXT stores the item's version beside the value; seed both (CLAUDE.md, WXT specifics). */
const state = (domains) => ({
  version: 2,
  globalPause: false,
  theme: 'system',
  profiles: [profile(domains)],
});

const SHOTS = [
  {
    file: 'popup-light.png',
    colorScheme: 'light',
    state: state(['api.example.com', 'staging.example.com']),
    expect: ['granted', 'granted'],
  },
  {
    file: 'popup-dark.png',
    colorScheme: 'dark',
    state: state(['api.example.com', 'staging.example.com']),
    expect: ['granted', 'granted'],
  },
  {
    file: 'popup-permission.png',
    colorScheme: 'light',
    state: state(['api.example.com', 'internal.example.com']),
    expect: ['granted', 'pending'],
  },
];

/**
 * The same staleness rule the test suites get, applied here.
 *
 * `npm run screenshots` builds first, but a bare `node scripts/screenshots.mjs`
 * does not — and that is the command anyone editing this file will type. The
 * repo has already paid for exactly this shape twice: an assertion that read a
 * build nobody had rebuilt. `tests/support/build.ts` is the real implementation
 * and it is not importable from here (it is TypeScript, and deliberately outside
 * the source set), so this is the same idea in miniature: detect and fail, never
 * build inside the tool.
 */
function assertBuildFresh() {
  if (!existsSync(BUILD)) {
    throw new Error(
      `no build at ${path.relative(ROOT, BUILD)} — run \`npm run screenshots\`, which builds first.`,
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
        'These screenshots would show the previous UI — run `npm run screenshots`, which builds first.',
    );
  }
}

assertBuildFresh();

// Both temp directories are named here rather than inlined, because a directory
// whose path is only ever an argument cannot be deleted afterwards. The Chrome
// profile was exactly that, and five runs left 71MB behind.
const extension = mkdtempSync(path.join(tmpdir(), 'headerlab-shot-'));
const profileDir = mkdtempSync(path.join(tmpdir(), 'headerlab-profile-'));
// Captured here, copied into docs/screenshots/ only once every shot has
// succeeded. Writing straight to the destination meant a failure on the third
// shot left the first two already overwritten — a set that is two-thirds new UI
// and one-third old, with nothing on disk saying so and `git status` showing
// two innocent-looking modified PNGs. That is the failure this script's whole
// design is against, reintroduced by where it put its output.
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

      // Set before navigating: public/theme.js reads the media query at parse
      // time, ahead of first paint, so emulating afterwards would photograph a
      // theme the shipped bootstrap never chose.
      await page.emulateMedia({ colorScheme: shot.colorScheme });
      await page.goto(`chrome-extension://${extensionId}/popup.html`);

      // Hold, then shoot, then check again.
      //
      // Waiting for the states alone is not enough, and this was measured the
      // embarrassing way: it passed. `grantDiagnostics` starts `[]`, so on the
      // first frame *every* row reads `granted` before the permission probe has
      // answered — which means a shot expecting two granted rows can be
      // satisfied by a frame that means nothing, and `page.screenshot()` then
      // runs later, against whatever the probe has since produced. The wait and
      // the photograph were looking at different frames.
      //
      // `settleFor` requires the states to hold across consecutive animation
      // frames, so the optimistic frame cannot satisfy it — it is replaced the
      // moment the probe resolves. The re-check after the screenshot is the
      // half that actually guarantees the result: it is the only assertion that
      // speaks about the frame that was captured rather than about some frame.
      const matches = (want) => {
        const rows = [...document.querySelectorAll('[data-testid="site"]')];
        return (
          rows.length === want.length &&
          rows.every((row, i) => row.getAttribute('data-state') === want[i])
        );
      };

      await page.waitForFunction(
        ({ want, frames }) => {
          const rows = [...document.querySelectorAll('[data-testid="site"]')];
          const ok =
            rows.length === want.length &&
            rows.every((row, i) => row.getAttribute('data-state') === want[i]);
          globalThis.__hlHeld = ok ? (globalThis.__hlHeld ?? 0) + 1 : 0;
          return globalThis.__hlHeld >= frames;
        },
        { want: shot.expect, frames: 20 },
        { timeout: 10_000 },
      );

      await page.screenshot({
        path: path.join(staging, shot.file),
        clip: { x: 0, y: 0, ...VIEWPORT },
      });

      const stillMatches = await page.evaluate(matches, shot.expect);
      if (!stillMatches) {
        const actual = await page.evaluate(() =>
          [...document.querySelectorAll('[data-testid="site"]')].map((r) =>
            r.getAttribute('data-state'),
          ),
        );
        throw new Error(
          `${shot.file}: the popup changed between the wait and the shot — ` +
            `expected ${JSON.stringify(shot.expect)}, captured ${JSON.stringify(actual)}.`,
        );
      }
    }
  } finally {
    await context.close();
  }

  // Every shot survived, so the set is coherent. Only now does it land.
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
