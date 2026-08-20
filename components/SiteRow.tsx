import { useEffect, useRef } from 'react';
import { Ban, CircleCheck, CircleMinus, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
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
/**
 * How to fix an unusable entry, stated once.
 *
 * Two places say it — the invalid Badge's `title`, for a pointer that hovers,
 * and the row's accessible name below, for a reader that cannot see the Badge
 * at all. It is the second sentence of `filterDiagnostics`'s own
 * `invalid-domain` message, and it is repeated here rather than read from the
 * diagnostic because the diagnostic never reaches this row: `invalid-domain`
 * carries a `profileId` and no `host`, so `routeDiagnostics` files it under
 * `scope` — the bucket the popup stopped rendering when the notes went. The
 * duplication is deliberate and bounded; `filterDiagnostics.test.ts` pins the
 * message that owns the wording.
 */
const UNUSABLE_REMEDY = 'Use a bare hostname like example.com.';

/**
 * What each row state is called when it cannot be seen.
 *
 * `unusable` carries the remedy as well as the name, and that is the whole
 * accessibility budget for this state. The word "invalid" on screen is
 * `aria-hidden` (it only repeats what this label already says) and its
 * `title` reaches a pointer and nothing else — so without the remedy here, a
 * reader who cannot see the row would be told that something is wrong and
 * never told what to do about it. The rail-wide note this replaced said it in
 * rendered text that any reader could reach; losing that when the note went
 * would be the silent half of a fix.
 */
const STATE_LABEL = {
  granted: 'Access granted',
  pending: 'Awaiting permission',
  unusable: `Unusable site. ${UNUSABLE_REMEDY}`,
  idle: 'Not in use',
} as const;

type RowState = keyof typeof STATE_LABEL;

/**
 * What the row's second line says when it is not holding the Grant button.
 *
 * The line exists in every state — see the markup for why — so the question is
 * only what fills it. A blank band inside a card reads as a rendering fault,
 * and these two states each have something true to put there.
 *
 * `pending` and `unusable` are absent on purpose: a pending row's line is the
 * button, and an unusable row's line is the invalid Badge below — the owner's
 * ruling that the error lives on the row that holds the bad value, not in a
 * band above the list.
 */
const STATE_LINE: Record<Exclude<RowState, 'pending' | 'unusable'>, string> = {
  granted: 'Access granted',
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
 * — severity is said in the line itself, not only on the icon beside it.
 * `pending` and `unusable` are never *seen*: those lines hold the Grant
 * button and the invalid Badge. Both stay in the record so the template
 * below can index by any state without a branch that cannot render.
 */
const STATE_LINE_TONE: Record<RowState, string> = {
  granted: 'font-semibold text-live',
  pending: 'font-medium text-muted-foreground',
  unusable: 'font-semibold text-destructive',
  idle: 'font-medium text-muted-foreground',
} as const;

/**
 * The Grant button's shape, stated once because two rows render it — this
 * one and `ScopeRail`'s all-sites bar.
 *
 * "All-sites reaches the same state, so it must offer the same remedy rather
 * than a second vocabulary" (CLAUDE.md, No silent failures) — a pending site
 * and an on-but-ungranted all-sites mode are the same fact (waiting on the
 * same kind of permission), so both wear the same button: the standard shadcn
 * Button at the `xs` size, in the `pending` variant that carries the palette's
 * amber — this palette's "something needs you", the same tone the row's glyph
 * and the readout's clause already wear. A neutral button next to an amber
 * row asked the reader to do the colour maths; the remedy now wears the state
 * it answers. The `xs` size is 24px, which is why the second line reserves
 * `h-6` below: the line is sized to the tallest thing it can hold, and that
 * is this button.
 */
export const GRANT_BUTTON_PROPS = {
  variant: 'pending',
  size: 'xs',
} as const;

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
   *
   * **Gated on the button actually having been pressed, not on the wait
   * ending.** This asked "was this row awaiting a grant on the previous
   * render, and is it not now" — a fair reading of "the wait ended" while an
   * unprobed row rendered as granted. It stopped being one when unknown
   * access started rendering as *pending* (App.tsx, `knownGrants`): every
   * already-granted row now opens pending and resolves a moment later, which
   * that reading counted as a grant completing. The result was a popup that
   * stole focus to a site row on open and scrolled the list to it — reported
   * from the built extension, and visible in `pnpm screenshots` as a ring on
   * a row nobody had touched. Nothing should be focused when the popup opens;
   * this effect exists for the one keyboard user who just pressed Grant, and
   * now it can only fire for them.
   */
  const rowRef = useRef<HTMLDivElement>(null);
  const grantPressed = useRef(false);
  useEffect(() => {
    if (grantPressed.current && awaitingGrant === undefined) {
      grantPressed.current = false;
      rowRef.current?.focus();
    }
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
      className="flex h-[60px] items-center gap-1 rounded-lg bg-card pt-2 pr-1.5 pb-2 pl-2.5 shadow-sm"
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
        {/* The invalid mark, owner's ruling (2026-08-19): the error lives on
            the row that holds the bad value, in the slot a pending row offers
            its remedy — one word on the design system's destructive Badge,
            with the fix in the `title` for a pointer that asks. The rail-wide
            band this replaces listed every bad entry under one message; the
            row already knows which entry it is. `aria-hidden` because the
            icon on line 1 already carries the state as its accessible name —
            without that, the row would announce "Unusable site" and "invalid"
            back to back. That label carries the `title`'s remedy too, for the
            same reason: a `title` on an `aria-hidden` span is announced to
            nobody, so hiding the word without moving the sentence would have
            left a reader who cannot see this Badge with no way to reach it. */}
        <span className="flex h-6 items-center pl-5" data-testid="site-line">
          {awaitingGrant !== undefined && state !== 'unusable' && state !== 'idle' ? (
            <Button
              {...GRANT_BUTTON_PROPS}
              data-testid="site-pending"
              title={awaitingGrant.message}
              onClick={() => {
                // Armed here, read by the focus effect above: pressing this is
                // the only thing that earns the focus move.
                grantPressed.current = true;
                onGrant(awaitingGrant.host!);
              }}
            >
              Grant
            </Button>
          ) : state === 'unusable' ? (
            <Badge
              variant="destructive"
              data-testid="site-invalid"
              title={UNUSABLE_REMEDY}
              aria-hidden="true"
            >
              invalid
            </Badge>
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
          buttons one control rather than two.

          Armed has to be *seen*, not inferred: a 12px glyph changing ink is
          invisible at a glance, which is how a two-click guard reads as "the
          button is broken". The armed state paints the box — shadcn's own
          `destructive` fill tokens, `bg-destructive/10` — so the control
          visibly changes state while its geometry does not, and the title
          says what the second click does for a pointer that hovers. Same
          shape as the rule row's delete, one hook (useArmed). */}
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label={del.armed ? `Confirm removal of ${domain}` : `Remove ${domain}`}
        title={del.armed ? `Click again to remove ${domain}` : undefined}
        {...del.controlProps}
        className={
          del.armed
            ? 'bg-destructive/10 text-destructive hover:bg-destructive/10 hover:text-destructive'
            : 'text-muted-foreground'
        }
      >
        <Trash2 />
      </Button>
    </div>
  );
}
