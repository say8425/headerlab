import { isSuppressed } from '@/lib/compile/suppression';
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

  // `raw` is kept alongside the analysis so the message below can name the
  // line the user typed rather than the normalized host — "https://x.com"
  // normalizes to itself, but "A B.com:80" would not.
  const analyses = filter.domains.map((d) => ({ raw: d, ...analyzeDomain(d) }));

  // A suppressed profile compiles to nothing, so saying so is the whole point:
  // without this the profile is enabled, its header rows look fine, and nothing
  // is modified. That silence is the failure shape this project exists to
  // remove, hence `error` rather than `warning`.
  //
  // Raised above the regex branch on purpose. compile.ts's suppression is
  // mode-agnostic and conditions.ts sets requestDomains for a regex rule too,
  // so a regex profile that lists a broken domain dies the same way — and the
  // regex branch below returns before `empty-filter` could catch it.
  //
  // Never fires together with `empty-filter`, whose condition is untouched:
  //   structured + all-invalid  -> empty-filter (this branch declines)
  //   structured + empty        -> empty-filter (not suppressed)
  //   structured + mixed        -> here
  //   regex + anything invalid  -> here (empty-filter never fires in regex mode)
  //   regex + empty             -> neither; the pattern is the condition
  const anyValid = analyses.some((a) => a.valid);
  if (isSuppressed(profile) && (filter.mode === 'regex' || anyValid)) {
    const bad = analyses.filter((a) => !a.valid).map((a) => `"${a.raw}"`);
    diagnostics.push({
      kind: 'invalid-domain',
      severity: 'error',
      profileId: profile.id,
      // Two different problems needing two different actions: with a usable
      // entry left the fix is to repair the bad lines, with none left there is
      // nothing to salvage — and clearing the list is itself a fix, because a
      // regex profile with no domains is legitimate.
      message: anyValid
        ? `${bad.length === 1 ? 'Unusable domain' : 'Unusable domains'}: ${bad.join(', ')}. ` +
          'The whole profile is not applied until every domain in it is usable.'
        : `No usable domain: ${bad.join(', ')}. This profile is not applied. ` +
          'Fix these, or clear the domain list so the regex alone decides what matches.',
    });
  }

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
