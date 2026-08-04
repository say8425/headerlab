import { execFileSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { REPO_ROOT, isStale, newestSource, oldestOutputMtime, sourceFiles } from '../support/build';

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

/** The instant the imaginary build in the fixture cases below finished. */
const BUILT_MS = Date.parse('2020-01-01T00:00:00Z');

function write(root: string, files: Record<string, string>): void {
  for (const [file, contents] of Object.entries(files)) {
    const full = path.join(root, file);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, contents);
  }
}

/**
 * A throwaway git repo to run the deletion, rename and untracked cases against.
 *
 * Deliberately not this repo. A source file missing from the working tree, or a
 * new untracked one appearing in it, is precisely what the guard reports as
 * stale — so mutating the real tree from inside a test would make theme.test.ts,
 * manifest.test.ts and the E2E fixture fail for as long as the mutation existed,
 * and vitest runs those files in parallel with this one. A fixture also lets the
 * timestamps be exact instead of whatever the filesystem happened to record.
 */
function fixture(
  name: string,
  tracked: Record<string, string>,
  untracked: Record<string, string> = {},
): string {
  const root = path.join(scratch, name);
  mkdirSync(root, { recursive: true });
  execFileSync('git', ['init', '-q'], { cwd: root, stdio: 'ignore' });
  write(root, tracked);
  execFileSync('git', ['add', '-A'], { cwd: root, stdio: 'ignore' });
  write(root, untracked);
  return root;
}

/**
 * Backdates every path in the fixture to just before {@link BUILT_MS}, so the
 * tree starts out fresh and anything a case does afterwards is unambiguously
 * newer than the build. `.git` is left alone: git owns the mtimes in there.
 */
function age(root: string): void {
  const when = new Date(BUILT_MS - 1_000);
  const stack = [root];
  while (stack.length > 0) {
    const dir = stack.pop() as string;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === '.git') continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) stack.push(full);
      utimesSync(full, when, when);
    }
    utimesSync(dir, when, when);
  }
}

/** A source tree with the shapes the cases need: nested dirs, a test, an ignore. */
const TREE = {
  '.gitignore': 'out/\n',
  'package.json': '{}\n',
  'components/HeaderRow.tsx': 'export const HeaderRow = () => null;\n',
  'components/TopBar.tsx': 'export const TopBar = () => null;\n',
  'lib/permissions/audit.ts': 'export const audit = () => [];\n',
  'lib/permissions/probe.ts': 'export const probe = () => [];\n',
  'public/theme.js': '// theme\n',
  'tests/unit/grid.test.ts': '// a test\n',
} as const;

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

/**
 * The case the guard was written for and did not cover: a source that is gone.
 *
 * A file's own mtime only moves when its contents are rewritten. A deletion
 * leaves a path git still lists and `statSync` cannot find; a rename carries the
 * old mtime to the new path. Neither produces a file newer than the build, so a
 * walk over files alone calls the build fresh — which is the reviewer's incident
 * happening again inside the fix for it.
 */
describe('a source the working tree no longer has where git says it is', () => {
  it('is fresh while every listed path is where git says it is', () => {
    const repo = fixture('untouched', TREE);
    age(repo);
    expect(isStale(BUILT_MS, newestSource(repo))).toBe(false);
  });

  it('reports a deleted file, whose own mtime went with it', () => {
    const repo = fixture('deleted', TREE);
    age(repo);
    rmSync(path.join(repo, 'public/theme.js'));
    expect(isStale(BUILT_MS, newestSource(repo))).toBe(true);
  });

  it('reports a rename, which carries the old mtime to the new path', () => {
    const repo = fixture('renamed', TREE);
    age(repo);
    renameSync(
      path.join(repo, 'components/HeaderRow.tsx'),
      path.join(repo, 'components/HeaderRowRenamed.tsx'),
    );
    // Pinned because it is the whole reason a file-only walk misses this:
    // rename(2) preserves mtime, so the file the guard can still stat is as old
    // as the build.
    expect(statSync(path.join(repo, 'components/HeaderRowRenamed.tsx')).mtimeMs).toBeLessThan(
      BUILT_MS,
    );
    expect(isStale(BUILT_MS, newestSource(repo))).toBe(true);
  });

  it('reports a whole directory removed, where the listed dirname is gone too', () => {
    const repo = fixture('rmdir', TREE);
    age(repo);
    rmSync(path.join(repo, 'lib/permissions'), { recursive: true });
    expect(isStale(BUILT_MS, newestSource(repo))).toBe(true);
  });

  it('reports a staged rename, which leaves no missing path behind at all', () => {
    const repo = fixture('staged-rename', TREE);
    age(repo);
    execFileSync('git', ['mv', 'components/TopBar.tsx', 'components/TopBarRenamed.tsx'], {
      cwd: repo,
      stdio: 'ignore',
    });
    expect(isStale(BUILT_MS, newestSource(repo))).toBe(true);
  });

  it('names the directory it took the timestamp from, so the error can say why', () => {
    const repo = fixture('named', TREE);
    age(repo);
    rmSync(path.join(repo, 'public/theme.js'));
    expect(newestSource(repo)).toMatchObject({ file: 'public/', kind: 'directory' });
  });
});

/**
 * The other half of reading directory timestamps: they must move for source
 * changes and nothing else. A guard that goes red on an unrelated write is a
 * guard someone deletes.
 */
describe('what reading a directory timestamp must not cost', () => {
  it('stays fresh when a gitignored artifact appears at the repo root', () => {
    const repo = fixture('ignored-artifact', TREE);
    age(repo);
    write(repo, { 'out/popup.js': '' });
    // The root's mtime just moved, and every artifact `.gitignore` names lives
    // directly under the root — `.output/`, `test-results/`, `playwright-report/`.
    // Measured in this repo while writing this: the root was 31s *newer* than
    // the build it had just produced, because playwright wrote test-results/ in
    // between. Folding the root in on its own account would have reported that
    // build stale to every spec after the first.
    expect(statSync(repo).mtimeMs).toBeGreaterThan(BUILT_MS);
    expect(isStale(BUILT_MS, newestSource(repo))).toBe(false);
  });

  it('stays fresh when a listed symlink resolves to a directory newer than the build', () => {
    const repo = fixture('symlinked-deps', TREE);
    age(repo);
    const target = path.join(scratch, 'symlinked-deps-target');
    write(target, { 'react/index.js': '' });
    symlinkSync(target, path.join(repo, 'deps'));
    // This is the real `node_modules` in a git worktree: a symlink, which
    // `.gitignore`'s directory-only `node_modules/` does not match and git
    // therefore lists.
    expect(sourceFiles(repo)).toContain('deps');
    expect(isStale(BUILT_MS, newestSource(repo))).toBe(false);
  });

  it('stays fresh when a test is edited, and when a new test file is added', () => {
    const repo = fixture('tests-carve-out', TREE);
    age(repo);
    const now = new Date();
    utimesSync(path.join(repo, 'tests/unit/grid.test.ts'), now, now);
    write(repo, { 'tests/unit/new.test.ts': '' });
    expect(isStale(BUILT_MS, newestSource(repo))).toBe(false);
  });

  it('still reports a new untracked source file — that one is a real change', () => {
    const repo = fixture('untracked-source', TREE);
    age(repo);
    write(repo, { 'components/NewThing.tsx': '' });
    expect(isStale(BUILT_MS, newestSource(repo))).toBe(true);
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
