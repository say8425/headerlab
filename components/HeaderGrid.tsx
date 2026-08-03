import { Fragment } from 'react';
import { DiagnosticRow } from './DiagnosticRow';
import { HeaderRow } from './HeaderRow';
import { groupCounts, groupRows } from '@/lib/view/grid';
import type { Diagnostic, HeaderRule, HeaderTarget, Profile } from '@/lib/model/types';

export interface HeaderGridProps {
  profile: Profile;
  byRow: ReadonlyMap<string, Diagnostic[]>;
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
export function HeaderGrid({ profile, byRow, onToggleRow, onPatchRow, onDeleteRow, onAddRow }: HeaderGridProps) {
  const groups = groupRows(profile);

  const section = (target: HeaderTarget, rows: HeaderRule[]) => {
    const counts = groupCounts(rows, byRow);
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
                diagnostics={rowDiagnostics}
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
          + Add {target} header
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
