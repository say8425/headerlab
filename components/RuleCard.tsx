import { ArrowDown, ArrowUp, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { rowError } from '@/lib/compile/validate';
import { useArmed } from '@/lib/view/useArmed';
import { useCommittedDraft } from '@/lib/view/useCommittedDraft';
import type { Diagnostic, HeaderRule, HeaderTarget, Operation } from '@/lib/model/types';

const OP_NEXT: Record<Operation, Operation> = { set: 'append', append: 'remove', remove: 'set' };
const TARGET_NEXT: Record<HeaderTarget, HeaderTarget> = {
  request: 'response',
  response: 'request',
};
/** Short enough to be a pill, and the word every HTTP tool already uses. */
const TARGET_LABEL: Record<HeaderTarget, string> = { request: 'REQ', response: 'RES' };
const TARGET_ICON = { request: ArrowUp, response: ArrowDown } as const;
const TARGET_TONE: Record<HeaderTarget, string> = {
  request: 'bg-req-bg text-req',
  response: 'bg-res-bg text-res',
};

export interface RuleCardProps {
  rule: HeaderRule;
  diagnostics: readonly Diagnostic[];
  onPatch: (patch: Partial<HeaderRule>) => void;
  onDelete: () => void;
  /** True for the single starter rule a fresh install opens on. */
  autoFocus?: boolean;
}

/**
 * One rule, one row.
 *
 * This is where "one line, four button languages" lived: direction was a
 * pill, `set`/`remove` was a bordered box, delete was a bare `×`, and the
 * switch was a fourth shape again. Now there is one family — a real Switch,
 * a direction Badge fused to an operation chip cut from the exact same
 * cloth (same size, the same 4px corner radius, the badge's sibling rather
 * than a fourth shape of its own — their fills differ on purpose, see the
 * chip's own comment below), and a ghost icon Button for delete. "Same
 * radius" is no longer one wrapper rounding both — each half now owns the
 * single outer corner that used to belong to it (see the gutter comment
 * below for why), so it is two 4px radii in the same position, not one.
 *
 * The gutter reads top-to-bottom as *what this rule does* — direction, then
 * operation, one glued block with a straight seam rather than a gap between
 * its two halves (owner decision: variant C of four 1:1 renders, picked
 * knowing the risk a fused shape carries — two buttons that change two
 * different fields can read as one; the `hover:brightness-110` on each half
 * is what keeps that discoverable) — and the right-hand column reads as
 * *what it is about* — name, then value, the value now alone on its own
 * line and free to use the column's full width. Name is sans, value is
 * monospace — provenance, not rank, decides the typeface
 * (docs/design/2026-08-07-popup-tight-instrument.html). A `remove` rule has
 * no value, and its line says what the row will actually do — `"X-Trace"
 * will be removed` — rather than describing the empty field it doesn't
 * render.
 *
 * The row's height follows its value: the value wraps and grows rather than
 * truncating, the same bargain the pre-mockup design struck — a value with
 * an ellipsis in a 246px cell was the first thing the owner named about the
 * layout before that one, and a single-line, truncating field (this task's
 * first attempt, reverted) walks straight back into the same complaint with
 * `title` standing in for the ellipsis. A static mockup image never has to
 * hold a real JWT or a long CSP value, so it cannot settle this; the owner
 * did, choosing readability over the mockup's fixed-row density.
 *
 * What must still hold, and does by construction rather than by convention:
 * a *given* rule's row must not change height when it is toggled on or off,
 * or when a problem appears on it — that is state changing geometry, which
 * this repo cares about most. Toggling only ever changes colour/weight on
 * fixed-metric elements (never the text content, never what wraps where).
 *
 * A diagnostic used to guarantee this by rendering as a sibling block below
 * the row (Tasks 7–12) — outside the row's own box, so it plainly couldn't
 * resize it. Task 13 found the same box could be pushed 48.8px anyway: the
 * block itself has height, and a sibling gaining height still shoves every
 * *following* row's box down by exactly that much, which is the CLAUDE.md
 * violation ("a control appearing must not resize what holds it… applies to
 * any element whose presence is state-dependent") a sibling shape cannot
 * avoid no matter how it is styled.
 *
 * "Give it a slot that already has a size" was the right diagnosis and
 * Task 13's own first attempt at it was still wrong, in the *other*
 * direction: line 2's slot is not fixed-size at all when it holds a value —
 * it wraps and grows with the value's own length (`[field-sizing:content]`,
 * below), which is the "different heights" a re-review had to point at
 * directly, because the first attempt swapped in a single-line error
 * message and shrank a wrapped, multi-line row out from under whatever the
 * user was reading. Replacing content inside a box only holds this
 * invariant when the box's size does not depend on which content is there
 * — true of a `remove` rule's one-line sentence (an `error` message swaps
 * for it below at no cost, both are always one line), false of a value
 * that can be four lines tall.
 *
 * The value case instead follows CLAUDE.md's Interface section literally:
 * "reserve the space instead: size the container to its largest state and
 * let the element occupy or vacate it." The textarea that holds the value
 * keeps rendering — and therefore keeps sizing the box — whether or not an
 * `error` diagnostic exists; only its content is hidden (`invisible`, inert)
 * and an absolutely-positioned message painted over it when there is one to
 * show. The box is exactly as tall as the value would make it either way; a
 * `warning`-severity diagnostic (`profile-conflict` — the row *is* sent, so
 * hiding its value would be showing less than the truth) adds a small
 * fixed-size marker beside the header name instead, with the full message
 * in its `title`/`aria-label`, touching line 2 not at all. Different
 * *rules* can be different heights; a single rule's height is never a
 * function of its own on/off/problem state — held now by reserving the
 * largest box rather than by assuming every possible line 2 is the same
 * size, which is what broke it the first time.
 */
export function RuleCard({ rule, diagnostics, onPatch, onDelete, autoFocus }: RuleCardProps) {
  const name = useCommittedDraft(rule.name, (next) => onPatch({ name: next }));
  const value = useCommittedDraft(rule.value, (next) => onPatch({ value: next }));
  // Two clicks for the one write here that nothing can undo — the reasoning
  // lives in the hook's own docblock, stated once for both delete buttons.
  const del = useArmed(onDelete);
  const removes = rule.operation === 'remove';
  // The stored name, not `name.draft` — the remove-value sentence is a
  // static readout of what is actually saved, not of what is mid-edit in
  // the name field beside it.
  const removeName = rule.name.trim();
  const DirIcon = TARGET_ICON[rule.target];

  /**
   * An unfinished rule shows no problem at all, in either slot.
   *
   * Pressing "New rule" used to produce a red "Header name is empty." on a row
   * created one click ago — the product manufacturing an invalid object and
   * then telling the user off for it. The row is already self-evidently
   * unfinished: its name field is empty and showing its placeholder, which is
   * both the marker and the thing to do about it. Repeating that in red
   * adds nothing but alarm.
   *
   * Not hidden, though. The state is counted and named in the rail's readout,
   * so it is still said out loud — going quiet everywhere would trade this
   * defect for the silent failure the product exists to remove.
   *
   * Filtered on `severity`, so a future kind that is also "not finished" is
   * covered without editing this line.
   */
  const problems = diagnostics.filter((d) => d.severity !== 'incomplete');
  const unfinished = diagnostics.length !== problems.length;

  /**
   * The two consequences a row diagnostic can have, and why they get
   * different treatment (Task 13).
   *
   * `error` means `hasRowError` has already excluded this row from
   * `compileHeaders` — nothing is sent for it, so showing its stored value
   * would show a value that is not in effect. It takes line 2 outright,
   * ahead of even a `remove` rule's own sentence: what stops a row from
   * running is a more urgent fact than what the row would do if it ran.
   * `rowError` — not a local `.find((d) => d.severity === 'error')` — so
   * this asks the one place "what counts as dropped" is decided
   * (`lib/compile/validate.ts`) rather than restating that test a second
   * time where it could quietly drift from it. At most one is ever shown,
   * because `rowError` itself only ever returns the first.
   *
   * `warning` means the opposite: the row *is* live (`profile-conflict` is
   * the only kind today), so its value is real and hiding it would be
   * showing the user less than the truth. It earns a marker beside the
   * header name instead of touching line 2 at all — `.filter`, not
   * `.find`, because nothing here caps a row at one warning the way
   * `rowError` caps it at one error.
   */
  const errorDiag = rowError(problems);
  const warningDiags = problems.filter((d) => d.severity === 'warning');

  return (
    // No longer a Fragment wrapping a sibling — Task 13 moved the last thing
    // that sat beside this row (the diagnostic block) inside it, so this is
    // now the component's one and only returned element.
    <div
      className="group/rule mb-px flex items-start gap-2.5 bg-card py-2 pr-2 pl-3 data-[off]:bg-rowoff"
      data-testid="rule"
      data-off={!rule.enabled || undefined}
      data-unfinished={unfinished || undefined}
    >
      <Switch
        aria-label={`${rule.name || 'Unnamed'} enabled`}
        checked={rule.enabled}
        onCheckedChange={(checked) => onPatch({ enabled: checked })}
        /* shadcn's default checked track is `--primary` (ink) — this is a
             live/on state, so it wears the same green every other "on"
             indicator in the popup does (the rail's own switch, the
             readout's live dot), not the neutral ink token. Unchecked is
             left alone: shadcn's own `bg-input` already is the mockup's
             `--off` mapping.

             The thumb has the same defect one level down: `switch.tsx`
             hardcodes `dark:data-checked:bg-primary-foreground` on its own
             child, which is near-black in the dark palette — a dark knob on
             a green track, next to the rail's own switch (still-deleted
             `.hl-sw`, always a plain white knob). `Switch` forwards no prop
             for the thumb's own class, but an arbitrary descendant variant
             on the root reaches it without touching the shared component:
             `[data-slot=switch-thumb]` is more specific than the thumb's own
             two-class rule (measured: an attribute selector plus `:is(.dark
             *)` outweighs it), so it wins regardless of source order.
             Hardcoded white, not a token — the old `.hl-tog`/`.hl-sw` knobs
             were `#fff` outright too, and the mockup's `.te-sw i` never
             varies by theme; a switch knob reads as a physical part, not
             themed ink. */
        className="data-checked:bg-live [&_[data-slot=switch-thumb]]:dark:bg-white"
      />

      {/* The gutter: direction fused to operation, one rounded block.
            Owner-picked variant C of four 1:1 renders — the fused shape I
            flagged a concern about when I first drew it: these are two
            buttons that change two different fields, and a single glued
            block reads as one control that would flip both on one click.
            Built anyway (the owner's call, made knowing the concern), with
            the two-button nature discoverable by all three routes: the
            `hover:brightness-95` on each half darkens only the half under
            the cursor, the two `aria-label`s stay unmerged, and each half
            takes focus separately with its own visible ring.

            The hover used to *lighten* (`brightness-110`), and that inverted
            on the light palette: `--tray` and the badge tints are near-white
            fills, and brightening them clamps at #ffffff — exactly the
            card's own colour in light, so the hovered half melted into the
            row instead of standing apart from it. This gutter's whole
            discoverability argument is that hover tells you which half you
            are on; a device that erases the half it should be naming is
            worse than none. Darkening moves away from the card in both
            palettes — light's tray drops below the white card, dark's tray
            is already darker than its card and drops further — so the one
            device reads correctly everywhere.

            **Each half owns its own outer corner** — `rounded-t-[4px]` on
            the direction, `rounded-b-[4px]` on the operation, `rounded-none`
            on the two edges that meet — rather than the wrapper rounding
            them together behind an `overflow-hidden`. The look is identical
            (one block, straight seam, 4px outer corners, and `gap-0.5` from
            the previous round still gone) and the clip is what had to go:
            a focus ring is drawn *outside* the border box, each half is
            exactly as wide as the wrapper was, so the wrapper clipped the
            ring away on every side. Measured before the change, with a real
            Tab press: focusing the direction half rendered **nothing at
            all**, and the operation half rendered one 3px bar at the seam
            that read as a divider — WCAG 2.4.7 failed by a shape that was
            only ever meant to be decorative.

            Do not reintroduce `overflow-hidden` here to "keep the corners
            tidy". Earlier measurements of this ring disagreed with each
            other — a real Tab press read 3px at offset 0, a programmatic
            `.focus()` read narrower widths at a positive offset — and an
            earlier round of this comment called that an open question about
            which of two CSS rules was supplying the ring. It is not two
            rules. `badgeVariants` (`components/ui/badge.tsx`) carries
            `transition-all`, and `outline-width`, `outline-offset` and
            `outline-color` are all animatable — so a reading taken on the
            first frame after focus catches the *transition's start values*,
            not style.css's `:focus-visible` rule (2px solid `var(--ring)`,
            offset 1px), which is what every reading settles to ~150ms later
            regardless of how focus arrived. Confirmed three ways: waiting
            out the transition on a real Tab press converges on 2px/offset
            1px; injecting `transition:none` gives 2px/offset 1px from frame
            one; and the colour at frame one is each half's own text colour
            (the direction badge's tint, the operation chip's
            `--muted-foreground`) rather than `--ring` — only explained by
            `outline-color`'s initial value, `currentColor`, being what a
            transition starts from before it animates toward the rule that
            actually applies.

            What stays true regardless: **the offset is never negative** at
            either end of that transition (0 at the start, 1px once
            settled), so the ring always paints at or outside the border
            box, and any clip on an ancestor the width of the halves erases
            it whichever moment it is read. That is what this fix rests on,
            and it never depended on which rule was supplying the ring.

            One thing that really was tried and failed: setting
            `outline-offset` to a negative value, `-3px`, on each half via a
            Tailwind arbitrary-value utility. It compiled into the bundle
            and landed on the element, and the computed offset still read
            `0px` — style.css's `:focus-visible` block is unlayered, and an
            unlayered rule wins over a layered Tailwind utility for the same
            property regardless of specificity. (That failed utility is
            deliberately not spelled out here as one token — writing
            "outline-offset" immediately followed by its bracketed value in
            prose is indistinguishable from using it to Tailwind's content
            scanner, which does not parse comments, and emits the rule into
            the bundle for a class nothing renders — the same mechanism
            found in an earlier task.) */}
      <div className="flex w-12 shrink-0 flex-col">
        <Badge
          asChild
          className={`h-[18px] w-12 shrink-0 justify-center gap-[3px] rounded-t-[4px] rounded-b-none border-0 px-0 py-0 text-[11px] font-semibold tracking-[0.01em] hover:brightness-95 ${TARGET_TONE[rule.target]}`}
        >
          <button
            type="button"
            aria-label={`Direction: ${rule.target}`}
            onClick={() => onPatch({ target: TARGET_NEXT[rule.target] })}
          >
            <DirIcon aria-hidden="true" />
            {TARGET_LABEL[rule.target]}
          </button>
        </Badge>

        {/* No icon (unlike the direction badge above it), so this stays a
              true leaf node — text only, no child element — which is what
              keeps it counted by the crowding e2e guard's leaf-based
              clipping check the same way it was counted as the old op
              button.

              Typography now matches the badge exactly rather than only in
              size: `font-semibold tracking-[0.01em]`, the same 600 weight
              and 0.11px letter-spacing REQ/RES wears (measured — the two
              were already both 11px; weight and tracking were the actual
              gap, and are what read as a size difference). Never repainted
              by `rule.operation` or by `data-off` — what it shares with the
              badge above it is narrower than "same fill logic": both are
              opaque token pairs, never repainted by the *row's* state, so
              the text stays `--muted-foreground` on `--tray` whether the
              rule is on or off. The badge *does* still repaint by its own
              value (`TARGET_TONE`, blue REQ / purple RES); the chip
              deliberately does not, because three operations is a cycler
              rather than a two-state direction, and tinting each would
              spend colour marking a distinction the word
              "set"/"append"/"remove" already makes on its own — measured
              across all three operations and both `data-off` states: font
              size, weight, tracking and box size are identical in every
              one; only the glyph count (3 vs 6 characters in a fixed 48px
              box) differs, which is not a font change. */}
        <Badge
          asChild
          className="h-[18px] w-12 shrink-0 justify-center rounded-t-none rounded-b-[4px] border-0 bg-tray px-0 py-0 text-[11px] font-semibold tracking-[0.01em] text-muted-foreground hover:brightness-95"
        >
          <button
            type="button"
            aria-label={`Operation: ${rule.operation}`}
            onClick={() => onPatch({ operation: OP_NEXT[rule.operation] })}
          >
            {rule.operation}
          </button>
        </Badge>
      </div>

      {/* `self-stretch` overrides the row's own `items-start` for just this
            child, so its box is exactly as tall as the gutter (36px, two
            18px badges with no gap between them). It used to matter that
            this is taller than the column's own content (18px name + 2px
            gap + 14px value = 34px, 2px of dead space below the value,
            measured, and the reason the value read as pushed toward the
            top) — the owner's later request to unify name and value onto
            one 12px/18px type scale and drop the inter-line margin closed
            that gap for a single-line value: 18px name + 0 + 18px value is
            36px, exactly the gutter's own height, so there is no dead space
            left for `justify-between` to spend. It is kept anyway rather
            than swapped for `justify-center` or dropped outright, because a
            *wrapping* value's content can still exceed 36px, and
            `justify-between` is what keeps name pinned to the very top of
            the box in that case too — the one thing the row's `items-start`
            exists to guarantee, name's first line sitting on the same axis
            as the badge above it. `justify-center` was tried and rejected
            for the same reason before the type unification and the
            reasoning did not change: centering would still move name's own
            top edge by half of whatever slack exists. */}
      <div className="flex min-w-0 flex-1 flex-col justify-between self-stretch">
        {/* Line 1: name, and — since Task 13 — the warning marker beside
              it when one applies. `flex items-center` regardless of whether
              a marker is actually rendered, so the name Input's own box
              never moves between the two states; only `flex-1` replaces
              `w-full` to make room for a marker that may or may not be
              there, which costs nothing when it isn't (a lone `flex-1`
              child fills its row exactly as `w-full` did).
              display:block, not flex, *inside* the Input itself — a flex
              child truncates by hard-clipping instead of marking the
              truncation with an ellipsis (see the mockup's own comment on
              .te-name). */}
        <div className="flex min-w-0 items-center gap-1">
          <Input
            aria-label="Header name"
            className="h-[18px] min-w-0 flex-1 truncate rounded-none border-0 bg-transparent p-0 text-[12px] leading-[18px] font-semibold text-foreground shadow-none outline-none placeholder:text-[12px] placeholder:font-medium placeholder:text-muted-foreground focus-visible:ring-0 group-data-off/rule:font-medium group-data-off/rule:text-foreground-2 dark:bg-transparent"
            placeholder="header-name"
            autoFocus={autoFocus}
            value={name.draft}
            onChange={(e) => name.setDraft(e.target.value)}
            onBlur={name.commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') name.commit();
              if (e.key === 'Escape') name.cancel();
            }}
          />

          {/* The warning marker. Reuses the exact circle-and-glyph pair
                the old below-the-row block wore for its "!" icon
                (`bg-pending`/`--pending` fill, `text-pending-bg` glyph) —
                Task 13 relocated it rather than inventing a new one, per
                CLAUDE.md's "one predicate, one definition" spirit applied
                to colour: the same severity should look the same wherever
                it appears. `title` for a mouse hover, `aria-label` so the
                message still reaches a screen reader without one — `title`
                alone is not reliably exposed as an accessible name. Not
                `aria-hidden`: unlike the direction/operation badges, this
                is the *only* place the warning's text exists on screen, so
                hiding it from the accessibility tree would be the exact
                silent failure this popup exists to not have. Not
                focusable — it is supplementary to the name field beside
                it, not a control of its own, so it does not enter the tab
                sequence (see `RuleCard tab order` in the test file: this
                must never appear in that list). */}
          {warningDiags.length > 0 && (
            <span
              data-testid="rule-warning"
              title={warningDiags.map((d) => d.message).join(' ')}
              aria-label={warningDiags.map((d) => d.message).join(' ')}
              className="flex size-3.5 shrink-0 items-center justify-center rounded-full bg-pending text-[9px] font-bold text-pending-bg"
            >
              !
            </span>
          )}
        </div>

        {/* Line 2 is the value alone now — operation moved into the
              gutter above — so it takes the column's full width instead of
              splitting it with a 44px op cycler.

              Three things can occupy it, in priority order (Task 13) — but
              "never a fourth shape that would need its own height" turned
              out to be false the first time it met a *wrapping* value.
              This box's height is not fixed; `[field-sizing:content]` below
              makes it exactly as tall as the stored value's own wrapped
              text (that is the owner's ruling this docblock names above —
              a value wraps and grows). Swapping a tall, wrapped textarea
              for a single `truncate` line the moment `errorDiag` becomes
              true does not swap content inside a fixed box; it *changes
              the box*, by up to `max-h-24`'s full 96px, dragging every row
              below this one up or down with it — a real regression a
              re-review measured (92px → 52px on the row itself) and this
              file shipped, because its own e2e guard's fixture happened to
              seed a one-character value that could never expose it.
              `relative` on this container plus `absolute inset-0` on the
              message below is the fix CLAUDE.md's Interface section
              already names for this exact shape of problem — "reserve the
              space instead: size the container to its largest state and
              let the element occupy or vacate it" — applied literally: the
              textarea keeps rendering (and therefore keeps sizing the box)
              whether or not an error is showing, and only the *message*
              swaps in over it, `remove`'s sentence excepted below, which
              needs none of this because it is single-line either way. */}
        <div className="relative flex min-w-0 items-start">
          {removes ? (
            errorDiag ? (
              // Error still wins over the remove sentence — both are one
              // `truncate` line regardless, so swapping between them here
              // never changes this box's height the way the value case
              // below could. `rule-problem`'s home for a `remove` row: the
              // testid survives, its subject moved from a block below the
              // row into this slot, in place of the sentence it replaces.
              //
              // `text-destructive` on the row's own fill (`--card`, or
              // `--rowoff` when off) rather than a coloured block: there
              // is no block left to paint. Only the `--card` pairing has a
              // contrast guard — `--rowoff` doesn't, deliberately: every
              // row-diagnostic source in this codebase (`validateHeaders`,
              // `detectConflicts`) skips a disabled rule before it ever
              // computes one, so an error message on an off row is not a
              // state this popup can reach, not merely one this file
              // forgot to check.
              <span
                data-testid="rule-problem"
                data-severity="error"
                title={errorDiag.message}
                className="min-w-0 flex-1 truncate cursor-not-allowed text-[12px] leading-[18px] font-medium text-destructive"
              >
                {errorDiag.message}
              </span>
            ) : removeName === '' ? (
              // Unfinished, not wrong — same reasoning as the problem
              // block above never accusing a one-click-old row (see this
              // file's own docblock on `unfinished`). The quoted-name
              // sentence needs a real name to quote; rather than print
              // empty quotes ("" will be removed, which reads as a typo
              // or a bug), the sentence drops the name clause entirely
              // and says what is still true without it.
              <span
                className="min-w-0 flex-1 truncate cursor-not-allowed text-[12px] leading-[18px] font-medium text-muted-foreground"
                data-testid="rule-value"
              >
                This header will be removed once it&apos;s named.
              </span>
            ) : (
              // Says what the row will do, not that it has nothing to
              // show — the previous "remove takes no value" described the
              // field, not the effect. The header name is mono (the one
              // piece of this sentence the user actually typed — the
              // global rule) and, unlike the rest of the fixed sentence,
              // unbounded in length (no cap in lib/model/schema.ts), so it
              // is the part that gives way: `min-w-0 truncate` plus
              // `title` on its own span, mirroring AddSiteField.tsx's
              // "already in the list" note — the same shape of problem
              // (a bounded row holding one unbounded value beside fixed
              // words) gets the same fix. The fixed suffix is `shrink-0
              // whitespace-nowrap` so it is never itself the thing that
              // clips. `gap-1`, not a text-node space, between them —
              // flex blockifies both children, and a blockified box's own
              // leading/trailing white space collapses to nothing at
              // render (measured in AddSiteField's own history; jsdom's
              // `textContent` would not have shown the difference).
              //
              // `cursor-not-allowed` is the disabled signal, not
              // `disabled:opacity-50` as suggested — that pseudo-class
              // only matches a real form control, this is a `<span>`, and
              // fading `--muted-foreground` toward the background instead
              // (an unconditional `opacity-50`) measures at 2.1–2.5:1 in
              // this palette, under the 4.5 floor every other piece of
              // text in this popup clears — exactly the failure mode this
              // redesign's whole contrast section exists to keep out.
              // `cursor-not-allowed` is real vocabulary from the same
              // shadcn disabled state (`components/ui/input.tsx`) that
              // costs no contrast.
              <span
                /* One typeface for the whole sentence, not a mixed line.
                   The half-pixel this removes was real: with the header name
                   in monospace and "will be removed" in sans, `items-baseline`
                   had to reconcile two fonts whose baselines sit at different
                   heights inside identical 18px line boxes, and the flex line
                   resolved to 18.5px — making the `remove` row 52.5px against
                   every other row's 52px. Pinning the height would have hidden
                   that; one font removes the cause, and the line is 18px
                   because the metrics agree rather than because a literal says
                   so.

                   Owner's call that the shared font is monospace. Note it
                   reads against this repo's own typography rule — monospace is
                   for values the user types, and a header *name* is sans
                   everywhere else, including the field two lines above showing
                   this same string. Flipping the family on this one element
                   reverses it if that trade stops being worth it. */
                className="flex min-w-0 flex-1 cursor-not-allowed items-baseline gap-1 font-mono text-[12px] leading-[18px] font-medium text-muted-foreground"
                data-testid="rule-value"
              >
                <span className="min-w-0 truncate" title={removeName}>
                  &quot;{removeName}&quot;
                </span>
                <span className="shrink-0 whitespace-nowrap">will be removed</span>
              </span>
            )
          ) : (
            <>
              {/* Always rendered, error or not — this is the fix. When
                  `errorDiag` is set it renders `invisible` (keeps its
                  layout box, paints nothing) and `pointer-events-none`,
                  `readOnly` and `tabIndex={-1}` (unreachable by mouse or
                  keyboard) — inert, not deleted, so it goes on being the
                  thing that sizes this box exactly as it did before an
                  error existed. `data-testid="rule-value"` moves with the
                  same condition: this element is not the value field in
                  any sense that testid means while it is invisible, so a
                  test asking whether the value field is present must still
                  get `null`, same contract as before. */}
              <textarea
                aria-label="Header value"
                data-testid={errorDiag ? undefined : 'rule-value'}
                aria-hidden={errorDiag ? true : undefined}
                tabIndex={errorDiag ? -1 : undefined}
                readOnly={errorDiag !== undefined}
                rows={1}
                /* `max-h-24` restored from the pre-mockup field (69bf230) —
                     the owner's ruling was "값이 감싸지게(예전 방식)", the
                     previous way, which capped growth and let a very long
                     value scroll inside itself rather than growing without
                     bound. Dropping the cap was found in review: a realistic
                     536-character value made one row 232.5px tall, 42% of the
                     popup's own height. `max-h-24` (96px) is `.hl-hval`'s old
                     value.

                     The old field's `min-height: 30px` did NOT come back with
                     it. That number served the old field's padded, bordered,
                     12px box — this one has neither, so a floor buys nothing
                     an empty single line doesn't already have (still a real,
                     ~250px-wide click target via `min-w-0 flex-1`) and costs
                     real, visible space on every short row: measured 51.5px
                     → 66.5px with it, on rows that are most of the list, in
                     the direction opposite the density the owner chose this
                     whole redesign for. Found in review, corrected the same
                     round.

                     Once a value is long enough to hit the cap, the textarea
                     becomes a genuine scroll container of its own —
                     `scrollHeight > clientHeight` — which is exactly what the
                     crowding e2e guard's second assertion
                     (`header-modification.spec.ts`, `expect(scrollers)...`)
                     enumerates by walking every `overflow-y: auto`/`scroll`
                     node. Today's fixtures only seed short values, so this
                     never fires there, but Task 8/9 — which owns that
                     assertion — should know the reason going in rather than
                     find the symptom.

                     `[overscroll-behavior:contain]` is for the same capped
                     state: a wheel that reaches this scroller's boundary
                     used to chain onward to the rule list and drag the row
                     being edited out from under the cursor. At the boundary
                     the field is saying "nothing more to show"; containing
                     the overscroll ends the motion there instead of handing
                     it to a parent the user was not addressing. Short
                     values never scroll in here, so nominal rows never
                     reach it. */
                className={`min-w-0 max-h-24 flex-1 resize-none overflow-y-auto rounded-none border-0 bg-transparent p-0 font-mono text-[12px] leading-[18px] font-medium text-foreground-2 shadow-none outline-none [field-sizing:content] [overflow-wrap:anywhere] [overscroll-behavior:contain] placeholder:font-sans placeholder:text-[12px] placeholder:font-medium placeholder:text-muted-foreground focus-visible:ring-0 group-data-off/rule:text-muted-foreground${errorDiag ? ' invisible pointer-events-none' : ''}`}
                placeholder="value"
                value={value.draft}
                onChange={(e) => value.setDraft(e.target.value)}
                onBlur={value.commit}
                onKeyDown={(e) => {
                  // Shift+Enter keeps the newline; a bare Enter is a commit —
                  // the same bargain the pre-mockup value editor struck, and
                  // the reason it is a textarea rather than an input again.
                  // Enter also leaves the field: a commit is the end of an
                  // edit, and a caret still sitting in a committed value
                  // invites typing that restarts the cycle the key was meant
                  // to close. The blur re-fires `commit`, which is a no-op
                  // for an already-sent draft (`useCommittedDraft` guards on
                  // what it last sent).
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    value.commit();
                    e.currentTarget.blur();
                  } else if (e.key === 'Escape') {
                    e.preventDefault();
                    value.cancel();
                  }
                }}
              />

              {/* `absolute inset-0`, not `mt-px flex-1` like the other two
                  line-2 spans: those size their own box, this one must
                  not — the textarea above already claims the real one.
                  Still renders as one `truncate` line, at the top of
                  whatever height the textarea gave the box; the space
                  below it when that box is tall is the honest cost of
                  reserving the space rather than resizing it, named in
                  this component's own docblock. */}
              {errorDiag && (
                <span
                  data-testid="rule-problem"
                  data-severity="error"
                  title={errorDiag.message}
                  className="absolute inset-0 truncate cursor-not-allowed text-[12px] leading-[18px] font-medium text-destructive"
                >
                  {errorDiag.message}
                </span>
              )}
            </>
          )}
        </div>
      </div>

      {/* Last in the DOM, at the row's right edge.
            Tab order follows the document, so while this sat beside the name
            input a Tab out of the name landed on Delete instead of the value —
            the one sequence this card exists to support, name then value,
            interrupted by its destructive action. Being last in the flex row
            is now also where it visually belongs, so no positioning trick is
            needed to hold it there. */}
      {/* `variant="ghost"` sets no text colour of its own — it inherits the
            row's full-strength ink, the loudest colour in the row, on the
            control that is destructive. The mockup's `.te-icb` and the old
            `.hl-del` both wear `--muted-foreground`; this restores that.
            Armed has to be *seen*, not inferred from a 12px glyph changing
            ink: the state paints the box with shadcn's own `destructive`
            fill tokens, the title says what the second click does, and the
            box, the icon and the position are the same in both states —
            which is the whole of how it avoids the Interface rule's
            forbidden reflow. See `useArmed`. */}
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label={del.armed ? 'Confirm delete rule' : 'Delete rule'}
        title={del.armed ? 'Click again to delete this rule' : undefined}
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
