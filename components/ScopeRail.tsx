import { AddSiteField, type AddSiteResult } from './AddSiteField';
import { HelpTip } from './HelpTip';
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
  blockedBy: 'sites' | 'scope' | 'pause' | null;
  /** Applying to every site by explicit choice. */
  allSites: boolean;
  /**
   * Whether `<all_urls>` is actually granted.
   *
   * `null` while the probe is still out — the switch must not accuse the
   * browser of withholding a permission nobody has asked about yet, and a
   * popup that opens showing "needs permission" for a tenth of a second and
   * then withdraws it is the flicker that teaches people to distrust the
   * badge.
   */
  allSitesGranted: boolean | null;
  onToggleAllSites: (allSites: boolean) => void;
  onGrantAllSites: () => void;
  /** The real text of the last failed reconcile, from session storage. */
  lastError: string | null;
  /**
   * Set when the rules registered but the toolbar icon did not follow.
   *
   * Its own note rather than folded into `lastError`: that one is headed
   * "Rules not registered", which is false here — the rules *are* registered
   * and it is the toolbar that is lying about it.
   */
  iconError: string | null;
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
  tally,
  paused,
  onTogglePause,
  domains,
  byHost,
  notes,
  blockedBy,
  lastError,
  iconError,
  allSites,
  allSitesGranted,
  onToggleAllSites,
  onGrantAllSites,
  resourceTypes,
  onAddDomain,
  onRemoveDomain,
  onToggleType,
  onGrant,
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
  // "until a site is set" rather than "by an unusable site": nothing is
  // unusable in that state and nothing is wrong, so blaming a site would send
  // the reader looking for a broken entry that does not exist. It is also the
  // only one of the three that is not a complaint — the sentence finishes the
  // thought the count starts rather than reporting a fault.
  const BLAMED = {
    sites: ' by an unusable site',
    scope: ' until a site is set',
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
        <span className="hl-name">
          Header<i>lab</i>
        </span>
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

      {/* The toolbar can under-report: unpause registers the rules and then
          sets the icon, so a failure there leaves grey chrome over an
          extension that is modifying headers. The run state above is the one
          that is true. */}
      {iconError !== null && (
        <div className="hl-note hl-note-err" data-testid="icon-error">
          <b>Toolbar icon out of date</b>
          The icon may not match the run state above. {iconError}
        </div>
      )}

      <div className="hl-railsec">
        <div className="hl-railhead">
          Sites{' '}
          <span className="hl-n" data-testid="site-count">
            {/* Reads the mode, not the list length. `all` used to mean "the
                list is empty", which was true of a filter applying everywhere
                and equally true of one that had not been scoped yet — the same
                two states the warning above the list was trying to describe.
                Now `all` is said only when all-sites is on, and an empty list
                counts as the 0 it is. */}
            {allSites ? 'all' : domains.length}
          </span>
          {/* The one fact the chip cannot convey: a port or a path could never
              have narrowed anything, because `requestDomains` is host-only.
              Behind a `?` rather than standing under the field — it is worth
              knowing once, not worth 196px of permanent rail. */}
          {/* Shown before it is stated. The reader's real question is "what
              happens to what I paste", and two worked pairs answer that faster
              than the rule they demonstrate. */}
          <HelpTip
            label="About matching sites"
            examples={[
              ['https://x.com/a/b', 'x.com'],
              ['localhost:3000', 'localhost'],
            ]}
            text="Matched by host — a port or path is dropped."
          />
        </div>
        {/* Above the list, because it decides what the list means.
            Underneath it the rows would read as one more site among the
            others rather than as the switch that turns all of them off.

            Its own control rather than a row in the list: "everywhere" is not
            a site, and giving it a chip beside `api.example.com` would put the
            thing that overrides the list inside the list. That shape is what
            made the empty list mean two things in the first place. */}
        <div
          className="hl-allsites"
          data-testid="all-sites"
          data-on={allSites || undefined}
          data-granted={allSites && allSitesGranted === false ? 'no' : undefined}
        >
          {/* The mode is on and the access is not: said, not merely coloured.
              The switch beside it reports on/off and nothing about permission,
              which left these two states — working everywhere, and applying
              nowhere pending a grant — telling apart by an amber tint alone.
              That is the defect the site rows were already fixed for: a dot
              that was `aria-hidden` gave a granted row and an unusable one
              identical accessible names. Same words as those rows, because it
              is the same state. */}
          {/* The dot's *slot* is unconditional; only its meaning is not. It
              used to render solely once the state was known, so "All sites"
              slid 14px sideways the moment a probe answered — and the same
              14px back when the mode went off. State changes appearance, not
              geometry (CLAUDE.md, Interface).

              With nothing to report it is a blank 7px, carrying no `role` and
              no label: reserving the space must not put a phantom image into
              the accessibility tree, and a dot that named a state before the
              browser had been asked is the flicker `allSitesGranted: null`
              exists to prevent. It also lands the label on the same x as the
              hostnames below, which the conditional version only managed in
              one of its two states. */}
          {allSites && allSitesGranted !== null ? (
            <span
              className="hl-allsitesstate"
              role="img"
              aria-label={allSitesGranted ? 'Access granted' : 'Awaiting permission'}
            />
          ) : (
            <span className="hl-allsitesstate" data-unknown="" />
          )}
          <span className="hl-allsiteslab">All sites</span>
          {/* The only control here that asks the browser for anything. The
              switch sets the mode and stops (App.tsx): `<all_urls>` is the
              largest grant this extension can request, so it is spent when a
              button labelled Grant is pressed, never as a side effect of a
              switch moving. Every way of reaching this state — turning the mode
              on, declining once, or a store migrated from a build that never
              asked — therefore arrives at the same button, which is the same
              shape a pending site row offers for the same reason. */}
          {allSites && allSitesGranted === false && (
            <button className="hl-grant" onClick={onGrantAllSites}>
              Grant
            </button>
          )}
          <button
            role="switch"
            aria-checked={allSites}
            aria-label="Apply to every site"
            className="hl-sw"
            onClick={() => onToggleAllSites(!allSites)}
          />
        </div>

        {/* The list is kept on screen, not hidden, while all-sites is on:
            hiding it would make turning the mode off look like it had thrown
            the user's scope away, and there would be no way to see what
            turning it back off returns to. It is shown as what it is — still
            there, not in use — and each row now says so on its own second
            line.

            That sentence used to be a paragraph here, above the list. It said
            the same words about the same rows, and it appeared and vanished
            with the mode, adding 23.7px above every site the instant the
            switch moved. Its subject survives on the object it describes,
            which is where this rail puts a site's state anyway: "a domain and
            whether HeaderLab may act on it are the same fact" (SiteRow). The
            row's line is reserved in every state, so saying it there costs no
            movement at all. */}
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
              inert={allSites}
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
          Request types{' '}
          <span className="hl-n">
            {typeCount} of {OFFERED_TYPES.length}
          </span>
        </div>
        <TypeChecklist selected={resourceTypes} onToggle={onToggleType} />
      </div>

      <div className="hl-railfill" />
    </aside>
  );
}
