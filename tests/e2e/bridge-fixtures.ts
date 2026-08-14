import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test as base, chromium, type BrowserContext, type Worker } from '@playwright/test';
import { assertBuildFresh } from '../support/build';
import { unpackedExtensionId } from '../../packages/headerlab/lib/manifest.mjs';
import { installBridge, uninstallBridge } from '../../packages/headerlab/lib/install.mjs';
import { socketDir } from '../../packages/headerlab/lib/socket.mjs';

/**
 * The registry is what makes a specific bridge addressable — see §8.6. Lives
 * here rather than in bridge.spec.ts (which used to define its own copy)
 * because this fixture's own teardown now needs it too, to confirm the host
 * it launched actually removed its entry — see the `context` fixture below.
 */
export function findBridgePid(dir: string, origin: string): number | null {
  for (const name of readdirSync(dir)) {
    const match = /^(\d+)\.json$/.exec(name);
    if (!match) continue;
    try {
      const entry = JSON.parse(readFileSync(path.join(dir, name), 'utf8'));
      if (entry.origin === origin) return Number(match[1]);
    } catch {
      // A half-written entry is not this test's bridge.
    }
  }
  return null;
}

/**
 * How long to wait, after asking the bridge to shut down, for its registry
 * entry to actually disappear before treating that as a leak. Chrome gives a
 * native-messaging host up to two seconds to exit on closed stdin
 * (`packages/headerlab/lib/host.mjs`'s docblock, and
 * `packages/headerlab/lib/install.mjs`'s own `SHUTDOWN_GRACE_MS`); this adds a
 * margin over that rather than reusing the exact number, since this is
 * measuring the same shutdown through one more layer — `context.close()`
 * tearing down the whole browser, not a single spawned child directly.
 */
const SOCKET_CLEANUP_TIMEOUT_MS = 5000;
const SOCKET_CLEANUP_POLL_MS = 100;

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
 *
 * **This fixture necessarily writes into the real per-user socket directory
 * (`socketDir()`, no override), not a scratch one.** `manifestDir` and
 * `launcherDir` above are both under the test's own `mkdtemp` profile, but
 * the socket directory cannot be: Chrome launches the host it resolves from
 * `manifestDir` with only the origin as argv, with no way for anything here
 * to inject `HEADERLAB_SOCKET_DIR` into that process's environment, so the
 * host can only ever bind into the one real directory `socketDir()` resolves
 * — the same one a developer's own live bridge would use. That is exactly
 * why `--bridge <pid>` and origin-matching exist rather than directory
 * isolation (see bridge.spec.ts). The write is transient, not permanent: the
 * host removes its own socket and registry entry when Chrome closes its
 * stdin, within the ~2s grace period noted above, and this fixture's own
 * teardown below now waits for and asserts exactly that — verified by the
 * suite itself rather than by hand after each run.
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
      entryPath: path.resolve('packages/headerlab/bin/headerlab-host.mjs'),
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
    // try/finally rather than four sequential awaits: `use(context)` already
    // runs this code regardless of whether the test body threw (Playwright's
    // own contract), but nothing protected the teardown steps from each
    // other — if `context.close()` itself threw (the browser process already
    // gone, say), `uninstallBridge` and `rmSync` were skipped and the
    // manifest/launcher were left under this test's `mkdtemp` profile.
    // Scratch-only, so not a real-directory leak, but still worth closing:
    // `bridge-rail.spec.ts` already wraps its own equivalent teardown this
    // way.
    try {
      await context.close();
    } finally {
      await uninstallBridge(paths);
      rmSync(profile, { recursive: true, force: true });
    }

    // The self-check the docblock above promises: this host necessarily
    // wrote into the *real* socket directory, and nothing but its own
    // shutdown handling removes what it wrote there. Polled rather than
    // checked once — `context.close()` tears down the whole browser, and
    // nothing here observes the moment the host process itself actually
    // exits, only that it eventually does. A leaked entry here would be a
    // real regression: this directory is shared with a developer's own live
    // bridge, and "self-heals" was, before this assertion, something the
    // last five task reports established the same way every time — by
    // running the suite and looking, not by the suite itself.
    const origin = `chrome-extension://${paths.extensionId}/`;
    const deadline = Date.now() + SOCKET_CLEANUP_TIMEOUT_MS;
    let pid = findBridgePid(paths.socketDirPath, origin);
    while (pid !== null && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, SOCKET_CLEANUP_POLL_MS));
      pid = findBridgePid(paths.socketDirPath, origin);
    }
    if (pid !== null) {
      throw new Error(
        `bridge registry entry for ${origin} (pid ${pid}) is still in the real socket ` +
          `directory ${SOCKET_CLEANUP_TIMEOUT_MS}ms after teardown — the host did not clean up ` +
          `after itself`,
      );
    }
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
