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
   * The last outcome worth announcing, or null while there is nothing to say.
   *
   * Rendered into the always-mounted `role="status"` span at the top of the
   * rail — see that span for why it must never be the one to appear.
   */
  announcement: string | null;
  onTogglePause: (paused: boolean) => void;
  domains: readonly string[];
  /** Host-scoped diagnostics, keyed by the normalized host they name. */
  byHost: ReadonlyMap<string, Diagnostic[]>;
  /**
   * What is stopping the rules, when it is not the rules themselves.
   *
   * `null` means the blocked rules are individually broken and the count can
   * speak for itself.
   *
   * `'access'` is the fourth verdict: every host that scopes the rule set is
   * ungranted, so nothing compiled for it can match a request. It completes
   * the sentence the same way `'scope'` does — "until" rather than "by",
   * because nothing is wrong with the rules; the sentence names the missing
   * step, and the Grant buttons below it are that step.
   */
  /**
   * How many scoping hosts are still ungranted, when some but not all are.
   *
   * App computes this beside the tally's `access` verdict, from the same
   * `byHost` this rail renders its rows from — the count shown here and the
   * rows wearing Grant below can never disagree, because they are the same
   * computation read once. Only read when the tally's rules are live (granted
   * hosts remain), which is the state whose sentence it finishes.
   */
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
  onGrant: (host: string) => void;
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
 * The name is constant now, the dot carries the state at a glance, and
 * `bridgeTitle` carries the detail; that split is what let `idle` take its own
 * colour below.
 */
const BRIDGE_NAME = 'Agent bridge';

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
   * The state as one word, for the detail span the switch points at. It is
   * the same fact the dot's shape now carries — running, not running, or
   * nothing to say yet — in the one channel that works for everyone: text.
   * "cannot be reached" rather than "idle" when a connection was expected,
   * because that is the state with a remedy attached, and the remedy leads
   * the title it sits beside.
   */
  const bridgeStateWord =
    bridge === 'live'
      ? 'live'
      : bridge === 'unknown'
        ? null
        : bridge === 'off'
          ? 'off'
          : bridgeUnreachable
            ? 'cannot be reached'
            : 'idle';
  const bridgeDetail =
    bridgeStateWord === null
      ? ''
      : bridgeRowTitle === null
        ? bridgeStateWord
        : `${bridgeStateWord} — ${bridgeRowTitle}`;

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
      <span role="status" data-testid="announcement" className={VISUALLY_HIDDEN}>
        {announcement}
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

              "Bridge down", not "Bridge unreachable": this row now has 124px
              for the label, re-measured against the built popup — the row is
              175px and spends 6px on the dot, 24px on the `sm` switch and
              21px on three 7px gaps, leaving the label and the `flex-1`
              spacer to share 124px.

              That budget was 87.15625px while a 56.91px Disable button sat
              where the switch now is, and the 36.85px it gave back changes an
              answer rather than merely restating it: "Bridge unreachable"
              measures 115px in this exact font and weight, so it no longer
              overflows. It is still rejected, but the reason is now taste
              rather than arithmetic — "Bridge down" says the same thing in
              73.98px and this row is read at a glance. Re-measure before
              trusting the 9px: this figure has already moved twice in one
              branch, 87.15625 → 116 → 124, once when the button became a
              switch and again when the switch became `sm`. "Bridge lost"
              fits at 64.05px but asserts prior possession; the common path
              into this state is the switch turned on and `headerlab bridge
              install` never run, where nothing was ever had. */}
          <span
            className="text-[12px] leading-4 font-semibold text-foreground"
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
          <span className="flex-1" />
          {bridge === 'unknown' ? null : (
            <Switch
              size="sm"
              aria-label={bridge === 'off' ? 'Enable the agent bridge' : 'Disable the agent bridge'}
              // The name the switch needs beside its label, and the report
              // it carries: `bridge-label` for the constant words,
              // `bridge-detail` for the state and the remedy. Both ids
              // resolve to elements really in this document — see the
              // detail span above for why pointing at a `title`-bearing
              // element alone announces nothing.
              aria-describedby="bridge-label bridge-detail"
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

            Shaped exactly like a site row — same height, same fill, same
            reserved second line — because it is the same object: a scope, its
            access state, and the remedy when that access is missing. It used
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
          className="mx-3 flex h-[60px] shrink-0 items-center gap-1 rounded-lg bg-card pt-2 pr-1.5 pb-2 pl-2.5 shadow-sm"
          data-testid="all-sites"
          data-granted={allSitesState === 'pending' ? 'no' : undefined}
        >
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <div className="flex h-4 items-center gap-1.5">
              {/* The glyph's *slot* is unconditional; only its meaning is not.
                  It used to render solely once the state was known, so "All
                  sites" slid sideways the moment a probe answered — and back
                  again when the mode went off. State changes appearance, not
                  geometry (CLAUDE.md, Interface).

                  With nothing to report it is a blank 14px carrying no `role`
                  and no label: reserving the space must not put a phantom
                  image into the accessibility tree. A globe rather than the
                  site rows' circle, because this row is a mode and not a
                  host — the one thing about it that is not the same fact. */}
              {allSitesState === 'granted' || allSitesState === 'pending' ? (
                <Globe
                  className={`size-3.5 shrink-0 ${allSitesState === 'granted' ? 'text-live' : 'text-pending'}`}
                  data-testid="all-sites-state"
                  role="img"
                  aria-label={
                    allSitesState === 'granted' ? 'Access granted' : 'Awaiting permission'
                  }
                />
              ) : (
                <span className="size-3.5 shrink-0" data-testid="all-sites-state" data-unknown="" />
              )}
              <span className="min-w-0 flex-1 truncate text-[12px] leading-4 font-semibold text-foreground">
                All sites
              </span>
            </div>

            {/* The second line, reserved in every state and sized to the
                tallest thing it can hold — the Grant button, which is the
                shadcn `xs` height this line's `h-6` reserves — exactly as a
                site row's is. The mode being on and the access being missing
                is *said* here rather than left to a tint, in the same words a
                pending site row uses, because it is the same state.

                The only control here that asks the browser for anything. The
                switch sets the mode and stops (App.tsx): `<all_urls>` is the
                largest grant this extension can request, so it is spent when a
                button labelled Grant is pressed, never as a side effect of a
                switch moving. Every way of reaching this state — turning the
                mode on, declining once, or a store migrated from a build that
                never asked — therefore arrives at the same button. */}
            <span className="flex h-6 items-center pl-5">
              {allSitesState === 'pending' ? (
                <Button {...GRANT_BUTTON_PROPS} onClick={onGrantAllSites}>
                  Grant
                </Button>
              ) : (
                <span
                  className={`text-[11px] leading-[14px] ${
                    allSitesState === 'granted'
                      ? 'font-semibold text-live'
                      : 'font-medium text-muted-foreground'
                  }`}
                  // `granted` is the only state with words left, and the
                  // glyph above already carries them, so this span never
                  // reaches the accessibility tree. It is kept rather than
                  // branched away because the slot around it must not move.
                  aria-hidden={allSitesState === 'granted' || undefined}
                >
                  {/* The `off` state said "The list below applies" here until
                      2026-08-20 (owner's call). It was a mode description on a
                      row whose switch already says the mode, in the state the
                      popup opens in — so it was the line most often on screen
                      and the least often read.

                      The empty band it leaves is deliberate and costs nothing
                      new: this slot is `h-6` because it must hold the Grant
                      button in the `pending` state, and it already rendered
                      empty while the `<all_urls>` probe was out. Shrinking the
                      bar in `off` instead would move everything below it every
                      time the switch is flipped, which is the reflow the
                      Interface rule exists to stop. */}
                  {allSitesState === 'granted' ? 'Access granted' : ''}
                </span>
              )}
            </span>
          </div>

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

            The height stops at 174px, which is deliberately NOT a multiple of
            the row pitch. The rows are 60px (8px padding above and below,
            matching the all-sites bar, since the standard `xs` Grant made the
            second line 24px) and the gap is 6, so two whole rows occupy 132px
            and the third begins there — the cap sits 42px into it, slicing
            that row through its second line. The cut row is the affordance
            saying the list continues regardless of exactly how much of it
            shows; 132 or 192 would each show a whole number of rows and say
            nothing.

            **The cap went 108 -> 174 on 2026-08-20, and the 66px came from
            two things leaving the rail rather than from a preference.** The
            readout moved to the panel head (see the card above) and the run
            state gave up an `mt-3` that had only ever separated it from that
            readout. Measured in the built popup at eight sites, before and
            after: the leftover the request-types section was absorbing through
            its `mt-auto` read 73px, and this cap took 66 of it. What is left
            is 19px of real slack, which is deliberate — the last time this
            rail was spent to zero it cost a redesign. The remaining 19 would
            not buy a better shape anyway: 186 leaves 54px of the third row
            showing, near enough to a whole one to stop reading as a slice,
            and 192 is exactly three rows, which is the on-pitch case the
            paragraph above rejects. Re-measure both numbers before spending
            them; every figure in this docblock has been overtaken at least
            once.

            **Why the cap came down from 127 rather than up: measured, not
            chosen.** The rail offers this list 136px at nominal (127 of cap
            plus the 9px of real leftover below, re-measured in the built
            popup with 60px rows). Two full rows need 126px, and the third
            row starts at 132 — so "two full rows plus a visible slice", the
            shape this cap had at 48px and 52px rows, no longer fits: 136
            would buy a 4px sliver that reads as nothing. The choice was
            between two clean rows with no signal and one full row plus a
            clearly sliced second; the slice is the signal, so the slice won.
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
          className="scroll-list flex max-h-[174px] flex-col gap-1.5 pr-1 pl-3 empty:hidden"
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
