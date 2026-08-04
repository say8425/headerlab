import { useState } from 'react';

export interface ValueCellProps {
  value: string;
  onCommit: (next: string) => void;
}

/**
 * Read at rest, expanded on click, editable on demand.
 *
 * Design §8.2 removed an always-editable panel because a 2KB paste stretched
 * it to 1056px. The height cap is the answer, and it applies to both the read
 * and the edit view.
 *
 * The draft lives here, not in storage. Writing per keystroke would run the
 * background's reconcile loop at typing speed, and would hit the same-writer
 * race recorded in the Phase 2a handoff §4.5 on every key — that race is quiet
 * today only because every handler writes once.
 */
export function ValueCell({ value, onCommit }: ValueCellProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  const begin = () => {
    setDraft(value);
    setEditing(true);
  };

  const commit = () => {
    setEditing(false);
    if (draft !== value) onCommit(draft);
  };

  if (editing) {
    return (
      <span className="hl-val-edit">
        <textarea
          autoFocus
          aria-label="Header value"
          className="hl-textarea"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              commit();
            } else if (e.key === 'Escape') {
              e.preventDefault();
              setEditing(false);
            }
          }}
        />
      </span>
    );
  }

  return (
    <span className="hl-val-read">
      <span data-testid="row-value" className={value ? 'hl-val' : 'hl-val hl-val-empty'}>
        {value || <>— <span className="hl-unit">no value</span></>}
      </span>
      <button className="hl-vbtn" aria-label="Edit value" onClick={begin}>
        ✎
      </button>
    </span>
  );
}
