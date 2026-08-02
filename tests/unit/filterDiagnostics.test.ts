import { describe, expect, it } from 'vitest';
import { validateFilter } from '@/lib/compile/filterDiagnostics';
import { createProfile } from '@/lib/model/defaults';
import type { Filter, Profile } from '@/lib/model/types';

function profileWith(filter: Partial<Filter>): Profile {
  const base = createProfile('P', 0);
  return { ...base, id: 'p1', filter: { ...base.filter, ...filter } };
}

describe('validateFilter', () => {
  it('is quiet on a filter with one plain domain', () => {
    expect(validateFilter(profileWith({ domains: ['api.example.com'] }))).toEqual([]);
  });

  it('warns when no domain survives — the rule would match every site', () => {
    const d = validateFilter(profileWith({ domains: [] }));
    expect(d).toHaveLength(1);
    expect(d[0]?.kind).toBe('empty-filter');
    expect(d[0]?.severity).toBe('warning');
  });

  it('warns when every domain is unusable, for the same reason', () => {
    const d = validateFilter(profileWith({ domains: ['a b.com'] }));
    expect(d).toHaveLength(1);
    expect(d[0]?.kind).toBe('empty-filter');
  });

  it('reports a dropped port without calling the domain invalid', () => {
    const d = validateFilter(profileWith({ domains: ['localhost:3000'] }));
    expect(d).toHaveLength(1);
    expect(d[0]?.kind).toBe('port-ignored');
    expect(d[0]?.severity).toBe('warning');
    expect(d[0]?.message).toContain('localhost');
  });

  it('does not warn about an empty filter when a port-bearing domain survives', () => {
    const d = validateFilter(profileWith({ domains: ['localhost:3000'] }));
    expect(d.map((x) => x.kind)).not.toContain('empty-filter');
  });

  it('does not report port-ignored when the port-bearing host is itself unusable', () => {
    const d = validateFilter(profileWith({ domains: ['a b.com:3000'] }));
    expect(d.map((x) => x.kind)).not.toContain('port-ignored');
    expect(d.map((x) => x.kind)).toContain('empty-filter');
  });

  it('dedupes port-ignored by host — same host, different ports, one warning', () => {
    const d = validateFilter(profileWith({ domains: ['localhost:3000', 'localhost:8080'] }));
    expect(d.filter((x) => x.kind === 'port-ignored')).toHaveLength(1);
  });

  it('flags a non-ASCII regex — regexFilter is ASCII-only', () => {
    const d = validateFilter(profileWith({ mode: 'regex', regex: '도메인' }));
    expect(d.map((x) => x.kind)).toContain('regex-unsupported');
    expect(d.find((x) => x.kind === 'regex-unsupported')?.severity).toBe('error');
  });

  it('flags a regex over the 2KB compiled budget', () => {
    const d = validateFilter(profileWith({ mode: 'regex', regex: 'a'.repeat(2049) }));
    expect(d.map((x) => x.kind)).toContain('regex-unsupported');
  });

  it('flags an empty regex in regex mode', () => {
    const d = validateFilter(profileWith({ mode: 'regex', regex: '' }));
    expect(d.map((x) => x.kind)).toContain('regex-unsupported');
  });

  it('does not check the regex when the filter is in structured mode', () => {
    const d = validateFilter(profileWith({ domains: ['a.com'], regex: '도메인' }));
    expect(d.map((x) => x.kind)).not.toContain('regex-unsupported');
  });

  it('does not raise empty-filter in regex mode — the regex is the condition', () => {
    const d = validateFilter(profileWith({ mode: 'regex', regex: '^https://a\\.com/' }));
    expect(d).toEqual([]);
  });

  it('flags a non-ASCII path pattern — urlFilter is ASCII-only too', () => {
    const d = validateFilter(profileWith({ domains: ['a.com'], pathPattern: '/경로' }));
    expect(d.map((x) => x.kind)).toContain('regex-unsupported');
  });

  it('names the unusable entry when only some domains are usable', () => {
    // compile.ts suppresses the whole profile here, and `empty-filter` stays
    // quiet because one entry is valid — this diagnostic is what closes that
    // silence, so the exact message is part of the contract.
    const d = validateFilter(profileWith({
      domains: ['api.example.com', 'https://staging.example.com'],
    }));
    expect(d).toEqual([{
      kind: 'invalid-domain',
      severity: 'error',
      profileId: 'p1',
      message:
        'Unusable domain: "https://staging.example.com". ' +
        'The whole profile is not applied until every domain in it is usable.',
    }]);
  });

  it('names every unusable entry, in the order the user wrote them', () => {
    const d = validateFilter(profileWith({
      domains: ['https://staging.example.com', 'api.example.com', 'a b.com'],
    }));
    expect(d).toHaveLength(1);
    expect(d[0]?.message).toBe(
      'Unusable domains: "https://staging.example.com", "a b.com". ' +
      'The whole profile is not applied until every domain in it is usable.',
    );
  });

  it('never raises invalid-domain and empty-filter together', () => {
    // All six cases of the two branches, so neither can drift into the other.
    // structured: empty and all-invalid go to `empty-filter`, mixed to
    // `invalid-domain`. regex: `empty-filter` never fires at all, so
    // `invalid-domain` covers both mixed and all-invalid, and an empty list
    // stays quiet because the regex is the condition.
    const kinds = (f: Partial<Filter>) => validateFilter(profileWith(f)).map((x) => x.kind);
    const rx = { mode: 'regex', regex: '^https://' } as const;

    expect(kinds({ domains: [] })).toEqual(['empty-filter']);
    expect(kinds({ domains: ['a b.com'] })).toEqual(['empty-filter']);
    expect(kinds({ domains: ['ok.com', 'a b.com'] })).toEqual(['invalid-domain']);
    expect(kinds({ ...rx, domains: [] })).toEqual([]);
    expect(kinds({ ...rx, domains: ['a b.com'] })).toEqual(['invalid-domain']);
    expect(kinds({ ...rx, domains: ['ok.com', 'a b.com'] })).toEqual(['invalid-domain']);
  });

  it('raises invalid-domain in regex mode too — the compiler suppresses it the same way', () => {
    // compile.ts's suppression does not look at the mode, and conditions.ts
    // sets requestDomains for a regex rule as well. Without this the same
    // silence returns through the regex door.
    const d = validateFilter(profileWith({
      mode: 'regex', regex: '^https://', domains: ['ok.com', 'a b.com'],
    }));
    expect(d.map((x) => x.kind)).toEqual(['invalid-domain']);
  });

  it('raises invalid-domain in regex mode when every domain is unusable', () => {
    // structured mode routes this to `empty-filter`, but regex mode returns
    // before that check — so without a branch here the profile is suppressed
    // in silence. Different advice from the mixed case: there is nothing to
    // salvage, and in regex mode clearing the list is a real fix because the
    // pattern alone is a valid condition.
    const d = validateFilter(profileWith({
      mode: 'regex', regex: '^https://', domains: ['a b.com', 'https://x.com'],
    }));
    expect(d).toEqual([{
      kind: 'invalid-domain',
      severity: 'error',
      profileId: 'p1',
      message:
        'No usable domain: "a b.com", "https://x.com". This profile is not applied. ' +
        'Fix these, or clear the domain list so the regex alone decides what matches.',
    }]);
  });

  it('leaves a regex profile with no domains alone — the regex is the condition', () => {
    // The boundary of the branch above: an empty list is not suppressed, so a
    // regex profile that never named a domain must stay quiet.
    expect(validateFilter(profileWith({ mode: 'regex', regex: '^https://a/', domains: [] })))
      .toEqual([]);
  });

  it('still reports a dropped port alongside the unusable entry', () => {
    const d = validateFilter(profileWith({ domains: ['localhost:3000', 'a b.com'] }));
    expect(d.map((x) => x.kind)).toEqual(['invalid-domain', 'port-ignored']);
  });
});
