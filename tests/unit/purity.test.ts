import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/** Auto-discovered: every new file in these directories is guarded for free. */
const AUTO_DISCOVERED = ['lib/compile', 'lib/view'].flatMap((dir) =>
  readdirSync(dir).filter((f) => f.endsWith('.ts')).map((f) => join(dir, f)),
);

/**
 * Hand-listed, because `lib/permissions/` also holds an adapter (`probe.ts`)
 * that must NOT be guarded — it imports the browser by design. There is no
 * directory-shaped rule to auto-discover here, so a new pure file in this
 * directory is guarded only if someone remembers to add it.
 *
 * That is why the entries are asserted by name below rather than by count.
 */
const EXPLICIT = [
  'lib/permissions/origins.ts',
  'lib/permissions/audit.ts',
];

const PURE_FILES = [...AUTO_DISCOVERED, ...EXPLICIT];

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
  it('auto-discovers every file in lib/compile', () => {
    // A count floor cannot catch a deletion once the list has grown past it,
    // so assert the set instead: this fails the moment a lib/compile file
    // stops being discovered, whatever the total happens to be.
    expect(AUTO_DISCOVERED).toEqual(
      expect.arrayContaining([
        'lib/compile/compile.ts',
        'lib/compile/conditions.ts',
        'lib/compile/conflicts.ts',
        'lib/compile/filterDiagnostics.ts',
        'lib/compile/headers.ts',
        'lib/compile/priority.ts',
        'lib/compile/suppression.ts',
        'lib/compile/validate.ts',
        'lib/view/rules.ts',
        'lib/view/singleProfile.ts',
        'lib/view/useCommittedDraft.ts',
      ]),
    );
  });

  it('still guards every hand-listed pure file', () => {
    // These are the ones a refactor can silently drop — nothing rediscovers
    // them. `toEqual` on the exact list means removing one turns this red.
    expect(EXPLICIT).toEqual([
      'lib/permissions/origins.ts',
      'lib/permissions/audit.ts',
    ]);
  });

  it('does not guard the permissions adapter — it imports the browser by design', () => {
    expect(PURE_FILES).not.toContain('lib/permissions/probe.ts');
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
