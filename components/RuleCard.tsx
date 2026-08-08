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
 * a direction Badge carrying an arrow, an operation that is typography
 * rather than a box, and a ghost icon Button for delete.
 *
 * Two lines, but not the split the grid before this used: line 1 is the
 * header name alone, line 2 is the operation and its value together. Name
 * is sans, value is monospace — provenance, not rank, decides the typeface
 * (docs/design/2026-08-07-popup-tight-instrument.html). A `remove` rule has
 * no value, and says so in the place a value would be rather than rendering
 * an empty field.
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
        className="group/rule mb-px flex items-start gap-2.5 bg-card py-2 pr-2 pl-3 data-[off]:bg-tray"
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

        <Badge
          asChild
          className={`h-[18px] w-12 shrink-0 justify-center gap-[3px] rounded-[4px] border-0 px-0 py-0 text-[11px] font-semibold tracking-[0.01em] ${TARGET_TONE[rule.target]}`}
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

        <div className="min-w-0 flex-1">
          {/* display:block, not flex — a flex child truncates by hard-clipping
              instead of marking the truncation with an ellipsis (see the
              mockup's own comment on .te-name). */}
          <Input
            aria-label="Header name"
            className="h-[18px] w-full min-w-0 truncate rounded-none border-0 border-b border-transparent bg-transparent p-0 text-[12px] leading-[18px] font-semibold text-foreground shadow-none outline-none placeholder:text-[12px] placeholder:font-medium placeholder:text-muted-foreground hover:border-b-border focus-visible:border-b-ring focus-visible:ring-0 group-data-off/rule:font-medium group-data-off/rule:text-foreground-2"
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

          <div className="mt-0.5 flex min-w-0 items-start">
            <button
              type="button"
              className="mt-px w-11 shrink-0 text-left text-[11px] leading-[14px] font-medium text-muted-foreground"
              aria-label={`Operation: ${rule.operation}`}
              onClick={() => onPatch({ operation: OP_NEXT[rule.operation] })}
            >
              {rule.operation}
            </button>

            {removes ? (
              <span
                className="mt-px min-w-0 flex-1 text-[11px] leading-[14px] font-medium text-muted-foreground"
                data-testid="rule-value"
              >
                remove takes no value
              </span>
            ) : (
              <textarea
                aria-label="Header value"
                data-testid="rule-value"
                rows={1}
                /* min/max restored from the pre-mockup field (69bf230) — the
                   owner's ruling was "값이 감싸지게(예전 방식)", the previous
                   way, which capped growth and let a very long value scroll
                   inside itself rather than growing without bound. Dropping
                   the cap was found in review: a realistic 536-character
                   value made one row 232.5px tall, 42% of the popup's own
                   height. `max-h-24` (96px) is `.hl-hval`'s old value.

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
                className="min-w-0 max-h-24 min-h-[30px] flex-1 resize-none overflow-y-auto rounded-none border-0 bg-transparent p-0 font-mono text-[11px] leading-[14px] font-medium text-foreground-2 shadow-none outline-none [field-sizing:content] [overflow-wrap:anywhere] placeholder:font-sans placeholder:text-[11px] placeholder:font-medium placeholder:text-muted-foreground focus-visible:ring-0 group-data-off/rule:text-muted-foreground"
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
