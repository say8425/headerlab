import { useRef, useState } from 'react';
import { ValueCell } from './ValueCell';
import type { HeaderRule, Operation } from '@/lib/model/types';

/** `set` is the common case and spends no colour — design §8.2. */
const OP_SIGN: Record<Operation, string> = { set: '', append: '+', remove: '−' };
const OP_NEXT: Record<Operation, Operation> = { set: 'append', append: 'remove', remove: 'set' };

export interface HeaderRowProps {
  rule: HeaderRule;
  onToggle: (enabled: boolean) => void;
  onPatch: (patch: Partial<HeaderRule>) => void;
  onDelete: () => void;
}

export function HeaderRow({ rule, onToggle, onPatch, onDelete }: HeaderRowProps) {
  const [nameDraft, setNameDraft] = useState(rule.name);
  // Unlike ValueCell, the name input never leaves its editable state, so a
  // blur can follow an Enter for the same edit. Comparing against rule.name
  // is unsafe there: onPatch's round trip through storage + reconcile() is
  // async, so rule.name may still be stale when the blur fires, and the
  // guard would fire a second onPatch for the same edit. Comparing against
  // what this component itself last sent is immune to that timing.
  const lastSent = useRef(rule.name);

  const commitName = () => {
    if (nameDraft === lastSent.current) return;
    lastSent.current = nameDraft;
    onPatch({ name: nameDraft });
  };

  // Escape has to restore the draft, not merely be ignored. This input never
  // leaves its editable state, so an ignored Escape leaves the cancelled text
  // in place and the next blur commits it — writing the value the user just
  // cancelled (design §5.3; same branch in FilterBlock and ProfileEditStrip).
  const cancelName = () => setNameDraft(lastSent.current);

  return (
    <div className="hl-row" data-off={!rule.enabled || undefined}>
      <span className="hl-c hl-c-on">
        <button
          role="switch"
          aria-checked={rule.enabled}
          aria-label={`${rule.name || 'Unnamed'} enabled`}
          className="hl-sw"
          onClick={() => onToggle(!rule.enabled)}
        />
      </span>
      <span className="hl-c hl-c-op">
        <button
          className="hl-op"
          data-op={rule.operation}
          aria-label={`Operation: ${rule.operation}`}
          onClick={() => onPatch({ operation: OP_NEXT[rule.operation] })}
        >
          <span className="hl-sig">{OP_SIGN[rule.operation]}</span>
          {rule.operation}
        </button>
      </span>
      <span className="hl-c hl-c-name">
        <input
          aria-label="Header name"
          className="hl-nm"
          value={nameDraft}
          onChange={(e) => setNameDraft(e.target.value)}
          onBlur={commitName}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commitName();
            if (e.key === 'Escape') cancelName();
          }}
        />
      </span>
      <span className="hl-c hl-c-val">
        <ValueCell value={rule.value} onCommit={(next) => onPatch({ value: next })} />
      </span>
      <span className="hl-c hl-c-act">
        <button className="hl-rowmenu" aria-label="Delete row" onClick={onDelete}>×</button>
      </span>
    </div>
  );
}
