import { analyzeDomain } from '@/lib/permissions/origins';
import type { Diagnostic, Profile } from '@/lib/model/types';

/** One domain's audit answer, as produced by the adapter. */
export interface DomainGrant {
  domain: string;
  granted: boolean;
}

/**
 * Hosts that need a permission check, deduplicated, in first-seen order.
 *
 * A profile with no usable domain is skipped rather than audited as
 * `<all_urls>`: it is already suppressed by the compiler, so a permission
 * badge on it would point at a rule that does not exist.
 */
export function domainsToAudit(profiles: readonly Profile[]): string[] {
  const hosts: string[] = [];
  for (const profile of profiles) {
    if (!profile.enabled) continue;
    for (const domain of profile.filter.domains) {
      const { host, valid } = analyzeDomain(domain);
      if (!valid) continue;
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
 */
export function auditDiagnostics(
  profiles: readonly Profile[],
  grants: readonly DomainGrant[],
): Diagnostic[] {
  const ungranted = new Set(
    grants.filter((g) => !g.granted).map((g) => g.domain),
  );
  if (ungranted.size === 0) return [];

  const diagnostics: Diagnostic[] = [];
  for (const profile of profiles) {
    if (!profile.enabled) continue;
    const seen = new Set<string>();
    for (const domain of profile.filter.domains) {
      const { host, valid } = analyzeDomain(domain);
      if (!valid || !ungranted.has(host) || seen.has(host)) continue;
      seen.add(host);
      diagnostics.push({
        kind: 'permission-missing',
        severity: 'warning',
        profileId: profile.id,
        message:
          `HeaderLab needs permission for ${host}. ` +
          'The rule is registered but will not apply until you grant it.',
      });
    }
  }
  return diagnostics;
}
