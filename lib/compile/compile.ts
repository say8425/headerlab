import { compileHeaders } from '@/lib/compile/headers';
import { filterToCondition } from '@/lib/compile/conditions';
import { allocate } from '@/lib/compile/priority';
import { isValidDomain, originsForFilter } from '@/lib/permissions/origins';
import type { AppState, CompileResult, Diagnostic, DnrRule } from '@/lib/model/types';

/**
 * Turns application state into declarativeNetRequest rules.
 *
 * Pure: imports nothing from chrome.*, performs no I/O, does not mutate its
 * input. One enabled profile compiles to exactly one rule — action.requestHeaders
 * and action.responseHeaders are arrays, so a profile's whole header set shares
 * a single rule and the 5,000 unsafe-dynamic-rule ceiling never binds.
 */
export function compile(state: AppState): CompileResult {
  const dynamic: DnrRule[] = [];
  const session: DnrRule[] = [];
  const diagnostics: Diagnostic[] = [];
  const origins = new Set<string>();

  const byId = new Map(state.profiles.map((p) => [p.id, p]));

  for (const profile of state.profiles) {
    if (!profile.enabled) continue;
    for (const origin of originsForFilter(profile.filter)) origins.add(origin);
  }

  // globalPause suppresses rules but not analysis: the user must still be able
  // to see problems with their configuration while paused.
  if (!state.globalPause) {
    for (const alloc of allocate(state.profiles)) {
      const profile = byId.get(alloc.profileId);
      if (!profile) continue;

      const action = compileHeaders(profile.headers);
      if (!action.requestHeaders && !action.responseHeaders) continue;

      // A non-ASCII domain makes Chrome reject the whole updateDynamicRules
      // batch, same as an unusable header name (see headers.ts) — but unlike
      // headers, a domain cannot be dropped individually: filterToCondition
      // only sets requestDomains when the list is non-empty, so skipping the
      // profile's only domain would produce a rule with *no* domain
      // condition, and DNR matches that against every site. A profile scoped
      // to one host would silently start modifying headers everywhere — a
      // privacy regression strictly worse than the transactional failure it
      // would "fix". Failing the whole profile closed is the only safe
      // option; other profiles are unaffected.
      if (!profile.filter.domains.every(isValidDomain)) continue;

      const rule: DnrRule = {
        id: alloc.ruleId,
        priority: alloc.priority,
        condition: filterToCondition(
          profile.filter,
          alloc.scope === 'session' ? profile.tabLock.tabId : undefined,
        ),
        action: { type: 'modifyHeaders', ...action },
      };

      (alloc.scope === 'session' ? session : dynamic).push(rule);
    }
  }

  return { dynamic, session, diagnostics, requiredOrigins: [...origins] };
}
