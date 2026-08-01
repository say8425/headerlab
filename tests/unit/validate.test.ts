import { describe, expect, it } from 'vitest';
import {
  APPEND_ALLOWED_REQUEST_HEADERS,
  isAppendAllowed,
  validateHeaders,
} from '@/lib/compile/validate';
import { createProfile } from '@/lib/model/defaults';
import type { HeaderRule, Profile } from '@/lib/model/types';

function profileWith(headers: HeaderRule[]): Profile {
  return { ...createProfile('P', 0), id: 'p1', headers };
}

function row(patch: Partial<HeaderRule>): HeaderRule {
  return {
    id: patch.id ?? 'h1',
    enabled: true,
    target: 'request',
    operation: 'set',
    name: 'X-Test',
    value: 'v',
    ...patch,
  };
}

describe('the append allowlist', () => {
  it('holds exactly the 21 request headers Chromium allows', () => {
    expect(APPEND_ALLOWED_REQUEST_HEADERS.size).toBe(21);
  });

  it('allows a listed request header', () => {
    expect(isAppendAllowed('request', 'Accept-Language')).toBe(true);
  });

  it('rejects a custom request header — registration would fail the whole batch', () => {
    expect(isAppendAllowed('request', 'X-Custom')).toBe(false);
  });

  it('allows any response header — there is no allowlist for those', () => {
    expect(isAppendAllowed('response', 'X-Anything')).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(isAppendAllowed('request', 'USER-AGENT')).toBe(true);
  });
});

describe('validateHeaders', () => {
  it('is quiet on a clean profile', () => {
    expect(validateHeaders(profileWith([row({})]))).toEqual([]);
  });

  it('flags a name that is not an RFC 7230 token', () => {
    const d = validateHeaders(profileWith([row({ name: 'X Test' })]));
    expect(d).toHaveLength(1);
    expect(d[0]?.kind).toBe('invalid-header-name');
    expect(d[0]?.severity).toBe('error');
    expect(d[0]?.headerRuleId).toBe('h1');
  });

  it('flags a blank name — the popup can create one and it kills the batch', () => {
    expect(validateHeaders(profileWith([row({ name: '' })]))[0]?.kind)
      .toBe('invalid-header-name');
  });

  it('accepts a name that only needs trimming, matching what the compiler emits', () => {
    expect(validateHeaders(profileWith([row({ name: 'X-Test ' })]))).toEqual([]);
  });

  it('flags append on a request header outside the allowlist', () => {
    const d = validateHeaders(profileWith([
      row({ operation: 'append', name: 'X-Custom' }),
    ]));
    expect(d).toHaveLength(1);
    expect(d[0]?.kind).toBe('append-not-allowed');
    expect(d[0]?.severity).toBe('error');
  });

  it('does not flag append on a response header', () => {
    expect(validateHeaders(profileWith([
      row({ target: 'response', operation: 'append', name: 'X-Custom' }),
    ]))).toEqual([]);
  });

  it('flags two enabled rows touching the same header on the same target', () => {
    const d = validateHeaders(profileWith([
      row({ id: 'a', name: 'Authorization' }),
      row({ id: 'b', name: 'authorization' }),
    ]));
    expect(d).toHaveLength(1);
    expect(d[0]?.kind).toBe('duplicate-header');
    // The diagnostic points at the later row — the one that loses.
    expect(d[0]?.headerRuleId).toBe('b');
  });

  it('does not call the same name on different targets a duplicate', () => {
    expect(validateHeaders(profileWith([
      row({ id: 'a', target: 'request', name: 'X-Same' }),
      row({ id: 'b', target: 'response', name: 'X-Same' }),
    ]))).toEqual([]);
  });

  it('ignores disabled rows entirely', () => {
    expect(validateHeaders(profileWith([
      row({ id: 'a', enabled: false, name: '' }),
      row({ id: 'b', enabled: false, operation: 'append', name: 'X-Custom' }),
    ]))).toEqual([]);
  });

  it('carries the profile id on every diagnostic', () => {
    const d = validateHeaders(profileWith([row({ name: '' })]));
    expect(d[0]?.profileId).toBe('p1');
  });
});
