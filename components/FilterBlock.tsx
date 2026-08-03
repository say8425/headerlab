import { useRef, useState } from 'react';
import type { Filter, ResourceType } from '@/lib/model/types';

/**
 * The eight types the popup offers. `ResourceType` has fifteen; the rest are
 * rare enough that a chip each would cost more than it earns. A type already
 * in state that is not offered here is left alone rather than dropped.
 */
const OFFERED: ResourceType[] = [
  'main_frame', 'sub_frame', 'xmlhttprequest', 'script',
  'stylesheet', 'image', 'font', 'media',
];

export interface FilterBlockProps {
  filter: Filter;
  onPatch: (patch: Partial<Filter>) => void;
}

export function FilterBlock({ filter, onPatch }: FilterBlockProps) {
  const [draft, setDraft] = useState(filter.domains.join(', '));
  // Same shape as HeaderRow's name input and ProfileEditStrip's: this input
  // never leaves its editable state, so a blur can follow an Enter for the
  // same edit. Comparing the derived array against filter.domains is unsafe
  // there — onPatch's round trip through storage + reconcile() is async, so
  // filter.domains may still be stale when the blur fires, and a stale-prop
  // guard would fire a second onPatch for the same edit. Comparing against
  // the array this component itself last sent is immune to that timing (see
  // HeaderRow.tsx, ProfileEditStrip.tsx, and Phase 2a handoff §4.5).
  const lastSent = useRef(filter.domains);

  /**
   * Commits on blur, not per keystroke. The Phase 1 popup split on every
   * change, so typing a comma made it disappear before the next character
   * arrived.
   */
  const commitDomains = () => {
    const next = draft.split(',').map((d) => d.trim()).filter(Boolean);
    const same =
      next.length === lastSent.current.length && next.every((d, i) => d === lastSent.current[i]);
    if (same) return;
    lastSent.current = next;
    onPatch({ domains: next });
  };

  const toggleType = (type: ResourceType) => {
    const has = filter.resourceTypes.includes(type);
    // DNR rejects an empty resourceTypes array, and its default silently
    // excludes main_frame — so the last one cannot be removed.
    if (has && filter.resourceTypes.length === 1) return;
    const next = has
      ? filter.resourceTypes.filter((t) => t !== type)
      : [...filter.resourceTypes, type];
    onPatch({ resourceTypes: next });
  };

  return (
    <div className="hl-filters">
      <div className="hl-frow">
        <span className="hl-flabel">Match</span>
        <input
          aria-label="Match domains"
          className="hl-field"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitDomains}
          onKeyDown={(e) => { if (e.key === 'Enter') commitDomains(); }}
          placeholder="api.example.com, localhost"
        />
      </div>
      <div className="hl-frow">
        <span className="hl-flabel">Types</span>
        <div className="hl-chips">
          {OFFERED.map((type) => (
            <button
              key={type}
              data-testid="type-chip"
              aria-label={type}
              aria-pressed={filter.resourceTypes.includes(type)}
              className="hl-chip"
              onClick={() => toggleType(type)}
            >
              {type}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
