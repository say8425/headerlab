import { ValueCell } from './ValueCell';
import type { Diagnostic, HeaderRule } from '@/lib/model/types';

export interface HeaderRowProps {
  rule: HeaderRule;
  diagnostics: readonly Diagnostic[];
  onToggle: (enabled: boolean) => void;
  onPatch: (patch: Partial<HeaderRule>) => void;
  onDelete: () => void;
}

/** `set` is the common case and spends no colour — design §8.2. */
const OP_SIGN: Record<HeaderRule['operation'], string> = {
  set: '',
  append: '+',
  remove: '−',
};

export function HeaderRow({ rule, onToggle }: HeaderRowProps) {
  return (
    <div className="hl-row" data-off={!rule.enabled || undefined}>
      <span className="hl-c hl-c-on">
        <button
          role="switch"
          aria-checked={rule.enabled}
          aria-label={`${rule.name} enabled`}
          className="hl-sw"
          onClick={() => onToggle(!rule.enabled)}
        />
      </span>
      <span className="hl-c hl-c-op">
        <span className="hl-op" data-op={rule.operation}>
          <span className="hl-sig">{OP_SIGN[rule.operation]}</span>
          {rule.operation}
        </span>
      </span>
      <span className="hl-c hl-c-name">
        {/* A text box from the start, read-only until Task 5 wires editing.
            Rendering a span here and swapping it for an input later would
            force Task 5 to rewrite this task's assertions — and a plan that
            edits its own earlier tests is how a weakened assertion sneaks in. */}
        <input readOnly aria-label="Header name" className="hl-nm" value={rule.name} />
      </span>
      <span className="hl-c hl-c-val">
        <ValueCell value={rule.value} />
      </span>
      <span className="hl-c hl-c-act" />
    </div>
  );
}
