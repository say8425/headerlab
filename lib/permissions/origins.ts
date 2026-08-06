import type { Filter } from '@/lib/model/types';

const ASCII_ONLY = /^[\x00-\x7F]+$/;

/**
 * Characters that make a host unusable, measured rather than assumed:
 *
 * - `:` and `/` make `permissions.contains()` **throw**, which kills the whole
 *   audit call — not just the candidate carrying them.
 * - whitespace is accepted by both DNR and contains(), and then never matches
 *   anything. A silently dead rule is worse than a rejected one.
 *
 * A trailing `:digits` is handled before this test runs — that is a port, and
 * ports are normalized away rather than rejected.
 */
const HOST_FORBIDDEN = /[\s/:?#@\\]/;

/**
 * Only a trailing colon followed by digits is a port. An embedded scheme ends
 * in letters, so `https://example.com` is not mistaken for one.
 *
 * A bracketed IPv6 literal (`[::1]`) matches neither this nor the host shape
 * below, so it is reported invalid. That is deliberate for now: Chrome match
 * patterns and `requestDomains` both treat IPv6 as an edge case, and no
 * measurement backs a specific handling yet.
 */
const TRAILING_PORT = /^(.+):(\d{1,5})$/;

/**
 * A leading URL scheme — the letters/digits/`+`/`-`/`.` RFC 3986 allows,
 * followed by `://`.
 *
 * Anchored and explicit rather than delegating to `new URL()`. A bare host is
 * the common input here and is not a URL at all: `new URL('example.com')`
 * throws, and the usual workaround of prefixing a scheme makes the parser
 * accept and silently rewrite things that are not hosts — `a b.com` comes back
 * percent-encoded, which would turn an input this module is supposed to *call
 * invalid* into a plausible-looking host that can never match.
 */
const LEADING_SCHEME = /^[a-z][a-z0-9+.-]*:\/\//;

/** Where a host stops and a path, query or fragment begins. */
const PATH_START = /[/?#]/;

export interface DomainAnalysis {
  /** Normalized bare host: trimmed, lowercased, no scheme, no path, no leading `*.`/`.`, no port. */
  host: string;
  /** The input carried a port and it was dropped. */
  portDropped: boolean;
  /** The input was a URL — a scheme, a path, or both — and only the host was kept. */
  urlTrimmed: boolean;
  /** The host can be used in a DNR condition and in a match pattern. */
  valid: boolean;
}

/**
 * Normalizes a user-entered domain and reports what had to be changed.
 *
 * Ports are **normalized away, not rejected.** `requestDomains` is host-only —
 * it cannot express a port, and a host match applies on every port. Rejecting
 * `localhost:3000` would block the most common input this tool receives; the
 * caller raises a `port-ignored` diagnostic so the change is never silent.
 */
export function analyzeDomain(domain: string): DomainAnalysis {
  let d = domain.trim().toLowerCase();

  // A pasted URL is normalized to its host, not rejected — the same decision
  // the spike reached for ports, applied to the same table row. §4 measured
  // `https://example.com` as a string DNR accepts into a rule that can never
  // match *and* that makes `permissions.contains()` throw, which kills the
  // whole audit call. Rejecting it instead would block the single most natural
  // thing to do with a field labelled "add a site", and dropping it from a
  // one-domain list would leave a rule with no condition that matches every
  // site — the fail-open trap normalization exists to remove.
  //
  // Done before the port test so the scheme's own colon is gone by the time
  // TRAILING_PORT runs; that regex still only accepts a trailing colon plus
  // digits, so `https://example.com` was never mistaken for a port and still
  // is not.
  let urlTrimmed = false;
  const withoutScheme = d.replace(LEADING_SCHEME, '');
  if (withoutScheme !== d) {
    d = withoutScheme;
    urlTrimmed = true;
  }
  const pathAt = d.search(PATH_START);
  if (pathAt !== -1) {
    d = d.slice(0, pathAt);
    urlTrimmed = true;
  }

  if (d.startsWith('*.')) d = d.slice(2);
  if (d.startsWith('.')) d = d.slice(1);

  let portDropped = false;
  const withPort = TRAILING_PORT.exec(d);
  // `noUncheckedIndexedAccess` makes the capture `string | undefined`.
  const host = withPort?.[1];
  if (host !== undefined) {
    d = host;
    portDropped = true;
  }

  // `example.com.` and `example.com` are the same host spelled two ways.
  if (d.endsWith('.')) d = d.slice(0, -1);

  const valid = d.length > 0 && ASCII_ONLY.test(d) && !HOST_FORBIDDEN.test(d);
  return { host: d, portDropped, urlTrimmed, valid };
}

/**
 * Exported so lib/compile/conditions.ts normalizes the same way this module
 * does — otherwise the same user string becomes a different value in the
 * permission audit than in the compiled rule condition.
 */
export function normalizeDomain(domain: string): string {
  return analyzeDomain(domain).host;
}

export function isValidDomain(domain: string): boolean {
  return analyzeDomain(domain).valid;
}

/**
 * Match patterns to test with permissions.contains(), narrowest first.
 *
 * contains() is a subset check, so a broad pattern returns false when the user
 * granted only a narrow one. Testing narrowest-first and accepting any hit
 * prevents a false "grant needed" badge on a configuration that actually works.
 *
 * **Both schemes get their own rungs.** `*://` is broader than either `http://`
 * or `https://`, so an extension granted only `http://127.0.0.1/*` fails every
 * https-only and every `*://` candidate. Measured, not inferred — see
 * docs/research/2026-08-01-permission-audit-spike.md §2.
 */
export function originCandidates(domain: string): string[] {
  const d = normalizeDomain(domain);
  return [
    `https://${d}/*`,
    `http://${d}/*`,
    `https://*.${d}/*`,
    `http://*.${d}/*`,
    `*://${d}/*`,
    `*://*.${d}/*`,
  ];
}

/**
 * The pattern to pass to permissions.request(): audit leniently, request
 * generously. Verified to cover a bare IPv4 host as well as subdomains.
 */
export function requestPattern(domain: string): string {
  return `*://*.${normalizeDomain(domain)}/*`;
}

/**
 * Match patterns this filter needs granted, or `['<all_urls>']` when it cannot
 * be narrowed.
 *
 * Filters on **validity**, not merely on non-emptiness. A bare length check let
 * `https://staging.example.com` through and built
 * `*://*.https://staging.example.com/*` — measured as **THREW — Invalid port**
 * in docs/research/2026-08-01-permission-audit-spike.md §3. That matters more
 * than a wrong answer would: one bad entry poisons the entire
 * `contains()`/`request()` call it is passed to, so a single pasted URL would
 * kill the whole grant flow. (Internal whitespace, `a b.com`, returns false
 * without throwing — a different failure, but a pattern that can never match is
 * no more useful here.)
 *
 * `probe.ts` guards this API with "one host at a time, each individually
 * caught"; this field is a second door to it that bypasses that guard, so the
 * patterns it emits have to be sound at the source.
 */
export function originsForFilter(filter: Filter): string[] {
  const domains = filter.domains.filter(isValidDomain).map(normalizeDomain);

  if (domains.length === 0) return ['<all_urls>'];

  return [...new Set(domains)].map((d) => `*://*.${d}/*`);
}
