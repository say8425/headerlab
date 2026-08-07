import { describe, expect, it } from 'vitest';
import { routeDiagnostics, ruleTally } from '@/lib/view/rules';
import type { Diagnostic, HeaderRule } from '@/lib/model/types';

function row(over: Partial<HeaderRule> = {}): HeaderRule {
  return {
    id: 'h1', enabled: true, target: 'request',
    operation: 'set', name: 'X-Test', value: 'v',
    ...over,
  };
}

function diag(over: Partial<Diagnostic> = {}): Diagnostic {
  return {
    kind: 'no-scope', severity: 'warning', profileId: 'p1',
    message: 'm',
    ...over,
  };
}

describe('routeDiagnostics', () => {
  it('sends each diagnostic to exactly one of the three places, by field', () => {
    // One call covering all three destinations rather than three calls covering
    // one each: what has to hold is that a mixed batch *splits*, and a
    // per-destination fixture would pass an implementation that copied every
    // diagnostic into every bucket.
    const onRule = diag({ kind: 'invalid-header-name', severity: 'error', headerRuleId: 'h1' });
    const onHost = diag({ kind: 'permission-missing', host: 'api.example.com' });
    const onScreen = diag({ kind: 'no-scope' });
    const routed = routeDiagnostics([onRule, onHost, onScreen]);

    expect([...routed.byRow.entries()]).toEqual([['h1', [onRule]]]);
    expect([...routed.byHost.entries()]).toEqual([['api.example.com', [onHost]]]);
    expect(routed.scope).toEqual([onScreen]);
  });

  it('files a diagnostic naming both a rule and a host with the rule', () => {
    // The tie-break, stated rather than left to declaration order: a problem
    // about a specific rule belongs beside that rule, where it can be acted on.
    const both = diag({ severity: 'error', headerRuleId: 'h1', host: 'api.example.com' });
    const routed = routeDiagnostics([both]);
    expect(routed.byRow.get('h1')).toEqual([both]);
    expect(routed.byHost.size).toBe(0);
  });

  it('routes an unknown future kind by the same rule', () => {
    // The point of routing on the fields rather than a kind table: a kind this
    // code has never heard of still lands somewhere sensible.
    const future = { ...diag(), kind: 'not-a-real-kind' } as unknown as Diagnostic;
    expect(routeDiagnostics([future]).scope).toEqual([future]);
  });

  it('collects several diagnostics on one rule, in input order', () => {
    const a = diag({ kind: 'invalid-header-name', severity: 'error', headerRuleId: 'h1' });
    const b = diag({ kind: 'duplicate-header', severity: 'error', headerRuleId: 'h1' });
    expect(routeDiagnostics([a, b]).byRow.get('h1')).toEqual([a, b]);
  });

  it('collects several diagnostics on one host, in input order', () => {
    const a = diag({ kind: 'permission-missing', host: 'api.example.com' });
    const b = diag({ kind: 'invalid-domain', severity: 'error', host: 'api.example.com' });
    expect(routeDiagnostics([a, b]).byHost.get('api.example.com')).toEqual([a, b]);
  });

  it('keeps two hosts apart', () => {
    // A single-host fixture would pass an implementation that keyed everything
    // under one bucket.
    const a = diag({ kind: 'permission-missing', host: 'a.example.com' });
    const b = diag({ kind: 'permission-missing', host: 'b.example.com' });
    const routed = routeDiagnostics([a, b]);
    expect(routed.byHost.get('a.example.com')).toEqual([a]);
    expect(routed.byHost.get('b.example.com')).toEqual([b]);
  });

  it('returns empty collections for no diagnostics', () => {
    const routed = routeDiagnostics([]);
    expect(routed.byRow.size).toBe(0);
    expect(routed.byHost.size).toBe(0);
    expect(routed.scope).toEqual([]);
  });
});

describe('ruleTally', () => {
  // `live` says whether compile() emits any rule at all for the one rule set
  // this popup shows. Cases about row state pass the live one.
  const live = { live: true };

  it('splits a mixed set four ways, and the four account for every rule', () => {
    // One fixture rather than four, on purpose: the readout shows every figure
    // at once, so what has to hold is that the same set of rules produces them
    // all correctly *together*. A per-figure fixture lets an implementation
    // that double-counts — a switched-off broken rule landing in both `off`
    // and `blocked` — pass every case separately.
    //
    // **Two warnings against one error, deliberately.** With one of each, an
    // implementation that swapped the two severities would move the same rule
    // count between `live` and `blocked` in both directions at once and land on
    // identical figures — the mutation would be invisible. Asymmetric counts
    // are what make the severity rule observable from the outside: correct is
    // 4 live / 1 blocked, and treating warnings as blocking gives 3 / 2.
    const rows = [
      row({ id: 'clean-a' }),
      row({ id: 'clean-b' }),
      row({ id: 'warned-a' }),
      row({ id: 'warned-b' }),
      row({ id: 'broken' }),
      row({ id: 'unnamed' }),
      row({ id: 'switched-off', enabled: false }),
    ];
    const byRow = new Map([
      // A warning does not stop a rule going out — that is what makes it a
      // warning — so both of these must land in `live`, not `blocked`.
      ['warned-a', [diag({ severity: 'warning', headerRuleId: 'warned-a' })]],
      ['warned-b', [diag({ severity: 'warning', headerRuleId: 'warned-b' })]],
      ['broken', [diag({ severity: 'error', headerRuleId: 'broken' })]],
      // Not going out either, but not blocked: nothing is stopping it, it is
      // simply not a rule yet. Counting it as blocked is what put a red error
      // on a row created one click ago.
      ['unnamed', [diag({
        kind: 'incomplete-header', severity: 'incomplete', headerRuleId: 'unnamed',
      })]],
    ]);
    expect(ruleTally(rows, byRow, live)).toEqual({
      total: 7, live: 4, off: 1, unfinished: 1, blocked: 1,
    });
  });

  it('counts a switched-off broken rule once, as off rather than blocked', () => {
    // "Blocked" means the user asked for this and it is not happening. A rule
    // they switched off themselves is not that, and counting it in both figures
    // would report more rules than exist.
    const rows = [row({ id: 'a', enabled: false })];
    const byRow = new Map([['a', [diag({ severity: 'error', headerRuleId: 'a' })]]]);
    expect(ruleTally(rows, byRow, live)).toEqual({ total: 1, live: 0, off: 1, unfinished: 0, blocked: 0 });
  });

  it('blocks every switched-on rule when the set emits nothing, while off stays off', () => {
    // Suppression, globalPause and a switched-off rule set each stop the whole
    // compile without producing any rule-level diagnostic, so `byRow` is empty
    // and every rule here looks healthy. This is the case the old footer got
    // wrong in the other direction, reporting rules as applying while zero were
    // registered — here they must all read as blocked, and the rules the user
    // switched off must still read as off rather than being swept in.
    const rows = [
      row({ id: 'a' }),
      row({ id: 'b' }),
      row({ id: 'c', enabled: false }),
    ];
    expect(ruleTally(rows, new Map(), { live: false })).toEqual({
      total: 3, live: 0, off: 1, unfinished: 0, blocked: 2,
    });
  });

  it('keeps an unfinished rule unfinished while the set is paused, rather than calling it blocked', () => {
    // compile() emits diagnostics regardless of globalPause (compile.ts:38-40),
    // so the incomplete diagnostic is still here when nothing is going out.
    // "Blocked" would tell the user the pause is what stops this rule; nothing
    // stops an unnamed rule but the missing name, and that stays true whether
    // the set is running or not. The second row is what makes the distinction
    // observable — it really is blocked by the pause, and the two must not
    // collapse into one figure.
    const rows = [row({ id: 'unnamed' }), row({ id: 'ready' })];
    const byRow = new Map([
      ['unnamed', [diag({
        kind: 'incomplete-header', severity: 'incomplete', headerRuleId: 'unnamed',
      })]],
    ]);
    expect(ruleTally(rows, byRow, { live: false })).toEqual({
      total: 2, live: 0, off: 0, unfinished: 1, blocked: 1,
    });
  });

  it('counts a switched-off unnamed rule once, as off rather than unfinished', () => {
    // Two reasons the same row sends nothing must not become two labels. The
    // model already settles this by staying silent on disabled rows
    // (validateHeaders), so `byRow` is empty here and the rule files under the
    // reason the user actually chose. This pins the tally agreeing with that
    // rather than re-deriving "unnamed" from the row itself.
    const rows = [row({ id: 'a', enabled: false, name: '' })];
    expect(ruleTally(rows, new Map(), live)).toEqual({
      total: 1, live: 0, off: 1, unfinished: 0, blocked: 0,
    });
  });

  it('does not treat a warning or an error as unfinished', () => {
    // The three not-live states are told apart by severity alone, so each must
    // stay in its own column. A `some()` written against the wrong field would
    // sweep all of these into one.
    const rows = [row({ id: 'warned' }), row({ id: 'broken' })];
    const byRow = new Map([
      ['warned', [diag({ severity: 'warning', headerRuleId: 'warned' })]],
      ['broken', [diag({ severity: 'error', headerRuleId: 'broken' })]],
    ]);
    expect(ruleTally(rows, byRow, live)).toEqual({
      total: 2, live: 1, off: 0, unfinished: 0, blocked: 1,
    });
  });

  it('counts nothing for an empty rule set', () => {
    expect(ruleTally([], new Map(), live)).toEqual({
      total: 0, live: 0, off: 0, unfinished: 0, blocked: 0,
    });
  });
});
