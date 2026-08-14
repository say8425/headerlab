import { describe, expect, it } from 'vitest';
import { bootstrapProfile, newRule, STATE_VERSION } from '@/lib/model/defaults';
import { parseAppState } from '@/lib/model/schema';

describe('newRule', () => {
  it('is born unnamed and switched on', () => {
    const rule = newRule();
    expect(rule.name).toBe('');
    expect(rule.value).toBe('');
    expect(rule.enabled).toBe(true);
    expect(rule.target).toBe('request');
    expect(rule.operation).toBe('set');
  });

  it('mints a fresh id per call — a shared constant would repeat ids', () => {
    expect(newRule().id).not.toBe(newRule().id);
  });
});

describe('bootstrapProfile', () => {
  it('opens with exactly one rule, ready to be named', () => {
    const profile = bootstrapProfile();
    expect(profile.headers).toHaveLength(1);
    expect(profile.headers[0]!.name).toBe('');
  });

  it('is unscoped — nothing applies until a site is added', () => {
    const profile = bootstrapProfile();
    expect(profile.filter.allSites).toBe(false);
    expect(profile.filter.domains).toEqual([]);
  });

  it('mints a fresh id per call', () => {
    expect(bootstrapProfile().id).not.toBe(bootstrapProfile().id);
  });

  it('produces a state the schema accepts', () => {
    const state = {
      version: STATE_VERSION,
      profiles: [bootstrapProfile()],
      globalPause: false,
      theme: 'system',
    };
    expect(parseAppState(state).profiles).toHaveLength(1);
  });
});
