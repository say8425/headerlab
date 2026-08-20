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
  // regex branch below returns early, so anything raised after it is
  // unreachable in regex mode.
  //
  // The reason comes from `suppressionReason`, never from re-reading the
  // fields. That is what collapsed the old branch: this used to ask
  // `isSuppressed(...) && (mode === 'regex' || anyValid)`, a hand-built
  // restatement of which suppressed states belonged to which message, and it
  // left structured-and-all-invalid to be reported by `empty-filter` as a
  // *warning* — a profile applying to nothing, filed under the same kind and
  // severity as one applying to everything. The two now split by reason:
  //   'unusable-site' -> here, an error, in either mode
  //   'no-scope'      -> nothing at all any more; the readout says it (below)
  const reason = suppressionReason(profile);
  const bad = analyses.filter((a) => !a.valid).map((a) => `"${a.raw}"`);
  // Raised for **any** unusable entry now, not only for one that kills the
  // profile. Since 2026-08-20 a bad entry is dropped from the scope and its
  // usable neighbours go on working (see `suppression.ts`), and that drop is a
  // suppression like any other: silent, unless said. The two cases are one
  // diagnostic with two severities rather than two kinds, because a reader
  // acts on them identically — fix the entry — and only the consequence
  // differs.
  // The all-sites exemption used to arrive for free: this branch only ran for
  // `reason === 'unusable-site'`, and `suppressionReason` returns null in that
  // mode. Widening the branch to every unusable entry broke that coupling and
  // started reporting a list all-sites does not compile — so the mode is named
  // here now, where it can be read. The docblock above argues the case: the
  // entry is still marked broken on its own row, which is where a value the
  // user can edit belongs.
  if (bad.length > 0 && !filter.allSites) {
    const fatal = reason === 'unusable-site';
    diagnostics.push({
      kind: 'invalid-domain',
      severity: fatal ? 'error' : 'warning',
      profileId: profile.id,
      // Two different problems needing two different actions: with a usable
      // entry left the fix is to repair the bad lines, with none left there is
      // nothing to salvage. Neither branch tells the reader to clear the list.
      // It used to, on the grounds that a regex profile with no domains is
      // legitimate — but that advice was only ever true in regex mode, and in
      // structured mode an empty list is now its own suppressed state, so
      // following it would move the profile from one silence to another.
      // Direct, owner's wording (2026-08-18): the bad value, then the rule.
      // The consequence trailing each branch used to say "no rule is applied
      // until…" — which is the readout's own sentence ("blocked by an
      // unusable site") and the note's own border colour; naming it here was
      // the note repeating the screen. "Profile" is gone from the wording
      // too: the UI has one implicit rule set and no profiles, so the word
      // named something the reader cannot see. The internal `profileId` is
      // untouched.
      // The remedy is the last sentence in both branches, and it has to stay
      // there: `SiteRow` carries that exact sentence on the row's own Badge
      // and in its accessible name, and a test pins the two to each other.
      message: fatal
        ? `No usable site: ${bad.join(', ')}. Use a bare hostname like example.com.`
        : `${bad.length === 1 ? 'Unusable site' : 'Unusable sites'}: ${bad.join(', ')}. ` +
          'Skipped. Use a bare hostname like example.com.',
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

  // **No `no-scope` diagnostic any more — owner's ruling (2026-08-19).** The
  // popup used to render it as a note above the sites ("No site set yet, so
  // nothing is being applied. Add a site above, or turn on All sites."); the
  // note is gone and the diagnostic went with it, because the saying-so it
  // existed for is the readout's own sentence — "N blocked until a site is
  // set" sits beside the count in every state, and "never suppress without
  // saying so" is satisfied by a sentence that is always on screen rather
  // than a note that appeared and departed. `suppressionReason` still names
  // the reason (the readout's blame asks it, never this file), and the
  // compiler still fails the profile closed exactly as before.

  return diagnostics;
}
