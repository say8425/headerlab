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

  it('still compiles a domainless profile into a rule that matches every site', () => {
    // The boundary isSuppressed turns on. An empty list is deliberately NOT
    // suppressed: it compiles to a rule with no domain condition, and
    // `empty-filter` is what tells the user how far that reaches. Suppressing
    // it instead would silently disable every profile not yet scoped to a host
    // — the same silence, entered from the other side.
    const base = profile();
    const result = compile(state({
      profiles: [profile({ filter: { ...base.filter, domains: [] } })],
    }));
    expect(result.dynamic).toHaveLength(1);
    expect(result.dynamic[0]!.condition.requestDomains).toBeUndefined();
    expect(result.diagnostics.map((d) => d.kind)).toEqual(['empty-filter']);
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

  it('returns no diagnostics for a clean default profile', () => {
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

describe('compile emits diagnostics', () => {
  it('reports a blank header name and still compiles the other rows', () => {
    const result = compile(state({
      profiles: [profile({
        headers: [
          header({ id: 'h1', name: '' }),
          header({ id: 'h2', name: 'X-Ok' }),
        ],
      })],
    }));
    // Exact length, not just toContain: a duplicate push of the same kind
    // (e.g. validateHeaders called twice for this profile) would slip past a
    // toContain check but not this one.
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.kind).toBe('invalid-header-name');
    expect(result.dynamic).toHaveLength(1);
  });

  it('reports an empty filter on the profile it suppresses', () => {
    const base = profile();
    const result = compile(state({
      profiles: [profile({ filter: { ...base.filter, domains: ['a b.com'] } })],
    }));
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.kind).toBe('empty-filter');
    expect(result.dynamic).toHaveLength(0);
  });

  it('reports a conflict between two profiles', () => {
    const result = compile(state({
      profiles: [
        profile({ id: 'p1', name: 'Local', order: 0, headers: [header({ name: 'Authorization' })] }),
        profile({ id: 'p2', name: 'Staging', order: 1, headers: [header({ name: 'Authorization' })] }),
      ],
    }));
    // Exact length pins detectConflicts being called once, outside the
    // per-profile loop — calling it once per profile would duplicate this
    // entry, which a toContain check would not catch.
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.kind).toBe('profile-conflict');
  });

  it('keeps diagnostics when globalPause is on — the user still needs to see them', () => {
    const result = compile(state({
      globalPause: true,
      profiles: [profile({ headers: [header({ name: '' })] })],
    }));
    expect(result.dynamic).toHaveLength(0);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.kind).toBe('invalid-header-name');
  });

  it('does not go silent when only some of a profile\'s domains are usable', () => {
    // The regression this whole fix exists for: the rule does not go out, the
    // header row is fine, the profile is enabled — and before this, nothing
    // said so. Both halves are asserted because either one alone passes today.
    const base = profile();
    const result = compile(state({
      profiles: [profile({
        filter: { ...base.filter, domains: ['api.example.com', 'https://staging.example.com'] },
      })],
    }));
    expect(result.dynamic).toHaveLength(0);
    expect(result.session).toHaveLength(0);
    expect(result.diagnostics).toEqual([{
      kind: 'invalid-domain',
      severity: 'error',
      profileId: 'p1',
      message:
        'Unusable domain: "https://staging.example.com". ' +
        'The whole profile is not applied until every domain in it is usable.',
    }]);
  });

  it('never lets a pattern that permissions.contains() rejects reach requiredOrigins', () => {
    // Measured in docs/research/2026-08-01-permission-audit-spike.md §3:
    // `*://*.https://x.com/*` throws Invalid port, and one throwing entry
    // poisons the whole permissions call Phase 2b will build on this field.
    const base = profile();
    const result = compile(state({
      profiles: [profile({
        filter: { ...base.filter, domains: ['api.example.com', 'https://staging.example.com'] },
      })],
    }));
    expect(result.requiredOrigins).toEqual(['*://*.api.example.com/*']);
  });

  it('falls back to <all_urls> when no domain is usable at all', () => {
    const base = profile();
    const result = compile(state({
      profiles: [profile({
        filter: { ...base.filter, domains: ['https://staging.example.com'] },
      })],
    }));
    expect(result.requiredOrigins).toEqual(['<all_urls>']);
  });

  it('does not report on a disabled profile', () => {
    const base = profile();
    expect(compile(state({
      profiles: [profile({
        enabled: false,
        filter: { ...base.filter, domains: [] },
        headers: [header({ name: '' })],
      })],
    })).diagnostics).toEqual([]);
  });
});
