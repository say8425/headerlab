import type { Diagnostic } from '@/lib/model/types';

export interface DiagnosticBandProps {
  diagnostics: readonly Diagnostic[];
  onGrant: (host: string) => void;
}

/**
 * Profile-level diagnostics, directly under the filter block they are about.
 *
 * Grant appears only for `permission-missing`, and takes the host from the
 * diagnostic's own field rather than from its message.
 */
export function DiagnosticBand({ diagnostics, onGrant }: DiagnosticBandProps) {
  if (diagnostics.length === 0) return null;
  return (
    <div className="hl-band">
      {diagnostics.map((d, i) => {
        const host = d.host;
        return (
          <div
            key={`${d.kind}-${i}`}
            data-testid="band-line"
            data-severity={d.severity}
            className="hl-bandline"
          >
            <span>{d.message}</span>
            {d.kind === 'permission-missing' && host !== undefined && (
              <button className="hl-grant" onClick={() => onGrant(host)}>
                Grant
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
