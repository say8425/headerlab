import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { assertBuildFresh } from '../support/build';

/**
 * The product's central claim, finally guarded.
 *
 * "No network calls" is the reason this extension exists — it replaces one that
 * was pulled from the Web Store for shipping a hidden tracker. Until this file,
 * it was the only non-negotiable in CLAUDE.md with no test behind it: the
 * permission surface is pinned by manifest.test.ts, and this was a thing a
 * person had to remember to grep for. The Vite modulepreload polyfill, which
 * once left a dead `fetch(` in the bundle with nobody having written it, is the
 * proof that the risk arrives from tooling rather than from authored code —
 * exactly the kind of change no code review catches.
 *
 * Reads the **built** output rather than the sources, because the sources are
 * not what ships and a bundler is precisely the thing that can add a call
 * nobody wrote. `assertBuildFresh` refuses a stale build, so this cannot pass
 * against yesterday's bytes.
 */

/**
 * Call and construction forms, not bare words.
 *
 * `fetch` and `websocket` both appear in the bundle as harmless substrings —
 * React DOM ships `prefetchDNS`, `fetchPriority` and the string `dns-prefetch`,
 * and `"websocket"` and `"xmlhttprequest"` are two of Chrome's
 * declarativeNetRequest resource-type names, which this extension lets you
 * filter on and therefore must contain. A word-level search reports about
 * fourteen of those and would have to be answered with an exception list —
 * which is the thing CLAUDE.md promises there isn't one of.
 *
 * So the patterns match what a *call* looks like after minification instead.
 * `fetch(` covers `fetch(url)` and `window.fetch(...)`; the constructor forms
 * cover `new WebSocket(...)` however the minifier spells its whitespace.
 * `sendBeacon` and `XMLHttpRequest` are case-sensitive identifiers that no
 * benign string in this bundle spells.
 */
const FORBIDDEN: ReadonlyArray<readonly [string, RegExp]> = [
  ['fetch(', /\bfetch\s*\(/],
  ['XMLHttpRequest', /\bXMLHttpRequest\b/],
  ['WebSocket', /\bWebSocket\b/],
  ['sendBeacon', /\bsendBeacon\b/],
  ['EventSource', /\bEventSource\b/],
  ['navigator.connection-style beacon', /\bnavigator\s*\.\s*sendBeacon\b/],
];

/** Every text file in the build — JS, HTML, JSON, CSS. Icons are skipped. */
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
  it('contains files to check — so an empty build cannot pass this suite vacuously', () => {
    // Without this, a build that emitted nothing would satisfy every assertion
    // below by having nothing to violate them. The exact count is deliberately
    // not pinned: this asserts that there is something to read, not what.
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

  it('finds the patterns when they are actually present — the guard is not inert', () => {
    // The assertions above are all "expect nothing", which is the shape that
    // passes just as happily when the matcher is broken as when the bundle is
    // clean. This checks the matchers themselves against text known to contain
    // each form, so a regex edited into uselessness fails here rather than
    // going quiet.
    const planted =
      'await fetch(u); new XMLHttpRequest(); new WebSocket(u); navigator.sendBeacon(u); new EventSource(u);';
    for (const [name, pattern] of FORBIDDEN) {
      expect(pattern.test(planted), `${name} pattern matched nothing in planted source`).toBe(true);
    }
  });

  it('does not mistake the benign substrings the bundle really does contain', () => {
    // Named rather than implied. These are the strings a reader running a
    // word-level grep will find, and the reason the patterns above are written
    // as calls: React DOM's preload helpers, and the two declarativeNetRequest
    // resource types the popup offers as checkboxes.
    const benign = 'prefetchDNS fetchPriority "dns-prefetch" "websocket" "xmlhttprequest"';
    for (const [name, pattern] of FORBIDDEN) {
      expect(pattern.test(benign), `${name} pattern falsely matched a benign substring`).toBe(
        false,
      );
    }
  });
});
