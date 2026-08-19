import { isSuppressed } from '@/lib/compile/suppression';
import { scopingHosts } from '@/lib/permissions/origins';
import type { Diagnostic, Profile } from '@/lib/model/types';

/** One domain's audit answer, as produced by the adapter. */
export interface DomainGrant {
  domain: string;
  granted: boolean;
}

/**
 * Hosts that need a permission check, deduplicated, in first-seen order.
 *
 * A suppressed profile is skipped rather than audited: the compiler emits no
 * rule for it, so a permission badge on it would point at a rule that does not
 * exist, and granting the permission would change nothing. This is the criterion
 * `isSuppressed` names — applied to the whole profile, not entry by entry,
 * because the compiler's decision is all-or-nothing.
 *
 * The hosts come from `scopingHosts`, which answers the same "what actually
 * narrows this rule" question the compiler and the conflict detector ask. That
 * is what keeps an all-sites profile out: it applies everywhere, so its stored
 * entries scope nothing, and probing them would put a permission badge on rows
 * that are not in use — the same wrong answer as auditing a suppressed
 * profile, arriving through a different door. What that mode needs instead is
 * `<all_urls>`, which is not auditable per-domain and is probed on its own
 * (`probeAllSites`).
 */
export function domainsToAudit(profiles: readonly Profile[]): string[] {
  const hosts: string[] = [];
  for (const profile of profiles) {
    if (!profile.enabled || isSuppressed(profile)) continue;
    for (const host of scopingHosts(profile.filter)) {
      if (!hosts.includes(host)) hosts.push(host);
    }
  }
  return hosts;
}

/**
 * `permission-missing` for every enabled profile that needs an ungranted host.
 *
 * One diagnostic per profile-domain pair: the badge lives on a profile row in
 * the UI, so a shared host has to reach every profile that depends on it.
 *
 * Skips suppressed profiles for the same reason `domainsToAudit` does — the
 * message below promises the rule *is* registered, and for a suppressed profile
 * that is simply false. `invalid-domain` from validateFilter is what such a
 * profile gets instead, and it names the real cause.
 */
export function auditDiagnostics(
  profiles: readonly Profile[],
  grants: readonly DomainGrant[],
): Diagnostic[] {
  const ungranted = new Set(grants.filter((g) => !g.granted).map((g) => g.domain));
  if (ungranted.size === 0) return [];

  const diagnostics: Diagnostic[] = [];
  for (const profile of profiles) {
    if (!profile.enabled || isSuppressed(profile)) continue;
    const seen = new Set<string>();
    // Same source as `domainsToAudit` above, so the hosts probed and the hosts
    // reported cannot come apart — a badge for a host nobody probed would
    // never clear, and a probed host with no badge is a silent failure.
    for (const host of scopingHosts(profile.filter)) {
      if (!ungranted.has(host) || seen.has(host)) continue;
      seen.add(host);
      diagnostics.push({
        kind: 'permission-missing',
        severity: 'warning',
        profileId: profile.id,
        host,
        // Direct, owner's wording (2026-08-18): the fact, bare. This text
        // renders as the Grant button's `title` and nowhere else — the
        // button beside it is the remedy, and since the readout learned
        // about access its own sentence ("blocked until access is granted")
        // says what the old second clause spent sixteen words on.
        message: `Needs permission for ${host}.`,
      });
    }
  }
  return diagnostics;
}
