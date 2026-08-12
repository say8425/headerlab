import { fakeBrowser } from 'wxt/testing/fake-browser';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  getBridgeStatus,
  getSyncStatus,
  patchBridgeStatus,
  setSyncStatus,
} from '@/lib/storage/session';

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

describe('bridge status', () => {
  it('defaults to disconnected with nothing said about it', async () => {
    // Not "connected: false plus a stale error from a previous session" — the
    // fallback is what a popup opening on a fresh worker renders, and an error
    // string in it would put a note on screen about something that never
    // happened.
    expect(await getBridgeStatus()).toEqual({
      connected: false,
      lastCommandAt: null,
      lastError: null,
    });
  });

  it('patches one field and leaves the rest of the record alone', async () => {
    // The whole reason a patch helper exists. `connect` writes `connected`,
    // an applied command writes `lastCommandAt`, and a disconnect writes
    // `lastError` — three writers, and a full-record write from any of them
    // erases what the other two said.
    await patchBridgeStatus({ lastCommandAt: '2026-08-12T00:00:00.000Z' });
    await patchBridgeStatus({ connected: true });

    expect(await getBridgeStatus()).toEqual({
      connected: true,
      lastCommandAt: '2026-08-12T00:00:00.000Z',
      lastError: null,
    });
  });

  it('can clear a field back to null', async () => {
    // `{lastError: null}` must not be read as "no change" by a merge that
    // filters undefined the wrong way — clearing the error on a successful
    // reconnect is the only way the note ever comes off the screen.
    await patchBridgeStatus({ lastError: 'Native host has exited.' });
    await patchBridgeStatus({ lastError: null });

    expect((await getBridgeStatus()).lastError).toBeNull();
  });
});
