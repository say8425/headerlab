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
 * nothing — and an empty list is now its own stated state (`no-scope`) rather
 * than a spelling of "every site", so there is nothing to be gained by letting
 * a blank one in either.
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
          control". The icon is the one piece that cannot live on the input
          itself, so it is positioned over it from a `relative` wrapper that
          adds no border, padding or margin of its own — it does not change
          what the input's own rect is. */}
      <div className="relative">
        <Plus
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-foreground-2"
        />
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
      {/* Reserved, not created: the wrapper is always here at its one-line
          height, and only the paragraph inside it — the thing the tests key
          on — comes and goes. A duplicate complaint appearing must not push
          "Request types" down the rail any more than a Grant button may push
          the row under it (CLAUDE.md, Interface). */}
      <div className="min-h-[15px] px-px">
        {alreadyThere !== null && (
          <p
            className="font-sans text-[10.5px] leading-[1.4] font-normal text-pending [overflow-wrap:anywhere]"
            data-testid="add-site-note"
          >
            <b className="font-mono font-semibold">{alreadyThere}</b> is already in the list.
          </p>
        )}
      </div>
    </div>
  );
}
