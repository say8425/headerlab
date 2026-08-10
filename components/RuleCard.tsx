import { ArrowDown, ArrowUp, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
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
 * cloth (same size, same radius, the badge's sibling rather than a fourth
 * shape of its own — their fills differ on purpose, see the chip's own
 * comment below), and a ghost icon Button for delete.
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
 * fixed-metric elements (never the text content, never what wraps where),
 * and a diagnostic renders as a sibling below the row, never inside it — so
 * neither can touch the row's own box. Different *rules* can be different
 * heights; a single rule's height is never a function of its own on/off/
 * problem state.
 */
export function RuleCard({ rule, diagnostics, onPatch, onDelete, autoFocus }: RuleCardProps) {
  const name = useCommittedDraft(rule.name, (next) => onPatch({ name: next }));
  const value = useCommittedDraft(rule.value, (next) => onPatch({ value: next }));
  const removes = rule.operation === 'remove';
  // The stored name, not `name.draft` — the remove-value sentence is a
  // static readout of what is actually saved, not of what is mid-edit in
  // the name field beside it.
  const removeName = rule.name.trim();
  const DirIcon = TARGET_ICON[rule.target];

  /**
   * An unfinished rule shows no problem block.
   *
   * Pressing "New rule" used to produce a red "Header name is empty." on a row
   * created one click ago — the product manufacturing an invalid object and
   * then telling the user off for it. The row is already self-evidently
   * unfinished: its name field is empty and showing its placeholder, which is
   * both the marker and the thing to do about it. A block repeating that in red
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

  return (
    <>
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
            `hover:brightness-110` on each half lights only the half under
            the cursor, the two `aria-label`s stay unmerged, and each half
            takes focus separately with its own visible ring.

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
            tidy". Two different rules supply the ring depending on how focus
            arrives — `:focus-visible` in style.css on one path, Badge's own
            `focus-visible:*` on the other — and both draw at or outside the
            border box, so a clip here removes the indicator on both. Nothing
            about the corners needs it. */}
        <div className="flex w-12 shrink-0 flex-col">
          <Badge
            asChild
            className={`h-[18px] w-12 shrink-0 justify-center gap-[3px] rounded-t-[4px] rounded-b-none border-0 px-0 py-0 text-[11px] font-semibold tracking-[0.01em] hover:brightness-110 ${TARGET_TONE[rule.target]}`}
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
            className="h-[18px] w-12 shrink-0 justify-center rounded-t-none rounded-b-[4px] border-0 bg-tray px-0 py-0 text-[11px] font-semibold tracking-[0.01em] text-muted-foreground hover:brightness-110"
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
            child, so its box is exactly as tall as the gutter (38px) rather
            than only as tall as its own content (~34.5px, which used to
            leave 4px of dead space below the value — measured, and the
            reason the value read as pushed toward the top). `justify-between`
            inside it pins name to the very top of that box and value to the
            very bottom, rather than `justify-center`, which was tried first
            and rejected: centering would have pushed name's own top edge
            down by half the slack, breaking the one thing the row's
            `items-start` exists to guarantee — name's first line sitting on
            the same axis as the badge above it. `justify-between` keeps
            name's top pixel-identical to before while still using the
            gutter's full height, which is what "vertically centered against
            the gutter" turns into once that constraint is held fixed. */}
        <div className="flex min-w-0 flex-1 flex-col justify-between self-stretch">
          {/* display:block, not flex — a flex child truncates by hard-clipping
              instead of marking the truncation with an ellipsis (see the
              mockup's own comment on .te-name). */}
          <Input
            aria-label="Header name"
            className="h-[18px] w-full min-w-0 truncate rounded-none border-0 border-b border-transparent bg-transparent p-0 text-[12px] leading-[18px] font-semibold text-foreground shadow-none outline-none placeholder:text-[12px] placeholder:font-medium placeholder:text-muted-foreground hover:border-b-border focus-visible:border-b-ring focus-visible:ring-0 group-data-off/rule:font-medium group-data-off/rule:text-foreground-2 dark:bg-transparent"
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

          {/* Line 2 is the value alone now — operation moved into the
              gutter above — so it takes the column's full width instead of
              splitting it with a 44px op cycler. */}
          <div className="mt-0.5 flex min-w-0 items-start">
            {removes ? (
              removeName === '' ? (
                // Unfinished, not wrong — same reasoning as the problem
                // block above never accusing a one-click-old row (see this
                // file's own docblock on `unfinished`). The quoted-name
                // sentence needs a real name to quote; rather than print
                // empty quotes ("" will be removed, which reads as a typo
                // or a bug), the sentence drops the name clause entirely
                // and says what is still true without it.
                <span
                  className="mt-px min-w-0 flex-1 truncate cursor-not-allowed text-[11px] leading-[14px] font-medium text-muted-foreground"
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
                  className="mt-px flex min-w-0 flex-1 cursor-not-allowed items-baseline gap-1 text-[11px] leading-[14px] font-medium text-muted-foreground"
                  data-testid="rule-value"
                >
                  <span className="min-w-0 truncate font-mono" title={removeName}>
                    &quot;{removeName}&quot;
                  </span>
                  <span className="shrink-0 whitespace-nowrap">will be removed</span>
                </span>
              )
            ) : (
              <textarea
                aria-label="Header value"
                data-testid="rule-value"
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
                   find the symptom. */
                className="min-w-0 max-h-24 flex-1 resize-none overflow-y-auto rounded-none border-0 bg-transparent p-0 font-mono text-[11px] leading-[14px] font-medium text-foreground-2 shadow-none outline-none [field-sizing:content] [overflow-wrap:anywhere] placeholder:font-sans placeholder:text-[11px] placeholder:font-medium placeholder:text-muted-foreground focus-visible:ring-0 group-data-off/rule:text-muted-foreground"
                placeholder="value"
                value={value.draft}
                onChange={(e) => value.setDraft(e.target.value)}
                onBlur={value.commit}
                onKeyDown={(e) => {
                  // Shift+Enter keeps the newline; a bare Enter is a commit —
                  // the same bargain the pre-mockup value editor struck, and
                  // the reason it is a textarea rather than an input again.
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    value.commit();
                  } else if (e.key === 'Escape') {
                    e.preventDefault();
                    value.cancel();
                  }
                }}
              />
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
            `.hl-del` both wear `--muted-foreground`; this restores that. */}
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="Delete rule"
          onClick={onDelete}
          className="text-muted-foreground"
        >
          <Trash2 />
        </Button>
      </div>

      {problems.map((d, i) => (
        <div
          key={`${d.kind}-${i}`}
          data-testid="rule-problem"
          data-severity={d.severity}
          className="group/prob mt-1.5 mr-2 ml-[110px] flex items-start gap-1.5 rounded-md bg-pending-bg px-2 py-1.5 text-[11px] leading-[1.4] text-foreground data-[severity=error]:bg-destructive-bg"
        >
          <span
            className="mt-px flex size-3.5 shrink-0 items-center justify-center rounded-full bg-pending text-[9px] font-bold text-pending-bg group-data-[severity=error]/prob:bg-destructive group-data-[severity=error]/prob:text-destructive-bg"
            aria-hidden="true"
          >
            !
          </span>
          <span>{d.message}</span>
        </div>
      ))}
    </>
  );
}
