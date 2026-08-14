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
 * Asks for every site. Must be called from a user gesture — the all-sites Grant
 * button click is that gesture, and it is the only caller.
 *
 * Deliberately **not** called by the switch that turns the mode on. `<all_urls>`
 * is the largest grant this extension can ask for, and prompting for it because
 * a switch moved is helping yourself rather than asking. Adding a site does not
 * prompt either; it produces a pending row whose Grant button does. All-sites
 * reaches the same state, so it offers the same button.
 *
 * The mode is not silently inert while the grant is outstanding — that state is
 * named on screen and carries this button as its remedy.
 */
export async function requestAllSites(): Promise<boolean> {
  try {
    return await browser.permissions.request({ origins: [ALL_URLS] });
  } catch {
    return false;
  }
}

/**
 * The one permission the agent bridge needs, and the only optional
 * *permission* (as opposed to optional host permission) this extension
 * declares. Named once here so the popup, the adapter and the tests cannot
 * spell it three ways.
 */
export const NATIVE_MESSAGING = 'nativeMessaging';

/**
 * Whether the bridge permission is already held.
 *
 * `{permissions: [...]}`, never `{origins: [...]}` — this is not a host, and
 * `contains()` answers a nonsense origin with a calm `false` rather than an
 * error, so the wrong shape would read as "the user declined" forever.
 *
 * Throws are reported as not-granted for the same reason `covers()` does it:
 * a throw is not an answer, and this product's rule is that a state it cannot
 * establish is shown as the one that offers a remedy.
 */
export async function probeNativeMessaging(): Promise<boolean> {
  try {
    return await browser.permissions.contains({ permissions: [NATIVE_MESSAGING] });
  } catch {
    return false;
  }
}

/**
 * Asks for the bridge permission. Must be called from a user gesture — the
 * popup's Enable button click is that gesture, and it is the only caller.
 *
 * Nothing else rides along in the request. The consent dialog Chrome draws is
 * the user's only view of what is being asked for, so bundling a host pattern
 * into the same call would put a grant they did not read behind a button
 * labelled Enable.
 */
export async function requestNativeMessaging(): Promise<boolean> {
  try {
    return await browser.permissions.request({ permissions: [NATIVE_MESSAGING] });
  } catch {
    return false;
  }
}

/**
 * Gives the bridge permission back. This is what "turning it off is physical"
 * means: without the permission the port cannot open, Chrome kills the host,
 * and the socket file disappears — there is no flag left that could claim the
 * bridge is alive.
 *
 * A failure is reported as `false` rather than swallowed. Reporting success
 * here would leave the popup saying the bridge is off while it is still
 * reachable, which is the exact direction of under-reporting this product
 * exists to rule out.
 */
export async function removeNativeMessaging(): Promise<boolean> {
  try {
    return await browser.permissions.remove({ permissions: [NATIVE_MESSAGING] });
  } catch {
    return false;
  }
}
