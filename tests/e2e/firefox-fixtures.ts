import { test as base } from '@playwright/test';
import type { AppState } from '../../lib/model/types';
import { assertBuildFresh } from '../support/build';
import { launchFirefox, type FirefoxSession } from '../support/firefox';
import { startEchoServer, type EchoServer } from './echo-server';

/**
 * The Firefox half of the e2e suite rides the same runner as the Chrome half
 * — fixtures, `expect.poll`, the reporter, and the `--list` count CLAUDE.md
 * cites — but the browser is a real Firefox driven over Marionette, because
 * Playwright's own Firefox cannot load an extension.
 *
 * The build is `firefox-mv3-e2e`: production plus `host_permissions` for the
 * loopback echo server, exactly as Chrome's `e2e` mode. assertBuildFresh
 * refuses a stale or absent one by name.
 */
export const test = base.extend<{ firefox: FirefoxSession; echo: EchoServer }>({
  // Playwright reads a fixture's dependencies off its destructuring pattern, so
  // an empty one is how a fixture declares that it depends on nothing.
  // oxlint-disable-next-line no-empty-pattern
  firefox: async ({}, use) => {
    const session = await launchFirefox(assertBuildFresh('firefox-e2e'));
    await use(session);
    await session.close();
  },
  // oxlint-disable-next-line no-empty-pattern
  echo: async ({}, use) => {
    const server = await startEchoServer();
    await use(server);
    await server.close();
  },
});

export const expect = test.expect;

/**
 * Seeds `local:state` on a Firefox session, waiting first for the popup's own
 * bootstrap write to land.
 *
 * `launchFirefox` navigates the session's first tab to the popup before
 * returning it, so on a fresh profile the popup mounts against **empty**
 * storage. `App.tsx`'s `!resolved.profile` effect then mints a default
 * profile via `patch`, which is a read-then-write on the very same
 * `local:state` key (`patchState` in `lib/storage/state.ts`: `getState()`
 * then `setState()`). That write races an unguarded seed here — while
 * diagnosing this, an unguarded `set()` was observed landing a random-uuid
 * default profile instead of the seeded one on several ad hoc runs on this
 * machine (macOS, headless Firefox); the runs were not counted, so this is
 * "observed, not measured as a fraction," not a rate.
 *
 * Waiting for *any* profile to exist before writing closes the window:
 * once `local:state` holds a profile, `App.tsx`'s effect no longer calls
 * `patch` on the next render (`resolved.profile` is truthy and
 * `resolved.dropped.length === 0`), so this function's own write is not
 * racing anything.
 *
 * **Every Firefox e2e spec must seed through this function**, not through a
 * direct `browser.storage.local.set`, or it reintroduces the same race.
 */
export async function seedFirefoxState(firefox: FirefoxSession, state: AppState): Promise<void> {
  await expect
    .poll(
      () =>
        firefox.evaluate<boolean>(
          "browser.storage.local.get('state').then((r) => Boolean(r.state && r.state.profiles && r.state.profiles.length > 0))",
        ),
      { timeout: 10_000 },
    )
    .toBe(true);
  await firefox.evaluate(
    `browser.storage.local.set({ state: ${JSON.stringify(state)}, state$: { v: 2 } }).then(() => 'ok')`,
  );
  // The storage watcher drives reconcile; the rule count is the settling signal.
  await expect
    .poll(
      () =>
        firefox.evaluate<number>(
          'browser.declarativeNetRequest.getDynamicRules().then((r) => r.length)',
        ),
      { timeout: 10_000 },
    )
    .toBe(1);
}
