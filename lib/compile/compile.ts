import { compileHeaders } from '@/lib/compile/headers';
import { filterToCondition } from '@/lib/compile/conditions';
import { detectConflicts } from '@/lib/compile/conflicts';
import { validateFilter } from '@/lib/compile/filterDiagnostics';
import { allocate } from '@/lib/compile/priority';
import { isSuppressed } from '@/lib/compile/suppression';
import { hasRowError, validateHeaders } from '@/lib/compile/validate';
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

  // Grouped once by the id every header-row diagnostic carries, and reused
  // for every profile/allocation below — the one place this repo asks "does
  // this row have an error" (lib/compile/validate.ts's hasRowError).
  const byRow = new Map<string, Diagnostic[]>();
  for (const d of diagnostics) {
    if (d.headerRuleId === undefined) continue;
    const existing = byRow.get(d.headerRuleId);
    if (existing) existing.push(d);
    else byRow.set(d.headerRuleId, [d]);
  }

  // globalPause suppresses rules but not analysis: the user must still be able
  // to see problems with their configuration while paused.
  if (!state.globalPause) {
    for (const alloc of allocate(state.profiles)) {
      const profile = byId.get(alloc.profileId);
      if (!profile) continue;

      // A row diagnosed error must never reach compileHeaders — see
      // hasRowError's own comment for why. Fail-open is asymmetric here
      // (CLAUDE.md): headers skip per row, domains suppress the whole
      // profile (isSuppressed, below, is the second half).
      const compilable = profile.headers.filter((rule) => !hasRowError(byRow.get(rule.id)));
      const action = compileHeaders(compilable);
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
