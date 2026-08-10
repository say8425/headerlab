import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { assertBuildFresh } from '../support/build';

/**
 * "No network calls" is the reason this extension exists. Reads the **build**,
 * not the sources: the one instance there has ever been came from a bundler
 * (Vite's modulepreload polyfill), not from authored code.
 */

/**
 * Call and construction forms, never bare words. `fetch`, `websocket` and
 * `xmlhttprequest` all occur as harmless substrings — React DOM's preload
 * helpers, and two DNR resource-type names the popup offers as checkboxes — so
 * matching words would need the exception list this claim promises there is
 * none of.
 */
const FORBIDDEN: ReadonlyArray<readonly [string, RegExp]> = [
  ['fetch(', /\bfetch\s*\(/],
  ['XMLHttpRequest', /\bXMLHttpRequest\b/],
  ['WebSocket', /\bWebSocket\b/],
  ['sendBeacon', /\bsendBeacon\b/],
  ['EventSource', /\bEventSource\b/],
];

function bundleFiles(): Array<{ file: string; source: string }> {
  const dir = assertBuildFresh('production');
  const out: Array<{ file: string; source: string }> = [];
  for (const entry of readdirSync(dir, { withFileTypes: true, recursive: true })) {
    if (!entry.isFile()) continue;
    if (/\.(png|jpg|jpeg|gif|webp|woff2?|ttf|ico)$/i.test(entry.name)) continue;
    const full = path.join(entry.parentPath, entry.name);
    out.push({ file: path.relative(dir, full), source: readFileSync(full, 'utf8') });
  }
  return out;
}

describe('the shipped bundle', () => {
  it('has files to read, so an empty build cannot satisfy the checks below', () => {
    const files = bundleFiles();
    expect(files.length).toBeGreaterThan(0);
    expect(files.some((f) => f.file.endsWith('.js'))).toBe(true);
  });

  it.each(FORBIDDEN)('calls no %s anywhere in the build', (_name, pattern) => {
    const offenders = bundleFiles()
      .filter((f) => pattern.test(f.source))
      .map((f) => f.file);
    expect(offenders).toEqual([]);
  });

  // The checks above are all "expect nothing", which passes just as happily
  // when a pattern is broken. These two pin the patterns themselves.
  it('matches every forbidden form when it is present', () => {
    const planted =
      'await fetch(u); new XMLHttpRequest(); new WebSocket(u); navigator.sendBeacon(u); new EventSource(u);';
    for (const [name, pattern] of FORBIDDEN) {
      expect(pattern.test(planted), `${name} matched nothing`).toBe(true);
    }
  });

  it('matches none of the benign substrings the bundle really contains', () => {
    const benign = 'prefetchDNS fetchPriority "dns-prefetch" "websocket" "xmlhttprequest"';
    for (const [name, pattern] of FORBIDDEN) {
      expect(pattern.test(benign), `${name} falsely matched`).toBe(false);
    }
  });
});

/**
 * Every colour the palette declares is painted by something.
 *
 * `COLOR_TOKENS` in `contrast.test.ts` catches **declaration drift** — a token
 * present in one palette and missing from the other. It cannot catch an
 * **orphan**: a token both palettes declare, the inventory requires, and
 * nothing paints. Proven both ways while removing one — put the token back in
 * a palette alone and the count assertion goes red; put it back in the palette
 * *and* the inventory, which is exactly the state before its deletion, and all
 * 128 pairs stay green while the built CSS contains no `var()` for it.
 *
 * Three tokens were removed that way on the design-system branch —
 * `--pending-border`, `--live-bg`, `--destructive-bg` — and every one was found
 * by a human grepping the build, never by a test. This is that grep, written
 * down.
 *
 * Derived from the stylesheet rather than from a hand-kept list, so a token
 * added tomorrow is covered without anyone remembering to add it here — the
 * same bargain `purity.test.ts` strikes with its two auto-discovered
 * directories.
 *
 * Colours only, decided by the value rather than by a name list: `--radius` is
 * genuinely used but never survives as `var(--radius)` (Tailwind's `@theme`
 * computes the radius scale from it and inlines the result), and the two font
 * tokens resolve through their own bridge. Keying on "the value is a hex
 * colour" excludes those three without an exception list to maintain.
 */
describe('the palette', () => {
  const HEX_DECLARATION = /^\s*(--[a-z0-9-]+)\s*:\s*(#[0-9a-f]{3,8})\s*;/gim;

  function declaredColours(): string[] {
    const css = readFileSync(path.join(process.cwd(), 'entrypoints/popup/style.css'), 'utf8');
    return [...new Set([...css.matchAll(HEX_DECLARATION)].map((m) => m[1]!))];
  }

  function builtCss(): string {
    return bundleFiles()
      .filter((f) => f.file.endsWith('.css'))
      .map((f) => f.source)
      .join('\n');
  }

  it('declares colours to check, so an empty match cannot satisfy the check below', () => {
    // Without this, a regex that stopped matching would make the next test
    // pass by looking at nothing — the failure this repo keeps catching.
    expect(declaredColours().length).toBeGreaterThan(20);
  });

  it('paints every colour it declares', () => {
    const css = builtCss();
    const orphans = declaredColours().filter((token) => !css.includes(`var(${token})`));
    expect(orphans).toEqual([]);
  });
});
