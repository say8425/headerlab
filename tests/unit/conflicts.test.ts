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
    expect(detectConflicts([
      p('a', 'A', ['x.com'], [{ name: 'Authorization' }], 0),
      p('b', 'B', ['y.com'], [{ name: 'Authorization' }], 1),
    ])).toEqual([]);
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
    expect(detectConflicts([
      p('a', 'A', ['x.com'], [{ name: 'Accept', operation: 'append' }], 0),
      p('b', 'B', ['x.com'], [{ name: 'Accept', operation: 'append' }], 1),
    ])).toEqual([]);
  });

  it('treats append after set as compatible within one extension', () => {
    expect(detectConflicts([
      p('a', 'A', ['x.com'], [{ name: 'Accept', operation: 'set' }], 0),
      p('b', 'B', ['x.com'], [{ name: 'Accept', operation: 'append' }], 1),
    ])).toEqual([]);
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

  it('treats a domainless profile as overlapping everything', () => {
    expect(detectConflicts([
      p('a', 'A', [], [{ name: 'Authorization' }], 0),
      p('b', 'B', ['y.com'], [{ name: 'Authorization' }], 1),
    ])).toHaveLength(1);
  });

  it('ignores disabled profiles and disabled rows', () => {
    const a = p('a', 'A', ['x.com'], [{ name: 'Authorization' }], 0);
    const b = p('b', 'B', ['x.com'], [{ name: 'Authorization', enabled: false }], 1);
    expect(detectConflicts([a, { ...b, enabled: true }])).toEqual([]);
    expect(detectConflicts([a, { ...b, enabled: false }])).toEqual([]);
    expect(detectConflicts([{ ...a, enabled: false }, b])).toEqual([]);
  });

  it('does not cross request and response headers', () => {
    expect(detectConflicts([
      p('a', 'A', ['x.com'], [{ name: 'X-Same', target: 'request' }], 0),
      p('b', 'B', ['x.com'], [{ name: 'X-Same', target: 'response' }], 1),
    ])).toEqual([]);
  });

  it('names the winner by `order`, not by array position', () => {
    // `allocate` sorts by `order` and gives the first one the highest priority,
    // so the profile with the lower `order` wins regardless of where it sits in
    // the array. Passing them array-reversed must not flip the verdict.
    const first = p('a', 'Local', ['x.com'], [{ name: 'Authorization' }], 0);
    const second = p('b', 'Staging', ['x.com'], [{ name: 'Authorization' }], 1);

    const d = detectConflicts([second, first]); // array order disagrees with `order`
    expect(d).toHaveLength(1);
    expect(d[0]?.profileId).toBe('b');        // Staging still loses
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
    expect(detectConflicts([
      p('a', 'A', ['example.com'], [{ name: 'Authorization' }], 0),
      p('b', 'B', ['api.example.com'], [{ name: 'Authorization' }], 1),
    ])).toHaveLength(1);
  });

  it('treats a parent domain and its subdomain as overlapping (subdomain first)', () => {
    expect(detectConflicts([
      p('a', 'A', ['api.example.com'], [{ name: 'Authorization' }], 0),
      p('b', 'B', ['example.com'], [{ name: 'Authorization' }], 1),
    ])).toHaveLength(1);
  });

  it('does not treat a same-suffix sibling domain as overlapping', () => {
    // A naive suffix check without the leading dot would wrongly match
    // `notexample.com` against `example.com`.
    expect(detectConflicts([
      p('a', 'A', ['notexample.com'], [{ name: 'Authorization' }], 0),
      p('b', 'B', ['example.com'], [{ name: 'Authorization' }], 1),
    ])).toEqual([]);
  });

  it('treats a profile whose only domains are invalid as overlapping everything', () => {
    // Same code path as the empty-domains case (`aHosts.length === 0`), but
    // reached via a present-but-unusable entry instead of an empty array.
    expect(detectConflicts([
      p('a', 'A', ['a b.com'], [{ name: 'Authorization' }], 0),
      p('b', 'B', ['y.com'], [{ name: 'Authorization' }], 1),
    ])).toHaveLength(1);
  });
});
