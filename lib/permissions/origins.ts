import type { Filter } from '@/lib/model/types';

/** Normalizes a user-entered domain to a bare host. */
function normalizeDomain(domain: string): string {
  let d = domain.trim().toLowerCase();
  if (d.startsWith('*.')) d = d.slice(2);
  if (d.startsWith('.')) d = d.slice(1);
  return d;
}

/**
 * Match patterns to test with permissions.contains(), narrowest first.
 *
 * contains() is a subset check, so a broad pattern returns false when the user
 * granted only a narrow one. Testing narrowest-first and accepting any hit
 * prevents a false "grant needed" badge on a configuration that actually works.
 */
export function originCandidates(domain: string): string[] {
  const d = normalizeDomain(domain);
  return [
    `https://${d}/*`,
    `https://*.${d}/*`,
    `*://${d}/*`,
    `*://*.${d}/*`,
  ];
}

/** The pattern to pass to permissions.request(): audit leniently, request generously. */
export function requestPattern(domain: string): string {
  return `*://*.${normalizeDomain(domain)}/*`;
}

export function originsForFilter(filter: Filter): string[] {
  const domains = filter.domains
    .map(normalizeDomain)
    .filter((d) => d.length > 0);

  if (domains.length === 0) return ['<all_urls>'];

  return [...new Set(domains)].map((d) => `*://*.${d}/*`);
}
