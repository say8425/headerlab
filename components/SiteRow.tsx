import type { Diagnostic } from '@/lib/model/types';

export interface SiteRowProps {
  /**
   * The value to show: the effective host, or the raw entry when nothing can be
   * made of it. `ScopeRail` resolves this; the row does not see what is stored.
   */
  domain: string;
  /**
   * Whether this domain can be used at all — `analyzeDomain(...).valid`, asked
   * of the one module that decides it rather than restated here.
   */
  usable: boolean;
  /**
   * All-sites is on, so this entry is stored but not compiled.
   *
   * It has to change what the row *says*, not merely how it looks. Access for
   * a host nothing is scoped to is neither granted nor pending — it is not
   * being asked, so the green dot would be claiming something no probe has
   * established.
   */
  inert: boolean;
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
/** What each row state is called when it cannot be seen. */
const STATE_LABEL = {
  granted: 'Access granted',
  pending: 'Awaiting permission',
  unusable: 'Unusable site',
  idle: 'Not in use',
} as const;

type RowState = keyof typeof STATE_LABEL;

/**
 * What the row's second line says when it is not holding the Grant button.
 *
 * The line exists in every state — see the markup for why — so the question is
 * only what fills it. A blank band inside a card reads as a rendering fault,
 * and these three states each have something true to put there.
 *
 * `pending` is absent on purpose: that state's line is the button, and a word
 * for it would be a branch nothing can reach. A pending row with no grantable
 * host would fall through to an empty line, which is the honest rendering of
 * "waiting, with nothing to press".
 */
const STATE_LINE: Record<Exclude<RowState, 'pending'>, string> = {
  granted: 'Access granted',
  unusable: 'Cannot be used',
  idle: 'Not in use while All sites is on',
};

export function SiteRow({ domain, usable, inert, diagnostics, onGrant, onRemove }: SiteRowProps) {
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
  /**
   * Unusable outranks inert. An entry that cannot be used is still wrong while
   * all-sites is on — it is simply not doing any harm *yet*, and it is what
   * will suppress every rule the moment the switch goes back off. Hiding that
   * until then would spring the failure on the user at the exact moment they
   * narrowed their scope and expected it to start working.
   */
  const state: RowState = !usable
    ? 'unusable'
    : inert
      ? 'idle'
      : diagnostics.length > 0
        ? 'pending'
        : 'granted';

  /**
   * The permission this row is waiting on, if any.
   *
   * There is no "everything else" branch beside this one. `permission-missing`
   * is the only `DiagnosticKind` that ever sets `host`, so `byHost` cannot
   * contain anything else, and `auditDiagnostics` emits at most one per host —
   * a sibling branch for the other cases was code no user could reach, and a
   * contrast pair and three tests were describing it. An unusable site is still
   * explained in words; that message has no `host`, so it reaches the screen as
   * a scope note in the rail.
   */
  const awaitingGrant = diagnostics.find(
    (d) => d.kind === 'permission-missing' && d.host !== undefined,
  );

  return (
    <div className="hl-dom" data-testid="site" data-state={state}>
      {/* Was `aria-hidden`, which left a granted row and an unusable row with
          identical accessible names — the colour was the only thing telling
          them apart. */}
      <span className="hl-domstate" role="img" aria-label={STATE_LABEL[state]} />
      <span className="hl-domhost">{domain}</span>
      <button className="hl-domx" aria-label={`Remove ${domain}`} onClick={onRemove}>
        ×
      </button>

      {/* The row's second line, present in **every** state and always the same
          height.

          It used to render only when a permission was pending, which made the
          Grant button's arrival add 30.5px to the row — pushing the sites under
          it, the add field and the whole rail below down by that much, at the
          moment the user was reading the row that had just changed. A control
          appearing must not resize what holds it (CLAUDE.md, Interface), so the
          line is sized to the tallest thing it can hold, which is the button,
          and the other states occupy that space rather than removing it.

          It is not reserved by rendering a hidden button. An invisible control
          is still in the accessibility tree and still lands in the tab order,
          which would put an unpressable Grant between the × of one row and the
          host of the next. The space is reserved; the control is not.

          The words are `aria-hidden` because the dot at the head of the row
          already carries the same fact as its accessible name — without that,
          every row would announce its state twice.

          A pending permission is state and remedy, and nothing else. The
          sentence this replaces spent four lines telling a developer what a
          Grant button beside a hostname already says; two of them filled the
          rail. A `?` explaining the button went the same way for the same
          reason — a help mark on every pending row is a repeated affordance
          for something nobody was confused by.

          Never on an unusable row: granting a host that cannot be used changes
          nothing, so the button would be an action that looks like the remedy
          and is not. */}
      <span className="hl-need" data-testid="site-line">
        {awaitingGrant !== undefined && state !== 'unusable' && state !== 'idle' ? (
          <button
            className="hl-grant"
            data-testid="site-pending"
            onClick={() => onGrant(awaitingGrant.host!)}
          >
            Grant
          </button>
        ) : (
          <span className="hl-needsay" aria-hidden="true">
            {state === 'pending' ? '' : STATE_LINE[state]}
          </span>
        )}
      </span>
    </div>
  );
}
