import type { ResourceType } from '@/lib/model/types';

/**
 * The eight types the popup offers, and the label each wears.
 *
 * `ResourceType` has fifteen; the rest are rare enough that a row each would
 * cost more than it earns, and a type already in state that is not offered
 * here is left alone rather than dropped.
 *
 * `xmlhttprequest` is shown as `xhr` because the rail's two columns are 94px
 * wide and the full token is not — but the accessible name stays the real
 * Chrome resource type, because that is the word the user will have to match
 * against every other tool they own.
 */
const OFFERED: ReadonlyArray<readonly [ResourceType, string]> = [
  ['main_frame', 'main_frame'],
  ['sub_frame', 'sub_frame'],
  ['xmlhttprequest', 'xhr'],
  ['script', 'script'],
  ['stylesheet', 'stylesheet'],
  ['image', 'image'],
  ['font', 'font'],
  ['media', 'media'],
];

/**
 * The offered types alone, for the rail's "N of 8" count.
 *
 * Derived from the list above rather than written again: a count that says
 * "2 of 8" while nine rows render is the kind of quiet disagreement a second
 * copy of a list always ends in.
 */
export const OFFERED_TYPES: readonly ResourceType[] = OFFERED.map(([type]) => type);

export interface TypeChecklistProps {
  selected: readonly ResourceType[];
  onToggle: (type: ResourceType) => void;
}

/**
 * All eight request types, visible at once with no disclosure.
 *
 * The rail has vertical room the old grid never had, so a control this rarely
 * touched can simply be small and present rather than hidden behind a chevron
 * that makes the user guess what is behind it.
 */
export function TypeChecklist({ selected, onToggle }: TypeChecklistProps) {
  return (
    <div className="hl-types" data-testid="type-grid">
      {OFFERED.map(([type, label]) => (
        <button
          key={type}
          data-testid="type-check"
          aria-label={type}
          aria-pressed={selected.includes(type)}
          className="hl-ty"
          onClick={() => onToggle(type)}
        >
          <span className="hl-tybox" aria-hidden="true" />
          {label}
        </button>
      ))}
    </div>
  );
}
