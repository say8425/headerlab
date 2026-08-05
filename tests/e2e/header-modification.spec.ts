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
    await fetch(`${origin}/xhr`, {
      headers: {
        'X-Remove-Me': 'should-be-gone',
        // Positive control: the rule does not target this one. If custom headers
        // stopped reaching the server at all, the absence assertion below would
        // pass vacuously — this assertion is what makes that impossible.
        'X-Keep-Me': 'should-survive',
      },
    });
  }, echo.origin);

  await expect.poll(() => echo.requests.some((r) => r.url === '/xhr')).toBe(true);

  const xhr = echo.requests.find((r) => r.url === '/xhr')!;
  expect(xhr.headers['x-remove-me']).toBeUndefined();
  expect(xhr.headers['x-keep-me']).toBe('should-survive');

  await page.close();
});

test('the popup renders its rules from stored state', async ({ context, extensionId, serviceWorker }) => {
  await serviceWorker.evaluate(async () => {
    const state = {
      version: 1,
      globalPause: false,
      theme: 'system',
      profiles: [{
        id: 'p1', name: 'Local', color: 'green', enabled: true, order: 0,
        filter: {
          mode: 'structured', domains: ['api.example.com'],
          excludedDomains: [], resourceTypes: ['xmlhttprequest'],
        },
        tabLock: { enabled: false, tabId: null, tabTitle: null },
        headers: [
          { id: 'h1', enabled: true, target: 'request', operation: 'set', name: 'X-From-E2E', value: 'yes' },
        ],
      }],
    };
    // `local:state` maps to the chrome.storage.local key `state`. WXT keeps the
    // version in a companion key.
    await chrome.storage.local.set({ state, state$: { v: 1 } });
  });

  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/popup.html`);

  // The row's name lives in an input, so its value is the assertion. Playwright
  // has no `getByDisplayValue` (that's a Testing Library API) and a CSS `[value=]`
  // selector would not match either — React sets a controlled input's value as a
  // DOM property, not an HTML attribute. `getByRole` + `toHaveValue` is the
  // Playwright-native equivalent: it locates the input by its `aria-label` and
  // asserts on its live value.
  await expect(page.getByRole('textbox', { name: 'Header name' })).toHaveValue('X-From-E2E');
  // The rail's readout is computed from the same compile() the background
  // runs, so it is the popup's own claim about whether the rule is going out.
  await expect(page.getByTestId('readout')).toHaveText('1of 1 rules live');

  await page.close();
});

test('nothing in the popup is wider than what holds it, at the popup\'s own width', async ({
  context,
  extensionId,
  serviceWorker,
}) => {
  // The one assertion in this project that runs at the resolved layout level.
  // It replaces the column-template guard the five-column grid needed: that
  // design's promise was that five row shapes resolved one track list, and
  // both of its unit-level guards were text-level — cols.test.ts parsed the
  // stylesheet and HeaderGrid.test.tsx counted a DOM attribute, and jsdom
  // performs no layout, so neither could see a declaration that read
  // `var(--cols)`, was correct as written, and still resolved differently.
  //
  // This layout promises something else, so this guards something else. Its
  // claim is that the popup fits in 748px and that a value wraps instead of
  // pushing the panel sideways — the 246px value cell and its ellipsis were
  // the complaint that started the redesign, and "give it the full width" is
  // only true if the full width actually contains it. jsdom cannot see this
  // either; a real engine can.
  await serviceWorker.evaluate(async () => {
    const state = {
      version: 1,
      globalPause: false,
      theme: 'system',
      profiles: [{
        id: 'p1', name: 'Local', color: 'green', enabled: true, order: 0,
        filter: {
          mode: 'structured',
          // A long host and a port, so the rail's site row has to wrap too —
          // the rail is 224px and its rows are the narrowest thing on screen.
          domains: ['a-rather-long-subdomain.staging.example.com:8443'],
          excludedDomains: [], resourceTypes: ['xmlhttprequest'],
        },
        tabLock: { enabled: false, tabId: null, tabTitle: null },
        headers: [
          // An unbroken 600-character token: no spaces to wrap at, which is
          // what a pasted JWT actually looks like and the case that overflows
          // if `overflow-wrap` is dropped.
          { id: 'h1', enabled: true, target: 'request', operation: 'set',
            name: 'Authorization', value: `Bearer ${'e30K'.repeat(150)}` },
          // A row-level diagnostic renders a problem block inside the card,
          // which is a shape none of the other fixtures produce.
          { id: 'h2', enabled: true, target: 'response', operation: 'set',
            name: 'Bad Name', value: 'x' },
        ],
      }],
    };
    await chrome.storage.local.set({ state, state$: { v: 1 } });
  });

  const page = await context.newPage();
  // The real popup is its own window at the width the stylesheet asks for. In
  // a 1280px-wide tab every containment check below would hold trivially.
  await page.setViewportSize({ width: 748, height: 600 });
  await page.goto(`chrome-extension://${extensionId}/popup.html`);
  // The problem block is the only conditional shape here, so waiting on it
  // settles the whole popup.
  await page.locator('[data-testid="rule-problem"]').first().waitFor();

  const measured = await page.evaluate(() => {
    const elements = Array.from(document.querySelectorAll('.hl-pop *'));
    return {
      count: elements.length,
      // Half a pixel of slack: sub-pixel layout rounding is not an overflow.
      overflowing: elements
        .filter((el): el is HTMLElement => el instanceof HTMLElement)
        .filter((el) => {
          const parent = el.parentElement;
          if (!parent) return false;
          return el.getBoundingClientRect().width > parent.getBoundingClientRect().width + 0.5;
        })
        .map((el) => `${el.tagName.toLowerCase()}.${el.className}`),
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    };
  });

  // Presence first. An empty node list agrees with everything, so without this
  // a popup that failed to render at all would pass the two checks below.
  expect(measured.count, 'the popup must have rendered for its layout to mean anything')
    .toBeGreaterThan(20);
  expect(measured.overflowing, 'every element must fit inside its parent').toEqual([]);
  expect(measured.scrollWidth, 'the popup must not scroll horizontally at its own width')
    .toBe(measured.clientWidth);

  await page.close();
});
