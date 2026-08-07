import { test as base, chromium, type BrowserContext, type Worker } from '@playwright/test';
import { assertBuildFresh } from '../support/build';

export const test = base.extend<{
  context: BrowserContext;
  serviceWorker: Worker;
  extensionId: string;
}>({
  // Playwright reads a fixture's dependencies off its destructuring pattern, so
  // an empty one is how a fixture declares that it depends on nothing. Omitting
  // the parameter entirely is not the same statement, and `_` would be read as
  // a fixture named `_`.
  // oxlint-disable-next-line no-empty-pattern
  context: async ({}, use) => {
    // This suite is the only assertion in the project that runs at the resolved
    // layout level, and it loads a *build*, not the sources. Checking presence
    // was never enough: a reviewer once deleted `width: 100%` from style.css,
    // ran a bare `npx playwright test`, and watched all four tests pass against
    // the build from before the deletion — the guard disabled by nothing more
    // than the command chosen to run it. assertBuildFresh rejects a stale build
    // as well as an absent one, and resolves the mode-suffixed output directory
    // (`chrome-mv3-e2e`, which is where the loopback host permission lives).
    const EXTENSION_PATH = assertBuildFresh('e2e');

    const context = await chromium.launchPersistentContext('', {
      channel: 'chromium',
      args: [`--disable-extensions-except=${EXTENSION_PATH}`, `--load-extension=${EXTENSION_PATH}`],
    });
    await use(context);
    await context.close();
  },

  // Exposed as a fixture so tests never re-derive it — `context.serviceWorkers()[0]`
  // is `Worker | undefined` under `noUncheckedIndexedAccess`, and narrowing it once
  // here beats a non-null assertion in every test.
  serviceWorker: async ({ context }, use) => {
    let [worker] = context.serviceWorkers();
    if (!worker) worker = await context.waitForEvent('serviceworker');
    await use(worker);
  },

  extensionId: async ({ serviceWorker }, use) => {
    const id = serviceWorker.url().split('/')[2];
    if (!id) {
      throw new Error(`could not derive extension id from ${serviceWorker.url()}`);
    }
    await use(id);
  },
});

export const expect = test.expect;
