import { useEffect, useMemo, useRef, useState } from 'react';
import { ScopeRail } from '@/components/ScopeRail';
import { RulePanel } from '@/components/RulePanel';
import { compile } from '@/lib/compile/compile';
import { isSuppressed } from '@/lib/compile/suppression';
import { routeDiagnostics, ruleTally } from '@/lib/view/rules';
import { resolveSingleProfile } from '@/lib/view/singleProfile';
import { domainsToAudit, auditDiagnostics } from '@/lib/permissions/audit';
import { probeGrants, requestHost } from '@/lib/permissions/probe';
import { getSyncStatus } from '@/lib/storage/session';
import { createProfile } from '@/lib/model/defaults';
import { useAppState } from '@/lib/storage/useAppState';
import type { Diagnostic, HeaderRule, Profile, ResourceType } from '@/lib/model/types';

function newRule(): HeaderRule {
  return {
    id: crypto.randomUUID(),
    enabled: true,
    target: 'request',
    operation: 'set',
    name: '',
    value: '',
  };
}

/**
 * The implicit rule set, minted the first time the popup opens on empty
 * storage.
 *
 * `lib/model/defaults.ts` ships `profiles: []`, and a fresh install used to
 * open on a single "Create profile" button — a wall between the user and the
 * one thing this extension does. It starts with a rule already in it, because
 * the state worth opening on is one where a header name can be typed
 * immediately.
 *
 * Made **lazily, here**, rather than as a module constant. A constant would
 * have to call `crypto.randomUUID()` at import time, which mints an id on
 * every page that loads this module whether or not one is ever needed, and
 * gives the background and the popup different ids for what is supposed to be
 * the same rule set.
 */
function bootstrapProfile(): Profile {
  return { ...createProfile('Default', 0), headers: [newRule()] };
}

export default function App() {
  const { state, patch } = useAppState();
  const [grantDiagnostics, setGrantDiagnostics] = useState<Diagnostic[]>([]);
  const [lastError, setLastError] = useState<string | null>(null);

  // onGrant (below) awaits a user-gesture-gated permission prompt, which is
  // not instantaneous — long enough for `state` to change underneath it (a
  // reconcile() write, or the second writer useAppState.ts documents) or for
  // the popup itself to close. A plain closure over `state` would resume with
  // whatever was current when the button was clicked, not when the prompt was
  // answered; `stateRef` is updated every render so the handler can read the
  // value that is current by the time it actually needs it. `mountedRef` is
  // the matching guard for the other half of that gap: if the popup closes
  // mid-prompt, the handler must not call setGrantDiagnostics on a component
  // that no longer exists.
  const stateRef = useRef(state);
  stateRef.current = state;
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // compile() is pure, so the popup runs the same function on the same state
  // the background does. Caching diagnostics in storage would mean keeping the
  // two in step; recomputing means they cannot disagree.
  const compiled = useMemo(() => (state ? compile(state) : null), [state]);

  const resolved = state ? resolveSingleProfile(state.profiles) : null;

  /**
   * Brings storage down to the one rule set this popup can show.
   *
   * Both halves are writes, and both have to be. An empty store needs the
   * implicit rule set to actually exist before anything typed into it can
   * survive the popup closing. And extra rule sets — legacy state from the
   * build that had profiles — cannot merely be hidden: compile() reads
   * storage, not this screen, so one left behind goes on modifying headers
   * with no way to see it, switch it off, or find out where the change came
   * from. Truncating is the only reading of "show one" that does not
   * reintroduce the exact silent failure this product exists to remove.
   */
  useEffect(() => {
    if (!resolved) return;
    if (!resolved.profile) {
      patch(() => ({ profiles: [bootstrapProfile()] }));
      return;
    }
    if (resolved.dropped.length === 0) return;
    const kept = resolved.profile;
    console.warn(
      `[HeaderLab] storage held ${resolved.dropped.length + 1} rule sets and this build shows one. ` +
      `Kept "${kept.name}" (${kept.id}); removed ` +
      `${resolved.dropped.map((p) => `"${p.name}" (${p.id})`).join(', ')} — ` +
      'they would otherwise have gone on modifying headers with nothing able to show them.',
    );
    patch(() => ({ profiles: [kept] }));
  }, [state]);

  useEffect(() => {
    if (!state) return;
    let cancelled = false;
    (async () => {
      const grants = await probeGrants(domainsToAudit(state.profiles));
      if (!cancelled) setGrantDiagnostics(auditDiagnostics(state.profiles, grants));
    })();
    return () => { cancelled = true; };
  }, [state]);

  useEffect(() => {
    getSyncStatus().then((s) => setLastError(s.lastError)).catch(() => setLastError(null));
  }, [state]);

  const active = resolved?.profile;
  if (!state || !compiled || !active) return <div className="hl-loading">Loading…</div>;

  /**
   * Every write goes through the patch draft rather than the `active` snapshot
   * this render closed over. `patchState` re-reads before writing, so deriving
   * the next value from `s` keeps a handler from resurrecting a value that
   * changed between render and click.
   */
  const patchRule = (ruleId: string, delta: Partial<HeaderRule>) =>
    patch((s) => ({
      profiles: s.profiles.map((p) =>
        p.id === active.id
          ? { ...p, headers: p.headers.map((h) => (h.id === ruleId ? { ...h, ...delta } : h)) }
          : p,
      ),
    }));

  const patchProfile = (map: (profile: Profile) => Profile) =>
    patch((s) => ({ profiles: s.profiles.map((p) => (p.id === active.id ? map(p) : p)) }));

  const allDiagnostics = [...compiled.diagnostics, ...grantDiagnostics];
  const routed = routeDiagnostics(allDiagnostics.filter((d) => d.profileId === active.id));

  // The three judgements that stop compile() emitting anything for this rule
  // set (compile.ts:28, :40, :51), none of which is rule-level and so none of
  // which reaches `byRow`. `isSuppressed` is called, never restated
  // (lib/compile/suppression.ts).
  const live = active.enabled && !state.globalPause && !isSuppressed(active);
  const tally = ruleTally(active.headers, routed.byRow, { live });

  // Take the caret only when there is nothing else on screen to look at: one
  // rule, and it has no name yet. Anything more and the popup would be
  // grabbing focus from someone who opened it to read rather than to edit.
  const only = active.headers.length === 1 ? active.headers[0] : undefined;
  const autoFocusFirstRule = only !== undefined && only.name === '';

  return (
    <div className="hl-pop">
      <ScopeRail
        tally={tally}
        paused={state.globalPause}
        onTogglePause={(paused) => patch(() => ({ globalPause: paused }))}
        domains={active.filter.domains}
        byHost={routed.byHost}
        notes={routed.scope}
        lastError={lastError}
        resourceTypes={active.filter.resourceTypes}
        onAddDomain={(domain) =>
          patchProfile((p) =>
            p.filter.domains.includes(domain)
              ? p
              : { ...p, filter: { ...p.filter, domains: [...p.filter.domains, domain] } },
          )
        }
        onRemoveDomain={(domain) =>
          patchProfile((p) => ({
            ...p,
            filter: { ...p.filter, domains: p.filter.domains.filter((d) => d !== domain) },
          }))
        }
        onToggleType={(type: ResourceType) =>
          patchProfile((p) => {
            const has = p.filter.resourceTypes.includes(type);
            // DNR rejects an empty resourceTypes array, and its default
            // silently excludes main_frame — so the last one cannot come off.
            if (has && p.filter.resourceTypes.length === 1) return p;
            const next = has
              ? p.filter.resourceTypes.filter((t) => t !== type)
              : [...p.filter.resourceTypes, type];
            return { ...p, filter: { ...p.filter, resourceTypes: next } };
          })
        }
        onGrant={async (host) => {
          await requestHost(host);
          // Re-read state now rather than trust the `state` closed over when
          // this callback was created — see stateRef's comment above. Both
          // domainsToAudit and auditDiagnostics run against the same snapshot,
          // so the domains probed and the diagnostics built from the grants
          // stay consistent with each other.
          const current = stateRef.current;
          if (!current) return;
          const grants = await probeGrants(domainsToAudit(current.profiles));
          if (mountedRef.current) {
            setGrantDiagnostics(auditDiagnostics(current.profiles, grants));
          }
        }}
      />
      <RulePanel
        rules={active.headers}
        byRow={routed.byRow}
        autoFocusFirstRule={autoFocusFirstRule}
        onPatchRule={patchRule}
        onDeleteRule={(ruleId) =>
          patchProfile((p) => ({ ...p, headers: p.headers.filter((h) => h.id !== ruleId) }))
        }
        onAddRule={() => patchProfile((p) => ({ ...p, headers: [...p.headers, newRule()] }))}
      />
    </div>
  );
}
