import type { AppState } from '../../lib/model/types';
import { expect, seedFirefoxState, test } from './firefox-fixtures';

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

const buildState = (profileOver: Partial<AppState['profiles'][number]>): AppState => ({
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
      headers: [],
      ...profileOver,
    },
  ],
});

test('a configured set rule reaches the wire on Firefox', async ({ firefox, echo }) => {
  await seedFirefoxState(
    firefox,
    buildState({
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
    }),
    1,
  );

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
  await seedFirefoxState(
    firefox,
    buildState({
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
    }),
    1,
  );

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
  await seedFirefoxState(
    firefox,
    buildState({
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
    }),
    1,
  );
  // A fresh load, so the screen is what a user opening the popup sees, not a
  // re-render mid-write.
  await firefox.navigate(firefox.popupUrl);

  // The settling signal for the fresh load above: until the two rules render,
  // the absence assertion below would pass vacuously against an empty document.
  await expect
    .poll(
      () => firefox.evaluate<number>(`document.querySelectorAll('[data-testid="rule"]').length`),
      {
        timeout: 10_000,
      },
    )
    .toBe(2);
  // Absence first. The bridge row is the only element with this test id; the
  // Firefox build must never draw a switch nobody can flip.
  expect(
    await firefox.evaluate<number>(
      `document.querySelectorAll('[data-testid="bridgestate"]').length`,
    ),
  ).toBe(0);
  // The seeded types are all supported, so the note must not render.
  expect(
    await firefox.evaluate<number>(`document.querySelectorAll('[data-testid="type-note"]').length`),
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
