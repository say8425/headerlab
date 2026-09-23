import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
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

/**
 * The store badges under `## Install`, and the one thing about them a reader
 * cannot check: their `src` is relative to the file that carries it, so the
 * English README says `docs/badges/…` and the four in `docs/` say `badges/…`.
 *
 * **Why this exists.** That split is the shape a copy-paste gets wrong, and
 * nothing would say so. A sixth translation that copies the English form points
 * at `docs/docs/badges/…`; GitHub draws one broken-image icon and every check in
 * this repository stays green — the same silence that let two wrong claims sit in
 * four translations above. So this resolves each `src` against its own README's
 * directory and asks the filesystem, rather than matching a string that a wrong
 * path would satisfy just as well.
 *
 * It also pins what each badge links to. A badge is a picture of one store, and
 * a picture of one store linking the other is wrong in a way no reader checks
 * before clicking.
 */
const BADGES = [
  {
    file: 'chrome-web-store.png',
    href: 'https://chromewebstore.google.com/detail/headerlab/kgapijlldieckifoenckgninnepafhnn',
  },
  {
    file: 'firefox-add-ons.svg',
    href: 'https://addons.mozilla.org/firefox/addon/headerlab/',
  },
] as const;

/** Every `<a href="…"><img src="…"…></a>` pair, which is the badges' only form here. */
const BADGE_LINK = /<a href="([^"]+)"><img src="([^"]+)"[^>]*><\/a>/g;

describe('the five READMEs carry both store badges', () => {
  /** Both groups are required by the pattern, so a match always carries both. */
  const badgesIn = (text: string) =>
    [...text.matchAll(BADGE_LINK)].map((link) => ({ href: link[1]!, src: link[2]! }));

  it.each(sources.map(([path, text]) => [path, text] as const))(
    '%s links each badge to its own store',
    (_path, text) => {
      expect(badgesIn(text).map(({ href }) => href)).toEqual(BADGES.map(({ href }) => href));
    },
  );

  it.each(sources.map(([path, text]) => [path, text] as const))(
    '%s points at a badge file that exists, from its own directory',
    (path, text) => {
      const badges = badgesIn(text);
      expect(badges, `${path} carries ${badges.length} badges, not ${BADGES.length}`).toHaveLength(
        BADGES.length,
      );

      for (const [index, { src }] of badges.entries()) {
        const { file } = BADGES[index]!;
        expect(src, `${path} names some other file`).toBe(
          `${path === 'README.md' ? 'docs/' : ''}badges/${file}`,
        );

        const onDisk = resolve(dirname(path), src);
        expect(existsSync(onDisk), `${path} points at ${onDisk}, which is not there`).toBe(true);
      }
    },
  );

  /**
   * The five must reach the *same* two files. Resolving to something that exists
   * is not enough: a second copy of a badge under `docs/` would satisfy the check
   * above in every file that pointed at it, and then one store's artwork would be
   * committed here twice, to drift apart the next time one of them is updated.
   */
  it('resolves to one pair of files across all five', () => {
    const resolved = sources.map(([path, text]) =>
      badgesIn(text).map(({ src }) => resolve(dirname(path), src)),
    );

    for (const paths of resolved) expect(paths).toEqual(resolved[0]);
    expect(resolved[0]).toEqual(BADGES.map(({ file }) => resolve('docs/badges', file)));
  });
});
