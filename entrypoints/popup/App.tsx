import { useEffect, useMemo, useRef, useState } from 'react';
import { ScopeRail } from '@/components/ScopeRail';
import { RulePanel } from '@/components/RulePanel';
import { compile } from '@/lib/compile/compile';
import { isSuppressed, suppressionReason } from '@/lib/compile/suppression';
import { routeDiagnostics, ruleTally } from '@/lib/view/rules';
import { resolveSingleProfile } from '@/lib/view/singleProfile';
import { domainsToAudit, auditDiagnostics } from '@/lib/permissions/audit';
import { effectiveDomain } from '@/lib/permissions/origins';
import {
  probeAllSites,
  probeGrants,
  probeNativeMessaging,
  removeNativeMessaging,
  requestAllSites,
  requestNativeMessaging,
  requestHost,
} from '@/lib/permissions/probe';
import { getSyncStatus } from '@/lib/storage/session';
import { bridgeStatusItem, DEFAULT_BRIDGE_STATUS, getBridgeStatus } from '@/lib/storage/session';
import type { BridgeStatus } from '@/lib/storage/session';
import { bootstrapProfile, newRule } from '@/lib/model/defaults';
import { useAppState } from '@/lib/storage/useAppState';
import type { Diagnostic, HeaderRule, Profile, ResourceType } from '@/lib/model/types';

export default function App() {
  const { state, valid, patch } = useAppState();
  const [grantDiagnostics, setGrantDiagnostics] = useState<Diagnostic[]>([]);
  // `null` until the probe answers. The switch must not show "needs
  // permission" for the instant before the browser has been asked — a badge
  // that appears and withdraws itself on every open is one people learn to
  // ignore, which costs more than the moment of blankness does.
  const [allSitesGranted, setAllSitesGranted] = useState<boolean | null>(null);
  const [status, setStatus] = useState<{ lastError: string | null; iconError: string | null }>({
    lastError: null,
    iconError: null,
  });
  const [bridgeStatus, setBridgeStatus] = useState<BridgeStatus>(DEFAULT_BRIDGE_STATUS);
  // `null` until the probe answers, for exactly the reason `allSitesGranted`
  // is: the row must not offer Enable before the browser has been asked.
  const [bridgeAllowed, setBridgeAllowed] = useState<boolean | null>(null);

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
    return () => {
      mountedRef.current = false;
    };
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
    // Never write onto a fallback. When the stored bytes fail validation
    // `getState` hands back DEFAULT_STATE, which is indistinguishable from a
    // fresh install — and minting a profile onto it made `patchState` re-read
    // that same fallback and write it over somebody's real rules. Opening the
    // popup was enough to lose them, with no user action and nothing on
    // screen.
    //
    // The truncation below does not have this problem and its reasoning does
    // not extend here: rule sets the UI cannot show must not go on modifying
    // headers invisibly, but a store that fails validation is never compiled,
    // so nothing is being applied and there is nothing to neutralise. That
    // write is earned; this one was not.
    if (!valid) return;
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
    // Derived from the patch draft like every other write in this file, rather
    // than from the `kept` this render closed over — the window is small, but
    // this was the one write that opted out of the rule the rest of the file
    // follows.
    patch((s) => ({ profiles: s.profiles.slice(0, 1) }));
    // `resolved` is derived from `state` on every render, so listing it would
    // add a dependency that changes identity each time and re-run a *writing*
    // effect on its own output. `patch` is likewise re-created per render.
    // `[state, valid]` names the two values this effect actually reacts to, and
    // every write inside it is derived from the patch draft rather than from
    // what this render closed over — which is what makes the narrower list safe
    // rather than merely quieter.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [state, valid]);

  useEffect(() => {
    if (!state) return;
    let cancelled = false;
    (async () => {
      const grants = await probeGrants(domainsToAudit(state.profiles));
      if (!cancelled) setGrantDiagnostics(auditDiagnostics(state.profiles, grants));
    })();
    return () => {
      cancelled = true;
    };
  }, [state]);

  /**
   * `<all_urls>`, probed on its own.
   *
   * It cannot ride `probeGrants`: that walks a six-rung ladder of match
   * patterns built from a host, and `<all_urls>` is not a host — there is no
   * narrower grant that could satisfy it and no broader one to fall back to.
   *
   * Probed even when the mode is off, and deliberately. Nothing renders from
   * the answer while the switch is off, but the instant it goes on the rail has
   * to state the access correctly — and `null` renders as silence, on the rule
   * that the popup must not accuse the browser of withholding a permission
   * nobody has asked about. Probing only once the mode was on would make every
   * toggle-on pass through that silence before landing on the truth, which is
   * the flicker this state was written to avoid. Holding the previous answer
   * means the switch and the dot change together. One `permissions.contains()`
   * call against a value the browser already holds.
   */
  useEffect(() => {
    let cancelled = false;
    probeAllSites()
      .then((granted) => {
        if (!cancelled) setAllSitesGranted(granted);
      })
      .catch(() => {
        if (!cancelled) setAllSitesGranted(false);
      });
    return () => {
      cancelled = true;
    };
  }, [state]);

  useEffect(() => {
    getSyncStatus()
      .then((s) => setStatus({ lastError: s.lastError, iconError: s.iconError }))
      .catch(() => setStatus({ lastError: null, iconError: null }));
  }, [state]);

  /**
   * Watched rather than polled. The background worker writes this record when
   * the port opens, when it drops, and when a command is applied — three
   * events the popup has no other way to learn about, and a popup that read
   * once on mount would show a bridge as idle for as long as it stayed open.
   *
   * `[]` and not `[state]`: this subscription is about the port, not the rule
   * set, and re-subscribing on every keystroke would tear down and rebuild the
   * listener for nothing.
   */
  useEffect(() => {
    let cancelled = false;
    getBridgeStatus()
      .then((s) => {
        if (!cancelled) setBridgeStatus(s);
      })
      .catch(() => {});
    const unwatch = bridgeStatusItem.watch((value) => {
      setBridgeStatus(value ?? DEFAULT_BRIDGE_STATUS);
    });
    return () => {
      cancelled = true;
      unwatch();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    probeNativeMessaging()
      .then((allowed) => {
        if (!cancelled) setBridgeAllowed(allowed);
      })
      .catch(() => {
        if (!cancelled) setBridgeAllowed(false);
      });
    return () => {
      cancelled = true;
    };
  }, [state]);

  // Said on screen, not only to a console nobody is watching. `state.ts` claims
  // its error exists "so a corrupted store is diagnosable, not just quietly
  // reset" — a devtools line in a popup that closes the moment you look away
  // does not make that true. No remedy is offered because there honestly is
  // none yet: there is no import/export, and a "start fresh" button here would
  // be the same destructive write the guard above just removed, one click
  // further away.
  if (state !== null && !valid) {
    return (
      // Deliberately not the normal two-column shell: there is no scope and
      // there are no rules to show, and dressing the failure up as the working
      // screen is how it gets missed.
      <div
        className="flex h-full flex-col justify-center gap-2 bg-rail px-10 text-foreground"
        data-testid="unreadable-store"
      >
        <b className="text-[13px] leading-[1.4] font-bold text-destructive">
          Saved rules could not be read
        </b>
        <p className="max-w-[420px] text-[12px] leading-[1.55] text-foreground-2">
          The stored settings do not match the format this version expects, so no rule is being
          applied.
        </p>
        <p className="max-w-[420px] text-[12px] leading-[1.55] text-foreground-2">
          Nothing has been changed or overwritten — your data is still on disk.
        </p>
      </div>
    );
  }

  const active = resolved?.profile;
  if (!state || !compiled || !active)
    return (
      <div className="grid h-full place-items-center text-[12px] leading-none text-foreground-2">
        Loading…
      </div>
    );

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
  const tally = ruleTally(active.headers, active.id, routed.byRow, { live });

  // Why the rules are held, when it is not the rules' own fault. A count
  // reading "1 blocked" beside a perfectly good rule points the user at the
  // wrong object; suppression is caused by the scope, and a pause by the
  // switch above. Suppression is asked first because it outranks the pause:
  // fixing the pause would still leave nothing applied.
  //
  // Which *kind* of suppression comes from `suppressionReason`, never from
  // re-reading the filter here — the popup restating the compiler's decision
  // is how the aliveness predicate diverged four ways before
  // (lib/compile/suppression.ts). The two read very differently and must not
  // be swapped: "by an unusable site" sends the reader hunting for a broken
  // entry, which in the empty case does not exist.
  const REASON_BLAME = { 'unusable-site': 'sites', 'no-scope': 'scope' } as const;
  const reason = suppressionReason(active);
  const blockedBy = reason !== null ? REASON_BLAME[reason] : state.globalPause ? 'pause' : null;

  // The permission decides `off`; the port decides the other two. Kept in this
  // order because a held permission with no port is the state that actually
  // needs a remedy on screen, and reading the port first would hide it behind
  // a bridge nobody enabled.
  const bridgeMode =
    bridgeAllowed === null
      ? 'unknown'
      : !bridgeAllowed
        ? 'off'
        : bridgeStatus.connected
          ? 'live'
          : 'idle';

  // Take the caret only when there is nothing else on screen to look at: one
  // rule, and it has no name yet. Anything more and the popup would be
  // grabbing focus from someone who opened it to read rather than to edit.
  const only = active.headers.length === 1 ? active.headers[0] : undefined;
  const autoFocusFirstRule = only !== undefined && only.name === '';

  return (
    // The rail is a fixed 224px column and the panel takes the rest — a flex
    // row rather than a grid, so the panel's `min-w-0` is what stops a long
    // header value widening the track instead of wrapping inside it.
    <div className="flex h-full" data-testid="popup-root">
      <ScopeRail
        tally={tally}
        paused={state.globalPause}
        onTogglePause={(paused) => patch(() => ({ globalPause: paused }))}
        domains={active.filter.domains}
        byHost={routed.byHost}
        notes={routed.scope}
        blockedBy={blockedBy}
        lastError={status.lastError}
        iconError={status.iconError}
        bridge={bridgeMode}
        bridgeLastCommandAt={bridgeStatus.lastCommandAt}
        bridgeError={bridgeStatus.lastError}
        onEnableBridge={async () => {
          // The click is the user gesture `permissions.request()` requires.
          // Nothing here opens the port: the background worker's
          // `permissions.onAdded` listener does, and the record it writes is
          // what this component is already watching. One path in, one path out.
          const granted = await requestNativeMessaging();
          if (mountedRef.current) setBridgeAllowed(granted);
        }}
        onDisableBridge={async () => {
          const removed = await removeNativeMessaging();
          // Re-probed rather than assumed. A removal that failed leaves the
          // bridge reachable, and saying otherwise would be the one direction
          // of under-reporting this product exists to rule out.
          if (mountedRef.current) setBridgeAllowed(removed ? false : await probeNativeMessaging());
        }}
        allSites={active.filter.allSites}
        allSitesGranted={allSitesGranted}
        onToggleAllSites={(next) => {
          // The switch sets the mode. It does not ask for anything, and this is
          // the whole of it.
          //
          // It used to call `requestAllSites()` here, on the argument that the
          // click was "the moment the cost is being chosen" — which fired
          // Chrome's prompt for `<all_urls>`, the largest grant this extension
          // can ask for, as a side effect of flipping a switch. Prompting
          // because a control moved, rather than because a button labelled
          // Grant was pressed, is the pattern that teaches people to distrust
          // extensions; it is also what the Grant button beside this switch was
          // already for.
          //
          // Adding a site does not prompt either — it produces a pending row
          // with a Grant button, and that button prompts. All-sites lands in
          // the same state, so it behaves the same way. A UI where the same
          // state reached by a different control acts differently is one you
          // memorise instead of read.
          //
          // Nothing is silently broken in between: the mode is on, the access
          // is shown as missing, and the remedy is on screen — the same state a
          // migrated store arrives in, so there is one state to recover from
          // rather than two.
          patchProfile((p) => ({ ...p, filter: { ...p.filter, allSites: next } }));
        }}
        onGrantAllSites={async () => {
          const granted = await requestAllSites();
          if (mountedRef.current) setAllSitesGranted(granted);
        }}
        resourceTypes={active.filter.resourceTypes}
        onAddDomain={(typed) => {
          // Normalized here, at the moment it is committed, so what is stored
          // is what the extension actually matches on and what the rail shows.
          // Storing the raw text and normalizing at every read is what put one
          // value on screen and a different one on the wire.
          //
          // Unusable input keeps its typed form: there is no host to store, and
          // the row has to be able to name what the user actually wrote.
          const host = effectiveDomain(typed);
          const clash = active.filter.domains.find((d) => effectiveDomain(d) === host);
          if (clash !== undefined) return { added: false, alreadyThere: host };
          patchProfile((p) =>
            // Re-checked against the draft rather than trusting the snapshot
            // above — the guard that decides what the user is told and the
            // guard that protects the list are allowed to be different reads,
            // but neither may be the only one.
            p.filter.domains.some((d) => effectiveDomain(d) === host)
              ? p
              : { ...p, filter: { ...p.filter, domains: [...p.filter.domains, host] } },
          );
          return { added: true };
        }}
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
        profileId={active.id}
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
