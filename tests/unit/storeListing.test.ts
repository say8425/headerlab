import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { REPO_ROOT, readBuildFile } from '../support/build';

/**
 * Holds the Chrome Web Store description to one shape.
 *
 * The store renders no Markdown in a description — it keeps line breaks and
 * nothing else — so a stray `**` or `-` reaches the listing as literal junk.
 * That does not show up anywhere before the listing is live, which is what
 * makes it worth a test rather than a proofread.
 *
 * **This file used to hold five descriptions to one shape.** The package
 * declared five locales, so the dashboard offered five listings; it declares
 * none since 2026-08-23 (see `tests/unit/manifest.test.ts`), so there is one
 * description and the parity half of this file is gone rather than looping over
 * a single element. What survives is every claim that was about the copy itself
 * rather than about agreement between copies.
 *
 * Reads sources rather than the build, with one exception marked below: none of
 * this ships in the extension.
 */

const STORE = path.join(REPO_ROOT, 'docs', 'store');

/**
 * Kept verbatim: an API name, a licence, a URL and a button
 * label are not prose. `main_frame` and `Grant` are values the user types
 * nowhere but reads in the popup, so a translated one would name a checkbox or
 * a button that does not exist.
 *
 * `Grant` is a literal string in `components/SiteRow.tsx` and
 * `components/ScopeRail.tsx`. Copy that spells it any other way names a button
 * nobody can find, and takes a trust-posture claim with it.
 *
 * **Which claim is worth stating exactly, because the obvious guess is wrong.**
 * `Grant` occurs once, and it is the all-sites bullet — so what it carries is
 * that the mode costs access to every site and the switch does not ask for it,
 * a separate button does. That is the largest grant this extension can request,
 * which makes it the sharper of the two claims rather than the looser one. The
 * per-site claim is the first line's lowercase "until you grant it": prose, and
 * correctly not pinned here. In the popup the button really is both, rendered
 * on a site row and on the all-sites bar — but this list is about what the
 * listing says, and the listing names it once. Since the install-time
 * permission paragraph was cut, that bullet is one of the few places the claim
 * still appears at all.
 *
 * (This paragraph used to argue from `public/_locales/` — that every locale
 * file carried one key, so the UI shipped English everywhere. The package
 * declares no locales since 2026-08-23, and the surviving claim needs no
 * locales to stand: the listing has to spell these as the product does.)
 *
 * **A permission string was in that sentence, and in this list, until
 * 2026-08-22.** Both went when the owner cut the paragraph that carried
 * `"storage"` and `"declarativeNetRequestWithHostAccess"` out of the listing.
 * Naming the removal here rather than quietly shortening the sentence, because
 * the sentence is what the next person reads to learn what this guard covers —
 * and a guard believed to cover something it does not is worse than no guard.
 *
 * Patterns rather than strings, each with the name to print when it is missing,
 * because one of them cannot be expressed as a substring check — see below.
 */
const VERBATIM: ReadonlyArray<readonly [string, RegExp]> = [
  ['HeaderLab', /HeaderLab/],
  // Not the plain string, and the lookahead outlived the reason it was written.
  // `"storage"` and `"declarativeNetRequestWithHostAccess"` were entries here
  // until 2026-08-22, when the owner cut the paragraph that carried them; the
  // permission string was `declarativeNetRequest`'s neighbour in this list, and
  // an `includes` check on the bare name passed on that neighbour alone —
  // mutation-proven then by deleting every bare mention from a description and
  // watching all seven tests stay green.
  //
  // Kept rather than simplified back to a plain string, because the paragraph
  // is the kind of thing that comes back: with the lookahead, a listing that
  // names only the permission does not satisfy the API name, which is the
  // failure the lookahead was built for and would silently return without it.
  [
    'declarativeNetRequest (the API, not the permission)',
    /declarativeNetRequest(?!WithHostAccess)/,
  ],
  ['main_frame', /main_frame/],
  ['Grant', /Grant/],
  ['Apache-2.0', /Apache-2\.0/],
  ['the repository URL', /https:\/\/github\.com\/say8425\/headerlab/],
];

/** The description to paste, out of its fenced block. */
function description(locale: string): string {
  const file = path.join(STORE, `description.${locale}.md`);
  const fenced = /```text\n([\s\S]*?)\n```/.exec(readFileSync(file, 'utf8'));
  if (!fenced) throw new Error(`docs/store/description.${locale}.md has no \`\`\`text block.`);
  return fenced[1]!;
}

/**
 * Markdown the store would hand to the reader as literal characters, each paired
 * with what to call it when it fires.
 *
 * The first draft of this was one line — block markup at the start of a line,
 * plus a backtick or a doubled asterisk anywhere — and its comment claimed `*`
 * reached the reader as itself. Measured against a table of forms, it missed
 * three: a mid-line `*emphasis*`, a mid-line `_emphasis_`, and `[text](url)`.
 * The comment was the thing that was wrong, so the patterns were widened rather
 * than the claim narrowed.
 *
 * **The underscore rule cannot simply ban `_`.** `main_frame` is one of the
 * strings this file separately requires every locale to carry verbatim, and its
 * underscore sits between two word characters. Markdown's does not: emphasis
 * opens and closes at a word boundary, which is exactly what this matches and
 * `main_frame` is exactly what it does not.
 *
 * `•` is the intended bullet and appears in no pattern here.
 */
const MARKDOWN: ReadonlyArray<readonly [string, RegExp]> = [
  ['block markup', /^\s*(#|-\s|>|\d+\.)/],
  ['an asterisk or a backtick', /[`*]/],
  ['an underscore at a word boundary', /(^|\s)_|_(\s|$)/],
  ['link syntax', /\[[^\]]*\]\([^)]*\)/],
];

/**
 * The description's line shape, as a string: `T` for a text line, `B` for a
 * bullet, `_` for a blank.
 *
 * This helper carried two jobs and only one of them died with the
 * translations. Cross-language parity is gone — there is one file. The English
 * shape is not: the owner cut this description to a deliberate 26 lines and 9
 * bullets on 2026-08-22, and nothing else here sees structure. `MARKDOWN`
 * catches a stray marker and `VERBATIM` catches a vanished API name; a merged
 * paragraph or a dropped bullet is invisible to both.
 */
const skeleton = (text: string): string =>
  text
    .split('\n')
    .map((line) => (line.trim() === '' ? '_' : line.startsWith('•') ? 'B' : 'T'))
    .join('');

describe('the store description', () => {
  it('keeps the shape the owner cut it to', () => {
    // A snapshot of a deliberate shape, not a constant — edit it when the shape
    // is meant to change. It read 37 lines and 11 bullets until 2026-08-22.
    expect(skeleton(description('en'))).toBe('T_T_BBBBB_T_T_T_T_BBBB_T_T');
  });

  it('is the only one — English, and nothing beside it', () => {
    // Both directions still matter with one locale. A leftover translation is
    // copy that can never be uploaded, because the dashboard's language
    // dropdown only offers what the zip carries and the zip carries no
    // locales; a missing `en` is a listing with nothing to paste.
    const written = readdirSync(STORE)
      .map((file) => /^description\.(.+)\.md$/.exec(file)?.[1])
      .filter((locale): locale is string => locale !== undefined)
      .sort();

    expect(written).toEqual(['en']);
  });

  it('spells every API name, licence, URL and button label as the product does', () => {
    // This was "keeps them untranslated", and the surviving claim is the
    // stronger half of that: the listing has to match the product byte for
    // byte, so copy that drifts from the popup is caught here whether or not
    // anything is being translated.
    const text = description('en');
    const missing = VERBATIM.filter(([, pattern]) => !pattern.test(text)).map(([what]) => what);
    expect(missing, 'missing from description.en.md').toEqual([]);
  });

  it('carries no Markdown, which the store would render as literal characters', () => {
    const leaks = description('en')
      .split('\n')
      .flatMap((line) =>
        MARKDOWN.filter(([, pattern]) => pattern.test(line)).map(([what]) => `${what}: ${line}`),
      );
    expect(leaks, 'Markdown in description.en.md').toEqual([]);
  });
});

describe('the summary table in listing.md', () => {
  /**
   * `listing.md` prints the summary and its length so the listing can be checked
   * without running anything. CLAUDE.md is a long record of measured numbers
   * going stale in the file that measured them, so the table is compared against
   * the real value rather than trusted.
   *
   * **The comparison source moved.** The summary used to live in
   * `public/_locales/en/messages.json`; it is now a string literal in
   * `wxt.config.ts`, and parsing TypeScript with a regex to find it would be a
   * worse guard than the one it replaces. So this reads the built manifest —
   * the only exception to this file's source-only rule, and the value the store
   * actually receives.
   */
  const rows = (): Array<{ locale: string; length: number; summary: string }> =>
    [
      ...readFileSync(path.join(STORE, 'listing.md'), 'utf8').matchAll(
        /^\| `(\w+)` \| (\d+) \| (.+?) \|$/gm,
      ),
    ].map(([, locale, length, summary]) => ({
      locale: locale!,
      length: Number(length),
      summary: summary!,
    }));

  const shippedSummary = (): string =>
    JSON.parse(readBuildFile('production', 'manifest.json')).description;

  it('quotes the summary, and its length, exactly as the package ships it', () => {
    // Three tests before the package stopped declaring locales — one for the
    // locale set, one for the text, one for the length. The locale set is gone
    // with the locales; the other two are one claim about one row.
    //
    // `toHaveLength(1)` is the floor and is not decoration. `rows()` is a regex
    // over Markdown, so reformatting the table stops it matching and a loop
    // over nothing passes — a risk that grew, not shrank, now that there is a
    // single row to lose.
    expect(rows()).toHaveLength(1);
    const row = rows()[0]!;
    expect(row.locale).toBe('en');
    expect(row.summary, 'listing.md summary row').toBe(shippedSummary());
    // UTF-16 units, matching the limit assertion in manifest.test.ts — the
    // reading that cannot under-report whichever way the store counts.
    expect(shippedSummary().length, 'listing.md length column').toBe(row.length);
  });
});
