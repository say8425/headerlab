import { useEffect, useRef } from 'react';
import { Ban, CircleCheck, CircleMinus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useArmed } from '@/lib/view/useArmed';
import type { Diagnostic } from '@/lib/model/types';

export interface SiteRowProps {
  /**
   * The value to show: the effective host, or the raw entry when nothing can be
   * made of it. `ScopeRail` resolves this; the row does not see what is stored.
   */
  domain: string;
  /**
   * Whether this domain can be used at all — `analyzeDomain(...).valid`, asked
   * of the one module that decides it rather than restated here.
   */
  usable: boolean;
  /**
   * All-sites is on, so this entry is stored but not compiled.
   *
   * It has to change what the row *says*, not merely how it looks. Access for
   * a host nothing is scoped to is neither granted nor pending — it is not
   * being asked, so the green dot would be claiming something no probe has
   * established.
   */
  inert: boolean;
  /** Whatever is wrong with this site's access, already matched to its host. */
  diagnostics: readonly Diagnostic[];
  onGrant: (host: string) => void;
  onRemove: () => void;
}

/**
 * A site, and its access state, as one object.
 *
 * Permission stops being a banner here. A domain and whether HeaderLab may act
 * on it are the same fact, so Grant happens on the row that named the domain —
 * you add `api.example.com`, that row goes amber and offers Grant, you press
 * it and the row goes green. The old build collected these into a band above
 * the grid, where two prompts and a filter warning pushed the actual work off
 * the screen.
 *
 * Grant takes the host from the diagnostic's own `host` field, never from its
 * message and never from `domain`: the message is copy and copy changes, and
 * `domain` may carry a port that no match pattern can express — the diagnostic
 * is the only party that already knows which host was probed.
 */
/** What each row state is called when it cannot be seen. */
const STATE_LABEL = {
  granted: 'Access granted',
  pending: 'Awaiting permission',
  unusable: 'Unusable site',
  idle: 'Not in use',
} as const;

type RowState = keyof typeof STATE_LABEL;

/**
 * What the row's second line says when it is not holding the Grant button.
 *
 * The line exists in every state — see the markup for why — so the question is
 * only what fills it. A blank band inside a card reads as a rendering fault,
 * and these three states each have something true to put there.
 *
 * `pending` is absent on purpose: that state's line is the button, and a word
 * for it would be a branch nothing can reach. A pending row with no grantable
 * host would fall through to an empty line, which is the honest rendering of
 * "waiting, with nothing to press".
 */
const STATE_LINE: Record<Exclude<RowState, 'pending'>, string> = {
  granted: 'Access granted',
  unusable: 'Cannot be used',
  idle: 'Not in use while All sites is on',
};

/** The glyph each row state wears, next to the hostname. */
const STATE_ICON = {
  granted: CircleCheck,
  pending: CircleMinus,
  unusable: Ban,
  idle: CircleMinus,
} as const;

/** The icon's colour, one token per state. */
const STATE_TONE = {
  granted: 'text-live',
  pending: 'text-pending',
  unusable: 'text-destructive',
  idle: 'text-muted-foreground',
} as const;

/**
 * The second line's colour and weight, mirroring the mockup's `.te-l2--live`
 * / `.te-l2--err` — severity is said in the line itself, not only on the icon
 * beside it. `pending` is never seen: that state's line holds the Grant
 * button, or nothing (see `STATE_LINE`), never this span's text.
 */
const STATE_LINE_TONE: Record<RowState, string> = {
  granted: 'font-semibold text-live',
  pending: 'font-medium text-muted-foreground',
  unusable: 'font-semibold text-destructive',
  idle: 'font-medium text-muted-foreground',
} as const;

/**
 * The Grant button's classes, exported so `ScopeRail`'s all-sites bar can use
 * the exact same ones for its own Grant button.
 *
 * "All-sites reaches the same state, so it must offer the same remedy rather
 * than a second vocabulary" (CLAUDE.md, No silent failures) — a pending site
 * and an on-but-ungranted all-sites mode are the same fact (waiting on the
 * same kind of permission), so one class string shared by both call sites is
 * what makes that promise hold by construction instead of by two people
 * remembering to keep two copies in sync.
 *
 * `hover:bg-pending-bg` is not decorative: shadcn's `secondary` variant ships
 * `hover:bg-tray/80`, and `bg-pending-bg` above only overrides the base
 * (unprefixed) utility — `twMerge` treats a `hover:`-prefixed class as a
 * different group, so without this the button's fill would flash grey on
 * hover. Verified in the built CSS.
 */
export const GRANT_BUTTON_CLASS =
  'h-5 rounded-[4px] bg-pending-bg text-pending hover:bg-pending-bg';

export function SiteRow({ domain, usable, inert, diagnostics, onGrant, onRemove }: SiteRowProps) {
  /**
   * One symbol, one meaning.
   *
   * A domain that cannot be used used to render the same green dot as one that
   * is granted and working, while the explanation sat in a paragraph somewhere
   * else — so the object holding the bad value was the one object on screen
   * not admitting to it. That is the opposite of what this layout is for: a
   * domain and its state are the same thing here, so the state belongs on the
   * row.
   */
  /**
   * Unusable outranks inert. An entry that cannot be used is still wrong while
   * all-sites is on — it is simply not doing any harm *yet*, and it is what
   * will suppress every rule the moment the switch goes back off. Hiding that
   * until then would spring the failure on the user at the exact moment they
   * narrowed their scope and expected it to start working.
   */
  const state: RowState = !usable
    ? 'unusable'
    : inert
      ? 'idle'
      : diagnostics.length > 0
        ? 'pending'
        : 'granted';

  /**
   * The permission this row is waiting on, if any.
   *
   * There is no "everything else" branch beside this one. `permission-missing`
   * is the only `DiagnosticKind` that ever sets `host`, so `byHost` cannot
   * contain anything else, and `auditDiagnostics` emits at most one per host —
   * a sibling branch for the other cases was code no user could reach, and a
   * contrast pair and three tests were describing it. An unusable site is still
   * explained in words; that message has no `host`, so it reaches the screen as
   * a scope note in the rail.
   */
  const awaitingGrant = diagnostics.find(
    (d) => d.kind === 'permission-missing' && d.host !== undefined,
  );

  /**
   * Focus retention across the Grant button's disappearance.
   *
   * The button is the row's only focusable control, and success unmounts it
   * (the diagnostic clears, the state line takes its place), which drops the
   * focus to `<body>` — the next Tab starts over from the top of the rail,
   * and a screen reader reads nothing about the state that just changed. So
   * when the wait ends, the focus moves to the row itself: reading its name
   * and state line *is* the confirmation, and the status region says the
   * rest (App.tsx owns that message).
   *
   * The row, never the Remove button — focus placed on a control is an
   * invitation to press it, and the Enter that follows a confirmed grant
   * must not delete the site it was granted for. `tabIndex={-1}` keeps this
   * programmatic slot out of the tab order entirely.
   */
  const rowRef = useRef<HTMLDivElement>(null);
  const wasAwaitingGrant = useRef(false);
  useEffect(() => {
    if (wasAwaitingGrant.current && awaitingGrant === undefined) rowRef.current?.focus();
    wasAwaitingGrant.current = awaitingGrant !== undefined;
  }, [awaitingGrant]);

  // The other destructive control in the popup, wearing the same two-click
  // guard the rule row's delete does — one hook, one reasoning
  // (lib/view/useArmed.ts).
  const del = useArmed(onRemove);

  const Icon = STATE_ICON[state];

  return (
    <div
      ref={rowRef}
      tabIndex={-1}
      className="flex h-12 items-center gap-1 rounded-lg bg-card pt-1 pr-1.5 pb-1 pl-2.5 shadow-sm"
      data-testid="site"
      data-state={state}
    >
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex h-4 items-center gap-1.5">
          {/* Was `aria-hidden`, which left a granted row and an unusable row
              with identical accessible names — the colour was the only thing
              telling them apart. Lives on line 1, unconditionally: it is the
              one element every state renders, which the second line no longer
              is on its own (a pending row's line holds the Grant button, not
              a sentence), so the accessible name has to sit somewhere that
              never goes away. */}
          <Icon
            className={`size-3.5 shrink-0 ${STATE_TONE[state]}`}
            role="img"
            aria-label={STATE_LABEL[state]}
          />
          <span
            className="min-w-0 flex-1 truncate font-mono text-[12px] leading-4 font-semibold text-foreground"
            title={domain}
          >
            {domain}
          </span>
        </div>

        {/* The row's second line, present in **every** state and always the
            same height.

            It used to render only when a permission was pending, which made
            the Grant button's arrival add 30.5px to the row — pushing the
            sites under it, the add field and the whole rail below down by
            that much, at the moment the user was reading the row that had
            just changed. A control appearing must not resize what holds it
            (CLAUDE.md, Interface), so the line is sized to the tallest thing
            it can hold, which is the button, and the other states occupy
            that space rather than removing it.

            It is not reserved by rendering a hidden button. An invisible
            control is still in the accessibility tree and still lands in the
            tab order, which would put an unpressable Grant between the
            remove control of one row and the host of the next. The space is
            reserved; the control is not.

            The words are `aria-hidden` because the icon on line 1 already
            carries the same fact as its accessible name — without that,
            every row would announce its state twice. `pl-5` lines the text
            up under the hostname rather than under that icon, since the icon
            has no counterpart on this line.

          A pending permission is state and remedy, and nothing else. The
          sentence this replaces spent four lines telling a developer what a
          Grant button beside a hostname already says; two of them filled the
          rail. A `?` explaining the button went the same way for the same
          reason — a help mark on every pending row is a repeated affordance
          for something nobody was confused by.

          Never on an unusable row: granting a host that cannot be used
          changes nothing, so the button would be an action that looks like
          the remedy and is not.

          What the row does not say in pixels it says in the button's
          `title`: the diagnostic's own message, which `audit.ts` composes
          for exactly this state and which nothing rendered at all before —
          the one sentence explaining "registered but not applying" was
          computed and dropped. A `title` is the zero-pixel path: the second
          line stays empty as decided above, and a pointer that hovers gets
          the whole explanation. */}
        <span className="flex h-5 items-center pl-5" data-testid="site-line">
          {awaitingGrant !== undefined && state !== 'unusable' && state !== 'idle' ? (
            <Button
              size="xs"
              variant="secondary"
              data-testid="site-pending"
              className={GRANT_BUTTON_CLASS}
              title={awaitingGrant.message}
              onClick={() => onGrant(awaitingGrant.host!)}
            >
              Grant
            </Button>
          ) : (
            <span
              className={`text-[11px] leading-[14px] ${STATE_LINE_TONE[state]}`}
              aria-hidden="true"
            >
              {state === 'pending' ? '' : STATE_LINE[state]}
            </span>
          )}
        </span>
      </div>

      {/* `variant="ghost"` sets no text colour of its own, so without this the
          Trash2 inherits the row's full-strength ink — the loudest colour in
          the row, on its destructive control, while the identical button on a
          rule row already wears `--muted-foreground`. The mockup's `.te-icb`
          is `--ink-3`; this is that, and it is what makes the two delete
          buttons one control rather than two. Armed, it borrows
          `text-destructive` and says so in its name, exactly as the rule
          row's delete does — same box, same position, second click. */}
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label={del.armed ? `Confirm removal of ${domain}` : `Remove ${domain}`}
        {...del.controlProps}
        className={del.armed ? 'text-destructive' : 'text-muted-foreground'}
      >
        <Trash2 />
      </Button>
    </div>
  );
}
