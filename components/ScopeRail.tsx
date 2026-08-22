import { ArrowUpDown, CircleHelp, Globe } from 'lucide-react';
import { AddSiteField, type AddSiteResult } from './AddSiteField';
import { GRANT_BUTTON_PROPS, SiteRow } from './SiteRow';
import { OFFERED_TYPES, TypeChecklist } from './TypeChecklist';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { analyzeDomain, effectiveDomain } from '@/lib/permissions/origins';
import type { Diagnostic, ResourceType } from '@/lib/model/types';

export interface ScopeRailProps {
  paused: boolean;
  /**
   * The last outcome worth announcing, or null while there is nothing to say,
   * with a nonce that makes each saying distinct.
   *
   * Rendered into the always-mounted `role="status"` span at the top of the
   * rail — see that span for why it must never be the one to appear.
   *
   * The nonce is not decoration. A live region is read when its content
   * *changes*, and both messages this channel carries are fixed strings — so
   * declining the permission prompt twice stored the same text, the DOM never
   * moved, and the second decline was announced to nobody. Keying the span on
   * the nonce remounts the text node, which is a change the region reports.
   */
  announcement: { text: string; nonce: number } | null;
  onTogglePause: (paused: boolean) => void;
  domains: readonly string[];
  /** Host-scoped diagnostics, keyed by the normalized host they name. */
  byHost: ReadonlyMap<string, Diagnostic[]>;
  /** Applying to every site by explicit choice. */
  allSites: boolean;
  /**
   * Whether `<all_urls>` is actually granted.
   *
   * `null` while the probe is still out — the switch must not accuse the
   * browser of withholding a permission nobody has asked about yet, and a
   * popup that opens showing "needs permission" for a tenth of a second and
   * then withdraws it is the flicker that teaches people to distrust the
   * badge.
   */
  allSitesGranted: boolean | null;
  onToggleAllSites: (allSites: boolean) => void;
  onGrantAllSites: () => void;
  /** The real text of the last failed reconcile, from session storage. */
  lastError: string | null;
  /**
   * Set when the rules registered but the toolbar icon did not follow.
   *
   * Its own note rather than folded into `lastError`: that one is headed
   * "Rules not registered", which is false here — the rules *are* registered
   * and it is the toolbar that is lying about it.
   */
  iconError: string | null;
  resourceTypes: readonly ResourceType[];
  onAddDomain: (domain: string) => AddSiteResult;
  onRemoveDomain: (domain: string) => void;
  onToggleType: (type: ResourceType) => void;
  onGrant: (host: string) => void | Promise<boolean | void>;
  /**
   * What the agent bridge is doing.
   *
   * `unknown` is not `off`. The permission probe has not answered yet, and a
   * row that offered Enable before the browser had been asked is the same
   * flicker `allSitesGranted: null` exists to prevent — so that state carries
   * no colour and no control, only the word.
   *
   * `idle` means the permission is held and no port is open. That is not the
   * design's original wording ("a CLI is not attached"), and the change is
   * deliberate: the extension cannot see the host's socket clients, and making
   * the host tell it would turn a relay into a protocol participant — the
   * thing packages/headerlab/lib/bridge.mjs argues against by name. What `idle`
   * actually points at is the state a user really lands in: Enable pressed,
   * `headerlab bridge install` never run.
   */
  bridge: 'unknown' | 'off' | 'idle' | 'live';
  /** ISO timestamp of the last command applied through the bridge, or null. */
  bridgeLastCommandAt: string | null;
  /** Chrome's own message from the last failed connect, or null. */
  bridgeError: string | null;
  /**
   * Why the last permission *request* did not result in a grant, or null if
   * none has failed since the row was last satisfied.
   *
   * Distinct from `bridgeError`, which is a failed *connect* — a request that
   * never produced a permission and a permission that produced no port are
   * different states with different remedies, and collapsing them is what
   * left this row silent. `declined` carries no message because there is
   * nothing to report beyond the answer itself.
   */
  bridgeRequestError: { reason: 'declined' } | { reason: 'error'; message: string } | null;
  onEnableBridge: () => void;
  onDisableBridge: () => void;
}

/** A rail section's heading: "Sites 2", "Request types 3 of 8". */
const HEAD_CLASS =
  'flex h-5 shrink-0 items-center gap-1.5 px-3 text-[11px] leading-[14px] font-semibold text-foreground-2';
/** The count beside a heading — the same word, one rank quieter. */
const HEAD_COUNT_CLASS = 'font-medium text-muted-foreground';
/**
 * A note parked against its cause: a neutral card with a coloured edge, never a
 * coloured block. Severity is carried by the edge, not by the mass — which is
 * the rule, and it outlived the case that produced it. The argument used to
 * run "a pending site is already carrying colour, so a stack of amber slabs
 * beside it would rebuild the wall of yellow this layout exists to remove";
 * that stack was the scope notes, and they are gone (2026-08-19). Both
 * remaining users are `border-l-destructive`, so no amber note exists to be
 * stacked. The rule stays because the next note added here should obey it,
 * not because anything is currently at risk of breaking it.
 *
 * `[overflow-wrap:anywhere]` outlived its stated reason the same way. It was
 * for hostnames, and the notes that named hosts are the ones that went — but
 * both survivors render a message this code did not write (`lastError` is
 * Chrome's own text, `iconError` likewise), and those can carry a long
 * unbroken token: a rejected regex, a header name, a URL. The guard moves onto
 * that rather than dying with its first subject.
 */
const NOTE_CLASS =
  'mx-3 shrink-0 rounded-md border border-rail-border border-l-[3px] bg-background px-2.5 py-2 text-[10.5px] leading-[1.45] text-foreground [overflow-wrap:anywhere]';
/**
 * The three switches in the rail are one control in three places — the same
 * palette, not the same size. The two inside the readout card (run state and
 * bridge) are `sm`, because that card's rows are 20px and a 14px control sits
 * inside one without crowding the label; the all-sites switch keeps the
 * default 18.4px, since it heads a 60px section rather than a readout line.
 */
const SWITCH_CLASS = 'data-checked:bg-live [&_[data-slot=switch-thumb]]:dark:bg-white';

/**
 * Text a screen reader must read that a sighted user must not see.
 *
 * Two hiding mechanisms were tried first and both are excluded by the e2e
 * layout guards, which have caught real defects and must not grow exception
 * lists for this:
 *
 * - Tailwind's `sr-only` (1px box, `overflow: hidden`, `nowrap`) hides by
 *   overflowing its own box — exactly what the clipping guard forbids of a
 *   text leaf (`scrollHeight > clientHeight`; that guard exists because the
 *   readout's big number once rendered 32px of glyphs in a 30px box).
 * - Moving the span off-canvas (`absolute`, `-left-[9999px]`) keeps its box
 *   honest but lets its shrink-to-fit width — a full sentence — exceed the
 *   parent, which the width guard reads as an element wider than what holds
 *   it.
 *
 * `clip-path` hides by painting nothing at all: the box keeps its parent's
 * width (`inset-x-0`, so the width guard sees it fit) and its content's
 * height (so nothing overflows to clip), the clip removes every pixel from
 * every mode — `forced-colors` cannot repaint what is never painted — and
 * screen readers read it because it is rendered content, which is the entire
 * point. `pointer-events-none` because an invisible box that can catch a
 * pointer is a ghost the user cannot dismiss.
 *
 * `inset-x-0` resolves against the nearest *positioned* ancestor, so each
 * mount point's parent carries `relative` — the span's width then matches
 * the parent the width guard compares it against.
 */
const VISUALLY_HIDDEN = 'pointer-events-none absolute inset-x-0 top-0 [clip-path:inset(50%)]';

/**
 * The row's name, in every state.
 *
 * It used to carry the state too ("Agent bridge live"), which put the state in
 * the one place a reader has no definition for, and left the two states that
 * shared a dot colour — `off` and `idle` — distinguishable only by that word.
 * Both halves of that fix survive: the name is still constant, so a reader
 * still learns what the row *is* from the words, and `idle` keeps the colour
 * it was given in the same breath. What changed is that the dot is no longer
 * the only eye-channel — {@link BRIDGE_STATE} puts the state word beside the
 * name rather than inside it, so `off` and `idle` are now separated by two
 * channels where they were once separated by one.
 */
const BRIDGE_NAME = 'Agent bridge';

/**
 * The state, in the two lengths this row has room for.
 *
 * `spoken` is what `bridge-detail` says and is unchanged from when it was the
 * only form; `shown` is what fits beside the name. They differ in one state,
 * and the split is this file's own precedent rather than a compromise:
 * `SiteRow` shows `Use a bare hostname` while saying `Unusable site. Use a
 * bare hostname like example.com.` — short on screen, whole in the ear.
 *
 * Why `down` for the unreachable state: the visible slot is 47.48px of text
 * (measured in the built popup, four saved sites, 748×600 light) and `cannot
 * be reached` is 105.64px in this font, so it cannot go there. The docblock
 * on the detail span below already argued `down` over `unreachable` for a
 * budget that no longer applies; the argument is live again here, against a
 * smaller box, and `down` measures 31.24px — 34% headroom, against the 15%
 * this rail accepted for `Use a bare hostname`. Re-derive that budget if the
 * label, the gap or the switch size moves: it is a leftover, not a property.
 */
const BRIDGE_STATE = {
  off: { shown: 'off', spoken: 'off' },
  idle: { shown: 'idle', spoken: 'idle' },
  live: { shown: 'live', spoken: 'live' },
  unreachable: { shown: 'down', spoken: 'cannot be reached' },
} as const;

/**
 * The whole of what this row can say beyond its name and its dot.
 *
 * Ordered by what the reader most recently caused: a request they just watched
 * fail outranks a connect error from before it, which outranks the steady-state
 * description. Returns null only for `unknown`, where the probe has not
 * answered and anything said would be a guess.
 */
function bridgeTitle(
  bridge: ScopeRailProps['bridge'],
  unreachable: boolean,
  bridgeError: string | null,
  requestError: ScopeRailProps['bridgeRequestError'],
  lastCommandAt: string | null,
): string | null {
  // A held permission outranks any record of a request that failed to obtain
  // one: the grant can arrive from outside this popup, and a live row
  // explaining that the bridge "cannot start" would be the screen contradicting
  // itself beside a green dot.
  if (requestError !== null && bridge === 'off') {
    return requestError.reason === 'declined'
      ? 'Chrome’s permission request was declined, so the bridge cannot start. Turn the ' +
          'switch on again to ask once more.'
      : `The permission could not be requested: ${requestError.message}`;
  }
  // The remedy leads and Chrome's string trails it: Chrome reports the
  // identical message for a missing manifest, a manifest naming a different
  // extension, and an interpreter it cannot start (measured), so translating
  // it into one of the three would be a guess presented as a diagnosis.
  if (unreachable) return `Run headerlab bridge install. ${bridgeError}`;
  if (bridge === 'unknown') return null;
  if (bridge === 'off') {
    return 'The agent bridge is off. Turn the switch on to grant Chrome’s nativeMessaging permission, which lets a CLI reach this extension.';
  }
  if (bridge === 'idle') {
    // Not worded as a failure: nothing has gone wrong, and the usual reason is
    // that the installer has not been run yet.
    return 'The permission is held, but nothing is connected. If you have not run headerlab bridge install yet, that is the usual reason.';
  }
  const live = 'The agent bridge is live — a CLI can reach this extension.';
  return lastCommandAt === null
    ? live
    : `${live} Last change through it: ${new Date(lastCommandAt).toLocaleString()}`;
}

/**
 * The left rail: where does this apply, and is it working.
 *
 * The popup is split by question. Everything here is scope and state — the
 * count, the master switch, the sites and their access, which request types
 * count, and any problem that belongs to the screen rather than to one rule.
 * The panel beside it is then free to be nothing but rules, which is the point
 * of paying 224px for this column.
 *
 * Diagnostics land here for the same reason. Every message the old build
 * stacked above the grid was about scope, so putting them in the scope column
 * costs the rules nothing instead of shoving them down the screen.
 *
 * **The rail does not scroll; the site list inside it does.** It used to scroll
 * as one block — 862px of content in a 600px column — so a seventh site pushed
 * the brand, the readout, the run state, "Add a site" and the whole request-type
 * checklist off the top and bottom together. Everything here is fixed but the
 * list, which stops at a height deliberately off the row pitch so that the row
 * it cuts in half is itself the "there is more" signal.
 *
 * Only the site list may give way when the rail is under pressure — a long
 * reconcile error, a smaller font, a taller field. Every other child is `shrink-0`,
 * so the checklist and the readout keep their size and the list shows fewer
 * rows rather than the column overflowing.
 */
export function ScopeRail({
  paused,
  announcement,
  onTogglePause,
  domains,
  byHost,
  lastError,
  iconError,
  allSites,
  allSitesGranted,
  onToggleAllSites,
  onGrantAllSites,
  resourceTypes,
  onAddDomain,
  onRemoveDomain,
  onToggleType,
  onGrant,
  bridge,
  bridgeLastCommandAt,
  bridgeError,
  bridgeRequestError,
  onEnableBridge,
  onDisableBridge,
}: ScopeRailProps) {
  const typeCount = resourceTypes.filter((t) => OFFERED_TYPES.includes(t)).length;

  /**
   * The all-sites row's state, in the same four-way shape a site row uses.
   *
   * `unknown` is not `pending`. `null` means the probe has not answered, and a
   * row that named a state before the browser had been asked is the flicker
   * `allSitesGranted: null` exists to prevent — so that state carries no icon,
   * no colour and no sentence, only the switch.
   */
  const allSitesState = !allSites
    ? 'off'
    : allSitesGranted === null
      ? 'unknown'
      : allSitesGranted
        ? 'granted'
        : 'pending';

  /**
   * `idle` covers two states that look identical to the extension but must
   * not look identical to a person: "Enable pressed, `headerlab bridge
   * install` never run" and "was live, the host just died". Both used to get
   * a second box below the row this constant now feeds — deleted, because
   * the rail has zero slack (see the site-list docblock below) and a box
   * that only appears on error collapsed the site list to nothing under
   * real content pressure, in production as much as in a test with enough
   * sites to reach the cap. The error is folded into the row that already
   * exists instead: see the `bridgestate` block for where this is read.
   */
  const bridgeUnreachable = bridge === 'idle' && bridgeError !== null;
  const bridgeRowTitle = bridgeTitle(
    bridge,
    bridgeUnreachable,
    bridgeError,
    bridgeRequestError,
    bridgeLastCommandAt,
  );

  /**
   * The state, in the one channel that works for everyone: text. It is the
   * same fact the dot's shape carries, and now it reaches the eye as well as
   * the accessibility tree — see {@link BRIDGE_STATE}.
   *
   * `unreachable` rather than `idle` when a connection was expected, because
   * that is the state with a remedy attached, and the remedy leads the title
   * it sits beside.
   */
  const bridgeState =
    bridge === 'live'
      ? BRIDGE_STATE.live
      : bridge === 'unknown'
        ? null
        : bridge === 'off'
          ? BRIDGE_STATE.off
          : bridgeUnreachable
            ? BRIDGE_STATE.unreachable
            : BRIDGE_STATE.idle;
  const bridgeDetail =
    bridgeState === null
      ? ''
      : bridgeRowTitle === null
        ? bridgeState.spoken
        : `${bridgeState.spoken} — ${bridgeRowTitle}`;

  return (
    <aside className="relative flex h-full w-56 shrink-0 flex-col border-r border-rail-border bg-rail py-3">
      {/* The rail's one announcement channel, and it is mounted before
          anything can fill it — a live region that *appears* with its first
          message is never spoken, because the browser only announces changes
          to a region it was already watching. So this span exists in every
          state, empty or not.

          Clipped out of sight (`VISUALLY_HIDDEN`, see there) is the
          zero-pixel bargain: nothing the eye can find, while giving screen
          readers the one thing they had no path to at all — the outcome of a
          permission prompt (either way: a Grant button that unmounts on
          success takes the focus to <body> with it, and a decline used to
          leave the screen identical to before the click) and a refused
          uncheck that changes nothing on screen. What it says is App's
          decision; this is only the speaker. The aside's `relative` is what
          the span's `inset-x-0` resolves against — see the constant. */}
      <span
        key={announcement?.nonce ?? 'idle'}
        role="status"
        data-testid="announcement"
        className={VISUALLY_HIDDEN}
      >
        {announcement?.text}
      </span>
      <div className="flex h-6 shrink-0 items-center gap-2 px-3">
        <span
          className="flex size-6 shrink-0 items-center justify-center rounded-md bg-foreground text-background"
          aria-hidden="true"
        >
          <ArrowUpDown className="size-3.5" />
        </span>
        <span className="text-[14px] leading-[18px] font-semibold tracking-[-0.014em] text-foreground">
          HeaderLab
        </span>
      </div>

      {/* The count and the master switch on one raised surface. They are the
          same question asked twice — how much is going out, and is any of it —
          so they share a card rather than sitting as two bands on the rail. */}
      <div className="mx-3 mt-3 shrink-0 rounded-[10px] bg-card p-3 shadow-sm">
        {/* The count that used to open this card is gone (owner's call,
            2026-08-20) — a 24px number and a line naming what was held, 48px
            spent at the top of the rail, which is the part that runs out first
            as the site list grows. It reads in the panel head now
            (`RulePanel`), right-aligned beside "Rules", where there was width
            to spare. What stays is the half this card was really for: whether
            anything is running at all, and the two switches that decide it. */}
        <div
          className="group/run flex h-5 items-center gap-[7px]"
          data-testid="runstate"
          data-paused={paused || undefined}
        >
          {/* Paused is deliberate, not broken, so it recedes to a neutral dot
              rather than borrowing the amber that means "something needs you". */}
          <span
            className="size-1.5 shrink-0 rounded-full bg-live group-data-[paused]/run:bg-muted-foreground"
            aria-hidden="true"
          />
          <span className="text-[12px] leading-4 font-semibold text-foreground">
            {paused ? 'Paused' : 'Active'}
          </span>
          <span className="flex-1" />
          <Switch
            size="sm"
            aria-label={paused ? 'Resume all rules' : 'Pause all rules'}
            checked={!paused}
            onCheckedChange={(on) => onTogglePause(!on)}
            className={SWITCH_CLASS}
          />
        </div>

        {/* The fourth line of the readout card. It did not fit inside the 28px
            the rail's own docblock once claimed — that figure was read off the
            source, not the built popup, and the real number was 7px once
            measured correctly (docs/design/2026-08-12-agent-bridge-rail-budget.html).
            The 21px shortfall is closed by trimming four other margins one
            notch each (this row's own `mt-1`, the readout card's and sites
            section's `mt-4`→`mt-3`, the types section's `pt-3`→`pt-2`) and
            taking the remaining 5px from the site list's own cap — see that
            list's docblock for the accounting.

            Shaped exactly like the run state above it because it is the same
            kind of fact: a thing that is either happening or not, with one
            control — and now with the same control, a switch, measured at the
            identical 18.39px inside an unchanged 20px row.

            **This switch does call `permissions.request()`, and that is a
            deliberate exception to the rule the all-sites switch established.**
            That rule — a consent dialog follows a button that asks for
            consent, never a control that merely moved — was written about
            `<all_urls>`, the largest grant this extension can make, where the
            switch had somewhere else to put the user's intent: `filter.
            allSites` stores the mode, so the switch can set it and leave a
            Grant button to do the asking. The bridge has no such field.
            Holding the permission *is* the state, so a switch here either
            asks or is decorative, and a decorative switch that needs a second
            control beside it to mean anything is worse than the button it
            replaced. The narrower grant and the row's single purpose are what
            make the exception affordable; do not read it as licence to let
            the all-sites switch prompt again. */}
        {/* `relative` for the `bridge-detail` span below it — its
            `inset-x-0` has to resolve against this row, the parent the e2e
            width guard compares it with, not against the viewport. */}
        <div
          className="relative mt-1 flex h-5 items-center gap-[7px]"
          data-testid="bridgestate"
          data-bridge={bridge}
          {...(bridgeRequestError === null ? {} : { 'data-request': bridgeRequestError.reason })}
        >
          {/* Colour only when a port is actually open, plus the pending
              (amber) borrow below for `bridgeUnreachable` — incomplete
              rather than wrong, the same reading that keeps a pending site
              row out of the error palette. `unknown` gets the slot with no
              fill at all — reserving the space must not put a phantom state
              on screen, the same bargain the all-sites glyph makes.

              Shape is the second channel, and it says the one thing colour
              was saying alone: a filled dot is running, a ring is not.
              Colour-blind vision reads that distinction off the silhouette;
              the detail span below says it in words. `border` rather than a
              second filled tone because `box-sizing: border-box` is global,
              so the 6px box wears a 1px ring and a transparent middle at no
              cost to the geometry. */}
          <span
            className={`size-1.5 shrink-0 rounded-full ${
              bridge === 'live'
                ? 'bg-live'
                : bridge === 'unknown'
                  ? 'bg-transparent'
                  : // `bridgeUnreachable` implies `idle`, so it is not repeated here.
                    bridge === 'idle' || bridgeRequestError !== null
                    ? 'border border-pending bg-transparent'
                    : 'border border-muted-foreground bg-transparent'
            }`}
            aria-hidden="true"
          />
          {/* `title` is where the detail goes, not a second box: Chrome
              reports the identical string for a missing host manifest, a
              manifest naming a different extension, and an interpreter it
              cannot start (measured) — the string is the least actionable
              part of the message, so the label names the state in words a
              person can act on and the remedy leads the title, with Chrome's
              string trailing it. Mutually exclusive with the last-command
              title below: a bridge that cannot be reached is not a bridge to
              report a last command for.

              The 124px this row leaves after the dot, the `sm` switch and
              three 7px gaps is no longer one budget: the label takes 76.52px
              of it and the state slot beside it takes 47.48px. The choice of
              word for the unreachable state moved with the budget and is
              argued at {@link BRIDGE_STATE}, against the smaller number. */}
          <span
            className="truncate text-[12px] leading-4 font-semibold text-foreground"
            id="bridge-label"
            data-testid="bridge-label"
            {...(bridgeRowTitle === null ? {} : { title: bridgeRowTitle })}
          >
            {BRIDGE_NAME}
          </span>
          {/* The whole report, in the one place every user can reach. It
              used to live only in the label's `title` above, which a pointer
              reaches by hovering and nothing else reaches at all — and the
              `aria-describedby` below pointed at that label, which computes
              to the label's own subtree text ("Agent bridge") and stops:
              the accessible-name algorithm takes content before it ever
              falls back to a title, so the description the markup seemed to
              promise was never delivered. The fix is not a design change
              but a correction of that mechanism: the description text gets
              an element of its own, this span, which costs nothing
              (`VISUALLY_HIDDEN`, for the reasons that constant's own
              docblock gives) and says everything the title says — plus the
              state word, so the dot's colour is never the only voice for
              it. The row's `relative` (below) is what the span's `inset-x-0`
              resolves against. */}
          <span id="bridge-detail" data-testid="bridge-detail" className={VISUALLY_HIDDEN}>
            {bridgeDetail}
          </span>
          {/* The state, in space this row already had. It REPLACES the `flex-1`
              spacer rather than joining it, so the row gains no box and no
              gap — this span IS the flex item, which is why its x and width
              are the same in every state including `unknown`, where it renders
              nothing.

              `truncate` is the one-line rule: no string can add a second line
              inside an `h-5` row, and its `overflow: hidden` resolves the flex
              automatic minimum size to 0, so an over-long word ellipsizes
              instead of pushing the switch.

              `aria-hidden` because `bridge-detail` already says this word to
              the switch's description, at the length that has room for the
              whole sentence. Announcing both would say the state twice. */}
          <span
            id="bridge-state"
            data-testid="bridge-state"
            aria-hidden="true"
            className="min-w-0 flex-1 truncate text-[12px] leading-4 font-medium text-muted-foreground"
          >
            {bridgeState === null ? '' : bridgeState.shown}
          </span>
          {bridge === 'unknown' ? null : (
            <Switch
              size="sm"
              // Named by the element that paints the name, so the two cannot
              // drift: the accessible name is byte-identical to the visible
              // text. It was `aria-label={... 'Enable the agent bridge' :
              // 'Disable the agent bridge'}`, which was wrong twice over — it
              // named an action where `role="switch"` already conveys one and
              // `aria-checked` already carries the state, so a screen reader
              // read "Disable the agent bridge, switch, on": two words in one
              // utterance pointing opposite ways. It was also the last
              // "Enable" in a project whose popup has no such control.
              aria-labelledby="bridge-label"
              // The report, and only the report. `bridge-label` came out of
              // this list when it became the name above: keeping it would
              // open every description with the name it had just been given.
              // `bridge-detail` resolves to an element really in this
              // document — see the detail span above for why pointing at a
              // `title`-bearing element alone announces nothing.
              aria-describedby="bridge-detail"
              checked={bridge !== 'off'}
              onCheckedChange={(on) => (on ? onEnableBridge() : onDisableBridge())}
              className={SWITCH_CLASS}
            />
          )}
        </div>
      </div>

      {/* A failed reconcile means nothing is applying, which contradicts the
          run state directly above it — so it sits at the top of the rail,
          above everything it makes untrue. It used to be placed "rather than
          among the scope notes"; those are gone (2026-08-19), and with them
          the only other notes this one could have been grouped with. The
          placement is unchanged and the reason survives it: the note goes
          above what it contradicts. */}
      {lastError !== null && (
        <div className={`${NOTE_CLASS} mt-3 border-l-destructive`} data-testid="sync-error">
          <b className="mb-0.5 block font-bold text-destructive">Rules not registered</b>
          {lastError}
        </div>
      )}

      {/* The toolbar can under-report: unpause registers the rules and then
          sets the icon, so a failure there leaves grey chrome over an
          extension that is modifying headers. The run state above is the one
          that is true. */}
      {iconError !== null && (
        <div className={`${NOTE_CLASS} mt-3 border-l-destructive`} data-testid="icon-error">
          <b className="mb-0.5 block font-bold text-destructive">Toolbar icon out of date</b>
          The icon may not match the run state above. {iconError}
        </div>
      )}

      {/* The only part of the rail allowed to give way, and the only part that
          scrolls — see the component docblock.

          `min-h-0` here is load-bearing, and this is the one place in the popup
          where it is — all three conditions have to hold at once, which is why
          the two in RulePanel are inert and this one is not:

          the `aside` is a **column** flex container, so height is the main axis
          and a child's automatic minimum size actually applies (in the panel's
          row-direction parent it never does); this column's own `overflow` is
          `visible`, so that minimum is not zeroed the way a scroll container's
          is; and its minimum resolves to the full height of the heading, the
          all-sites row and the add field, because those three are `shrink-0`
          and only the list between them can collapse.

          Measured by removing it: with a note on screen the rail went to
          676px of content in a 600px box and pushed the request types 37px
          down, instead of the site list shrinking from 132 to 48. Those
          figures are from the tree of the day, when the note on that page was
          a scope note; the notes are gone (2026-08-19) and the e2e suite now
          plants a sync-error to make the same pressure, so the page it opens
          is still a note plus eight sites — see the overflow guard in the
          e2e header-modification spec, "목록이 넘쳐도 잘리지 않고", and the
          reasoning written at its seed.
          (Named rather than pathed on purpose: a quoted path under the test
          directory is a false red in the shipped-source guard that keeps the
          Tailwind carve-out sound. Its own docblock says to reword.)

          What that test actually pins is the *pair* below rather than this
          class alone; read the next paragraph before deleting either.

          `overflow-hidden` closes the other half of what that pressure does.
          `min-h-0` lets this section shrink, but shrinking alone only decides
          *how much* is visible — a box smaller than its `shrink-0` children
          with `overflow: visible` lets those children paint beyond it, so with
          both error notes above on screen the collapsed section's add field
          overprinted the request-types heading below (measured in the built
          popup: 30.5px of two texts in the same pixels). Clipping here means
          the shortfall is paid by this section's own list, which is the one
          part of the rail that is allowed to give way — never by a section
          that did not move. At nominal size the content fits and nothing is
          clipped, so the class costs nothing until the failure it contains. */}
      {/* `pb-[3px]` is the add field's focus ring, not spacing. `overflow-hidden`
          above clips at this box's *padding* edge, and the field is the last
          child — flush with that edge, measured: the input's bottom and this
          box's bottom were the same pixel. The ring is a 3px box-shadow drawn
          outside the border box, so all 3px of its lower arc were cut off and
          a keyboard user saw a ring open at the bottom. Three pixels of padding
          put the ring inside the clip without moving the field: padding grows
          the box the clip uses, not the content's position. The rail can afford
          it — the leftover is 28px with no notes up (CLAUDE.md, Interface) —
          and the alternative, dropping the clip, is what let the field
          overprint the request-types heading under pressure. */}
      <div className="mt-3 flex min-h-0 flex-col gap-1.5 overflow-hidden pb-[3px]">
        <div className={HEAD_CLASS}>
          Sites{' '}
          <span className={HEAD_COUNT_CLASS} data-testid="site-count">
            {/* Reads the mode, not the list length. `all` used to mean "the
                list is empty", which was true of a filter applying everywhere
                and equally true of one that had not been scoped yet — the same
                two states the warning above the list was trying to describe.
                Now `all` is said only when all-sites is on, and an empty list
                counts as the 0 it is. */}
            {allSites ? 'all' : domains.length}
          </span>
          <span className="flex-1" />
          {/* The one fact the chip cannot convey: a port or a path could never
              have narrowed anything, because `requestDomains` is host-only.
              Behind a `?` rather than standing under the field — it is worth
              knowing once, not worth 196px of permanent rail.

              Shown before it is stated. The reader's real question is "what
              happens to what I paste", and two worked pairs answer that faster
              than the rule they demonstrate.

              A portalled tooltip rather than the hand-rolled bubble this
              replaces: that one was absolutely positioned inside the rail, and
              the rail's own `overflow-y: auto` made `overflow-x` compute to
              `auto` too, which sliced the bubble at the 224px edge. It was
              anchored to the full-width heading to work around that. Nothing
              anchored inside the rail is clipped now, because the content is
              not inside the rail at all. */}
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  aria-label="About matching sites"
                  className="flex size-5 shrink-0 items-center justify-center rounded-[4px] text-muted-foreground hover:text-foreground"
                >
                  <CircleHelp className="size-3.5" aria-hidden="true" />
                </button>
              </TooltipTrigger>
              <TooltipContent
                data-testid="help-bubble"
                side="bottom"
                align="end"
                className="max-w-[210px] flex-col items-start gap-1 px-2.5 py-2 text-[10.5px] leading-[1.45] font-normal [overflow-wrap:anywhere]"
              >
                <span className="flex flex-col gap-[3px]">
                  {[
                    ['https://x.com/a/b', 'x.com'],
                    ['localhost:3000', 'localhost'],
                  ].map(([from, to]) => (
                    <span key={from} className="flex items-baseline gap-[5px]">
                      <code className="font-mono text-[9.5px] leading-[1.35] font-medium">
                        {from}
                      </code>
                      <span aria-hidden="true">→</span>
                      <code className="font-mono text-[9.5px] leading-[1.35] font-medium">
                        {to}
                      </code>
                    </span>
                  ))}
                </span>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>

        {/* Above the list, because it decides what the list means.
            Underneath it the rows would read as one more site among the
            others rather than as the switch that turns all of them off.

            Shaped like a site row in the ways that carry meaning — same fill,
            same glyph slot, same Grant button — because it is the same kind of
            object: a scope, its access state, and the remedy when that access
            is missing. **Not the same height any more, and no longer a second
            line at all** (2026-08-21): this row is 40px against a site row's
            50 or 60, because the owner traded its reserved second line for the
            vertical space and Grant moved up beside the switch. It used
            to be a coloured bar that changed fill with its state, which meant
            "on and working" and "on and waiting for a grant" were an amber
            tint apart and the Grant button had nowhere to go but the same
            line as the label. The colour is on the glyph and the button now,
            which is where a site row puts it.

            Its own control rather than a row in the list: "everywhere" is not
            a site, and giving it a chip beside `api.example.com` would put the
            thing that overrides the list inside the list. That shape is what
            made the empty list mean two things in the first place. */}

        <div
          className="mx-3 flex shrink-0 items-center gap-1.5 rounded-lg bg-card pt-2 pr-1.5 pb-2 pl-2.5 shadow-sm"
          data-testid="all-sites"
          data-granted={allSitesState === 'pending' ? 'no' : undefined}
        >
          {/* The glyph's *slot* is unconditional; only its meaning is not. It
              used to render solely once the state was known, so "All sites"
              slid sideways the moment a probe answered — and back again when
              the mode went off. State changes appearance, not geometry.

              With nothing to report it is a blank 14px carrying no `role` and
              no label: reserving the space must not put a phantom image into
              the accessibility tree. A globe rather than the site rows' circle,
              because this row is a mode and not a host — the one thing about it
              that is not the same fact. */}
          {allSitesState === 'granted' || allSitesState === 'pending' ? (
            <Globe
              className={`size-3.5 shrink-0 ${allSitesState === 'granted' ? 'text-live' : 'text-pending'}`}
              data-testid="all-sites-state"
              role="img"
              aria-label={allSitesState === 'granted' ? 'Access granted' : 'Awaiting permission'}
            />
          ) : (
            <span className="size-3.5 shrink-0" data-testid="all-sites-state" data-unknown="" />
          )}

          <span className="min-w-0 flex-1 truncate text-[12px] leading-4 font-semibold text-foreground">
            All sites
          </span>

          {/* The remedy, on the same line as the label since 2026-08-21.

              It had a reserved second line of its own, which made this row
              60px in every state — the same shape as a site row, deliberately,
              because it is the same kind of object. The owner traded that for
              the vertical space: the rail's scarcest resource is the site
              list, and this row was spending 24px on a band that says nothing
              in the state the popup opens in.

              `granted` says nothing here at all. The globe above already
              carries "Access granted" as its accessible name, so a word beside
              it would be the same fact twice — and the row is narrow now.

              **The WIDTH is still reserved, and that is not the same rule.**
              Without it the switch slides 50px left the instant the mode goes
              pending — under the pointer that just pressed it, which is worse
              than the vertical movement this change accepted. It is paid out
              of slack rather than out of the label: the label's text measures
              46.8px against the 67px this leaves it.

              The only control here that asks the browser for anything. The
              switch sets the mode and stops (App.tsx): `<all_urls>` is the
              largest grant this extension can request, so it is spent when a
              button labelled Grant is pressed, never as a side effect of a
              switch moving. */}
          <span className="flex h-6 w-[52px] shrink-0 items-center justify-end">
            {allSitesState === 'pending' ? (
              <Button {...GRANT_BUTTON_PROPS} onClick={onGrantAllSites}>
                Grant
              </Button>
            ) : null}
          </span>

          <Switch
            aria-label="Apply to every site"
            checked={allSites}
            onCheckedChange={onToggleAllSites}
            className={SWITCH_CLASS}
          />
        </div>

        {/* The list is kept on screen, not hidden, while all-sites is on:
            hiding it would make turning the mode off look like it had thrown
            the user's scope away, and there would be no way to see what
            turning it back off returns to. It is shown as what it is — still
            there, not in use — and each row says so on its own second line.

            The height stops at 200px. **The rows stopped having one pitch on
            2026-08-21**, when they lost their fixed heights: a granted or
            unusable row is 50px and a pending one is 60, so with the 6px gap
            the pitch is 56 or 66 depending on what the list holds. Measured in
            the built popup at that cap:

              all granted  rows at 0-50, 56-106, 112-162, 168-218
                           -> three whole, and 32px of the fourth
              all pending  rows at 0-60, 66-126, 132-192, 198-258
                           -> three whole, and **2px** of the fourth

            **So the cut row — the affordance that says the list continues —
            is much weaker for a pending list than for a granted one, and no
            single cap can serve both pitches.** That is a real cost of the
            row-height change and it is stated here rather than left in the
            arithmetic: before the change, 174px with uniform 60px rows sliced
            the third row 42px in, whatever the states were. A code reviewer
            found this; the assertion in header-modification.spec.ts had been
            written against the granted arithmetic while its own fixture
            renders four pending rows.

            The 19px between 200 and the 219 the rail could give is the price
            of keeping any slice at all in the granted case — 219 lands one
            pixel past the fourth row and shows four whole ones. Re-measure
            before spending any figure here; every number in this docblock has
            been overtaken at least once, and two of them were overtaken while
            still being quoted by other files.

            **Superseded — this paragraph records the 127 -> 108 move, whose
            arithmetic the 108 -> 174 move above replaced.** Read it as
            history, not as the current shape: it argues for one full row
            plus a sliced second, and the cap now shows two full rows and a
            42px slice of the third. It is kept because the *method* is what
            carries forward. At the time the rail offered this list 136px at
            nominal (127 of cap plus 9px of real leftover, measured in the
            built popup with 60px rows). Two full rows needed 126px and the
            third began at 132, so "two full rows plus a visible slice" no
            longer fit: 136 would have bought a 4px sliver that reads as
            nothing. The choice was between two clean rows with no signal and
            one full row plus a clearly sliced second; the slice is the
            signal, so the slice won — and that is the rule the 174px cap was
            chosen by too.
            The reference mockup capped the list at a fixed 176px, which
            this does not copy — a hard cap opens a hole between the last
            site and everything below it when there are only one or two.
            `max-height` lets the list be as tall as it has content for, and
            `mt-auto` on the section below sends the leftover (28px now) to
            the foot of the rail instead.

            **This cap was briefly 119px and is back at 127px, which is worth
            recording because the intermediate number was honest when it was
            written and wrong two commits later.** The all-sites row's padding
            grew by 8px, the rail had no slack, and this list — `flex-shrink: 1`
            and the only child allowed to give way — had silently absorbed the
            deficit, rendering 119 while the CSS still said 127. Writing 119
            made the stored value the operating value, which is the defect
            `effectiveDomain` exists to prevent one layer down.

            Then the scope note gave up a stacked `mt-3` and `AddSiteField` gave
            up a 15px reserved line — 27px freed directly above this list. The
            8px was no longer being taken from anywhere, so charging the list
            for it made the cut row 11px of 48 for nothing. Re-measured after
            both: `mt-auto` on the request types resolves to 21px of real
            leftover with the cap at 119, so the list can have its 8px back and
            the rail still ends with slack rather than pressure.

            Re-measure before changing it again, with the `measure()` in
            docs/design/2026-08-12-agent-bridge-rail-budget.html: this figure
            moved twice inside one branch, and each time the reasoning was
            correct against a tree that had already changed underneath it.

            132 was the figure here before the bridge row
            (components/ScopeRail.tsx's bridgestate block) landed. That row
            needed 28px and the rail had 7 genuinely free — measured in the
            built popup, not read off the source; see
            docs/design/2026-08-12-agent-bridge-rail-budget.html for the
            arithmetic. Four other margins each gave up one notch on
            Tailwind's 4px spacing scale (the readout card's and this
            section's own `mt-4`→`mt-3`, the types section's `pt-3`→`pt-2`,
            the bridge row's own `mt-2`→`mt-1` — 16px→12px is 4px, not 1),
            closing 16 of the 21px shortfall; the list gave up the remaining
            5, 132→127.

            **The rail now carries zero slack.** Every other margin in this
            card was already load-bearing rhythm, not spare space, so the next
            thing added to this rail does not have 7 (or 28) free px waiting
            for it — it reopens this exact accounting from a starting budget
            of 0, and adding it without shrinking this list further means
            finding room somewhere else in the rail on purpose, not by
            spending what is left here.

            This is not hypothetical: a bridge-connect-error note briefly
            lived here as its own box, conditionally rendered below the
            bridgestate row. It was deleted rather than budgeted, because
            "budgeted" was not available — measured against the built popup
            with that note present and a full 4-site list, this element's
            `clientHeight` went to 0, not merely smaller: the note's own
            height alone exceeded everything zero slack had left to give,
            taking the entire site list off the screen (CLAUDE.md's "Never
            show something the user cannot reach", of a list of the user's
            own configured sites). `ScopeRail.tsx`'s `bridgeUnreachable`
            folds that error into the row that already exists — a colour and
            a `title`, no new box — instead. A future note belongs in a
            fixed-height reserved slot sized against a real measurement of
            this list's actual floor, the same way the bridge row itself was
            budgeted; it does not belong as a conditional box added here on
            the assumption that "zero slack" still means "close, but it
            fits".

            The scrollbar is not assumed to be visible: on macOS it is an
            overlay that paints over the content and vanishes. `scroll-list`
            reserves its 8px anyway (see style.css for the measurement), so the
            rows do not shift the moment a fourth site arrives — but what says
            "there is more" is the cut row, which is there in every case.

            `empty:hidden` so a rail with no sites yet does not carry a 6px gap
            for a list with nothing in it. */}
        <div
          className="scroll-list flex max-h-[200px] flex-col gap-1.5 pr-1 pl-3 empty:hidden"
          data-testid="site-list"
        >
          {domains.map((stored) => {
            // `analyzeDomain` is asked, never restated — it is the one definition
            // of what a usable host is, and the same call already supplies the
            // key this row's diagnostics are filed under.
            //
            // The row shows the *effective* value, not the stored one. New
            // entries are already normalized on commit, so for those the two are
            // the same string; entries written before that are still raw, and
            // showing those verbatim would put the old defect back on screen for
            // exactly the people who already hit it. `key` and removal stay on
            // the stored value, which is what identifies the entry in the list.
            const analysis = analyzeDomain(stored);
            return (
              <SiteRow
                key={stored}
                domain={effectiveDomain(stored)}
                usable={analysis.valid}
                inert={allSites}
                diagnostics={byHost.get(analysis.host) ?? []}
                onGrant={onGrant}
                onRemove={() => onRemoveDomain(stored)}
              />
            );
          })}
        </div>

        {/* Outside the scroll container, always. Inside it, adding a site
            would be something you have to scroll to reach once you have a few
            — which is hiding the one control that makes the list grow. */}
        <div className="shrink-0 px-3">
          <AddSiteField onAdd={onAddDomain} />
        </div>

        {/* The scope notes are gone (owner's ruling, 2026-08-19), and this is
            where they used to render — last in the section, after the field.
            Their subjects moved onto the things they were about: an unusable
            entry now wears its invalid Badge on its own row (SiteRow), and
            "no site set" is the readout's own sentence ("blocked until a site
            is set"). What the notes' arrival-and-departure geometry once cost
            this section is recorded in CLAUDE.md's Interface table; the two
            error notes that remain (sync-error, icon-error) render above the
            section, not here, and are untouched by this. */}
      </div>

      {/* Last, and pushed to the foot by `mt-auto`: the leftover space in a
          rail with two sites belongs at the bottom of the column, not as a
          hole in the middle of it. The checklist is the least-touched control
          on screen, so it is the one that can afford to be the thing you
          scroll past. */}
      <div className="mt-auto shrink-0 pt-2" data-testid="rail-section-types">
        <div className={HEAD_CLASS}>
          Request types{' '}
          <span className={HEAD_COUNT_CLASS}>
            {typeCount} of {OFFERED_TYPES.length}
          </span>
        </div>
        <div className="mt-1.5 px-3">
          <TypeChecklist selected={resourceTypes} onToggle={onToggleType} />
        </div>
      </div>
    </aside>
  );
}
