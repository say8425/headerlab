import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium, expect, test, type BrowserContext, type Page } from '@playwright/test';
import { assertBuildFresh } from '../support/build';
import { unpackedExtensionId } from '../../packages/headerlab/lib/manifest.mjs';
import { installBridge, uninstallBridge } from '../../packages/headerlab/lib/install.mjs';
import { socketDir } from '../../packages/headerlab/lib/socket.mjs';

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
    entryPath: path.resolve('packages/headerlab/bin/headerlab-host.mjs'),
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

  // The label's box must stay one line tall. A label that does not fit its
  // budget wraps inside the row's fixed `h-5` and overlaps the row above it
  // rather than moving anything — the same reflow this whole fix exists to
  // remove, at the level of one element's own box instead of its neighbours'.
  //
  // Asserted against `leading-4` — 16px — rather than against the live
  // measurement. That comparison used to mean something, when the two states
  // rendered different strings ("Bridge down" against "Bridge live") in the
  // same box; the label is now the constant `BRIDGE_NAME` in every state, so
  // comparing the two is comparing one string to itself and cannot fail. The
  // literal can: a longer name, a larger leading, or a narrower rail all break
  // it, which is the whole set of ways this can actually go wrong.
  expect(idleMeasurement.labelHeight).toEqual(16);
  expect(liveMeasurement.labelHeight).toEqual(16);

  // Assertion 2, the one that catches the original defect: the site list
  // still reports its full cap rather than collapsing. Checked before the
  // geometry comparison below so a failure here names the actual site, not
  // just "some box moved".
  //
  // Stated rather than derived: a derived figure would follow a collapse down
  // and pass, which is exactly the defect this assertion exists to catch. The
  // cap went 127 -> 119 -> 127 inside one branch; ScopeRail.tsx's site-list
  // docblock records why the middle value was right when written and wrong two
  // commits later.
  expect(idleMeasurement.boxes['[data-testid="site-list"]']![3]).toEqual(127);
  expect(liveMeasurement.boxes['[data-testid="site-list"]']![3]).toEqual(127);

  // Every probe must resolve to a real box before the comparison below can
  // mean anything — the same guard header-modification.spec.ts's own
  // `boxes()` uses on this exact selector-collection shape, for the exact
  // reason its comment gives: two records of empty arrays compare equal, so
  // a selector that stopped matching in *both* scenarios at once (a rename,
  // say) would silently drop that box from Assertion 1 below rather than
  // failing it.
  for (const [label, boxes] of Object.entries({
    idle: idleMeasurement.boxes,
    live: liveMeasurement.boxes,
  })) {
    expect(
      Object.values(boxes).filter((b) => b.length !== 4),
      `every probe must match an element in the ${label} measurement`,
    ).toEqual([]);
  }

  // Assertion 1: every box below and around the bridge row sits at the same
  // coordinates whether the bridge answered or not — the family this test
  // belongs to, for this element.
  expect(idleMeasurement.boxes).toEqual(liveMeasurement.boxes);
});
