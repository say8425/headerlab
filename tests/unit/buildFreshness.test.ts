import { mkdtempSync, readFileSync, readdirSync, rmSync, utimesSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { REPO_ROOT, isStale, oldestOutputMtime, sourceFiles } from '../support/build';

/**
 * Guards the guard.
 *
 * tests/support/build.ts is what stops theme.test.ts, manifest.test.ts and the
 * E2E suite reporting a result computed against a stale build. A check like that
 * fails in one direction only — quietly, by no longer noticing — so the parts of
 * it that could drift are asserted here rather than assumed.
 */

const scratch = mkdtempSync(path.join(tmpdir(), 'headerlab-freshness-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

describe('the staleness comparison', () => {
  const source = { file: 'lib/compile/compile.ts', mtimeMs: 1_000 };

  it('calls a build stale when a source is newer than it', () => {
    expect(isStale(999, source)).toBe(true);
  });

  it('calls a build fresh when it postdates every source', () => {
    expect(isStale(1_001, source)).toBe(false);
  });

  it('treats an exact tie as fresh — the build was reading that source as it ran', () => {
    expect(isStale(1_000, source)).toBe(false);
  });

  it('cannot be stale against nothing', () => {
    expect(isStale(0, undefined)).toBe(false);
  });
});

describe('the build timestamp', () => {
  it('is the oldest file in the output, including nested ones', () => {
    const dir = path.join(scratch, 'out');
    mkdirSync(path.join(dir, 'chunks'), { recursive: true });
    writeFileSync(path.join(dir, 'manifest.json'), '{}');
    writeFileSync(path.join(dir, 'chunks', 'popup.js'), '');

    // Seconds apart so the assertion cannot ride on filesystem timestamp
    // granularity. The nested file is the older one on purpose: a walk that
    // stopped at the top level would return the newer mtime and call a build
    // fresh that is only half-rebuilt.
    utimesSync(path.join(dir, 'manifest.json'), new Date(20_000), new Date(20_000));
    utimesSync(path.join(dir, 'chunks', 'popup.js'), new Date(10_000), new Date(10_000));

    expect(oldestOutputMtime(dir)).toBe(10_000);
  });

  it('reports a directory that does not exist as no build at all', () => {
    expect(oldestOutputMtime(path.join(scratch, 'never-built'))).toBe(Infinity);
  });

  it('reports an empty directory the same way — a build with no files is not a build', () => {
    const dir = path.join(scratch, 'empty');
    mkdirSync(dir, { recursive: true });
    expect(oldestOutputMtime(dir)).toBe(Infinity);
  });
});

/** Every file under `dir`, repo-relative, in the same shape `sourceFiles()` returns. */
function walk(dir: string): string[] {
  return readdirSync(path.join(REPO_ROOT, dir), { withFileTypes: true, recursive: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.relative(REPO_ROOT, path.join(entry.parentPath, entry.name)));
}

describe('the source set', () => {
  const files = new Set(sourceFiles());

  // Not a hand-written list of the files themselves — that is the failure being
  // guarded against. These are the roots of the build's module graph, and the
  // assertion is that the set covers whatever is inside them *today*, so a
  // directory added next week is covered without anyone remembering this file.
  it.each(['entrypoints', 'components', 'lib', 'public'])(
    'covers every file under %s/, whatever appears there later',
    (dir) => {
      const missing = walk(dir).filter((file) => !files.has(file));
      expect(missing).toEqual([]);
    },
  );

  it('covers the config files that change the output without being imported', () => {
    for (const file of ['wxt.config.ts', 'vite.config.ts', 'package.json', 'package-lock.json']) {
      expect(files).toContain(file);
    }
  });

  it('excludes the build outputs it is compared against — otherwise nothing is ever stale', () => {
    const outputs = [...files].filter((f) => f.startsWith('.output/') || f.startsWith('.wxt/'));
    expect(outputs).toEqual([]);
  });

  it('excludes dependencies, which are gitignored and would dominate every walk', () => {
    expect([...files].filter((f) => f.startsWith('node_modules/'))).toEqual([]);
  });

  it('is not empty — an empty set would report every build as fresh forever', () => {
    expect(files.size).toBeGreaterThan(20);
  });
});

describe('the tests/ carve-out', () => {
  // tests/ is left out of the source set so that editing a test does not report
  // itself as a stale build. That is only sound while nothing shipped can reach
  // it; if it ever could, a test edit would change the output and the guard
  // would say fresh. Checked rather than asserted in prose.
  const shipped = ['entrypoints', 'components', 'lib']
    .flatMap(walk)
    .filter((file) => /\.(ts|tsx)$/.test(file));

  it('found the shipped files to check', () => {
    expect(shipped.length).toBeGreaterThan(10);
  });

  it('is sound: nothing shipped imports from tests/', () => {
    const importers = shipped.filter((file) =>
      /from\s+['"][^'"]*\btests\//.test(readFileSync(path.join(REPO_ROOT, file), 'utf8')),
    );
    expect(importers).toEqual([]);
  });
});
