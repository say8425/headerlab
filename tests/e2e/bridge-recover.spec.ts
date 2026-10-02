import { mkdtempSync, rmSync } from 'node:fs';
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
    expect(findBridgePid(paths.socketDirPath, origin)).toBeNull();
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
