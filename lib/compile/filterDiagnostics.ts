import { analyzeDomain } from '@/lib/permissions/origins';
import type { Diagnostic, Profile } from '@/lib/model/types';

// Differs from origins.ts's ASCII_ONLY (`+`, rejects empty): `*` here because
// filter.pathPattern can be defined but empty, and an empty pathPattern must
// not be flagged as non-ASCII. Keep separate — unifying on `+` would
// misreport an empty pathPattern as invalid.
const ASCII_ONLY = /^[\x00-\x7F]*$/;

/** regexFilter must be under 2KB once compiled. The source length is a cheap
 *  upper bound — a source this long cannot compile smaller. */
const REGEX_MAX_SOURCE = 2048;

/**
 * Diagnostics for one profile's filter.
 *
 * `regex-unsupported` here covers only what can be decided without a browser:
 * ASCII-ness and size. `chrome.declarativeNetRequest.isRegexSupported()` is the
 * authority on RE2 syntax and lives in the adapter layer; the regex editor that
 * would call it is Phase 2c.
 */
export function validateFilter(profile: Profile): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const { filter } = profile;

  if (filter.mode === 'regex') {
    const regex = filter.regex ?? '';
    if (regex.length === 0) {
      diagnostics.push({
        kind: 'regex-unsupported',
        severity: 'error',
        profileId: profile.id,
        message: 'Regex mode is on but no pattern is set.',
      });
    } else if (!ASCII_ONLY.test(regex)) {
      diagnostics.push({
        kind: 'regex-unsupported',
        severity: 'error',
        profileId: profile.id,
        message: 'Chrome only accepts ASCII characters in a regex filter.',
      });
    } else if (regex.length > REGEX_MAX_SOURCE) {
      diagnostics.push({
        kind: 'regex-unsupported',
        severity: 'error',
        profileId: profile.id,
        message: 'This regex is too large. Chrome caps a compiled pattern at 2KB.',
      });
    }
    // A regex filter is its own condition — an empty domain list is expected.
    return diagnostics;
  }

  if (filter.pathPattern !== undefined && !ASCII_ONLY.test(filter.pathPattern)) {
    diagnostics.push({
      kind: 'regex-unsupported',
      severity: 'error',
      profileId: profile.id,
      message: 'Chrome only accepts ASCII characters in a path pattern.',
    });
  }

  const analyses = filter.domains.map(analyzeDomain);

  // An unusable entry raises no diagnostic of its own — the profile-level
  // `empty-filter` below is what the user has to act on, and per-entry noise
  // would bury it.
  //
  // Deduped by host: 'localhost:3000' and 'localhost:8080' both normalize to
  // the same host, and requestDomains only ever sees that one host — the same
  // reason originsForFilter (origins.ts) dedupes with a Set. Without this, the
  // user sees the identical warning once per port instead of once per host.
  const portIgnoredHosts = new Set<string>();
  for (const a of analyses) {
    if (!a.portDropped || !a.valid || portIgnoredHosts.has(a.host)) continue;
    portIgnoredHosts.add(a.host);
    diagnostics.push({
      kind: 'port-ignored',
      severity: 'warning',
      profileId: profile.id,
      message:
        `Port ignored — this applies to every port on ${a.host}. ` +
        'Chrome matches requests by host, not by port.',
    });
  }

  if (!analyses.some((a) => a.valid)) {
    diagnostics.push({
      kind: 'empty-filter',
      severity: 'warning',
      profileId: profile.id,
      message: filter.domains.length === 0
        ? 'No domain set — this profile applies to every site.'
        : 'No usable domain — this profile would apply to every site, so it is not applied.',
    });
  }

  return diagnostics;
}
