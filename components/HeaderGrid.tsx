import { Fragment } from 'react';
import { DiagnosticRow } from './DiagnosticRow';
import { HeaderRow } from './HeaderRow';
import { groupCounts, groupRows } from '@/lib/view/grid';
import type { Diagnostic, HeaderRule, HeaderTarget, Profile } from '@/lib/model/types';

export interface HeaderGridProps {
  profile: Profile;
  byRow: ReadonlyMap<string, Diagnostic[]>;
  /**
   * Whether compile() emits any rule for this profile — false when the profile
   * is switched off, the whole app is paused, or the profile is suppressed
   * (compile.ts:28, :40, :51). A prop rather than something derived here: two
   * of those three are app-level state the grid has no access to, and App has
   * to answer the same question for the status foot anyway. One boolean
   * computed once and handed to both is what stops the group headers and the
   * footer from disagreeing, which is the defect this closes.
   *
   * Callers compose it by asking rather than restating — the suppression term
   * is `isSuppressed` (lib/compile/suppression.ts), whose comment says why a
   * hand-written copy of that predicate is the bug it was extracted to end.
   */
  live: boolean;
  onToggleRow: (ruleId: string, enabled: boolean) => void;
  onPatchRow: (ruleId: string, patch: Partial<HeaderRule>) => void;
  onDeleteRow: (ruleId: string) => void;
  onAddRow: (target: HeaderTarget) => void;
}

/**
 * Owns `--cols`.
 *
 * One variable drives the sticky column header, both group dividers, every
 * data row, the diagnostic sub-rows and the add rows. That is the property
 * design §8.1 chose this direction for, and it survives only while the track
 * list lives in exactly one place — hence `data-cols-owner`, which a test
 * asserts is unique.
 */
export function HeaderGrid({ profile, byRow, live, onToggleRow, onPatchRow, onDeleteRow, onAddRow }: HeaderGridProps) {
  const groups = groupRows(profile);

  const section = (target: HeaderTarget, rows: HeaderRule[]) => {
    const counts = groupCounts(rows, byRow, { live });
    const label = target === 'request' ? 'Request headers' : 'Response headers';
    return (
      <>
        <div className="hl-grp" data-testid={`group-${target}`}>
          <span className="hl-glabel">
            {label} <span className="hl-gcount">{counts.total}</span>
          </span>
          <span className="hl-gright">
            {counts.applying} of {counts.total} applying
          </span>
        </div>
        {rows.map((rule) => {
          const rowDiagnostics = byRow.get(rule.id) ?? [];
          return (
            <Fragment key={rule.id}>
              <HeaderRow
                rule={rule}
                onToggle={(enabled) => onToggleRow(rule.id, enabled)}
                onPatch={(patch) => onPatchRow(rule.id, patch)}
                onDelete={() => onDeleteRow(rule.id)}
              />
              <DiagnosticRow diagnostics={rowDiagnostics} />
            </Fragment>
          );
        })}
        {/* The accessible name must stay exactly "Add {target} header" — the
            visible "+" is decorative, so it is kept out of the name via
            aria-label rather than folded into it. */}
        <button className="hl-addrow" aria-label={`Add ${target} header`} onClick={() => onAddRow(target)}>
          {/* The span is what carries the text's grid placement. The button
              itself is the row, laid out on `--cols` like every other row, so
              its text needs a child to sit in a column — without one it would
              land in the 38px "On" track. */}
          <span className="hl-ghost">+ Add {target} header</span>
        </button>
      </>
    );
  };

  return (
    <div className="hl-gbody" data-cols-owner>
      <div className="hl-ghead">
        <span className="hl-h">On</span>
        <span className="hl-h">Op</span>
        <span className="hl-h">Header name</span>
        <span className="hl-h">Value</span>
        <span className="hl-h" />
      </div>
      {section('request', groups.request)}
      {section('response', groups.response)}
    </div>
  );
}
