import { Plus } from 'lucide-react';
import { useState } from 'react';
import { Input } from '@/components/ui/input';

/**
 * What happened to an entry the field handed over.
 *
 * `alreadyThere` carries the **host** that collided, not the text that was
 * typed — after normalization `https://x.com/` and `x.com` are one site, so the
 * host is the only thing that explains why two different-looking entries are
 * the same one.
 */
export type AddSiteResult = { added: true } | { added: false; alreadyThere: string };

export interface AddSiteFieldProps {
  onAdd: (domain: string) => AddSiteResult;
}

/**
 * Names one more site.
 *
 * Unlike the other fields in this popup it does not edit a value, it appends
 * one — so "commit once per edit" is structural rather than guarded: adding
 * clears the field, and a blur after an Enter therefore has an empty draft and
 * adds nothing. Escape clears without adding, which is the same promise the
 * editable fields make with their draft restore.
 *
 * Blank input is dropped rather than appended. An empty *entry* in a non-empty
 * list is a domain that can never match, silently narrowing the scope to
 * nothing — and an empty list is now its own state, counted by the readout as
 * blocked rather than being a spelling of "every site", so there is nothing to
 * be gained by letting a blank one in either.
 */
export function AddSiteField({ onAdd }: AddSiteFieldProps) {
  const [draft, setDraft] = useState('');
  const [alreadyThere, setAlreadyThere] = useState<string | null>(null);

  const add = () => {
    const domain = draft.trim();
    if (domain.length === 0) {
      setDraft('');
      setAlreadyThere(null);
      return;
    }
    const result = onAdd(domain);
    if (!result.added) {
      // Deliberately keeps the text. Clearing the field on a duplicate looks
      // exactly like a successful add, which is the silent no-op this has to
      // avoid; leaving the entry in place says plainly that nothing was
      // committed, and the note beside it says why.
      setAlreadyThere(result.alreadyThere);
      return;
    }
    setDraft('');
    setAlreadyThere(null);
  };

  return (
    // Two flex items, not a Fragment: `.hl-railsec` (the sites section) is a
    // flex column that gaps its direct children, so the field and the note
    // used to get that spacing for free as siblings. Wrapping them costs
    // nothing as long as this div reproduces the same gap itself — `gap-1.5`
    // below is that reproduction, not a new number.
    <div className="flex flex-col gap-1.5">
      {/* The dashed edge is the input's own border, not a decoration wrapped
          around a plain one. `data-testid="add-field"` has to sit on this
          element because the e2e layout guard measures *this* box — an outer
          div carrying the border while the input sat inside it, padded
          smaller, would measure a rectangle the user never sees as "the
          control". The plus cannot live on the input itself, so it is
          positioned over it from a `relative` wrapper that adds no border,
          padding or margin of its own — it does not change what the input's
          own rect is.

          The plus is a control, not a decoration: clicking it does exactly
          what Enter does (`add`), because a glyph sitting inside a field
          reads as part of the field's behaviour and a click that does
          nothing is a button that lies. Shaped like the `?` help trigger in
          the section heading above (20px box, 14px glyph, tone on hover)
          rather than a shadcn Button — it is an overlay on the input's own
          geometry, and the standard sizes would move what the layout guard
          measures. `cursor-pointer` because a Chromium button's default
          arrow says "not clickable" at a glance. */}
      <div className="relative">
        <button
          type="button"
          aria-label="Add the typed site"
          onClick={add}
          className="absolute top-1/2 left-1.5 flex size-5 -translate-y-1/2 cursor-pointer items-center justify-center rounded-[4px] text-foreground-2 hover:text-foreground"
        >
          <Plus aria-hidden="true" className="size-3.5" />
        </button>
        <Input
          aria-label="Add a site"
          data-testid="add-field"
          placeholder="add a site"
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            // The complaint is about the text as it stands; editing it makes the
            // complaint stale.
            setAlreadyThere(null);
          }}
          onBlur={add}
          onKeyDown={(e) => {
            if (e.key === 'Enter') add();
            if (e.key === 'Escape') {
              setDraft('');
              setAlreadyThere(null);
            }
          }}
          className="rounded-md border-dashed border-boundary bg-transparent pr-2.5 pl-7 font-mono text-[12px] placeholder:font-sans placeholder:text-[11px] placeholder:font-semibold placeholder:text-foreground-2 dark:bg-transparent"
        />
      </div>
      {/* **Not reserved any more, and that is a deliberate reversal.**

          The wrapper here used to be `h-[15px] px-px`, always present, so the
          duplicate complaint appearing could not push what follows — the same
          rule that stops a Grant button moving the row under it. The cost was
          paid in every other state: measured in the built popup at the empty
          rail, the gap from the input's bottom to the scope note below was
          27px (6px inside this component, 15px of reservation, 6px of the
          section's own `gap-1.5`) against the 6px rhythm every other child of
          that section keeps. The owner read it as the note floating, and chose
          the movement over the permanent hole.

          So the note is created rather than reserved, and typing a domain that
          is already listed now pushes what follows down by its height. The
          e2e assertion that forbade exactly that was removed with it rather
          than left describing a promise no longer made; the Grant button and
          the readout's second line keep theirs, because those two still hold.

          What is NOT reverted is the one-line guarantee, which is what made a
          fixed 15px honest in the first place and is still what keeps the push
          bounded: `schema.ts` caps no domain length and the rail is ~194px, so
          the domain truncates to an ellipsis inside a `min-w-0` flex slot with
          `title` carrying the full value, and the fixed suffix never wraps.
          Every state of this paragraph is still exactly one line. Nothing is
          truncated in `alreadyThere` itself or in what is stored. */}
      {alreadyThere !== null && (
        // `gap-1`, not a leading space in the `<span>`'s own text. `flex`
        // blockifies both children (CSS Display's flex-item blockification),
        // and a blockified box's own leading/trailing white space collapses
        // away at render — verified in real Chromium: the space character
        // that used to sit at the front of the suffix span measured zero
        // width and was absent from `innerText`, even though jsdom's
        // `textContent` (which does no layout or collapsing) still showed
        // it, so the tests stayed green while the screen was wrong. `gap`
        // is box-model spacing, not text, so it is not subject to that
        // collapse — the trade is that the separating space no longer
        // appears in `textContent` either, on purpose (see the tests).
        <p
          className="flex items-baseline gap-1 overflow-hidden font-sans text-[10.5px] leading-[1.4] font-normal text-pending"
          data-testid="add-site-note"
        >
          <b className="min-w-0 truncate font-mono font-semibold" title={alreadyThere}>
            {alreadyThere}
          </b>
          <span className="shrink-0 whitespace-nowrap">is already in the list.</span>
        </p>
      )}
    </div>
  );
}
