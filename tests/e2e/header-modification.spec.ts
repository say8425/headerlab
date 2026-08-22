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
    session: {
      get(key: string): Promise<Record<string, unknown>>;
      set(items: Record<string, unknown>): Promise<void>;
    };
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
  // This host is deliberately ungranted — the e2e build's only host
  // permission is the loopback echo server (see the comment by the Grant
  // fixtures below) — which is exactly the first screen a new user sees, and
  // the claim it used to make here ("1 of 1 rules live · no problems") was
  // false: nothing could match. The tally's access verdict now holds the
  // rule out of `live` and the subcount names the missing step, beside the
  // Grant button that is that step.
  await expect(page.getByTestId('readout')).toHaveText(
    '0 of 1 live· 1 blocked · 1 site needs access',
  );

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

  // Anchored on the row's own switch. It used to start at the panel head's
  // "New rule" button and Tab twice; that button is gone (owner's call), so
  // the anchor moved down one stop rather than the test being rewritten.
  // What must not change is that the badge is reached **by Tab**: the ring
  // this test measures comes from `:focus-visible`, which a programmatic
  // `.focus()` on a non-text control does not satisfy — focusing the badge
  // directly would measure an element wearing no ring and call it unclipped.
  await page.getByRole('switch', { name: 'X-Trace enabled' }).focus();
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

test('the add-site field and the ghost row each keep their focus ring inside what clips them', async ({
  context,
  extensionId,
}) => {
  // Regression guard, same family as the badge/chip ring above and the same
  // shape of defect: a ring is drawn *outside* its element's border box, and
  // an ancestor with `overflow-hidden` cuts whatever falls beyond its padding
  // edge. Here the ancestor is the sites section, which clips so that the add
  // field cannot overprint the request-types heading when the rail is under
  // pressure — and the field is that section's last child, so its lower arc
  // was flush against the clip edge. Measured before the fix: the field's
  // bottom and the section's bottom were the same pixel, room 0, and a
  // keyboard user saw a ring open along the bottom.
  //
  // The room is asserted per side rather than the ring's own box being
  // compared, because this control's visible ring is a `box-shadow`
  // (`focus-visible:ring-3`) and not the `outline` the badge/chip guard
  // measures — a computed box-shadow cannot be split on commas without
  // tripping over `rgba(0, 0, 0, 0)`, so the geometry is asked directly.
  // RING_PX is that utility's width; re-derive it if the class changes.
  const RING_PX = 3;

  const page = await context.newPage();
  await page.setViewportSize({ width: 748, height: 600 });
  await page.goto(`chrome-extension://${extensionId}/popup.html`);
  await page.locator('[data-testid="add-field"]').waitFor();
  await page.locator('[data-testid="add-field"]').focus();

  const room = await page.evaluate(() => {
    const el = document.activeElement as HTMLElement;
    const r = el.getBoundingClientRect();
    // The nearest ancestor that actually clips — anything below it passes the
    // ring through untouched, however many clean wrappers sit in between.
    let clipper: HTMLElement | null = el.parentElement;
    while (clipper) {
      const ov = getComputedStyle(clipper);
      if (ov.overflowX !== 'visible' || ov.overflowY !== 'visible') break;
      clipper = clipper.parentElement;
    }
    const c = clipper?.getBoundingClientRect() ?? null;
    return {
      focused: el.getAttribute('data-testid'),
      clipped: clipper !== null,
      left: c ? r.left - c.left : Infinity,
      top: c ? r.top - c.top : Infinity,
      right: c ? c.right - r.right : Infinity,
      bottom: c ? c.bottom - r.bottom : Infinity,
    };
  });

  // The field really is the focused element, so the rest is about the ring
  // this test names rather than whatever else the popup focused first.
  expect(room.focused).toBe('add-field');
  // And it really is inside a clipping ancestor — without this the four
  // assertions below would pass vacuously on `Infinity` the day the clip is
  // removed, which is exactly the "assertion that cannot fail" shape.
  expect(room.clipped).toBe(true);
  expect(room.bottom).toBeGreaterThanOrEqual(RING_PX);
  expect(room.top).toBeGreaterThanOrEqual(RING_PX);
  expect(room.left).toBeGreaterThanOrEqual(RING_PX);
  expect(room.right).toBeGreaterThanOrEqual(RING_PX);

  // The same defect on the panel's side, and the reason this test covers two
  // controls rather than one: the ghost "New rule" row is a full-width button
  // sitting flush against the left edge of the rules well, and that well is a
  // scroll container (`scroll-list`). `overflow-y: auto` forces the other axis
  // to a clipping value however it is written, so the ring could not simply be
  // let through. Measured before the fix: room 0 on the left, 8 on the right —
  // the 8 being the scrollbar gutter, which is why only one side looked wrong.
  //
  // Its ring is an `outline` (style.css's global `:focus-visible`), not the
  // box-shadow the field above wears, so the room it needs is computed from
  // the live style instead of a constant: `outlineWidth + outlineOffset`,
  // floored at 0 because a negative offset draws inward and needs none. That
  // is what makes this assertion able to fail rather than trivially true —
  // the fix sets `outline-offset: -2px`, so the requirement is 0 today, and
  // the day the offset goes back to the global +1px the requirement becomes
  // 3px against a room of 0 and this goes red.
  const ghost = page.getByRole('button', { name: 'New rule at end' });
  await ghost.focus();
  // Arrive by keyboard. `:focus-visible` does not match a programmatic focus
  // on a button, and an element wearing no ring at all would sail through
  // every assertion below — the `outlineWidth > 0` check is the backstop.
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Tab');

  const ghostRing = await page.evaluate(() => {
    const el = document.activeElement as HTMLElement;
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    let clipper: HTMLElement | null = el.parentElement;
    while (clipper) {
      const ov = getComputedStyle(clipper);
      if (ov.overflowX !== 'visible' || ov.overflowY !== 'visible') break;
      clipper = clipper.parentElement;
    }
    const c = clipper?.getBoundingClientRect() ?? null;
    const need = Math.max(parseFloat(cs.outlineWidth) + parseFloat(cs.outlineOffset), 0);
    return {
      label: el.getAttribute('aria-label'),
      outlineStyle: cs.outlineStyle,
      outlineWidth: parseFloat(cs.outlineWidth),
      clipped: clipper !== null,
      need,
      fits:
        !c ||
        (r.left - c.left >= need - 0.5 &&
          c.right - r.right >= need - 0.5 &&
          r.top - c.top >= need - 0.5 &&
          c.bottom - r.bottom >= need - 0.5),
    };
  });

  expect(ghostRing.label).toBe('New rule at end');
  expect(ghostRing.outlineStyle).toBe('solid');
  expect(ghostRing.outlineWidth).toBeGreaterThan(0);
  expect(ghostRing.clipped).toBe(true);
  expect(ghostRing.fits, `the ring needs ${ghostRing.need}px on every side`).toBe(true);

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
 * `[data-testid="site"]` and `[data-testid="add-field"]` used to be in here and
 * are deliberately **not** any more (2026-08-21). The site rows lost their
 * fixed heights that day, so a row genuinely does grow when its Grant button
 * arrives and the add field below it genuinely does move down — the owner
 * traded that reflow for the 10px a granted row was spending on a band sized
 * for a button it does not have. Leaving them here would have left this file
 * asserting a promise the product had stopped making.
 *
 * `[data-testid="all-sites"]` left with them for half a day and **came back**,
 * which is the more useful half of the story. Content-sizing that row too made
 * it 34.39px with the mode off and 40px with a Grant button in it, so the whole
 * list jumped 5.61px on the one control whose own click causes it. The fix was
 * not a height on the row: it was a height on the 52px slot that already
 * reserves Grant's *width*, so the reservation covers both axes of the one box
 * that varies and the row is 40px in all three states — measured, off and
 * awaiting and granted. A guard left out because a defect was there is a guard
 * that has to be put back when the defect goes.
 *
 * They did not simply leave. The test body now bounds both by hand: the row
 * grows by exactly the Grant button's overhang and the add field moves by
 * exactly the same number, which is a sharper claim than "unchanged" was — it
 * fails a row that grows twice, or that grows while the field below it stays
 * put, neither of which a `toEqual` on a pair of boxes could tell apart from
 * the intended change.
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
          // The readout is measured by its RIGHT edge, not its left one. It
          // moved into the panel head and is right-aligned there (2026-08-20),
          // so its x and width change with the text by design — that is what
          // right-alignment is — while the edge it is anchored to must not.
          // Recording x here would make this guard fail on the one element
          // whose content it is deliberately changing, and dropping the
          // element instead would take its guarantee with it. Everything else
          // is still pinned on all four numbers.
          out[selector] =
            selector === '[data-testid="readout"]'
              ? [r.right, r.y, r.height].map((v) => Math.round(v * 100) / 100)
              : [r.x, r.y, r.width, r.height].map((v) => Math.round(v * 100) / 100);
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
    // A miss is recorded as `[]` by the helper above, and that is what this
    // looks for. It asked for exactly four numbers until the readout began
    // recording three (its right edge, y and height — see the helper), which
    // would have made this fail on a probe that matched perfectly well.
    Object.values(withGrant).filter((b) => b.length === 0),
    'every probe must match an element',
  ).toEqual([]);

  /**
   * The two boxes that legitimately move, measured on their own.
   *
   * They left RAIL_BOXES when the rows lost their fixed heights — see that
   * list's docblock — and this is the sharper claim that replaced "unchanged":
   * whatever those boxes do, the field below them moves by exactly their sum
   * and nothing else in the rail does anything. A `toEqual` on a pair of boxes
   * could not tell a row that grew once from one that grew twice, nor catch a
   * row growing while the field below it stayed put.
   *
   * The all-sites row is measured here too, and its term is **zero today** —
   * that row is 40px in all three of its states. It is kept because of how it
   * got there. The first draft of this assertion claimed the field moves by
   * what the *site* row gained, and the field moved 9.61px against the row's 4;
   * the missing 5.61 was the all-sites row growing 34.39 -> 40 as its own Grant
   * button arrived, a second contributor on the same toggle that an assertion
   * naming only one box would have blamed on the wrong one. That growth was
   * then fixed at the source — the slot reserving Grant's width got a height
   * too — so this term reads 0 and will read something again the moment
   * anybody undoes that.
   */
  const middle = () =>
    page.evaluate(() => {
      const round = (v: number) => Math.round(v * 100) / 100;
      const row = document.querySelector('[data-testid="site"]')!.getBoundingClientRect();
      const mode = document.querySelector('[data-testid="all-sites"]')!.getBoundingClientRect();
      const field = document.querySelector('[data-testid="add-field"]')!.getBoundingClientRect();
      const line = document.querySelector('[data-testid="site-line"]')!;
      const text = line.querySelector(':scope > span');
      return {
        rowHeight: round(row.height),
        modeHeight: round(mode.height),
        fieldY: round(field.y),
        lineHeight: round(line.getBoundingClientRect().height),
        lineTruncated: text ? text.scrollWidth > text.clientWidth : false,
      };
    });

  const middleWithGrant = await middle();

  // --- the Grant button vacating its row ---
  // All-sites mode makes this row idle, and an idle row offers no Grant — one
  // click, and the button is genuinely gone rather than merely faded.
  await allSites.click();
  await expect(grant).toHaveCount(0);
  expect(await page.getByTestId('site').getAttribute('data-state')).toBe('idle');
  expect(await boxes(), 'the Grant button leaving must move nothing').toEqual(withGrant);

  // And the bounded half of the same promise. Toggling all-sites takes the row
  // from `pending` to `idle`, which changes what its second line holds and so
  // changes its height — that is the reflow the fixed `h-6` used to forbid and
  // the owner traded away on 2026-08-21.
  //
  // Asserted rather than tolerated: the row's height must actually differ (a
  // fixed height quietly restored would fail here, and whoever restored it
  // would have to come and read why it went), and the add field must move by
  // exactly that difference — no more, which would mean something else grew
  // too, and no less, which would mean the field was clipped rather than
  // pushed.
  const middleIdle = await middle();

  // The one-line rule, on the one state no other test can reach. The overflow
  // test pins each state's line height, but its fixture has all-sites OFF, so
  // it renders no idle row and never sees the string this covers — proven by
  // putting the old over-long copy back and watching that test stay green.
  // "Not in use while All sites is on" measured 158.8px against the 135px the
  // text actually gets (`site-line` is 155 and spends 20 on `pl-5` — a
  // distinction the first version of this comment missed), wrapped, and left
  // this row 14px taller than its neighbours. It reads "All sites is on" now,
  // at 70.7px, which is ~47% headroom rather than the 10% the longer string
  // had against a budget CI's wider fallback fonts could have closed.
  expect(middleIdle.lineHeight, "an idle row's second line is one line").toEqual(14);
  expect(middleIdle.lineTruncated, 'and it fits rather than being clipped to fit').toBe(false);
  // And the height itself. `not.toEqual` below says only that it differs from a
  // pending row, and the `toBeCloseTo` after it compares the field's movement
  // against that same delta — so an idle row of *any* height satisfied both. The
  // one state this branch wrote new copy for had no height pin at all; a code
  // reviewer found that. 50px is the granted/unusable height, which is what an
  // idle row is once its line fits on one line.
  expect(middleIdle.rowHeight, 'an idle row is 50px, like every non-pending row').toEqual(50);

  expect(middleIdle.rowHeight, 'the row height must depend on its state now').not.toEqual(
    middleWithGrant.rowHeight,
  );
  expect(
    middleIdle.fieldY - middleWithGrant.fieldY,
    'the add field must move by exactly what the two boxes above it gained, and nothing else',
  ).toBeCloseTo(
    middleIdle.rowHeight -
      middleWithGrant.rowHeight +
      (middleIdle.modeHeight - middleWithGrant.modeHeight),
    1,
  );

  // …and back, so a layout that had simply frozen at the first measurement
  // cannot pass. This direction is the one the owner saw.
  await allSites.click();
  await expect(grant).toHaveCount(1);
  expect(await boxes(), 'the Grant button arriving must move nothing').toEqual(withGrant);

  // --- the readout's second line changing ---
  // Switching the only rule off swaps the access-blocked clause for "1 off"
  // under the big number. That line sits above the whole rail, so before this
  // guard it moved the pause bar, the all-sites switch, the site row and the
  // request types 22.1px at once — from a click on the other side of the
  // popup.
  //
  // This guard was briefly deleted, when the healthy state rendered no line at
  // all and the movement it forbids became real. That answer is gone: the line
  // is always present and always says something (ScopeRail.tsx's `subline`
  // docblock records both rejected alternatives), so the promise holds again
  // and is asserted again. What changed is the starting text — an empty box is
  // no longer one of the states, and this fixture's host is ungranted (the
  // comment above), so the starting clause is the access one the tally now
  // owes. Toggling the rule off takes it out of every count but `off`, which
  // is what makes the swap observable.
  await expect(subcount).toHaveText('· 1 blocked · 1 site needs access');
  await page.getByRole('switch', { name: 'X-Reflow enabled' }).click();
  await expect(subcount).toHaveText('· 1 off · 1 site needs access');
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
    // `readout` left this list when it left the rail (2026-08-20). This probe
    // is about the RAIL holding still while the site list absorbs pressure,
    // and the readout is in the panel head now — a different column, which
    // this fixture does not press. It is also right-aligned there, so its x
    // tracks its own text width by design and would report movement that is
    // neither the rail's nor a defect.
    for (const id of ['runstate', 'rail-section-types', 'type-grid']) {
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
      [...document.querySelectorAll('[data-testid="site"]')].map((row) => {
        const line = row.querySelector('[data-testid="site-line"]')!;
        const text = line.querySelector(':scope > span');
        return {
          state: row.getAttribute('data-state'),
          line: Math.round(line.getBoundingClientRect().height),
          row: Math.round(row.getBoundingClientRect().height),
          // The second half of the one-line rule. `truncate` makes wrapping
          // impossible, so a string too long for the 155px box does not grow
          // the row any more — it disappears behind an ellipsis instead, which
          // is quieter and just as wrong. This is what notices.
          truncated: text ? text.scrollWidth > text.clientWidth : false,
        };
      }),
    );

  // unusable 한 행의 높이는 과밀 페이지가 아니라 여기서, 그것을 열기 전에
  // 잰다. storage 는 확장 전체에 하나뿐이라 나중에 다시 심으면 그때 이미
  // 열려 있는 다른 페이지도 watch 를 타고 같이 다시 그려지고, `boxes(page)`
  // 비교(3번)가 재는 것이 바뀐다. 그리고 unusable 은 애초에 과밀 페이지 안에
  // 함께 만들 수 없다: unusable 행 하나를 얻으려면 무효한 항목을 심어야 하는데,
  // 그러면 그 목록의 상태 구성이 과밀 페이지가 재려는 것과 달라진다. (예전에는
  // 이유가 더 셌다 — 무효한 항목 하나가 프로필 전체를 억제해 나머지 호스트가
  // 확률되지 않은 채 전부 granted 로 주저앉았다. 2026-08-20 부터는 무효한
  // 항목만 스코프에서 빠지고 나머지는 정상 동작한다: lib/compile/suppression.ts.)
  //
  // 사이트를 여덟 개 심는 것은 그것이 목록을 cap 위로 넘치게 하는 값이기
  // 때문이다. 다만 넘치는 것만으로는 이 단언의 주제가 되지 않는다 — 목록은
  // 자기 cap(200px)에 앉아 있을 뿐이고, "압력을 받으면 양보하는 쪽은
  // 목록이다"를 보이려면 cap **아래로** 밀어내는 것이 레일에 하나 더 있어야
  // 한다. 예전에는 그 억제가 스코프 노트를 띄워 그 역할을 했다. 노트는
  // 사라졌으므로(2026-08-19) 남아 있는 두 에러 노트 중 하나(sync-error)를
  // 아래에서 직접 심어 같은 압력을 만든다.
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

  // 압력의 원천을 여기서, 페이지가 이미 그려진 **뒤에** 심는다. 순서가
  // 본질이다: 상태를 쓰면 `stateItem.watch` 가 reconcile 을 깨우고
  // (background.ts), reconcile 은 끝나면서 `recordStatus({lastError: null,
  // …})` 로 이 레코드를 덮어쓴다(lib/sync/ruleSync.ts). 그래서 상태 쓰기
  // **옆에서** 심으면 경쟁이 되고, 경쟁은 실측으로 졌다 — 팝업은
  // `getSyncStatus()` 를 마운트에서 한 번 읽을 뿐 watch 하지 않으므로
  // (App.tsx) 덮어쓰기가 이기면 노트는 영영 나타나지 않고 아래 waitFor 가
  // 30초 뒤 타임아웃으로 죽는다. 위의 goto + waitFor 가 그 사이에 IPC 를
  // 여러 번 왕복하므로 그 reconcile 은 이미 끝났고, 여기부터 reload 까지는
  // 상태를 쓰는 것이 없으니 reconcile 은 다시 깨지 않는다.
  //
  // 값이 살아남았음을 재확인까지 한다 — 남은 경쟁이 있다면 측정이 조용히
  // 틀리는 대신 이 단언에서 시끄럽게 죽어야 한다.
  // 키는 lib/storage/session.ts 의 `session:syncStatus` 에서 area 접두사를
  // 뗀 `syncStatus` 그대로다.
  await serviceWorker.evaluate(async () => {
    await chrome.storage.session.set({
      syncStatus: {
        lastError: 'Rule 2 is invalid',
        ruleCount: 0,
        iconError: 'The toolbar icon could not be updated.',
      },
    });
  });
  await unusablePage.reload();
  await unusablePage.locator('[data-testid="site"][data-state="unusable"]').waitFor();
  await unusablePage.locator('[data-testid="sync-error"]').waitFor();
  await unusablePage.locator('[data-testid="icon-error"]').waitFor();
  expect(
    await serviceWorker.evaluate(
      async () =>
        (
          (await chrome.storage.session.get('syncStatus')).syncStatus as {
            lastError: string | null;
          }
        ).lastError,
    ),
    '심은 sync-error 가 reconcile 에 덮이지 않고 살아 있다',
  ).toBe('Rule 2 is invalid');
  const unusableLines = await measureLines(unusablePage);

  // 압력을 받는 레일: 목록만 양보하고, 레일 자신은 스크롤하지 않으며, 요청 타입은
  // 제자리에 있다. 목록의 max-height 는 200px 이므로(행이 고정 높이를 잃은 뒤의
  // 값 — ScopeRail.tsx 의 site-list 문서화 참고), 그보다 작아졌다는 것이
  // 곧 "양보한 쪽은 목록이다"라는 뜻이다.
  //
  // 36 은 48 에서 다시 잰 값이다(예전에는 132→48 이었다). 브리지 행이 레일에
  // 더해지면서 예산 자체가 바뀌었기 때문에 움직였다 — 카드가 28px 필요했는데
  // 진짜 여유는 7px 뿐이었고(docs/design/2026-08-12-agent-bridge-rail-budget.html),
  // 나머지 21px 중 16px 은 다른 네 여백에서, 5px 는 이 목록의 cap 자체에서
  // 가져왔다(132→127, ScopeRail.tsx 의 site-list 문서화 참고). 이 페이지는
  // 그 cap 위에 노트까지 더해(당시 스코프 노트, 지금은 위에서 심는
  // sync-error) 훨씬 세게 누르므로 같은 21px 압박이
  // 132→127 보다 여기서 더 크게(48→36) 나타난다. 부등호로 완화하지 않고
  // 정확한 값으로 다시 고정한다 — 레이아웃이 움직일 때마다 다시 재야 하는
  // 것이 이 단언의 존재 이유다. 36 은 여전히 목록이 완전히 접히지 않고 한
  // 행의 일부(48 중 36)를 보여주며 listScrolls: true 로 남아 있어, "목록만
  // 양보하고 이웃은 그대로"라는 이 단언의 주제를 여전히 보여준다.
  // (그 뒤 55 를 거쳐 51: AddSiteField 의 예약 줄이 사라지며 48 행이 되고,
  // 다시 표준 xs Grant 를 위한 all-sites 바의 4px 로 51 이 되었다. 60px 행은
  // 이 값에 영향을 주지 않는다 — 이 쪽은 cap 이 아니라 남는 공간이 목록을
  // 조이는 상태라 행 높이와 무관하다. 아래의 정확값 단언이 현재 값이다.)
  const underPressure = await unusablePage.evaluate(() => {
    const rail = document.querySelector('aside')!;
    const list = document.querySelector('[data-testid="site-list"]')!;
    return {
      // 부재를 먼저, 존재를 나중에. 스코프 노트는 사라졌으므로 그 testid 로
      // 되살아나는 요소가 없다는 것이 먼저 단언되고, 압력을 실제로 만드는
      // 노트는 남아 있는 에러 노트 쪽이다 — 둘을 한 숫자로 합치면 "노트가
      // 하나 있다"가 어느 쪽인지 말하지 못한다.
      scopeNotes: document.querySelectorAll('[data-testid="scope-note"]').length,
      errorNotes: document.querySelectorAll(
        '[data-testid="sync-error"], [data-testid="icon-error"]',
      ).length,
      railScrolls: rail.scrollHeight > rail.clientHeight,
      listHeight: list.clientHeight,
      listScrolls: list.scrollHeight > list.clientHeight,
    };
  });
  // 36 -> 55: the scope note gave up the `mt-3` it stacked on the section's
  // own gap, and AddSiteField gave up its 15px reserved line. Both were spent
  // above this list, so the list — the only child allowed to give way — is
  // what gets them back. Under the same pressure it now shows more, which is
  // the direction this assertion exists to protect.
  // 55 -> 51: the all-sites bar's reserved second line grew h-5 -> h-6 for
  // the standard shadcn `xs` Grant (24px), so 4px of fixed rail content above
  // the list comes out of the list again. Same direction, smaller figure —
  // re-measured, not derived.
  // 51 -> smaller: the *pressure itself* got smaller. The unusable-site
  // note's copy went direct ("Unusable sites: … Use a bare hostname like
  // example.com.", the consequence clause dropped — the readout says it), so
  // the note wraps to fewer lines in the 194px rail and the list takes the
  // lines back. Copy length is rail pressure.
  //
  // A range, not a figure: this value depends on how many lines the note's
  // text wraps to, and that differs by one line between the headed macOS
  // run and CI's Linux fallback fonts (82 local, 66 on CI — one 15.2px
  // line, the same font-metric divergence the width guard's own comment
  // records). The earlier exact figures (55, 51) were latently just as
  // dependent; the shorter copy simply landed nearer a wrap boundary and
  // made it visible. What this assertion owns is *which element yields* —
  // the list, not the rail, with exactly one note as the pressure — and
  // both platforms sit inside the bound with a margin on either side.
  expect(underPressure.scopeNotes).toBe(0);
  expect(underPressure.errorNotes).toBe(2);
  expect(underPressure.railScrolls).toBe(false);
  expect(underPressure.listScrolls).toBe(true);
  // Re-measured after the readout left the rail (2026-08-20). That freed 48px
  // at the top, and a single note stopped pressing at all — the list simply sat
  // at its cap, which makes "the list is the one that yields" a claim the
  // fixture no longer demonstrated. Both remaining notes are planted now.
  //
  // Re-measured again on 2026-08-21, when the rows lost their fixed heights and
  // the cap went 174 -> 200: the same two notes now leave 63px rather than 26,
  // because there is more list to give away before the rail runs out.
  //
  // The bound is a range for the reason the old one was: note copy wraps to a
  // different number of lines under CI's fallback fonts, a one-line spread of
  // roughly 16px. 100 is half the cap — comfortably clear of 63 either way, and
  // still low enough that passing it means the list really did give way rather
  // than sit where it started. What this owns is unchanged: the list is BELOW
  // its cap, so it is the element that yielded, and above zero, so it yielded
  // without being erased.
  expect(underPressure.listHeight).toBeGreaterThan(0);
  expect(underPressure.listHeight).toBeLessThanOrEqual(100);
  expect(await boxes(unusablePage), '압력을 받아도 요청 타입은 제자리다').toEqual(before);

  // (readout 두 번째 줄의 말줄임 보증은 이 페이지를 떠났다. 원인 절이
  // 사라진 뒤로 여기의 줄은 '1 off · 1 unfinished · 2 blocked' 160px 이고
  // 상자는 171px 이라 더 이상 넘치지 않는다 — 넘치지 않는 상태에서
  // truncates 를 단언하면 공허하게 통과한다. 실제로 넘치는 고정물을 가진
  // 전용 테스트로 옮겼다: 아래 'readout 의 두 번째 줄은 …' 참고.)

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
  // Three states, and the claim is that the second line is one height in
  // every one of them — a state left out of this set is a state the claim was
  // never tested against. A fourth briefly lived here: `suppressed`, for a
  // valid row whose profile some *other* entry had killed. It is gone because
  // its cause is (2026-08-20): an unusable entry is dropped from the scope
  // now, so its neighbours are ordinary granted/pending rows again and there
  // is no such state left to render.
  expect(new Set(lineHeights.map((l) => l.state))).toEqual(
    new Set(['granted', 'pending', 'unusable']),
  );
  // 2026-08-21 까지 이 자리의 주장은 "세 상태의 둘째 줄이 모두 같은 높이"
  // 였다. 그 예약이 소유자 결정으로 사라졌다 — 레일에서 가장 귀한 자원은
  // 사이트 목록의 세로 공간인데, granted 행이 갖고 있지도 않은 버튼을 위한
  // 띠에 10px 을 쓰고 있었다. 이제 줄은 자기가 담은 것에 맞춰진다.
  //
  // "전부 같다" 를 지우고 상태별로 못 박는다. 지우기만 하는 것보다 강한
  // 주장이다: 한 상태가 조용히 0 으로 무너지는 것과, 두 상태가 우연히 같은
  // 높이가 되는 것을 둘 다 잡는다. 행 높이의 내력은 48 -> 52 -> 60 -> 상태별
  // (예약된 h-5 -> h-6, shadcn xs Grant 의 24px -> all-sites 바와 같은 8px
  // 상하 패딩 -> 고정 높이 제거).
  const byState = new Map(lineHeights.map((l) => [l.state, `${l.line}/${l.row}`]));
  expect(Object.fromEntries(byState), '상태마다 정해진 줄/행 높이가 있다').toEqual({
    granted: '14/50',
    pending: '24/60',
    // 20/56 까지가 destructive Badge 였다. 2026-08-21 에 소유자가 빨간 평문으로
    // 바꾸면서 칩 하나가 사라졌고, 그 행은 이웃과 같은 50px 이 되었다.
    unusable: '14/50',
  });

  // 그리고 규칙 자체: 둘째 줄은 무엇을 담든 한 줄이다. 14 는 텍스트 한 줄,
  // 24 는 Grant 버튼 — 그 둘 말고 다른 값이 나온다면 줄이 감겼다는 뜻이고,
  // 감긴 줄은 그 행만 이웃보다 키운다. "Not in use while All sites is on" 이
  // 정확히 그랬다: 155px 상자에 158.8px, 3.8px 초과로 그 행만 64px 이었다.
  expect(
    [...new Set(lineHeights.map((l) => l.line))].sort((a, b) => a - b),
    '둘째 줄은 텍스트 한 줄(14) 아니면 Grant 버튼(24) 뿐이다',
  ).toEqual([14, 24]);
  // 감기지 못하게 만든 대가로 잘릴 수는 있다. 잘린 줄은 읽을 수 없는 줄이므로
  // 문구는 상자 안에 들어가야 하고, 이것이 그것을 확인한다.
  expect(
    lineHeights.filter((l) => l.truncated),
    '줄임표로 잘리는 문구가 있으면 그 문구가 너무 길다',
  ).toEqual([]);
  // 그리고 같은 상태의 행은 언제나 같은 높이다. 위의 Map 은 상태마다 마지막
  // 값만 남기므로, 한 granted 행만 다르게 렌더돼도 그 비교는 통과한다 —
  // 이것이 그 축을 따로 지킨다.
  expect(
    lineHeights.filter((l) => `${l.line}/${l.row}` !== byState.get(l.state)),
    '같은 상태의 행끼리는 높이가 갈릴 수 없다',
  ).toEqual([]);

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

  // 그 상태가 **화면에** 있는가 — 접근성 트리에만 있는 것과 구별해서.
  //
  // `toBeVisible()` 은 이것을 가리지 못한다: 숨겨진 detail span 도 통과한다
  // (측정: 175×90, `visibility: visible`, `opacity: 1`). 이 이슈가 거부한
  // "속성만 보는 가드"가 옷만 갈아입은 형태다. 칠해진 글자와 잘린 글자를
  // 실제로 가르는 것은 `clip-path` 하나 — 라벨과 상태 슬롯은 `none`, detail
  // span 은 `inset(50%)`.
  //
  // 항목마다 다른 회귀에서 실패한다: `clipPath` 는 단어가 다시 접근성
  // 트리로만 들어갈 때, `text` 는 사라질 때, `height` 와 `truncated` 는 한 줄
  // 규칙의 두 반쪽이다. `truncated` 는 구조적으로 항상 false 인 항목이 아니다 —
  // 47.48px 슬롯에 107.70px 문자열을 넣으면 true 로 측정된다.
  //
  // `measureLines` 는 재사용하지 않는다. `[data-testid="site"]` 에 고정되어
  // 있어 여기서는 `[]` 를 돌려주고, 아무것도 검사하지 않은 채 초록이 된다.
  expect(
    await page.getByTestId('bridge-state').evaluate((el) => ({
      text: el.textContent,
      clipPath: getComputedStyle(el).clipPath,
      visibility: getComputedStyle(el).visibility,
      height: Math.round(el.getBoundingClientRect().height),
      truncated: el.scrollWidth > el.clientWidth,
    })),
  ).toEqual({
    text: 'off',
    clipPath: 'none',
    visibility: 'visible',
    height: 16,
    truncated: false,
  });

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
  //   레일 27 = 브랜드 1 · readout 3(큰 숫자, "of 10 rules live",
  //             subcount "2 off · 7 sites need access")
  //             · Sites 카운트 1 · run state 1("Active")
  //             · bridge row 2(보이는 라벨 "Agent bridge" + 캔버스 밖 detail
  //               span — 스위치의 aria-describedby 가 실제 텍스트를 가리키게
  //               하는 H-3 수정이 텍스트를 가진 잎을 하나 더했다). 상태 단어
  //               span 이 들어온 뒤로 이 항목은 3 이다 — 아래 narration 참조
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
  // 26 → 27 은 H-3: 스위치의 description 이 라벨이 아니라 실제 텍스트를
  // 가리키게 하면서 브리지 행에 detail span 이 하나 들어왔다. sr-only 가
  // 아니라 캔버스 밖 배치(OFFCANVAS_TEXT)인 것도 이 테스트 때문이다 —
  // 1px 클립 숨김은 자기 상자를 넘치는 글자라서 바로 아래 1a 가 잡는다.
  // detail span 은 상태마다 길이가 달라지지만 잎 하나로 세는 지표에는
  // 상태 무관 +1 이다. (알림 채널의 status span 은 비어 있으면 글자가
  // 없어 세지 않는다 — 이 페이지는 아무 것도 공지하지 않는다.)
  //
  // subcount 가 "2 off · 7 sites need access" 로 늘어난 것은 잎 수와
  // 무관하다(문장은 여전히 한 개의 span 잎)지만 길이 예산과 관계가 있으므로
  // 위 구성에 적어둔다.
  //
  // 마크업을 바꿔서 이 수가 달라졌다면 그건 이 단언이 잡으라고 있는 사고가
  // 아니라 정상적인 변경이다 — 다시 재서 여기와 위 구성을 함께 고쳐라.
  // 27 -> 24 -> 23 / 12 -> 14: readout 이 레일에서 패널 헤더로 옮겨 가고
  // (2026-08-20), 이어서 all-sites 행의 off 줄("The list below applies")이
  // 제거되며 레일이 텍스트 노드를 하나 더 잃었다. 이 주석 바로 위가 말하는
  // "정상적인 변경이라면 다시 재라"에 해당하는 경우다.
  //
  // 23 -> 24: 브리지 행이 상태 단어(`bridge-state`)를 얻었다. 이것은 잎을
  // 더하지만 상자를 더하지는 않는다 — 이미 있던 `flex-1` 스페이서를 대체하는
  // 것이라 행의 기하는 그대로다. `unknown` 상태에서는 글자가 없어 세지 않으므로
  // 이 +1 은 상태에 매인다. 이 픽스처는 `off` 로 렌더된다.
  expect(clipped.inspected, 'the clipping check must have had text to look at').toEqual({
    rail: 24,
    panel: 14,
  });

  // 1b. 목록이 넘칠 때, 가장자리 행이 중간에서 잘린다.
  //
  //     그 잘린 행이 "더 있다"는 신호다. `site-list` 의 max-height 는 행
  //     피치의 정수배가 **아니게** 잡혀 있고, 이것이 그 선택을 직접 재는
  //     단언이다 — 정수배로 바꾸면 잘린 행이 사라져 빨개진다.
  //
  //     피치는 2026-08-21 부터 하나가 아니다. granted/unusable 행은 50px 라
  //     피치 56, pending 행은 60px 라 피치 66 이다. 200 은 둘 다 정수배가
  //     아니지만(56×3=168, 66×3=198), 남는 조각의 크기는 크게 다르다 — 32px
  //     대 2px. 아래 단언이 재는 것은 "잘린 행이 하나 있다"이지 그것이 얼마나
  //     보이느냐가 아니므로, pending 목록에서 신호가 약해진 것은 이 단언이
  //     잡지 못한다. ScopeRail.tsx 의 site-list 문서화가 그 대가를 기록한다.
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

// A guard stood here — 'readout 의 두 번째 줄은 넘칠 때 감싸이지 않고 말줄임표로
// 끊는다'. It pinned that the count's second line truncates with an ellipsis
// instead of wrapping and being sliced through the middle by `items-center`,
// which was a real defect in a 16px box in the rail.
//
// Its subject is unreachable now (2026-08-20). The count moved to the panel
// head, where the measured space is 453px against a worst realistic line of
// 323px ('· 12 off · 12 unfinished · 12 blocked · 12 sites need access') — so
// no state this popup can produce overflows it, and a truncation assertion
// there would be one that cannot fail. Forcing it with a fixture the product
// cannot reach would be worse: a guard describing a shape nobody can get to.
//
// What survives is the decision it protected — WHICH half yields when the line
// is long — and that is pinned where it can still be observed:
// RulePanel.test.tsx, 'lets only the detail truncate, never the count'.
// `truncate` stays on the element as the defence; re-measure and bring this
// back if the panel ever narrows.

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

  // And the affordance that budget accounting has to keep buying on purpose:
  // the list stops mid-row rather than on one, which is what says it
  // continues. **The slice depends on what the rows are**, which stopped being
  // one number when the rows lost their fixed heights: 32px of the fourth row's
  // 50 for an all-granted list (56px pitch), but only **2px** for an all-pending
  // one (66px pitch) — and this fixture's four `*.example.com` hosts are all
  // ungranted, so it is the pending case that is measured here. An earlier
  // version of this comment quoted the granted arithmetic beside a fixture that
  // cannot produce it; a code reviewer caught that.
  //
  // That is a real weakening: before the row-height change, 174px with uniform
  // 60px rows sliced the third row 42px in whatever the states were. No single
  // cap serves both pitches, so this is a cost the change accepted rather than
  // a bug to fix here — ScopeRail's site-list docblock carries the reasoning.
  //
  // **200 rather than the 219 the rail could give.** The rows lost their fixed
  // heights on 2026-08-21 and came down to 50px, which put the pitch at 56 and
  // made 219 land one pixel past the fourth row's bottom edge: four whole rows,
  // no slice, no signal that a fifth exists. This assertion is what caught
  // that — the cap was set to the full 222 first — so the 19px it gives back
  // is the affordance's price, paid deliberately. The cap must never land on
  // the pitch; anything from 169 to 217 cuts the fourth row, and 200 cuts it
  // through its second line where the cut is unmistakable rather than shaving
  // padding off the bottom.
  const list = page.getByTestId('site-list');
  expect(await list.evaluate((el) => el.clientHeight)).toEqual(200);
});
