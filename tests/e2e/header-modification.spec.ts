import { expect, test } from './fixtures';
import { startEchoServer, type EchoServer } from './echo-server';

/**
 * `worker.evaluate()` callbacks run inside the extension's service worker, where
 * `chrome` exists at runtime — but `@types/chrome` is not in this project's type
 * program, so `tsc --noEmit` would report TS2503 without a declaration. Declaring
 * only the surface these tests touch keeps the dependency explicit rather than
 * reaching for `any`.
 */
declare const chrome: {
  storage: { local: { set(items: Record<string, unknown>): Promise<void> } };
  declarativeNetRequest: { getDynamicRules(): Promise<Array<{ id: number }>> };
};

let echo: EchoServer;

test.beforeEach(async () => {
  echo = await startEchoServer();
});

test.afterEach(async () => {
  await echo.close();
});

test('a configured set rule reaches the wire', async ({ context, serviceWorker }) => {
  const worker = serviceWorker;

  await worker.evaluate(async (state) => {
    // `local:state` maps to the chrome.storage.local key `state`. WXT keeps the
    // item's version alongside it at `state$`; seed both so the versioned item
    // is not read as un-versioned. See the troubleshooting note below if the
    // rule count never reaches 1.
    await chrome.storage.local.set({ state, state$: { v: 1 } });
  }, {
    version: 1,
    globalPause: false,
    theme: 'system',
    profiles: [{
      id: 'p1',
      name: 'E2E',
      color: 'green',
      enabled: true,
      order: 0,
      filter: {
        mode: 'structured',
        domains: ['127.0.0.1'],
        excludedDomains: [],
        // Explicit: the DNR default excludes main_frame, which page.goto() is.
        resourceTypes: ['xmlhttprequest', 'main_frame', 'sub_frame'],
      },
      tabLock: { enabled: false, tabId: null, tabTitle: null },
      headers: [
        { id: 'h1', enabled: true, target: 'request',
          operation: 'set', name: 'X-Headerlab-Test', value: 'applied' },
        { id: 'h2', enabled: false, target: 'request',
          operation: 'set', name: 'X-Headerlab-Disabled', value: 'nope' },
      ],
    }],
  });

  // Wait for the storage watcher to drive reconcile to completion.
  await expect
    .poll(async () => (await worker.evaluate(() =>
      chrome.declarativeNetRequest.getDynamicRules().then((r) => r.length),
    )), { timeout: 10_000 })
    .toBe(1);

  const page = await context.newPage();
  await page.goto(`${echo.origin}/probe`);

  const probe = echo.requests.find((r) => r.url === '/probe');
  expect(probe, 'echo server received the navigation').toBeTruthy();
  expect(probe!.headers['x-headerlab-test']).toBe('applied');
  expect(probe!.headers['x-headerlab-disabled']).toBeUndefined();

  await page.close();
});

test('a remove rule strips a header the page would otherwise send', async ({
  context,
  serviceWorker,
}) => {
  const worker = serviceWorker;

  await worker.evaluate(async (state) => {
    // `local:state` maps to the chrome.storage.local key `state`. WXT keeps the
    // item's version alongside it at `state$`; seed both so the versioned item
    // is not read as un-versioned. See the troubleshooting note below if the
    // rule count never reaches 1.
    await chrome.storage.local.set({ state, state$: { v: 1 } });
  }, {
    version: 1,
    globalPause: false,
    theme: 'system',
    profiles: [{
      id: 'p1', name: 'E2E', color: 'green', enabled: true, order: 0,
      filter: {
        mode: 'structured', domains: ['127.0.0.1'], excludedDomains: [],
        resourceTypes: ['xmlhttprequest'],
      },
      tabLock: { enabled: false, tabId: null, tabTitle: null },
      headers: [
        { id: 'h1', enabled: true, target: 'request',
          operation: 'remove', name: 'X-Remove-Me', value: '' },
      ],
    }],
  });

  await expect
    .poll(async () => (await worker.evaluate(() =>
      chrome.declarativeNetRequest.getDynamicRules().then((r) => r.length),
    )), { timeout: 10_000 })
    .toBe(1);

  const page = await context.newPage();
  await page.goto(`${echo.origin}/host`);
  await page.evaluate(async (origin) => {
    await fetch(`${origin}/xhr`, { headers: { 'X-Remove-Me': 'should-be-gone' } });
  }, echo.origin);

  await expect.poll(() => echo.requests.some((r) => r.url === '/xhr')).toBe(true);

  const xhr = echo.requests.find((r) => r.url === '/xhr')!;
  expect(xhr.headers['x-remove-me']).toBeUndefined();

  await page.close();
});

test('the popup renders in the real extension', async ({ context, extensionId }) => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/popup.html`);
  await expect(page.getByRole('button', { name: 'Create profile' })).toBeVisible();
  await page.close();
});
