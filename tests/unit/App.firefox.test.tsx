// @vitest-environment jsdom
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '@/entrypoints/popup/App';
import { createProfile } from '@/lib/model/defaults';
import * as probe from '@/lib/permissions/probe';
import type { AppState } from '@/lib/model/types';

// The one module the pure layer is forbidden to import is mocked here, in a
// file of its own, so no other App test inherits a Firefox build by accident.
vi.mock('@/lib/target', () => ({ TARGET: 'firefox' }));

function seed(state: AppState) {
  return fakeBrowser.storage.local.set({ state, state$: { v: 2 } });
}

function stateWith(over: Partial<AppState> = {}): AppState {
  const p = createProfile('Local', 0);
  return {
    version: 2,
    globalPause: false,
    theme: 'system',
    profiles: [
      {
        ...p,
        id: 'p1',
        filter: { ...p.filter, domains: ['api.example.com'] },
        headers: [
          { id: 'h1', enabled: true, target: 'request', operation: 'set', name: 'X-A', value: '1' },
        ],
      },
    ],
    ...over,
  };
}

beforeEach(() => {
  fakeBrowser.reset();
  vi.spyOn(probe, 'probeGrants').mockResolvedValue([{ domain: 'api.example.com', granted: true }]);
  vi.spyOn(probe, 'probeAllSites').mockResolvedValue(true);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('the popup built for Firefox', () => {
  it('renders no bridge row and never asks about nativeMessaging', async () => {
    const nativeProbe = vi.spyOn(probe, 'probeNativeMessaging').mockResolvedValue(true);
    await seed(stateWith());

    render(<App />);

    await waitFor(() => expect(screen.getByTestId('readout')).toBeTruthy());
    expect(screen.queryByTestId('bridgestate')).toBeNull();
    expect(nativeProbe).not.toHaveBeenCalled();
  });

  it('says which request types it dropped, on the checklist that can fix them', async () => {
    const s = stateWith();
    s.profiles[0]!.filter.resourceTypes = ['webbundle', 'xmlhttprequest'];
    await seed(s);

    render(<App />);

    await waitFor(() =>
      expect(screen.getByTestId('type-note').textContent).toBe(
        'Not supported in Firefox: webbundle.',
      ),
    );
    expect(screen.getByTestId('type-note').getAttribute('data-severity')).toBe('warning');
    // The rule still goes out — one live, none blocked.
    // The readout settles only after the mount-time permission probe answers;
    // reading it the moment the note appears raced that probe on CI (run
    // 34311034396 saw `0 of 1 live· 1 blocked · 1 site needs access`).
    await waitFor(() => expect(screen.getByTestId('readout').textContent).toBe('1 of 1 live'));
  });

  it('counts the rule as blocked, not live, when no listed type survives', async () => {
    const s = stateWith();
    s.profiles[0]!.filter.resourceTypes = ['webbundle'];
    await seed(s);

    render(<App />);

    await waitFor(() =>
      expect(screen.getByTestId('type-note').getAttribute('data-severity')).toBe('error'),
    );
    // No space before `·` in the flattened textContent: the gap between the
    // two spans is a CSS flex gap, not a text character (RulePanel.tsx).
    // Same race as above: before the probe answers, the readout carries a
    // "needs access" clause this assertion does not expect.
    await waitFor(() =>
      expect(screen.getByTestId('readout').textContent).toBe('0 of 1 live· 1 blocked'),
    );
  });
});
