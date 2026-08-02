import { fakeBrowser } from 'wxt/testing/fake-browser';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { compile } from '@/lib/compile/compile';
import { reconcile, syncRules } from '@/lib/sync/ruleSync';
import * as stateModule from '@/lib/storage/state';
import * as sessionModule from '@/lib/storage/session';
import type { AppState, DnrRule } from '@/lib/model/types';

const dnr = () => fakeBrowser.declarativeNetRequest;

function appState(headerName: string): AppState {
  return {
    version: 1,
    globalPause: false,
    theme: 'system',
    profiles: [
      {
        id: 'p1', name: 'P', color: 'green', enabled: true, order: 0,
        filter: {
          mode: 'structured', domains: ['api.example.com'],
          excludedDomains: [], resourceTypes: ['xmlhttprequest'],
        },
        tabLock: { enabled: false, tabId: null, tabTitle: null },
        headers: [{
          id: 'h1', enabled: true, target: 'request',
          operation: 'set', name: headerName, value: '1',
        }],
      },
    ],
  };
}

function rule(id: number): DnrRule {
  return {
    id,
    priority: 1,
    condition: { requestDomains: ['api.example.com'], resourceTypes: ['xmlhttprequest'] },
    action: { type: 'modifyHeaders', requestHeaders: [{ header: 'X', operation: 'set', value: '1' }] },
  };
}

describe('syncRules', () => {
  beforeEach(() => {
    fakeBrowser.reset();
    vi.spyOn(dnr(), 'getDynamicRules').mockResolvedValue([] as never);
    vi.spyOn(dnr(), 'getSessionRules').mockResolvedValue([] as never);
    vi.spyOn(dnr(), 'updateDynamicRules').mockResolvedValue(undefined);
    vi.spyOn(dnr(), 'updateSessionRules').mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('removes every existing rule and adds the new set in one call', async () => {
    vi.spyOn(dnr(), 'getDynamicRules').mockResolvedValue([{ id: 7 }, { id: 8 }] as never);

    await syncRules({ dynamic: [rule(1)], session: [] });

    expect(dnr().updateDynamicRules).toHaveBeenCalledTimes(1);
    expect(dnr().updateDynamicRules).toHaveBeenCalledWith({
      removeRuleIds: [7, 8],
      addRules: [rule(1)],
    });
  });

  it('updates the session ruleset independently', async () => {
    vi.spyOn(dnr(), 'getSessionRules').mockResolvedValue([{ id: 10_000 }] as never);

    await syncRules({ dynamic: [], session: [rule(10_001)] });

    expect(dnr().updateSessionRules).toHaveBeenCalledWith({
      removeRuleIds: [10_000],
      addRules: [rule(10_001)],
    });
  });

  it('clears both rulesets when compilation yields nothing', async () => {
    vi.spyOn(dnr(), 'getDynamicRules').mockResolvedValue([{ id: 1 }] as never);
    vi.spyOn(dnr(), 'getSessionRules').mockResolvedValue([{ id: 10_000 }] as never);

    await syncRules({ dynamic: [], session: [] });

    expect(dnr().updateDynamicRules).toHaveBeenCalledWith({ removeRuleIds: [1], addRules: [] });
    expect(dnr().updateSessionRules).toHaveBeenCalledWith({
      removeRuleIds: [10_000], addRules: [],
    });
  });

  it('propagates a failure instead of swallowing it — updates are transactional', async () => {
    vi.spyOn(dnr(), 'updateDynamicRules').mockRejectedValue(new Error('quota exceeded'));
    await expect(syncRules({ dynamic: [rule(1)], session: [] })).rejects.toThrow('quota exceeded');
  });
});

describe('reconcile', () => {
  beforeEach(() => {
    fakeBrowser.reset();
    vi.spyOn(dnr(), 'getDynamicRules').mockResolvedValue([] as never);
    vi.spyOn(dnr(), 'getSessionRules').mockResolvedValue([] as never);
    vi.spyOn(dnr(), 'updateDynamicRules').mockResolvedValue(undefined);
    vi.spyOn(dnr(), 'updateSessionRules').mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does not start a second pass while one is already running — a call rides the in-flight promise', async () => {
    const stateA = appState('X-A');
    const stateB = appState('X-B');
    let calls = 0;
    const getStateSpy = vi.spyOn(stateModule, 'getState').mockImplementation(async () => {
      calls += 1;
      return calls === 1 ? stateA : stateB;
    });

    const p1 = reconcile();
    const p2 = reconcile();

    // p2 arrived while p1 was still awaiting getState() — it must not have
    // triggered its own, independent recompile. Capture the count now (this
    // cannot throw) but defer the assertion until after both promises have
    // settled, so a future regression here reports as a normal test failure
    // instead of leaving p1/p2 unawaited and the module-scope `inFlight`
    // latch pending into the next test.
    const callsBeforeSettling = getStateSpy.mock.calls.length;

    await Promise.all([p1, p2]);

    expect(callsBeforeSettling).toBe(1);
  });

  it('runs the two passes in sequence, not interleaved, and settles on the latest state', async () => {
    const stateA = appState('X-A');
    const stateB = appState('X-B');
    let calls = 0;
    vi.spyOn(stateModule, 'getState').mockImplementation(async () => {
      calls += 1;
      return calls === 1 ? stateA : stateB;
    });

    // A call count alone can't distinguish a serialized rerun from two
    // independent reconciles that both happen to call updateDynamicRules
    // twice — both produce the same count and the same final call. What
    // only the latch produces is each pass reading before it writes, in
    // full, before the next pass reads again.
    const order: string[] = [];
    vi.spyOn(dnr(), 'getDynamicRules').mockImplementation(async () => {
      order.push('get');
      return [] as never;
    });
    vi.spyOn(dnr(), 'updateDynamicRules').mockImplementation(async () => {
      order.push('update');
    });

    const p1 = reconcile();
    const p2 = reconcile();
    await Promise.all([p1, p2]);

    expect(order).toEqual(['get', 'update', 'get', 'update']);
    // The final registered set reflects the latest state, not the one that
    // happened to be read first.
    expect(dnr().updateDynamicRules).toHaveBeenLastCalledWith(
      expect.objectContaining({ addRules: compile(stateB).dynamic }),
    );
  });

  it('records the failure message where the popup can read it', async () => {
    // Install a failing updateDynamicRules the same way the syncRules
    // describe block's 'propagates a failure instead of swallowing it' test
    // does — this file's one spy mechanism for simulating a DNR failure.
    vi.spyOn(dnr(), 'updateDynamicRules').mockRejectedValue(new Error('boom'));

    // Recording the status is a side record, not a substitute for the
    // existing throw — reconcile() must still reject exactly as before.
    await expect(reconcile()).rejects.toThrow('boom');

    const status = await sessionModule.getSyncStatus();
    expect(status.lastError).toContain('boom');
    // A failed reconcile registered nothing; the previous rule count (if
    // any) must not linger and be mistaken for a successful sync.
    expect(status.ruleCount).toBe(0);
  });

  it('clears a previous failure once a reconcile succeeds, recording the rules actually registered', async () => {
    const state = appState('X-Success');
    vi.spyOn(stateModule, 'getState').mockResolvedValue(state);
    await sessionModule.setSyncStatus({ lastError: 'boom', ruleCount: 0 });

    await reconcile();

    const status = await sessionModule.getSyncStatus();
    expect(status.lastError).toBeNull();
    // Pinned to the fixture's actual output (1 enabled profile => 1 dynamic
    // rule), not just "truthy" — a stub ruleCount of 0 or 1 for every
    // success would pass a weaker assertion here.
    expect(status.ruleCount).toBe(compile(state).dynamic.length);
    expect(status.ruleCount).toBe(1);
  });

  it('does not let a broken status write mask a real reconcile failure', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(dnr(), 'updateDynamicRules').mockRejectedValue(new Error('boom'));
    vi.spyOn(sessionModule, 'setSyncStatus').mockRejectedValue(new Error('storage full'));

    // The reconcile failure is the one that matters to the caller; a
    // status-recording failure must not replace it or be swallowed together
    // with it into a silent resolve.
    await expect(reconcile()).rejects.toThrow('boom');
  });

  it('does not let a broken status write turn a successful reconcile into a failure', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(sessionModule, 'setSyncStatus').mockRejectedValue(new Error('storage full'));

    // updateDynamicRules/updateSessionRules succeed via this describe
    // block's beforeEach — only the best-effort status write fails.
    await expect(reconcile()).resolves.toBeUndefined();
  });
});
