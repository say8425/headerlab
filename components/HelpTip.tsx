import { useId, useState } from 'react';

export interface HelpTipProps {
  /** The accessible name of the `?` itself — what help this offers. */
  label: string;
  /**
   * Input → result pairs, shown above the sentence.
   *
   * The reader is a developer, and their real question is "what happens to
   * what I paste". Two examples answer that faster than any description of
   * the rule, so where a fact has a worked form it is shown before it is
   * stated. Facts with nothing to demonstrate simply omit this.
   */
  examples?: ReadonlyArray<readonly [string, string]>;
  /** The explanation. One sentence; this is an aside, not documentation. */
  text: string;
}

/**
 * A `?` that explains one thing, on demand.
 *
 * **Not hover-only.** The mark is a real button and the bubble opens on focus
 * as well as hover, because this is a developer tool and tabbing through it is
 * ordinary — an explanation only a mouse can reach is an explanation half the
 * users never see. Escape dismisses it while the mark keeps focus, and blur
 * dismisses it on the way out.
 *
 * **Not `title=`.** The native tooltip waits about a second, cannot be styled
 * to meet the contrast floor the rest of this palette is held to, and never
 * appears on keyboard focus at all.
 *
 * One boolean is enough for all four behaviours: Escape sets it false while
 * `onFocus` has already fired, so nothing puts it straight back.
 *
 * Deliberately not a tooltip *system*. There is one `?` in this popup; when a
 * second earns its place, that is the moment to generalise the placement.
 */
export function HelpTip({ label, examples, text }: HelpTipProps) {
  const [open, setOpen] = useState(false);
  const id = useId();

  return (
    <span className="hl-helptip">
      <button
        type="button"
        className="hl-helpmark"
        aria-label={label}
        aria-expanded={open}
        aria-describedby={open ? id : undefined}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') setOpen(false);
        }}
      >
        ?
      </button>
      {open && (
        <span className="hl-helpbubble" role="tooltip" id={id} data-testid="help-bubble">
          {examples !== undefined && (
            <span className="hl-helpex">
              {examples.map(([from, to]) => (
                <span key={from} className="hl-helprow">
                  <code>{from}</code>
                  <span aria-hidden="true">→</span>
                  <code>{to}</code>
                </span>
              ))}
            </span>
          )}
          <span className="hl-helpsay">{text}</span>
        </span>
      )}
    </span>
  );
}
