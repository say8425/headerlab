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
 * An **empty** list is therefore not suppressed: it compiles to a rule with no
 * domain condition on purpose, and `empty-filter` warns about exactly that.
 * `every` is vacuously true on an empty array, so the length test below is
 * redundant for behaviour — it is there to state the boundary, because reading
 * `!every(...)` alone gives no hint that the empty case was considered at all.
 *
 * Mode-agnostic on purpose. conditions.ts sets requestDomains for a regex rule
 * too, so a regex profile that also lists a broken domain dies the same way.
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
export function isSuppressed(profile: Profile): boolean {
  const { domains } = profile.filter;
  return domains.length > 0 && !domains.every(isValidDomain);
}
