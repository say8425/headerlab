import { describe, expect, it } from 'vitest';
import { apply } from '@/lib/bridge/apply';
import { bootstrapProfile, STATE_VERSION } from '@/lib/model/defaults';
import type { AppState, Profile } from '@/lib/model/types';

function stateWith(profile: Profile): AppState {
  return { version: STATE_VERSION, profiles: [profile], globalPause: false, theme: 'system' };
}

function scoped(domains: string[]): AppState {
  const profile = bootstrapProfile();
  return stateWith({ ...profile, filter: { ...profile.filter, domains } });
}

const EMPTY: AppState = {
  version: STATE_VERSION,
  profiles: [],
  globalPause: false,
  theme: 'system',
};

/** Narrows the result and fails loudly instead of silently skipping. */
function ok(result: ReturnType<typeof apply>) {
  if (!result.ok) throw new Error(`expected ok, got ${result.error.code}: ${result.error.message}`);
  return result;
}

describe('apply — site.add', () => {
  it('adds a normalized host', () => {
    const result = ok(apply(scoped([]), { cmd: 'site.add', domains: ['api.example.com'] }));
    expect(result.state.profiles[0]!.filter.domains).toEqual(['api.example.com']);
    expect(result.changed).toBe(true);
  });

  // The stored value IS the value that operates (origins.ts), so a port or a
  // path has to be gone by the time it reaches storage — not stripped again at
  // every read.
  it('stores the host, not what was typed', () => {
    const result = ok(apply(scoped([]), { cmd: 'site.add', domains: ['https://x.com:8443/a/b'] }));
    expect(result.state.profiles[0]!.filter.domains).toEqual(['x.com']);
  });

  it('adds several at once', () => {
    const result = ok(apply(scoped([]), { cmd: 'site.add', domains: ['a.com', 'b.com'] }));
    expect(result.state.profiles[0]!.filter.domains).toEqual(['a.com', 'b.com']);
  });

  // Not an error: the requested state is already true. But nothing happened,
  // and that has to be said — the same distinction AddSiteField makes.
  it('is not an error to add one that is already there, and reports no change', () => {
    const result = ok(apply(scoped(['a.com']), { cmd: 'site.add', domains: ['a.com'] }));
    expect(result.changed).toBe(false);
    expect(result.state.profiles[0]!.filter.domains).toEqual(['a.com']);
    expect(result.note).toContain('a.com');
  });

  it('recognises a duplicate written a different way', () => {
    const result = ok(apply(scoped(['x.com']), { cmd: 'site.add', domains: ['https://x.com/p'] }));
    expect(result.changed).toBe(false);
    expect(result.state.profiles[0]!.filter.domains).toEqual(['x.com']);
  });

  it('adds the new one and skips the duplicate in one command', () => {
    const result = ok(apply(scoped(['a.com']), { cmd: 'site.add', domains: ['a.com', 'b.com'] }));
    expect(result.changed).toBe(true);
    expect(result.state.profiles[0]!.filter.domains).toEqual(['a.com', 'b.com']);
  });

  it('mints the implicit rule set when storage holds none', () => {
    const result = ok(apply(EMPTY, { cmd: 'site.add', domains: ['a.com'] }));
    expect(result.state.profiles).toHaveLength(1);
    expect(result.state.profiles[0]!.filter.domains).toEqual(['a.com']);
    expect(result.state.profiles[0]!.headers).toHaveLength(1);
  });

  it('does not mutate the state it was given', () => {
    const before = scoped([]);
    apply(before, { cmd: 'site.add', domains: ['a.com'] });
    expect(before.profiles[0]!.filter.domains).toEqual([]);
  });

  // `replace()` maps by id rather than writing `[next]`, and that is the whole
  // of "operate on the one rule set the popup shows, leave the ones it cannot
  // show alone". A regression to `profiles: [next]` would silently delete a
  // stored rule set that goes on modifying headers with nothing able to show
  // it. One test covers all three commands because all three write through
  // `replace()` — three copies of it would be the duplication this file is
  // trying to prevent.
  it('leaves a second stored rule set untouched', () => {
    const first = bootstrapProfile();
    const second = { ...bootstrapProfile(), name: 'Legacy', order: 1 };
    const before: AppState = {
      version: STATE_VERSION,
      profiles: [first, second],
      globalPause: false,
      theme: 'system',
    };
    const result = ok(apply(before, { cmd: 'site.add', domains: ['a.com'] }));
    expect(result.state.profiles).toHaveLength(2);
    expect(result.state.profiles[0]!.filter.domains).toEqual(['a.com']);
    expect(result.state.profiles[1]).toEqual(second);
  });
});

describe('apply — site.remove', () => {
  it('removes by host', () => {
    const result = ok(
      apply(scoped(['a.com', 'b.com']), { cmd: 'site.remove', domains: ['a.com'] }),
    );
    expect(result.state.profiles[0]!.filter.domains).toEqual(['b.com']);
    expect(result.changed).toBe(true);
  });

  // Someone removing a site types what the rail shows them, which is the
  // effective host — while storage may still hold a raw value written before
  // normalization existed.
  it('removes a raw stored entry when given its effective host', () => {
    const result = ok(
      apply(scoped(['https://a.com:80/']), { cmd: 'site.remove', domains: ['a.com'] }),
    );
    expect(result.state.profiles[0]!.filter.domains).toEqual([]);
  });

  it('names a domain that is not there rather than reporting success', () => {
    const result = apply(scoped(['a.com']), { cmd: 'site.remove', domains: ['b.com'] });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.error.code).toBe('unknown-domain');
    expect(result.error.message).toContain('b.com');
  });

  it('removes nothing at all when one of several is unknown', () => {
    const result = apply(scoped(['a.com']), { cmd: 'site.remove', domains: ['a.com', 'b.com'] });
    expect(result.ok).toBe(false);
  });
});

describe('apply — site.allSites', () => {
  it('turns the mode on and keeps the stored list', () => {
    const result = ok(apply(scoped(['a.com']), { cmd: 'site.allSites', on: true }));
    expect(result.state.profiles[0]!.filter.allSites).toBe(true);
    // Keeping the list is what makes the switch reversible.
    expect(result.state.profiles[0]!.filter.domains).toEqual(['a.com']);
    expect(result.changed).toBe(true);
  });

  it('reports no change when the mode is already what was asked for', () => {
    const on = ok(apply(scoped([]), { cmd: 'site.allSites', on: true })).state;
    const again = ok(apply(on, { cmd: 'site.allSites', on: true }));
    expect(again.changed).toBe(false);
  });
});
