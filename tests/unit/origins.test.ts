import { describe, expect, it } from 'vitest';
import { originCandidates, originsForFilter, requestPattern } from '@/lib/permissions/origins';
import type { Filter } from '@/lib/model/types';

describe('originCandidates', () => {
  it('lists candidates narrowest to broadest', () => {
    expect(originCandidates('api.example.com')).toEqual([
      'https://api.example.com/*',
      'https://*.api.example.com/*',
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
});
