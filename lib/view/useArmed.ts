import { useState } from 'react';
import type { KeyboardEvent } from 'react';

export interface Armed {
  /** Whether the control is one click away from firing. */
  armed: boolean;
  /**
   * Spread onto the control itself: the first click arms, the second fires,
   * blur and Escape stand down.
   */
  controlProps: {
    onClick: () => void;
    onBlur: () => void;
    onKeyDown: (event: KeyboardEvent) => void;
  };
}

/**
 * Two clicks for an action that cannot be taken back.
 *
 * Both delete buttons in the popup fired on their first click, and there is
 * nothing behind them to catch the result: no state snapshots or restore
 * (a recorded decision, CLAUDE.md), no export to re-import from, and no
 * length cap on a rule's value — the same file's own docblock cites a
 * 536-character one. A pasted JWT or CSP was one stray click from gone, while
 * the CLI half of this product demands `--force` for the equivalent
 * destructive write. Arming is the popup's `--force`.
 *
 * **Arming changes appearance, not geometry** — the form the Interface rule
 * asks to look for first. The control keeps its exact box and position;
 * what follows the state is colour and the accessible name, so the second
 * click is offered in words ("Confirm…") rather than by the box growing a
 * twin beside it. A confirm dialog would move the interface; a second
 * inline button would change the row's width. Neither survives the rule.
 *
 * **Blur disarms, and that covers more than it seems.** An armed control
 * left armed is a trap laid for whoever presses Enter next, so it must
 * stand down when attention leaves — and in Chrome any click elsewhere moves
 * the focus off the button, which fires this blur. Escape is named for the
 * one withdrawal that happens without the focus moving.
 */
export function useArmed(onFire: () => void): Armed {
  const [armed, setArmed] = useState(false);

  return {
    armed,
    controlProps: {
      onClick: () => {
        if (!armed) {
          setArmed(true);
          return;
        }
        setArmed(false);
        onFire();
      },
      onBlur: () => setArmed(false),
      onKeyDown: (event) => {
        if (event.key === 'Escape') setArmed(false);
      },
    },
  };
}
