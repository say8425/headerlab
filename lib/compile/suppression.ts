import { isValidDomain } from '@/lib/permissions/origins';
import type { Profile } from '@/lib/model/types';

/**
 * A profile the compiler will not emit a rule for.
 *
 * A non-ASCII or otherwise unusable domain makes Chrome reject the whole
 * updateDynamicRules batch, same as an unusable header name (see headers.ts) —
 * but unlike headers, a domain cannot be dropped individually: filterToCondition
 * only sets requestDomains when the list is non-empty, so skipping the profile's
 * only domain would produce a rule with *no* domain condition, and DNR matches
 * that against every site. A profile scoped to one host would silently start
 * modifying headers everywhere — a privacy regression strictly worse than the
 * transactional failure it would "fix". Failing the whole profile closed is the
 * only safe option; other profiles are unaffected.
 *
 * An **empty** list is suppressed too, and that is the newer half. It used to
 * compile to a rule with no domain condition — matching every site — because
 * an empty list was the only way a user could ask for that. `Filter.allSites`
 * says it directly now, so the two states are no longer spelled the same and
 * the empty one can mean what it looks like: nowhere, not everywhere. Failing
 * closed here is the same asymmetry as above, applied to the case that used to
 * be the exception.
 *
 * Mode-agnostic where it can be. conditions.ts sets requestDomains for a regex
 * rule too, so a regex profile that also lists a broken domain dies the same
 * way; the one thing the mode does decide is whether an *empty* list is scoped,
 * because a regex is a condition in its own right and a bare host list is not.
 *
 * **One definition, four callers.** compile.ts decides the rule, and
 * filterDiagnostics.ts, conflicts.ts and audit.ts all have to agree with it —
 * a diagnostic that disagrees about whether a profile is alive is worse than no
 * diagnostic, because it points the user at the wrong thing.
 *
 * This function exists because that is exactly what went wrong. The three
 * diagnostic modules were written new in Phase 2a, and each restated the
 * aliveness decision compile.ts had already made instead of asking it — one
 * with `some(valid)`, two with a per-entry skip. Tightening isValidDomain in
 * the same phase turned the divergence into a profile that was suppressed
 * while every diagnostic stayed silent. Add a fifth caller by calling this,
 * never by restating it.
 */
export type SuppressionReason =
  /** Nothing says where to apply: no site listed, and all-sites is off. */
  | 'no-scope'
  /** A listed site cannot be used, so the whole profile fails closed. */
  | 'unusable-site';

/**
 * *Why* the compiler will not emit a rule, or `null` when it will.
 *
 * The reason has to come from here rather than from each caller, for exactly
 * the argument this module's comment already makes about the yes/no answer.
 * `compile.ts` asks it before emitting, `audit.ts` before probing, and
 * `filterDiagnostics` picks its message from it; every one of those is a
 * second reading of the same decision, and a second reading is how the
 * four-way divergence started. One function decides, `isSuppressed` is
 * derived from it, and nothing else re-tests the fields.
 *
 * The rail reads it through none of these. A row's state comes from its own
 * `usable`/`inert`/`diagnostics` (SiteRow), which is why an unusable entry
 * marks itself and its neighbours are unaffected. A `suppressed` row state
 * existed briefly, for a valid entry whose profile some *other* entry had
 * killed; it went when that could no longer happen (2026-08-20), and this
 * paragraph is here so the claim is not restored from a stale reading.
 */
export function suppressionReason(profile: Profile): SuppressionReason | null {
  const { allSites, domains, mode } = profile.filter;

  // All-sites carries no domain condition **on purpose**, which is the one
  // thing the fail-open argument above could not previously distinguish. The
  // list is not compiled at all in this mode (conditions.ts), so an unusable
  // entry sitting in it cannot reach `updateDynamicRules` and cannot break the
  // batch — it is kept so switching back off restores the user's scope.
  if (allSites) return null;

  // **One bad entry no longer kills the good ones (owner's call, 2026-08-20).**
  // This used to be `!domains.every(isValidDomain)` — any unusable entry
  // failed the whole profile closed. The reason was real but narrower than the
  // rule it produced: `conditions.ts` took the list raw, so a malformed domain
  // would have reached `updateDynamicRules`, which is transactional and would
  // have rejected every rule in the batch. That file now drops unusable
  // entries, so what is left to decide here is only the case dropping cannot
  // survive — nothing usable remaining, where an empty domain condition means
  // *every site* rather than none.
  const usable = domains.filter(isValidDomain);

  if (mode !== 'regex') {
    // An empty list is suppressed, where v1 compiled it to a rule matching
    // every site. That change is the point of `allSites`: "everywhere" has a
    // name now, so an empty list can finally mean what it looks like. The two
    // empties are told apart by what the user actually typed: entries that
    // could not be used, versus no entries at all.
    if (usable.length === 0) return domains.length > 0 ? 'unusable-site' : 'no-scope';
    return null;
  }

  // A regex is its own condition, so the list only narrows it further and an
  // empty one is scoped and stays alive. A list that was entirely unusable is
  // still fatal here, and for a reason the structured branch does not share:
  // dropping every entry would silently widen the rule from "these hosts"
  // to "everywhere this pattern matches", which is not what the user wrote.
  if (domains.length > 0 && usable.length === 0) return 'unusable-site';

  return null;
}

export function isSuppressed(profile: Profile): boolean {
  return suppressionReason(profile) !== null;
}
