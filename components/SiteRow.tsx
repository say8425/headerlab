import type { Diagnostic } from '@/lib/model/types';

export interface SiteRowProps {
  /** The domain as the user typed it, port and all. */
  domain: string;
  /**
   * Whether this domain can be used at all — `analyzeDomain(...).valid`, asked
   * of the one module that decides it rather than restated here.
   */
  usable: boolean;
  /** Whatever is wrong with this site's access, already matched to its host. */
  diagnostics: readonly Diagnostic[];
  onGrant: (host: string) => void;
  onRemove: () => void;
}

/**
 * A site, and its access state, as one object.
 *
 * Permission stops being a banner here. A domain and whether HeaderLab may act
 * on it are the same fact, so Grant happens on the row that named the domain —
 * you add `api.example.com`, that row goes amber and offers Grant, you press
 * it and the row goes green. The old build collected these into a band above
 * the grid, where two prompts and a filter warning pushed the actual work off
 * the screen.
 *
 * Grant takes the host from the diagnostic's own `host` field, never from its
 * message and never from `domain`: the message is copy and copy changes, and
 * `domain` may carry a port that no match pattern can express — the diagnostic
 * is the only party that already knows which host was probed.
 */
export function SiteRow({ domain, usable, diagnostics, onGrant, onRemove }: SiteRowProps) {
  /**
   * One symbol, one meaning.
   *
   * A domain that cannot be used used to render the same green dot as one that
   * is granted and working, while the explanation sat in a paragraph somewhere
   * else — so the object holding the bad value was the one object on screen
   * not admitting to it. That is the opposite of what this layout is for: a
   * domain and its state are the same thing here, so the state belongs on the
   * row.
   */
  const state = !usable ? 'unusable' : diagnostics.length > 0 ? 'pending' : 'granted';

  return (
    <div className="hl-dom" data-testid="site" data-state={state}>
      <span className="hl-domstate" aria-hidden="true" />
      <span className="hl-domhost">{domain}</span>
      <button className="hl-domx" aria-label={`Remove ${domain}`} onClick={onRemove}>×</button>

      {diagnostics.map((d, i) => (
        <span key={`${d.kind}-${i}`} className="hl-need" data-testid="site-problem">
          <span className="hl-needtext">{d.message}</span>
          {/* Never on an unusable row. Granting permission for a host that
              cannot be used changes nothing, so the button would be an action
              that looks like the remedy and is not. In practice the audit
              already declines to raise `permission-missing` against a
              suppressed rule set, but that is a guarantee made two modules
              away — this row decides what it offers. */}
          {state !== 'unusable' && d.kind === 'permission-missing' && d.host !== undefined && (
            <button className="hl-grant" onClick={() => onGrant(d.host!)}>Grant</button>
          )}
        </span>
      ))}
    </div>
  );
}
