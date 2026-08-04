import { useEffect, useMemo, useRef, useState } from 'react';
import { TopBar } from '@/components/TopBar';
import { ProfileBar } from '@/components/ProfileBar';
import { ProfileEditStrip } from '@/components/ProfileEditStrip';
import { FilterBlock } from '@/components/FilterBlock';
import { DiagnosticBand } from '@/components/DiagnosticBand';
import { HeaderGrid } from '@/components/HeaderGrid';
import { StatusFoot } from '@/components/StatusFoot';
import { compile } from '@/lib/compile/compile';
import { routeDiagnostics, groupCounts, groupRows } from '@/lib/view/grid';
import { domainsToAudit, auditDiagnostics } from '@/lib/permissions/audit';
import { probeGrants, requestHost } from '@/lib/permissions/probe';
import { getSyncStatus } from '@/lib/storage/session';
import { createProfile } from '@/lib/model/defaults';
import { useAppState } from '@/lib/storage/useAppState';
import type { Diagnostic, Filter, HeaderRule, HeaderTarget, Profile } from '@/lib/model/types';

export default function App() {
  const { state, patch } = useAppState();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [editingProfile, setEditingProfile] = useState(false);
  const [grantDiagnostics, setGrantDiagnostics] = useState<Diagnostic[]>([]);
  const [lastError, setLastError] = useState<string | null>(null);

  // onGrant (below) awaits a user-gesture-gated permission prompt, which is
  // not instantaneous — long enough for `state` to change underneath it (a
  // reconcile() write, or the second writer useAppState.ts documents) or for
  // the popup itself to close. A plain closure over `state` would resume with
  // whatever was current when the button was clicked, not when the prompt
  // was answered; `stateRef` is updated every render so the handler can read
  // the value that is current by the time it actually needs it. `mountedRef`
  // is the matching guard for the other half of that gap: if the popup
  // closes mid-prompt, the handler must not call setGrantDiagnostics on a
  // component that no longer exists.
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

  if (!state || !compiled) return <div className="hl-loading">Loading…</div>;

  const profiles = state.profiles;
  const active =
    profiles.find((p) => p.id === activeId) ?? profiles[0];

  const allDiagnostics = [...compiled.diagnostics, ...grantDiagnostics];

  const patchProfile = (id: string, delta: Partial<Profile>) =>
    patch((s) => ({ profiles: s.profiles.map((p) => (p.id === id ? { ...p, ...delta } : p)) }));

  const patchRow = (profileId: string, ruleId: string, delta: Partial<HeaderRule>) =>
    patch((s) => ({
      profiles: s.profiles.map((p) =>
        p.id === profileId
          ? { ...p, headers: p.headers.map((h) => (h.id === ruleId ? { ...h, ...delta } : h)) }
          : p,
      ),
    }));

  if (!active) {
    return (
      <>
        <TopBar paused={state.globalPause} onTogglePause={(paused) => patch(() => ({ globalPause: paused }))} />
        <div className="hl-empty">
          <button onClick={() => patch((s) => ({ profiles: [createProfile('Local', s.profiles.length)] }))}>
            Create profile
          </button>
        </div>
      </>
    );
  }

  const routed = routeDiagnostics(allDiagnostics.filter((d) => d.profileId === active.id));
  const groups = groupRows(active);
  const req = groupCounts(groups.request, routed.byRow);
  const res = groupCounts(groups.response, routed.byRow);
  const needsAccess = allDiagnostics.filter((d) => d.kind === 'permission-missing').length;

  return (
    <>
      <TopBar
        paused={state.globalPause}
        onTogglePause={(paused) => patch(() => ({ globalPause: paused }))}
      />
      <ProfileBar
        profiles={profiles}
        activeId={active.id}
        diagnostics={allDiagnostics}
        ruleCount={active.headers.length}
        onSelect={(id) => { setActiveId(id); setEditingProfile(false); }}
        onReselect={() => setEditingProfile((open) => !open)}
        onAdd={() => patch((s) => ({ profiles: [...s.profiles, createProfile('New', s.profiles.length)] }))}
      />
      {editingProfile && (
        // Keyed by profile id (prefixed — this and FilterBlock below are
        // siblings under the same returned fragment, and an unprefixed
        // `active.id` would give two siblings the identical key, which React
        // only requires to be unique *among siblings*; that collision was
        // caught by mutation-testing this fix and corrupted the DOM instead
        // of remounting cleanly). Without this key, switching the active
        // profile while the strip is open reuses this instance and its
        // armed-delete flag survives onto the new profile (phase 2b handoff,
        // composition risk (a)). The key forces a remount instead of a prop
        // update.
        <ProfileEditStrip
          key={`edit-${active.id}`}
          profile={active}
          onPatch={(delta) => patchProfile(active.id, delta)}
          onDelete={() => {
            patch((s) => ({ profiles: s.profiles.filter((p) => p.id !== active.id) }));
            setEditingProfile(false);
            setActiveId(null);
          }}
          onClose={() => setEditingProfile(false)}
        />
      )}
      <FilterBlock
        // Keyed by profile id (prefixed — see ProfileEditStrip above for why
        // a bare `active.id` collides with its sibling key). FilterBlock's
        // `draft`/`lastSent` are seeded once from `filter` and only re-derive
        // when its *contents* change, not its identity. Without this key,
        // switching profiles leaves the previous profile's domain text on
        // screen, and committing from there would write it onto the new
        // profile's filter — data loss, not just a cosmetic leak (phase 2b
        // handoff, composition risk (b)).
        key={`filter-${active.id}`}
        filter={active.filter}
        onPatch={(delta: Partial<Filter>) =>
          patchProfile(active.id, { filter: { ...active.filter, ...delta } })
        }
      />
      <DiagnosticBand
        diagnostics={routed.profileLevel}
        onGrant={async (host) => {
          await requestHost(host);
          // Re-read state now rather than trust the `state` closed over when
          // this callback was created — see stateRef's comment above. Both
          // domainsToAudit and auditDiagnostics run against the same
          // snapshot so the domains probed and the diagnostics built from
          // the grants stay consistent with each other.
          const current = stateRef.current;
          if (!current) return;
          const grants = await probeGrants(domainsToAudit(current.profiles));
          if (mountedRef.current) {
            setGrantDiagnostics(auditDiagnostics(current.profiles, grants));
          }
        }}
      />
      <HeaderGrid
        profile={active}
        byRow={routed.byRow}
        onToggleRow={(ruleId, enabled) => patchRow(active.id, ruleId, { enabled })}
        onPatchRow={(ruleId, delta) => patchRow(active.id, ruleId, delta)}
        onDeleteRow={(ruleId) =>
          patchProfile(active.id, { headers: active.headers.filter((h) => h.id !== ruleId) })
        }
        onAddRow={(target: HeaderTarget) =>
          patchProfile(active.id, {
            headers: [
              ...active.headers,
              {
                id: crypto.randomUUID(),
                enabled: true,
                target,
                operation: 'set',
                name: '',
                value: '',
              },
            ],
          })
        }
      />
      <StatusFoot
        applying={req.applying + res.applying}
        total={req.total + res.total}
        off={req.off + res.off}
        needsAccess={needsAccess}
        lastError={lastError}
      />
    </>
  );
}
