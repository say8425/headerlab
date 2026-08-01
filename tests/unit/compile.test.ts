import { describe, expect, it } from 'vitest';
import { compile } from '@/lib/compile/compile';
import type { AppState, HeaderRule, Profile } from '@/lib/model/types';

function header(over: Partial<HeaderRule> = {}): HeaderRule {
  return {
    id: 'h1', enabled: true, target: 'request',
    operation: 'set', name: 'X-Debug-Mode', value: 'true',
    ...over,
  };
}

function profile(over: Partial<Profile> = {}): Profile {
  return {
    id: 'p1', name: 'Local', color: 'green', enabled: true, order: 0,
    filter: {
      mode: 'structured', domains: ['api.example.com'],
      excludedDomains: [], resourceTypes: ['xmlhttprequest'],
    },
    tabLock: { enabled: false, tabId: null, tabTitle: null },
    headers: [header()],
    ...over,
  };
}

function state(over: Partial<AppState> = {}): AppState {
  return { version: 1, profiles: [profile()], globalPause: false, theme: 'system', ...over };
}

describe('compile', () => {
  it('emits exactly one rule per enabled profile', () => {
    const out = compile(state());
    expect(out.dynamic).toHaveLength(1);
    expect(out.session).toHaveLength(0);
  });

  it('batches every header of a profile into that one rule', () => {
    const p = profile({
      headers: [
        header({ id: 'a', name: 'Authorization', value: 'Bearer x' }),
        header({ id: 'b', name: 'X-Tenant-Id', value: 'musinsa-dev' }),
        header({ id: 'c', target: 'response', name: 'Cache-Control', value: 'no-store' }),
      ],
    });
    const out = compile(state({ profiles: [p] }));
    expect(out.dynamic).toHaveLength(1);
    expect(out.dynamic[0]!.action.requestHeaders).toHaveLength(2);
    expect(out.dynamic[0]!.action.responseHeaders).toHaveLength(1);
  });

  it('produces a complete, well-formed rule', () => {
    expect(compile(state()).dynamic[0]!).toEqual({
      id: 1,
      priority: 1,
      condition: {
        requestDomains: ['api.example.com'],
        resourceTypes: ['xmlhttprequest'],
      },
      action: {
        type: 'modifyHeaders',
        requestHeaders: [{ header: 'X-Debug-Mode', operation: 'set', value: 'true' }],
      },
    });
  });

  it('routes a tab-locked profile into session with tabIds', () => {
    const p = profile({ tabLock: { enabled: true, tabId: 42, tabTitle: 'Checkout' } });
    const out = compile(state({ profiles: [p] }));
    expect(out.dynamic).toHaveLength(0);
    expect(out.session).toHaveLength(1);
    expect(out.session[0]!.condition.tabIds).toEqual([42]);
    expect(out.session[0]!.id).toBe(10_000);
  });

  it('skips a profile whose enabled headers compile to nothing', () => {
    const p = profile({ headers: [header({ enabled: false })] });
    expect(compile(state({ profiles: [p] })).dynamic).toHaveLength(0);
  });

  it('skips disabled profiles', () => {
    expect(compile(state({ profiles: [profile({ enabled: false })] })).dynamic).toHaveLength(0);
  });

  it('suppresses a profile whose only domain is non-ASCII, rather than matching every site', () => {
    const p = profile({
      filter: {
        mode: 'structured', domains: ['한국.com'],
        excludedDomains: [], resourceTypes: ['xmlhttprequest'],
      },
    });
    const out = compile(state({ profiles: [p] }));
    expect(out.dynamic).toHaveLength(0);
    expect(out.session).toHaveLength(0);
  });

  it('suppresses a profile when any one of several domains is invalid', () => {
    const p = profile({
      filter: {
        mode: 'structured', domains: ['api.example.com', '한국.com'],
        excludedDomains: [], resourceTypes: ['xmlhttprequest'],
      },
    });
    const out = compile(state({ profiles: [p] }));
    expect(out.dynamic).toHaveLength(0);
  });

  it('does not let one profile\'s invalid domain suppress the others', () => {
    const bad = profile({
      id: 'bad', order: 0,
      filter: {
        mode: 'structured', domains: ['한국.com'],
        excludedDomains: [], resourceTypes: ['xmlhttprequest'],
      },
    });
    const good = profile({ id: 'good', order: 1 });
    const out = compile(state({ profiles: [bad, good] }));
    expect(out.dynamic).toHaveLength(1);
    expect(out.dynamic[0]!.condition.requestDomains).toEqual(['api.example.com']);
  });

  it('emits no rules at all when globalPause is on', () => {
    const out = compile(state({ globalPause: true }));
    expect(out.dynamic).toHaveLength(0);
    expect(out.session).toHaveLength(0);
  });

  it('still reports requiredOrigins while paused, so the UI stays informative', () => {
    expect(compile(state({ globalPause: true })).requiredOrigins)
      .toEqual(['*://*.api.example.com/*']);
  });

  it('collects requiredOrigins across profiles without duplicates', () => {
    const out = compile(state({
      profiles: [
        profile({ id: 'a', order: 0 }),
        profile({ id: 'b', order: 1 }),
      ],
    }));
    expect(out.requiredOrigins).toEqual(['*://*.api.example.com/*']);
  });

  it('gives the earlier profile the higher priority', () => {
    const out = compile(state({
      profiles: [
        profile({ id: 'a', order: 0 }),
        profile({ id: 'b', order: 1 }),
      ],
    }));
    expect(out.dynamic[0]!.priority).toBeGreaterThan(out.dynamic[1]!.priority);
  });

  it('returns an empty diagnostics array in phase 1', () => {
    expect(compile(state()).diagnostics).toEqual([]);
  });

  it('is pure — the same input yields a deeply equal result', () => {
    const s = state();
    expect(compile(s)).toEqual(compile(s));
  });

  it('does not mutate its input', () => {
    const s = state();
    const snapshot = structuredClone(s);
    compile(s);
    expect(s).toEqual(snapshot);
  });
});
