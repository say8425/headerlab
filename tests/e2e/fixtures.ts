import { existsSync } from 'node:fs';
import path from 'node:path';
import { test as base, chromium, type BrowserContext, type Worker } from '@playwright/test';

// WXT suffixes the output directory with the mode unless it is `development`
// or `production` (see `resolve-config.mjs`'s `modeSuffix` table), so
// `wxt build --mode e2e` lands in `chrome-mv3-e2e`, not `chrome-mv3`. The
// loopback host permission this suite depends on only exists in that build.
const EXTENSION_PATH = path.resolve('.output/chrome-mv3-e2e');

export const test = base.extend<{
  context: BrowserContext;
  serviceWorker: Worker;
  extensionId: string;
}>({
  context: async ({}, use) => {
    if (!existsSync(EXTENSION_PATH)) {
      throw new Error(
        `extension build not found at ${EXTENSION_PATH} — run \`npm run test:e2e\` ` +
        `(or \`npm run build:e2e\` before \`playwright test\`), not a plain \`npm run build\`.`,
      );
    }

    const context = await chromium.launchPersistentContext('', {
      channel: 'chromium',
      args: [
        `--disable-extensions-except=${EXTENSION_PATH}`,
        `--load-extension=${EXTENSION_PATH}`,
      ],
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
