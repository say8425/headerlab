import { AddSiteField, type AddSiteResult } from './AddSiteField';
import { SiteRow } from './SiteRow';
import { OFFERED_TYPES, TypeChecklist } from './TypeChecklist';
import { analyzeDomain, effectiveDomain } from '@/lib/permissions/origins';
import type { RuleTally } from '@/lib/view/rules';
import type { Diagnostic, ResourceType } from '@/lib/model/types';

export interface ScopeRailProps {
  tally: RuleTally;
  paused: boolean;
  onTogglePause: (paused: boolean) => void;
  domains: readonly string[];
  /** Host-scoped diagnostics, keyed by the normalized host they name. */
  byHost: ReadonlyMap<string, Diagnostic[]>;
  /** Whole-screen problems that are about scope rather than any one rule. */
  notes: readonly Diagnostic[];
  /**
   * What is stopping the rules, when it is not the rules themselves.
   *
   * `null` means the blocked rules are individually broken and the count can
   * speak for itself.
   */
  blockedBy: 'sites' | 'pause' | null;
  /** The real text of the last failed reconcile, from session storage. */
  lastError: string | null;
  resourceTypes: readonly ResourceType[];
  onAddDomain: (domain: string) => AddSiteResult;
  onRemoveDomain: (domain: string) => void;
  onToggleType: (type: ResourceType) => void;
  onGrant: (host: string) => void;
}

/**
 * The left rail: where does this apply, and is it working.
 *
 * The popup is split by question. Everything here is scope and state — the
 * count, the master switch, the sites and their access, which request types
 * count, and any problem that belongs to the screen rather than to one rule.
 * The panel beside it is then free to be nothing but rules, which is the point
 * of paying 224px for this column.
 *
 * Diagnostics land here for the same reason. Every message the old build
 * stacked above the grid was about scope, so putting them in the scope column
 * costs the rules nothing instead of shoving them down the screen.
 */
export function ScopeRail({
  tally, paused, onTogglePause, domains, byHost, notes, blockedBy, lastError,
  resourceTypes, onAddDomain, onRemoveDomain, onToggleType, onGrant,
}: ScopeRailProps) {
  const typeCount = resourceTypes.filter((t) => OFFERED_TYPES.includes(t)).length;

  // The big number answers "is it on", which is the question asked most often.
  // The line under it names what is not going out — the old footer reported
  // "applying" and "off" and left every rule that was switched on and going
  // nowhere out of both figures.
  // "Unfinished" is named here rather than shown on the rule itself. A rule
  // created one click ago has an empty name because nothing has been typed
  // into it yet, and marking that row red accuses the user of a mistake the
  // product made. Saying it in the count keeps the state from going unsaid
  // without putting a complaint on an untouched row.
  // "Blocked" on its own points at the rule, and the rule is often not what is
  // wrong: an unusable site stops every rule while each one is perfectly good.
  // Naming the cause is what keeps the count from blaming the wrong object.
  const BLAMED = {
    sites: ' by an unusable site',
    pause: ' while paused',
  } as const;
  const blame = blockedBy === null ? '' : BLAMED[blockedBy];

  const subcount: string[] = [];
  if (tally.off > 0) subcount.push(`${tally.off} off`);
  if (tally.unfinished > 0) subcount.push(`${tally.unfinished} unfinished`);
  if (tally.blocked > 0) subcount.push(`${tally.blocked} blocked${blame}`);

  return (
    <aside className="hl-rail">
      <div className="hl-brand">
        <span className="hl-mark" aria-hidden="true">
          <svg width="11" height="11" viewBox="0 0 11 11">
            <path
              d="M1.5 2h8M1.5 5.5h5M1.5 9h8"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
            />
          </svg>
        </span>
        <span className="hl-name">Header<i>lab</i></span>
      </div>

      <div className="hl-readout" data-testid="readout">
        <div className="hl-bignum">
          <b>{tally.live}</b>
          <span>of {tally.total} rules live</span>
        </div>
        <div className="hl-subcount">
          {tally.total === 0 ? (
            'nothing configured yet'
          ) : subcount.length > 0 ? (
            <>
              {tally.off > 0 && <span className="hl-pip" aria-hidden="true" />}
              {subcount.join(' · ')}
            </>
          ) : null}
        </div>
      </div>

      <div className="hl-pausebar" data-testid="runstate" data-paused={paused || undefined}>
        <span className="hl-pauselab">{paused ? 'Paused' : 'Active'}</span>
        <button
          role="switch"
          aria-checked={!paused}
          aria-label={paused ? 'Resume all rules' : 'Pause all rules'}
          className="hl-sw"
          onClick={() => onTogglePause(!paused)}
        />
      </div>

      {/* A failed reconcile means nothing is applying, which contradicts the
          run state directly above it — so it sits here rather than among the
          scope notes, above everything it makes untrue. */}
      {lastError !== null && (
        <div className="hl-note hl-note-err" data-testid="sync-error">
          <b>Rules not registered</b>
          {lastError}
        </div>
      )}

      <div className="hl-railsec">
        <div className="hl-railhead">
          Sites <span className="hl-n">{domains.length > 0 ? domains.length : 'all'}</span>
        </div>
        {domains.map((stored) => {
          // `analyzeDomain` is asked, never restated — it is the one definition
          // of what a usable host is, and the same call already supplies the
          // key this row's diagnostics are filed under.
          //
          // The row shows the *effective* value, not the stored one. New
          // entries are already normalized on commit, so for those the two are
          // the same string; entries written before that are still raw, and
          // showing those verbatim would put the old defect back on screen for
          // exactly the people who already hit it. `key` and removal stay on
          // the stored value, which is what identifies the entry in the list.
          const analysis = analyzeDomain(stored);
          return (
            <SiteRow
              key={stored}
              domain={effectiveDomain(stored)}
              usable={analysis.valid}
              diagnostics={byHost.get(analysis.host) ?? []}
              onGrant={onGrant}
              onRemove={() => onRemoveDomain(stored)}
            />
          );
        })}
        <AddSiteField onAdd={onAddDomain} />
      </div>

      {/* Neutral cards with a coloured edge, not coloured blocks. A pending
          site is already carrying colour; a stack of amber slabs beside it
          would rebuild the wall of yellow this layout exists to remove.
          Severity is carried by the edge, not by the mass.

          Above the request types, not below them. Every one of these is about
          the sites directly above, and the rail scrolls: with two sites
          awaiting permission the real diagnostic copy is tall enough to push
          anything after the checklist past 600px, and a warning you have to
          scroll to find is the failure this whole layout is against. The
          checklist is the least-touched control on screen, so it is the one
          that can afford to be the thing you scroll to. */}
      {notes.map((d, i) => (
        <div
          key={`${d.kind}-${i}`}
          data-testid="scope-note"
          data-severity={d.severity}
          className="hl-note"
        >
          {d.message}
        </div>
      ))}

      <div className="hl-railsec hl-railsec-types">
        <div className="hl-railhead">
          Request types <span className="hl-n">{typeCount} of {OFFERED_TYPES.length}</span>
        </div>
        <TypeChecklist selected={resourceTypes} onToggle={onToggleType} />
      </div>

      <div className="hl-railfill" />
    </aside>
  );
}
