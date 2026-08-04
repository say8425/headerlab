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

test('the popup renders the grid from stored state', async ({ context, extensionId, serviceWorker }) => {
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
  await expect(page.getByText('1 of 1 applying').first()).toBeVisible();

  await page.close();
});

/** The five row-shaped selectors design §3.1 says `--cols` drives. */
const ROW_SHAPED = ['.hl-ghead', '.hl-grp', '.hl-row', '.hl-subrow', '.hl-addrow'] as const;

test('every row-shaped element resolves the same column template', async ({
  context,
  extensionId,
  serviceWorker,
}) => {
  // The guards for this in tests/unit are both text-level: cols.test.ts parses
  // the stylesheet and HeaderGrid.test.tsx counts a DOM attribute, and jsdom
  // performs no layout. Neither can see a declaration that reads `var(--cols)`,
  // is correct as written, and still resolves to a different track list — which
  // is what `.hl-addrow` did: as a <button> Chrome sized it shrink-to-fit, so
  // its `1fr` value track resolved to 0 and the row stopped 246px short of
  // every other one, breaking the value column's tint at exactly the seam the
  // shared template exists to close. Resolved layout is only observable in a
  // real engine, so the assertion lives here.
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
          { id: 'h1', enabled: true, target: 'request', operation: 'set', name: 'X-Valid', value: 'yes' },
          // The space makes this name invalid, and validateHeaders() reports
          // that against `headerRuleId` — a *row-level* diagnostic, which is
          // the only thing that renders `.hl-subrow`. The other fixtures in
          // this file produce profile-level diagnostics only, so on any of
          // them the sub-row would simply be absent and every comparison
          // below would hold vacuously.
          { id: 'h2', enabled: true, target: 'request', operation: 'set', name: 'Bad Name', value: 'x' },
          // Both groups need a row so the response half is laid out too.
          { id: 'h3', enabled: true, target: 'response', operation: 'set', name: 'X-Res', value: 'yes' },
        ],
      }],
    };
    await chrome.storage.local.set({ state, state$: { v: 1 } });
  });

  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/popup.html`);
  // The grid renders from storage asynchronously. The sub-row is the only
  // conditional shape of the five, so waiting on it settles the whole grid.
  await page.locator('.hl-subrow').first().waitFor();

  // Per selector: how many instances are on the page, and the *distinct*
  // values they resolve. Distinct rather than just the first, because there
  // are two `.hl-grp` and two `.hl-addrow` — reading only the first would let
  // one of a pair drift unseen.
  const measured = await page.evaluate((selectors: readonly string[]) =>
    selectors.map((selector) => {
      const elements = Array.from(document.querySelectorAll(selector));
      return {
        selector,
        count: elements.length,
        templates: [...new Set(elements.map((el) => getComputedStyle(el).gridTemplateColumns))],
        widths: [...new Set(elements.map((el) => Math.round(el.getBoundingClientRect().width * 100) / 100))],
      };
    }), ROW_SHAPED);

  // Presence first, by name. A selector that matches nothing resolves an empty
  // list, and an empty list agrees with everything — so without this, deleting
  // a row shape or breaking the fixture above would turn the comparisons into
  // assertions that cannot fail.
  for (const { selector, count } of measured) {
    expect(count, `${selector} must be on the page for its template to mean anything`)
      .toBeGreaterThan(0);
  }

  // Compared against `.hl-row`'s resolved value, not pinned to a literal like
  // `38px 64px 186px 246px 26px`. What design §3.1 promises is that the five
  // shapes agree, not that they agree on any particular number: a literal
  // would fire on every deliberate column-width change while still passing if
  // all five drifted together — a width tripwire instead of an alignment
  // guard. The popup is a fixed 560px today, which is exactly why hardcoding
  // would look safe and be wrong.
  const reference = measured.find((m) => m.selector === '.hl-row');
  expect(reference?.templates, '.hl-row resolves exactly one template').toHaveLength(1);
  expect(reference?.widths, '.hl-row resolves exactly one width').toHaveLength(1);

  for (const { selector, templates, widths } of measured) {
    expect(templates, `${selector} resolves the same column template as .hl-row`)
      .toEqual(reference?.templates);
    // The template alone would miss a row that carries the right track list at
    // the wrong size — tracks that no longer sum to the row's width overflow it
    // instead of resolving short. Width is the symptom you actually see.
    expect(widths, `${selector} spans the same width as .hl-row`).toEqual(reference?.widths);
  }

  await page.close();
});
