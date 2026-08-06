import { RuleCard } from './RuleCard';
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
 */
export function RulePanel({
  rules, byRow, autoFocusFirstRule, onPatchRule, onDeleteRule, onAddRule,
}: RulePanelProps) {
  return (
    <section className="hl-panel">
      <div className="hl-panelhead">
        <h2>Rules</h2>
        <button className="hl-newbtn" onClick={onAddRule}>+ New rule</button>
      </div>

      <div className="hl-stack">
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

        {/* The panel head's button never scrolls away; this one is the
            discoverable path at the end of the list you are already reading. */}
        <button className="hl-ghostrule" aria-label="New rule at end" onClick={onAddRule}>
          <span aria-hidden="true">+</span> New rule
        </button>
      </div>
    </section>
  );
}
