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

  await worker.evaluate(
    async (state) => {
      // `local:state` maps to the chrome.storage.local key `state`. WXT keeps the
      // item's version alongside it at `state$`; seed both so the versioned item
      // is not read as un-versioned. See the troubleshooting note below if the
      // rule count never reaches 1.
      await chrome.storage.local.set({ state, state$: { v: 2 } });
    },
    {
      version: 2,
      globalPause: false,
      theme: 'system',
      profiles: [
        {
          id: 'p1',
          name: 'E2E',
          color: 'green',
          enabled: true,
          order: 0,
          filter: {
            mode: 'structured',
            allSites: false,
            domains: ['127.0.0.1'],
            excludedDomains: [],
            // Explicit: the DNR default excludes main_frame, which page.goto() is.
            resourceTypes: ['xmlhttprequest', 'main_frame', 'sub_frame'],
          },
          tabLock: { enabled: false, tabId: null, tabTitle: null },
          headers: [
            {
              id: 'h1',
              enabled: true,
              target: 'request',
              operation: 'set',
              name: 'X-Headerlab-Test',
              value: 'applied',
            },
            {
              id: 'h2',
              enabled: false,
              target: 'request',
              operation: 'set',
              name: 'X-Headerlab-Disabled',
              value: 'nope',
            },
          ],
        },
      ],
    },
  );

  // Wait for the storage watcher to drive reconcile to completion.
  await expect
    .poll(
      async () =>
        await worker.evaluate(() =>
          chrome.declarativeNetRequest.getDynamicRules().then((r) => r.length),
        ),
      { timeout: 10_000 },
    )
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

  await worker.evaluate(
    async (state) => {
      // `local:state` maps to the chrome.storage.local key `state`. WXT keeps the
      // item's version alongside it at `state$`; seed both so the versioned item
      // is not read as un-versioned. See the troubleshooting note below if the
      // rule count never reaches 1.
      await chrome.storage.local.set({ state, state$: { v: 2 } });
    },
    {
      version: 2,
      globalPause: false,
      theme: 'system',
      profiles: [
        {
          id: 'p1',
          name: 'E2E',
          color: 'green',
          enabled: true,
          order: 0,
          filter: {
            mode: 'structured',
            allSites: false,
            domains: ['127.0.0.1'],
            excludedDomains: [],
            resourceTypes: ['xmlhttprequest'],
          },
          tabLock: { enabled: false, tabId: null, tabTitle: null },
          headers: [
            {
              id: 'h1',
              enabled: true,
              target: 'request',
              operation: 'remove',
              name: 'X-Remove-Me',
              value: '',
            },
          ],
        },
      ],
    },
  );

  await expect
    .poll(
      async () =>
        await worker.evaluate(() =>
          chrome.declarativeNetRequest.getDynamicRules().then((r) => r.length),
        ),
      { timeout: 10_000 },
    )
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

test('the popup renders its rules from stored state', async ({
  context,
  extensionId,
  serviceWorker,
}) => {
  await serviceWorker.evaluate(async () => {
    const state = {
      version: 2,
      globalPause: false,
      theme: 'system',
      profiles: [
        {
          id: 'p1',
          name: 'Local',
          color: 'green',
          enabled: true,
          order: 0,
          filter: {
            mode: 'structured',
            allSites: false,
            domains: ['api.example.com'],
            excludedDomains: [],
            resourceTypes: ['xmlhttprequest'],
          },
          tabLock: { enabled: false, tabId: null, tabTitle: null },
          headers: [
            {
              id: 'h1',
              enabled: true,
              target: 'request',
              operation: 'set',
              name: 'X-From-E2E',
              value: 'yes',
            },
          ],
        },
      ],
    };
    // `local:state` maps to the chrome.storage.local key `state`. WXT keeps the
    // version in a companion key.
    await chrome.storage.local.set({ state, state$: { v: 2 } });
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

test("nothing in the popup is wider than what holds it, at the popup's own width", async ({
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
      version: 2,
      globalPause: false,
      theme: 'system',
      profiles: [
        {
          id: 'p1',
          name: 'Local',
          color: 'green',
          enabled: true,
          order: 0,
          filter: {
            mode: 'structured',
            allSites: false,
            // A long host with a port, so the rail's site row and its
            // permission message both have to wrap — the rail is 224px and its
            // rows are the narrowest thing on screen. **No hyphens**: browsers
            // already break after a hyphen, so a hyphenated host would wrap on
            // its own and this fixture would prove nothing about the rules that
            // make an unbreakable run wrap.
            domains: ['averylongsubdomainlabelwithnobreaks.staging.example.com:8443'],
            excludedDomains: [],
            // All eight offered types checked, not just one: TypeChecklist renders a
            // checked label semibold, and the worst case for the two-column grid's
            // width is every label at that weight at once — not merely the one this
            // fixture happened to pick before. `stylesheet` (10 characters) is the
            // longest label offered and only renders semibold when it is checked.
            resourceTypes: [
              'main_frame',
              'sub_frame',
              'xmlhttprequest',
              'script',
              'stylesheet',
              'image',
              'font',
              'media',
            ],
          },
          tabLock: { enabled: false, tabId: null, tabTitle: null },
          headers: [
            // An unbroken 600-character token: no spaces to wrap at, which is
            // what a pasted JWT actually looks like and the case that overflows
            // if `overflow-wrap` is dropped.
            {
              id: 'h1',
              enabled: true,
              target: 'request',
              operation: 'set',
              name: 'Authorization',
              value: `Bearer ${'e30K'.repeat(150)}`,
            },
            // A row-level diagnostic renders a problem block inside the card,
            // which is a shape none of the other fixtures produce.
            {
              id: 'h2',
              enabled: true,
              target: 'response',
              operation: 'set',
              name: 'Bad Name',
              value: 'x',
            },
          ],
        },
      ],
    };
    await chrome.storage.local.set({ state, state$: { v: 2 } });
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
    const elements = Array.from(document.querySelectorAll('[data-testid="popup-root"] *'));
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
  expect(
    measured.count,
    'the popup must have rendered for its layout to mean anything',
  ).toBeGreaterThan(20);
  expect(measured.overflowing, 'every element must fit inside its parent').toEqual([]);
  expect(measured.scrollWidth, 'the popup must not scroll horizontally at its own width').toBe(
    measured.clientWidth,
  );

  await page.close();
});

/**
 * Boxes for the rail elements that sit *below* something state-dependent, keyed
 * so the same name means the same box across two renders.
 *
 * `[data-testid="site"]` is in here as well as the anchors under it: the Grant
 * button lands inside the row, so the row's own height is the first thing that
 * must not change, and an assertion that only watched what came after it would
 * pass a row that grew while everything below happened to be pushed off-screen.
 *
 * `[data-testid="all-sites-state"]` is the one probe here for a *sideways*
 * move. That dot used to render only once its state was known, so "All sites"
 * slid 14px right the moment the mode came on — nothing below it moved, and
 * every vertical anchor in this list would have agreed that nothing happened.
 * It is probed rather than the label beside it because the label is a
 * `flex: 1` spacer: its width follows whatever shares the bar with it while
 * its text stays put at the same x, so pinning all four of its numbers would
 * fail on a change that moves nothing on screen.
 *
 * Every anchor here is a `data-testid`, not a `.hl-*` class: the class names
 * these boxes used to key on are the styling this popup's design-system
 * migration is about to rewrite, and a testid is a contract this suite owns
 * rather than a side effect of how the box happens to be styled today.
 */
const RAIL_BOXES = [
  '[data-testid="readout"]',
  '[data-testid="runstate"]',
  '[data-testid="all-sites"]',
  '[data-testid="all-sites-state"]',
  '[data-testid="site"]',
  '[data-testid="add-field"]',
  '[data-testid="rail-section-types"]',
  '[data-testid="type-grid"]',
] as const;

test('a control appearing in the rail does not move anything', async ({
  context,
  extensionId,
  serviceWorker,
}) => {
  // The owner found this by using the build: the Grant button appeared, the row
  // it sits in got taller, and everything below shifted down. jsdom performs no
  // layout, so no unit test can see it — this is the level where a box has a
  // height at all.
  //
  // What is asserted is that a box's geometry is *unchanged* across a state
  // transition, measured with the control absent and again with it present.
  // Asserting that Grant exists, or that some height is non-zero, would pass
  // against the build that had the defect.
  await serviceWorker.evaluate(async () => {
    const state = {
      version: 2,
      globalPause: false,
      theme: 'system',
      profiles: [
        {
          id: 'p1',
          name: 'Local',
          color: 'green',
          enabled: true,
          order: 0,
          filter: {
            mode: 'structured',
            allSites: false,
            // Never granted in a fresh profile, and the e2e build's only host
            // permission is the loopback echo server — so this row opens pending,
            // with the Grant button that started all this.
            domains: ['api.example.com'],
            excludedDomains: [],
            resourceTypes: ['xmlhttprequest'],
          },
          tabLock: { enabled: false, tabId: null, tabTitle: null },
          headers: [
            {
              id: 'h1',
              enabled: true,
              target: 'request',
              operation: 'set',
              name: 'X-Reflow',
              value: 'yes',
            },
          ],
        },
      ],
    };
    await chrome.storage.local.set({ state, state$: { v: 2 } });
  });

  const page = await context.newPage();
  await page.setViewportSize({ width: 748, height: 600 });
  await page.goto(`chrome-extension://${extensionId}/popup.html`);
  await page.getByTestId('site-pending').waitFor();

  const boxes = () =>
    page.evaluate(
      (selectors) => {
        const out: Record<string, number[]> = {};
        for (const selector of selectors) {
          const el = document.querySelector(selector);
          // Recorded as a miss rather than skipped. A selector that stopped
          // matching would otherwise drop out of both sides of the comparison and
          // take its guarantee with it, silently.
          if (!el) {
            out[selector] = [];
            continue;
          }
          const r = el.getBoundingClientRect();
          out[selector] = [r.x, r.y, r.width, r.height].map((v) => Math.round(v * 100) / 100);
        }
        return out;
      },
      RAIL_BOXES as unknown as string[],
    );

  const allSites = page.getByRole('switch', { name: 'Apply to every site' });
  const grant = page.getByTestId('site-pending');
  const subcount = page.locator('[data-testid="subcount"]');

  // Every probe must resolve to a real box before any of them can mean
  // anything: `toEqual` between two records of empty arrays is a comparison
  // that cannot fail.
  const withGrant = await boxes();
  expect(
    Object.values(withGrant).filter((b) => b.length !== 4),
    'every probe must match an element',
  ).toEqual([]);

  // --- the Grant button vacating its row ---
  // All-sites mode makes this row idle, and an idle row offers no Grant — one
  // click, and the button is genuinely gone rather than merely faded.
  await allSites.click();
  await expect(grant).toHaveCount(0);
  expect(await page.getByTestId('site').getAttribute('data-state')).toBe('idle');
  expect(await boxes(), 'the Grant button leaving must move nothing').toEqual(withGrant);

  // …and back, so a layout that had simply frozen at the first measurement
  // cannot pass. This direction is the one the owner saw.
  await allSites.click();
  await expect(grant).toHaveCount(1);
  expect(await boxes(), 'the Grant button arriving must move nothing').toEqual(withGrant);

  // --- the readout's second line arriving ---
  // Switching the only rule off puts "1 off" under the big number. That line
  // sits above the whole rail, so before this guard it moved the pause bar, the
  // all-sites switch, the site row and the request types 22.1px at once — from
  // a click on the other side of the popup.
  await expect(subcount).toHaveText('');
  await page.getByRole('switch', { name: 'X-Reflow enabled' }).click();
  await expect(subcount).toHaveText('1 off');
  expect(await boxes(), 'the subcount arriving must move nothing').toEqual(withGrant);

  // --- the help bubble opening ---
  // It is absolutely positioned and so already took no space; asserted because
  // "already correct" is not the same as "guarded", and a later change to its
  // positioning would put 82.9px into the flow of the sites section.
  const bubble = page.getByTestId('help-bubble');
  await expect(bubble).toHaveCount(0);
  await page.getByRole('button', { name: 'About matching sites' }).hover();
  await expect(bubble).toHaveCount(1);
  expect(await boxes(), 'the help bubble opening must move nothing').toEqual(withGrant);

  await page.close();
});

/**
 * 시안 다섯 개 중 다섯 개가 정확히 이것에 실패했다. 전부 고정 높이 +
 * overflow: hidden 이라 사이트나 규칙이 하나 늘면 스크롤바도 표시도 없이
 * 사라졌다. 한 시안은 Grant 버튼이 그걸 위해 마련한 바로 그 띠에 7px 잘렸다.
 *
 * 그래서 목록만 스크롤되고, 그 위아래 모든 것은 평상 상태와 같은 좌표에
 * 있어야 한다. 좌표를 재는 이유는 "보인다"는 약한 단언이기 때문이다 —
 * 8px 밀린 것도 보이기는 한다.
 */
test('목록이 넘쳐도 잘리지 않고, 주변은 움직이지 않는다', async ({
  context,
  extensionId,
  serviceWorker,
}) => {
  const boxes = async (page: import('@playwright/test').Page) => {
    const out: Record<string, { x: number; y: number }> = {};
    for (const id of ['readout', 'runstate', 'rail-section-types', 'type-grid']) {
      const b = await page.locator(`[data-testid="${id}"]`).first().boundingBox();
      out[id] = { x: Math.round(b!.x), y: Math.round(b!.y) };
    }
    return out;
  };

  const seed = async (sites: string[], rules: number) => {
    await serviceWorker.evaluate(
      async ({ sites, rules }) => {
        await chrome.storage.local.set({
          state: {
            version: 2,
            globalPause: false,
            theme: 'system',
            profiles: [
              {
                id: 'p',
                name: 'Default',
                color: 'green',
                enabled: true,
                order: 0,
                filter: {
                  mode: 'structured',
                  allSites: false,
                  domains: sites,
                  excludedDomains: [],
                  resourceTypes: ['xmlhttprequest', 'main_frame', 'sub_frame'],
                },
                tabLock: { enabled: false, tabId: null, tabTitle: null },
                headers: Array.from({ length: rules }, (_, i) => ({
                  id: `h${i}`,
                  enabled: i % 5 !== 0,
                  target: 'request',
                  operation: 'set',
                  name: `X-Header-${i}`,
                  value: `value-${i}`,
                })),
              },
            ],
          },
          state$: { v: 2 },
        });
      },
      { sites, rules },
    );
  };

  // 평상 상태의 좌표를 먼저 잡는다.
  await seed(['api.example.com', 'staging.example.com'], 4);
  const nominal = await context.newPage();
  await nominal.setViewportSize({ width: 748, height: 600 });
  await nominal.goto(`chrome-extension://${extensionId}/popup.html`);
  await nominal.locator('[data-testid="readout"]').waitFor();
  const before = await boxes(nominal);
  await nominal.close();

  // 과밀 상태.
  await seed(
    [
      'api.example.com',
      'staging.example.com',
      'internal.example.com',
      'cdn.example.com',
      'auth.example.com',
      'metrics.example.com',
      'a.example.com',
      'a-very-long-subdomain.staging.example.com',
    ],
    10,
  );
  const page = await context.newPage();
  await page.setViewportSize({ width: 748, height: 600 });
  await page.goto(`chrome-extension://${extensionId}/popup.html`);
  await page.locator('[data-testid="site"]').first().waitFor();

  // 1. 목록 밖 어떤 노드도 — 스크롤 컨테이너 자신을 뺀 나머지 — 자기 박스를
  //    넘지 않는다. `auto` 만 스크롤 컨테이너로 인정하면 `overflow-y: scroll`
  //    로 지은 올바른 구현이 "클리핑"으로 오판된다 — 둘 다 인정한다.
  const clipped = await page.evaluate(() => {
    // 실패했을 때 무엇을 가리키는지 알 수 있는 이름. testid 가 없는 노드는
    // 태그 + 클래스 + 가장 가까운 testid 조상으로 대신한다 — 어느 분기도 빈
    // 문자열을 낳지 않는다. className 은 SVG 에서 문자열이 아니라
    // SVGAnimatedString 이라 그 경우만 `.baseVal` 을 읽는다.
    const identify = (el: Element): string => {
      const tag = el.tagName.toLowerCase();
      const raw = (el as { className: unknown }).className;
      const cls = typeof raw === 'string' ? raw : ((raw as { baseVal?: string })?.baseVal ?? '');
      const ancestor = el.closest('[data-testid]')?.getAttribute('data-testid') ?? '(none)';
      return `${tag}${cls ? `.${cls.trim().split(/\s+/).join('.')}` : ''} in [data-testid=${ancestor}]`;
    };
    const scrollers = new Set(
      [...document.querySelectorAll<HTMLElement>('*')].filter((el) =>
        ['auto', 'scroll'].includes(getComputedStyle(el).overflowY),
      ),
    );
    return [...document.querySelectorAll<HTMLElement>('[data-testid="popup-root"] *')]
      .filter((el) => !scrollers.has(el))
      .filter((el) => el.scrollHeight > el.clientHeight + 1)
      .map(identify);
  });
  expect(clipped).toEqual([]);

  // 2. 스크롤되는 것은 정확히 두 목록 컨테이너 — site-list, rule-list —
  //    뿐이다. "몇 개가 스크롤되는가"는 오늘의 UI(레일 전체를 감싸는
  //    `.hl-rail`, 카드 전체를 감싸는 `.hl-stack`)에서도 우연히 2가 나와
  //    실패할 수 없는 단언이었다. "무엇이 스크롤되는가"로 물으면 두 testid가
  //    아직 없다는 사실 자체가 진단 가능한 이유로 실패한다.
  const scrollers = await page.evaluate(() => {
    const identify = (el: Element): string => {
      const testid = el.getAttribute('data-testid');
      if (testid) return testid;
      const tag = el.tagName.toLowerCase();
      const raw = (el as { className: unknown }).className;
      const cls = typeof raw === 'string' ? raw : ((raw as { baseVal?: string })?.baseVal ?? '');
      return `${tag}${cls ? `.${cls.trim().split(/\s+/).join('.')}` : ''}`;
    };
    return [...document.querySelectorAll<HTMLElement>('*')]
      .filter(
        (el) =>
          ['auto', 'scroll'].includes(getComputedStyle(el).overflowY) &&
          el.scrollHeight > el.clientHeight,
      )
      .map(identify)
      .sort();
  });
  expect(scrollers).toEqual(['rule-list', 'site-list']);

  // 3. 목록 위아래는 평상 상태와 같은 좌표에 있다.
  expect(await boxes(page)).toEqual(before);

  await page.close();
});
