import { browser } from 'wxt/browser';
import { originCandidates, requestPattern } from '@/lib/permissions/origins';
import type { DomainGrant } from '@/lib/permissions/audit';

/**
 * Asks the browser whether one match pattern is already covered.
 *
 * `permissions.contains()` **throws** on a pattern the browser considers
 * malformed — a port, an embedded scheme, an empty host. A throw is not an
 * answer, so it is reported as "not granted" and the next candidate is tried.
 * Measured behaviour: docs/research/2026-08-01-permission-audit-spike.md §3.
 */
async function covers(origin: string): Promise<boolean> {
  try {
    return await browser.permissions.contains({ origins: [origin] });
  } catch {
    return false;
  }
}

/**
 * Whether each host is already granted, narrowest candidate first.
 *
 * **One origin per call, never a batch.** `contains()` rejects the entire call
 * when any member is malformed, so batching would throw away the answers for
 * every valid origin sent alongside it.
 */
export async function probeGrants(hosts: readonly string[]): Promise<DomainGrant[]> {
  const grants: DomainGrant[] = [];

  for (const host of hosts) {
    let granted = false;
    for (const candidate of originCandidates(host)) {
      if (await covers(candidate)) {
        granted = true;
        break;
      }
    }
    grants.push({ domain: host, granted });
  }

  return grants;
}

/**
 * Requests host access for one domain. Audit leniently, request generously —
 * the broad pattern means a later scheme change or new subdomain does not
 * prompt the user again.
 *
 * Must be called from a user gesture; the Grant button click is that gesture.
 */
export async function requestHost(host: string): Promise<boolean> {
  try {
    return await browser.permissions.request({ origins: [requestPattern(host)] });
  } catch {
    return false;
  }
}
