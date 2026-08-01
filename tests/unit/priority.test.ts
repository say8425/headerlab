import { describe, expect, it } from 'vitest';
import { allocate, DYNAMIC_ID_BASE, SESSION_ID_BASE } from '@/lib/compile/priority';
import { MAX_PROFILES, type Profile } from '@/lib/model/types';

function profile(over: Partial<Profile> = {}): Profile {
  return {
    id: 'p1',
    name: 'Local',
    color: 'green',
    enabled: true,
    order: 0,
    filter: { mode: 'structured', domains: [], excludedDomains: [], resourceTypes: ['xmlhttprequest'] },
    tabLock: { enabled: false, tabId: null, tabTitle: null },
    headers: [],
    ...over,
  };
}

describe('allocate', () => {
  it('gives the first profile the highest priority', () => {
    const out = allocate([
      profile({ id: 'a', order: 0 }),
      profile({ id: 'b', order: 1 }),
      profile({ id: 'c', order: 2 }),
    ]);
    expect(out.map((a) => a.priority)).toEqual([3, 2, 1]);
  });

  it('never emits a priority below 1', () => {
    const out = allocate([profile({ id: 'a', order: 0 })]);
    expect(out[0]!.priority).toBe(1);
  });

  it('assigns unique priorities so the undocumented tie-break never applies', () => {
    const out = allocate(Array.from({ length: 20 }, (_, i) => profile({ id: `p${i}`, order: i })));
    expect(new Set(out.map((a) => a.priority)).size).toBe(20);
  });

  it('sorts by order, not by array position', () => {
    const out = allocate([
      profile({ id: 'later', order: 5 }),
      profile({ id: 'first', order: 1 }),
    ]);
    expect(out.map((a) => a.profileId)).toEqual(['first', 'later']);
    expect(out[0]!.priority).toBeGreaterThan(out[1]!.priority);
  });

  it('routes tab-locked profiles to the session scope and others to dynamic', () => {
    const out = allocate([
      profile({ id: 'plain', order: 0 }),
      profile({ id: 'locked', order: 1, tabLock: { enabled: true, tabId: 7, tabTitle: 'x' } }),
    ]);
    expect(out.find((a) => a.profileId === 'plain')!.scope).toBe('dynamic');
    expect(out.find((a) => a.profileId === 'locked')!.scope).toBe('session');
  });

  it('treats a tab lock with a null tabId as dynamic', () => {
    const out = allocate([
      profile({ id: 'stale', tabLock: { enabled: true, tabId: null, tabTitle: null } }),
    ]);
    expect(out[0]!.scope).toBe('dynamic');
  });

  it('keeps the dynamic and session id spaces disjoint', () => {
    const out = allocate([
      profile({ id: 'a', order: 0 }),
      profile({ id: 'b', order: 1, tabLock: { enabled: true, tabId: 7, tabTitle: 'x' } }),
      profile({ id: 'c', order: 2 }),
    ]);
    const dynamic = out.filter((a) => a.scope === 'dynamic').map((a) => a.ruleId);
    const session = out.filter((a) => a.scope === 'session').map((a) => a.ruleId);
    expect(dynamic).toEqual([DYNAMIC_ID_BASE, DYNAMIC_ID_BASE + 1]);
    expect(session).toEqual([SESSION_ID_BASE]);
    expect(dynamic.every((id) => id < SESSION_ID_BASE)).toBe(true);
  });

  it('skips disabled profiles entirely', () => {
    const out = allocate([
      profile({ id: 'on', order: 0 }),
      profile({ id: 'off', order: 1, enabled: false }),
    ]);
    expect(out.map((a) => a.profileId)).toEqual(['on']);
  });

  it('throws above MAX_PROFILES', () => {
    const many = Array.from({ length: MAX_PROFILES + 1 }, (_, i) =>
      profile({ id: `p${i}`, order: i }),
    );
    expect(() => allocate(many)).toThrow(/MAX_PROFILES/);
  });
});
