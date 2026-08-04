// @vitest-environment jsdom
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '@/entrypoints/popup/App';
import { createProfile } from '@/lib/model/defaults';
import * as probe from '@/lib/permissions/probe';
import type { AppState } from '@/lib/model/types';

function seed(state: AppState) {
  return fakeBrowser.storage.local.set({ state, state$: { v: 1 } });
}

function stateWith(): AppState {
  const p = createProfile('Local', 0);
  return {
    version: 1,
    globalPause: false,
    theme: 'system',
    profiles: [{
      ...p,
      id: 'p1',
      filter: { ...p.filter, domains: ['api.example.com'] },
      headers: [
        { id: 'h1', enabled: true, target: 'request', operation: 'set', name: 'X-A', value: '1' },
        { id: 'h2', enabled: true, target: 'response', operation: 'set', name: 'X-B', value: '2' },
      ],
    }],
  };
}

/**
 * Two profiles with distinct domains, both granted, so the FilterBlock/
 * ProfileEditStrip remount regression test below only has to worry about the
 * `key` fix — not a Grant prompt interrupting the switch.
 */
function twoProfiles(): AppState {
  const a = createProfile('Alpha', 0);
  const b = createProfile('Beta', 1);
  return {
    version: 1,
    globalPause: false,
    theme: 'system',
    profiles: [
      { ...a, id: 'pA', filter: { ...a.filter, domains: ['a.com'] } },
      { ...b, id: 'pB', filter: { ...b.filter, domains: ['b.com'] } },
    ],
  };
}

beforeEach(() => {
  fakeBrowser.reset();
  // permissions.* are throwing stubs in fake-browser; the popup probes on mount.
  vi.spyOn(probe, 'probeGrants').mockResolvedValue([{ domain: 'api.example.com', granted: true }]);
});
afterEach(() => { vi.restoreAllMocks(); });

describe('App', () => {
  it('renders the rows from stored state, each under its own grid group', async () => {
    await seed(stateWith());
    render(<App />);
    const rowA = await screen.findByDisplayValue('X-A');
    const rowB = screen.getByDisplayValue('X-B');

    // `findByDisplayValue` alone would pass against the pre-Task-8 App too —
    // it rendered the same header rows in a flat list with no request/response
    // split at all. Pinning each row's DOM position relative to its grid
    // group is what actually names the grid: h1 is `target: 'request'` and
    // must sit after the request group header and before the response one;
    // h2 is `target: 'response'` and must sit after the response group header.
    const reqGroup = screen.getByTestId('group-request');
    const resGroup = screen.getByTestId('group-response');
    const FOLLOWING = Node.DOCUMENT_POSITION_FOLLOWING;
    expect(reqGroup.compareDocumentPosition(rowA) & FOLLOWING).toBeTruthy();
    expect(rowA.compareDocumentPosition(resGroup) & FOLLOWING).toBeTruthy();
    expect(resGroup.compareDocumentPosition(rowB) & FOLLOWING).toBeTruthy();
  });

  it('shows a diagnostic computed from that state, without a browser', async () => {
    const s = stateWith();
    s.profiles[0]!.headers[0]!.name = '';   // invalid-header-name
    await seed(s);
    render(<App />);
    expect(await screen.findByText(/Header name is empty/)).toBeTruthy();
  });

  it('offers Grant when a host is not granted, and requests that host alone', async () => {
    vi.spyOn(probe, 'probeGrants').mockResolvedValue([{ domain: 'api.example.com', granted: false }]);
    const requestHost = vi.spyOn(probe, 'requestHost').mockResolvedValue(true);
    await seed(stateWith());
    render(<App />);

    const grant = await screen.findByRole('button', { name: /Grant/ });
    await userEvent.click(grant);

    // One host per call — passing requiredOrigins as an array would let one
    // bad entry kill the whole request (handoff §4.1).
    expect(requestHost).toHaveBeenCalledTimes(1);
    expect(requestHost).toHaveBeenCalledWith('api.example.com');
  });

  it('writes the toggle through to storage', async () => {
    await seed(stateWith());
    render(<App />);
    const pause = await screen.findByRole('button', { name: 'Pause all' });
    await userEvent.click(pause);
    await waitFor(async () => {
      const stored = await fakeBrowser.storage.local.get('state');
      expect((stored.state as AppState).globalPause).toBe(true);
    });
  });
});

describe('profile switch remounts per-profile editing state', () => {
  // Composition risk (b) from the phase 2b handoff: FilterBlock seeds `draft`
  // and `lastSent` once from props and only re-derives them when the
  // *contents* of `filter` change — not when its identity does. Reusing the
  // same FilterBlock instance across a profile switch leaves the previous
  // profile's domain text on screen; committing an edit against that stale
  // text would write it onto the *new* profile's filter. That is data loss,
  // not a cosmetic leak, so it gets its own regression test rather than
  // riding along on the fix for (a).
  it('shows the newly active profile\'s domains, not the previous profile\'s draft', async () => {
    vi.spyOn(probe, 'probeGrants').mockResolvedValue([
      { domain: 'a.com', granted: true },
      { domain: 'b.com', granted: true },
    ]);
    await seed(twoProfiles());
    render(<App />);

    // Default active profile is profiles[0] ("Alpha"), domains ['a.com'].
    expect(await screen.findByRole('textbox', { name: 'Match domains' })).toHaveProperty(
      'value',
      'a.com',
    );

    await userEvent.click(screen.getByRole('tab', { name: /Beta/ }));

    const match = await screen.findByRole('textbox', { name: 'Match domains' });
    expect(match).toHaveProperty('value', 'b.com');
  });

  // Composition risk (a): ProfileEditStrip's armed-delete flag is component
  // state with no reset tied to which profile it is editing. `onSelect`
  // itself also closes the strip on a manual tab click, which would mask this
  // — so this test drives the switch the way a second writer would (phase 2c
  // tab-lock release, per useAppState's own comment about a second writer):
  // storage changes out from under the open strip while `editingProfile`
  // stays true and `activeId` (App's local state) never moves off its `null`
  // default, so `active` re-resolves to whichever profile is now first.
  it('does not let an armed delete survive the active profile changing out from under it', async () => {
    vi.spyOn(probe, 'probeGrants').mockResolvedValue([
      { domain: 'a.com', granted: true },
      { domain: 'b.com', granted: true },
    ]);
    const initial = twoProfiles();
    await seed(initial);
    render(<App />);

    // Open editing on the default-active profile (Alpha) and arm delete with
    // one click — the strip's own two-click-to-delete friction (armed, then
    // commit) is exactly what must not carry over to a different profile.
    await userEvent.click(await screen.findByRole('tab', { name: /Alpha/ }));
    await userEvent.click(await screen.findByRole('button', { name: 'Delete profile' }));
    expect(await screen.findByRole('button', { name: 'Really delete' })).toBeTruthy();

    // A second writer removes the active profile (Alpha) entirely — not a
    // click through this popup's own onSelect/onDelete handlers, which
    // already reset `editingProfile` themselves and so cannot exercise this.
    const afterExternalChange: AppState = { ...initial, profiles: [initial.profiles[1]!] };
    await seed(afterExternalChange);

    // The strip must have remounted onto Beta with a fresh armed=false,
    // not kept showing "Really delete" for a profile the user never clicked
    // Delete on.
    expect(await screen.findByRole('button', { name: 'Delete profile' })).toBeTruthy();
    screen.debug(undefined, 200000);
    expect(screen.queryByRole('button', { name: 'Really delete' })).toBeNull();
  });
});
