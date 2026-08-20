import { useEffect, useMemo, useRef, useState } from 'react';
import { ScopeRail, type ScopeRailProps } from '@/components/ScopeRail';
import { RulePanel } from '@/components/RulePanel';
import { compile } from '@/lib/compile/compile';
import { isSuppressed } from '@/lib/compile/suppression';
import { routeDiagnostics, ruleTally } from '@/lib/view/rules';
import { resolveSingleProfile } from '@/lib/view/singleProfile';
import { domainsToAudit, auditDiagnostics } from '@/lib/permissions/audit';
import { effectiveDomain, scopingHosts } from '@/lib/permissions/origins';
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
import type { HeaderRule, Profile, ResourceType } from '@/lib/model/types';

export default function App() {
  const { state, valid, patch } = useAppState();

  /**
   * Every per-host grant answer this popup has actually established.
   *
   * A cache with one job: telling "probed, and not granted" apart from "never
   * probed". Both look identical in `grantDiagnostics` — neither produces a
   * diagnostic for a granted host — and conflating them is what let an
   * unprobed row claim access.
   *
   * State rather than a ref, and that is the whole of the fix: the
   * diagnostics are derived from this map during render, so recording an
   * answer has to re-render or the row keeps the reading taken before the
   * probe returned. It was a ref while an effect wrote the diagnostics into
   * state of their own — and an effect runs after the paint that triggered
   * it, which is the frame a newly added site rendered as granted in.
   */
  const [knownGrants, setKnownGrants] = useState<ReadonlyMap<string, boolean>>(() => new Map());
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
  /**
   * Why the last permission request failed, or null.
   *
   * Kept in the component rather than in the session record `bridgeStatus`
   * because it is not a fact about the bridge — it is a fact about a click
   * this popup just made. Storing it would outlive the interaction that
   * caused it and reappear, unexplained, the next time the popup opened.
   */
  const [bridgeRequestError, setBridgeRequestError] =
    useState<ScopeRailProps['bridgeRequestError']>(null);
  /**
   * The last thing this popup needs to say out loud, or null.
   *
   * This is the announcement channel the rail renders (`role="status"`), and
   * it exists because the interactions that most needed it had no other way
   * to report their outcome: a Grant button that unmounts on success takes
   * the focus to `<body>` with it, and a declined prompt leaves the screen
   * byte-identical to before the click — either way a screen reader has no
   * event to read and a keyboard user has no idea the click landed.
   *
   * Kept here rather than derived below for the same reason
   * `bridgeRequestError` is: it is a fact about a click this popup just made,
   * not about the state, and it should not outlive the interaction that
   * caused it into the next session's first render.
   */
  const [announcement, setAnnouncement] = useState<{ text: string; nonce: number } | null>(null);
  /**
   * Say something in the status region, even when it is the same something.
   *
   * A `role="status"` region is only read when its content *changes*, and the
   * two outcomes worth announcing are both fixed strings. Decline the
   * permission prompt twice and the second `setState` stored an identical
   * value, React bailed out, the DOM text never moved and a screen reader
   * said nothing — about the very interaction this channel exists to report.
   * The nonce makes each announcement a distinct value; the rail renders only
   * `text`, so nothing about the wording changes.
   */
  const announce = (text: string) =>
    setAnnouncement((prev) => ({ text, nonce: (prev?.nonce ?? 0) + 1 }));

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
    const hosts = domainsToAudit(state.profiles);

    // **Answer from what has been established, and read silence as "no".**
    // `grantDiagnostics` starts empty and only fills once the probe resolves,
    // and `SiteRow` reads "no diagnostic" as `granted` — so a host nothing had
    // asked about yet rendered green and said "Access granted" for a frame or
    // more. Adding a site made it visible: type one and the row was briefly
    // green before flipping to Grant. That is the same defect as the
    // suppressed-sibling one, arriving through a different door — the absence
    // of an answer reported as a positive answer.
    //
    // So a host whose answer is not yet known is treated as ungranted, which
    // puts the Grant button up immediately. The direction matters: offering a
    // remedy that turns out to be unnecessary costs a moment of a button;
    // claiming an access that was never checked is the trust posture inverted.
    //
    // `knownGrants` is what keeps that from becoming a flicker of its own.
    // This popup writes state on every keystroke, so this effect re-runs
    // constantly; without a memory, every keystroke would reset every row to
    // "unknown" and strobe the Grant buttons of hosts already probed. Answers
    // accumulate, so only a genuinely new host is ever unknown. A fresh mount
    // knows nothing and briefly shows Grant on granted rows — the one case
    // this trade does not fix, and the safe side of it.
    (async () => {
      const grants = await probeGrants(hosts);
      if (cancelled) return;
      setKnownGrants((prev) => {
        const next = new Map(prev);
        for (const grant of grants) next.set(grant.domain, grant.granted);
        return next;
      });
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

  // Derived here, in render, rather than written into state by the effect
  // above — and that is the whole fix rather than a tidying. An effect runs
  // *after* the paint that triggered it, so the frame in which a newly added
  // host first appears is a frame the effect has not reached yet: the row
  // rendered with no diagnostic and `SiteRow` reads no diagnostic as
  // `granted`. Measured by sampling every animation frame while typing a site
  // in: 'granted|Access granted' was observed before 'pending|GRANT'.
  // Deriving from `knownGrants` removes the window instead of narrowing it —
  // there is no frame in which the answer has not been consulted, because
  // consulting it is what produces the row.
  const grantDiagnostics = auditDiagnostics(
    state.profiles,
    domainsToAudit(state.profiles).map((domain) => ({
      domain,
      granted: knownGrants.get(domain) ?? false,
    })),
  );
  const allDiagnostics = [...compiled.diagnostics, ...grantDiagnostics];
  const routed = routeDiagnostics(allDiagnostics.filter((d) => d.profileId === active.id));

  // The three judgements that stop compile() emitting anything for this rule
  // set (compile.ts:28, :40, :51), none of which is rule-level and so none
  // of which reaches `byRow`. `isSuppressed` is called, never restated
  // (lib/compile/suppression.ts).
  const live = active.enabled && !state.globalPause && !isSuppressed(active);

  // The fourth judgement, handed to the tally in the same caller-answers
  // shape: whether the hosts that scope this rule set are granted. Counted
  // from the same `routed.byHost` the site rows render their Grant buttons
  // from, against the same `scopingHosts` the auditor probes (audit.ts) —
  // one definition of "what scopes this profile", so the hosts that hold
  // rules out of `live` here are exactly the rows wearing amber below.
  //
  // All-sites never reaches `byHost` at all (`scopingHosts` scopes nothing
  // in that mode), so its answer comes from the `<all_urls>` probe instead:
  // ungranted blocks everything the same way. `null` — probe not yet
  // answered — stays out of the verdict, on the rule `allSitesGranted`'s own
  // docblock states: never accuse the browser of withholding a permission
  // nobody has asked about.
  const ungrantedHosts = new Set(
    [...routed.byHost.values()]
      .flatMap((ds) => ds.filter((d) => d.kind === 'permission-missing'))
      .map((d) => d.host!),
  );
  const access: 'all' | 'some' | 'none' = active.filter.allSites
    ? allSitesGranted === false
      ? 'none'
      : 'all'
    : ungrantedHosts.size === 0
      ? 'all'
      : // Deduped on BOTH sides. `ungrantedHosts` is a Set and `auditDiagnostics`
        // emits one diagnostic per unique host, but `scopingHosts` maps the
        // stored list straight through — so two entries that normalize to one
        // host (`example.com` and `*.example.com`) made the denominator 2
        // against a numerator of 1, and `none` became unreachable: the readout
        // called every rule live while nothing could match. Commit-time
        // normalization dedupes what the popup and the CLI write, but not what
        // `state set` writes or what older stores already hold.
        ungrantedHosts.size >= new Set(scopingHosts(active.filter)).size
        ? 'none'
        : 'some';
  const tally = ruleTally(active.headers, active.id, routed.byRow, { live, access });

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
        paused={state.globalPause}
        announcement={announcement}
        onTogglePause={(paused) => patch(() => ({ globalPause: paused }))}
        domains={active.filter.domains}
        byHost={routed.byHost}
        lastError={status.lastError}
        iconError={status.iconError}
        bridge={bridgeMode}
        bridgeRequestError={bridgeRequestError}
        bridgeLastCommandAt={bridgeStatus.lastCommandAt}
        bridgeError={bridgeStatus.lastError}
        onEnableBridge={async () => {
          // Switching it on is the user gesture `permissions.request()`
          // requires. Nothing here opens the port: the background worker's
          // `permissions.onAdded` listener does, and the record it writes is
          // what this component is already watching. One path in, one path out.
          const result = await requestNativeMessaging();
          if (!mountedRef.current) return;
          // A decline is authoritative; a throw is not. `requestNativeMessaging`
          // reports both as `ok: false`, and writing that straight through would
          // let a request that failed for any other reason claim the permission
          // is not held — the popup then reads off over a bridge a CLI can still
          // reach, which is the one direction of under-reporting this product
          // exists to rule out. `onDisableBridge` below re-probes for the same
          // reason; this is the matching half.
          const allowed =
            result.ok || result.reason === 'declined' ? result.ok : await probeNativeMessaging();
          if (!mountedRef.current) return;
          setBridgeAllowed(allowed);
          // Mapped field by field rather than passed through, so the rail
          // keeps its own vocabulary and does not silently inherit whatever
          // the adapter's result grows next.
          setBridgeRequestError(
            result.ok
              ? null
              : result.reason === 'declined'
                ? { reason: 'declined' }
                : { reason: 'error', message: result.message },
          );
        }}
        onDisableBridge={async () => {
          // Turning it off answers whatever the last failed request was
          // saying, so the mark goes with it rather than outliving its
          // subject.
          setBridgeRequestError(null);
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
          if (mountedRef.current) {
            setAllSitesGranted(granted);
            announce(granted ? 'All sites — access granted' : 'The permission was not granted');
          }
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
        onToggleType={(type: ResourceType) => {
          // The refusal half of the guard below, read here so the user can be
          // told. Refused is the honest word: the checkbox does not move,
          // nothing else changes, and before this the click said nothing at
          // all — the one interaction in the rail that failed in total
          // silence. Read off `active` for the telling and re-checked against
          // the draft below for the writing, the same two-reads bargain
          // `onAddDomain` makes: neither may be the only one.
          const has = active.filter.resourceTypes.includes(type);
          if (has && active.filter.resourceTypes.length === 1) {
            announce('The last request type cannot be removed');
            return;
          }
          patchProfile((p) => {
            const has = p.filter.resourceTypes.includes(type);
            // DNR rejects an empty resourceTypes array, and its default
            // silently excludes main_frame — so the last one cannot come off.
            if (has && p.filter.resourceTypes.length === 1) return p;
            const next = has
              ? p.filter.resourceTypes.filter((t) => t !== type)
              : [...p.filter.resourceTypes, type];
            return { ...p, filter: { ...p.filter, resourceTypes: next } };
          });
        }}
        onGrant={async (host) => {
          // The boolean is the dialog's own answer, and it is the difference
          // between the two outcomes this handler used to render
          // identically: granted cleared the diagnostic, declined left it,
          // and nothing on screen said which had happened. It still reaches
          // the status region below; the re-probe that follows remains the
          // ground truth for what the rows show.
          const granted = await requestHost(host);
          // Re-read state now rather than trust the `state` closed over when
          // this callback was created — see stateRef's comment above. Both
          // domainsToAudit and auditDiagnostics run against the same snapshot,
          // so the domains probed and the diagnostics built from the grants
          // stay consistent with each other.
          const current = stateRef.current;
          if (!current) return granted;
          const grants = await probeGrants(domainsToAudit(current.profiles));
          if (mountedRef.current) {
            // Into the same record the render above reads, so the host just
            // granted is known rather than defaulting to ungranted.
            setKnownGrants((prev) => {
              const next = new Map(prev);
              for (const grant of grants) next.set(grant.domain, grant.granted);
              return next;
            });
            announce(granted ? `${host} — access granted` : 'The permission was not granted');
          }
          // Handed back so the row can unlatch its focus move when the prompt
          // was declined — see `SiteRow`'s `grantPressed`.
          return granted;
        }}
      />
      <RulePanel
        rules={active.headers}
        profileId={active.id}
        byRow={routed.byRow}
        tally={tally}
        sitesNeedingAccess={ungrantedHosts.size}
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
