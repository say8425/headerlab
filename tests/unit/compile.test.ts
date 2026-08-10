import { describe, expect, it } from 'vitest';
import { compile } from '@/lib/compile/compile';
import type { AppState, HeaderRule, Profile } from '@/lib/model/types';

function header(over: Partial<HeaderRule> = {}): HeaderRule {
  return {
    id: 'h1',
    enabled: true,
    target: 'request',
    operation: 'set',
    name: 'X-Debug-Mode',
    value: 'true',
    ...over,
  };
}

function profile(over: Partial<Profile> = {}): Profile {
  return {
    id: 'p1',
    name: 'Local',
    color: 'green',
    enabled: true,
    order: 0,
    filter: {
      mode: 'structured',
      allSites: false,
      domains: ['api.example.com'],
      excludedDomains: [],
      resourceTypes: ['xmlhttprequest'],
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
        mode: 'structured',
        allSites: false,
        domains: ['한국.com'],
        excludedDomains: [],
        resourceTypes: ['xmlhttprequest'],
      },
    });
    const out = compile(state({ profiles: [p] }));
    expect(out.dynamic).toHaveLength(0);
    expect(out.session).toHaveLength(0);
  });

  it('suppresses a profile when any one of several domains is invalid', () => {
    const p = profile({
      filter: {
        mode: 'structured',
        allSites: false,
        domains: ['api.example.com', '한국.com'],
        excludedDomains: [],
        resourceTypes: ['xmlhttprequest'],
      },
    });
    const out = compile(state({ profiles: [p] }));
    expect(out.dynamic).toHaveLength(0);
  });

  it("does not let one profile's invalid domain suppress the others", () => {
    const bad = profile({
      id: 'bad',
      order: 0,
      filter: {
        mode: 'structured',
        allSites: false,
        domains: ['한국.com'],
        excludedDomains: [],
        resourceTypes: ['xmlhttprequest'],
      },
    });
    const good = profile({ id: 'good', order: 1 });
    const out = compile(state({ profiles: [bad, good] }));
    expect(out.dynamic).toHaveLength(1);
    expect(out.dynamic[0]!.condition.requestDomains).toEqual(['api.example.com']);
  });

  it('compiles a rule that matches every site when all-sites is on', () => {
    // The boundary isSuppressed turns on, and the half that survived the
    // change. A rule with no domain condition is still exactly what
    // "everywhere" compiles to — it is now reached by asking for it rather
    // than by leaving the list empty.
    const base = profile();
    const result = compile(
      state({
        profiles: [profile({ filter: { ...base.filter, allSites: true, domains: [] } })],
      }),
    );
    expect(result.dynamic).toHaveLength(1);
    expect(result.dynamic[0]!.condition.requestDomains).toBeUndefined();
    // Nothing to report: applying everywhere is what was asked for.
    expect(result.diagnostics).toEqual([]);
  });

  it('ignores the stored site list while all-sites is on, rather than narrowing to it', () => {
    // The list is kept so the switch is reversible, and compiled by nothing.
    // Without this a profile could read "all sites" on screen and register a
    // rule scoped to one host — the screen and the wire disagreeing, which is
    // the defect class this project is organized around.
    const base = profile();
    const result = compile(
      state({
        profiles: [
          profile({
            filter: { ...base.filter, allSites: true, domains: ['api.example.com'] },
          }),
        ],
      }),
    );
    expect(result.dynamic[0]!.condition.requestDomains).toBeUndefined();
    expect(result.requiredOrigins).toEqual(['<all_urls>']);
  });

  it('compiles nothing at all when all-sites is off and no site is named', () => {
    // The other half, and the behaviour change. v1 read this as "everywhere";
    // it now means what it looks like. Emitting a rule here would apply the
    // user's headers to every site on the strength of a list they never
    // filled in.
    const base = profile();
    const result = compile(
      state({
        profiles: [profile({ filter: { ...base.filter, allSites: false, domains: [] } })],
      }),
    );
    expect(result.dynamic).toEqual([]);
    // Said out loud, and calmly: nothing is wrong, nothing is at risk, and
    // there is nothing being applied to be quiet about.
    expect(result.diagnostics.map((d) => d.kind)).toEqual(['no-scope']);
    expect(result.diagnostics[0]?.severity).toBe('incomplete');
    // And it asks for no grant, because it registers no rule.
    expect(result.requiredOrigins).toEqual([]);
  });

  it('emits no rules at all when globalPause is on', () => {
    const out = compile(state({ globalPause: true }));
    expect(out.dynamic).toHaveLength(0);
    expect(out.session).toHaveLength(0);
  });

  it('still reports requiredOrigins while paused, so the UI stays informative', () => {
    expect(compile(state({ globalPause: true })).requiredOrigins).toEqual([
      '*://*.api.example.com/*',
    ]);
  });

  it('collects requiredOrigins across profiles without duplicates', () => {
    const out = compile(
      state({
        profiles: [profile({ id: 'a', order: 0 }), profile({ id: 'b', order: 1 })],
      }),
    );
    expect(out.requiredOrigins).toEqual(['*://*.api.example.com/*']);
  });

  it('gives the earlier profile the higher priority', () => {
    const out = compile(
      state({
        profiles: [profile({ id: 'a', order: 0 }), profile({ id: 'b', order: 1 })],
      }),
    );
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
    const result = compile(
      state({
        profiles: [
          profile({
            headers: [header({ id: 'h1', name: '' }), header({ id: 'h2', name: 'X-Ok' })],
          }),
        ],
      }),
    );
    // Exact length, not just toContain: a duplicate push of the same kind
    // (e.g. validateHeaders called twice for this profile) would slip past a
    // toContain check but not this one.
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.kind).toBe('incomplete-header');
    expect(result.dynamic).toHaveLength(1);
  });

  it('reports an unusable site as an error on the profile it suppresses', () => {
    // Was filed as `empty-filter`/`warning`, which put a profile applying to
    // *nothing* under the same kind and severity as one applying to
    // everything. Nothing is being modified here and the cause is a value the
    // user can fix, so it is an error and it names the entry.
    const base = profile();
    const result = compile(
      state({
        profiles: [profile({ filter: { ...base.filter, domains: ['a b.com'] } })],
      }),
    );
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.kind).toBe('invalid-domain');
    expect(result.diagnostics[0]?.severity).toBe('error');
    expect(result.dynamic).toHaveLength(0);
  });

  it('reports a conflict between two profiles', () => {
    const result = compile(
      state({
        profiles: [
          profile({
            id: 'p1',
            name: 'Local',
            order: 0,
            headers: [header({ name: 'Authorization' })],
          }),
          profile({
            id: 'p2',
            name: 'Staging',
            order: 1,
            headers: [header({ name: 'Authorization' })],
          }),
        ],
      }),
    );
    // Exact length pins detectConflicts being called once, outside the
    // per-profile loop — calling it once per profile would duplicate this
    // entry, which a toContain check would not catch.
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.kind).toBe('profile-conflict');
    // The severity boundary this test's name doesn't say it covers:
    // `profile-conflict` is `warning`, not `error` (lib/compile/conflicts.ts),
    // so `hasRowError` must not treat either row as diagnosed and neither
    // header may be dropped from compilation — a conflict is advisory, only
    // an error-severity row is excluded. Both profiles still produce a rule
    // carrying its own Authorization header.
    expect(result.dynamic).toHaveLength(2);
    expect(result.dynamic.map((r) => r.action.requestHeaders)).toEqual([
      [{ header: 'Authorization', operation: 'set', value: 'true' }],
      [{ header: 'Authorization', operation: 'set', value: 'true' }],
    ]);
  });

  it('keeps diagnostics when globalPause is on — the user still needs to see them', () => {
    const result = compile(
      state({
        globalPause: true,
        profiles: [profile({ headers: [header({ name: '' })] })],
      }),
    );
    expect(result.dynamic).toHaveLength(0);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.kind).toBe('incomplete-header');
  });

  it("does not go silent when only some of a profile's domains are usable", () => {
    // The regression this whole fix exists for: the rule does not go out, the
    // header row is fine, the profile is enabled — and before this, nothing
    // said so. Both halves are asserted because either one alone passes today.
    const base = profile();
    const result = compile(
      state({
        profiles: [
          profile({
            filter: { ...base.filter, domains: ['api.example.com', 'a b.com'] },
          }),
        ],
      }),
    );
    expect(result.dynamic).toHaveLength(0);
    expect(result.session).toHaveLength(0);
    expect(result.diagnostics).toEqual([
      {
        kind: 'invalid-domain',
        severity: 'error',
        profileId: 'p1',
        message:
          'Unusable site: "a b.com". A site must be a bare hostname like example.com. ' +
          'No rule is applied until every site here is usable.',
      },
    ]);
  });

  it('never lets a pattern that permissions.contains() rejects reach requiredOrigins', () => {
    // Measured in docs/research/2026-08-01-permission-audit-spike.md §3: one
    // entry that throws poisons the whole permissions call this field feeds.
    // The scheme fixture that used to stand here is normalized to a host now,
    // so the surviving hazard is an entry no normalization can rescue.
    const base = profile();
    const result = compile(
      state({
        profiles: [
          profile({
            filter: { ...base.filter, domains: ['api.example.com', 'a b.com'] },
          }),
        ],
      }),
    );
    expect(result.requiredOrigins).toEqual(['*://*.api.example.com/*']);
  });

  it('lets a pasted URL through as its host, rather than dropping it', () => {
    // The other side of that rule, and the owner's actual input. Normalizing
    // is what stops a paste becoming either a never-matching rule or a
    // throwing permissions call.
    const base = profile();
    const result = compile(
      state({
        profiles: [
          profile({
            filter: { ...base.filter, domains: ['https://www.musinsa.com/'] },
          }),
        ],
      }),
    );
    expect(result.requiredOrigins).toEqual(['*://*.www.musinsa.com/*']);
    expect(result.dynamic).toHaveLength(1);
  });

  it('asks for no origin at all when no domain is usable, because it registers no rule', () => {
    // This used to demand `<all_urls>` — the broadest grant the browser can
    // give — on behalf of a profile the compiler suppresses and never emits.
    // The grant would have bought nothing and cost everything.
    const base = profile();
    const result = compile(
      state({
        profiles: [
          profile({
            filter: { ...base.filter, domains: ['a b.com'] },
          }),
        ],
      }),
    );
    expect(result.requiredOrigins).toEqual([]);
  });

  it('does not say a profile both lost a conflict and was never applied', () => {
    // The review's §2(b) pair, verbatim. One compile() used to emit two
    // diagnostics that contradict each other: `empty-filter` telling the user
    // P0 is not applied, and `profile-conflict` telling them P0 won and
    // discarded P1's row. In reality only P1's rule reaches `dynamic` and its
    // header works fine. Asserted on compile() rather than detectConflicts
    // because the contradiction is a property of the pair, not of either one.
    const base = profile();
    const result = compile(
      state({
        profiles: [
          profile({
            id: 'p0',
            name: 'Broken',
            order: 0,
            filter: { ...base.filter, domains: ['a b.com'] },
            headers: [header({ name: 'Authorization' })],
          }),
          profile({
            id: 'p1',
            name: 'Staging',
            order: 1,
            filter: { ...base.filter, domains: ['x.com'] },
            headers: [header({ name: 'Authorization' })],
          }),
        ],
      }),
    );
    expect(result.diagnostics).toEqual([
      {
        kind: 'invalid-domain',
        severity: 'error',
        profileId: 'p0',
        message:
          'No usable site: "a b.com". Use a bare hostname like example.com. ' +
          'Nothing is applied while every site is unusable.',
      },
    ]);
    // And the half the diagnostics were lying about: P1 compiles and survives.
    expect(result.dynamic).toHaveLength(1);
    expect(result.dynamic[0]!.condition.requestDomains).toEqual(['x.com']);
  });

  it('does not go silent for a regex profile whose domains are all unusable', () => {
    // The second door to C1's silence. compile.ts's suppression ignores the
    // mode and conditions.ts sets requestDomains for a regex rule too, so this
    // profile dies — while validateFilter's regex branch returns before
    // `empty-filter` can fire.
    const base = profile();
    const result = compile(
      state({
        profiles: [
          profile({
            filter: { ...base.filter, mode: 'regex', regex: '^https://', domains: ['a b.com'] },
          }),
        ],
      }),
    );
    expect(result.dynamic).toHaveLength(0);
    expect(result.diagnostics).toEqual([
      {
        kind: 'invalid-domain',
        severity: 'error',
        profileId: 'p1',
        message:
          'No usable site: "a b.com". Use a bare hostname like example.com. ' +
          'Nothing is applied while every site is unusable.',
      },
    ]);
  });

  it('drops an append-not-allowed row from the compiled rule, but keeps its sibling and the diagnostic', () => {
    // The real bug (Task 12): compileHeaders used to compile every enabled
    // row regardless of what validateHeaders had just said about it, so a
    // row diagnosed error was shown to the user AND sent to Chrome — where
    // updateDynamicRules rejects the whole batch and the previously
    // registered rule stays in force. `append` on a request header outside
    // Chrome's 21-header allowlist is exactly that: diagnosed, and (before
    // this fix) compiled anyway.
    const p = profile({
      headers: [
        header({ id: 'bad', name: 'X-Custom', operation: 'append' }),
        header({ id: 'good', name: 'X-Ok', operation: 'set' }),
      ],
    });
    const result = compile(state({ profiles: [p] }));
    expect(result.diagnostics.map((d) => d.kind)).toEqual(['append-not-allowed']);
    expect(result.dynamic).toHaveLength(1);
    expect(result.dynamic[0]!.action.requestHeaders).toEqual([
      { header: 'X-Ok', operation: 'set', value: 'true' },
    ]);
  });

  it('drops a duplicate header row the same way, keeping the first occurrence', () => {
    const p = profile({
      headers: [
        header({ id: 'first', name: 'X-Dup', operation: 'set', value: 'a' }),
        header({ id: 'second', name: 'X-Dup', operation: 'set', value: 'b' }),
      ],
    });
    const result = compile(state({ profiles: [p] }));
    expect(result.diagnostics.map((d) => d.kind)).toEqual(['duplicate-header']);
    expect(result.dynamic[0]!.action.requestHeaders).toEqual([
      { header: 'X-Dup', operation: 'set', value: 'a' },
    ]);
  });

  it('suppresses only the diagnosed row, not the whole profile, when one row is bad and another is fine', () => {
    // The asymmetry CLAUDE.md states: headers skip per row, domains suppress
    // the whole profile. This is the row half.
    const p = profile({
      headers: [
        header({ id: 'bad', name: 'X-Custom', operation: 'append' }),
        header({ id: 'good', name: 'X-Ok', operation: 'set' }),
      ],
    });
    const result = compile(state({ profiles: [p] }));
    expect(result.dynamic).toHaveLength(1);
  });

  it("does not let a bad row in one profile suppress another profile's rows", () => {
    const bad = profile({
      id: 'bad',
      order: 0,
      headers: [header({ id: 'bad', name: 'X-Custom', operation: 'append' })],
    });
    const good = profile({ id: 'good', order: 1 });
    const result = compile(state({ profiles: [bad, good] }));
    // The bad profile's own row compiles to nothing, so it never emits a
    // rule at all — only the good profile's does.
    expect(result.dynamic).toHaveLength(1);
    expect(result.dynamic[0]!.action.requestHeaders).toEqual([
      { header: 'X-Debug-Mode', operation: 'set', value: 'true' },
    ]);
  });

  it('does not report on a disabled profile', () => {
    const base = profile();
    expect(
      compile(
        state({
          profiles: [
            profile({
              enabled: false,
              filter: { ...base.filter, domains: [] },
              headers: [header({ name: '' })],
            }),
          ],
        }),
      ).diagnostics,
    ).toEqual([]);
  });
});
