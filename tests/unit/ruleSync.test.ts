import { fakeBrowser } from 'wxt/testing/fake-browser';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { syncRules } from '@/lib/sync/ruleSync';
import type { DnrRule } from '@/lib/model/types';

const dnr = () => fakeBrowser.declarativeNetRequest;

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
