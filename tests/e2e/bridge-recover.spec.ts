import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium, expect, test } from '@playwright/test';
import { assertBuildFresh } from '../support/build';
import { findBridgePid } from './bridge-fixtures';
import { unpackedExtensionId } from '../../packages/headerlab/lib/manifest.mjs';
import { installBridge, uninstallBridge } from '../../packages/headerlab/lib/install.mjs';
import { socketDir } from '../../packages/headerlab/lib/socket.mjs';

/**
 * The order a real person runs things in: the switch is already on, the port
 * has spent its connect budget against a host that is not installed, and only
 * then does `headerlab bridge install` run. Reported on 2026-10-02: the row
 * stayed `down` through the install and only an extension reload brought it
 * back, because no trigger `refreshBridge()` listened to was one that person
 * could cause.
 *
 * bridge-fixtures.ts installs *before* launch, so its suite can never reach
 * this order — which is why this file launches by hand.
 */
test('installing after the bridge went down recovers when the popup is opened', async () => {
  const extensionPath = assertBuildFresh('bridge-e2e');
  const profile = mkdtempSync(path.join(tmpdir(), 'headerlab-bridge-recover-'));
  const paths = {
    manifestDir: path.join(profile, 'NativeMessagingHosts'),
    launcherDir: path.join(profile, 'bin'),
    entryPath: path.resolve('packages/headerlab/bin/headerlab-host.mjs'),
    nodePath: process.execPath,
    extensionId: unpackedExtensionId(extensionPath),
    socketDirPath: socketDir(),
  };
  const origin = `chrome-extension://${paths.extensionId}/`;
  const context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium',
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
  });
  try {
    const first = await context.newPage();
    await first.goto(`chrome-extension://${paths.extensionId}/popup.html`);
    // Absence first: nothing is installed, so nothing may be live.
    await expect(first.getByTestId('bridge-state')).toHaveText('down');
    // The socket directory exists only once some host has bound in it; its
    // absence is the same answer as an empty one.
    expect(
      existsSync(paths.socketDirPath) ? findBridgePid(paths.socketDirPath, origin) : null,
    ).toBeNull();
    // Let the whole connect budget run out, so a success below cannot be a
    // retry left over from before the install.
    await first.waitForTimeout(1500);
    await expect(first.getByTestId('bridge-state')).toHaveText('down');
    await first.close();

    const installed = await installBridge(paths);
    if (!installed.ok) throw new Error(`bridge install failed: ${installed.error.message}`);

    const second = await context.newPage();
    await second.goto(`chrome-extension://${paths.extensionId}/popup.html`);
    await expect(second.getByTestId('bridgestate')).toHaveAttribute('data-bridge', 'live');
    await expect
      .poll(() => findBridgePid(paths.socketDirPath, origin), { timeout: 15_000 })
      .not.toBeNull();
  } finally {
    try {
      await context.close();
    } finally {
      await uninstallBridge(paths);
      rmSync(profile, { recursive: true, force: true });
    }
  }
});

test('the guide behind "down" names this install and its Retry brings the bridge up', async () => {
  const extensionPath = assertBuildFresh('bridge-e2e');
  const profile = mkdtempSync(path.join(tmpdir(), 'headerlab-bridge-guide-'));
  const paths = {
    manifestDir: path.join(profile, 'NativeMessagingHosts'),
    launcherDir: path.join(profile, 'bin'),
    entryPath: path.resolve('packages/headerlab/bin/headerlab-host.mjs'),
    nodePath: process.execPath,
    extensionId: unpackedExtensionId(extensionPath),
    socketDirPath: socketDir(),
  };
  const origin = `chrome-extension://${paths.extensionId}/`;
  const context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium',
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
  });
  try {
    const page = await context.newPage();
    await page.setViewportSize({ width: 748, height: 600 });
    await page.goto(`chrome-extension://${paths.extensionId}/popup.html`);
    await expect(page.getByTestId('bridge-state')).toHaveText('down');
    await page.waitForTimeout(1500);

    // The popover floats: opening it moves nothing on the rail.
    const rail = () =>
      page.evaluate(() =>
        ['runstate', 'bridgestate', 'add-field', 'site-list', 'rail-section-types'].map((id) => {
          const r = document.querySelector(`[data-testid="${id}"]`)?.getBoundingClientRect();
          return r ? [r.x, r.y, r.width, r.height] : null;
        }),
      );
    const before = await rail();
    await page.getByTestId('bridge-guide-trigger').click();
    await expect(page.getByTestId('bridge-guide')).toBeVisible();
    expect(await rail()).toEqual(before);

    // The id in the command is the one Chrome assigned this load path.
    await expect(page.getByTestId('bridge-command')).toHaveText(
      `headerlab bridge install --extension-id ${paths.extensionId}`,
    );

    const installed = await installBridge(paths);
    if (!installed.ok) throw new Error(`bridge install failed: ${installed.error.message}`);
    await page.getByTestId('bridge-retry').click();

    // A real host process, not only the row's word: `live` is the row's
    // report, the registry entry is the host's.
    await expect
      .poll(() => findBridgePid(paths.socketDirPath, origin), { timeout: 15_000 })
      .not.toBeNull();
    await expect(page.getByTestId('bridgestate')).toHaveAttribute('data-bridge', 'live');
    // A live row has nothing to guide, so the way in and the guide are gone —
    // and stay gone once the port has outlived its settle window.
    await page.waitForTimeout(1500);
    await expect(page.getByTestId('bridgestate')).toHaveAttribute('data-bridge', 'live');
    await expect(page.getByTestId('bridge-guide-trigger')).toHaveCount(0);
    await expect(page.getByTestId('bridge-guide')).toHaveCount(0);
  } finally {
    try {
      await context.close();
    } finally {
      await uninstallBridge(paths);
      rmSync(profile, { recursive: true, force: true });
    }
  }
});

test('a Retry against a host that dies on start never reads live and keeps the guide open', async () => {
  // The case the guide exists for: the person presses Retry and the host
  // still fails. Chrome hands back a port before it knows, and recording that
  // as connected flashed the row `live` — which also unmounted the guide
  // being read. A host that exits 300ms after starting makes that window
  // long enough to land in (a missing manifest fails too fast to render), and
  // sampling catches a flash a single `toHaveAttribute` would miss.
  const extensionPath = assertBuildFresh('bridge-e2e');
  const profile = mkdtempSync(path.join(tmpdir(), 'headerlab-bridge-retry-'));
  // Installed as the real host — `bridge install` starts it once to check —
  // and only then made to die, the way an upgrade or a moved checkout breaks
  // an install that worked.
  const dyingEntry = path.join(profile, 'host-entry.mjs');
  writeFileSync(
    dyingEntry,
    `import ${JSON.stringify(path.resolve('packages/headerlab/bin/headerlab-host.mjs'))};\n`,
  );
  const paths = {
    manifestDir: path.join(profile, 'NativeMessagingHosts'),
    launcherDir: path.join(profile, 'bin'),
    entryPath: dyingEntry,
    nodePath: process.execPath,
    extensionId: unpackedExtensionId(extensionPath),
    socketDirPath: socketDir(),
  };
  const installed = await installBridge(paths);
  if (!installed.ok) throw new Error(`bridge install failed: ${installed.error.message}`);
  writeFileSync(dyingEntry, 'setTimeout(() => process.exit(1), 300);\n');
  const context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium',
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
  });
  try {
    const page = await context.newPage();
    await page.setViewportSize({ width: 748, height: 600 });
    await page.goto(`chrome-extension://${paths.extensionId}/popup.html`);
    await expect(page.getByTestId('bridge-state')).toHaveText('down', { timeout: 10_000 });
    await page.getByTestId('bridge-guide-trigger').click();
    await expect(page.getByTestId('bridge-guide')).toBeVisible();

    await page.getByTestId('bridge-retry').click();
    const seen = await page.evaluate(async () => {
      const out: string[] = [];
      const end = Date.now() + 2500;
      while (Date.now() < end) {
        out.push(
          document.querySelector('[data-testid="bridgestate"]')?.getAttribute('data-bridge') ?? '',
        );
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      return out;
    });

    expect(seen.length).toBeGreaterThan(50);
    expect(seen.filter((mode) => mode !== 'idle')).toEqual([]);
    await expect(page.getByTestId('bridge-guide')).toBeVisible();
    await expect(page.getByTestId('bridge-retry')).toHaveText('Retry now');
    await expect(page.getByTestId('bridge-retry-failed')).toHaveCount(0);
  } finally {
    try {
      await context.close();
    } finally {
      await uninstallBridge(paths);
      rmSync(profile, { recursive: true, force: true });
    }
  }
});
