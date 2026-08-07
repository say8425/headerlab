import { describe, expect, it } from 'vitest';
import { parseAppState } from '@/lib/model/schema';
import { createProfile, DEFAULT_STATE } from '@/lib/model/defaults';

describe('parseAppState', () => {
  it('accepts the default state', () => {
    expect(parseAppState(DEFAULT_STATE)).toEqual(DEFAULT_STATE);
  });

  it('accepts a state carrying a profile', () => {
    const s = { ...DEFAULT_STATE, profiles: [createProfile('Local', 0)] };
    expect(parseAppState(s).profiles).toHaveLength(1);
  });

  it('rejects an unknown operation', () => {
    const p = createProfile('Local', 0);
    p.headers = [
      {
        id: 'h',
        enabled: true,
        target: 'request',
        operation: 'mutate' as never,
        name: 'X',
        value: '1',
      },
    ];
    // Matched on the rejected field, not merely on "it threw". A bare
    // `.toThrow()` here passes on any error at all — including a TypeError
    // from a typo in this fixture, which would report the schema as strict
    // while testing nothing about it.
    expect(() => parseAppState({ ...DEFAULT_STATE, profiles: [p] })).toThrow(/"operation"/);
  });

  it('rejects an empty resourceTypes array — DNR rejects it too', () => {
    const p = createProfile('Local', 0);
    p.filter.resourceTypes = [];
    expect(() => parseAppState({ ...DEFAULT_STATE, profiles: [p] })).toThrow(/"resourceTypes"/);
  });

  it('rejects a non-object', () => {
    // The two are asserted apart rather than as "both throw": a string is the
    // case that would slip through a schema which only checked for null, and
    // matching the received type is what tells them apart.
    //
    // Matched on the received type alone, not on zod's full sentence. The
    // discriminating power is identical — these are the only two cases here —
    // and the shorter pattern does not turn a zod upgrade that rewords
    // "Invalid input: expected object" into a puzzling failure about a schema
    // that still works. The other three matchers in this file pin *field
    // names*, which are ours rather than zod's and so are not exposed to this.
    expect(() => parseAppState(null)).toThrow(/received null/);
    expect(() => parseAppState('{}')).toThrow(/received string/);
  });

  it('strips unknown keys rather than failing — forward compatibility', () => {
    const parsed = parseAppState({ ...DEFAULT_STATE, futureField: 123 });
    expect(parsed).not.toHaveProperty('futureField');
  });
});

describe('createProfile', () => {
  it('produces a profile that parses', () => {
    const s = { ...DEFAULT_STATE, profiles: [createProfile('Staging', 1)] };
    expect(() => parseAppState(s)).not.toThrow();
  });

  it('assigns a unique id per call', () => {
    expect(createProfile('a', 0).id).not.toBe(createProfile('a', 0).id);
  });

  it('rotates through the identity colours in order and wraps', () => {
    // Two full turns, so the wrap is pinned as well as the first pass. Literal
    // names rather than SELECTABLE_COLORS, which would agree with the array
    // whatever it said.
    const rotation = Array.from({ length: 10 }, (_, order) => createProfile('a', order).color);
    expect(rotation).toEqual([
      'green',
      'amber',
      'red',
      'blue',
      'violet',
      'green',
      'amber',
      'red',
      'blue',
      'violet',
    ]);
  });

  it('never assigns cyan, which the tab marker owns', () => {
    // The rotation used to run over six colours, so every sixth profile was
    // given the marker's colour as its identity and its dot could sit beside a
    // cyan marker on the same tab. The range is deliberately wider than one
    // turn: a rotation that grew back to six would only reveal it at order 5.
    const colors = Array.from({ length: 24 }, (_, order) => createProfile('a', order).color);
    expect(colors).not.toContain('cyan');
  });

  it('defaults resourceTypes to the three types a debugger actually uses', () => {
    expect(createProfile('a', 0).filter.resourceTypes).toEqual([
      'xmlhttprequest',
      'main_frame',
      'sub_frame',
    ]);
  });
});
