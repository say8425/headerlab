import { test as base } from '@playwright/test';
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
