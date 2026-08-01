import { analyzeDomain } from '@/lib/permissions/origins';
import type { Diagnostic, Operation, Profile } from '@/lib/model/types';

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

  const hostsOf = (p: Profile) =>
    p.filter.domains.map(analyzeDomain).filter((x) => x.valid).map((x) => x.host);

  const aHosts = hostsOf(a);
  const bHosts = hostsOf(b);

  // A profile with no usable domain matches every site.
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
  const active = [...profiles]
    .filter((p) => p.enabled)
    .sort((a, b) => a.order - b.order);

  for (let i = 0; i < active.length; i += 1) {
    const later = active[i];
    if (!later) continue;

    for (const rule of later.headers) {
      if (!rule.enabled) continue;
      const key = `${rule.target} ${rule.name.trim().toLowerCase()}`;

      for (let j = 0; j < i; j += 1) {
        const earlier = active[j];
        if (!earlier) continue;
        if (!mayOverlap(earlier, later)) continue;

        const clash = earlier.headers.find(
          (h) =>
            h.enabled &&
            `${h.target} ${h.name.trim().toLowerCase()}` === key &&
            !allowsAfter(h.operation, rule.operation),
        );
        if (!clash) continue;

        diagnostics.push({
          kind: 'profile-conflict',
          severity: 'warning',
          profileId: later.id,
          headerRuleId: rule.id,
          message:
            `"${earlier.name}" already ${clash.operation}s ${rule.name.trim()} ` +
            `on a matching site, so this row is discarded.`,
        });
        break; // one warning per row is enough to act on
      }
    }
  }

  return diagnostics;
}
