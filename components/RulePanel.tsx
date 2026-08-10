import { Plus } from 'lucide-react';
import { RuleCard } from './RuleCard';
import { Button } from '@/components/ui/button';
import type { Diagnostic, HeaderRule } from '@/lib/model/types';

export interface RulePanelProps {
  rules: readonly HeaderRule[];
  byRow: ReadonlyMap<string, Diagnostic[]>;
  /**
   * Put the caret in the first rule's name on mount.
   *
   * Named for what it does rather than for when it happens. Its predecessor
   * was called `firstRun` and was not: it meant "exactly one rule and it is
   * empty", which is also true for someone who has used the product for a week
   * and deleted everything but one blank row.
   */
  autoFocusFirstRule: boolean;
  onPatchRule: (ruleId: string, patch: Partial<HeaderRule>) => void;
  onDeleteRule: (ruleId: string) => void;
  onAddRule: () => void;
}

/**
 * The right-hand panel, which is nothing but rules.
 *
 * That is the whole point of the split. Every diagnostic the old build stacked
 * above the grid — filter warnings, permission prompts — is about *scope*, and
 * scope lives in the rail, so nothing can push the rules down the screen. Only
 * a problem belonging to a specific rule appears here, inside that rule's own
 * card.
 *
 * Rules are one list in the order the user put them in, not split by request
 * and response: the direction pill on each card says which it is, so grouping
 * would spend a header on something already legible from the row.
 *
 * **The list is the only thing here that scrolls.** The head keeps its place,
 * so "New rule" is reachable from any scroll position, and the well below it
 * is sized to the panel rather than to its contents — `flex-1`, never a
 * `max-height`.
 *
 * Both `min-h-0`s below are belt and braces, measured to be exactly that —
 * removing either changes nothing (e2e stays at 7 passed). They are inert for
 * **two different reasons**, and neither one generalises, so each is stated
 * where it applies rather than once for both:
 *
 * - On the `<section>`: `popup-root` is a **row** flex container
 *   (`App.tsx`, `flex h-full`), so a child's automatic minimum size applies to
 *   the *main* axis, which is horizontal. `min-height: auto` was never in play
 *   here at all — the class does nothing because it is on the cross axis. What
 *   is doing real work in that same class list is the `min-w-0` beside it.
 * - On the well: `scroll-list` already declares `min-height: 0` (style.css), so
 *   this is a duplicate of a declaration the utility carries. Independently of
 *   that, the well's `overflow` is not `visible`, which by itself makes its
 *   automatic minimum size zero.
 *
 * **Neither reason is a general rule, and the rail is the counterexample.**
 * `ScopeRail`'s sites column is a child of a *column* flex container whose own
 * `overflow` *is* `visible`, and the three siblings around its list are
 * `shrink-0` — so its automatic minimum size is their full height, and its
 * `min-h-0` is load-bearing. Dropping it puts 676px of rail in a 600px box
 * (measured; e2e guards that case). Reading either bullet above as "a scroll
 * container makes `min-h-0` unnecessary" and applying it there is exactly how
 * that regression gets shipped.
 */
export function RulePanel({
  rules,
  byRow,
  autoFocusFirstRule,
  onPatchRule,
  onDeleteRule,
  onAddRule,
}: RulePanelProps) {
  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col bg-background p-3">
      <header className="mb-2.5 flex h-7 shrink-0 items-center gap-[7px]">
        <h2 className="text-[14px] leading-[18px] font-semibold tracking-[-0.014em] text-foreground">
          Rules
        </h2>
        <span className="flex-1" />
        {/* Never scrolls away — the list below it does. */}
        <Button
          size="sm"
          className="gap-1.5 rounded-md pr-2.5 pl-2 text-[12px] leading-4 font-semibold"
          onClick={onAddRule}
        >
          <Plus aria-hidden="true" />
          New rule
        </Button>
      </header>

      {/* The well, and the scroll container, as one element.
          Rules are contiguous bands separated by 1px of the well's own tone
          (`RuleCard`'s `mb-px`) rather than by a drawn outline, so the well has
          no padding of its own and no gap between rows — the tone step *is*
          the separator, and a gap would break the band into floating cards
          again. `scroll-list` reserves the scrollbar's 8px in every state, so
          the rows do not jump sideways the moment a tenth rule arrives; here
          that reserve lands inside the well, where it costs no alignment
          against anything outside it. */}
      <div
        data-testid="rule-list"
        className="scroll-list flex min-h-0 flex-1 flex-col rounded-[10px] bg-tray"
      >
        {rules.map((rule, index) => (
          <RuleCard
            key={rule.id}
            rule={rule}
            diagnostics={byRow.get(rule.id) ?? []}
            autoFocus={autoFocusFirstRule && index === 0}
            onPatch={(patch) => onPatchRule(rule.id, patch)}
            onDelete={() => onDeleteRule(rule.id)}
          />
        ))}

        {/* The next row, not a banner. It keeps the rule row's pitch and its
            left gutter, so the dashed plus sits in the switch's column and the
            row reads as the slot the next rule will occupy — the mockup's own
            reasoning for toning it as a slot (`.te-ghost`) rather than
            outlining it as a button. `shrink-0` because a flex column will
            otherwise squeeze the last child to make room, which is what turns
            a fixed row into a 20px sliver at the bottom of a full list.

            `h-[52px]`. This number has now drifted twice from the minimum a
            `RuleCard` row actually renders at, in two consecutive tasks, in
            opposite directions: 51.5px → 54px when Task 11 stacked the
            operation chip under the direction badge (adding a 2px gap
            between them), then back to 52px when Task 12 fused that same
            gap away (`RuleCard.tsx`'s gutter — badge + chip, no gap between
            them — is `18 + 18 = 36px`; `52px` is that plus the row's own
            `py-2`). The second drift was this exact comment's own
            prediction going unheeded — it said to re-measure and update
            this literal when the gutter changed size again, and the gutter
            changed size again. The e2e suite's "the ghost row at the end of
            the list matches a minimum rule row's height" now asserts this
            row's height against a real rule row's height directly, rather
            than against either literal, so a third drift fails a test
            instead of waiting for someone to notice a screenshot looks 2px
            off. */}
        <button
          className="mb-px flex h-[52px] shrink-0 items-center gap-2.5 bg-tray pr-2 pl-3 text-left"
          aria-label="New rule at end"
          onClick={onAddRule}
        >
          <span
            className="flex h-[18px] w-[30px] shrink-0 items-center justify-center rounded-[4px] border border-dashed border-boundary text-muted-foreground"
            aria-hidden="true"
          >
            <Plus className="size-3" />
          </span>
          <span className="text-[12px] leading-4 font-semibold text-foreground-2">New rule</span>
        </button>
      </div>
    </section>
  );
}
