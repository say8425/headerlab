import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { REPO_ROOT } from '../support/build';

/**
 * Holds the five Chrome Web Store descriptions to one shape.
 *
 * The store renders no Markdown in a description — it keeps line breaks and
 * nothing else — so a stray `**` or `-` reaches the listing as literal junk, and
 * a bullet lost in translation reaches it as a missing feature. Neither shows up
 * anywhere before the listing is live, which is what makes this worth a test
 * rather than a proofread.
 *
 * Reads sources rather than the build: none of this ships in the extension.
 * `packages/headerlab/test/docs.test.mjs` is the precedent — it holds the five
 * READMEs together by their commands for the same reason, that prose is
 * translated and structure is not.
 */

const STORE = path.join(REPO_ROOT, 'docs', 'store');
const LOCALES_DIR = path.join(REPO_ROOT, 'public', '_locales');

/**
 * Kept verbatim in every language: an API name, a licence, a URL and a button
 * label are not prose. `main_frame` and `Grant` are values the user types
 * nowhere but reads in the popup, so a translated one would name a checkbox or
 * a button that does not exist.
 *
 * Neither is localizable even in principle, which is what makes pinning them
 * the whole guard rather than a nicety: every file under `public/_locales/`
 * carries exactly one key, `extDescription`, so the popup UI ships in English
 * in every locale — `Grant` is literal JSX in `components/SiteRow.tsx` and
 * `components/ScopeRail.tsx`. `Grant` was added on 2026-08-22, when cutting the
 * install-time permission paragraph left the button one of the few carriers of
 * the trust posture still in the listing; a locale rendering it 허용 or 授权
 * would name a nonexistent button and delete that claim, with nothing failing.
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
 * The shape of a description with its words removed: `B` a bullet, `_` a blank
 * line, `T` anything else.
 *
 * Comparing this rather than counting bullets catches more than a count would:
 * a bullet dropped, gained, or rewritten as a `-`, two paragraphs merged, a
 * blank line lost between sections. All of those move a character in the
 * skeleton while leaving a bullet tally intact.
 *
 * **What it does not catch, measured rather than assumed: two bullets that swap
 * places.** Mutation-checked by exchanging the first bullet of "what it does"
 * with the first of "what it does not do" in the Japanese file — a claim
 * changing sides — and all seven tests here stayed green. The skeleton is
 * positional, so an exchange leaves it byte-identical. Catching that means
 * comparing meaning across five languages, which no assertion in this file
 * attempts; the reviewer stage of the translation workflow is what looked at it,
 * and a human is what looks at it next time. Said here rather than left for
 * someone to discover, because a guard believed to cover something it does not
 * is worse than no guard.
 */
const skeleton = (text: string): string =>
  text
    .split('\n')
    .map((line) => (line.trim() === '' ? '_' : line.startsWith('•') ? 'B' : 'T'))
    .join('');

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

/** Locales the package declares, which is the only thing the store will offer. */
const packageLocales = (): string[] => readdirSync(LOCALES_DIR).sort();

describe('the store descriptions', () => {
  it('exist for exactly the locales the package declares', () => {
    // Derived from `public/_locales/` rather than pinned as a list, and checked
    // in both directions. A locale added to the package with no copy written
    // gets a listing that silently falls back to English; copy written for a
    // locale the package does not declare can never be uploaded at all, because
    // the dashboard's language dropdown only offers what the zip carries.
    const written = readdirSync(STORE)
      .map((file) => /^description\.(.+)\.md$/.exec(file)?.[1])
      .filter((locale): locale is string => locale !== undefined)
      .sort();

    expect(written).toEqual(packageLocales());
  });

  it('has the same line-for-line shape in every language', () => {
    // Measured before it was asserted: all five are 26 lines with 9 bullets in
    // identical positions. Translations of these paragraphs do not re-wrap —
    // each paragraph is one line — so exact parity is reachable rather than
    // aspirational, and anything less would let a merged paragraph through.
    //
    // The literal is a snapshot of a deliberate shape, not a constant. It read
    // 37 lines and 11 bullets until 2026-08-22, when the agent bridge was
    // promoted out of a trailing "optional" paragraph into a section of its
    // own; the owner then cut the listing to this, dropping the opening
    // use-case paragraph, the whole "nothing fails quietly" section, the
    // install-time permission paragraph and the sentence introducing the
    // repository URL. Edit it when the shape is meant to change — and change
    // all five files in the same commit, which is what the loop below is for.
    const english = skeleton(description('en'));
    expect(english).toBe('T_T_BBBBB_T_T_T_T_BBBB_T_T');

    for (const locale of packageLocales()) {
      expect(skeleton(description(locale)), `docs/store/description.${locale}.md`).toBe(english);
    }
  });

  it('keeps every API name, licence, URL and button label untranslated', () => {
    for (const locale of packageLocales()) {
      const text = description(locale);
      const missing = VERBATIM.filter(([, pattern]) => !pattern.test(text)).map(([what]) => what);
      expect(missing, `missing from description.${locale}.md`).toEqual([]);
    }
  });

  it('carries no Markdown, which the store would render as literal characters', () => {
    for (const locale of packageLocales()) {
      const leaks = description(locale)
        .split('\n')
        .flatMap((line) =>
          MARKDOWN.filter(([, pattern]) => pattern.test(line)).map(([what]) => `${what}: ${line}`),
        );
      expect(leaks, `Markdown in description.${locale}.md`).toEqual([]);
    }
  });
});

describe('the summary table in listing.md', () => {
  /**
   * `listing.md` prints each locale's summary and its length so the listing can
   * be checked without running anything. CLAUDE.md is a long record of measured
   * numbers going stale in the file that measured them, so the table is compared
   * against the message files rather than trusted.
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

  const messageSummary = (locale: string): string =>
    JSON.parse(readFileSync(path.join(LOCALES_DIR, locale, 'messages.json'), 'utf8')).extDescription
      .message;

  it('lists every locale the package declares, and no others', () => {
    expect(
      rows()
        .map((row) => row.locale)
        .sort(),
    ).toEqual(packageLocales());
  });

  it('quotes each summary exactly as the package ships it', () => {
    // The failure this catches is a summary edited in `messages.json` — the only
    // place editing it has any effect — while the table goes on showing the old
    // text to whoever is filling in the listing.
    //
    // The length assertion is not decoration. `rows()` is a regex over Markdown,
    // so reformatting the table stops it matching, and a loop over nothing
    // passes. The locale-set test above would catch that too, but a test that
    // only fails because of its neighbour is a test that cannot fail.
    expect(rows()).toHaveLength(packageLocales().length);
    for (const row of rows()) {
      expect(row.summary, `listing.md row for ${row.locale}`).toBe(messageSummary(row.locale));
    }
  });

  it('states a length that is the length', () => {
    // Code points, matching tests/unit/i18n.test.ts. Both readings agree while
    // every message stays inside the BMP, which that file is what guarantees.
    expect(rows()).toHaveLength(packageLocales().length);
    for (const row of rows()) {
      expect([...messageSummary(row.locale)].length, `listing.md length for ${row.locale}`).toBe(
        row.length,
      );
    }
  });
});
