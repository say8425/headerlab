import { describe, expect, it } from 'vitest';
import { detectConflicts } from '@/lib/compile/conflicts';
import { createProfile } from '@/lib/model/defaults';
import type { HeaderRule, Profile } from '@/lib/model/types';

function p(
  id: string,
  name: string,
  domains: string[],
  headers: Array<Partial<HeaderRule>>,
  order = 0,
): Profile {
  const base = createProfile(name, order);
  return {
    ...base,
    id,
    name,
    filter: { ...base.filter, domains },
    headers: headers.map((h, i) => ({
      id: `${id}-h${i}`,
      enabled: true,
      target: 'request',
      operation: 'set',
      name: 'X-Test',
      value: 'v',
      ...h,
    })),
  };
}

describe('detectConflicts', () => {
  it('is quiet for one profile', () => {
    expect(detectConflicts([p('a', 'A', ['x.com'], [{}])])).toEqual([]);
  });

  it('is quiet when domains do not overlap', () => {
    expect(
      detectConflicts([
        p('a', 'A', ['x.com'], [{ name: 'Authorization' }], 0),
        p('b', 'B', ['y.com'], [{ name: 'Authorization' }], 1),
      ]),
    ).toEqual([]);
  });

  it('flags the same header on overlapping domains, naming the winner', () => {
    const d = detectConflicts([
      p('a', 'Local', ['x.com'], [{ name: 'Authorization' }], 0),
      p('b', 'Staging', ['x.com'], [{ name: 'Authorization' }], 1),
    ]);
    expect(d).toHaveLength(1);
    expect(d[0]?.kind).toBe('profile-conflict');
    expect(d[0]?.severity).toBe('warning');
    // The diagnostic lands on the loser so the UI can mark the row that dies.
    expect(d[0]?.profileId).toBe('b');
    expect(d[0]?.message).toContain('Local');
  });

  it('treats append-after-append as compatible — Chrome allows it', () => {
    expect(
      detectConflicts([
        p('a', 'A', ['x.com'], [{ name: 'Accept', operation: 'append' }], 0),
        p('b', 'B', ['x.com'], [{ name: 'Accept', operation: 'append' }], 1),
      ]),
    ).toEqual([]);
  });

  it('treats append after set as compatible within one extension', () => {
    expect(
      detectConflicts([
        p('a', 'A', ['x.com'], [{ name: 'Accept', operation: 'set' }], 0),
        p('b', 'B', ['x.com'], [{ name: 'Accept', operation: 'append' }], 1),
      ]),
    ).toEqual([]);
  });

  it('flags anything after remove — remove allows nothing', () => {
    const d = detectConflicts([
      p('a', 'A', ['x.com'], [{ name: 'Accept', operation: 'remove' }], 0),
      p('b', 'B', ['x.com'], [{ name: 'Accept', operation: 'append' }], 1),
    ]);
    expect(d).toHaveLength(1);
    expect(d[0]?.profileId).toBe('b');
  });

  it('treats a regex-mode profile as potentially overlapping everything', () => {
    const a = p('a', 'A', ['x.com'], [{ name: 'Authorization' }], 0);
    const b = p('b', 'B', ['y.com'], [{ name: 'Authorization' }], 1);
    const bRegex: Profile = { ...b, filter: { ...b.filter, mode: 'regex', regex: '^https://' } };
    expect(detectConflicts([a, bRegex])).toHaveLength(1);
  });

  it('treats an all-sites profile as overlapping everything', () => {
    // Was spelled "domainless": an empty list used to be the only way to reach
    // a rule with no domain condition. It is reached by asking now, and an
    // empty list with all-sites off is suppressed and never gets here at all.
    const a = p('a', 'A', [], [{ name: 'Authorization' }], 0);
    expect(
      detectConflicts([
        { ...a, filter: { ...a.filter, allSites: true } },
        p('b', 'B', ['y.com'], [{ name: 'Authorization' }], 1),
      ]),
    ).toHaveLength(1);
  });

  it('treats an all-sites profile as overlapping even a host its own list does not name', () => {
    // The defect this guards. All-sites keeps the stored list and compiles
    // none of it, so a detector reading `filter.domains` would compare
    // `x.com` against `y.com`, find no overlap, and stay silent — while the
    // registered rule matches every site and Chrome silently discards B's
    // header. Mutation-checked by pointing `scopingHosts` back at the list.
    const a = p('a', 'A', ['x.com'], [{ name: 'Authorization' }], 0);
    expect(
      detectConflicts([
        { ...a, filter: { ...a.filter, allSites: true } },
        p('b', 'B', ['y.com'], [{ name: 'Authorization' }], 1),
      ]),
    ).toHaveLength(1);
    // The same pair with all-sites off is genuinely disjoint, so this cannot
    // pass by warning about everything.
    expect(detectConflicts([a, p('b', 'B', ['y.com'], [{ name: 'Authorization' }], 1)])).toEqual(
      [],
    );
  });

  it('says nothing about a profile that has no scope at all', () => {
    // Suppressed, so it emits no rule — and a profile that emits no rule can
    // neither discard a neighbour's row nor have its own discarded. Filing it
    // as a conflict would contradict the readout, which already reports that
    // this profile is not applied — it counts the rules as blocked.
    expect(
      detectConflicts([
        p('a', 'A', [], [{ name: 'Authorization' }], 0),
        p('b', 'B', ['y.com'], [{ name: 'Authorization' }], 1),
      ]),
    ).toEqual([]);
  });

  it('ignores disabled profiles and disabled rows', () => {
    const a = p('a', 'A', ['x.com'], [{ name: 'Authorization' }], 0);
    const b = p('b', 'B', ['x.com'], [{ name: 'Authorization', enabled: false }], 1);
    expect(detectConflicts([a, { ...b, enabled: true }])).toEqual([]);
    expect(detectConflicts([a, { ...b, enabled: false }])).toEqual([]);
    expect(detectConflicts([{ ...a, enabled: false }, b])).toEqual([]);
  });

  it('does not cross request and response headers', () => {
    expect(
      detectConflicts([
        p('a', 'A', ['x.com'], [{ name: 'X-Same', target: 'request' }], 0),
        p('b', 'B', ['x.com'], [{ name: 'X-Same', target: 'response' }], 1),
      ]),
    ).toEqual([]);
  });

  it('names the winner by `order`, not by array position', () => {
    // `allocate` sorts by `order` and gives the first one the highest priority,
    // so the profile with the lower `order` wins regardless of where it sits in
    // the array. Passing them array-reversed must not flip the verdict.
    const first = p('a', 'Local', ['x.com'], [{ name: 'Authorization' }], 0);
    const second = p('b', 'Staging', ['x.com'], [{ name: 'Authorization' }], 1);

    const d = detectConflicts([second, first]); // array order disagrees with `order`
    expect(d).toHaveLength(1);
    expect(d[0]?.profileId).toBe('b'); // Staging still loses
    expect(d[0]?.message).toContain('Local'); // Local is still named the winner
  });

  it('does not mutate the array it is given', () => {
    const list = [
      p('b', 'B', ['x.com'], [{ name: 'Authorization' }], 1),
      p('a', 'A', ['x.com'], [{ name: 'Authorization' }], 0),
    ];
    const before = list.map((x) => x.id);
    detectConflicts(list);
    expect(list.map((x) => x.id)).toEqual(before);
  });

  it('does not compare a later profile against an already-discarded loser', () => {
    // §7.2: only the operation that first touches a header ever reaches
    // Chrome's header state. P1's `remove` loses to P0's `append` and is
    // discarded — it never became real state, so P2 must not be compared
    // against it. P2 (append) is compatible with P0 (append), so it should
    // compile clean; only P1 should be flagged.
    const p0 = p('p0', 'P0', ['x.com'], [{ name: 'X-Test', operation: 'append' }], 0);
    const p1 = p('p1', 'P1', ['x.com'], [{ name: 'X-Test', operation: 'remove' }], 1);
    const p2 = p('p2', 'P2', ['x.com'], [{ name: 'X-Test', operation: 'append' }], 2);
    const d = detectConflicts([p0, p1, p2]);
    expect(d).toHaveLength(1);
    expect(d[0]?.profileId).toBe('p1');
  });

  it('treats a parent domain and its subdomain as overlapping (parent first)', () => {
    expect(
      detectConflicts([
        p('a', 'A', ['example.com'], [{ name: 'Authorization' }], 0),
        p('b', 'B', ['api.example.com'], [{ name: 'Authorization' }], 1),
      ]),
    ).toHaveLength(1);
  });

  it('treats a parent domain and its subdomain as overlapping (subdomain first)', () => {
    expect(
      detectConflicts([
        p('a', 'A', ['api.example.com'], [{ name: 'Authorization' }], 0),
        p('b', 'B', ['example.com'], [{ name: 'Authorization' }], 1),
      ]),
    ).toHaveLength(1);
  });

  it('does not treat a same-suffix sibling domain as overlapping', () => {
    // A naive suffix check without the leading dot would wrongly match
    // `notexample.com` against `example.com`.
    expect(
      detectConflicts([
        p('a', 'A', ['notexample.com'], [{ name: 'Authorization' }], 0),
        p('b', 'B', ['example.com'], [{ name: 'Authorization' }], 1),
      ]),
    ).toEqual([]);
  });

  it('excludes a profile whose only domains are invalid — no rule is emitted for it', () => {
    // Replaces an earlier test that asserted the opposite. `aHosts.length === 0`
    // models "a rule with no domain condition matches every site", which is
    // true for an *empty* list — but compile.ts suppresses a non-empty list
    // that is entirely unusable, so it emits no rule at all. Blaming a
    // neighbour for losing to that rule is a false positive, and it directly
    // contradicts the `empty-filter` this same compile() puts on the profile.
    expect(
      detectConflicts([
        p('a', 'A', ['a b.com'], [{ name: 'Authorization' }], 0),
        p('b', 'B', ['y.com'], [{ name: 'Authorization' }], 1),
      ]),
    ).toEqual([]);
  });

  it('counts a partly-usable profile, because it is the one that still applies', () => {
    // This asserted `[]` until 2026-08-20, when the mixed case stopped being
    // suppressed: the bad entry is dropped and `x.com` still scopes the rule,
    // so this profile emits and can genuinely take a neighbour's header. Not
    // flagging it would be the conflict detector reading the stored list
    // instead of `scopingHosts` — the exact defect CLAUDE.md records under
    // "One predicate, one definition".
    const d = detectConflicts([
      p('a', 'A', ['x.com', 'a b.com'], [{ name: 'Authorization' }], 0),
      p('b', 'B', ['x.com'], [{ name: 'Authorization' }], 1),
    ]);
    expect(d).toHaveLength(1);
    expect(d[0]?.kind).toBe('profile-conflict');
    expect(d[0]?.profileId).toBe('b');
  });

  it('names a partly-usable profile as the loser, on the same reading', () => {
    // The mirror of the case above, and it has to move with it: the losing
    // side is decided by `scopingHosts` too, so a profile whose list carries
    // one bad entry is still a profile whose row can be discarded.
    const d = detectConflicts([
      p('a', 'A', ['x.com'], [{ name: 'Authorization' }], 0),
      p('b', 'B', ['x.com', 'a b.com'], [{ name: 'Authorization' }], 1),
    ]);
    expect(d).toHaveLength(1);
    expect(d[0]?.profileId).toBe('b');
  });

  it('does not let a suppressed profile hide a conflict between its neighbours', () => {
    // Removing the middle profile from consideration must not shift who the
    // winner is for the profiles that do compile.
    const d = detectConflicts([
      p('a', 'Local', ['x.com'], [{ name: 'Authorization' }], 0),
      p('bad', 'Broken', ['a b.com'], [{ name: 'Authorization' }], 1),
      p('c', 'Staging', ['x.com'], [{ name: 'Authorization' }], 2),
    ]);
    expect(d).toHaveLength(1);
    expect(d[0]?.profileId).toBe('c');
    expect(d[0]?.message).toContain('Local');
  });
});
