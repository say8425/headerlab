import { describe, expect, it } from 'vitest';
import { filterToCondition } from '@/lib/compile/conditions';
import { originsForFilter } from '@/lib/permissions/origins';
import type { Filter } from '@/lib/model/types';

const base: Filter = {
  mode: 'structured',
  allSites: false,
  domains: ['api.example.com'],
  excludedDomains: [],
  resourceTypes: ['xmlhttprequest'],
};

describe('filterToCondition — structured mode', () => {
  it('maps domains to requestDomains', () => {
    expect(filterToCondition(base)).toEqual({
      requestDomains: ['api.example.com'],
      resourceTypes: ['xmlhttprequest'],
    });
  });

  it('omits excludedRequestDomains when the list is empty', () => {
    expect(filterToCondition(base)).not.toHaveProperty('excludedRequestDomains');
  });

  it('includes excludedRequestDomains when present', () => {
    const f = { ...base, excludedDomains: ['static.example.com'] };
    expect(filterToCondition(f).excludedRequestDomains).toEqual(['static.example.com']);
  });

  it('omits requestDomains entirely when no domains are given', () => {
    const f = { ...base, domains: [] };
    expect(filterToCondition(f)).not.toHaveProperty('requestDomains');
  });

  it('anchors a single-domain path pattern to the domain', () => {
    const f = { ...base, pathPattern: '/v2/' };
    expect(filterToCondition(f).urlFilter).toBe('||api.example.com^*/v2/');
  });

  it('leaves the path unanchored when several domains are targeted', () => {
    const f = { ...base, domains: ['a.example.com', 'b.example.com'], pathPattern: '/v2/' };
    expect(filterToCondition(f).urlFilter).toBe('/v2/');
  });

  it('normalizes a path pattern that omits the leading slash', () => {
    const f = { ...base, pathPattern: 'v2/' };
    expect(filterToCondition(f).urlFilter).toBe('||api.example.com^*/v2/');
  });

  it('strips a trailing wildcard, which urlFilter implies', () => {
    const f = { ...base, pathPattern: '/v2/*' };
    expect(filterToCondition(f).urlFilter).toBe('||api.example.com^*/v2/');
  });

  it('omits urlFilter when the path pattern is blank', () => {
    const f = { ...base, pathPattern: '   ' };
    expect(filterToCondition(f)).not.toHaveProperty('urlFilter');
  });
});

describe('filterToCondition — domain normalization', () => {
  it('normalizes a domain before emitting requestDomains', () => {
    const f = { ...base, domains: ['API.Example.com'] };
    expect(filterToCondition(f).requestDomains).toEqual(['api.example.com']);
  });

  it('produces the same condition for equivalent domain spellings', () => {
    const upper = filterToCondition({ ...base, domains: ['API.Example.com'] });
    const lower = filterToCondition({ ...base, domains: ['api.example.com'] });
    expect(upper).toEqual(lower);
  });

  it('anchors the urlFilter using the normalized domain, not the raw casing', () => {
    const f = { ...base, domains: ['API.Example.com'], pathPattern: '/v2/' };
    expect(filterToCondition(f).urlFilter).toBe('||api.example.com^*/v2/');
  });

  it('derives requestDomains from the same normalized value the permission audit uses', () => {
    const f = { ...base, domains: ['API.Example.com'] };
    expect(filterToCondition(f).requestDomains).toEqual(['api.example.com']);
    expect(originsForFilter(f)).toEqual(['*://*.api.example.com/*']);
  });
});

describe('filterToCondition — regex mode', () => {
  const rx: Filter = { ...base, mode: 'regex', regex: '^https://api\\.example\\.com/v\\d+/' };

  it('emits regexFilter and never urlFilter', () => {
    const c = filterToCondition(rx);
    expect(c.regexFilter).toBe('^https://api\\.example\\.com/v\\d+/');
    expect(c).not.toHaveProperty('urlFilter');
  });

  it('still emits requestDomains, which composes with regexFilter', () => {
    expect(filterToCondition(rx).requestDomains).toEqual(['api.example.com']);
  });

  it('omits regexFilter when the regex is blank', () => {
    expect(filterToCondition({ ...rx, regex: '' })).not.toHaveProperty('regexFilter');
  });
});

describe('filterToCondition — shared', () => {
  it('always emits resourceTypes verbatim', () => {
    const f = { ...base, resourceTypes: ['xmlhttprequest', 'main_frame'] as const };
    expect(filterToCondition({ ...f, resourceTypes: [...f.resourceTypes] }).resourceTypes).toEqual([
      'xmlhttprequest',
      'main_frame',
    ]);
  });

  it('includes requestMethods only when non-empty', () => {
    expect(filterToCondition(base)).not.toHaveProperty('requestMethods');
    expect(filterToCondition({ ...base, requestMethods: ['get'] }).requestMethods).toEqual(['get']);
    expect(filterToCondition({ ...base, requestMethods: [] })).not.toHaveProperty('requestMethods');
  });

  it('adds tabIds when a tab id is supplied', () => {
    expect(filterToCondition(base, 42).tabIds).toEqual([42]);
  });

  it('omits tabIds for null and undefined', () => {
    expect(filterToCondition(base, null)).not.toHaveProperty('tabIds');
    expect(filterToCondition(base)).not.toHaveProperty('tabIds');
  });
});

describe('excludedRequestDomains goes through the same normalization', () => {
  const base: Filter = {
    mode: 'structured',
    allSites: false,
    domains: ['example.com'],
    excludedDomains: [],
    resourceTypes: ['xmlhttprequest'],
  };

  it('normalizes an excluded domain the way an included one is normalized', () => {
    const c = filterToCondition({ ...base, excludedDomains: ['*.Beta.Example.COM'] });
    expect(c.excludedRequestDomains).toEqual(['beta.example.com']);
  });

  it('drops an unusable excluded domain instead of registering a dead string', () => {
    const c = filterToCondition({
      ...base,
      excludedDomains: ['a b.com', 'beta.example.com'],
    });
    expect(c.excludedRequestDomains).toEqual(['beta.example.com']);
  });

  it('omits the key entirely when nothing survives — an empty array is not the same thing', () => {
    const c = filterToCondition({ ...base, excludedDomains: ['a b.com'] });
    expect(c).not.toHaveProperty('excludedRequestDomains');
  });

  it('deduplicates after normalization', () => {
    const c = filterToCondition({
      ...base,
      excludedDomains: ['Beta.example.com', '*.beta.example.com'],
    });
    expect(c.excludedRequestDomains).toEqual(['beta.example.com']);
  });
});
