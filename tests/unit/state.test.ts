import { fakeBrowser } from 'wxt/testing/fake-browser';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getState, patchState, setState } from '@/lib/storage/state';
import { DEFAULT_STATE, createProfile } from '@/lib/model/defaults';

// storage *is* implemented by fakeBrowser (unlike declarativeNetRequest), so
// the stored value can be set directly through chrome.storage.local rather
// than spying on getState() itself. `state$` is WXT's version companion key
// — see tests/e2e/header-modification.spec.ts for the same mapping.
describe('getState', () => {
  beforeEach(() => {
    fakeBrowser.reset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns the stored state when it passes validation', async () => {
    const state = { ...DEFAULT_STATE, profiles: [createProfile('Local', 0)] };
    await fakeBrowser.storage.local.set({ state, state$: { v: 1 } });

    expect(await getState()).toEqual(state);
  });

  it('falls back to DEFAULT_STATE, rather than propagating, when the stored value is malformed', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await fakeBrowser.storage.local.set({ state: { not: 'a valid state' }, state$: { v: 1 } });

    expect(await getState()).toEqual(DEFAULT_STATE);
    expect(console.error).toHaveBeenCalled();
  });
});

describe('patchState', () => {
  beforeEach(() => {
    fakeBrowser.reset();
  });

  it('leaves untouched top-level keys alone', async () => {
    await setState({ version: 1, profiles: [], globalPause: true, theme: 'dark' });
    await patchState({ globalPause: false });
    const after = await getState();
    expect(after.globalPause).toBe(false);
    expect(after.theme).toBe('dark');
  });

  it('returns the merged state', async () => {
    await setState({ version: 1, profiles: [], globalPause: false, theme: 'system' });
    const merged = await patchState({ theme: 'light' });
    expect(merged.theme).toBe('light');
    expect(merged.globalPause).toBe(false);
  });

  it('reads the stored value at write time, not a stale snapshot', async () => {
    await setState({ version: 1, profiles: [], globalPause: false, theme: 'system' });
    // Another writer lands between the popup's read and its write.
    await setState({ version: 1, profiles: [], globalPause: true, theme: 'system' });
    await patchState({ theme: 'dark' });
    const after = await getState();
    expect(after.globalPause).toBe(true); // the other writer's change survives
    expect(after.theme).toBe('dark');
  });
});
