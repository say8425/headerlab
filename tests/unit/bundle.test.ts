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
