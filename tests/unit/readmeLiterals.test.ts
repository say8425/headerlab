import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * The five READMEs quote the popup's readout. This holds them to the same
 * strings, because nothing else did.
 *
 * **Why this exists.** Two claims were wrong in all four translations while the
 * English was right, and had been since they were written. They printed
 * `2 of 4 rules live · 1 off · 1 blocked`; the popup renders no such string —
 * `components/RulePanel.tsx` builds it as `{tally.live} of {tally.total} live`,
 * with no "rules". And they said the count is read in the rail, which it stopped
 * being on 2026-08-20 (`RulePanel.tsx`: "The count lives here, not in the rail").
 * A documented UI string drifted in four files and not the fifth, and nothing in
 * this repository could see it, because nothing compares the five.
 *
 * What this can and cannot do: it pins the quoted strings, not the prose around
 * them. A translation can still describe the wrong thing in its own words — that
 * is what a reader is for. But a quoted UI string is not prose, and a quoted UI
 * string that no longer matches the UI is the failure this catches.
 *
 * These are the popup's own bytes, so they are never translated. If the readout's
 * format changes, this file is the list to update — and it will go red first,
 * which is the point.
 */

const READMES = [
  'README.md',
  'docs/README.ko.md',
  'docs/README.ja.md',
  'docs/README.zh.md',
  'docs/README.es.md',
] as const;

/**
 * Every literal the READMEs quote from the popup, with where it comes from.
 *
 * The separator in the readout is a middle dot with a space on each side, which
 * is `RulePanel.tsx`'s own `.join(' · ')`. The alt-text forms use commas because
 * they are describing a picture in prose rather than reproducing the element.
 */
const POPUP_LITERALS = [
  '3 of 4 live · 1 off · 1 site needs access',
  '2 of 4 live · 1 off · 1 blocked',
  '3 of 4 live, 1 off',
  '3 of 4 live, 1 off, 1 site needs access',
  '2 of 4 live, 1 off, 1 blocked',
] as const;

const sources = READMES.map((path) => [path, readFileSync(path, 'utf8')] as const);

describe('the five READMEs quote the popup identically', () => {
  it.each(POPUP_LITERALS)('every README carries %s', (literal) => {
    const missing = sources.filter(([, text]) => !text.includes(literal)).map(([path]) => path);
    expect(missing, `${missing.join(', ')} do not carry this literal`).toEqual([]);
  });

  /**
   * The exact defect that was shipped. `rules` between the count and `live` is
   * the string four files carried and the popup never rendered, so it is asserted
   * absent by name rather than left to the positive checks above — those would
   * pass on a file that carried both forms.
   */
  it('none of them says "rules live", which the popup does not render', () => {
    for (const [path, text] of sources) {
      expect(text, `${path} still says "rules live"`).not.toMatch(/\d+ of \d+ rules live/);
    }
  });

  /**
   * Line wrapping is what hid one of these: a literal broken across a newline
   * still renders correctly, so a reader cannot see the problem and a grep cannot
   * find the string. Markdown joins the lines; this test does not, deliberately —
   * an unbroken literal is what keeps it greppable and reviewable.
   */
  it('keeps each quoted literal on one line', () => {
    for (const [path, text] of sources) {
      for (const literal of POPUP_LITERALS) {
        const head = literal.slice(0, literal.indexOf(' ', 10));
        expect(text.includes(literal), `${path} wraps a line inside "${head}…"`).toBe(true);
      }
    }
  });
});
