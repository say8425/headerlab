import { isSuppressed } from '@/lib/compile/suppression';
import { scopingHosts } from '@/lib/permissions/origins';
import type { Diagnostic, HeaderRule, Operation, Profile } from '@/lib/model/types';

/**
 * What Chromium still allows once an operation has been applied to a header
 * (design §7.2). The loser is discarded with no error, which is exactly the
 * silent failure this project exists to remove.
 */
function allowsAfter(first: Operation, second: Operation): boolean {
  if (first === 'append') return second === 'append';
  // `set` then `append` is allowed within the same extension, and every rule
  // here belongs to this extension.
  if (first === 'set') return second === 'append';
  return false; // remove allows nothing
}

/**
 * Conservative overlap: two profiles may collide unless we can show they
 * cannot. Deciding real overlap between arbitrary conditions is not generally
 * possible, and a false warning is cheaper than a silent discard.
 */
function mayOverlap(a: Profile, b: Profile): boolean {
  if (a.filter.mode === 'regex' || b.filter.mode === 'regex') return true;

  // Asked of `scopingHosts`, never re-derived from `filter.domains`. What
  // narrows a rule and what is stored in the list stopped being the same thing
  // when all-sites arrived: that mode keeps the user's entries and compiles
  // none of them, so reading the list here would see a profile scoped to one
  // host where the registered rule matches every site — and a profile that
  // overlaps everything would be judged to overlap almost nothing, discarding
  // its neighbours' headers with no warning at all.
  const aHosts = scopingHosts(a.filter);
  const bHosts = scopingHosts(b.filter);

  // A rule with no domain condition matches every site, so an empty answer
  // overlaps anything. Two ways to get one now: all-sites, which says so on
  // purpose, and regex mode, handled above. An entirely unusable list makes
  // the compiler emit no rule at all and an empty list with all-sites off is
  // suppressed too — neither reaches this function (see `active` below).
  if (aHosts.length === 0 || bHosts.length === 0) return true;

  // Domains match subdomains too, so `example.com` and `api.example.com`
  // overlap without being equal.
  return aHosts.some((x) =>
    bHosts.some((y) => x === y || x.endsWith(`.${y}`) || y.endsWith(`.${x}`)),
  );
}

/** Conflicts across enabled profiles, in the order the profiles compile. */
export function detectConflicts(profiles: readonly Profile[]): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  // Sorted by `order`, exactly as lib/compile/priority.ts's `allocate` sorts —
  // and for the same reason. `allocate` gives the first profile in that order
  // the highest priority (`active.length - index`), Chrome applies
  // modifyHeaders rules in descending priority, and §7.2's matrix is keyed on
  // whichever operation applied *first*. So the profile earliest in this order
  // is the winner.
  //
  // The array order of `state.profiles` is NOT that order. Sorting here is what
  // keeps the diagnostic from naming the loser as the winner.
  //
  // Suppressed profiles are excluded in both directions. A profile the compiler
  // emits no rule for cannot discard a neighbour's row, and its own rows cannot
  // be discarded — telling the user "«Broken» already sets Authorization, so
  // this row is discarded" while the same compile() also tells them «Broken» is
  // not applied is a contradiction, and design §5.4 treats one false positive
  // on a badge as enough for users to stop trusting every badge.
  const active = [...profiles]
    .filter((p) => p.enabled && !isSuppressed(p))
    .sort((a, b) => a.order - b.order);

  for (let i = 0; i < active.length; i += 1) {
    const later = active[i];
    if (!later) continue;

    // Profiles that could actually collide with `later`, still in priority
    // order. `mayOverlap` doesn't depend on the header row, so this is
    // computed once per `later` rather than once per row.
    const earlierCandidates = active.slice(0, i).filter((earlier) => mayOverlap(earlier, later));

    for (const rule of later.headers) {
      if (!rule.enabled) continue;
      const key = `${rule.target} ${rule.name.trim().toLowerCase()}`;

      // Only the *first* earlier profile to touch this header key ever
      // reaches Chrome's actual header state — whatever a profile before it
      // lost against was discarded and never applied. So the search stops at
      // the first match, whether or not that match clashes: it is the only
      // state `later` can collide with.
      let firstToucher: Profile | undefined;
      let definingRule: HeaderRule | undefined;
      for (const earlier of earlierCandidates) {
        const hit = earlier.headers.find(
          (h) => h.enabled && `${h.target} ${h.name.trim().toLowerCase()}` === key,
        );
        if (!hit) continue;
        firstToucher = earlier;
        definingRule = hit;
        break;
      }
      if (!firstToucher || !definingRule) continue;
      if (allowsAfter(definingRule.operation, rule.operation)) continue;

      diagnostics.push({
        kind: 'profile-conflict',
        severity: 'warning',
        profileId: later.id,
        headerRuleId: rule.id,
        message:
          `"${firstToucher.name}" already ${definingRule.operation}s ${rule.name.trim()} ` +
          `on a matching site, so this row is discarded.`,
      });
    }
  }

  return diagnostics;
}
