import { fakeBrowser } from 'wxt/testing/fake-browser';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  bridgeStatusItem,
  getBridgeStatus,
  getSyncStatus,
  patchBridgeStatus,
  setSyncStatus,
} from '@/lib/storage/session';

beforeEach(() => {
  fakeBrowser.reset();
});

/** Lets queued microtasks and pending timers run before an assertion reads storage. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

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

  it('does not let one overlapping patch clobber another — the ordinary case when the host manifest is missing', async () => {
    // `patchBridgeStatus` is a read-modify-write, and three of its callers in
    // port.ts fire it with `void` on different event chains. The concrete
    // sequence this forces: `connect()`'s optimistic `{connected: true}` and
    // the almost-immediate `onDisconnect`'s `{connected: false, lastError}`
    // are in flight together whenever no host manifest is installed — not an
    // exotic case, the ordinary one. A bare read-then-write lets whichever
    // write lands last win outright, discarding the other call's field.
    //
    // Forced here by spying on the read: each call's `getValue()` is held
    // open until this test releases it, released in the reverse of the order
    // the calls issued them. A correctly serialized implementation only ever
    // has one read pending at a time — the second call's callback cannot even
    // start until the first's whole read-and-write has settled — so this
    // loop drains one release per pass for it. An unserialized implementation
    // has both reads pending together on the first pass, and reversing their
    // release order hands back the *second* call's read before the first's,
    // forcing the loss a lucky ordering would otherwise hide.
    const realGetValue = bridgeStatusItem.getValue.bind(bridgeStatusItem);
    const releases: Array<() => void> = [];
    vi.spyOn(bridgeStatusItem, 'getValue').mockImplementation(
      () =>
        new Promise((resolve) => {
          releases.push(() => void realGetValue().then(resolve));
        }),
    );

    const first = patchBridgeStatus({ connected: true });
    const second = patchBridgeStatus({ lastCommandAt: '2026-08-12T00:00:00.000Z' });

    let settled = false;
    void Promise.all([first, second]).then(() => {
      settled = true;
    });
    let iterations = 0;
    while (!settled && iterations < 20) {
      iterations += 1;
      releases
        .splice(0)
        .reverse()
        .forEach((release) => release());
      await settle();
    }

    vi.restoreAllMocks();
    // Both fields, not one — `toContain`-style partial checks here would
    // pass on an implementation that loses exactly one of the two.
    expect(await getBridgeStatus()).toEqual({
      connected: true,
      lastCommandAt: '2026-08-12T00:00:00.000Z',
      lastError: null,
    });
  });

  it('does not let one rejected write block every patch queued after it', async () => {
    // The serialization above chains each call onto the last. If that chain
    // itself carries a rejection forward, one storage failure would silently
    // stop the bridge status from updating for the rest of the session —
    // every later `void patchBridgeStatus(...)` call in port.ts would then
    // skip its own read-and-write, chained onto a promise that never
    // resolves fulfilled.
    vi.spyOn(bridgeStatusItem, 'setValue').mockRejectedValueOnce(new Error('boom'));

    await expect(patchBridgeStatus({ connected: true })).rejects.toThrow('boom');

    vi.restoreAllMocks();
    await patchBridgeStatus({ lastCommandAt: '2026-08-12T00:00:00.000Z' });

    expect((await getBridgeStatus()).lastCommandAt).toBe('2026-08-12T00:00:00.000Z');
  });
});
