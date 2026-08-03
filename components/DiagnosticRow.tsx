import type { Diagnostic } from '@/lib/model/types';

export interface DiagnosticRowProps {
  diagnostics: readonly Diagnostic[];
}

/**
 * Hangs under the row it is about.
 *
 * Renders nothing when there is nothing to say — the conditional chrome only
 * costs vertical space when it has earned it, which is what keeps the popup
 * inside its 600px ceiling in the common case.
 */
export function DiagnosticRow({ diagnostics }: DiagnosticRowProps) {
  if (diagnostics.length === 0) return null;
  return (
    <div className="hl-subrow">
      <span className="hl-sub">
        {diagnostics.map((d, i) => (
          <span
            key={`${d.kind}-${i}`}
            data-testid="diagnostic-line"
            data-severity={d.severity}
            className="hl-subline"
          >
            {d.message}
          </span>
        ))}
      </span>
    </div>
  );
}
