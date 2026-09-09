import { expect, test } from './firefox-fixtures';

/**
 * The strongest evidence this repository has for Chrome, repeated for
 * Firefox: a rule written into storage reaches the wire, read back off a
 * loopback echo server rather than off anything the extension itself claims.
 * The third test is the one layout fact this slice requires of the Firefox
 * popup — that there is no bridge row — asserted as an absence before any
 * presence.
 *
 * `firefox.evaluate` runs in the popup page, where `browser.*` is the
 * extension's own API surface; the tests seed `chrome.storage.local`'s
 * `state`/`state$` pair the same way the Chrome suite does.
 */

const seedState = (profileOver: Record<string, unknown>) =>
  JSON.stringify({
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
          // Explicit: the DNR default excludes main_frame, which a navigation is.
          resourceTypes: ['xmlhttprequest', 'main_frame', 'sub_frame'],
        },
        tabLock: { enabled: false, tabId: null, tabTitle: null },
        ...profileOver,
      },
    ],
  });

async function seedAndWaitForRules(
  firefox: { evaluate<T>(e: string): Promise<T> },
  profileOver: Record<string, unknown>,
) {
  // The Firefox session's first tab is already the popup, which on a fresh
  // profile mounts against empty storage and mints its own bootstrap profile
  // (App.tsx's `!resolved.profile` branch) via a read-then-write patch. That
  // write races this seed on the very same `local:state` key — measured: an
  // unguarded `set()` here is overwritten by the bootstrap's own write about
  // half the time, landing a random-uuid default profile instead of this
  // fixture's `p1`. Waiting for the bootstrap's write to land first — any
  // profile, not this test's — closes the window, because once state holds a
  // profile the popup's effect no longer calls patch.
  await expect
    .poll(() =>
      firefox.evaluate<boolean>(
        "browser.storage.local.get('state').then((r) => Boolean(r.state && r.state.profiles && r.state.profiles.length > 0))",
      ),
    )
    .toBe(true);
  await firefox.evaluate(
    `browser.storage.local.set({ state: ${seedState(profileOver)}, state$: { v: 2 } }).then(() => 'ok')`,
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

test('a configured set rule reaches the wire on Firefox', async ({ firefox, echo }) => {
  await seedAndWaitForRules(firefox, {
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
  });

  await firefox.newTab(`${echo.origin}/probe`);

  const probe = echo.requests.find((r) => r.url === '/probe');
  expect(probe, 'echo server received the navigation').toBeTruthy();
  expect(probe!.headers['x-headerlab-test']).toBe('applied');
  expect(probe!.headers['x-headerlab-disabled']).toBeUndefined();
});

test('a remove rule strips a header the page would otherwise send, on Firefox', async ({
  firefox,
  echo,
}) => {
  await seedAndWaitForRules(firefox, {
    filter: {
      mode: 'structured',
      allSites: false,
      domains: ['127.0.0.1'],
      excludedDomains: [],
      resourceTypes: ['xmlhttprequest'],
    },
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
  });

  await firefox.newTab(`${echo.origin}/host`);
  await firefox.evaluate(
    `fetch(${JSON.stringify(`${echo.origin}/xhr`)}, { headers: { 'X-Remove-Me': 'should-be-gone', 'X-Keep-Me': 'should-survive' } }).then(() => 'sent')`,
  );

  await expect.poll(() => echo.requests.some((r) => r.url === '/xhr')).toBe(true);
  const xhr = echo.requests.find((r) => r.url === '/xhr')!;
  expect(xhr.headers['x-remove-me']).toBeUndefined();
  // Positive control: a server that stopped seeing custom headers at all would
  // pass the absence above vacuously.
  expect(xhr.headers['x-keep-me']).toBe('should-survive');
});

test('the popup renders from stored state with no bridge row', async ({ firefox }) => {
  await seedAndWaitForRules(firefox, {
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
  });
  // A fresh load, so the screen is what a user opening the popup sees, not a
  // re-render mid-write.
  await firefox.navigate(firefox.popupUrl);

  // Absence first. The bridge row is the only element with this test id; the
  // Firefox build must never draw a switch nobody can flip.
  await expect
    .poll(
      () => firefox.evaluate<number>(`document.querySelectorAll('[data-testid="rule"]').length`),
      {
        timeout: 10_000,
      },
    )
    .toBe(2);
  expect(
    await firefox.evaluate<number>(
      `document.querySelectorAll('[data-testid="bridgestate"]').length`,
    ),
  ).toBe(0);
  expect(
    await firefox.evaluate<number>(`document.querySelectorAll('[data-testid="site"]').length`),
  ).toBe(1);
  await expect
    .poll(() =>
      firefox.evaluate<string>(`document.querySelector('[data-testid="readout"]').textContent`),
    )
    // No space before the middle dot: the readout renders the count and the
    // detail as sibling `<span>`s with no whitespace text node between them,
    // so the DOM's `textContent` differs from the human reading by one space.
    .toBe('1 of 2 live· 1 off');
});
