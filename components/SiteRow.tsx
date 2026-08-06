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

  // The one diagnostic this row answers with a button instead of a sentence.
  // Everything else is still spoken — see below for where the line is drawn.
  const awaitingGrant = diagnostics.find(
    (d) => d.kind === 'permission-missing' && d.host !== undefined,
  );
  const spoken = diagnostics.filter((d) => d !== awaitingGrant);

  return (
    <div className="hl-dom" data-testid="site" data-state={state}>
      <span className="hl-domstate" aria-hidden="true" />
      <span className="hl-domhost">{domain}</span>
      <button className="hl-domx" aria-label={`Remove ${domain}`} onClick={onRemove}>×</button>

      {/* Everything that is not a routine permission prompt keeps its words.
          A site that can never work is not a step in a flow — it is input that
          will not do anything — so it says what is wrong where it cannot be
          missed. */}
      {spoken.map((d, i) => (
        <span key={`${d.kind}-${i}`} className="hl-need" data-testid="site-problem">
          <span className="hl-needtext">{d.message}</span>
        </span>
      ))}

      {/* A pending permission is state and remedy, and nothing else. The
          sentence this replaces spent four lines telling a developer what a
          Grant button beside a hostname already says; two of them filled the
          rail. A `?` explaining the button went the same way for the same
          reason — a help mark on every pending row is a repeated affordance
          for something nobody was confused by.

          Never on an unusable row: granting a host that cannot be used changes
          nothing, so the button would be an action that looks like the remedy
          and is not. */}
      {awaitingGrant !== undefined && state !== 'unusable' && (
        <span className="hl-need" data-testid="site-pending">
          <button className="hl-grant" onClick={() => onGrant(awaitingGrant.host!)}>Grant</button>
        </span>
      )}
    </div>
  );
}
