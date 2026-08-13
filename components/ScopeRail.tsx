import { ArrowUpDown, CircleHelp, Globe } from 'lucide-react';
import { AddSiteField, type AddSiteResult } from './AddSiteField';
import { GRANT_BUTTON_CLASS, SiteRow } from './SiteRow';
import { OFFERED_TYPES, TypeChecklist } from './TypeChecklist';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { analyzeDomain, effectiveDomain } from '@/lib/permissions/origins';
import type { RuleTally } from '@/lib/view/rules';
import type { Diagnostic, ResourceType } from '@/lib/model/types';

export interface ScopeRailProps {
  tally: RuleTally;
  paused: boolean;
  onTogglePause: (paused: boolean) => void;
  domains: readonly string[];
  /** Host-scoped diagnostics, keyed by the normalized host they name. */
  byHost: ReadonlyMap<string, Diagnostic[]>;
  /** Whole-screen problems that are about scope rather than any one rule. */
  notes: readonly Diagnostic[];
  /**
   * What is stopping the rules, when it is not the rules themselves.
   *
   * `null` means the blocked rules are individually broken and the count can
   * speak for itself.
   */
  blockedBy: 'sites' | 'scope' | 'pause' | null;
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
   * thing packages/cli/lib/bridge.mjs argues against by name. What `idle`
   * actually points at is the state a user really lands in: Enable pressed,
   * `headerlab bridge install` never run.
   */
  bridge: 'unknown' | 'off' | 'idle' | 'live';
  /** ISO timestamp of the last command applied through the bridge, or null. */
  bridgeLastCommandAt: string | null;
  /** Chrome's own message from the last failed connect, or null. */
  bridgeError: string | null;
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
 * coloured block. A pending site is already carrying colour; a stack of amber
 * slabs beside it would rebuild the wall of yellow this layout exists to
 * remove. Severity is carried by the edge, not by the mass.
 *
 * `[overflow-wrap:anywhere]` because these name hosts, and a host is one word —
 * without it a domain longer than the rail pushes the note out of the column.
 */
const NOTE_CLASS =
  'mx-3 mt-3 shrink-0 rounded-md border border-rail-border border-l-[3px] bg-background px-2.5 py-2 text-[10.5px] leading-[1.45] text-foreground [overflow-wrap:anywhere]';
/** The two switches in the rail are one control in two places. */
const SWITCH_CLASS = 'data-checked:bg-live [&_[data-slot=switch-thumb]]:dark:bg-white';

/**
 * Disable is not a request — it hands a permission back — so it does not
 * borrow the amber Grant palette. Enable does: it opens Chrome's consent
 * dialog, which is exactly what GRANT_BUTTON_CLASS already means everywhere
 * else on this screen.
 */
const BRIDGE_OFF_BUTTON_CLASS = 'h-5 rounded-[4px]';

const BRIDGE_LABEL = {
  unknown: 'Bridge',
  off: 'Bridge off',
  idle: 'Bridge idle',
  live: 'Bridge live',
} as const;

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
 * scope note, a smaller font, a taller field. Every other child is `shrink-0`,
 * so the checklist and the readout keep their size and the list shows fewer
 * rows rather than the column overflowing.
 */
export function ScopeRail({
  tally,
  paused,
  onTogglePause,
  domains,
  byHost,
  notes,
  blockedBy,
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
  onEnableBridge,
  onDisableBridge,
}: ScopeRailProps) {
  const typeCount = resourceTypes.filter((t) => OFFERED_TYPES.includes(t)).length;

  // The big number answers "is it on", which is the question asked most often.
  // The line under it names what is not going out — the old footer reported
  // "applying" and "off" and left every rule that was switched on and going
  // nowhere out of both figures.
  // "Unfinished" is named here rather than shown on the rule itself. A rule
  // created one click ago has an empty name because nothing has been typed
  // into it yet, and marking that row red accuses the user of a mistake the
  // product made. Saying it in the count keeps the state from going unsaid
  // without putting a complaint on an untouched row.
  // "Blocked" on its own points at the rule, and the rule is often not what is
  // wrong: an unusable site stops every rule while each one is perfectly good.
  // Naming the cause is what keeps the count from blaming the wrong object.
  // "until a site is set" rather than "by an unusable site": nothing is
  // unusable in that state and nothing is wrong, so blaming a site would send
  // the reader looking for a broken entry that does not exist. It is also the
  // only one of the three that is not a complaint — the sentence finishes the
  // thought the count starts rather than reporting a fault.
  const BLAMED = {
    sites: ' by an unusable site',
    scope: ' until a site is set',
    pause: ' while paused',
  } as const;
  const blame = blockedBy === null ? '' : BLAMED[blockedBy];

  const subcount: string[] = [];
  if (tally.off > 0) subcount.push(`${tally.off} off`);
  if (tally.unfinished > 0) subcount.push(`${tally.unfinished} unfinished`);
  if (tally.blocked > 0) subcount.push(`${tally.blocked} blocked${blame}`);

  /**
   * The whole second line as one string, or empty when there is nothing to add.
   *
   * Resolved here rather than branched in the markup so the line has exactly
   * one value: it is both what is rendered and what `title` carries, and those
   * two must not be able to disagree. The healthy state — rules configured and
   * all of them going out — has nothing to say and renders no text, which is
   * not the same fact as "nothing configured yet".
   */
  const subline = tally.total === 0 ? 'nothing configured yet' : subcount.join(' · ');

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

  return (
    <aside className="flex h-full w-56 shrink-0 flex-col border-r border-rail-border bg-rail py-3">
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
        <div data-testid="readout">
          <div className="flex h-7 items-baseline gap-[7px] tabular-nums">
            {/* No `leading-1`: at this weight macOS's system-ui glyphs have
                more ascent+descent than the nominal em square, so a line box
                the size of the font clips its own text — measured at 32px of
                content in a 30px box. CI renders the same stack under Linux
                Chromium's fallback fonts, with different metrics again, which
                is why this is a comfortable multiple rather than a number
                tuned against one machine's font. */}
            <b className="text-[24px] leading-7 tracking-[-0.03em] text-foreground [font-weight:650]">
              {tally.live}
            </b>
            <span className="text-[12px] leading-4 font-medium text-foreground-2">
              of {tally.total} rules live
            </span>
          </div>
          {/* One line is always reserved, empty or not. `display: none` on an
              empty count was the widest-reaching reflow in the popup: the
              healthy state has nothing to add, so switching one rule off made
              this line appear and pushed the run state, the all-sites switch,
              every site row and the request types down at once — from a click
              on the other side of the screen.

              One line, not two. The longest message this can hold wraps to two
              in a 199px column, and reserving for that would spend 16px of rail
              on a sentence most sessions never see. A message growing a line
              because it has more to say is content changing; an empty line
              appearing because a control did is the defect.

              That bound is a *ceiling*, so the text has to be told what to do
              when it reaches it. It was not: the box was `h-4 overflow-hidden`
              with the sentence as a bare anonymous flex item, so the longest
              real message — "1 off · 1 unfinished · 2 blocked by an unusable
              site" — wrapped to 22px inside a 16px box and `items-center` then
              sliced *both* lines through the middle. Measured in the built
              popup at 748×600. The clause it cut is the one this component
              argues hardest for ten lines above: naming the cause is what keeps
              the count from blaming the rule for an unusable site.

              So it truncates rather than wraps, with an ellipsis saying so and
              `title` carrying the whole sentence — the same bargain the
              hostname on a site row and the duplicate note in AddSiteField
              already make. `truncate` needs the text in its own `min-w-0` flex
              child; as a bare text node it is an anonymous box that
              `text-overflow` cannot address. */}
          <div
            className="mt-1 flex h-4 items-center gap-[5px] overflow-hidden text-[11px] leading-[14px] font-medium text-foreground-2"
            data-testid="subcount"
          >
            {subline !== '' && (
              <>
                {tally.off > 0 && (
                  <span className="size-1.5 shrink-0 rounded-full bg-input" aria-hidden="true" />
                )}
                <span className="min-w-0 truncate" title={subline}>
                  {subline}
                </span>
              </>
            )}
          </div>
        </div>

        <div
          className="group/run mt-3 flex h-5 items-center gap-[7px]"
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
            control. The control is a button and not a switch for the reason
            the all-sites switch stopped calling `permissions.request()` — a
            consent dialog must follow a button that asks for consent, never a
            control that merely moved. */}
        <div
          className="mt-1 flex h-5 items-center gap-[7px]"
          data-testid="bridgestate"
          data-bridge={bridge}
        >
          {/* Colour only when a port is actually open. `unknown` gets the slot
              with no fill at all — reserving the space must not put a phantom
              state on screen, the same bargain the all-sites glyph makes. */}
          <span
            className={`size-1.5 shrink-0 rounded-full ${
              bridge === 'live'
                ? 'bg-live'
                : bridge === 'unknown'
                  ? 'bg-transparent'
                  : 'bg-muted-foreground'
            }`}
            aria-hidden="true"
          />
          <span
            className="text-[12px] leading-4 font-semibold text-foreground"
            data-testid="bridge-label"
            {...(bridgeLastCommandAt === null
              ? {}
              : {
                  title: `Last change through the bridge: ${new Date(
                    bridgeLastCommandAt,
                  ).toLocaleString()}`,
                })}
          >
            {BRIDGE_LABEL[bridge]}
          </span>
          <span className="flex-1" />
          {bridge === 'unknown' ? null : bridge === 'off' ? (
            <Button
              size="xs"
              variant="secondary"
              className={GRANT_BUTTON_CLASS}
              onClick={onEnableBridge}
            >
              Enable
            </Button>
          ) : (
            <Button
              size="xs"
              variant="secondary"
              className={BRIDGE_OFF_BUTTON_CLASS}
              onClick={onDisableBridge}
            >
              Disable
            </Button>
          )}
        </div>
      </div>

      {/* A failed reconcile means nothing is applying, which contradicts the
          run state directly above it — so it sits here rather than among the
          scope notes, above everything it makes untrue. */}
      {lastError !== null && (
        <div className={`${NOTE_CLASS} border-l-destructive`} data-testid="sync-error">
          <b className="mb-0.5 block font-bold text-destructive">Rules not registered</b>
          {lastError}
        </div>
      )}

      {/* The toolbar can under-report: unpause registers the rules and then
          sets the icon, so a failure there leaves grey chrome over an
          extension that is modifying headers. The run state above is the one
          that is true. */}
      {iconError !== null && (
        <div className={`${NOTE_CLASS} border-l-destructive`} data-testid="icon-error">
          <b className="mb-0.5 block font-bold text-destructive">Toolbar icon out of date</b>
          The icon may not match the run state above. {iconError}
        </div>
      )}

      {/* Amber, not red: the permission is held and the bridge simply is not
          reachable — incomplete rather than wrong, the same reading that keeps
          a pending site row out of the error palette.

          Chrome's message is repeated verbatim and not interpreted. It is
          identical for a missing manifest, a manifest naming a different
          extension, and an interpreter that cannot start (measured), so any
          sentence here that picked one would be a guess wearing a diagnosis's
          clothes. What *is* actionable is the command, so that is what leads. */}
      {bridge === 'idle' && bridgeError !== null && (
        <div className={`${NOTE_CLASS} border-l-pending`} data-testid="bridge-error">
          <b className="mb-0.5 block font-bold text-foreground">Bridge not connected</b>
          Run <code className="font-mono text-[10px]">headerlab bridge install</code>. Chrome
          reports the same message for a missing host manifest, one naming a different extension,
          and an interpreter it cannot start. {bridgeError}
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

          Measured by removing it: with a scope note on screen the rail went to
          676px of content in a 600px box and pushed the request types 37px
          down, instead of the site list shrinking from 132 to 48. The e2e
          suite opens exactly that page (a note plus eight sites), so the class
          cannot be dropped in silence. */}
      <div className="mt-3 flex min-h-0 flex-col gap-1.5">
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
                <span>Matched by host — a port or path is dropped.</span>
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
          className="mx-3 flex h-12 shrink-0 items-center gap-1 rounded-lg bg-card pt-1 pr-1.5 pb-1 pl-2.5 shadow-sm"
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
                tallest thing it can hold — the Grant button — exactly as a
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
            <span className="flex h-5 items-center pl-5">
              {allSitesState === 'pending' ? (
                <Button
                  size="xs"
                  variant="secondary"
                  className={GRANT_BUTTON_CLASS}
                  onClick={onGrantAllSites}
                >
                  Grant
                </Button>
              ) : (
                <span
                  className={`text-[11px] leading-[14px] ${
                    allSitesState === 'granted'
                      ? 'font-semibold text-live'
                      : 'font-medium text-muted-foreground'
                  }`}
                  // Hidden only when the glyph above already carries these
                  // exact words; the off state has no glyph, so hiding its
                  // line would take the sentence out of the tree entirely.
                  aria-hidden={allSitesState === 'granted' || undefined}
                >
                  {allSitesState === 'granted'
                    ? 'Access granted'
                    : allSitesState === 'off'
                      ? 'The list below applies'
                      : ''}
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

            The height stops at 127px, which is deliberately NOT a multiple of
            the 54px row pitch: two rows and the gap after them are 108px and
            three are 156px, so a third site leaves that row cut across the
            middle — now 19px of 48, not the wider 24px an unpressured rail
            could afford — and the cut row is the affordance saying the list
            continues regardless of exactly how much of it shows. 156 or 162
            would each show a whole number of rows and say nothing; nor would
            108, which is why the cap sits above two full rows rather than at
            them. The reference mockup capped the list at a fixed 176px, which
            this does not copy — a hard cap opens a hole between the last site
            and everything below it when there are only one or two.
            `max-height` lets the list be as tall as it has content for, and
            `mt-auto` on the section below sends the leftover to the foot of
            the rail instead.

            132 was the figure here before the bridge row
            (components/ScopeRail.tsx's bridgestate block) landed. That row
            needed 28px and the rail had 7 genuinely free — measured in the
            built popup, not read off the source; see
            docs/design/2026-08-12-agent-bridge-rail-budget.html for the
            arithmetic. Four other margins each gave up 1px (the readout
            card's and this section's own `mt-4`→`mt-3`, the types section's
            `pt-3`→`pt-2`, the bridge row's own `mt-2`→`mt-1`), closing 16 of
            the 21px shortfall; the list gave up the remaining 5, 132→127.

            **The rail now carries zero slack.** Every other margin in this
            card was already load-bearing rhythm, not spare space, so the next
            thing added to this rail does not have 7 (or 28) free px waiting
            for it — it reopens this exact accounting from a starting budget
            of 0, and adding it without shrinking this list further means
            finding room somewhere else in the rail on purpose, not by
            spending what is left here.

            The scrollbar is not assumed to be visible: on macOS it is an
            overlay that paints over the content and vanishes. `scroll-list`
            reserves its 8px anyway (see style.css for the measurement), so the
            rows do not shift the moment a fourth site arrives — but what says
            "there is more" is the cut row, which is there in every case.

            `empty:hidden` so a rail with no sites yet does not carry a 6px gap
            for a list with nothing in it. */}
        <div
          className="scroll-list flex max-h-[127px] flex-col gap-1.5 pr-1 pl-3 empty:hidden"
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
      </div>

      {notes.map((d, i) => (
        <div
          key={`${d.kind}-${i}`}
          data-testid="scope-note"
          data-severity={d.severity}
          className={`${NOTE_CLASS} ${
            d.severity === 'error'
              ? 'border-l-destructive'
              : // `incomplete` is not a complaint. Nothing is wrong and nothing
                // is at risk — the configuration simply is not finished yet,
                // which is the state a fresh install opens in. Amber is this
                // palette's "something needs you", and spending it on the one
                // note that is asking for nothing would rebuild the standing
                // warning this state replaces, in a different colour.
                d.severity === 'incomplete'
                ? 'border-l-muted-foreground'
                : 'border-l-pending'
          }`}
        >
          {d.message}
        </div>
      ))}

      {/* Last, and pushed to the foot by `mt-auto`: the leftover space in a
          rail with two sites belongs at the bottom of the column, not as a
          hole in the middle of it. Above the checklist rather than below is
          also where the scope notes go — every one of them is about the sites,
          and the checklist is the least-touched control on screen, so it is
          the one that can afford to be the thing you scroll past. */}
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
