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
  storage: {
    local: { set(items: Record<string, unknown>): Promise<void> };
    session: { get(key: string): Promise<Record<string, unknown>> };
  };
  declarativeNetRequest: {
    getDynamicRules(): Promise<
      Array<{
        id: number;
        action: {
          requestHeaders?: Array<{ header: string; operation: string; value?: string }>;
          responseHeaders?: Array<{ header: string; operation: string; value?: string }>;
        };
      }>
    >;
  };
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

test('a row Chrome would refuse never reaches declarativeNetRequest, and its sibling still does', async ({
  serviceWorker,
}) => {
  // Task 12's real bug. `append` on a request header outside Chrome's
  // 21-header allowlist (lib/compile/validate.ts's APPEND_ALLOWED_REQUEST_
  // HEADERS) is diagnosed on screen — but until this fix, compile.ts sent
  // the same row to Chrome anyway, and `updateDynamicRules` is
  // transactional: Chrome rejects the *whole batch*, `lastError` fills in
  // with `ERROR_APPEND_INVALID_REQUEST_HEADER`, and whatever was registered
  // before the rejected write stays in force — a divergence between what
  // the screen claims and what is actually being enforced, unstated.
  //
  // Two headers in one profile rather than one, deliberately: a single bad
  // row compiling to zero rules is indistinguishable from reconcile simply
  // not having run yet, which would make this test pass green for the
  // wrong reason even on the unfixed code. Waiting for the *good* sibling's
  // rule to actually appear is a real settling signal — it can only be
  // true after a real reconcile pass — and then the same rule's own
  // `requestHeaders` is the direct, positive check that the bad row never
  // reached the wire, not merely that nothing did.
  const worker = serviceWorker;

  await worker.evaluate(
    async (state) => {
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
            // e2e's the only pre-granted host — see the other tests in this
            // file for why domain-caused suppression is not what this test
            // is about.
            domains: ['127.0.0.1'],
            excludedDomains: [],
            resourceTypes: ['xmlhttprequest', 'main_frame', 'sub_frame'],
          },
          tabLock: { enabled: false, tabId: null, tabTitle: null },
          headers: [
            {
              id: 'bad',
              enabled: true,
              target: 'request',
              operation: 'append',
              name: 'X-Custom-Header',
              value: 'x',
            },
            {
              id: 'good',
              enabled: true,
              target: 'request',
              operation: 'set',
              name: 'X-Headerlab-Ok',
              value: 'yes',
            },
          ],
        },
      ],
    },
  );

  // The good row's rule really did register — the settling signal. Waited
  // for as a plain length first (a robust, simple predicate for `poll`);
  // the exact shape is asserted separately below, once, rather than inside
  // the polled predicate.
  await expect
    .poll(
      async () =>
        await worker.evaluate(() =>
          chrome.declarativeNetRequest.getDynamicRules().then((r) => r.length),
        ),
      { timeout: 10_000 },
    )
    .toBe(1);

  const rules = await worker.evaluate(() => chrome.declarativeNetRequest.getDynamicRules());
  // The direct, positive check: the one rule that did register carries only
  // the good header. The bad row is not merely "not causing an error" —
  // it never reached `declarativeNetRequest` at all.
  expect(rules[0]!.action.requestHeaders).toEqual([
    { header: 'X-Headerlab-Ok', operation: 'set', value: 'yes' },
  ]);
  expect(rules[0]!.action.responseHeaders).toBeUndefined();

  const syncStatus = await worker.evaluate(() =>
    chrome.storage.session.get('syncStatus').then((r) => r.syncStatus),
  );
  expect(syncStatus).toMatchObject({ lastError: null });
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

test("a rule row's gutter chips match size, and the row keeps its own height when toggled off without moving its neighbours", async ({
  context,
  extensionId,
  serviceWorker,
}) => {
  // Two unrelated real-box claims share this test and its one loaded popup
  // rather than each paying for its own page load — both are things jsdom
  // cannot see (it performs no layout) and both are asserted against real
  // `getBoundingClientRect()` boxes rather than inferred from the classes
  // that are supposed to produce them:
  //
  // 1. The gutter's badge and chip (Task 11) are the same size — checked
  //    first, below, before anything else touches the page.
  // 2. RuleCard.tsx's row is no longer a fixed 52px — the owner ruled that a
  //    rule's value must wrap and grow rather than truncate, so different
  //    *rules* can be different heights. What must still hold, narrower and
  //    unchanged by that ruling: a *given* rule's own row must not change
  //    height from being toggled on/off.
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
            allSites: true,
            domains: [],
            excludedDomains: [],
            resourceTypes: ['xmlhttprequest'],
          },
          tabLock: { enabled: false, tabId: null, tabTitle: null },
          headers: [
            {
              id: 'long',
              enabled: true,
              target: 'request',
              operation: 'set',
              name: 'Authorization',
              // Long enough to wrap across several lines at the panel's real
              // width, and unbroken enough (no spaces) to exercise
              // `overflow-wrap: anywhere` rather than wrapping at word
              // boundaries alone — the shape of a real bearer token.
              value:
                'Bearer dev-eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyLCJyb2xlcyI6WyJhZG1pbiIsInFhIiwic3RhZ2luZy1kZWJ1ZyJdfQ.dummysignature-not-real-do-not-use',
            },
            {
              id: 'short',
              enabled: true,
              target: 'response',
              operation: 'set',
              name: 'X-Short',
              value: 'ok',
            },
          ],
        },
      ],
    };
    await chrome.storage.local.set({ state, state$: { v: 2 } });
  });

  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/popup.html`);
  await page.locator('[data-testid="rule"]').first().waitFor();

  // The operation chip must be exactly the same size as the direction badge
  // it stacks under (Task 11) — "칩 높이를 REQ/RES 배지와 같게(18px)" was the
  // owner's explicit addendum to the gutter-stack decision, and the brief
  // gave both dimensions as `h-[18px] w-12`, identical to the badge's own.
  // Compared against the badge's own measured box, not literal 18/48
  // pixels, so this survives a deliberate future resize of the badge and
  // only fails when the two actually disagree with each other — which is
  // the real requirement. A mutation dropping the chip's `h-[18px]` (found
  // in review — nothing else in the suite caught it) fails this with
  // `{ height: 2, width: 0, fontWeight: 0, letterSpacing: 0 }`.
  //
  // Task 12 item 3 also put the chip's weight and tracking in lockstep with
  // the badge's (`font-semibold tracking-[0.01em]` on both — the two were
  // already the same font-size; weight and tracking were the actual gap
  // that read as a size difference). `fontWeight`/`letterSpacing` are
  // compared the same way as the box, by diff against the badge's own
  // computed value rather than a literal, so this fails if either drifts
  // from the other again rather than only if both drift from one recorded
  // number.
  const chipMatch = await page.evaluate(() => {
    const row = document.querySelector('[data-testid="rule"]')!;
    const badgeEl = row.querySelector('[aria-label^="Direction"]')!;
    const chipEl = row.querySelector('[aria-label^="Operation"]')!;
    const badge = badgeEl.getBoundingClientRect();
    const chip = chipEl.getBoundingClientRect();
    const badgeStyle = getComputedStyle(badgeEl);
    const chipStyle = getComputedStyle(chipEl);
    return {
      height: chip.height - badge.height,
      width: chip.width - badge.width,
      fontWeight: Number(chipStyle.fontWeight) - Number(badgeStyle.fontWeight),
      letterSpacing: parseFloat(chipStyle.letterSpacing) - parseFloat(badgeStyle.letterSpacing),
    };
  });
  expect(chipMatch).toEqual({ height: 0, width: 0, fontWeight: 0, letterSpacing: 0 });

  const rows = page.locator('[data-testid="rule"]');
  const longRow = rows.first();
  const shortRow = rows.nth(1);

  const before = {
    long: await longRow.boundingBox(),
    short: await shortRow.boundingBox(),
  };

  // The long value really did wrap onto more than one line — otherwise the
  // equality assertions below would pass trivially for an ordinary
  // single-line row, and this test would not be testing what it claims to.
  expect(before.long!.height).toBeGreaterThan(before.short!.height * 1.5);

  await longRow.getByRole('switch').click();
  // `data-off` becoming "true" is the popup's own claim that the click
  // landed and this is the row it landed on, before trusting a box
  // measurement taken immediately after.
  await expect(longRow).toHaveAttribute('data-off', 'true');

  const after = {
    long: await longRow.boundingBox(),
    short: await shortRow.boundingBox(),
  };

  // Whole-box equality, not just height: toggling must not move the row
  // either, and must not move its untouched sibling below it.
  expect(after.long).toEqual(before.long);
  expect(after.short).toEqual(before.short);

  await page.close();
});

test('the fused direction badge and operation chip each keep a keyboard focus ring that reaches the screen', async ({
  context,
  extensionId,
  serviceWorker,
}) => {
  // Regression guard for a WCAG 2.4.7 failure (Task 12 fix round). The
  // wrapper that fuses the direction badge to the operation chip into one
  // rounded block used to carry `overflow-hidden` to give the pair its
  // shared outer corners — and a focus ring is drawn *outside* its
  // element's border box, with each half exactly as wide as that wrapper,
  // so the wrapper clipped the ring on every side. A real Tab press before
  // the fix: the direction half rendered nothing at all, the operation half
  // rendered a single bar at the seam that read as a divider between two
  // rows rather than a ring around one control.
  //
  // The fix moved each half's own outer corner onto itself
  // (`rounded-t-[4px]`/`rounded-b-[4px]`) so the wrapper no longer needs to
  // clip anything. This guards the actual claim — the ring reaches the
  // screen unclipped — by walking every ancestor above the focused button,
  // not only the immediate one: a re-review's mutation proved the gap by
  // leaving that immediate wrapper clean and adding a *second*,
  // overflow-hidden wrapper one level further out. The first version of
  // this guard passed against that mutation (it only ever asked the
  // immediate parent), while a real screenshot showed the ring gone
  // entirely. The rewritten version finds the first ancestor whose computed
  // overflow is not `visible` on either axis — wherever that is — and
  // checks that the ring's own box (the element's border box, expanded by
  // its outline width and offset) still fits inside it. A `rounded-none`
  // sibling with the right width but a clip two levels up now fails this
  // the same way a clip one level up does.
  //
  // Covers the real-keyboard path only (`page.keyboard.press('Tab')`, the
  // same path every other focus-order assumption in this file relies on).
  // An earlier round of this comment called the ring's origin an open
  // question — different-looking readings depending on how focus arrived.
  // It has since been established (see RuleCard.tsx's own comment on the
  // gutter): one rule, style.css's `:focus-visible`, and `badgeVariants`'
  // `transition-all` meant an early reading caught the transition's start
  // values rather than its settled ones. What this guard still does not
  // pin is a programmatic `.focus()` at the exact first frame, which is a
  // timing question about *when* to read a transitioning value rather than
  // *which* rule supplies it — not the concern this guard exists for.
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
              name: 'X-Trace',
              value: 'v',
            },
          ],
        },
      ],
    };
    await chrome.storage.local.set({ state, state$: { v: 2 } });
  });

  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/popup.html`);
  await page.locator('[data-testid="rule"]').first().waitFor();

  const measureFocused = () =>
    page.evaluate(() => {
      const el = document.activeElement as HTMLElement;
      const cs = getComputedStyle(el);
      const elRect = el.getBoundingClientRect();
      const outlineWidth = parseFloat(cs.outlineWidth) || 0;
      const outlineOffset = parseFloat(cs.outlineOffset) || 0;
      // How far the ring extends beyond the border box, per side. A
      // negative offset draws inward — clamped at 0 so that case can never
      // report a phantom overflow of its own.
      const extent = Math.max(outlineWidth + outlineOffset, 0);
      const ring = {
        left: elRect.left - extent,
        top: elRect.top - extent,
        right: elRect.right + extent,
        bottom: elRect.bottom + extent,
      };

      // Walk every ancestor, not just the immediate one. The first one
      // whose computed overflow is not `visible` on either axis is the one
      // that actually clips; anything below it in the tree passes the ring
      // through untouched, so it does not matter how many clean wrappers
      // sit between the button and that ancestor.
      let clipper: HTMLElement | null = el.parentElement;
      while (clipper) {
        const ov = getComputedStyle(clipper);
        if (ov.overflowX !== 'visible' || ov.overflowY !== 'visible') break;
        clipper = clipper.parentElement;
      }
      const clipperRect = clipper?.getBoundingClientRect() ?? null;
      const ringFitsInsideClipper =
        !clipperRect ||
        (ring.left >= clipperRect.left - 0.5 &&
          ring.top >= clipperRect.top - 0.5 &&
          ring.right <= clipperRect.right + 0.5 &&
          ring.bottom <= clipperRect.bottom + 0.5);

      return {
        ariaLabel: el.getAttribute('aria-label'),
        outlineStyle: cs.outlineStyle,
        outlineWidth,
        clipperTestId: clipper?.getAttribute('data-testid') ?? null,
        ringFitsInsideClipper,
      };
    });

  await page.getByRole('button', { name: 'New rule', exact: true }).focus();
  await page.keyboard.press('Tab'); // -> the row's switch
  await page.keyboard.press('Tab'); // -> the direction badge

  const direction = await measureFocused();
  expect(direction.ariaLabel).toBe('Direction: request');
  expect(direction.outlineStyle).toBe('solid');
  expect(direction.outlineWidth).toBeGreaterThan(0);
  expect(
    direction.ringFitsInsideClipper,
    `the ring must not be clipped by any ancestor (nearest clipper: ${direction.clipperTestId})`,
  ).toBe(true);

  await page.keyboard.press('Tab'); // -> the operation chip

  const operation = await measureFocused();
  expect(operation.ariaLabel).toBe('Operation: set');
  expect(operation.outlineStyle).toBe('solid');
  expect(operation.outlineWidth).toBeGreaterThan(0);
  expect(
    operation.ringFitsInsideClipper,
    `the ring must not be clipped by any ancestor (nearest clipper: ${operation.clipperTestId})`,
  ).toBe(true);

  await page.close();
});

test("an error diagnostic replacing a rule row's value never resizes the row or moves the rows below it", async ({
  context,
  extensionId,
  serviceWorker,
}) => {
  // Task 13. The owner found switching a row to `append` made a diagnostic
  // block appear below it, pushing every row after it down by 48.8px —
  // almost exactly one row height (block 42.8px). CLAUDE.md's Interface
  // section already forbade this in as many words ("a control appearing
  // must not resize what holds it… applies to any element whose presence is
  // state-dependent") — the rail already had a guard for its own version of
  // this defect (`'a control appearing in the rail does not move
  // anything'`, below); the rule panel's diagnostic never had one.
  //
  // The fix moved an `error`-severity diagnostic into line 2, the value
  // slot the row already reserves, in place of the value it replaces rather
  // than beside or below it — see RuleCard.tsx's own docblock. This is the
  // geometric half of that claim, measured the same way the rail's guard
  // measures its own: a box's coordinates, compared before and after a real
  // state transition, not read off a class name.
  //
  // Only the `error` path is guarded here. The `warning` path (a marker
  // beside the header name, for `profile-conflict`) is not — see the
  // comment at the bottom of this test for why that is not an omission.
  //
  // `target`'s value is long enough to wrap onto more than one line — a
  // re-review found the first version of this guard used a one-character
  // value, so the pre-fix implementation (which shrank a wrapping value's
  // whole box down to the error message's single line, the exact reflow
  // this task exists to remove) passed by accident: a one-line textarea and
  // a one-line error span are the same height regardless of which one is
  // wrong. `before.rows[0]` below is the taller box that produces; every
  // later comparison against it is only a real claim because of that.
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
            allSites: true,
            domains: [],
            excludedDomains: [],
            resourceTypes: ['xmlhttprequest'],
          },
          tabLock: { enabled: false, tabId: null, tabTitle: null },
          headers: [
            // Not on Chrome's request-append allowlist (lib/compile/validate.ts),
            // so cycling this row to `append` raises `append-not-allowed` —
            // the same real error the compile-bug guard above this one uses,
            // reused here for the same reason: a defect this codebase has
            // already measured rather than an invented one. The value itself
            // is the same realistic, unbroken bearer token the gutter-chip
            // guard above uses to force a real wrap — reused rather than
            // invented so both guards are exercising the same known-wrapping
            // shape rather than two different guesses at "long enough."
            {
              id: 'target',
              enabled: true,
              target: 'request',
              operation: 'set',
              name: 'X-Custom-Trace',
              value:
                'Bearer dev-eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyLCJyb2xlcyI6WyJhZG1pbiIsInFhIiwic3RhZ2luZy1kZWJ1ZyJdfQ.dummysignature-not-real-do-not-use',
            },
            // The fixed reference row. Never touched — only its position is
            // asserted, which is what makes it a neighbour rather than a
            // second subject.
            {
              id: 'below',
              enabled: true,
              target: 'request',
              operation: 'set',
              name: 'X-Below',
              value: 'y',
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
  await page.locator('[data-testid="rule"]').first().waitFor();

  const boxes = () =>
    page.evaluate(() => {
      const round = (r: DOMRect) =>
        [r.x, r.y, r.width, r.height].map((v) => Math.round(v * 100) / 100);
      const rows = [...document.querySelectorAll('[data-testid="rule"]')].map((el) =>
        round(el.getBoundingClientRect()),
      );
      const ghost = document.querySelector('[aria-label="New rule at end"]');
      return { rows, ghost: ghost ? round(ghost.getBoundingClientRect()) : null };
    });

  const target = page.locator('[data-testid="rule"]').first();
  const opButton = target.getByRole('button', { name: /Operation/ });

  const before = await boxes();
  // Presence first, same reasoning as every other box-comparison guard in
  // this file: an empty pair of arrays would agree with anything.
  expect(before.rows, 'both seeded rows must have rendered').toHaveLength(2);
  expect(before.ghost, 'the ghost row must have rendered').not.toBeNull();
  // The target row really did wrap onto more than one line — otherwise
  // every equality assertion below would pass trivially, the exact gap a
  // re-review found in this test's first version. `52` is a real row's
  // known single-line floor (asserted directly elsewhere in this file);
  // comparing against `below`'s own height is what makes this a claim
  // about *this* fixture rather than a literal that could quietly stop
  // being true.
  expect(before.rows[0]![3], 'the seeded value must actually wrap').toBeGreaterThan(
    before.rows[1]![3]!,
  );
  expect(
    await target.getByTestId('rule-value').count(),
    'the target row starts with a real value field, not an error',
  ).toBe(1);

  // Rename to an invalid name (a space) -> invalid-header-name. Deliberately
  // *not* `opButton.click()` all the way to `remove` and back, which this
  // test's own first version did: `remove` never shows a wrapping value —
  // it is a single-line sentence regardless of error state — so cycling
  // through it changes this row's height for a reason that has nothing to
  // do with a diagnostic, and nothing this file promises (CLAUDE.md's own
  // invariant names on/off and a diagnostic appearing, not an operation
  // change). Renaming keeps the operation at `set` throughout, so the only
  // thing moving is the diagnostic — the actual claim under test.
  const nameField = target.getByRole('textbox', { name: 'Header name' });
  await nameField.fill('X Custom Trace');
  await nameField.blur();
  await expect(target.getByTestId('rule-problem')).toBeVisible();
  await expect(target.getByTestId('rule-value')).toHaveCount(0);
  expect(await boxes(), 'the error message arriving must move nothing').toEqual(before);

  // Rename back to the exact original name. The error clears (a valid,
  // unique name again) and the row returns to the exact state `before`
  // captured — the "leaving" half, without which an assertion only on
  // arrival could pass against a layout frozen at the wrong moment, and a
  // round trip in the same step rather than a second, separately-trusted one.
  await nameField.fill('X-Custom-Trace');
  await nameField.blur();
  await expect(target.getByTestId('rule-problem')).toHaveCount(0);
  await expect(target.getByTestId('rule-value')).toHaveCount(1);
  expect(await boxes(), 'the error message leaving must move nothing').toEqual(before);

  // A second, independent error kind, arrived at a different way (an
  // operation click rather than typing), so this guard is not only ever
  // proven against one trigger. `X-Custom-Trace` is not on Chrome's
  // request-append allowlist, so set -> append raises `append-not-allowed`.
  await opButton.click();
  await expect(target.getByTestId('rule-problem')).toBeVisible();
  await expect(target.getByTestId('rule-value')).toHaveCount(0);
  expect(await boxes(), 'a second, differently-triggered error must also move nothing').toEqual(
    before,
  );

  await page.close();

  // Why no warning-path guard: `profile-conflict` needs two enabled,
  // overlapping profiles, and this popup cannot stably show two. Measured
  // directly (temporary script, not committed) rather than assumed from
  // reading App.tsx: seeded two profiles ordered so the one carrying the
  // conflict is the one `resolveSingleProfile` would keep, then polled the
  // popup's DOM every 40ms from the first paint. `rule-warning` was never
  // present at any sampled frame, and storage already held only the
  // surviving profile by the very first sample — the truncating effect
  // CLAUDE.md's Known Gaps section documents ("the popup shows one rule
  // set… App.tsx truncates storage to it") runs faster than anything this
  // suite can observe, not merely faster than convenient. A two-profile
  // conflict is not a state a real popup session can hold long enough to
  // measure, so no e2e guard here would be measuring the real thing — the
  // marker's own geometry-safety is covered instead where it can actually
  // be driven: RuleCard.test.tsx's "RuleCard problems" and "RuleCard
  // geometry" describe blocks, via the component directly.
});

test("the ghost row at the end of the list matches a minimum rule row's height", async ({
  context,
  extensionId,
  serviceWorker,
}) => {
  // A standalone test rather than folded into the gutter/toggle test above —
  // Task 11's own review caught exactly that shape of mistake once already
  // ("the guard is correct but files its failure under someone else's
  // name"), and a third unrelated claim sharing one already-dual-purpose
  // test's name would be the same thing again, not a lesson learned from it.
  //
  // The claim: RulePanel.tsx's "New rule at end" ghost row is supposed to
  // read as the next rule's own place in the list, which only holds if it
  // is exactly as tall as the shortest a real rule row gets. That literal
  // has drifted twice in two consecutive tasks, in opposite directions —
  // 51.5 → 54 → 52 — as the gutter above the row changed shape, and the
  // second drift was this exact comment's own prediction ("re-measure and
  // update this literal... when the gutter changes size again") going
  // unheeded. Comparing the two rows' own measured heights to each other,
  // not to a literal, is what makes a third drift fail here instead of
  // waiting for someone to notice a screenshot looks 2px off — the same
  // shape as the badge/chip guard in the gutter test above.
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
            allSites: true,
            domains: [],
            excludedDomains: [],
            resourceTypes: ['xmlhttprequest'],
          },
          tabLock: { enabled: false, tabId: null, tabTitle: null },
          headers: [
            {
              id: 'short',
              enabled: true,
              target: 'request',
              operation: 'set',
              name: 'X-Short',
              value: 'ok',
            },
          ],
        },
      ],
    };
    await chrome.storage.local.set({ state, state$: { v: 2 } });
  });

  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/popup.html`);
  await page.locator('[data-testid="rule"]').first().waitFor();

  const ruleHeight = await page
    .getByTestId('rule')
    .first()
    .evaluate((el) => el.getBoundingClientRect().height);
  const ghostHeight = await page
    .getByRole('button', { name: 'New rule at end' })
    .evaluate((el) => el.getBoundingClientRect().height);

  expect(ghostHeight - ruleHeight).toBe(0);

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
  // Also the domain this test types into the add-field to provoke a
  // duplicate-site note later — the exact host the Task 6 review used, long
  // enough to have wrapped over one line before that note's height was
  // bounded. Reusing the single seeded domain (rather than adding a second
  // one) keeps every other assertion in this test — `grant`, `site`,
  // `all-sites` — resolving to exactly the one row they were written
  // against; a second row would put two matches behind those locators and
  // break them on an unrelated axis.
  const long = 'internal-api-gateway.staging.eu-west-1.example.com';

  await serviceWorker.evaluate(async (domain) => {
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
            domains: [domain],
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
  }, long);

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

  // --- the readout's second line changing ---
  // Switching the only rule off swaps "no problems" for "1 off" under the big
  // number. That line sits above the whole rail, so before this guard it moved
  // the pause bar, the all-sites switch, the site row and the request types
  // 22.1px at once — from a click on the other side of the popup.
  //
  // This guard was briefly deleted, when the healthy state rendered no line at
  // all and the movement it forbids became real. That answer is gone: the line
  // is always present and always says something (ScopeRail.tsx's `subline`
  // docblock records both rejected alternatives), so the promise holds again
  // and is asserted again. What changed is the starting text — an empty box is
  // no longer one of the states.
  await expect(subcount).toHaveText('no problems');
  await page.getByRole('switch', { name: 'X-Reflow enabled' }).click();
  await expect(subcount).toHaveText('1 off');
  expect(await boxes(), 'the subcount changing must move nothing').toEqual(withGrant);

  // --- the help bubble opening ---
  // It is absolutely positioned and so already took no space; asserted because
  // "already correct" is not the same as "guarded", and a later change to its
  // positioning would put 82.9px into the flow of the sites section.
  const bubble = page.getByTestId('help-bubble');
  await expect(bubble).toHaveCount(0);
  await page.getByRole('button', { name: 'About matching sites' }).hover();
  await expect(bubble).toHaveCount(1);
  expect(await boxes(), 'the help bubble opening must move nothing').toEqual(withGrant);

  // --- the duplicate-site note arriving ---
  // The no-move assertions that stood here are gone with their subject. This
  // note was reserved by a fixed-height wrapper in AddSiteField, so it could
  // appear without pushing "Request types" down; the owner measured the cost
  // of that reservation in every other state — 27px from the input to the
  // scope note against the section's 6px rhythm — and chose the movement over
  // the permanent hole. AddSiteField's docblock carries the full reversal.
  //
  // What still holds is asserted: the note appears and disappears on the right
  // input, and it stays one line. The one-line guarantee is what keeps the push
  // bounded now that it is not prevented, so it is the part worth testing —
  // `long` is the corporate subdomain the Task 6 review used, which overflows
  // the ~194px rail before the suffix is even appended.
  const addField = page.getByTestId('add-field');
  const note = page.getByTestId('add-site-note');
  await expect(note).toHaveCount(0);
  await addField.fill(long);
  await addField.press('Enter');
  await expect(note).toHaveCount(1);
  expect(
    await note.evaluate((el) => el.getBoundingClientRect().height),
    'the duplicate note must still be exactly one line',
  ).toBeLessThan(20);

  // Absence after presence, for the same reason the arrival is checked: a note
  // that never cleared would leave a stale complaint on screen.
  await addField.press('Escape');
  await expect(note).toHaveCount(0);

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

  // A value long enough to hit RuleCard's `max-h-24` cap, which turns that
  // textarea into a scroll container of its own — see the second assertion
  // below, which this fixture exists to make honest. A real Content-Security-
  // Policy, because that is the shape of value this actually happens with; the
  // fixture used to seed `value-${i}` throughout, so the assertion passed by
  // accident of the data rather than by design.
  const LONG_VALUE =
    "default-src 'self'; script-src 'self' 'unsafe-inline' https://cdn.example.com " +
    "https://analytics.example.com; style-src 'self' 'unsafe-inline' " +
    "https://fonts.example.com; img-src 'self' data: https://images.example.com; " +
    "connect-src 'self' https://api.example.com wss://live.example.com; " +
    "frame-ancestors 'none'; base-uri 'self'; form-action 'self'";

  const seed = async (sites: string[], rules: number) => {
    await serviceWorker.evaluate(
      async ({ sites, rules, longValue }) => {
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
                  value: i === 1 ? longValue : `value-${i}`,
                })),
              },
            ],
          },
          state$: { v: 2 },
        });
      },
      { sites, rules, longValue: LONG_VALUE },
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

  const measureLines = (p: import('@playwright/test').Page) =>
    p.evaluate(() =>
      [...document.querySelectorAll('[data-testid="site"]')].map((row) => ({
        state: row.getAttribute('data-state'),
        line: Math.round(
          row.querySelector('[data-testid="site-line"]')!.getBoundingClientRect().height,
        ),
        row: Math.round(row.getBoundingClientRect().height),
      })),
    );

  // unusable 한 행의 높이는 과밀 페이지가 아니라 여기서, 그것을 열기 전에
  // 잰다. storage 는 확장 전체에 하나뿐이라 나중에 다시 심으면 그때 이미
  // 열려 있는 다른 페이지도 watch 를 타고 같이 다시 그려지고, `boxes(page)`
  // 비교(3번)가 재는 것이 바뀐다. 그리고 unusable 은 애초에 과밀 페이지 안에
  // 함께 만들 수 없다: 도메인 목록에 무효한 항목이 하나라도 있으면
  // `isSuppressed` 가 프로필 전체를 억제해 `domainsToAudit` 가 그 프로필을
  // 건너뛰고, granted/pending 이어야 할 나머지 호스트까지 확률되지 않은 채
  // 전부 granted 로 주저앉는다(lib/compile/suppression.ts).
  //
  // 사이트를 여덟 개 심는 것은 그 억제가 **scope note 를 하나 띄우기** 때문이다.
  // 노트 + 여덟 행이 레일이 실제로 압력을 받는 유일한 상태이고, 거기서
  // 양보해야 하는 것은 사이트 목록 하나뿐이다 — 아래 두 단언이 그것을 잰다.
  // 과밀 페이지에는 이 상태를 만들 수 없다(무효한 항목이 하나라도 있으면 위에
  // 적은 대로 나머지 행의 상태가 전부 무너진다), 그래서 여기 있다.
  await serviceWorker.evaluate(async () => {
    await chrome.storage.local.set({
      state: {
        version: 2,
        globalPause: false,
        theme: 'system',
        profiles: [
          {
            id: 'u',
            name: 'Unusable',
            color: 'green',
            enabled: true,
            order: 0,
            filter: {
              mode: 'structured',
              allSites: false,
              domains: [
                'a b.com',
                'api.example.com',
                'staging.example.com',
                'internal.example.com',
                'cdn.example.com',
                'auth.example.com',
                'metrics.example.com',
                '127.0.0.1',
              ],
              excludedDomains: [],
              resourceTypes: ['xmlhttprequest'],
            },
            tabLock: { enabled: false, tabId: null, tabTitle: null },
            // 규칙 넷: 꺼진 것 하나, 이름이 빈 것 하나(unfinished), 나머지 둘은
            // 억제된 프로필이라 blocked. 그러면 readout 의 두 번째 줄이 이
            // 팝업이 만들 수 있는 가장 긴 문장이 된다 —
            // "1 off · 1 unfinished · 2 blocked by an unusable site".
            // 그 줄은 한 줄로 예약돼 있으므로, 넘칠 때 무엇을 하는지가 아래에서
            // 정해진다. 레일 기하에는 영향이 없다(그 줄은 내용과 무관하게
            // h-4 로 고정이고, 규칙은 패널에만 그려진다).
            headers: [
              {
                id: 'a',
                enabled: true,
                target: 'request',
                operation: 'set',
                name: 'X-One',
                value: '1',
              },
              {
                id: 'b',
                enabled: true,
                target: 'request',
                operation: 'set',
                name: 'X-Two',
                value: '2',
              },
              {
                id: 'c',
                enabled: false,
                target: 'request',
                operation: 'set',
                name: 'X-Off',
                value: '3',
              },
              { id: 'd', enabled: true, target: 'request', operation: 'set', name: '', value: '' },
            ],
          },
        ],
      },
      state$: { v: 2 },
    });
  });
  const unusablePage = await context.newPage();
  await unusablePage.setViewportSize({ width: 748, height: 600 });
  await unusablePage.goto(`chrome-extension://${extensionId}/popup.html`);
  await unusablePage.locator('[data-testid="site"][data-state="unusable"]').waitFor();
  const unusableLines = await measureLines(unusablePage);

  // 압력을 받는 레일: 목록만 양보하고, 레일 자신은 스크롤하지 않으며, 요청 타입은
  // 제자리에 있다. 목록의 max-height 는 127px 이므로, 그보다 작아졌다는 것이
  // 곧 "양보한 쪽은 목록이다"라는 뜻이다.
  //
  // 36 은 48 에서 다시 잰 값이다(예전에는 132→48 이었다). 브리지 행이 레일에
  // 더해지면서 예산 자체가 바뀌었기 때문에 움직였다 — 카드가 28px 필요했는데
  // 진짜 여유는 7px 뿐이었고(docs/design/2026-08-12-agent-bridge-rail-budget.html),
  // 나머지 21px 중 16px 은 다른 네 여백에서, 5px 는 이 목록의 cap 자체에서
  // 가져왔다(132→127, ScopeRail.tsx 의 site-list 문서화 참고). 이 페이지는
  // 그 cap 위에 스코프 노트까지 더해 훨씬 세게 누르므로 같은 21px 압박이
  // 132→127 보다 여기서 더 크게(48→36) 나타난다. 부등호로 완화하지 않고
  // 정확한 값으로 다시 고정한다 — 레이아웃이 움직일 때마다 다시 재야 하는
  // 것이 이 단언의 존재 이유다. 36 은 여전히 목록이 완전히 접히지 않고 한
  // 행의 일부(48 중 36)를 보여주며 listScrolls: true 로 남아 있어, "목록만
  // 양보하고 이웃은 그대로"라는 이 단언의 주제를 여전히 보여준다.
  const underPressure = await unusablePage.evaluate(() => {
    const rail = document.querySelector('aside')!;
    const list = document.querySelector('[data-testid="site-list"]')!;
    return {
      notes: document.querySelectorAll('[data-testid="scope-note"]').length,
      railScrolls: rail.scrollHeight > rail.clientHeight,
      listHeight: list.clientHeight,
      listScrolls: list.scrollHeight > list.clientHeight,
    };
  });
  expect(underPressure).toEqual({
    notes: 1,
    railScrolls: false,
    listHeight: 36,
    listScrolls: true,
  });
  expect(await boxes(unusablePage), '압력을 받아도 요청 타입은 제자리다').toEqual(before);

  // readout 의 두 번째 줄은 넘칠 때 잘리는 대신 줄임표로 끊고, 문장 전체는
  // title 로 남는다.
  //
  // 이 페이지가 그것을 재는 자리인 이유: 억제된 프로필이라 " by an unusable
  // site" 가 붙어 이 팝업이 만들 수 있는 가장 긴 두 번째 줄이 여기서 나온다.
  // 과밀 페이지의 그 줄은 "2 off" 라서 넘치지 않고, 그래서 거기서는 이 결함이
  // 보이지 않았다.
  //
  // 이 줄은 h-4 한 줄이다. (예전에는 비어 있을 때도 자리를 예약했고 그 예약이
  // 옳다고 여기 적혀 있었다. 지금은 내용이 있을 때만 그려진다 — ScopeRail.tsx 의
  // 해당 docblock 참조. 이 테스트가 보는 것은 내용이 있는 상태라 영향은 없다.)
  // 높이가 한 줄로 고정인 이상 넘칠 때 무엇을 할지
  // 말해 줘야 하는데, 그 지시가 없어서 문장이 두 줄로 감싸이고 items-center 가
  // 16px 상자 안에서 위아래를 다 썰어 냈다(고치기 전 실측 22/16, title 없음).
  // 잘려 나간 것이 하필 원인을 대는 절이었다 — ScopeRail 의 docblock 이 열 줄에
  // 걸쳐 "원인을 이름 붙이는 것이 규칙을 엉뚱하게 탓하지 않게 한다"고 논증하는
  // 바로 그 부분.
  const subcount = await unusablePage.evaluate(() => {
    const box = document.querySelector('[data-testid="subcount"]')!;
    const text = box.querySelector('[title]');
    if (!text) return { found: false };
    return {
      found: true,
      // 문장 전체가 닿을 수 있는 곳에 남아 있는가.
      title: text.getAttribute('title'),
      // 세로로 감싸이지 않는가 — 이것이 고친 것이다.
      wraps: box.scrollHeight > box.clientHeight,
      // 가로로는 실제로 넘치는가. 넘치지 않으면 위 두 단언이 공허하다:
      // 짧은 문장은 자르지 않아도 감싸이지 않고 title 도 필요 없다.
      truncates: text.scrollWidth > text.clientWidth,
      // 세 번째 약속 — 잘린 자리에 실제로 "…" 이 그려지는가. `truncates` 는
      // 가로로 넘친다는 것만 재고, 넘친 텍스트가 말줄임표로 끊기는지 그냥
      // 잘려 사라지는지는 구분하지 못한다(`overflow: hidden` 만으로도
      // truncates 는 참이 된다). Tailwind 의 `truncate` 유틸리티가 실제로
      // 셋(`overflow-hidden`, `text-overflow: ellipsis`, `white-space:
      // nowrap`) 을 다 거는지 계산된 스타일로 직접 확인한다 — 클래스 이름을
      // 읽는 게 아니라 브라우저가 실제로 적용한 값을 읽는다.
      ellipsisStyle: {
        overflow: getComputedStyle(text).overflowX,
        textOverflow: getComputedStyle(text).textOverflow,
        whiteSpace: getComputedStyle(text).whiteSpace,
      },
    };
  });
  expect(subcount).toEqual({
    found: true,
    title: '1 off · 1 unfinished · 2 blocked by an unusable site',
    wraps: false,
    truncates: true,
    ellipsisStyle: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  });

  await unusablePage.close();

  // 과밀 상태. `127.0.0.1` 은 e2e 빌드가 유일하게 미리 승인해 둔 호스트라
  // granted 를 만들고, 나머지 일곱은 전부 승인되지 않은 example.com 호스트라
  // pending 으로 정착한다 — 전부 유효한 호스트라서 이 프로필은 억제되지
  // 않고 실제로 확률된다(probeGrants).
  await seed(
    [
      'api.example.com',
      'staging.example.com',
      'internal.example.com',
      'cdn.example.com',
      'auth.example.com',
      'metrics.example.com',
      '127.0.0.1',
      'a-very-long-subdomain.staging.example.com',
    ],
    10,
  );
  const page = await context.newPage();
  await page.setViewportSize({ width: 748, height: 600 });
  await page.goto(`chrome-extension://${extensionId}/popup.html`);
  await page.locator('[data-testid="site"]').first().waitFor();
  // The permission probe is async (`chrome.permissions.contains()` per host),
  // so the first paint is optimistic — every row reads `granted` until its
  // diagnostic lands (see ScopeRail.tsx). Settling here first is what makes
  // every measurement below describe the real page rather than a transitional
  // frame; `scripts/screenshots.mjs` hits the identical issue.
  await page.waitForFunction(
    () => {
      const states = [...document.querySelectorAll('[data-testid="site"]')].map((r) =>
        r.getAttribute('data-state'),
      );
      return states.length === 8 && states.includes('granted') && states.includes('pending');
    },
    { timeout: 10_000 },
  );

  // 4. 사이트 행의 두 번째 줄은 상태와 무관하게 같은 높이다.
  //    시안 하나가 Grant 버튼(22px)을 그것을 위해 마련한 15px 띠에 7px 잘랐다.
  //    띠는 텍스트가 아니라 그 안에 들어갈 수 있는 가장 큰 것 — 버튼 — 에
  //    맞춰 잡혀야 한다.
  //    1·2번(클리핑·스크롤러) 보다 먼저 둔다: 그 둘은 Task 8·9 전까지 실패가
  //    예정돼 있고, Playwright 는 첫 실패에서 테스트를 멈춘다 — 뒤에 있으면
  //    이 블록은 커밋된 채로 단 한 번도 실행되지 않는다.
  const lineHeights = [...(await measureLines(page)), ...unusableLines];
  // 세 상태가 실제로 렌더됐는지 먼저 확인한다 — 없는 상태를 비교하면
  // "전부 같다"가 공허하게 통과한다.
  expect(new Set(lineHeights.map((l) => l.state))).toEqual(
    new Set(['granted', 'pending', 'unusable']),
  );
  expect(new Set(lineHeights.map((l) => l.line)).size).toBe(1);
  expect(new Set(lineHeights.map((l) => l.row))).toEqual(new Set([48]));

  // Grant 버튼이 그 띠 안에 온전히 들어간다.
  const grantFits = await page.evaluate(() => {
    const btn = document.querySelector('[data-testid="site-pending"]')!;
    const band = btn.closest('[data-testid="site-line"]')!;
    return btn.getBoundingClientRect().height <= band.getBoundingClientRect().height;
  });
  expect(grantFits).toBe(true);

  // 1a. 목록 밖 어디에서도 글자가 자기 줄상자에 잘리지 않는다.
  //
  //     이 단언은 원래 "스크롤 컨테이너가 아닌 모든 노드에 대해
  //     scrollHeight > clientHeight" 였고, **그 지표는 고장나 있었다.** 평상
  //     22개 / 과밀 28개를 세면서 구성이 똑같았다 — 과밀을 잰 적이 없었다는
  //     뜻이다. 전부 같은 원인이었다: shadcn 의 탭 타깃
  //     (`after:absolute after:-inset-x-3 after:-inset-y-2`). 절대 위치 의사요소는
  //     자기 containing block 의 scrollable overflow 에 기여하고 그것이 조상
  //     사슬을 타고 전파되므로, 스위치나 체크박스를 품은 **모든** 조상이 잡힌다.
  //     예외 목록 없이는 살릴 수 없는 지표였다.
  //
  //     그래서 자손이 없는 텍스트 노드만 본다. 의사요소 전파는 자손에서 오므로
  //     자손이 없으면 오지 않고, 남는 것은 "이 글자가 자기 상자를 넘는가"라는
  //     원래 물음이다. 이것이 잡는 실제 결함: 30px 글리프에 line-height:1 을
  //     줘 32/30 으로 넘쳤던 readout 의 큰 숫자 — macOS 시스템 폰트의
  //     ascent+descent 는 em 사각형보다 크고, CI 의 Linux 폰트는 또 다르다.
  //     스크롤 컨테이너는 여전히 뺀다: 자기 내용을 스크롤하는 것은 잘리는 것이
  //     아니고, 값 필드(textarea)가 정확히 그 경우다.
  //
  //     **이 필터가 못 보는 것**: 자식 요소와 자기 텍스트를 함께 가진 부모의 그
  //     텍스트. 레일의 섹션 제목이 그 모양이라("Sites" 는 카운트 span 을 자식으로
  //     가진 div 의 직접 텍스트) 제목 자체는 검사되지 않는다. 옆의 카운트 span 은
  //     잎이라 검사되므로 같은 폰트 사고는 대개 그쪽에서 잡히지만, 그건 이웃이
  //     대신 잡아 주는 것이지 이 지표가 보는 것이 아니다. 예외 목록 없는 지표를
  //     되찾는 대가로 받아들인 사각지대다.
  // 브리지 권한 probe(probeNativeMessaging)는 비동기이고, 이 페이지의 다른 어떤
  // 대기도 그것을 기다리지 않는다 — 위의 모든 waitFor/waitForFunction 은 사이트
  // 승인 probe(probeGrants) 를 보고 있을 뿐이다. probe 가 아직 안 끝났으면 이
  // 행은 `unknown` 으로 그려지고(라벨 span 하나뿐, 버튼 없음) 아래 rail 카운트는
  // 27 이 아니라 26 이 된다. 실제로는 `probeGrants` 가 호스트마다 여러 후보
  // origin 을 순차로 검사하며 최대 여덟 개를 도는 동안 이 단일 호출이 이겨서
  // 지금까지 깜빡인 적이 없지만, 그것은 우연히 이긴 경주이지 이 단언이 보장하는
  // 것이 아니다. `scripts/screenshots.mjs` 가 이미 같은 문제를 겪고 같은 답을
  // 냈다 — 대기는 지속시간이 아니라 화면이 도달해야 할 상태 자체로 적는다. 그래서
  // 여기서도 상태를 직접 기다린다.
  await expect(page.getByTestId('bridgestate')).toHaveAttribute('data-bridge', 'off');

  const clipped = await page.evaluate(() => {
    // 실패했을 때 무엇을 가리키는지 알 수 있는 이름 — 태그, 실제 글자, 그리고
    // 넘친 정도.
    const scrollers = new Set(
      [...document.querySelectorAll<HTMLElement>('*')].filter((el) =>
        ['auto', 'scroll'].includes(getComputedStyle(el).overflowY),
      ),
    );
    const leaves = [...document.querySelectorAll<HTMLElement>('[data-testid="popup-root"] *')]
      .filter((el) => el.childElementCount === 0)
      .filter((el) => (el.textContent ?? '').trim() !== '')
      .filter((el) => !scrollers.has(el));
    return {
      // 무엇을 셌는지, 레일과 패널로 나눠서. 0개를 보고 통과하는 것과 전부를 보고
      // 통과하는 것은 다른 사실이고, 이 지표는 바로 그 구분을 못 해서 한 번
      // 고장났다. 총합 하나로는 한쪽만 무너진 경우를 가리키지 못해서 둘로 나눈다.
      inspected: {
        rail: leaves.filter((el) => el.closest('aside') !== null).length,
        panel: leaves.filter((el) => el.closest('aside') === null).length,
      },
      clipped: leaves
        .filter((el) => el.scrollHeight > el.clientHeight + 1)
        .map(
          (el) =>
            `${el.tagName.toLowerCase()} "${(el.textContent ?? '').trim().slice(0, 24)}" ` +
            `${el.scrollHeight}/${el.clientHeight}`,
        ),
    };
  });
  expect(clipped.clipped).toEqual([]);
  // 실측값에 정확히 붙인다. `toBeGreaterThan(20)` 이었을 때는 36 → 21 까지, 즉
  // 모수의 42% 가 조용히 사라져도 통과했다 — 규칙 행이 하나도 렌더되지 않으면
  // 패널 쪽이 12 → 1 이 되어 총 25 인데 그래도 초록이었다. 이 줄이 하는 일은
  // "잘림 검사가 아무것도 안 보고 통과하지는 않았다" 하나뿐이므로, 여유를 두면
  // 그 하나를 하지 않는다.
  //
  // 정확값이 과하지 않은 이유: 이 수는 픽스처(사이트 8 · 규칙 10)와 마크업의
  // 함수이지 레이아웃의 함수가 아니다. 폰트도 플랫폼도 창 크기도 "텍스트를 가진
  // 잎 노드가 몇 개인가"를 바꾸지 않는다(무엇이 잘리는지는 바꾼다). 바로 아래
  // 1b 가 `rows: 8` 을 정확값으로 고정하는 것과 같은 이유다.
  //
  // 구성 — 이 숫자가 무엇으로 이루어졌는지 알아야 실패를 읽을 수 있다:
  //   레일 26 = 브랜드 1 · readout 3(큰 숫자, "of 10 rules live", subcount "2 off")
  //             · Sites 카운트 1 · run state 1("Active")
  //             · bridge row 1(라벨 "Agent bridge off" — 컨트롤이 스위치가 되면서
  //               텍스트를 가진 잎이 하나 사라졌다)
  //             · all-sites 2(라벨, 상태 줄)
  //             · 사이트 행 16(호스트 8 + Grant 버튼 7 + granted 상태 줄 1)
  //             · Request types 카운트 1
  //   패널 12 = 헤딩 1 · ghost 행 라벨 1 · 규칙 행의 operation 10
  //
  // subcount 가 24 → 25 로 들어온 것이 이 지표의 사각지대가 좁아진 지점이다.
  // 그 문장은 점 span 과 형제라서 부모가 잎이 아니었고, 그래서 위 필터가
  // 구조적으로 볼 수 없었다 — 세로로 잘리고 있는데도. 잘림을 고치면서 문장을
  // 자기 span 으로 감쌌더니 잎이 되어 저절로 검사 대상이 됐다. 지표를 넓힌 게
  // 아니라 노드가 지표 안으로 들어온 것이다.
  //
  // 25 → 27 은 그 사각지대와 다른 종류다: 팝업이 조금 바뀐 게 아니라 레일에
  // 실제 줄이 하나(bridgestate) 늘었다. 27 은 `off` 상태에서의 셈이었다 —
  // 라벨 span("Bridge off")과 Enable 버튼 둘 다 텍스트를 가진 잎이었기 때문이다.
  //
  // 27 → 26 은 바로 그 문단이 예고한 변경이다. 브릿지 컨트롤이 버튼에서
  // 스위치가 되면서 텍스트를 가진 잎이 하나 사라졌다. 위 문단은 "`unknown`
  // 이면 버튼이 없어 26" 이라고 적어두었는데, 이제 버튼 자체가 없으므로 네
  // 상태 모두 26 이고 이 수는 더 이상 상태에 매이지 않는다.
  //
  // 마크업을 바꿔서 이 수가 달라졌다면 그건 이 단언이 잡으라고 있는 사고가
  // 아니라 정상적인 변경이다 — 다시 재서 여기와 위 구성을 함께 고쳐라.
  expect(clipped.inspected, 'the clipping check must have had text to look at').toEqual({
    rail: 26,
    panel: 12,
  });

  // 1b. 목록이 넘칠 때, 가장자리 행이 중간에서 잘린다.
  //
  //     그 잘린 행이 "더 있다"는 신호다. `site-list` 의 max-height 는 행
  //     피치(48 + 6 = 54)의 정수배가 **아니게** 잡혀 있고, 이것이 그 선택을
  //     직접 재는 단언이다 — 정수배로 바꾸면 잘린 행이 사라져 빨개진다.
  //
  //     스크롤바가 보인다고 가정하지 않는다는 원래 주석의 취지가 여기 산다.
  //     macOS 의 기본 스크롤바는 오버레이라 자리도 차지하지 않고 곧 사라진다
  //     (style.css 의 scroll-list 에 측정표가 있다). 스타일을 줘서 실제 막대를
  //     띄우긴 했지만, 넘친다는 사실을 말하는 것은 여전히 잘린 행이다.
  //
  //     그 측정표에서 이 파일이 특히 새겨야 할 줄은 3행이다: ::-webkit-scrollbar
  //     단독은 headless 에서 0px, headed 에서 8px 를 예약한다. 이 스위트는
  //     headless 로 돌므로(fixtures.ts 가 headless 를 넘기지 않고 playwright 의
  //     기본이 headless 다) **여기서 잰 레이아웃 값은 사용자 화면의 값이라는
  //     보장이 없다.** scroll-list 가 gutter 와 스크롤바 스타일을 둘 다 켜는
  //     이유가 그것이고, 그 조합은 양쪽 모드에서 8px 로 같다 — 즉 이 단언이
  //     보는 폭은 headed 에서도 같은 폭이다. 여기에 새 레이아웃 단언을 더할
  //     때는 그 등가가 성립하는지 먼저 물어라.
  const partial = await page.evaluate(() => {
    const list = document.querySelector('[data-testid="site-list"]');
    // 없으면 없다고 말한다. 빈 배열을 돌려주면 "잘린 행이 없다"와 구별되지
    // 않고, 그 둘은 정반대의 사실이다.
    if (!list) return { found: false };
    const box = list.getBoundingClientRect();
    const rows = [...list.querySelectorAll('[data-testid="site"]')].map((r) =>
      r.getBoundingClientRect(),
    );
    return {
      found: true,
      rows: rows.length,
      overflowing: list.scrollHeight > list.clientHeight,
      // 아래 경계를 가로지르는 행: 윗변은 보이고 아랫변은 잘린다.
      cutAtBottom: rows.filter((r) => r.top < box.bottom - 1 && r.bottom > box.bottom + 1).length,
    };
  });
  expect(partial).toEqual({ found: true, rows: 8, overflowing: true, cutAtBottom: 1 });

  // 2. 스크롤되는 레이아웃 컨테이너는 정확히 두 목록 — site-list, rule-list —
  //    뿐이다. "몇 개가 스크롤되는가"는 이 UI 이전에도 우연히 2가 나와
  //    실패할 수 없는 단언이었다(레일 전체를 감싸던 aside, 카드 전체를 감싸던
  //    스택). "무엇이 스크롤되는가"로 물으면 레일이 통째로 스크롤하던 상태가
  //    이름으로 잡힌다 — 실제로 그렇게 잡혔다: 이 태스크 직전의 측정은
  //    `['aside.hl-rail', 'rule-list']` 였다.
  //
  //    **폼 컨트롤은 세지 않는다, 의도적으로.** RuleCard 의 값 필드는
  //    `max-h-24` + `overflow-y: auto` 라서, 값이 96px 를 넘으면 자기 내용을
  //    스크롤하는 노드가 된다 — 그리고 그건 결함이 아니라 오너가 고른 동작이다
  //    (감싸되 무한히 자라지는 않는다). textarea 는 자기 내용을 스크롤하는
  //    컨트롤이지 무엇을 담는 레이아웃 컨테이너가 아니므로, 이 단언이 묻는
  //    질문("팝업의 어느 영역이 스크롤로 넘어가는가")의 대상이 아니다.
  //
  //    다만 그것을 조용히 빼지는 않는다. 위 픽스처는 실제로 긴 CSP 값을 하나
  //    심고, 아래 첫 단언이 그 필드가 **정말로** 스크롤 중임을 요구한다. 그게
  //    없으면 이 분리는 검사되지 않은 채로 남고, 이 파일은 짧은 값만 심던
  //    시절처럼 "픽스처 우연으로 통과하는" 상태로 돌아간다.
  const scrolling = await page.evaluate(() => {
    const identify = (el: Element): string => {
      const testid = el.getAttribute('data-testid');
      if (testid) return testid;
      const tag = el.tagName.toLowerCase();
      const raw = (el as { className: unknown }).className;
      const cls = typeof raw === 'string' ? raw : ((raw as { baseVal?: string })?.baseVal ?? '');
      return `${tag}${cls ? `.${cls.trim().split(/\s+/).join('.')}` : ''}`;
    };
    const scrolling = [...document.querySelectorAll<HTMLElement>('*')].filter(
      (el) =>
        ['auto', 'scroll'].includes(getComputedStyle(el).overflowY) &&
        el.scrollHeight > el.clientHeight,
    );
    const isFormControl = (el: HTMLElement) =>
      el instanceof HTMLTextAreaElement ||
      el instanceof HTMLInputElement ||
      el instanceof HTMLSelectElement;
    return {
      controls: scrolling.filter(isFormControl).map(identify).sort(),
      containers: scrolling
        .filter((el) => !isFormControl(el))
        .map(identify)
        .sort(),
    };
  });
  expect(
    scrolling.controls,
    'the long-value field must really be scrolling, or the exclusion below is untested',
  ).toEqual(['rule-value']);
  expect(scrolling.containers).toEqual(['rule-list', 'site-list']);

  // 3. 목록 위아래는 평상 상태와 같은 좌표에 있다.
  expect(await boxes(page)).toEqual(before);

  await page.close();
});

test('the bridge row does not push the rail past its column', async ({
  context,
  serviceWorker,
  extensionId,
}) => {
  // Four sites so the list is actually at its cap — with one or two it is
  // shorter than 127px and the affordance assertion below would pass while
  // describing nothing.
  //
  // The brief's own fixture literal for this test used `filter.mode: 'domains'`,
  // a numeric `color: 0` and a `regex: null` field with no `excludedDomains` —
  // none of which match lib/model/schema.ts (`mode` is `'structured' | 'regex'`,
  // `color` is a string enum, `excludedDomains` is required, there is no `regex`
  // field at all). That shape fails `parseAppState` and the popup renders "Saved
  // rules could not be read" instead, which has no `aside` at all — this fixture
  // copies the shape every other test in this file actually uses instead, per the
  // brief's own warning one paragraph below its snippet.
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
            domains: ['a.example.com', 'b.example.com', 'c.example.com', 'd.example.com'],
            excludedDomains: [],
            resourceTypes: ['xmlhttprequest', 'main_frame'],
          },
          tabLock: { enabled: false, tabId: null, tabTitle: null },
          headers: [
            {
              id: 'h1',
              enabled: true,
              target: 'request',
              operation: 'set',
              name: 'X-A',
              value: '1',
            },
          ],
        },
      ],
    };
    await chrome.storage.local.set({ state, state$: { v: 2 } });
  });

  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/popup.html`);
  await expect(page.getByTestId('bridgestate')).toBeVisible();

  // The rail had 7px of real slack — not the 28px the source once claimed —
  // and this row needs 28. The shortfall was closed by trimming four other
  // margins one notch each and taking 5px from the site list's own cap
  // (docs/design/2026-08-12-agent-bridge-rail-budget.html has the arithmetic;
  // ScopeRail.tsx's site-list docblock has the accounting). Still an
  // inequality here — this assertion's own subject is "does not overflow",
  // not "spends exactly this much"; the list-height check below is the one
  // that pins the now-zero-slack budget to an exact number.
  const rail = page.locator('aside').first();
  const { scrollHeight, clientHeight } = await rail.evaluate((el) => ({
    scrollHeight: el.scrollHeight,
    clientHeight: el.clientHeight,
  }));
  expect(scrollHeight).toBeLessThanOrEqual(clientHeight);

  // And the affordance that slack was protecting is still there: the list
  // stops mid-row rather than on one, which is what says it continues — now
  // at 127px, 19px of the third row's 48 rather than the previous 24.
  const list = page.getByTestId('site-list');
  expect(await list.evaluate((el) => el.clientHeight)).toEqual(127);
});
