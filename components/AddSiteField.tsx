import { useState } from 'react';

export interface AddSiteFieldProps {
  onAdd: (domain: string) => void;
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

  const add = () => {
    const domain = draft.trim();
    setDraft('');
    if (domain.length > 0) onAdd(domain);
  };

  return (
    <input
      aria-label="Add a site"
      className="hl-addfield"
      placeholder="+ add a site"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={add}
      onKeyDown={(e) => {
        if (e.key === 'Enter') add();
        if (e.key === 'Escape') setDraft('');
      }}
    />
  );
}
