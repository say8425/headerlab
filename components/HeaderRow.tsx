import { useState } from 'react';
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

  const commitName = () => {
    if (nameDraft !== rule.name) onPatch({ name: nameDraft });
  };

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
          onKeyDown={(e) => { if (e.key === 'Enter') commitName(); }}
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
