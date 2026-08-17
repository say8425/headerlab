import { suppressionReason } from '@/lib/compile/suppression';
import { analyzeDomain } from '@/lib/permissions/origins';
import type { Diagnostic, Profile } from '@/lib/model/types';

// Differs from origins.ts's ASCII_ONLY (`+`, rejects empty): `*` here because
// filter.pathPattern can be defined but empty, and an empty pathPattern must
// not be flagged as non-ASCII. Keep separate — unifying on `+` would
// misreport an empty pathPattern as invalid.
// An ASCII range check, not a pattern that means to match a control character.
// See origins.ts for the same suppression and the same reason.
// oxlint-disable-next-line no-control-regex
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
 *
 * **Says nothing about the domain list while all-sites is on.** Both messages
 * below promise something about whether rules are applied, and in that mode
 * both promises are false: the list is not compiled (conditions.ts), so an
 * unusable entry in it stops nothing and an empty one means nothing. The entry
 * is still marked broken on its own row in the rail, which is where a value
 * the user can see and edit belongs — an error card claiming "nothing is
 * applied" over an extension applying to every site would be the screen
 * contradicting itself.
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
  // regex branch below returns before the no-scope check could catch it.
  //
  // The reason comes from `suppressionReason`, never from re-reading the
  // fields. That is what collapsed the old branch: this used to ask
  // `isSuppressed(...) && (mode === 'regex' || anyValid)`, a hand-built
  // restatement of which suppressed states belonged to which message, and it
  // left structured-and-all-invalid to be reported by `empty-filter` as a
  // *warning* — a profile applying to nothing, filed under the same kind and
  // severity as one applying to everything. The two now split by reason:
  //   'unusable-site' -> here, an error, in either mode
  //   'no-scope'      -> below, incomplete, structured only
  const reason = suppressionReason(profile);
  const anyValid = analyses.some((a) => a.valid);
  if (reason === 'unusable-site') {
    const bad = analyses.filter((a) => !a.valid).map((a) => `"${a.raw}"`);
    diagnostics.push({
      kind: 'invalid-domain',
      severity: 'error',
      profileId: profile.id,
      // Two different problems needing two different actions: with a usable
      // entry left the fix is to repair the bad lines, with none left there is
      // nothing to salvage. Neither branch tells the reader to clear the list.
      // It used to, on the grounds that a regex profile with no domains is
      // legitimate — but that advice was only ever true in regex mode, and in
      // structured mode an empty list is now its own suppressed state, so
      // following it would move the profile from one silence to another.
      // States the cause, then the remedy. The version this replaces named
      // only the consequence — "the whole profile is not applied" — which
      // leaves a user who pasted something reasonable with nothing to act on.
      // "Profile" is gone from the wording too: the UI has one implicit rule
      // set and no profiles, so the word named something the reader cannot
      // see. The internal `profileId` is untouched.
      message: anyValid
        ? `${bad.length === 1 ? 'Unusable site' : 'Unusable sites'}: ${bad.join(', ')}. ` +
          'A site must be a bare hostname like example.com. ' +
          'No rule is applied until every site here is usable.'
        : `No usable site: ${bad.join(', ')}. Use a bare hostname like example.com. ` +
          'Nothing is applied while every site is unusable.',
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

  // The state a fresh install opens in: nothing has been said about where
  // these rules apply, so they do not apply. It still has to reach the screen
  // — "never suppress without saying so" holds however ordinary the cause —
  // but it is said calmly and not warned about, because nothing here is wrong
  // or at risk. Nothing is happening, which is the safe direction, and the two
  // ways out are named rather than implied.
  //
  // The standing warning this replaces said the opposite ("these rules apply
  // everywhere"), and it was accurate: with no way to declare all-sites, an
  // empty list really did compile to a rule matching every site. Removing the
  // warning without `Filter.allSites` would have been removing the only notice
  // of that; with it, the state being warned about no longer happens by
  // accident, so the warning has nothing left to describe.
  if (reason === 'no-scope') {
    diagnostics.push({
      kind: 'no-scope',
      severity: 'incomplete',
      profileId: profile.id,
      message:
        'No site set yet, so nothing is being applied. ' +
        'Add a site above, or turn on All sites.',
    });
  }

  return diagnostics;
}
