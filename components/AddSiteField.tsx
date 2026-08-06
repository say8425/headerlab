import { useState } from 'react';

/**
 * What happened to an entry the field handed over.
 *
 * `alreadyThere` carries the **host** that collided, not the text that was
 * typed — after normalization `https://x.com/` and `x.com` are one site, so the
 * host is the only thing that explains why two different-looking entries are
 * the same one.
 */
export type AddSiteResult =
  | { added: true }
  | { added: false; alreadyThere: string };

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
 * Blank input is dropped rather than appended. An empty domain list means "every
 * site" (`empty-filter` says so), and an empty *entry* in a non-empty list is a
 * domain that can never match — silently narrowing the scope to nothing.
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
    <>
      <input
        aria-label="Add a site"
        className="hl-addfield"
        placeholder="+ add a site"
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
      />
      {alreadyThere !== null && (
        <p className="hl-fieldnote" data-testid="add-site-note">
          <b>{alreadyThere}</b> is already in the list.
        </p>
      )}
      {/* Persistent, and above the input's own errors rather than instead of
          them. A port or a path is silently useless here — `requestDomains` is
          host-only, so neither can narrow anything — and that is a fact about
          the platform, not about any one entry. Said once, before the typing,
          it prevents the mistake; said after each entry it would only explain
          a change the user can already see in the chip. */}
      <p className="hl-fieldhelp">Matched by host — a port or path cannot narrow it.</p>
    </>
  );
}
