export interface StatusFootProps {
  applying: number;
  total: number;
  off: number;
  needsAccess: number;
  /** The real text of the last failed reconcile, from session storage. */
  lastError: string | null;
}

export function StatusFoot({ applying, total, off, needsAccess, lastError }: StatusFootProps) {
  return (
    <div className="hl-foot" data-testid="foot">
      {lastError !== null ? (
        <span className="hl-footerr">{lastError}</span>
      ) : (
        <>
          <span className="hl-fdot" />
          <span>
            <b>{applying}</b> of {total} rules applying
          </span>
          <span className="hl-sep">·</span>
          <span>{off} off</span>
        </>
      )}
      {needsAccess > 0 && (
        <span className="hl-pendtag" data-testid="needs-access">
          {needsAccess} need access
        </span>
      )}
    </div>
  );
}
