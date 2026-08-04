import { profileMarker } from '@/lib/view/grid';
import { isSuppressed } from '@/lib/compile/suppression';
import type { Diagnostic, Profile } from '@/lib/model/types';

export interface ProfileBarProps {
  profiles: readonly Profile[];
  activeId: string;
  diagnostics: readonly Diagnostic[];
  ruleCount: number;
  onSelect: (id: string) => void;
  onReselect: (id: string) => void;
  onAdd: () => void;
}

/**
 * Clicking an inactive tab switches; clicking the active one opens editing.
 *
 * That second gesture is where profile management lives — there is no overlay
 * anywhere in this popup, because Popover/DropdownMenu portal to the popup's
 * own body and risk clipping at the 600px ceiling (design §8.4).
 *
 * The marker is separate from the identity dot. The dot says which profile
 * this is — the profile's own colour, muted, saturating only when active
 * (design §8.3). The marker says whether it works — compile() reports on
 * every profile but the grid shows one, so without it a broken profile two
 * tabs over is invisible, the same silent failure the diagnostics exist to
 * remove. The two never merge into one element: the dot always renders the
 * profile's own colour regardless of marker state.
 *
 * Suppression is asked here, per profile, rather than passed down: this is the
 * one surface that renders every profile at once, so the answer is per-tab and
 * there is nothing above it holding a list of them. `isSuppressed` is called,
 * never restated — see lib/compile/suppression.ts.
 */
export function ProfileBar({
  profiles, activeId, diagnostics, ruleCount, onSelect, onReselect, onAdd,
}: ProfileBarProps) {
  return (
    <div className="hl-profbar">
      <div className="hl-profs" role="tablist">
        {profiles.map((p) => {
          const marker = profileMarker(diagnostics, p.id, { suppressed: isSuppressed(p) });
          const active = p.id === activeId;
          return (
            <button
              key={p.id}
              role="tab"
              aria-selected={active}
              data-marker={marker ?? undefined}
              className="hl-prof"
              onClick={() => (active ? onReselect(p.id) : onSelect(p.id))}
            >
              <span className="hl-pdot" data-tone={p.color} data-active={active || undefined} />
              {p.name}
            </button>
          );
        })}
        <button className="hl-prof hl-prof-add" aria-label="New profile" onClick={onAdd}>
          +
        </button>
      </div>
      <span className="hl-prof-meta" data-testid="rule-count">
        <b>{ruleCount}</b> rules
      </span>
    </div>
  );
}
