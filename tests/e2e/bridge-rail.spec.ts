import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium, expect, test, type BrowserContext, type Page } from '@playwright/test';
import { assertBuildFresh } from '../support/build';
import { unpackedExtensionId } from '../../packages/host/lib/manifest.mjs';
import { installBridge, uninstallBridge } from '../../packages/cli/lib/install.mjs';
import { socketDir } from '../../packages/host/lib/socket.mjs';

/**
 * The rail-layout side of the bridge feature, exercised the way
 * header-modification.spec.ts's "a control appearing in the rail does not
 * move anything" already does for the Grant button, the subcount, the help
 * bubble and the duplicate-site note — this is that same family, for the
 * state ScopeRail.tsx's `bridgeUnreachable` now folds into the existing
 * bridge row instead of a second box.
 *
 * Not in header-modification.spec.ts itself: that suite's `fixtures.ts`
 * loads the plain `e2e` build, which does not hold nativeMessaging (see
 * wxt.config.ts's `bridge-e2e` branch) — so `idle` can never be reached
 * there. This file loads `bridge-e2e` directly, the same build
 * bridge-fixtures.ts uses, for exactly that permission.
 *
 * `idle` with `bridgeError: null` — team lead's literal "idle vs
 * idle-with-an-error" pairing — is not a state `lib/bridge/port.ts`'s
 * `connect()` can actually produce once the permission is held: every failed
 * connectNative attempt sets `lastError` to Chrome's message in the same
 * write that flips `connected` false (see its `onDisconnect` listener), and
 * `lastError: null` only happens on the `off` path, which is a different
 * `bridge` value entirely. tests/unit/ScopeRail.test.tsx's "keeps the row
 * the exact same box" test makes that exact literal comparison, at the
 * levels jsdom can actually do it (class lists, not layout). What a real
 * browser can and does reach is `live` (bridge installed and answering) and
 * `idle` with an error (bridge-e2e's permission held, nothing installed) —
 * so that is the pairing measured here, against real computed layout.
 */

const FOUR_SITES_AT_CAP = {
  version: 2,
  globalPause: false,
  theme: 'system',
  profiles: [
    {
      id: 'p1',
      name: 'Local',
      color: 'green',
      enabled: true,
      order: 0,
      filter: {
        mode: 'structured',
        allSites: false,
        domains: ['a.example.com', 'b.example.com', 'c.example.com', 'd.example.com'],
        excludedDomains: [],
        resourceTypes: ['xmlhttprequest', 'main_frame'],
      },
      tabLock: { enabled: false, tabId: null, tabTitle: null },
      headers: [
        { id: 'h1', enabled: true, target: 'request', operation: 'set', name: 'X-A', value: '1' },
      ],
    },
  ],
};

/** Same selector family as header-modification.spec.ts's `RAIL_BOXES`, plus the two this state actually touches. */
const BOXES = [
  '[data-testid="readout"]',
  '[data-testid="runstate"]',
  '[data-testid="all-sites"]',
  '[data-testid="add-field"]',
  '[data-testid="rail-section-types"]',
  '[data-testid="type-grid"]',
  '[data-testid="site-list"]',
] as const;

declare const chrome: {
  storage: { local: { set(items: Record<string, unknown>): Promise<void> } };
};

async function measure(
  page: Page,
): Promise<{ boxes: Record<string, number[]>; bridge: string; labelHeight: number }> {
  const boxes = await page.evaluate(
    (selectors) => {
      const out: Record<string, number[]> = {};
      for (const selector of selectors) {
        const el = document.querySelector(selector);
        if (!el) {
          out[selector] = [];
          continue;
        }
        const r = el.getBoundingClientRect();
        out[selector] = [r.x, r.y, r.width, r.height].map((v) => Math.round(v * 100) / 100);
      }
      return out;
    },
    BOXES as unknown as string[],
  );
  const bridge = (await page.getByTestId('bridgestate').getAttribute('data-bridge')) ?? '';
  const labelHeight = await page.getByTestId('bridge-label').evaluate((el) => el.clientHeight);
  return { boxes, bridge, labelHeight };
}

/**
 * Loads bridge-e2e, seeds the four-site-at-cap state, opens the popup.
 * Caller must `await context.close()` before removing `profile` — Chrome
 * still holds files open in it until the process actually exits, and
 * removing on a `context.on('close', ...)` listener instead raced that exit
 * and threw ENOTEMPTY (measured). `bridge-fixtures.ts`'s own context fixture
 * sequences the same way for the same reason.
 */
async function openPopup(): Promise<{ context: BrowserContext; page: Page; profile: string }> {
  const extensionPath = assertBuildFresh('bridge-e2e');
  const profile = mkdtempSync(path.join(tmpdir(), 'headerlab-bridge-rail-'));
  const context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium',
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
  });

  let worker = context.serviceWorkers()[0];
  if (!worker) worker = await context.waitForEvent('serviceworker');
  const extensionId = worker.url().split('/')[2];

  await worker.evaluate(async (state) => {
    await chrome.storage.local.set({ state, state$: { v: 2 } });
  }, FOUR_SITES_AT_CAP);

  const page = await context.newPage();
  await page.setViewportSize({ width: 748, height: 600 });
  await page.goto(`chrome-extension://${extensionId}/popup.html`);
  return { context, page, profile };
}

test('an unreachable bridge leaves the rail exactly where a live one does', async () => {
  // --- live: a real bridge installed into this profile before launch ---
  const liveExtensionPath = assertBuildFresh('bridge-e2e');
  const liveProfile = mkdtempSync(path.join(tmpdir(), 'headerlab-bridge-rail-live-'));
  const paths = {
    manifestDir: path.join(liveProfile, 'NativeMessagingHosts'),
    launcherDir: path.join(liveProfile, 'bin'),
    entryPath: path.resolve('packages/host/bin/headerlab-host.mjs'),
    nodePath: process.execPath,
    extensionId: unpackedExtensionId(liveExtensionPath),
    socketDirPath: socketDir(),
  };
  const installed = await installBridge(paths);
  if (!installed.ok) throw new Error(`bridge install failed: ${installed.error.message}`);

  const liveContext = await chromium.launchPersistentContext(liveProfile, {
    channel: 'chromium',
    args: [
      `--disable-extensions-except=${liveExtensionPath}`,
      `--load-extension=${liveExtensionPath}`,
    ],
  });
  let liveMeasurement: { boxes: Record<string, number[]>; bridge: string; labelHeight: number };
  try {
    let worker = liveContext.serviceWorkers()[0];
    if (!worker) worker = await liveContext.waitForEvent('serviceworker');
    const extensionId = worker.url().split('/')[2];
    await worker.evaluate(async (state) => {
      await chrome.storage.local.set({ state, state$: { v: 2 } });
    }, FOUR_SITES_AT_CAP);

    const page = await liveContext.newPage();
    await page.setViewportSize({ width: 748, height: 600 });
    await page.goto(`chrome-extension://${extensionId}/popup.html`);
    await expect(page.getByTestId('bridgestate')).toHaveAttribute('data-bridge', 'live', {
      timeout: 15_000,
    });
    liveMeasurement = await measure(page);
  } finally {
    await liveContext.close();
    await uninstallBridge(paths);
    rmSync(liveProfile, { recursive: true, force: true });
  }
  expect(liveMeasurement.bridge).toEqual('live');

  // --- idle, with an error: bridge-e2e's permission held, nothing installed ---
  const { context: idleContext, page: idlePage, profile: idleProfile } = await openPopup();
  let idleMeasurement: { boxes: Record<string, number[]>; bridge: string; labelHeight: number };
  try {
    // A real, unfaked failure: Chrome finds no NativeMessagingHosts entry for
    // this profile and answers `connectNative` with its own string — not a
    // duration wait, which would photograph whichever moment the machine
    // landed on.
    await expect(idlePage.getByTestId('bridgestate')).toHaveAttribute('data-bridge', 'idle', {
      timeout: 15_000,
    });
    idleMeasurement = await measure(idlePage);
  } finally {
    await idleContext.close();
    rmSync(idleProfile, { recursive: true, force: true });
  }
  expect(idleMeasurement.bridge).toEqual('idle');

  // Whatever the unreachable label's exact wording is, its box must stay one
  // line tall — the same height "Bridge live" renders at, since both use the
  // same `text-[12px] leading-4` class and the row itself has no more height
  // to give. A label whose text does not fit its ~87px budget wraps to a
  // second line inside the row's fixed `h-5` and overlaps the row above it
  // rather than moving anything — the same reflow this whole fix exists to
  // remove, just at the level of one element's own box instead of its
  // neighbours'. Comparing to the live measurement rather than a hardcoded
  // pixel count means this does not need updating if the leading scale ever
  // changes; only the words on either side would ever break it.
  expect(idleMeasurement.labelHeight).toEqual(liveMeasurement.labelHeight);

  // Assertion 2, the one that catches the original defect: the site list
  // still reports its full 127px cap rather than collapsing. Checked before
  // the geometry comparison below so a failure here names the actual site,
  // not just "some box moved".
  expect(idleMeasurement.boxes['[data-testid="site-list"]']![3]).toEqual(127);
  expect(liveMeasurement.boxes['[data-testid="site-list"]']![3]).toEqual(127);

  // Assertion 1: every box below and around the bridge row sits at the same
  // coordinates whether the bridge answered or not — the family this test
  // belongs to, for this element.
  expect(idleMeasurement.boxes).toEqual(liveMeasurement.boxes);
});
