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

/**
 * The one origin all-sites mode needs.
 *
 * `<all_urls>` is not a host and cannot go through the two functions above:
 * `originCandidates` would build `https://<all_urls>/*`, and the ladder it
 * exists to climb has no rungs here — there is no narrower grant that could
 * satisfy this and no broader one to fall back to. One pattern, asked
 * directly.
 *
 * Declared in `optional_host_permissions` in wxt.config.ts, which is what
 * makes it requestable at runtime. Deliberately **not** in `permissions` — the
 * manifest still asks for no host access at install, and
 * tests/unit/manifest.test.ts holds that line.
 */
export const ALL_URLS = '<all_urls>';

/** Whether every site has already been granted. */
export async function probeAllSites(): Promise<boolean> {
  return covers(ALL_URLS);
}

/**
 * Asks for every site. Must be called from a user gesture — flipping the
 * all-sites switch on is that gesture, and so is its Grant button.
 *
 * The grant belongs to the mode rather than following it: applying everywhere
 * is exactly what `<all_urls>` buys, so the cost is put in front of the user at
 * the moment of choosing instead of being discovered later, by rules that
 * registered and quietly never fired.
 */
export async function requestAllSites(): Promise<boolean> {
  try {
    return await browser.permissions.request({ origins: [ALL_URLS] });
  } catch {
    return false;
  }
}
