import { RuleCard } from './RuleCard';
import type { Diagnostic, HeaderRule } from '@/lib/model/types';

export interface RulePanelProps {
  rules: readonly HeaderRule[];
  byRow: ReadonlyMap<string, Diagnostic[]>;
  /** A fresh install, still on its untouched starter rule. */
  firstRun: boolean;
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
  rules, byRow, firstRun, onPatchRule, onDeleteRule, onAddRule,
}: RulePanelProps) {
  return (
    <section className="hl-panel">
      <div className="hl-panelhead">
        <h2>Rules</h2>
        <button className="hl-newbtn" onClick={onAddRule}>+ New rule</button>
      </div>

      <div className="hl-stack">
        {firstRun && (
          <p className="hl-frhint">
            One rule is already started. Give it a name and a value and it goes out on the
            next request — <b>you do not have to set anything up first</b>.
          </p>
        )}

        {rules.map((rule, index) => (
          <RuleCard
            key={rule.id}
            rule={rule}
            diagnostics={byRow.get(rule.id) ?? []}
            autoFocus={firstRun && index === 0}
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
