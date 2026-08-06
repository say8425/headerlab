import { fakeBrowser } from 'wxt/testing/fake-browser';
import { beforeEach, describe, expect, it } from 'vitest';
import { getSyncStatus, setSyncStatus } from '@/lib/storage/session';

beforeEach(() => {
  fakeBrowser.reset();
});

describe('sync status', () => {
  it('starts clean', async () => {
    expect(await getSyncStatus()).toEqual({ lastError: null, ruleCount: 0, iconError: null });
  });

  it('round-trips a failure message', async () => {
    await setSyncStatus({ lastError: 'Rule 3 is invalid', ruleCount: 0, iconError: null });
    expect((await getSyncStatus()).lastError).toBe('Rule 3 is invalid');
  });

  it('clears the message on a later success', async () => {
    await setSyncStatus({ lastError: 'boom', ruleCount: 0, iconError: null });
    await setSyncStatus({ lastError: null, ruleCount: 4, iconError: null });
    expect(await getSyncStatus()).toEqual({ lastError: null, ruleCount: 4, iconError: null });
  });

  it('writes to the session area, not local — that choice is why this module exists', async () => {
    // Every other test here round-trips through this module's own functions, so
    // they pass identically whether the key is `session:` or `local:`. Only
    // reading the areas directly can tell them apart.
    //
    // The area is load-bearing: a failure message describes rules that no longer
    // exist after a browser restart, so persisting it would show the user a stale
    // error about a rule set that was rebuilt from scratch. fake-browser cannot
    // simulate that clearing, but it does route by area — which is the part a
    // regression would break.
    await setSyncStatus({ lastError: 'boom', ruleCount: 0, iconError: null });

    expect(await fakeBrowser.storage.session.get(null)).toEqual({
      syncStatus: { lastError: 'boom', ruleCount: 0, iconError: null },
    });
    expect(await fakeBrowser.storage.local.get(null)).toEqual({});
  });
});
