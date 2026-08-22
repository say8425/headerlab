import { readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { assertBuildFresh, readBuildFile } from '../support/build';

/**
 * Guards the localization the **Chrome Web Store listing** rests on, not the
 * popup's UI — the popup is English in every locale and deliberately so.
 *
 * The store reads an item's title and its summary out of the manifest; neither
 * is a dashboard field. And the dashboard's language dropdown offers a listing
 * translation only for a locale the uploaded package declares under
 * `_locales/`. So the five-language listing exists because of these files, and
 * a change here silently costs four listings rather than failing anything.
 *
 * Reads the **build**, like manifest.test.ts and bundle.test.ts: the message
 * files are copied from `public/`, so a source-level check would pass on a
 * build that never shipped them.
 */

/** Every locale the store listing is written in. Chrome's own locale codes. */
const LOCALES = ['en', 'es', 'ja', 'ko', 'zh_CN'] as const;

/**
 * The Chrome Web Store's documented ceiling for the summary.
 *
 * Whether the store counts UTF-16 units or code points has **not** been
 * measured here — but the two readings agree for every string this package
 * currently ships, and the last assertion in this file is what keeps that true.
 * If a message ever needs a character outside the BMP, that assertion fails
 * first and this comment stops being a hand-wave.
 */
const SUMMARY_LIMIT = 132;

interface Message {
  message: string;
  description?: string;
}

function readManifest(): Record<string, unknown> {
  return JSON.parse(readBuildFile('production', 'manifest.json'));
}

function readMessages(locale: string): Record<string, Message> {
  return JSON.parse(readBuildFile('production', path.join('_locales', locale, 'messages.json')));
}

/** `__MSG_extDescription__` → `extDescription`; anything else → undefined. */
function messageKey(value: unknown): string | undefined {
  return typeof value === 'string' ? /^__MSG_(.+)__$/.exec(value)?.[1] : undefined;
}

describe('the manifest half of the store listing', () => {
  it('declares en as the default locale', () => {
    // Required, not decorative: a manifest carrying a `__MSG_` reference with
    // no `default_locale` is refused at load — Chrome does not fall back.
    expect(readManifest().default_locale).toBe('en');
  });

  it('points default_locale at a directory that actually shipped', () => {
    // The pair above and below can drift apart in either direction, and each
    // way is a broken extension rather than a broken listing. Pinning the two
    // strings separately would not have caught the drift; this asks the build.
    const dir = assertBuildFresh('production');
    const shipped = readdirSync(path.join(dir, '_locales'));
    expect(shipped).toContain(readManifest().default_locale);
  });

  it('localizes the description, which is the store summary', () => {
    // The assertion that fails if someone "simplifies" this back to a literal.
    // That change looks harmless — chrome://extensions would read the same in
    // English — while quietly removing the summary from four store listings.
    expect(readManifest().description).toBe('__MSG_extDescription__');
  });

  it('keeps the name a literal, so no locale file can fail the whole load', () => {
    // Nine characters, identical in every locale: a `__MSG_` name would buy
    // nothing and add a second key whose absence from any one file refuses the
    // extension outright. Pinned so that reasoning has to be re-argued rather
    // than quietly reversed.
    expect(readManifest().name).toBe('HeaderLab');
  });
});

describe('the message files', () => {
  it('ships exactly the five locales the listing is written in', () => {
    // Exact, not `toContain`. A sixth directory is a listing language nobody
    // wrote copy for — the dropdown would offer it and serve the English
    // default — and a fifth missing is a language silently dropped.
    const dir = assertBuildFresh('production');
    expect(readdirSync(path.join(dir, '_locales')).sort()).toEqual([...LOCALES].sort());
  });

  it('declares the same keys in every locale', () => {
    // The failure this exists for: a key added to `en` alone. Chrome resolves
    // `__MSG_x__` against the *active* locale and refuses to load when it is
    // missing there, so the extension breaks for exactly the users whose
    // language it was not added to — and never for the developer adding it.
    const keys = Object.fromEntries(
      LOCALES.map((locale) => [locale, Object.keys(readMessages(locale)).sort()]),
    );
    for (const locale of LOCALES) {
      expect(keys[locale], `_locales/${locale}/messages.json`).toEqual(keys.en);
    }
  });

  it('defines every key the manifest references, in every locale', () => {
    // Derived from the manifest rather than pinned as a list: a second
    // `__MSG_` reference added to the manifest tomorrow is covered here
    // without anyone remembering to widen this file.
    const referenced = Object.values(readManifest())
      .map(messageKey)
      .filter((key): key is string => key !== undefined);

    expect(referenced).toEqual(['extDescription']);
    for (const locale of LOCALES) {
      const messages = readMessages(locale);
      for (const key of referenced) {
        expect(messages[key]?.message, `${key} in _locales/${locale}`).toBeTruthy();
      }
    }
  });

  it('keeps every summary inside the store’s 132-character limit', () => {
    // Scoped to the key the manifest's `description` resolves to, so a future
    // message that is not a summary does not inherit a limit that is not its
    // own. Over the limit, the store rejects the upload — which is the good
    // case; the bad one is finding out per locale, four uploads in.
    const key = messageKey(readManifest().description);
    expect(key).toBe('extDescription');

    for (const locale of LOCALES) {
      const summary = readMessages(locale)[key!]!.message;
      expect([...summary].length, `_locales/${locale}: ${summary}`).toBeLessThanOrEqual(
        SUMMARY_LIMIT,
      );
    }
  });

  it('stays inside the BMP, which is what makes that limit unambiguous', () => {
    // The assertion holding up SUMMARY_LIMIT's comment. While every message is
    // BMP, "132 characters" reads the same whether the store counts UTF-16
    // units or code points, and this file does not have to know which. An
    // emoji lands the two readings two apart and fails here first, naming the
    // string, instead of failing at the store with a number nobody can
    // reproduce locally.
    for (const locale of LOCALES) {
      for (const [key, { message }] of Object.entries(readMessages(locale))) {
        expect([...message].length, `${key} in _locales/${locale}: ${message}`).toBe(
          message.length,
        );
      }
    }
  });

  // No "is it valid JSON" test: `readMessages` parses through `readBuildFile`,
  // so a malformed file already throws inside the four tests above. Such a test
  // could never fail on its own, and an assertion with no catching power is the
  // recurring defect this repo's testing notes name by hand.
});
