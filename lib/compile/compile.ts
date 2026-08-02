import { compileHeaders } from '@/lib/compile/headers';
import { filterToCondition } from '@/lib/compile/conditions';
import { detectConflicts } from '@/lib/compile/conflicts';
import { validateFilter } from '@/lib/compile/filterDiagnostics';
import { allocate } from '@/lib/compile/priority';
import { isSuppressed } from '@/lib/compile/suppression';
import { validateHeaders } from '@/lib/compile/validate';
import { originsForFilter } from '@/lib/permissions/origins';
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

    // Diagnosed regardless of globalPause — see below — but never for a
    // disabled profile: the user turning a profile off means they are not
    // thinking about it right now, so a complaint about it would be noise.
    diagnostics.push(...validateHeaders(profile), ...validateFilter(profile));
  }
  diagnostics.push(...detectConflicts(state.profiles));

  // globalPause suppresses rules but not analysis: the user must still be able
  // to see problems with their configuration while paused.
  if (!state.globalPause) {
    for (const alloc of allocate(state.profiles)) {
      const profile = byId.get(alloc.profileId);
      if (!profile) continue;

      const action = compileHeaders(profile.headers);
      if (!action.requestHeaders && !action.responseHeaders) continue;

      // Fail the whole profile closed rather than drop the bad domain — the
      // reasoning, and the three other modules that must agree with it, are in
      // lib/compile/suppression.ts.
      if (isSuppressed(profile)) continue;

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
