import { useRef, useState } from 'react';
import { SELECTABLE_COLORS } from '@/lib/model/defaults';
import type { Profile } from '@/lib/model/types';

export interface ProfileEditStripProps {
  profile: Profile;
  onPatch: (patch: Partial<Profile>) => void;
  onDelete: () => void;
  onClose: () => void;
}

/**
 * The in-place surface that opens when the active profile tab is re-clicked.
 * No dialog, no popover — everything here edits in place (design §8.4).
 *
 * Delete is irreversible, so it takes two clicks: the first only arms it,
 * the second commits. That is enough friction without a modal.
 */
export function ProfileEditStrip({ profile, onPatch, onDelete, onClose }: ProfileEditStripProps) {
  const [nameDraft, setNameDraft] = useState(profile.name);
  const [armed, setArmed] = useState(false);
  // Same shape as HeaderRow's name input: it never leaves its editable state,
  // so a blur can follow an Enter for the same edit. Comparing against
  // profile.name is unsafe there — onPatch's round trip through storage +
  // reconcile() is async, so profile.name may still be stale when the blur
  // fires, and a stale-prop guard would fire a second onPatch for the same
  // edit. Comparing against what this component itself last sent is immune
  // to that timing (see HeaderRow.tsx and Phase 2a handoff §4.5).
  const lastSent = useRef(profile.name);

  const commitName = () => {
    if (nameDraft === lastSent.current) return;
    lastSent.current = nameDraft;
    onPatch({ name: nameDraft });
  };

  // Escape has to restore the draft, not merely close the strip. App unmounts
  // this component from onClose(), which discards the draft as a side effect —
  // the right outcome for the wrong reason. Any caller that keeps it mounted
  // gets the cancelled name committed on the next blur, which is what happens
  // in HeaderRow and FilterBlock without this branch (design §5.3).
  const cancelName = () => setNameDraft(lastSent.current);

  return (
    <div className="hl-editstrip">
      <input
        aria-label="Profile name"
        className="hl-editname"
        value={nameDraft}
        onChange={(e) => setNameDraft(e.target.value)}
        onBlur={commitName}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commitName();
          if (e.key === 'Escape') {
            cancelName();
            onClose();
          }
        }}
      />
      <span className="hl-swatches">
        {/* The shared list, not a copy — see SELECTABLE_COLORS for why cyan is
            absent from it and why the rotation reads the same array. */}
        {SELECTABLE_COLORS.map((colour) => (
          <button
            key={colour}
            data-testid="colour-swatch"
            aria-label={`Colour ${colour}`}
            data-tone={colour}
            data-chosen={profile.color === colour || undefined}
            className="hl-swatch"
            onClick={() => onPatch({ color: colour })}
          />
        ))}
      </span>
      <button
        className="hl-delete"
        aria-label={armed ? 'Really delete' : 'Delete profile'}
        onClick={() => (armed ? onDelete() : setArmed(true))}
      >
        {armed ? 'Really delete?' : 'Delete'}
      </button>
    </div>
  );
}
