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
 * is sized to the panel rather than to its contents — `flex-1` plus `min-h-0`,
 * never a `max-height`. Without the `min-h-0` a flex child's automatic
 * `min-height: auto` refuses to shrink below its content, and the panel
 * overflows instead of the list scrolling: the same one-line omission that had
 * the whole rail scrolling as one block.
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
            a fixed row into a 20px sliver at the bottom of a full list. */}
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
