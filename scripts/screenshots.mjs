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
 * **The waits are assertions.** Each shot declares the row states it expects,
 * because the popup renders once before the permission probe answers and every
 * row is optimistically green in that first frame. Waiting for a duration would
 * photograph whichever frame the machine happened to be on; waiting for the
 * states means a shot that cannot reach them fails loudly instead of shipping a
 * picture that quietly says the wrong thing.
 *
 * The outputs land in `docs/screenshots/`, which `tests/support/build.ts` counts
 * as source — so a capture run leaves the build stale until the next build. That
 * is the source set being deliberately over-broad rather than hand-listed
 * (see its comment); `npm test` builds first, so it never surfaces.
 */
import { chromium } from '@playwright/test';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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

const extension = mkdtempSync(path.join(tmpdir(), 'headerlab-shot-'));
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

mkdirSync(OUT, { recursive: true });

const context = await chromium.launchPersistentContext(mkdtempSync(path.join(tmpdir(), 'headerlab-profile-')), {
  channel: 'chromium',
  viewport: VIEWPORT,
  // Retina, so the PNG survives being scaled down in a README column.
  deviceScaleFactor: 2,
  args: [
    `--disable-extensions-except=${extension}`,
    `--load-extension=${extension}`,
  ],
});

let [worker] = context.serviceWorkers();
if (!worker) worker = await context.waitForEvent('serviceworker');
const extensionId = worker.url().split('/')[2];

const page = await context.newPage();
const written = [];

for (const shot of SHOTS) {
  await worker.evaluate(async (seed) => {
    await chrome.storage.local.set({ state: seed, state$: { v: 2 } });
  }, shot.state);

  // Set before navigating: public/theme.js reads the media query at parse time,
  // ahead of first paint, so emulating afterwards would photograph a theme the
  // shipped bootstrap never chose.
  await page.emulateMedia({ colorScheme: shot.colorScheme });
  await page.goto(`chrome-extension://${extensionId}/popup.html`);

  await page.waitForFunction(
    (want) => {
      const rows = [...document.querySelectorAll('[data-testid="site"]')];
      return rows.length === want.length &&
        rows.every((row, i) => row.getAttribute('data-state') === want[i]);
    },
    shot.expect,
    { timeout: 10_000 },
  );

  const file = path.join(OUT, shot.file);
  await page.screenshot({ path: file, clip: { x: 0, y: 0, ...VIEWPORT } });
  written.push(path.relative(ROOT, file));
}

await context.close();
rmSync(extension, { recursive: true, force: true });
console.log(written.join('\n'));
