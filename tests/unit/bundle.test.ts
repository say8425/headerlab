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
 * Every token the palette declares is named by something the build scans.
 *
 * `COLOR_TOKENS` in `contrast.test.ts` catches **declaration drift** — a token
 * present in one palette and missing from the other. It cannot catch an
 * **orphan**: a token both palettes declare, the inventory requires, and
 * nothing uses. Proven both ways while removing one — put the token back in a
 * palette alone and the count assertion goes red; put it back in the palette
 * *and* the inventory, which is exactly the state before its deletion, and all
 * 128 pairs stay green while the built CSS contains no `var()` for it.
 *
 * Four tokens have been removed that way — `--pending-border`, `--live-bg`,
 * `--destructive-bg` on the design-system branch, and `--radius`, which the
 * first draft of *this* test excluded on a false premise and thereby hid. Every
 * one was found by a human grepping the build, never by a test. This is that
 * grep, written down.
 *
 * **What it establishes, exactly:** no token is declared that nothing in the
 * scanned source even *names*. It is not "reaches the screen" and must not be
 * read as that. Tailwind scans source text, not a render tree, so a utility
 * written in a comment, or on a component that never mounts, still emits the
 * rule and still satisfies this check — measured. The narrower claim is the one
 * that has shipped four times, so it is the one worth holding.
 *
 * Derived from the stylesheet, and with **no exclusion list at all**: every
 * custom property either palette declares must appear. The first draft keyed on
 * "the value is a hex colour" to skip three non-colours, and the justification
 * for skipping `--radius` was wrong in both of its clauses — nothing referenced
 * `var(--radius)` and no `@theme` entry derived the radius scale from it
 * (Tailwind's stock `--radius-sm/md/lg` were doing that work, unchanged when
 * `--radius` was set to `99px`). An exception list is a place for an orphan to
 * hide, which is what happened; without one there is nowhere to hide.
 */
describe('the palette', () => {
  /**
   * The two palette blocks, and only those. `@theme inline` declares a
   * `--color-*` bridge per token, and Tailwind inlines those rather than
   * emitting `var(--color-x)` — including them would report all 23 as orphans
   * and the check would have to grow the exception list this test exists
   * without.
   */
  const PALETTE_BLOCK = /^(?::root|\.dark)\s*\{([\s\S]*?)^\}/gim;
  const DECLARATION = /^\s*(--[a-z0-9-]+)\s*:\s*[^;]+;/gim;

  function declaredTokens(): string[] {
    const css = readFileSync(path.join(process.cwd(), 'entrypoints/popup/style.css'), 'utf8');
    const palettes = [...css.matchAll(PALETTE_BLOCK)].map((m) => m[1]!).join('\n');
    return [...new Set([...palettes.matchAll(DECLARATION)].map((m) => m[1]!))];
  }

  function builtCss(): string {
    return bundleFiles()
      .filter((f) => f.file.endsWith('.css'))
      .map((f) => f.source)
      .join('\n');
  }

  it('declares tokens to check, so an empty match cannot satisfy the check below', () => {
    // Without this, a derivation that stopped matching would make the next test
    // pass by looking at nothing — the failure this repo keeps catching.
    expect(declaredTokens().length).toBeGreaterThan(20);
  });

  it('has something naming every token it declares', () => {
    const css = builtCss();
    const orphans = declaredTokens().filter((token) => !css.includes(`var(${token})`));
    expect(orphans).toEqual([]);
  });
});
