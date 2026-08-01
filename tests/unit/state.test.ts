import { fakeBrowser } from 'wxt/testing/fake-browser';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getState } from '@/lib/storage/state';
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
