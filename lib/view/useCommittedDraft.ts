import { useRef, useState } from 'react';

export interface CommittedDraft {
  draft: string;
  setDraft: (next: string) => void;
  /** Sends the draft onward, at most once per edit. */
  commit: () => void;
  /** Puts the draft back to whatever was last sent, so a following blur sends nothing. */
  cancel: () => void;
}

/**
 * A field that holds its own text and commits once per edit.
 *
 * Three separate components had written this by hand with the same paragraph
 * of comment above each, which is how the codebase already describes its own
 * worst failure mode — a second statement of one fact eventually disagrees
 * with the first. The reasoning, stated once:
 *
 * **The draft is local.** Writing per keystroke would run the background's
 * reconcile loop at typing speed, and the Phase 1 popup that re-derived from
 * props on every change made a typed comma vanish before the next character
 * arrived.
 *
 * **`commit` compares against what this hook last sent, never against the
 * `value` prop.** These inputs never leave their editable state, so a blur can
 * follow an Enter for the same edit. `onCommit`'s round trip through storage
 * and reconcile() is async, so `value` may still be stale when the blur fires
 * — a prop-based guard would then fire a second commit for one edit, breaking
 * the "every handler writes once" invariant `useAppState` depends on.
 *
 * **`cancel` restores the draft rather than doing nothing.** Ignoring Escape
 * is not neutral: the cancelled text survives in a field that is still
 * editable, and the very next blur commits the value the user just cancelled.
 * On a header name that ships a wrong header with no diagnostic to catch it.
 *
 * `value` seeds the draft once. A later external change to `value` does not
 * reach the field, which is the same trade the components made before and for
 * the same reason — the alternative is the round trip fighting the typing.
 */
export function useCommittedDraft(
  value: string,
  onCommit: (next: string) => void,
): CommittedDraft {
  const [draft, setDraft] = useState(value);
  const lastSent = useRef(value);

  return {
    draft,
    setDraft,
    commit: () => {
      if (draft === lastSent.current) return;
      lastSent.current = draft;
      onCommit(draft);
    },
    cancel: () => setDraft(lastSent.current),
  };
}
