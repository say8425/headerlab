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
});
