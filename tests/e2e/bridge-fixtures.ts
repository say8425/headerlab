import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test as base, chromium, type BrowserContext, type Worker } from '@playwright/test';
import { assertBuildFresh } from '../support/build';
import { unpackedExtensionId } from '../../packages/host/lib/manifest.mjs';
import { installBridge, uninstallBridge } from '../../packages/cli/lib/install.mjs';
import { socketDir } from '../../packages/host/lib/socket.mjs';

/**
 * A context whose native messaging host is installed into its own profile,
 * loading the `bridge-e2e` build (wxt.config.ts) rather than the shared `e2e`
 * one `fixtures.ts` uses.
 *
 * Two reasons this file is separate from `fixtures.ts` rather than an option
 * on it. `fixtures.ts` launches with `''`, letting Playwright pick a
 * throwaway profile — which is unusable here: Chrome resolves
 * NativeMessagingHosts from the user data dir, so a manifest has to be
 * written into a directory that exists before launch. And the build itself
 * differs: `bridge-e2e` grants `nativeMessaging` outright so Playwright never
 * meets Chrome's consent dialog, which the shared `e2e` build deliberately
 * does not — granting it there once made every other popup test in
 * header-modification.spec.ts land on `bridge: 'idle'` with a connect error,
 * collapsing the site list in two of that suite's layout guards (see
 * wxt.config.ts's `bridge-e2e` branch for the measurement).
 *
 * The extension id is computed from the load path *before* launch, because the
 * manifest needs it and `allowed_origins` takes no wildcard. `derivedId` is
 * exported so the test can assert it against the id the browser really
 * assigned — which is exactly the self-verification §8.3 asks for, done
 * against a running Chrome rather than by hand.
 */
export const test = base.extend<{
  context: BrowserContext;
  serviceWorker: Worker;
  extensionId: string;
  derivedId: string;
  bridgeSocketDir: string;
}>({
  // oxlint-disable-next-line no-empty-pattern
  context: async ({}, use) => {
    const extensionPath = assertBuildFresh('bridge-e2e');
    const profile = mkdtempSync(path.join(tmpdir(), 'headerlab-e2e-'));
    const paths = {
      manifestDir: path.join(profile, 'NativeMessagingHosts'),
      launcherDir: path.join(profile, 'bin'),
      entryPath: path.resolve('packages/host/bin/headerlab-host.mjs'),
      nodePath: process.execPath,
      extensionId: unpackedExtensionId(extensionPath),
      socketDirPath: socketDir(),
    };
    const installed = await installBridge(paths);
    if (!installed.ok) throw new Error(`bridge install failed: ${installed.error.message}`);

    const context = await chromium.launchPersistentContext(profile, {
      channel: 'chromium',
      args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
    });
    await use(context);
    await context.close();
    await uninstallBridge(paths);
    rmSync(profile, { recursive: true, force: true });
  },

  // oxlint-disable-next-line no-empty-pattern
  derivedId: async ({}, use) => {
    await use(unpackedExtensionId(assertBuildFresh('bridge-e2e')));
  },

  // oxlint-disable-next-line no-empty-pattern
  bridgeSocketDir: async ({}, use) => {
    await use(socketDir());
  },

  serviceWorker: async ({ context }, use) => {
    let [worker] = context.serviceWorkers();
    if (!worker) worker = await context.waitForEvent('serviceworker');
    await use(worker);
  },

  extensionId: async ({ serviceWorker }, use) => {
    const id = serviceWorker.url().split('/')[2];
    if (!id) throw new Error(`could not derive extension id from ${serviceWorker.url()}`);
    await use(id);
  },
});

export const expect = test.expect;
