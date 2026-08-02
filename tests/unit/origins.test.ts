import { describe, expect, it } from 'vitest';
import { analyzeDomain, originCandidates, originsForFilter, requestPattern } from '@/lib/permissions/origins';
import type { Filter } from '@/lib/model/types';

describe('originCandidates', () => {
  it('lists candidates narrowest to broadest', () => {
    // Updated for the 4→6 rung change (see the brief's Interfaces section):
    // http gets its own rungs alongside https, since contains() is a subset
    // check and *:// alone misses an http-only grant.
    expect(originCandidates('api.example.com')).toEqual([
      'https://api.example.com/*',
      'http://api.example.com/*',
      'https://*.api.example.com/*',
      'http://*.api.example.com/*',
      '*://api.example.com/*',
      '*://*.api.example.com/*',
    ]);
  });

  it('lowercases the domain', () => {
    expect(originCandidates('API.Example.COM')[0]).toBe('https://api.example.com/*');
  });

  it('strips a leading dot', () => {
    expect(originCandidates('.example.com')[0]).toBe('https://example.com/*');
  });

  it('strips a leading wildcard label', () => {
    expect(originCandidates('*.example.com')[0]).toBe('https://example.com/*');
  });
});

describe('requestPattern', () => {
  it('returns the broadest pattern so one grant covers scheme and subdomains', () => {
    expect(requestPattern('api.example.com')).toBe('*://*.api.example.com/*');
  });
});

describe('originsForFilter', () => {
  const base: Filter = {
    mode: 'structured',
    domains: ['api.example.com'],
    excludedDomains: [],
    resourceTypes: ['xmlhttprequest'],
  };

  it('returns the request pattern for each domain', () => {
    expect(originsForFilter(base)).toEqual(['*://*.api.example.com/*']);
  });

  it('deduplicates domains that normalize to the same host', () => {
    const f = { ...base, domains: ['api.example.com', 'API.example.com', '*.api.example.com'] };
    expect(originsForFilter(f)).toEqual(['*://*.api.example.com/*']);
  });

  it('returns <all_urls> when no domain narrows the filter', () => {
    expect(originsForFilter({ ...base, domains: [] })).toEqual(['<all_urls>']);
  });

  it('returns <all_urls> for regex mode — a regex cannot be reduced to origins', () => {
    const f: Filter = { ...base, mode: 'regex', regex: '^https://.*/v2/', domains: [] };
    expect(originsForFilter(f)).toEqual(['<all_urls>']);
  });

  it('still uses the domains in regex mode when they are given', () => {
    const f: Filter = { ...base, mode: 'regex', regex: '^https://.*/v2/' };
    expect(originsForFilter(f)).toEqual(['*://*.api.example.com/*']);
  });

  it('ignores blank domain entries', () => {
    expect(originsForFilter({ ...base, domains: ['  ', 'api.example.com'] }))
      .toEqual(['*://*.api.example.com/*']);
  });

  it('drops an unusable entry rather than building a pattern that throws', () => {
    // docs/research/2026-08-01-permission-audit-spike.md §3 measured
    // `*://*.https://x.com/*` as THREW — Invalid port, and one throwing entry
    // poisons the whole contains()/request() call it is passed to.
    expect(originsForFilter({
      ...base,
      domains: ['api.example.com', 'https://staging.example.com'],
    })).toEqual(['*://*.api.example.com/*']);
  });

  it('drops an entry with internal whitespace too', () => {
    // The same table records `a b.com` as returning false without throwing —
    // a different failure, but a pattern that can never match is still one
    // this field must not carry.
    expect(originsForFilter({ ...base, domains: ['api.example.com', 'a b.com'] }))
      .toEqual(['*://*.api.example.com/*']);
  });

  it('falls back to <all_urls> when no entry is usable', () => {
    expect(originsForFilter({ ...base, domains: ['https://staging.example.com'] }))
      .toEqual(['<all_urls>']);
  });
});

describe('analyzeDomain', () => {
  it('strips a trailing port and says so', () => {
    expect(analyzeDomain('localhost:3000')).toEqual({
      host: 'localhost',
      portDropped: true,
      valid: true,
    });
  });

  it('leaves a plain host untouched', () => {
    expect(analyzeDomain('api.example.com')).toEqual({
      host: 'api.example.com',
      portDropped: false,
      valid: true,
    });
  });

  it('keeps stripping the leading wildcard and dot, as before', () => {
    expect(analyzeDomain('*.Example.COM').host).toBe('example.com');
    expect(analyzeDomain('.example.com').host).toBe('example.com');
  });

  it('drops a trailing dot — the same host, spelled as an FQDN', () => {
    expect(analyzeDomain('example.com.').host).toBe('example.com');
  });

  it('strips the port before the trailing dot', () => {
    // Port stripping runs first, then the trailing-dot strip — so an FQDN
    // with a port collapses to the same host as the plain FQDN.
    expect(analyzeDomain('example.com.:8080').host).toBe('example.com');
  });

  it('does not mistake a version-like suffix for a port', () => {
    // Only a trailing :digits is a port. An embedded scheme ends in letters.
    expect(analyzeDomain('https://example.com').portDropped).toBe(false);
  });

  it('rejects an embedded scheme — permissions.contains() throws on it', () => {
    expect(analyzeDomain('https://example.com').valid).toBe(false);
  });

  it('rejects internal whitespace — DNR registers it and it never matches', () => {
    expect(analyzeDomain('a b.com').valid).toBe(false);
  });

  it('rejects a path segment', () => {
    expect(analyzeDomain('example.com/api').valid).toBe(false);
  });

  it('rejects an empty host', () => {
    expect(analyzeDomain('   ').valid).toBe(false);
    expect(analyzeDomain('*.').valid).toBe(false);
  });

  it('still rejects non-ASCII — DNR rejects it in requestDomains', () => {
    expect(analyzeDomain('도메인.kr').valid).toBe(false);
  });

  it('accepts an IPv4 literal', () => {
    expect(analyzeDomain('127.0.0.1')).toEqual({
      host: '127.0.0.1',
      portDropped: false,
      valid: true,
    });
  });
});

describe('originCandidates — narrowest to broadest, both schemes', () => {
  it('offers six candidates in narrowest-first order', () => {
    expect(originCandidates('example.com')).toEqual([
      'https://example.com/*',
      'http://example.com/*',
      'https://*.example.com/*',
      'http://*.example.com/*',
      '*://example.com/*',
      '*://*.example.com/*',
    ]);
  });

  it('includes an http rung — this is the loopback regression', () => {
    // Measured: with http://127.0.0.1/* granted, every https-only candidate
    // returns false, because contains() is a subset check and *:// demands
    // both schemes. Without this rung the audit shows a false "grant needed"
    // badge on the single most common local-development setup — and on this
    // repository's own e2e build.
    expect(originCandidates('127.0.0.1')).toContain('http://127.0.0.1/*');
  });

  it('normalizes before building candidates', () => {
    expect(originCandidates('localhost:3000')[0]).toBe('https://localhost/*');
  });
});
