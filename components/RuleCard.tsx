import { useCommittedDraft } from '@/lib/view/useCommittedDraft';
import type { Diagnostic, HeaderRule, HeaderTarget, Operation } from '@/lib/model/types';

const OP_NEXT: Record<Operation, Operation> = { set: 'append', append: 'remove', remove: 'set' };
const TARGET_NEXT: Record<HeaderTarget, HeaderTarget> = {
  request: 'response',
  response: 'request',
};
/** Short enough to be a pill, and the word every HTTP tool already uses. */
const TARGET_LABEL: Record<HeaderTarget, string> = { request: 'REQ', response: 'RES' };

export interface RuleCardProps {
  rule: HeaderRule;
  diagnostics: readonly Diagnostic[];
  onPatch: (patch: Partial<HeaderRule>) => void;
  onDelete: () => void;
  /** True for the single starter rule a fresh install opens on. */
  autoFocus?: boolean;
}

/**
 * One rule, in two tiers.
 *
 * Line 1 is identity — switch, direction, operation, name. Line 2 is the value
 * across the whole panel, wrapping instead of truncating: the five-column grid
 * this replaces gave a value 246px and an ellipsis, which was the first thing
 * the owner named. Direction is a coloured pill rather than a column, so it is
 * read from the row itself.
 *
 * A `remove` rule has no value, and says so in the place a value would be
 * rather than rendering an empty field. The old grid had to invent the copy
 * "— no value" to fill a cell that a column layout forced it to draw.
 */
export function RuleCard({ rule, diagnostics, onPatch, onDelete, autoFocus }: RuleCardProps) {
  const name = useCommittedDraft(rule.name, (next) => onPatch({ name: next }));
  const value = useCommittedDraft(rule.value, (next) => onPatch({ value: next }));
  const removes = rule.operation === 'remove';

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
    <div
      className="hl-rule"
      data-testid="rule"
      data-off={!rule.enabled || undefined}
      data-unfinished={unfinished || undefined}
    >
      <div className="hl-r1">
        <button
          role="switch"
          aria-checked={rule.enabled}
          aria-label={`${rule.name || 'Unnamed'} enabled`}
          className="hl-tog"
          onClick={() => onPatch({ enabled: !rule.enabled })}
        />
        <button
          className="hl-pill"
          data-target={rule.target}
          aria-label={`Direction: ${rule.target}`}
          onClick={() => onPatch({ target: TARGET_NEXT[rule.target] })}
        >
          {TARGET_LABEL[rule.target]}
        </button>
        <button
          className="hl-op"
          data-op={rule.operation}
          aria-label={`Operation: ${rule.operation}`}
          onClick={() => onPatch({ operation: OP_NEXT[rule.operation] })}
        >
          {rule.operation}
        </button>
        <input
          aria-label="Header name"
          className="hl-hname"
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
      </div>

      <div className="hl-r2">
        {removes ? (
          <span className="hl-hval hl-hval-none" data-testid="rule-value">
            remove takes no value
          </span>
        ) : (
          <textarea
            aria-label="Header value"
            className="hl-hval"
            data-testid="rule-value"
            placeholder="value"
            rows={1}
            value={value.draft}
            onChange={(e) => value.setDraft(e.target.value)}
            onBlur={value.commit}
            onKeyDown={(e) => {
              // Shift+Enter keeps the newline; a bare Enter is a commit, the
              // same bargain the value editor struck before this redesign.
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

      {/* Last in the DOM, top-right on screen.
          Tab order follows the document, so while this sat beside the name
          input a Tab out of the name landed on Delete instead of the value —
          the one sequence this card exists to support, name then value,
          interrupted by its destructive action. Moving the markup is the fix;
          a positive `tabindex` would pull it into a separate sequence that has
          to be maintained against every future change. CSS puts it back where
          it looks right, and `.hl-r1` reserves the width it used to occupy so
          the card's appearance does not move. */}
      <button className="hl-del" aria-label="Delete rule" onClick={onDelete}>×</button>

      {problems.map((d, i) => (
        <div
          key={`${d.kind}-${i}`}
          data-testid="rule-problem"
          data-severity={d.severity}
          className="hl-rprob"
        >
          <span className="hl-rprob-ic" aria-hidden="true">!</span>
          <span>{d.message}</span>
        </div>
      ))}
    </div>
  );
}
