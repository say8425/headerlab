import { describe, expect, it } from 'vitest';
import { analyzeDomain, effectiveDomain, originCandidates, originsForFilter, requestPattern } from '@/lib/permissions/origins';
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
    allSites: false,
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

  it('returns <all_urls> for an all-sites filter — that is what the mode costs', () => {
    expect(originsForFilter({ ...base, allSites: true, domains: [] }))
      .toEqual(['<all_urls>']);
  });

  it('still returns <all_urls> for an all-sites filter that has sites listed', () => {
    // The list is kept but not compiled, so the rule matches every site and
    // needs access to every site. Narrowing the grant to the stored entries
    // would leave the rule registered and quietly inert everywhere else.
    expect(originsForFilter({ ...base, allSites: true, domains: ['api.example.com'] }))
      .toEqual(['<all_urls>']);
  });

  it('asks for nothing when no domain narrows the filter and all-sites is off', () => {
    // Suppressed: it compiles to no rule, so there is no access to ask for.
    // Returning `<all_urls>` here — which it used to — requested the broadest
    // grant the browser has on behalf of a rule that does not exist.
    expect(originsForFilter({ ...base, allSites: false, domains: [] })).toEqual([]);
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

  it('normalizes a pasted URL into a usable pattern instead of dropping it', () => {
    // This entry used to be dropped. §3 measured `*://*.https://x.com/*` as
    // THREW — Invalid port, and one throwing entry poisons the whole
    // contains()/request() call it is passed to; §4 concluded the answer is to
    // normalize rather than reject. Normalizing removes both hazards at once —
    // the host reaches requiredOrigins as a pattern that actually matches, so
    // there is nothing left to drop and nothing left to throw.
    expect(originsForFilter({
      ...base,
      domains: ['api.example.com', 'https://staging.example.com/admin'],
    })).toEqual(['*://*.api.example.com/*', '*://*.staging.example.com/*']);
  });

  it('drops an entry with internal whitespace too', () => {
    // The same table records `a b.com` as returning false without throwing —
    // a different failure, but a pattern that can never match is still one
    // this field must not carry.
    expect(originsForFilter({ ...base, domains: ['api.example.com', 'a b.com'] }))
      .toEqual(['*://*.api.example.com/*']);
  });

  it('asks for nothing when no entry is usable, because nothing is registered', () => {
    // Internal whitespace, which normalization cannot rescue — there is no
    // reading of `a b.com` that names one host. The profile is suppressed, so
    // the honest answer is that it needs no access at all; `<all_urls>`, which
    // this used to return, is the broadest grant there is.
    expect(originsForFilter({ ...base, domains: ['a b.com'] })).toEqual([]);
  });
});

describe('analyzeDomain', () => {
  it('strips a trailing port and says so', () => {
    expect(analyzeDomain('localhost:3000')).toEqual({
      host: 'localhost',
      valid: true,
    });
  });

  it('leaves a plain host untouched', () => {
    expect(analyzeDomain('api.example.com')).toEqual({
      host: 'api.example.com',
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

  it('does not mistake a scheme\'s own colon for a port', () => {
    // Only a trailing :digits is a port, and the scheme is stripped before
    // that test runs, so neither colon can be read as the other's. Both
    // directions are pinned on the host that comes out: a scheme alone leaves
    // the whole host, and a scheme with a real port still loses the port.
    expect(analyzeDomain('https://example.com').host).toBe('example.com');
    expect(analyzeDomain('https://example.com:8443')).toEqual({
      host: 'example.com', valid: true,
    });
  });

  it('normalizes a pasted URL to its host rather than rejecting it', () => {
    // The exact string the owner pasted. Rejecting it would block the single
    // most natural thing to do with a field labelled "add a site", and §4
    // settled that question for ports already: normalize, then say so.
    expect(analyzeDomain('https://www.musinsa.com/')).toEqual({
      host: 'www.musinsa.com',
      valid: true,
    });
  });

  it('normalizes any scheme, not just https', () => {
    // The scheme pattern is RFC 3986's, so it is not an https special case.
    expect(analyzeDomain('http://example.com/x').host).toBe('example.com');
    expect(analyzeDomain('ws://example.com').host).toBe('example.com');
  });

  it('rejects internal whitespace — DNR registers it and it never matches', () => {
    expect(analyzeDomain('a b.com').valid).toBe(false);
  });

  it('strips a path even with no scheme in front of it', () => {
    // A host with a path but no scheme is the other half of a pasted address,
    // and it reaches the same host.
    expect(analyzeDomain('example.com/api')).toEqual({
      host: 'example.com', valid: true,
    });
  });

  it('strips a query and a fragment too', () => {
    // All three delimiters end the host. Without the query case, `?` would
    // survive into a pattern HOST_FORBIDDEN then rejects, turning a paste into
    // an unusable entry for a reason the user cannot see.
    expect(analyzeDomain('example.com/a?b=1').host).toBe('example.com');
    expect(analyzeDomain('example.com#frag').host).toBe('example.com');
  });

  it('leaves an already-bare host exactly as it was', () => {
    // The ordinary entry has to survive every strip above untouched — a
    // normalizer that quietly edited a plain hostname would change what the
    // popup stores and shows for input that needed no help.
    expect(analyzeDomain('example.com')).toEqual({ host: 'example.com', valid: true });
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

describe('effectiveDomain', () => {
  it('gives back the host for anything that has one', () => {
    // This is the value the popup stores *and* the value it shows, so the two
    // cannot drift apart. The owner's own paste is the first case.
    expect(effectiveDomain('https://www.musinsa.com/')).toBe('www.musinsa.com');
    expect(effectiveDomain('localhost:3000')).toBe('localhost');
    expect(effectiveDomain('EXAMPLE.COM')).toBe('example.com');
    expect(effectiveDomain('  api.example.com  ')).toBe('api.example.com');
  });

  it('gives back the host of a deep path, not the path', () => {
    // The URL the owner actually pasted the second time, verbatim.
    expect(effectiveDomain(
      'https://www.musinsa.com/snap/_next/data/K_la.../recommend.json',
    )).toBe('www.musinsa.com');
  });

  it('keeps unusable input exactly as typed, so the row can name it', () => {
    // There is no host to fall back on here, and reducing it to a fragment —
    // or to the empty string — would leave a broken chip that cannot say what
    // is broken. The text the user wrote is the only useful thing to show.
    expect(effectiveDomain('a b.com')).toBe('a b.com');
    expect(effectiveDomain('https://')).toBe('https://');
  });

  it('normalizes to a fixed point, not one pass each', () => {
    // The strips used to run once apiece, so `*.*.example.com` came out as
    // `*.example.com` — a value that still normalizes further on the next read.
    // Display survived that because the rail re-normalizes what it shows; the
    // *dedupe* did not, since the popup stores this value and compares stored
    // against typed. Asserted as a fixed point rather than on one input:
    // `effectiveDomain` of its own output must be its own output.
    for (const input of ['*.*.example.com', '..example.com', 'example.com..', '*..example.com']) {
      expect(effectiveDomain(input)).toBe('example.com');
      expect(effectiveDomain(effectiveDomain(input))).toBe(effectiveDomain(input));
    }
  });

  it('still refuses to reduce a double port to a usable host', () => {
    // The port strip stays outside the loop on purpose. Looping it would turn
    // `example.com:80:90` into something that looks like one site, and no
    // reading of that input supports it.
    expect(analyzeDomain('example.com:80:90').valid).toBe(false);
  });

  it('collapses two spellings of one site onto the same value', () => {
    // Which is what makes de-duplication on commit possible at all: after
    // normalization these are not two sites, and the popup has to know it.
    expect(effectiveDomain('https://x.com/')).toBe(effectiveDomain('x.com'));
  });
});
