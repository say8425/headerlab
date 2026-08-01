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
    p.headers = [{
      id: 'h', enabled: true, target: 'request',
      operation: 'mutate' as never, name: 'X', value: '1',
    }];
    expect(() => parseAppState({ ...DEFAULT_STATE, profiles: [p] })).toThrow();
  });

  it('rejects an empty resourceTypes array — DNR rejects it too', () => {
    const p = createProfile('Local', 0);
    p.filter.resourceTypes = [];
    expect(() => parseAppState({ ...DEFAULT_STATE, profiles: [p] })).toThrow();
  });

  it('rejects a non-object', () => {
    expect(() => parseAppState(null)).toThrow();
    expect(() => parseAppState('{}')).toThrow();
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

  it('defaults resourceTypes to the three types a debugger actually uses', () => {
    expect(createProfile('a', 0).filter.resourceTypes)
      .toEqual(['xmlhttprequest', 'main_frame', 'sub_frame']);
  });
});
