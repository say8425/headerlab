import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const PURE_FILES = [
  ...readdirSync('lib/compile').filter((f) => f.endsWith('.ts')).map((f) => join('lib/compile', f)),
  'lib/permissions/origins.ts',
  'lib/permissions/audit.ts',
];

const FORBIDDEN = [
  /\bchrome\s*\./,
  /from\s+['"]webextension-polyfill['"]/,
  /from\s+['"]wxt\/browser['"]/,
  /from\s+['"]#imports['"]/,
  /from\s+['"]wxt\/utils\/storage['"]/,
];

/**
 * Removes block and line comments so the guard tests code rather than prose.
 *
 * Without this, a comment documenting the constraint — "imports nothing from
 * chrome.*" — trips the guard it is describing. The comment is good; forbidding
 * it would be wrong.
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

describe('the pure layer stays pure', () => {
  it('finds the files it is supposed to guard', () => {
    expect(PURE_FILES.length).toBeGreaterThanOrEqual(5);
  });

  it.each(PURE_FILES)('%s has no browser dependency', (path) => {
    const source = stripComments(readFileSync(path, 'utf8'));
    for (const pattern of FORBIDDEN) {
      expect(source, `${path} matched ${pattern}`).not.toMatch(pattern);
    }
  });
});

describe('the guard itself', () => {
  it('ignores a browser name that appears only in a comment', () => {
    const source = stripComments(`
      /** Pure: imports nothing from chrome.*, performs no I/O. */
      // also not a real use: chrome.runtime
      export const x = 1;
    `);
    expect(source).not.toMatch(/\bchrome\s*\./);
  });

  it('still catches a real browser reference', () => {
    const source = stripComments(`export const id = chrome.runtime.id;`);
    expect(source).toMatch(/\bchrome\s*\./);
  });

  it('does not mistake a url inside a string for a line comment', () => {
    const source = stripComments(`export const u = 'https://example.com/a';`);
    expect(source).toContain('https://example.com/a');
  });
});
