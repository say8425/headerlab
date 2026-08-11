import { describe, expect, it } from 'vitest';
import { apply } from '@/lib/bridge/apply';
import { bootstrapProfile, newRule, STATE_VERSION } from '@/lib/model/defaults';
import type { AppState, HeaderRule, Profile } from '@/lib/model/types';

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
    // Snapshotted BEFORE the call. `replace()` returns the non-matching
    // element by reference, so `toEqual(second)` would compare the object to
    // itself — an in-place mutation would corrupt both sides identically and
    // the assertion would still pass. Comparing against a pre-call copy is
    // what makes this line carry weight rather than merely look like it does.
    const expectedSecond = structuredClone(second);
    const result = ok(apply(before, { cmd: 'site.add', domains: ['a.com'] }));
    expect(result.state.profiles).toHaveLength(2);
    expect(result.state.profiles[0]!.filter.domains).toEqual(['a.com']);
    expect(result.state.profiles[1]).toEqual(expectedSecond);
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

function ruled(...headers: HeaderRule[]): AppState {
  const profile = bootstrapProfile();
  return stateWith({ ...profile, headers });
}

const AUTH: HeaderRule = {
  id: 'r-auth',
  enabled: true,
  target: 'request',
  operation: 'set',
  name: 'Authorization',
  value: 'Bearer old',
};

describe('apply — rule.add', () => {
  it('appends a rule with the fields it was given', () => {
    const result = ok(
      apply(ruled(), {
        cmd: 'rule.add',
        target: 'response',
        operation: 'set',
        name: 'Cache-Control',
        value: 'no-store',
      }),
    );
    const rules = result.state.profiles[0]!.headers;
    expect(rules).toHaveLength(1);
    expect(rules[0]!.target).toBe('response');
    expect(rules[0]!.operation).toBe('set');
    expect(rules[0]!.name).toBe('Cache-Control');
    expect(rules[0]!.value).toBe('no-store');
    expect(rules[0]!.enabled).toBe(true);
  });

  it('appends after the rules already there', () => {
    const result = ok(
      apply(ruled(AUTH), {
        cmd: 'rule.add',
        target: 'request',
        operation: 'set',
        name: 'X-Debug',
        value: '1',
      }),
    );
    expect(result.state.profiles[0]!.headers.map((h) => h.name)).toEqual([
      'Authorization',
      'X-Debug',
    ]);
  });

  it('gives each added rule its own id', () => {
    const once = ok(
      apply(ruled(), {
        cmd: 'rule.add',
        target: 'request',
        operation: 'set',
        name: 'A',
        value: '1',
      }),
    ).state;
    const twice = ok(
      apply(once, { cmd: 'rule.add', target: 'request', operation: 'set', name: 'B', value: '2' }),
    ).state;
    const [first, second] = twice.profiles[0]!.headers;
    expect(first!.id).not.toBe(second!.id);
  });

  // types.ts: "Empty string when operation is 'remove'. The compiler drops the
  // field entirely." A value carried on a remove would be dead data that reads
  // as meaningful.
  it('drops a value handed to a remove', () => {
    const result = ok(
      apply(ruled(), {
        cmd: 'rule.add',
        target: 'response',
        operation: 'remove',
        name: 'Content-Security-Policy',
        value: 'ignored',
      }),
    );
    expect(result.state.profiles[0]!.headers[0]!.value).toBe('');
  });
});

describe('apply — rule.remove', () => {
  it('removes the named rule and leaves the rest', () => {
    const other = { ...newRule(), id: 'r-other', name: 'X-Other' };
    const result = ok(apply(ruled(AUTH, other), { cmd: 'rule.remove', id: 'r-auth' }));
    expect(result.state.profiles[0]!.headers.map((h) => h.id)).toEqual(['r-other']);
    expect(result.changed).toBe(true);
  });

  it('names an id that is not there rather than reporting success', () => {
    const result = apply(ruled(AUTH), { cmd: 'rule.remove', id: 'nope' });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.error.code).toBe('unknown-rule');
    expect(result.error.message).toContain('nope');
  });
});

describe('apply — rule.toggle', () => {
  it('flips an on rule off when told nothing', () => {
    const result = ok(apply(ruled(AUTH), { cmd: 'rule.toggle', id: 'r-auth' }));
    expect(result.state.profiles[0]!.headers[0]!.enabled).toBe(false);
    expect(result.changed).toBe(true);
  });

  it('flips an off rule on when told nothing', () => {
    const result = ok(
      apply(ruled({ ...AUTH, enabled: false }), { cmd: 'rule.toggle', id: 'r-auth' }),
    );
    expect(result.state.profiles[0]!.headers[0]!.enabled).toBe(true);
  });

  it('sets rather than flips when told explicitly', () => {
    const result = ok(apply(ruled(AUTH), { cmd: 'rule.toggle', id: 'r-auth', on: true }));
    expect(result.state.profiles[0]!.headers[0]!.enabled).toBe(true);
    // Already on, so nothing moved — an explicit set is idempotent and says so.
    expect(result.changed).toBe(false);
  });

  it('names an id that is not there', () => {
    const result = apply(ruled(AUTH), { cmd: 'rule.toggle', id: 'nope' });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.error.code).toBe('unknown-rule');
    expect(result.error.message).toContain('nope');
  });
});

describe('apply — rule commands leave their input alone', () => {
  // The INPUT state, not the returned one. Every other rule test asserts on
  // what came back, and the result is a fresh array either way — so an
  // in-place `active.headers.push(rule)` or `.splice()` would pass all of
  // them. One body covers add and remove because both are array-level writes.
  it('does not mutate the state it was given — add and remove', () => {
    const before = ruled(AUTH);
    const snapshot = structuredClone(before);
    apply(before, { cmd: 'rule.add', target: 'request', operation: 'set', name: 'X', value: '1' });
    apply(before, { cmd: 'rule.remove', id: 'r-auth' });
    expect(before).toEqual(snapshot);
  });

  // Toggle's risk is element-level rather than array-level: `h.enabled = next;
  // return h;` inside the map leaves the array new and the header the same
  // object, which the array-level test above cannot see.
  it('does not mutate the state it was given — toggle', () => {
    const before = ruled(AUTH);
    const snapshot = structuredClone(before);
    apply(before, { cmd: 'rule.toggle', id: 'r-auth' });
    expect(before).toEqual(snapshot);
  });
});
