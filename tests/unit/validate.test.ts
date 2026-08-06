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

  it('calls a blank name unfinished, not invalid — it is the state a new rule is born in', () => {
    // The defect this splits: pressing "New rule" produced a red "Header name
    // is empty." on a row created one click ago. The popup creates rules empty
    // on purpose, so an error there is the product manufacturing an invalid
    // object and then telling the user off for it.
    //
    // Kind *and* severity are both asserted. The old code emitted one kind and
    // one severity for both cases and picked its message by testing the name's
    // length — so the only thing telling a typo from an unfinished rule apart
    // was the copy, and no consumer reads copy.
    const d = validateHeaders(profileWith([row({ name: '' })]));
    expect(d).toHaveLength(1);
    expect(d[0]?.kind).toBe('incomplete-header');
    expect(d[0]?.severity).toBe('incomplete');
    expect(d[0]?.headerRuleId).toBe('h1');
  });

  it('still says something about a blank name rather than going quiet', () => {
    // Suppressing it would trade a red row for the silent failure the whole
    // product exists to remove: a rule that sends nothing and says nothing.
    // The message is what the rail counts, so it has to exist.
    const d = validateHeaders(profileWith([row({ name: '' })]));
    expect(d[0]?.message.length).toBeGreaterThan(0);
  });

  it('calls a whitespace-only name unfinished too — trimmed, it is the same no-name', () => {
    // `name` is trimmed before this decision, the same trim the compiler
    // applies before deciding what to emit, so "   " and "" are one state.
    // Without this, spaces would fall through to the token test and be
    // reported as a typo the user cannot see.
    const d = validateHeaders(profileWith([row({ name: '   ' })]));
    expect(d).toHaveLength(1);
    expect(d[0]?.kind).toBe('incomplete-header');
  });

  it('keeps a typo an error, with the message that names the offending text', () => {
    // The other side of the split, asserted alongside it: making "unfinished"
    // its own state must not soften a name the user actually got wrong.
    const d = validateHeaders(profileWith([row({ name: 'X Session Id' })]));
    expect(d).toHaveLength(1);
    expect(d[0]?.kind).toBe('invalid-header-name');
    expect(d[0]?.severity).toBe('error');
    expect(d[0]?.message).toContain('"X Session Id"');
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
    // Flags the later of two rows touching the same header.
    expect(d[0]?.headerRuleId).toBe('b');
  });

  it('does not call the same name on different targets a duplicate', () => {
    expect(validateHeaders(profileWith([
      row({ id: 'a', target: 'request', name: 'X-Same' }),
      row({ id: 'b', target: 'response', name: 'X-Same' }),
    ]))).toEqual([]);
  });

  it('ignores disabled rows entirely, including an unfinished one', () => {
    // Row `a` is switched off *and* unnamed — two separate reasons the same
    // row sends nothing. Staying silent here is what keeps the readout from
    // giving it two competing labels: with no diagnostic to find, the tally
    // files it under "switched off", which is the reason the user chose, and
    // never also under "unfinished".
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
