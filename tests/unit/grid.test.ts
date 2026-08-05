import { describe, expect, it } from 'vitest';
import {
  groupRows,
  routeDiagnostics,
  profileMarker,
  groupCounts,
  ruleTally,
} from '@/lib/view/grid';
import { createProfile } from '@/lib/model/defaults';
import type { Diagnostic, HeaderRule, Profile } from '@/lib/model/types';

function row(over: Partial<HeaderRule> = {}): HeaderRule {
  return {
    id: 'h1', enabled: true, target: 'request',
    operation: 'set', name: 'X-Test', value: 'v',
    ...over,
  };
}

function profileWith(headers: HeaderRule[]): Profile {
  return { ...createProfile('P', 0), id: 'p1', headers };
}

function diag(over: Partial<Diagnostic> = {}): Diagnostic {
  return {
    kind: 'empty-filter', severity: 'warning', profileId: 'p1',
    message: 'm',
    ...over,
  };
}

describe('groupRows', () => {
  it('splits by target, preserving order within each group', () => {
    const p = profileWith([
      row({ id: 'a', target: 'request' }),
      row({ id: 'b', target: 'response' }),
      row({ id: 'c', target: 'request' }),
    ]);
    expect(groupRows(p)).toEqual({
      request: [expect.objectContaining({ id: 'a' }), expect.objectContaining({ id: 'c' })],
      response: [expect.objectContaining({ id: 'b' })],
    });
  });

  it('returns empty arrays, not undefined, when a group has no rows', () => {
    expect(groupRows(profileWith([row({ target: 'request' })]))).toEqual({
      request: [expect.objectContaining({ id: 'h1' })],
      response: [],
    });
  });

  it('keeps disabled rows — they are shown, just switched off', () => {
    const p = profileWith([row({ id: 'a', enabled: false })]);
    expect(groupRows(p).request).toHaveLength(1);
  });

  it('does not mutate the profile it is given', () => {
    const p = profileWith([row({ id: 'b', target: 'response' }), row({ id: 'a' })]);
    const before = p.headers.map((h) => h.id);
    groupRows(p);
    expect(p.headers.map((h) => h.id)).toEqual(before);
  });
});

describe('routeDiagnostics', () => {
  it('routes by headerRuleId presence, not by kind', () => {
    const withRow = diag({ kind: 'invalid-header-name', severity: 'error', headerRuleId: 'h1' });
    const withoutRow = diag({ kind: 'empty-filter' });
    const routed = routeDiagnostics([withRow, withoutRow]);

    expect([...routed.byRow.keys()]).toEqual(['h1']);
    expect(routed.byRow.get('h1')).toEqual([withRow]);
    expect(routed.profileLevel).toEqual([withoutRow]);
  });

  it('routes an unknown future kind by the same rule', () => {
    // The point of routing on the field rather than a kind table: a kind this
    // code has never heard of still lands somewhere sensible.
    const future = { ...diag(), kind: 'not-a-real-kind' } as unknown as Diagnostic;
    expect(routeDiagnostics([future]).profileLevel).toEqual([future]);
  });

  it('collects several diagnostics on one row, in input order', () => {
    const a = diag({ kind: 'invalid-header-name', severity: 'error', headerRuleId: 'h1' });
    const b = diag({ kind: 'duplicate-header', severity: 'error', headerRuleId: 'h1' });
    expect(routeDiagnostics([a, b]).byRow.get('h1')).toEqual([a, b]);
  });

  it('returns an empty map and empty list for no diagnostics', () => {
    const routed = routeDiagnostics([]);
    expect(routed.byRow.size).toBe(0);
    expect(routed.profileLevel).toEqual([]);
  });
});

describe('profileMarker', () => {
  const alive = { suppressed: false };

  it('is null when that profile has nothing', () => {
    expect(profileMarker([diag({ profileId: 'other' })], 'p1', alive)).toBeNull();
  });

  it('is error when the profile has any error-severity diagnostic', () => {
    expect(profileMarker([diag({ severity: 'error' })], 'p1', alive)).toBe('error');
  });

  it('is permission when the only thing wrong is permission-missing', () => {
    expect(profileMarker([diag({ kind: 'permission-missing' })], 'p1', alive)).toBe('permission');
  });

  it('prefers error over permission when both are present', () => {
    const d = [diag({ kind: 'permission-missing' }), diag({ severity: 'error' })];
    expect(profileMarker(d, 'p1', alive)).toBe('error');
  });

  it('is null for a warning that is not permission-missing', () => {
    // port-ignored is a warning worth showing in the band, but it does not
    // mean the profile is broken, so the tab stays clean.
    expect(profileMarker([diag({ kind: 'port-ignored' })], 'p1', alive)).toBeNull();
  });

  it('ignores diagnostics belonging to another profile', () => {
    expect(profileMarker([diag({ severity: 'error', profileId: 'p2' })], 'p1', alive)).toBeNull();
  });

  it('is error for a suppressed profile whose only diagnostic is a warning', () => {
    // The combination the severity rule alone cannot see: a profile with every
    // domain invalid is suppressed — compile() emits no rule for it — but the
    // diagnostic it earns is `empty-filter` at severity `warning`, so the tab
    // stayed clean while the profile was dead. Splitting `empty-filter` is
    // deferred to 2c (spec §9), so the marker gets the liveness instead.
    expect(profileMarker([diag({ kind: 'empty-filter' })], 'p1', { suppressed: true })).toBe('error');
  });

  it('is error for a suppressed profile with no diagnostics of its own at all', () => {
    // Not a variation of the case above: this one pins that the marker comes
    // from the suppression itself, not from finding some diagnostic and
    // upgrading it. A profile whose diagnostics were all routed elsewhere must
    // still be marked.
    expect(profileMarker([], 'p1', { suppressed: true })).toBe('error');
  });

  it('does not mark other profiles when this one is suppressed', () => {
    // `suppressed` describes the profile named by profileId, so it must not
    // leak into the answer for a different id.
    expect(profileMarker([diag({ profileId: 'p2' })], 'p2', { suppressed: false })).toBeNull();
  });
});

describe('groupCounts', () => {
  // `live` says whether compile() emits any rule for the profile these rows
  // belong to. Every case below that is about row state passes the live one.
  const live = { live: true };

  it('counts a clean group as all applying', () => {
    const rows = [row({ id: 'a' }), row({ id: 'b' })];
    expect(groupCounts(rows, new Map(), live)).toEqual({ total: 2, applying: 2, off: 0 });
  });

  it('counts a disabled row as off, not applying', () => {
    const rows = [row({ id: 'a' }), row({ id: 'b', enabled: false })];
    expect(groupCounts(rows, new Map(), live)).toEqual({ total: 2, applying: 1, off: 1 });
  });

  it('does not count a row with an error diagnostic as applying', () => {
    const rows = [row({ id: 'a' }), row({ id: 'b' })];
    const byRow = new Map([['b', [diag({ severity: 'error', headerRuleId: 'b' })]]]);
    expect(groupCounts(rows, byRow, live)).toEqual({ total: 2, applying: 1, off: 0 });
  });

  it('still counts a row with only a warning as applying', () => {
    const rows = [row({ id: 'a' })];
    const byRow = new Map([['a', [diag({ severity: 'warning', headerRuleId: 'a' })]]]);
    expect(groupCounts(rows, byRow, live)).toEqual({ total: 1, applying: 1, off: 0 });
  });

  it('counts a disabled row with an error as off, once', () => {
    const rows = [row({ id: 'a', enabled: false })];
    const byRow = new Map([['a', [diag({ severity: 'error', headerRuleId: 'a' })]]]);
    expect(groupCounts(rows, byRow, live)).toEqual({ total: 1, applying: 0, off: 1 });
  });

  it('counts nothing for an empty group', () => {
    expect(groupCounts([], new Map(), live)).toEqual({ total: 0, applying: 0, off: 0 });
  });

  it('counts nothing as applying when the profile emits no rules', () => {
    // The two judgements that kill a whole profile — suppression and
    // globalPause — are not row-level, so no row-level diagnostic reaches
    // `byRow` and every row here looks perfectly healthy. Without `live` the
    // screen says "2 of 2 applying" while compile() registered zero rules.
    const rows = [row({ id: 'a' }), row({ id: 'b' })];
    expect(groupCounts(rows, new Map(), { live: false })).toEqual({
      total: 2, applying: 0, off: 0,
    });
  });

  it('still reports rows the user switched off as off when the profile emits no rules', () => {
    // `off` means "the user turned this row off" and stays true regardless of
    // whether the profile is live — zeroing it too would say the rows are
    // switched on when they are not.
    const rows = [row({ id: 'a' }), row({ id: 'b', enabled: false })];
    expect(groupCounts(rows, new Map(), { live: false })).toEqual({
      total: 2, applying: 0, off: 1,
    });
  });
});

describe('ruleTally', () => {
  // `live` says whether compile() emits any rule at all for the one rule set
  // this popup shows. Cases about row state pass the live one.
  const live = { live: true };

  it('splits a mixed set into live, off and blocked, and the three account for every rule', () => {
    // One fixture rather than four, on purpose: the readout shows all three
    // figures at once, so what has to hold is that the same set of rules
    // produces all three correctly *together*. A per-figure fixture lets an
    // implementation that double-counts — a switched-off broken row landing in
    // both `off` and `blocked` — pass every case separately.
    const rows = [
      row({ id: 'clean-a' }),
      row({ id: 'clean-b' }),
      row({ id: 'warned' }),
      row({ id: 'broken' }),
      row({ id: 'switched-off', enabled: false }),
    ];
    const byRow = new Map([
      // A warning does not stop a rule going out — that is what makes it a
      // warning — so `warned` must land in `live`, not `blocked`.
      ['warned', [diag({ severity: 'warning', headerRuleId: 'warned' })]],
      ['broken', [diag({ severity: 'error', headerRuleId: 'broken' })]],
    ]);
    expect(ruleTally(rows, byRow, live)).toEqual({
      total: 5, live: 3, off: 1, blocked: 1,
    });
  });

  it('counts a switched-off broken row once, as off rather than blocked', () => {
    // "Blocked" means the user asked for this and it is not happening. A row
    // they switched off themselves is not that, and counting it in both
    // figures would report more rules than exist.
    const rows = [row({ id: 'a', enabled: false })];
    const byRow = new Map([['a', [diag({ severity: 'error', headerRuleId: 'a' })]]]);
    expect(ruleTally(rows, byRow, live)).toEqual({ total: 1, live: 0, off: 1, blocked: 0 });
  });

  it('blocks every switched-on rule when the rule set emits nothing, while off stays off', () => {
    // Suppression, globalPause and a switched-off rule set each stop the whole
    // compile without producing any row-level diagnostic, so `byRow` is empty
    // and every row here looks healthy. This is the case the old footer got
    // wrong in the other direction, reporting rules as applying while zero
    // were registered — here they must all read as blocked, and the rows the
    // user switched off must still read as off rather than being swept in.
    const rows = [
      row({ id: 'a' }),
      row({ id: 'b' }),
      row({ id: 'c', enabled: false }),
    ];
    expect(ruleTally(rows, new Map(), { live: false })).toEqual({
      total: 3, live: 0, off: 1, blocked: 2,
    });
  });

  it('counts nothing for an empty rule set', () => {
    expect(ruleTally([], new Map(), live)).toEqual({ total: 0, live: 0, off: 0, blocked: 0 });
  });
});
